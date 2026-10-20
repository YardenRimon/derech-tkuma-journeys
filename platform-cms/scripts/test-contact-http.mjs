/** Actual route functions + real SQLite adapter, with only deployment bindings
 * injected. No network, live D1, source form submission or dispatch is involved. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sqlite = new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE cms_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE cms_deployment_scope(singleton INTEGER PRIMARY KEY,tenant_id TEXT,site_id TEXT)');
let reads = 0;
const db = { prepare(sql) { reads++;const statement = sqlite.prepare(sql);return { args: [], bind(...args) { this.args = args;return this; }, async first() { return statement.get(...this.args) ?? null; }, async run() { return { meta: { changes: Number(statement.run(...this.args).changes) } }; } }; } };
const bindings = { DB: db, CMS_ADAPTER_MODE: 'isolated-d1', CMS_TENANT_ID: 'derech', CMS_SITE_ID: 'derech-main' };
globalThis.__contactHttpBindings = bindings;
globalThis.__contactHttpPage = '<html><head><script src="/__pilot__/guard.js"></script></head><body><form><input name="form_id" value="0899899"></form></body></html>';
const output = await build({ stdin: { contents: `export {POST} from './app/api/contact/route';export {GET} from './app/[[...slug]]/route';`, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent', plugins: [{ name: 'isolated-bindings', setup(builder) {
  builder.onResolve({ filter: /^(cloudflare:workers|@\/app\/chatgpt-auth|@\/lib\/cms)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'cloudflare:workers' ? 'export const env=globalThis.__contactHttpBindings;' : path === '@/app/chatgpt-auth' ? 'export const getAuthProvider=()=>"supabase",getChatGPTUser=async()=>null;' : 'export class CmsError extends Error{};export const getPublishedPage=async()=>globalThis.__contactHttpPage;', loader: 'js' }));
} }] });
const { POST, GET } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
const origin = 'https://derech-tkuma.com', key = '10000000-0000-4000-8000-000000000001';
const input = { idempotencyKey: key, formId: '0899899', fullName: 'שם בדיקה', phone: '0501234567', email: 'synthetic@example.test', consent: { contact: true, policyVersion: 'source-2026-10-19' }, honeypot: '' };
const request = (value = input, headers = {}, address = origin + '/api/contact/') => new Request(address, { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
const count = () => sqlite.prepare('SELECT count(*) AS n FROM cms_settings').get().n;
try {
  let response = await POST(request());assert.equal(response.status, 503);assert.equal(reads, 0);assert.equal(count(), 0);
  Object.assign(bindings, { CONTACT_MODE: 'receive-only', CONTACT_ORIGIN: origin });
  response = await POST(request(input, { origin }, 'https://review.workers.dev/api/contact/'));assert.equal(response.status, 503);assert.equal(reads, 0, 'review misconfiguration fails before DB');
  const reviewPage = await GET(new Request('https://review.workers.dev/', { headers: { origin, host: new URL(origin).host, 'x-contact-mode': 'production' } }));assert.equal(await reviewPage.text(), globalThis.__contactHttpPage, 'forged browser headers cannot inject native client on review');
  const productionPage = await GET(new Request(origin + '/'));assert.ok((await productionPage.text()).includes('data-native-contact='));
  for(const [headers, address, status] of [[{ origin: 'https://outside.invalid' }, undefined, 403], [{ 'sec-fetch-site': 'cross-site' }, undefined, 403], [{ 'content-type': 'text/plain' }, undefined, 415], [{}, origin + '/api/contact/?email=synthetic@example.test', 403]]) { response = await POST(request(input, headers, address));assert.equal(response.status, status);assert.equal(count(), 0); }
  response = await POST(request({ ...input, consent: { contact: false, policyVersion: 'source-2026-10-19' } }));assert.equal(response.status, 400);assert.equal(count(), 0);
  for(const formId of ['1b8a2d8', 'c5cb8a0', 'aa2b8e0']) { response = await POST(request({ ...input, formId }));assert.equal(response.status, 503);assert.equal(count(), 0); }
  response = await POST(request());assert.equal(response.status, 202);const receipt = await response.json();assert.deepEqual(Object.keys(receipt).sort(), ['accepted', 'receipt', 'state']);assert.equal(receipt.state, 'stored_pending_processing');assert.equal(count(), 1);assert.match(response.headers.get('cache-control'), /no-store/);assert.match(response.headers.get('x-robots-tag'), /noindex/);
  for(const privateValue of [input.fullName, input.phone, input.email]) assert.ok(!JSON.stringify(receipt).includes(privateValue));
  // The first response may have been lost after storage. A concurrent/repeated
  // retry through the actual HTTP route must return that same receipt.
  const replay = await Promise.all([POST(request()), POST(request())]);for(const reply of replay) { assert.equal(reply.status, 202);assert.deepEqual(await reply.json(), receipt); }assert.equal(count(), 1);
  response = await POST(request({ ...input, fullName: 'שינוי אחר' }));assert.equal(response.status, 409);assert.deepEqual(await response.json(), { accepted: false, code: 'idempotency_conflict' });assert.equal(count(), 1);
  response = await POST(request({ ...input, formId: 'af355f0', idempotencyKey: '30000000-0000-4000-8000-000000000003' }));assert.equal(response.status, 202);assert.equal(count(), 2);
  Object.assign(bindings, { CMS_SITE_ID: 'other' });response = await POST(request({ ...input, idempotencyKey: '40000000-0000-4000-8000-000000000004' }));assert.equal(response.status, 503);assert.equal(count(), 2);
  console.log('PASS contact HTTP boundary: actual routes/SQLite, review-before-storage, spoofed origin/headers, production-only renderer insertion, JSON/consent/contract/scope gates, opaque202 receipt, lost-response replay/concurrency and changed-payload409; entirely offline.');
} finally { delete globalThis.__contactHttpBindings;delete globalThis.__contactHttpPage;sqlite.close(); }
