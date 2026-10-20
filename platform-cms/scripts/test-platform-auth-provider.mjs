/** Entirely offline: injected SDK/fetch prove the provider transport policy.
 * Synthetic tokens stay in the fixture and never appear in diagnostics. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'platform-auth-provider-'));
const sdk = `
let transport;
export const getTransport = () => transport;
export function createServerClient(url,key,options) {
 transport=options.global.fetch;
 async function execute(path,init) {
  const response=await transport(url+path,init);
  if(!response.ok)return{data:{user:null,session:null},error:{status:response.status,name:'AuthApiError'}};
  return{data:await response.json(),error:null};
 }
 return{auth:{
  getUser:jwt=>execute('/auth/v1/user',{method:'GET',headers:{authorization:'Bearer '+jwt}}),
  getSession:()=>execute('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:'synthetic-refresh'}),
  signInWithPassword:input=>execute('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify(input)}),
  mfa:{}
 }};
}`;
const output = await build({ stdin: { contents: `export * from './lib/platform-auth-core';export * from './lib/platform-auth-provider';export {getTransport} from '@supabase/ssr';`, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent', plugins: [{ name: 'offline-sdk', setup(builder) { builder.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: 'sdk', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: sdk, loader: 'js' })); } }] });
const compiled = join(directory, 'provider.mjs');writeFileSync(compiled, output.outputFiles[0].text);
const { createManagedPlatformProvider, PlatformCookieJar, PlatformAuthError, PLATFORM_AUTH_PROJECT_URL, getTransport } = await import(pathToFileURL(compiled).href);
const config = { url: PLATFORM_AUTH_PROJECT_URL, publishableKey: 'sb_publishable_synthetic_fixture', origin: 'https://admin.example.invalid', emailOtpReady: false, requireMfa: false };
const token = 'synthetic-private-token-never-log', user = { id: 'synthetic-user', email: 'synthetic-private@example.invalid' };
const originalFetch = globalThis.fetch, originalWarn = console.warn, originalTimeout = AbortSignal.timeout;
const requests = [], diagnostics = [], deadlines = [];
let outcomes = [];
function reset(sequence) { requests.length = 0;diagnostics.length = 0;deadlines.length = 0;outcomes = [...sequence]; }
function provider() { return createManagedPlatformProvider(config, new PlatformCookieJar(null)); }
const success = () => Response.json({ user });
const timeout = () => { throw new DOMException('synthetic-private-timeout-detail', 'TimeoutError'); };
const network = () => { throw new TypeError('synthetic-private-network-detail'); };
const unavailable = error => error instanceof PlatformAuthError && error.status === 503 && error.code === 'auth_unavailable';

try {
  console.warn = (...items) => { diagnostics.push(items); };
  AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds);return new AbortController().signal; };
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    assert.equal(init.redirect, 'manual');assert.equal(init.cache, 'no-store');assert.ok(init.signal);
    const next = outcomes.shift();assert.ok(next, 'unexpected extra network attempt');return next();
  };
  for (const failure of [timeout, network]) {
    reset([failure, success]);const p = provider(), result = await p.getUser(token);
    assert.deepEqual(result, { data: { user }, error: null });assert.equal(requests.length, 2);assert.deepEqual(deadlines, [10000, 2500]);
    assert.ok(requests.every(request => request.url === config.url + '/auth/v1/user'));
    assert.ok(requests.every(request => new Headers(request.init.headers).get('authorization') === 'Bearer ' + token), 'same token is remotely reverified');
    assert.deepEqual(diagnostics, [[{ event: 'platform_auth_provider_failure', operation: 'user_lookup', kind: failure === timeout ? 'timeout' : 'network', attempt: 1 }]]);
    outcomes.push(() => Response.json({ user: { ...user, revision: 'fresh-provider-record' } }));
    assert.equal((await p.getUser(token)).data.user.revision, 'fresh-provider-record');assert.equal(requests.length, 3, 'successful identities are never cached');
  }
  reset([timeout, timeout]);await assert.rejects(() => provider().getUser(token), unavailable);assert.equal(requests.length, 2);assert.deepEqual(deadlines, [10000, 2500]);assert.deepEqual(diagnostics.map(items => items[0].attempt), [1, 2]);
  for (const status of [401, 403, 429, 302, 502, 503, 504]) {
    reset([() => new Response(null, { status })]);const p = provider();
    if(status === 429) await assert.rejects(() => p.getUser(token), error => error instanceof PlatformAuthError && error.status === 429 && error.code === 'rate_limited');
    else if(status >= 500) await assert.rejects(() => p.getUser(token), unavailable);
    else assert.equal((await p.getUser(token)).error.status, status);
    assert.equal(requests.length, 1, 'HTTP ' + status + ' is never retried');assert.deepEqual(deadlines, [10000]);assert.deepEqual(diagnostics, [[{ event: 'platform_auth_provider_failure', operation: 'user_lookup', kind: 'http', attempt: 1, status }]]);
  }
  reset([success]);await provider().getUser(token);assert.equal(diagnostics.length, 0, 'healthy lookups emit no diagnostics');
  for (const operation of ['password', 'refresh']) {
    reset([timeout]);const p = provider();await assert.rejects(() => operation === 'password' ? p.signInWithPassword({ email: user.email, password: 'synthetic-private-password' }) : p.getSession(), unavailable);
    assert.equal(requests.length, 1, 'mutation and refresh POSTs never retry');assert.deepEqual(deadlines, [10000]);assert.equal(diagnostics[0][0].operation, operation === 'refresh' ? 'session_refresh' : 'other_auth');
  }
  for (const [path, method] of [['/auth/v1/user?unexpected=1', 'GET'], ['/auth/v1/users', 'GET'], ['/auth/v1/user', 'POST'], ['/auth/v1/factors', 'POST'], ['/auth/v1/logout', 'POST']]) {
    reset([network]);provider();await assert.rejects(() => getTransport()(config.url + path, { method }), unavailable);assert.equal(requests.length, 1, 'retry is limited to exact unqualified user GET');
  }
  for (const address of ['https://external.invalid/auth/v1/user', config.url + '/rest/v1/users', config.url + '/auth/v1/user#fragment', 'https://synthetic-private-credential@' + new URL(config.url).host + '/auth/v1/user']) {
    reset([]);provider();await assert.rejects(() => getTransport()(address, { method: 'GET' }), unavailable);assert.equal(requests.length, 0, 'untrusted destinations never reach fetch');assert.equal(diagnostics.length, 0);
  }
  reset([network, network]);await assert.rejects(() => provider().getUser(token), unavailable);
  const serialized = JSON.stringify(diagnostics);
  for (const value of [token, user.email, 'synthetic-private', config.url, 'authorization', 'cookie', 'password', 'url', 'message', 'error']) assert.ok(!serialized.includes(value), 'diagnostics omit private/request/error material');
  for (const [record] of diagnostics) assert.deepEqual(Object.keys(record).sort(), ['attempt', 'event', 'kind', 'operation']);
} finally {
  globalThis.fetch = originalFetch;console.warn = originalWarn;AbortSignal.timeout = originalTimeout;rmSync(directory, { recursive: true, force: true });
}
console.log('PASS provider resilience: exact managed user GET gets one bounded same-token timeout/network retry; HTTP errors/redirects/mutations/refresh never retry; no identity cache, external origin blocked, failure-only sanitized diagnostics; entirely offline.');
