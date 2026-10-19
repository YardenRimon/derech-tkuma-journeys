import assert from "node:assert/strict";
import { verifyAccessIdentity, accessDiagnosticsEnabled, accessDiagnosticPath, reportAccessFailure, reportAccessHeaderPresence } from "../lib/cloudflare-access.ts";

const issuer = "https://team-review.cloudflareaccess.com";
const audience = "test-access-audience";
const now = 1_800_000_000_000;
const kid = "test-rsa-key";

const primary = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const attacker = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const rotated = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const rotatedAgain = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = { ...await crypto.subtle.exportKey("jwk", primary.publicKey), kid, alg: "RS256", use: "sig", key_ops: ["verify"] };
let jwksRequests = 0;
const fetcher = async (input, init) => {
  jwksRequests++;
  assert.equal(String(input), `${issuer}/cdn-cgi/access/certs`);
  assert.equal(init.redirect, "error");
  assert.ok(init.signal);
  return Response.json({ keys: [publicJwk] });
};

function b64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function token(claimOverrides = {}, headerOverrides = {}, signer = primary.privateKey) {
  const header = { alg: "RS256", typ: "JWT", kid, ...headerOverrides };
  const claims = {
    iss: issuer,
    aud: ["another-app", audience],
    sub: "cloudflare-user-42",
    email: "Editor@Example.org",
    name: "Example Editor",
    type: "app",
    iat: now / 1000 - 30,
    nbf: now / 1000 - 30,
    exp: now / 1000 + 300,
    ...claimOverrides,
  };
  const content = `${b64url(header)}.${b64url(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(content),
  );
  return `${content}.${Buffer.from(signature).toString("base64url")}`;
}

const validToken = await token();
const valid = await verifyAccessIdentity(validToken, { issuer, audience }, { fetcher, now: () => now });
assert.deepEqual(valid, {
  userId: "cloudflare-user-42",
  email: "editor@example.org",
  displayName: "Example Editor",
  fullName: "Example Editor",
});
assert.equal(jwksRequests, 1, "JWKS is cached after a successful fetch");

assert.equal(await verifyAccessIdentity(await token({}, {}, attacker.privateKey), { issuer, audience }, { fetcher, now: () => now }), null, "bad RSA signature is rejected");
assert.equal(await verifyAccessIdentity(await token({ iss: "https://attacker.cloudflareaccess.com" }), { issuer, audience }, { fetcher, now: () => now }), null, "wrong issuer is rejected");
assert.equal(await verifyAccessIdentity(await token({ aud: "different-app" }), { issuer, audience }, { fetcher, now: () => now }), null, "wrong audience is rejected");
assert.equal(await verifyAccessIdentity(await token({ type: "org" }), { issuer, audience }, { fetcher, now: () => now }), null, "global session token is rejected");
assert.equal(await verifyAccessIdentity(await token({ type: undefined }), { issuer, audience }, { fetcher, now: () => now }), null, "missing token type is rejected");
assert.equal(await verifyAccessIdentity(await token({ exp: now / 1000 - 120 }), { issuer, audience }, { fetcher, now: () => now }), null, "expired token is rejected");
assert.equal(await verifyAccessIdentity(await token({ nbf: now / 1000 + 120 }), { issuer, audience }, { fetcher, now: () => now }), null, "future not-before is rejected");
assert.equal(await verifyAccessIdentity(await token({ iat: now / 1000 + 120 }), { issuer, audience }, { fetcher, now: () => now }), null, "future issued-at is rejected");
assert.equal(await verifyAccessIdentity(await token({ sub: "" }), { issuer, audience }, { fetcher, now: () => now }), null, "missing identity is rejected");
assert.equal(await verifyAccessIdentity(await token({ email: "not-an-email" }), { issuer, audience }, { fetcher, now: () => now }), null, "invalid email is rejected");
assert.equal(await verifyAccessIdentity(await token({}, { alg: "none" }), { issuer, audience }, { fetcher, now: () => now }), null, "non-RS256 algorithm is rejected");
assert.equal(await verifyAccessIdentity(await token({}, { kid: undefined }), { issuer, audience }, { fetcher, now: () => now }), null, "missing signing key id is rejected");
assert.equal(await verifyAccessIdentity("not.a.jwt", { issuer, audience }, { fetcher, now: () => now }), null, "malformed token is rejected");
assert.equal(await verifyAccessIdentity(`${"a".repeat(16_385)}`, { issuer, audience }, { fetcher, now: () => now }), null, "oversized token is rejected");
assert.equal(await verifyAccessIdentity(validToken, { issuer: "http://team.cloudflareaccess.com", audience }, { fetcher, now: () => now }), null, "non-HTTPS issuer is rejected");
assert.equal(await verifyAccessIdentity(validToken, { issuer: "https://team.cloudflareaccess.com.evil.test", audience }, { fetcher, now: () => now }), null, "unrelated issuer hostname is rejected");

const unknownKid = await token({}, { kid: "not-in-jwks" });
assert.equal(await verifyAccessIdentity(unknownKid, { issuer, audience }, { fetcher, now: () => now }), null, "unknown key id is rejected");
assert.equal(jwksRequests, 2, "unknown key id forces one JWKS refresh");

const rotationIssuer = "https://rotation-test.cloudflareaccess.com";
let rotationTime = now;
let currentRotationKey = {
  ...await crypto.subtle.exportKey("jwk", primary.publicKey),
  kid: "rotation-old", alg: "RS256", use: "sig", key_ops: ["verify"],
};
let rotationFetches = 0;
const rotationFetch = async () => {
  rotationFetches++;
  return Response.json({ keys: [currentRotationKey] });
};
const rotationConfig = { issuer: rotationIssuer, audience };
assert.ok(await verifyAccessIdentity(await token({ iss: rotationIssuer }, { kid: "rotation-old" }), rotationConfig, {
  fetcher: rotationFetch, now: () => rotationTime,
}));
assert.equal(rotationFetches, 1, "initial rotation test fetches current JWKS");

currentRotationKey = {
  ...await crypto.subtle.exportKey("jwk", rotated.publicKey),
  kid: "rotation-new", alg: "RS256", use: "sig", key_ops: ["verify"],
};
const rotatedToken = await token({ iss: rotationIssuer }, { kid: "rotation-new" }, rotated.privateKey);
assert.ok(await verifyAccessIdentity(rotatedToken, rotationConfig, { fetcher: rotationFetch, now: () => rotationTime }), "known key rotation refreshes and accepts the new key");
assert.equal(rotationFetches, 2, "one forced refresh accepts a rotated known key");

const forgedKids = await Promise.all(Array.from({ length: 12 }, (_, index) =>
  token({ iss: rotationIssuer }, { kid: `forged-${index}` }),
));
for (const forged of forgedKids) {
  assert.equal(await verifyAccessIdentity(forged, rotationConfig, { fetcher: rotationFetch, now: () => rotationTime }), null);
}
assert.equal(rotationFetches, 2, "unknown-kid storm cannot bypass the one-minute refresh cooldown");

rotationTime += 30_000;
currentRotationKey = {
  ...await crypto.subtle.exportKey("jwk", rotatedAgain.publicKey),
  kid: "rotation-newer", alg: "RS256", use: "sig", key_ops: ["verify"],
};
const cooldownToken = await token({ iss: rotationIssuer }, { kid: "rotation-newer" }, rotatedAgain.privateKey);
assert.equal(await verifyAccessIdentity(cooldownToken, rotationConfig, { fetcher: rotationFetch, now: () => rotationTime }), null, "rotation is not refetched during cooldown");
assert.equal(rotationFetches, 2);
rotationTime += 31_000;
assert.ok(await verifyAccessIdentity(cooldownToken, rotationConfig, { fetcher: rotationFetch, now: () => rotationTime }), "expired cooldown permits a later key rotation refresh");
assert.equal(rotationFetches, 3, "one new refresh is allowed after cooldown expires");

for (const [label, badResponse] of [
  ["HTTP error", new Response("blocked", { status: 403 })],
  ["redirect", Response.redirect(`${issuer}/elsewhere`, 302)],
  ["invalid JSON", new Response("{", { status: 200 })],
  ["oversized JWKS", new Response(" ".repeat(65_537), { status: 200 })],
  ["missing keys", Response.json({ keys: [] })],
]) {
  const isolatedIssuer = `https://error-${label.replaceAll(" ", "-")}.cloudflareaccess.com`;
  const matchingToken = await token({ iss: isolatedIssuer });
  const result = await verifyAccessIdentity(matchingToken, { issuer: isolatedIssuer, audience }, {
    now: () => now,
    fetcher: async () => badResponse,
  });
  assert.equal(result, null, `JWKS ${label} fails closed`);
}

