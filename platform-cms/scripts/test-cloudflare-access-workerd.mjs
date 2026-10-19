/** Actual local workerd + installed Vinext fetch patch. Every outbound request is routed to a local stub Worker. */
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "derech-access-workerd-"));
const audience = "synthetic-local-audience";
const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const attacker = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", key.publicKey), kid: "synthetic-local-key", alg: "RS256", use: "sig" };
delete jwk.key_ops; // Match Cloudflare's public JWK shape.
const now = Math.floor(Date.now() / 1000);
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const cases = [];
async function addCase(name, overrides = {}, signer = key.privateKey) {
  const issuer = `https://${name}.cloudflareaccess.com`;
  const claims = { iss: issuer, aud: [audience], type: "app", sub: "synthetic-user", email: "synthetic@example.invalid", iat: now - 1, nbf: now - 1, exp: now + 600, ...overrides };
  const content = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(content));
  cases.push({ name, issuer, audience, jwt: `${content}.${Buffer.from(signature).toString("base64url")}` });
}
await addCase("native-valid");
await addCase("forced-valid");
await addCase("invalid-signature", {}, attacker.privateKey);
await addCase("wrong-audience", { aud: ["another-synthetic-app"] });
await addCase("wrong-issuer", { iss: "https://untrusted-local.cloudflareaccess.com" });
await addCase("expired", { exp: now - 120, iat: now - 300, nbf: now - 300 });
for (const status of [301, 302, 303, 307, 308]) await addCase(`redirect-${status}`);
let miniflare;
try {
  const entry = join(directory, "entry.mjs");
  writeFileSync(entry, `
import {ensureFetchPatch,runWithFetchCache,setCurrentForceDynamicFetchDefault} from ${JSON.stringify(join(root, "node_modules/vinext/dist/shims/fetch-cache.js"))};
import {verifyAccessIdentity} from ${JSON.stringify(join(root, "lib/cloudflare-access.ts"))};
const nativeFetch = globalThis.fetch;
export default { async fetch(request,env) {
 const fixtures=JSON.parse(env.SYNTHETIC_CASES),results=[];
 // An unbound native call with the full canonical options must work in workerd.
 const native=await nativeFetch(fixtures[0].issuer+'/cdn-cgi/access/certs',{method:'GET',redirect:'manual',signal:AbortSignal.timeout(3000),headers:{accept:'application/json','user-agent':'DerechCMSAccessVerifier/1.0'}});
 await native.body?.cancel();results.push({name:'native-unbound',status:native.status});
 const first=fixtures[0],fail=[],probes=[];
 results.push({name:first.name,accepted:Boolean(await verifyAccessIdentity(first.jwt,first,{onFailure:s=>fail.push(s),onJwksProbe:p=>probes.push(p)})),fail,probes});
 ensureFetchPatch();
 await runWithFetchCache(async()=>{
  setCurrentForceDynamicFetchDefault(true);
  for(const fixture of fixtures.slice(1)){
   const fail=[],probes=[];
   const identity=await verifyAccessIdentity(fixture.jwt,fixture,{onFailure:s=>fail.push(s),onJwksProbe:p=>probes.push(p)});
   results.push({name:fixture.name,accepted:Boolean(identity),fail,probes});
  }
 });
 return Response.json({patchedFetchInstalled:globalThis.fetch!==nativeFetch,results});
}};
`);
  const output = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["node:*", "cloudflare:workers"], logLevel: "silent" });
  const urls = Object.fromEntries(cases.map(fixture => [`${fixture.issuer}/cdn-cgi/access/certs`, fixture.name]));
  const stub = `
const known=${JSON.stringify(urls)},hits={},unexpected=[];
export default{fetch(request){
 if(request.url==='https://local-fixture.invalid/counts')return Response.json({hits,unexpected});
 const name=known[request.url];
 if(!name){unexpected.push('unexpected_target');return new Response('local fixture rejected target',{status:502});}
 hits[name]=(hits[name]??0)+1;
 if(name.startsWith('redirect-'))return new Response(null,{status:Number(name.slice(9)),headers:{location:'https://forbidden-redirect.invalid/must-not-be-contacted'}});
 return Response.json({keys:[${JSON.stringify(jwk)}]});
}};`;
  miniflare = new Miniflare({ workers: [
    { name: "probe", modules: true, script: output.outputFiles[0].text, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], bindings: { SYNTHETIC_CASES: JSON.stringify(cases) }, outboundService: "fixed-jwks" },
    // This Worker never calls fetch. No test request can escape to the Internet.
    { name: "fixed-jwks", modules: true, script: stub, compatibilityDate: "2026-05-15" },
  ] });
  for (let request = 0; request < 2; request++) {
    const response = await miniflare.dispatchFetch("https://local-fixture.invalid/probe");
    assert.equal(response.status, 200);
    const observation = await response.json();
    assert.equal(observation.patchedFetchInstalled, true);
    for (const result of observation.results) {
      if (result.name === "native-unbound") { assert.equal(result.status, 200); continue; }
      assert.equal(result.accepted, result.name.endsWith("-valid"), result.name);
      if (result.name.startsWith("redirect-")) {
        assert.deepEqual(result.fail, ["jwks_fetch_failed"]);
        assert.deepEqual(result.probes, [{ event: "jwks_response", status: Number(result.name.slice(9)), redirected: false }]);
      } else if (result.name === "invalid-signature") assert.deepEqual(result.fail, ["signature_invalid"]);
      else if (result.name === "wrong-audience" || result.name === "wrong-issuer") assert.deepEqual(result.fail, ["claims_invalid"]);
      else if (result.name === "expired") assert.deepEqual(result.fail, ["time_invalid"]);
      else assert.deepEqual(result.fail, []);
    }
  }
  const stubWorker = await miniflare.getWorker("fixed-jwks");
  const counts = await (await stubWorker.fetch("https://local-fixture.invalid/counts")).json();
  assert.deepEqual(counts.unexpected, [], "redirect targets and all other external targets must never be contacted");
  for (const name of ["wrong-audience", "wrong-issuer", "expired"]) assert.equal(counts.hits[name], undefined, "invalid claims must be rejected before JWKS transport");
  assert.equal(counts.hits["forced-valid"], 1, "verified public JWKS cache is safely reused across requests");
  console.log("Cloudflare Access actual workerd: native and real Vinext force-dynamic signed JWT verification, claim/signature denial, all 3xx rejected without following, no external network passed.");
} finally {
  if (miniflare) await miniflare.dispose();
  rmSync(directory, { recursive: true, force: true });
}
