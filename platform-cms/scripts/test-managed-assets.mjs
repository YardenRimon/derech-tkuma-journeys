// Run the actual protected route handlers in workerd. Identity is synthetic;
// the asset imports are the real managed files and no provider is contacted.
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'derech-managed-assets-'));
const privateCanary = 'synthetic-private-identity-never-return-this';
const assets = [
  { name: 'admin.css', contentType: 'text/css; charset=utf-8' },
  { name: 'admin.js', contentType: 'text/javascript; charset=utf-8' },
  { name: 'editor.js', contentType: 'text/javascript; charset=utf-8' },
].map(asset => ({ ...asset, bytes: readFileSync(join(root, 'managed-assets', asset.name)) }));

const identityFixture = `
let mode,checks=[];
export class CmsError extends Error{constructor(status,message){super(message);this.status=status;}}
export function setFixtureMode(value){mode=value;checks=[];}
export function permissionChecks(){return checks;}
export async function authorizeCmsUser(permission){
 checks.push(permission);
 if(permission!=='content')throw new Error('unexpected permission');
 if(mode==='authorized')return {userId:'synthetic-user',role:'content_editor'};
 if(mode==='anonymous')throw new CmsError(401,${JSON.stringify(privateCanary)});
 if(mode==='forbidden')throw new CmsError(403,${JSON.stringify(privateCanary)});
 throw new Error(${JSON.stringify(privateCanary)});
}`;

const entry = `
import * as css from './app/admin/runtime/admin.css/route.ts';
import * as admin from './app/admin/runtime/admin.js/route.ts';
import * as editor from './app/admin/runtime/editor.js/route.ts';
import {setFixtureMode,permissionChecks} from '@/lib/access';
const routes={'/admin/runtime/admin.css':css,'/admin/runtime/admin.js':admin,'/admin/runtime/editor.js':editor};
export default{async fetch(request){
 const url=new URL(request.url),route=routes[url.pathname];
 if(!route)return new Response('Not found',{status:404});
 setFixtureMode(url.searchParams.get('access'));
 const response=await route.GET();
 // Observe the real handler's permission check and cache mode without
 // replacing its body, status or response security headers.
 response.headers.set('x-fixture-permissions',JSON.stringify(permissionChecks()));
 response.headers.set('x-fixture-dynamic',route.dynamic);
 return response;
}};`;

let runtime, outboundCalls = 0;
try {
  const compiled = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'managed-asset-route-fixtures', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/access$/ }, () => ({ path: 'identity', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: identityFixture, loader: 'js' }));
      builder.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(dirname(args.importer), args.path.slice(0, -4)), namespace: 'managed-raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'managed-raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const workerPath = join(temporary, 'worker.mjs');
  writeFileSync(workerPath, compiled.outputFiles[0].text);
  runtime = new Miniflare({
    modules: true, modulesRoot: temporary, rootPath: temporary, scriptPath: workerPath,
    compatibilityDate: '2026-05-15',
    outboundService: () => { outboundCalls++; return new Response('external network disabled', { status: 503 }); },
  });

  for (const asset of assets) {
    const url = 'https://synthetic.invalid/admin/runtime/' + asset.name;
    const assertProtectedHeaders = response => {
      assert.equal(response.headers.get('cache-control'), 'private, no-store', asset.name);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', asset.name);
      assert.equal(response.headers.get('x-fixture-permissions'), '["content"]', 'every response must run content authorization once');
      assert.equal(response.headers.get('x-fixture-dynamic'), 'force-dynamic');
      assert.equal(response.headers.get('etag'), null, 'protected assets must not become public conditional-cache responses');
    };
    for (const [access, status] of [['anonymous', 401], ['forbidden', 403], ['unexpected-failure', 503]]) {
      const denied = await runtime.dispatchFetch(url + '?access=' + access);
      assert.equal(denied.status, status, asset.name + ': ' + access);
      assertProtectedHeaders(denied);
      assert.match(denied.headers.get('content-type'), /^text\/plain\b/);
      const body = await denied.text();
      assert.equal(body, 'Access required', 'denied responses contain no asset bytes or private authorization errors');
      assert.ok(!body.includes(privateCanary));
      assert.notDeepEqual(Buffer.from(body), asset.bytes);
    }
    // A cached/partial request must still authorize and return the exact current
    // bytes. Run after all denials so a prior failure cannot poison this route.
    const allowed = await runtime.dispatchFetch(url + '?access=authorized', {
      headers: { 'if-none-match': '"synthetic-stale-asset"', range: 'bytes=0-9' },
    });
    assert.equal(allowed.status, 200, asset.name);
    assertProtectedHeaders(allowed);
    assert.equal(allowed.headers.get('content-type'), asset.contentType, asset.name);
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff', asset.name);
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), asset.bytes, 'authorized route must return exact managed asset bytes: ' + asset.name);
  }
  assert.equal(outboundCalls, 0, 'managed asset requests must not contact external services');
  console.log('PASS actual workerd managed assets: all three real routes return exact authorized CSS/JS bytes with correct type/no-store/noindex/nosniff; anonymous/forbidden/unexpected failures deny without asset or private-error leakage; content authorization always runs; zero external calls.');
} finally {
  await runtime?.dispose();
  rmSync(temporary, { recursive: true, force: true });
}
