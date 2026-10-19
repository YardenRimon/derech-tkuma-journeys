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
type VerifyOptions = { fetcher?: typeof fetch; now?: () => number };

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
  try {
    if (typeof jwt !== "string" || jwt.length === 0 || jwt.length > MAX_TOKEN_BYTES) return null;
    const issuer = canonicalIssuer(config?.issuer);
    const audience = config?.audience;
    if (!issuer || typeof audience !== "string" || audience.length === 0 || audience.length > 512) return null;

    const parts = jwt.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
    const header = parseJsonPart(parts[0]) as { alg?: unknown; kid?: unknown } | null;
    const claims = parseJsonPart(parts[1]) as AccessClaims | null;
    if (!header || !claims || header.alg !== "RS256" || !validShortString(header.kid, 256)) return null;
    if (claims.iss !== issuer || claims.type !== "app" || !hasAudience(claims.aud, audience)) return null;
    if (!validShortString(claims.sub, 512) || !validEmail(claims.email)) return null;

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
    ) return null;

    const fetcher = options.fetcher ?? fetch;
    const fetchedAt = options.now?.() ?? Date.now();
    const previouslyCached = jwksCache.get(issuer);
    let keys = await getJwks(issuer, fetcher, fetchedAt);
    let key = keys.find((item) => item.kid === header.kid);
    if (!key && previouslyCached && previouslyCached.expiresAt > fetchedAt && canRefreshUnknownKid(issuer, fetchedAt)) {
      keys = await getJwks(issuer, fetcher, fetchedAt, true);
      key = keys.find((item) => item.kid === header.kid);
    }
    if (!key || key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256") ||
      (key.use !== undefined && key.use !== "sig") ||
      (key.key_ops !== undefined && !key.key_ops.includes("verify"))) return null;

    const publicKey = await crypto.subtle.importKey(
      "jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const signature = decodeBase64Url(parts[2]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signatureBuffer = new ArrayBuffer(signature.byteLength);
    new Uint8Array(signatureBuffer).set(signature);
    const dataBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(dataBuffer).set(data);
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signatureBuffer, dataBuffer);
    if (!verified) return null;

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
    return null;
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

async function getJwks(issuer: string, fetcher: typeof fetch, now: number, refresh = false): Promise<AccessKey[]> {
  const cached = jwksCache.get(issuer);
  if (!refresh && cached && cached.expiresAt > now) return cached.keys;

  const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(3_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok || response.redirected) throw new Error("JWKS unavailable");
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
