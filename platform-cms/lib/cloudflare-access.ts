export type AccessIdentity = {
  userId: string;
  email: string;
  displayName: string;
  fullName: string | null;
};

export type AccessConfig = { issuer: string; audience: string };
type AccessKey = JsonWebKey & { kid?: string; alg?: string; use?: string; key_ops?: string[] };
type AccessClaims = {
  iss?: unknown;
  aud?: unknown;
  type?: unknown;
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
};
export type AccessFailureStage =
  | "token_missing" | "config_invalid" | "token_invalid" | "claims_invalid"
  | "time_invalid" | "jwks_fetch_failed" | "jwks_schema_invalid"
  | "key_missing" | "key_policy_invalid" | "key_import_failed" | "signature_invalid";
export type AccessJwksProbe =
  | { event: "jwks_response"; status: number; redirected: boolean }
  | { event: "jwks_network_failure"; kind: "timeout" | "network" };
type VerifyOptions = { fetcher?: typeof fetch; now?: () => number; onFailure?: (stage: AccessFailureStage) => void; onJwksProbe?: (probe: AccessJwksProbe) => void };

// Explicit opt-in, review only. No raw request, token, claim or error is accepted by a logger.
export const ACCESS_DIAGNOSTIC_SCOPE_HEADER = "x-derech-internal-access-diagnostic";
const FAILURE_STAGES = new Set<AccessFailureStage>([
  "token_missing", "config_invalid", "token_invalid", "claims_invalid", "time_invalid",
  "jwks_fetch_failed", "jwks_schema_invalid", "key_missing", "key_policy_invalid",
  "key_import_failed", "signature_invalid",
]);
export function accessDiagnosticsEnabled(config: { PLATFORM_RELEASE_STAGE?: string; CF_ACCESS_DIAGNOSTICS?: string }): boolean {
  return config.PLATFORM_RELEASE_STAGE === "review" && config.CF_ACCESS_DIAGNOSTICS === "enabled";
}
export function accessDiagnosticPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || /^\/api\/(?:users|tasks|reports|cms|collections|execution)(?:\/|$)/.test(pathname);
}
export function reportAccessFailure(stage: AccessFailureStage): void {
  if (!FAILURE_STAGES.has(stage)) return;
  try { console.warn("derech_access_diagnostic", { event: "verification_failed", stage }); } catch { /* Logging cannot affect authentication. */ }
}
export function reportAccessHeaderPresence(location: "worker" | "app", assertionPresent: boolean): void {
  if ((location !== "worker" && location !== "app") || typeof assertionPresent !== "boolean") return;
  try { console.warn("derech_access_diagnostic", { event: "header_presence", location, assertionPresent }); } catch { /* Logging cannot affect authentication. */ }
}
export function reportAccessJwksProbe(probe: AccessJwksProbe): void {
  if (!probe || typeof probe !== "object") return;
  // Reconstruct the closed schema; caller-added fields are never serialized.
  try {
    if (probe.event === "jwks_response" && Number.isInteger(probe.status) && probe.status >= 100 && probe.status <= 599 && typeof probe.redirected === "boolean") {
      console.warn("derech_access_diagnostic", { event: "jwks_response", status: probe.status, redirected: probe.redirected });
    } else if (probe.event === "jwks_network_failure" && (probe.kind === "timeout" || probe.kind === "network")) {
      console.warn("derech_access_diagnostic", { event: "jwks_network_failure", kind: probe.kind });
    }
  } catch { /* Diagnostics cannot affect authentication. */ }
}

const MAX_TOKEN_BYTES = 16_384;
const MAX_JWKS_BYTES = 65_536;
const MAX_JWKS_KEYS = 100;
const CACHE_TTL_MS = 5 * 60_000;
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 60_000;
const MAX_CACHE_ENTRIES = 8;
const CLOCK_SKEW_SECONDS = 60;
const jwksCache = new Map<string, { keys: AccessKey[]; expiresAt: number; lastUnknownKidRefreshAt?: number }>();

/**
 * Verify Cloudflare Access's RS256 application JWT at the trusted origin.
 * Identity is derived only from signed claims; request identity headers are not inputs.
 * The issuer is also the sole source for the bounded, redirect-free JWKS lookup.
 */