// Diagnostics are a separate observation channel, never an authentication input.
assert.equal(accessDiagnosticsEnabled({ PLATFORM_RELEASE_STAGE: "review" }), false);
assert.equal(accessDiagnosticsEnabled({ PLATFORM_RELEASE_STAGE: "production", CF_ACCESS_DIAGNOSTICS: "enabled" }), false);
assert.equal(accessDiagnosticsEnabled({ PLATFORM_RELEASE_STAGE: "review", CF_ACCESS_DIAGNOSTICS: "true" }), false);
assert.equal(accessDiagnosticsEnabled({ PLATFORM_RELEASE_STAGE: "review", CF_ACCESS_DIAGNOSTICS: "enabled" }), true);
for (const path of ["/admin", "/admin/users", "/api/users", "/api/tasks/", "/api/cms/edit", "/api/collections/tours", "/api/reports", "/api/execution"]) assert.equal(accessDiagnosticPath(path), true);
for (const path of ["/", "/auth-required", "/api/public/collections/tours", "/api/contact", "/api/health", "/api/backup", "/api/machine/execution", "/api/users-other"]) assert.equal(accessDiagnosticPath(path), false);
const secretCanary = "never-log-private-token-email-kid-claim-or-exception";
const scenarios = [
  { stage: "token_missing", jwt: "" },
  { stage: "config_invalid", config: { issuer: `http://${secretCanary}.invalid`, audience } },
  { stage: "token_invalid", jwt: secretCanary },
  { stage: "claims_invalid", claims: { email: secretCanary } },
  { stage: "time_invalid", claims: { nbf: undefined } },
  { stage: "jwks_fetch_failed", fetcher: async () => { throw new Error(secretCanary); } },
  { stage: "jwks_schema_invalid", fetcher: async () => new Response(secretCanary) },
  { stage: "key_missing", fetcher: async () => Response.json({ keys: [{ ...publicJwk, kid: secretCanary }] }) },
  { stage: "key_policy_invalid", fetcher: async () => Response.json({ keys: [{ ...publicJwk, use: secretCanary }] }) },
  { stage: "key_import_failed", fetcher: async () => Response.json({ keys: [{ ...publicJwk, n: undefined }] }) },
  { stage: "signature_invalid", signer: attacker.privateKey },
];
for (const [index, scenario] of scenarios.entries()) {
  const isolatedIssuer = `https://diagnostic-${index}.cloudflareaccess.com`;
  const events = [];
  const input = scenario.jwt ?? await token({ iss: isolatedIssuer, ...scenario.claims }, {}, scenario.signer);
  assert.equal(await verifyAccessIdentity(input, scenario.config ?? { issuer: isolatedIssuer, audience }, {
    now: () => now,
    fetcher: scenario.fetcher ?? (async () => Response.json({ keys: [publicJwk] })),
    onFailure: (...args) => events.push(args),
  }), null);
  assert.deepEqual(events, [[scenario.stage]], "exactly one fixed enum and no second/raw argument");
  assert.equal(JSON.stringify(events).includes(secretCanary), false);
}
assert.equal(await verifyAccessIdentity(secretCanary, { issuer, audience }, { onFailure: () => { throw new Error(secretCanary); } }), null, "callback errors preserve denial");
assert.ok(await verifyAccessIdentity(validToken, { issuer, audience }, { now: () => now, onFailure: () => assert.fail("success must not report a failure") }));
const absentOpsIssuer = "https://diagnostic-absent-key-ops.cloudflareaccess.com";
const absentOps = { ...publicJwk }; delete absentOps.key_ops;
assert.ok(await verifyAccessIdentity(await token({ iss: absentOpsIssuer }), { issuer: absentOpsIssuer, audience }, { now: () => now, fetcher: async () => Response.json({ keys: [absentOps] }) }), "provider JWK without key_ops remains valid");
const originalWarn = console.warn, logs = [];
try {
  console.warn = (...args) => logs.push(args);
  reportAccessFailure("jwks_fetch_failed");
  reportAccessHeaderPresence("worker", true);
  reportAccessHeaderPresence("app", false);
  reportAccessFailure(secretCanary);
  reportAccessHeaderPresence(secretCanary, true);
  reportAccessHeaderPresence("app", secretCanary);
  assert.deepEqual(logs, [
    ["derech_access_diagnostic", { event: "verification_failed", stage: "jwks_fetch_failed" }],
    ["derech_access_diagnostic", { event: "header_presence", location: "worker", assertionPresent: true }],
    ["derech_access_diagnostic", { event: "header_presence", location: "app", assertionPresent: false }],
  ]);
  assert.equal(JSON.stringify(logs).includes(secretCanary), false);
  console.warn = () => { throw new Error(secretCanary); };
  assert.doesNotThrow(() => reportAccessFailure("token_missing"));
  assert.doesNotThrow(() => reportAccessHeaderPresence("app", false));
} finally { console.warn = originalWarn; }
console.log("Cloudflare Access JWT checks passed (crypto, unchanged claim rejection, bounded cache, fixed diagnostics, redaction and callback isolation).");
