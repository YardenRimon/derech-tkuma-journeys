/** Full built-app rollback rehearsal. Private local fixtures only; no provider IO.
 * Usage: node scripts/verify-code-rollback.mjs /private/tmp/<prepared-directory>
 * That directory contains current/previous Git archives, completed Cloudflare
 * builds, review.json without secrets, and a privately restored fixture.json.
 */
import assert from 'node:assert/strict';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const work = resolve(process.argv[2] ?? '');
assert.ok(work.startsWith('/private/tmp/derech-full-rollback-'), 'A private rehearsal directory is mandatory');
assert.equal(statSync(work).mode & 0o077, 0, 'Private recovery directory must be owner-only');
const fixture = JSON.parse(readFileSync(join(work, 'fixture.json'))), portable = JSON.parse(readFileSync(join(work, 'review.json')));
const origin = portable.vars.PLATFORM_AUTH_ORIGIN, owner = fixture.owner;
assert.ok(owner.email && owner.platform_auth_user_id);assert.equal(portable.vars.PLATFORM_AUTH_REQUIRE_MFA, 'false');
// Fresh rehearsals declare the two independently prepared archive identities.
// Preserve the original fixture default for historical recovery evidence.
const source = fixture.sources ?? { current: 'a69b2df49df503901101252eb741fc9416da972c', previous: 'c47dde86e83892ce663cecbb15b9439c243995b5' };
assert.deepEqual(Object.keys(source).sort(), ['current','previous']);assert.ok(Object.values(source).every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const privateMarker = 'ISOLATED CODE ROLLBACK DRAFT';
const persistence = join(work, 'isolated-runtime-' + Date.now());mkdirSync(persistence, { mode: 0o700 });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
// Synthetic transport material only. The only allowed outbound response is a
// local getUser fixture whose stable subject matches the independently restored
// owner pin. No real OAuth session, cookies or provider credentials are read.
const token = encode({ alg: 'ES256', typ: 'JWT' }) + '.' + encode({ iss: 'https://uawcxvkekfqxosfblpxr.supabase.co/auth/v1', aud: 'authenticated', sub: owner.platform_auth_user_id, email: owner.email, aal: 'aal1', iat: now - 10, exp: now + 3600 }) + '.' + Buffer.from('isolated-synthetic-signature').toString('base64url');
const user = { id: owner.platform_auth_user_id, email: owner.email, email_confirmed_at: new Date((now - 60) * 1000).toISOString(), user_metadata: { full_name: 'Isolated rehearsal owner' } };
const cookie = '__Host-platform-auth=' + encodeURIComponent(JSON.stringify({ access_token: token, refresh_token: 'isolated-unused-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user }));
const records = [], publicHashes = new Map();let runtime, seeded = false, preservedHash, markerRevision, providerCalls = 0, deniedOutbound = 0;
const paths = Object.keys(JSON.parse(readFileSync(join(work, 'current/platform-cms/lib/generated-pages.json'))));assert.equal(paths.length, 37);
const tables = ['cms_deployment_scope', 'cms_settings', 'cms_users', 'cms_permission_audit', 'cms_pages', 'cms_versions', 'cms_records', 'cms_record_history', 'cms_task_mirrors', 'cms_task_commands', 'cms_task_audit', 'platform_auth_rate_limits'];
if (Object.hasOwn(fixture.tables, 'contact_rate_limits')) tables.push('contact_rate_limits');
assert.deepEqual([...tables].sort(), Object.keys(fixture.tables).sort());
const knownMigrations=['0000_many_starhawk.sql','0001_wooden_wong.sql','0002_certain_kulan_gath.sql','0003_collections.sql','0004_isolated_adapter.sql','0005_yummy_wither.sql','0006_platform_auth.sql','0008_contact_controls.sql'];
const currentMigrations=readdirSync(join(work,'current/platform-cms/drizzle')).filter(name=>name.endsWith('.sql')).sort();assert.ok([7,8].includes(currentMigrations.length));assert.deepEqual(currentMigrations,knownMigrations.slice(0,currentMigrations.length));
const isolatedScope=fixture.tables.cms_deployment_scope[0];assert.equal(isolatedScope.tenant_id,'derech');assert.equal(isolatedScope.site_id,'derech-main');
const privacyAuthorityId='10000000-0000-4000-8000-000000000005',privacyRoot='privacy/contact-erased/v1/derech/derech-main/',privacyMarkerId='20000000-0000-4000-8000-000000000006';
// Independent private R2 state is deliberately seeded outside the older CMS
// archive, then preserved across every app version and all media checks.
const privacyObjects=new Map([[privacyRoot+'authority.json',JSON.stringify({schema:1,scope:{tenantId:'derech',siteId:'derech-main'},authorityId:privacyAuthorityId})],[privacyRoot+privacyMarkerId+'.json',JSON.stringify({schema:1,scope:{tenantId:'derech',siteId:'derech-main'},key:privacyMarkerId,erasedAt:'2026-10-21T00:00:00.000Z',reason:'requested'})]]);
const privacyHash=sha(JSON.stringify([...privacyObjects]));
async function state(db) {
  const content = {};
  for (const name of [...tables, 'sqlite_sequence']) content[name] = (await db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()).results;
  return { hash: sha(JSON.stringify(content)), rows: tables.filter(name => name.startsWith('cms_')).reduce((sum, name) => sum + content[name].length, 0), pin: content.cms_users.find(row => row.email === owner.email)?.platform_auth_user_id };
}
async function start(label) {
  const project = join(work, label, 'platform-cms'), manifest = JSON.parse(readFileSync(join(project, 'public-assets-manifest.json')));
  assert.equal(manifest.files.length, 982);
  for (const asset of manifest.files) assert.equal(sha(readFileSync(join(project, 'public', asset.path))), asset.sha256, 'Frozen source asset changed');
  const migrationFiles = readdirSync(join(project, 'drizzle')).filter(name => name.endsWith('.sql')).sort();assert.ok(migrationFiles.length>=7&&migrationFiles.length<=currentMigrations.length);assert.deepEqual(migrationFiles,currentMigrations.slice(0,migrationFiles.length),'Rollback must use the reviewed immutable migration prefix');
  for (const name of migrationFiles) assert.equal(sha(readFileSync(join(project, 'drizzle', name))), sha(readFileSync(join(work, 'current/platform-cms/drizzle', name))), 'Rollback schema differs');
  const built = JSON.parse(readFileSync(join(project, 'dist/server/wrangler.json')));
  const server = join(project, 'dist/server'), moduleFiles = readdirSync(server, { recursive: true }).filter(name => name.endsWith('.js') && name !== 'index.js').sort();
  runtime = new Miniflare({ host: '127.0.0.1', port: 0, log: new Log(LogLevel.ERROR),
    modules: ['index.js', ...moduleFiles].map(name => ({ type: 'ESModule', path: join(server, name) })), modulesRoot: server,
    compatibilityDate: built.compatibility_date ?? '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'isolated-code-rollback-cms' }, d1Persist: join(persistence, 'd1'),
    r2Buckets: { BUCKET: 'isolated-code-rollback-media' }, r2Persist: join(persistence, 'r2'),
    assets: { directory: join(project, 'dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
    bindings: { ...portable.vars, CONTACT_PRIVACY_AUTHORITY_ID:privacyAuthorityId, PLATFORM_RELEASE_SHA: source[label], PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_isolated_rehearsal_only' },
    outboundService: async request => {
      const target = new URL(request.url);
      if (request.method === 'GET' && target.href === 'https://uawcxvkekfqxosfblpxr.supabase.co/auth/v1/user' && request.headers.get('authorization') === 'Bearer ' + token) { providerCalls++;return Response.json(user); }
      deniedOutbound++;return new Response('Outbound denied in isolated rehearsal', { status: 502 });
    },
  });
  const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('BUCKET');
  if (!seeded) {
    for (const schema of fixture.schema) if (schema.sql) await db.prepare(schema.sql).run();
    for (const name of tables) for (const row of fixture.tables[name]) { const fields = Object.keys(row);await db.prepare('INSERT INTO ' + name + '(' + fields.join(',') + ') VALUES(' + fields.map(() => '?').join(',') + ')').bind(...fields.map(field => row[field])).run(); }
    await db.prepare('DELETE FROM sqlite_sequence').run();for (const row of fixture.sequence) await db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').bind(row.name, row.seq).run();
    for (const key of readdirSync(fixture.mediaDirectory)) await bucket.put(key, readFileSync(join(fixture.mediaDirectory, key)), { httpMetadata: { contentType: 'image/webp' } });
    assert.equal((await state(db)).rows, fixture.expectedCmsRows??110);for(const [key,value]of privacyObjects)await bucket.put(key,value,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}});seeded = true;
  }
  return { db, bucket };
}
async function request(path, authenticated = true, options = {}) {
  return runtime.dispatchFetch(origin + path, { ...options, redirect: 'manual', headers: { ...(authenticated ? { cookie } : {}), ...options.headers } });
}
async function json(path, options) { const response = await request(path, true, options);assert.equal(response.status, 200, 'Protected JSON endpoint failed');return response.json(); }
try {
  for (const [index, label] of ['current', 'previous', 'current'].entries()) {
    const { db, bucket } = await start(label);
    if (preservedHash) assert.equal((await state(db)).hash, preservedHash, 'Code switch reset or altered persisted state');
    for (const path of paths) {
      const response = await request(encodeURI(path), false);assert.equal(response.status, 200, 'Public page unavailable');assert.match(response.headers.get('x-robots-tag'), /noindex/);assert.equal(response.headers.get('x-derech-release'), source[label]);
      const html = await response.text();assert.match(html, /<meta name="robots" content="noindex/);assert.ok(!html.includes(privateMarker));const digest = sha(html);
      if (publicHashes.has(path)) assert.equal(digest, publicHashes.get(path), 'Public rendering changed through code rollback');else publicHashes.set(path, digest);
    }
    const denied = await request('/admin/', false, { headers: { 'x-platform-authenticated-id': 'forged', 'x-platform-authenticated-aal': 'aal2', 'oai-authenticated-user-email': owner.email } });assert.equal(denied.status, 302);assert.match(denied.headers.get('location'), /^\/login\//);await denied.body?.cancel();
    for (const path of ['/admin/', '/admin/collections/', '/admin/tasks/', '/admin/reports/', '/admin/execution/', '/admin/users/']) { const response = await request(path);assert.equal(response.status, 200, 'Protected owner page unavailable');assert.match(response.headers.get('x-robots-tag'), /noindex/);const html = await response.text();assert.match(html, /<h1\b/);assert.match(html, /admin\.css/); }
    const css = await request('/admin.css');assert.equal(css.status, 200);assert.match(css.headers.get('content-type'), /text\/css/);await css.body?.cancel();
    const users = await json('/api/users/');assert.equal(users.currentEmail, owner.email);assert.ok(users.users.some(row => row.email === owner.email && row.active && row.role === 'system_admin'));
    let page = await json('/api/cms/page/?slug=%2F');
    if (index === 0) {
      const field = Object.keys(page.base.fields).find(id => page.base.fields[id].type === 'text');assert.ok(field);const draft = structuredClone(page.draft);draft.fields[field] = { value: privateMarker };
      const saved = await json('/api/cms/save/', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ slug: '/', revision: page.revision, draft }) });markerRevision = saved.revision;page = await json('/api/cms/page/?slug=%2F');
    }
    assert.equal(page.revision, markerRevision);assert.ok(JSON.stringify(page.draft).includes(privateMarker), 'Synthetic current draft vanished during rollback');
    for (const key of readdirSync(fixture.mediaDirectory)) { const expected = readFileSync(join(fixture.mediaDirectory, key)), response = await request('/media/' + key + '/', false);assert.equal(response.status, 200);assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(expected));assert.equal((await bucket.head(key)).size, 15800); }
    const proof = await state(db);assert.equal(proof.pin, owner.platform_auth_user_id);assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_auth_rate_limits').first()).n, 0);
    const privateRows=[];for(const [key,value]of privacyObjects){const stored=await bucket.get(key);assert.ok(stored,'Independent privacy authority/marker disappeared');assert.equal(await stored.text(),value,'Code/media rollback overwrote independent erasure authority');privateRows.push([key,value]);const privatePath='/media/'+encodeURIComponent(key)+'/';let denied=await request(privatePath,false);if(denied.status===308){const target=new URL(denied.headers.get('location'),origin);assert.equal(target.origin,origin,'Normalization must stay on the review origin');assert.equal(decodeURIComponent(target.pathname),'/media/'+key,'Normalization must preserve the private key and remove the file trailing slash');await denied.body?.cancel();denied=await request(target.pathname,false);}assert.equal(denied.status,404,'Private authority must not be exposed as media');await denied.body?.cancel();}assert.equal(sha(JSON.stringify(privateRows)),privacyHash);
    if(tables.includes('contact_rate_limits'))assert.equal((await db.prepare('SELECT count(*) AS n FROM contact_rate_limits').first()).n,0,'Transient contact counters must restore empty');
    if (preservedHash) assert.equal(proof.hash, preservedHash, 'Protected application checks changed restored data');else preservedHash = proof.hash;
    records.push({ phase: index + 1, source: source[label], fullApplicationWorker: true, publicRoutes: paths.length, protectedOwnerPages: 6, frozenAssets: 982, cmsRows: proof.rows, dataSha256: proof.hash, syntheticDraftRevision: markerRevision, ownerPinPreserved: true, mediaBytes: 15800, transientRateCounters: 0, contactTransientCounters:tables.includes('contact_rate_limits')?0:null, independentPrivacyObjects:privacyObjects.size, independentPrivacySha256:privacyHash });
    await runtime.dispose();runtime = undefined;
  }
  assert.equal(deniedOutbound, 0, 'Application attempted unexpected outbound traffic');
  const proof = { passed: true, kind: 'isolated-full-application-code-rollback', privateWork: work, privatePersistence: persistence, restoredSnapshotSha256: fixture.snapshotSha256, phases: records, providerCalls, deniedOutbound, syntheticIdentityTransport: true, liveProviderRollbackPerformed: false, liveDatabaseAttached: false, sourceAssetsChanged: false };
  writeFileSync(join(work, 'rollback-proof.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });console.log(JSON.stringify(proof));
} finally { if (runtime) await runtime.dispose(); }