export async function verifyAccessIdentity(
  jwt: string,
  config: AccessConfig,
  options: VerifyOptions = {},
): Promise<AccessIdentity | null> {
  let stage: AccessFailureStage = "token_invalid";
  const fail = (reason: AccessFailureStage): null => {
    try { options.onFailure?.(reason); } catch { /* Diagnostics cannot grant access or alter denial. */ }
    return null;
  };
  try {
    if (typeof jwt !== "string" || jwt.length === 0 || jwt.length > MAX_TOKEN_BYTES) return fail(jwt === "" ? "token_missing" : "token_invalid");
    stage = "config_invalid";
    const issuer = canonicalIssuer(config?.issuer);
    const audience = config?.audience;
    if (!issuer || typeof audience !== "string" || audience.length === 0 || audience.length > 512) return fail(stage);

    stage = "token_invalid";
    const parts = jwt.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return fail(stage);
    const header = parseJsonPart(parts[0]) as { alg?: unknown; kid?: unknown } | null;
    const claims = parseJsonPart(parts[1]) as AccessClaims | null;
    if (!header || !claims || header.alg !== "RS256" || !validShortString(header.kid, 256)) return fail(stage);
    stage = "claims_invalid";
    if (claims.iss !== issuer || claims.type !== "app" || !hasAudience(claims.aud, audience)) return fail(stage);
    if (!validShortString(claims.sub, 512) || !validEmail(claims.email)) return fail(stage);

    stage = "time_invalid";
    const nowSeconds = (options.now?.() ?? Date.now()) / 1000;
    const exp = numericDate(claims.exp);
    const nbf = numericDate(claims.nbf);
    const iat = numericDate(claims.iat);
    if (
      exp === null || nbf === null || iat === null ||
      exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
      nbf > nowSeconds + CLOCK_SKEW_SECONDS ||
      iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      exp <= iat || nbf > exp
    ) return fail(stage);

    stage = "jwks_fetch_failed";
    const fetcher = options.fetcher ?? fetch;
    const fetchedAt = options.now?.() ?? Date.now();
    const previouslyCached = jwksCache.get(issuer);
    let keys = await getJwks(issuer, fetcher, fetchedAt, false, () => { stage = "jwks_schema_invalid"; }, options.onJwksProbe);
    let key = keys.find((item) => item.kid === header.kid);
    if (!key && previouslyCached && previouslyCached.expiresAt > fetchedAt && canRefreshUnknownKid(issuer, fetchedAt)) {
      stage = "jwks_fetch_failed";
      keys = await getJwks(issuer, fetcher, fetchedAt, true, () => { stage = "jwks_schema_invalid"; }, options.onJwksProbe);
      key = keys.find((item) => item.kid === header.kid);
    }
    if (!key) return fail("key_missing");
    stage = "key_policy_invalid";
    if (key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256") ||
      (key.use !== undefined && key.use !== "sig") ||
      (key.key_ops !== undefined && !key.key_ops.includes("verify"))) return fail(stage);

    stage = "key_import_failed";
    const publicKey = await crypto.subtle.importKey(
      "jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    stage = "signature_invalid";
    const signature = decodeBase64Url(parts[2]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signatureBuffer = new ArrayBuffer(signature.byteLength);
    new Uint8Array(signatureBuffer).set(signature);
    const dataBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(dataBuffer).set(data);
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signatureBuffer, dataBuffer);
    if (!verified) return fail(stage);

    const fullName = typeof claims.name === "string" && claims.name.trim().length <= 512
      ? claims.name.trim() || null
      : null;
    const email = (claims.email as string).trim().toLowerCase();
    return {
      userId: (claims.sub as string).trim(),
      email,
      displayName: fullName ?? email,
      fullName,
    };
  } catch {
    return fail(stage);
  }
}

function canonicalIssuer(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== "/" || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validShortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@,]+@[^\s@,]+\.[^\s@,.]+$/.test(value.trim());
}

function numericDate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 253402300799
    ? value
    : null;
}

function hasAudience(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function parseJsonPart(value: string): unknown {
  const bytes = decodeBase64Url(value);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function getJwks(issuer: string, fetcher: typeof fetch, now: number, refresh = false, onSchema?: () => void, onProbe?: (probe: AccessJwksProbe) => void): Promise<AccessKey[]> {
  const cached = jwksCache.get(issuer);
  if (!refresh && cached && cached.expiresAt > now) return cached.keys;

  const observe = (probe: AccessJwksProbe) => { try { onProbe?.(probe); } catch { /* Observation failures never affect authentication. */ } };
  const signal = AbortSignal.timeout(3_000);
  let response: Response;
  try {
    response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
      method: "GET", redirect: "error", signal,
      headers: { accept: "application/json", "user-agent": "DerechCMSAccessVerifier/1.0" },
    });
  } catch {
    observe({ event: "jwks_network_failure", kind: signal.aborted ? "timeout" : "network" });
    throw new Error("JWKS unavailable");
  }
  observe({ event: "jwks_response", status: response.status, redirected: response.redirected });
  if (!response.ok || response.redirected) throw new Error("JWKS unavailable");
  onSchema?.();
  const text = await readBounded(response, MAX_JWKS_BYTES);
  const parsed = JSON.parse(text) as { keys?: unknown };
  if (!parsed || !Array.isArray(parsed.keys) || parsed.keys.length === 0 || parsed.keys.length > MAX_JWKS_KEYS) {
    throw new Error("Invalid JWKS");
  }
  const keys = parsed.keys as AccessKey[];
  const kids = new Set<string>();
  for (const key of keys) {
    if (!key || typeof key !== "object" || !validShortString(key.kid, 256) || kids.has(key.kid)) {
      throw new Error("Invalid JWKS key");
    }
    kids.add(key.kid);
  }

  const lastUnknownKidRefreshAt = jwksCache.get(issuer)?.lastUnknownKidRefreshAt;
  jwksCache.set(issuer, { keys, expiresAt: now + CACHE_TTL_MS, lastUnknownKidRefreshAt });
  while (jwksCache.size > MAX_CACHE_ENTRIES) {
    const oldest = jwksCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    jwksCache.delete(oldest);
  }
  return keys;
}

function canRefreshUnknownKid(issuer: string, now: number): boolean {
  const entry = jwksCache.get(issuer);
  if (!entry || (entry.lastUnknownKidRefreshAt !== undefined &&
    now - entry.lastUnknownKidRefreshAt < UNKNOWN_KID_REFRESH_COOLDOWN_MS)) return false;
  // Record before fetching so repeated unknown kids stay bounded even if JWKS fetch fails.
  jwksCache.set(issuer, { ...entry, lastUnknownKidRefreshAt: now });
  return true;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error("Missing JWKS body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("JWKS too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
