/** Full built-app rollback rehearsal. Private local fixtures only; no provider IO.
 * Usage: node scripts/verify-code-rollback.mjs /private/tmp/<prepared-directory>
 * That directory contains current/previous Git archives, completed Cloudflare
 * builds, review.json without secrets, and a privately restored fixture.json.
 * fixture.mediaObjects must be the original snapshot.media rows (HTTP/custom
 * metadata plus verified body SHA256 or original simple R2 ETag).
 * For current51 -> previous37: copy ONLY the current763 namespaced assets into
 * previous/public BEFORE building previous. Both archive PUBLIC and dist/client
 * hashes, compiled publicFiles inventory and actual HTTP responses are checked;
 * adding files to dist/client after an older build is explicitly insufficient.
 */
import assert from 'node:assert/strict';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const wire=value=>JSON.parse(JSON.stringify(value??{}));
const mediaUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const publicMediaTypes=new Set(['image/png','image/jpeg','image/webp']);
function safeRelative(value){assert.equal(typeof value,'string');assert.ok(value&&!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..'));return value;}
function checkedFile(base,relative){const path=join(base,safeRelative(relative));assert.ok(!lstatSync(base).isSymbolicLink());let cursor=base;for(const part of relative.split('/')){cursor=join(cursor,part);assert.ok(!lstatSync(cursor).isSymbolicLink(),'Fixture/asset symlinks prohibited');}assert.ok(statSync(path).isFile());return path;}
export function restoredMediaRows(fixture){
 const rows=fixture.mediaObjects??fixture.media;assert.ok(Array.isArray(rows),'Original snapshot.media metadata is mandatory; never infer an image MIME type');
 const keys=new Set();const result=rows.map(row=>{
  assert.ok(row&&mediaUuid.test(row.key)&&!keys.has(row.key));keys.add(row.key);
  assert.ok(Number.isSafeInteger(row.size)&&row.size>=0&&row.httpMetadata&&typeof row.httpMetadata==='object'&&!Array.isArray(row.httpMetadata)&&row.customMetadata&&typeof row.customMetadata==='object'&&!Array.isArray(row.customMetadata));
  const bytes=readFileSync(checkedFile(fixture.mediaDirectory,row.key));assert.equal(bytes.length,row.size);
  if(row.sha256)assert.equal(sha(bytes),row.sha256);else{assert.match(row.etag,/^[a-f0-9]{32}$/,'A media SHA256 or simple original ETag is mandatory');assert.equal(createHash('md5').update(bytes).digest('hex'),row.etag,'Recovered media does not match original R2 ETag');}
  return {...row,httpMetadata:wire(row.httpMetadata),customMetadata:wire(row.customMetadata),sha256:sha(bytes),public:publicMediaTypes.has(row.httpMetadata.contentType)};
 });
 assert.deepEqual(readdirSync(fixture.mediaDirectory).sort(),[...keys].sort(),'Missing/extra recovered media file');return result;
}
export function mediaPutOptions(row){const httpMetadata=wire(row.httpMetadata);if(httpMetadata.cacheExpiry!==undefined){assert.equal(typeof httpMetadata.cacheExpiry,'string');httpMetadata.cacheExpiry=new Date(httpMetadata.cacheExpiry);assert.ok(Number.isFinite(httpMetadata.cacheExpiry.getTime()));}return {httpMetadata,customMetadata:wire(row.customMetadata)};}
export function phaseRouteInventory(project){
 const pages=JSON.parse(readFileSync(join(project,'lib/generated-pages.json'))),provenance=JSON.parse(readFileSync(join(project,'source-pages/provenance.json'))),paths=Object.keys(pages).sort();
 if(paths.length===51){assert.equal(provenance.snapshotId,'wordpress-public-20261028');assert.equal(provenance.logicalPageCount,51);}else{assert.equal(paths.length,37);assert.equal(provenance.logicalPageCount,37);assert.ok(!provenance.snapshotId);}
 return {paths,count:paths.length,sha256:sha(canonical(paths)),snapshotId:provenance.snapshotId??'historical-37-pages'};
}
/** Read the actual compiled framework's publicFiles Set without executing JS.
 * This proves an older build knew the supplemental paths before compilation. */
export function bakedPublicFiles(javascript){
 const identifiers=[...javascript.matchAll(/\bpublicFiles:\s*([A-Za-z_$][\w$]*)(?=[,}])/g)].map(match=>match[1]);
 for(const id of identifiers){
  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const initial=new RegExp('\\b'+escaped+'\\s*=\\s*new Set\\(').exec(javascript);
  const match=initial?/^`((?:\\.|[^`])*)`\.split\((["'`]),\2\)\)/.exec(javascript.slice(initial.index+initial[0].length)):null;
  if(match){assert.ok(!match[1].includes('${'),'Dynamic public inventory requires a reviewed parser');const decoded=match[1].replace(/\\u\{([a-fA-F0-9]+)\}|\\u([a-fA-F0-9]{4})|\\x([a-fA-F0-9]{2})|\\([\\`$])/g,(_all,wide,unit,hex,literal)=>literal??String.fromCodePoint(parseInt(wide??unit??hex,16)));return new Set(decoded.split(',').map(path=>decodeURIComponent(path)));}
 }
 throw new Error('Compiled publicFiles inventory not found; supplemental assets must be overlaid into PUBLIC before the older build');
}
export function supplementalAssetPlan(current,previous){
 const manifestFile=join(current,'source-snapshot-assets-manifest.json'),mapFile=join(current,'source-pages/asset-map.json');
 const manifestBytes=readFileSync(manifestFile),manifest=JSON.parse(manifestBytes),mapBytes=readFileSync(mapFile),map=JSON.parse(mapBytes);
 assert.equal(map.manifestSha256,sha(manifestBytes));assert.equal(manifest.snapshotId,'wordpress-public-20261028');assert.equal(manifest.namespace,'/__source_assets__/wordpress-public-20261028/');assert.equal(manifest.files.length,763);
 const rows=new Map();for(const row of manifest.files){safeRelative(row.path);assert.ok(row.path.startsWith(manifest.namespace.slice(1))&&!rows.has(row.path));assert.match(row.transformedSha256,/^[a-f0-9]{64}$/);rows.set(row.path,row);}
 for(const target of Object.values(map.paths)){const path=target.replace(/^\//,'');assert.ok(rows.has(path),'Alias target absent from supplemental manifest');}
 const proofs={};
 for(const [label,project]of [['current',current],['previous',previous]]){
  const server=join(project,'dist/server');let inventory;for(const name of readdirSync(server,{recursive:true}).filter(name=>name.endsWith('.js'))){const script=readFileSync(join(server,name),'utf8');if(!/publicFiles:\s*[A-Za-z_$][\w$]*(?=[,}])/.test(script))continue;try{const candidate=bakedPublicFiles(script);if([...rows.keys()].every(path=>candidate.has('/'+path))){inventory=candidate;break;}}catch{}}
  assert.ok(inventory,'Missing baked supplemental publicFiles inventory: '+label+'; copy763 into old PUBLIC BEFORE rebuilding');
  for(const row of rows.values())for(const directory of ['public','dist/client']){const bytes=readFileSync(checkedFile(join(project,directory),row.path));assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.transformedSha256,'Supplemental bytes differ: '+label+'/'+directory);}
  proofs[label]={files:rows.size,publicAndDistHashesVerified:true,bakedPublicInventoryVerified:true,inventorySha256:sha(canonical([...inventory].sort()))};
 }
 return {rows:[...rows.values()],namespace:manifest.namespace,snapshotId:manifest.snapshotId,manifestSha256:sha(manifestBytes),mapSha256:sha(mapBytes),builds:proofs};
}

async function main(){

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
const inventories=Object.fromEntries(['current','previous'].map(label=>[label,phaseRouteInventory(join(work,label,'platform-cms'))]));
if(inventories.current.count===51)assert.equal(inventories.previous.count,37,'This source transition must rehearse the older37page app');
const supplemental=inventories.current.count===51?supplementalAssetPlan(join(work,'current/platform-cms'),join(work,'previous/platform-cms')):null;
const mediaRows=restoredMediaRows(fixture);
const deniedMedia=[{key:'00000000-0000-4000-8000-000000000071',bytes:Buffer.from('PRIVATE OCTET REHEARSAL'),httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'},customMetadata:{classification:'private'}},{key:'00000000-0000-4000-8000-000000000072',bytes:Buffer.from('UNTYPED PRIVATE REHEARSAL'),httpMetadata:{cacheControl:'private, no-store'},customMetadata:{classification:'private'}}];
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
    for(const row of mediaRows)await bucket.put(row.key,readFileSync(join(fixture.mediaDirectory,row.key)),mediaPutOptions(row));
    for(const row of deniedMedia){assert.equal(await bucket.head(row.key),null,'Synthetic denial key collides with restored object');await bucket.put(row.key,row.bytes,mediaPutOptions(row));}
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
    const paths=inventories[label].paths;
    for (const path of paths) {
      const response = await request(encodeURI(path), false);assert.equal(response.status, 200, 'Public page unavailable');assert.match(response.headers.get('x-robots-tag'), /noindex/);assert.equal(response.headers.get('x-derech-release'), source[label]);
      const html = await response.text();assert.match(html, /<meta name="robots" content="noindex/);assert.ok(!html.includes(privateMarker));const digest = sha(html);
      const phaseKey=source[label]+':'+path;if(publicHashes.has(phaseKey))assert.equal(digest,publicHashes.get(phaseKey),'Returning to identical code changed public rendering');else publicHashes.set(phaseKey,digest);
    }
    const denied = await request('/admin/', false, { headers: { 'x-platform-authenticated-id': 'forged', 'x-platform-authenticated-aal': 'aal2', 'oai-authenticated-user-email': owner.email } });assert.equal(denied.status, 302);assert.match(denied.headers.get('location'), /^\/login\//);await denied.body?.cancel();
    for (const path of ['/admin/', '/admin/collections/', '/admin/tasks/', '/admin/reports/', '/admin/execution/', '/admin/users/']) { const response = await request(path);assert.equal(response.status, 200, 'Protected owner page unavailable');assert.match(response.headers.get('x-robots-tag'), /noindex/);const html = await response.text();assert.match(html, /<h1\b/);assert.match(html, /admin\.css/); }
    const css = await request(label==='current'&&inventories.current.count===51?'/admin/runtime/admin.css':'/admin.css');assert.equal(css.status, 200);assert.match(css.headers.get('content-type'), /text\/css/);await css.body?.cancel();
    const users = await json('/api/users/');assert.equal(users.currentEmail, owner.email);assert.ok(users.users.some(row => row.email === owner.email && row.active && row.role === 'system_admin'));
    let page = await json('/api/cms/page/?slug=%2F');
    if (index === 0) {
      const field = Object.keys(page.base.fields).find(id => page.base.fields[id].type === 'text');assert.ok(field);const draft = structuredClone(page.draft);draft.fields[field] = { value: privateMarker };
      const saved = await json('/api/cms/save/', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ slug: '/', revision: page.revision, draft }) });markerRevision = saved.revision;page = await json('/api/cms/page/?slug=%2F');
      if(supplemental){const asset=supplemental.rows.find(row=>/\.(?:png|jpe?g|webp)$/.test(row.path));assert.ok(asset);await json('/api/collections/tour/',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({operation:'save',id:'isolated-source-assets-rollback',expectedRevision:0,content:{title:privateMarker,slug:'isolated-source-assets-rollback',description:'',image:encodeURI('/'+asset.path),imageAlt:'Synthetic private rollback asset'}})}); }
    }
    assert.equal(page.revision, markerRevision);const storedDraft=await db.prepare("SELECT draft_json FROM cms_pages WHERE slug='/'").first();assert.ok(storedDraft&&storedDraft.draft_json.includes(privateMarker),'Persisted synthetic current draft vanished during rollback');if(label==='current')assert.ok(JSON.stringify(page.draft).includes(privateMarker),'Returning current editor lost its draft');
    for(const row of mediaRows){const head=await bucket.head(row.key);assert.ok(head);assert.equal(head.size,row.size);assert.equal(canonical(wire(head.httpMetadata)),canonical(row.httpMetadata),'Recovered HTTP metadata changed');assert.equal(canonical(wire(head.customMetadata)),canonical(row.customMetadata),'Recovered custom metadata changed');const response=await request('/media/'+row.key+'/',false);assert.equal(response.status,row.public?200:404,'Original media visibility changed');if(row.public){assert.equal(response.headers.get('content-type'),row.httpMetadata.contentType);assert.equal(sha(Buffer.from(await response.arrayBuffer())),row.sha256);}else await response.body?.cancel();}
    for(const row of deniedMedia){const object=await bucket.get(row.key);assert.ok(object);assert.equal(sha(Buffer.from(await object.arrayBuffer())),sha(row.bytes));assert.equal(canonical(wire(object.httpMetadata)),canonical(row.httpMetadata));assert.equal(canonical(wire(object.customMetadata)),canonical(row.customMetadata));const denied=await request('/media/'+row.key+'/',false);assert.equal(denied.status,404,'Private/octet media became public after a code switch');await denied.body?.cancel();}
    const namespaceReferences=[];if(supplemental){
     for(const row of supplemental.rows){const response=await request(encodeURI('/'+row.path),false);assert.equal(response.status,200,'Supplemental asset unavailable in '+label);assert.equal(sha(Buffer.from(await response.arrayBuffer())),row.transformedSha256,'Supplemental HTTP bytes changed');}
     const rawState=JSON.stringify(fixture.tables)+' '+JSON.stringify((await db.prepare('SELECT record_json FROM cms_records').all()).results)+' '+JSON.stringify((await db.prepare('SELECT draft_json FROM cms_pages').all()).results);
     for(const match of rawState.matchAll(/\/__source_assets__\/wordpress-public-20261028\/[^\s"'<>\\]+/g)){const uri=match[0],parsed=new URL(uri,origin),path=decodeURIComponent(parsed.pathname).replace(/^\//,'');const row=supplemental.rows.find(row=>row.path===path);assert.ok(row,'Persisted namespace URL has no supplemental source asset');namespaceReferences.push(uri);const response=await request(parsed.pathname+parsed.search,false);assert.equal(response.status,200,'Persisted namespace URL did not survive older code');assert.equal(sha(Buffer.from(await response.arrayBuffer())),row.transformedSha256);}
     assert.ok(namespaceReferences.length,'Compatibility proof requires at least one persisted new namespace URL');
    }
    const proof = await state(db);assert.equal(proof.pin, owner.platform_auth_user_id);assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_auth_rate_limits').first()).n, 0);
    const privateRows=[];for(const [key,value]of privacyObjects){const stored=await bucket.get(key);assert.ok(stored,'Independent privacy authority/marker disappeared');assert.equal(await stored.text(),value,'Code/media rollback overwrote independent erasure authority');privateRows.push([key,value]);const privatePath='/media/'+encodeURIComponent(key)+'/';let denied=await request(privatePath,false);if(denied.status===308){const target=new URL(denied.headers.get('location'),origin);assert.equal(target.origin,origin,'Normalization must stay on the review origin');assert.equal(decodeURIComponent(target.pathname),'/media/'+key,'Normalization must preserve the private key and remove the file trailing slash');await denied.body?.cancel();denied=await request(target.pathname,false);}assert.equal(denied.status,404,'Private authority must not be exposed as media');await denied.body?.cancel();}assert.equal(sha(JSON.stringify(privateRows)),privacyHash);
    if(tables.includes('contact_rate_limits'))assert.equal((await db.prepare('SELECT count(*) AS n FROM contact_rate_limits').first()).n,0,'Transient contact counters must restore empty');
    if (preservedHash) assert.equal(proof.hash, preservedHash, 'Protected application checks changed restored data');else preservedHash = proof.hash;
    records.push({ phase: index + 1, source: source[label], fullApplicationWorker: true, publicRoutes: paths.length, routeInventorySha256:inventories[label].sha256, sourceSnapshotId:inventories[label].snapshotId, protectedOwnerPages: 6, frozenAssets: 982, cmsRows: proof.rows, dataSha256: proof.hash, syntheticDraftRevision: markerRevision, ownerPinPreserved: true, mediaObjects:mediaRows.length,mediaBytes:mediaRows.reduce((sum,row)=>sum+row.size,0),mediaMetadataSha256:sha(canonical(mediaRows.map(({key,httpMetadata,customMetadata,sha256,size})=>({key,httpMetadata,customMetadata,sha256,size})))),privateOctetMediaDenied:deniedMedia.length+mediaRows.filter(row=>!row.public).length,supplementalAssets:supplemental?{files:supplemental.rows.length,manifestSha256:supplemental.manifestSha256,mapSha256:supplemental.mapSha256,bakedPublicInventoryVerified:true,persistedNamespaceReferences:namespaceReferences.length}:null, transientRateCounters: 0, contactTransientCounters:tables.includes('contact_rate_limits')?0:null, independentPrivacyObjects:privacyObjects.size, independentPrivacySha256:privacyHash });
    await runtime.dispose();runtime = undefined;
  }
  assert.equal(deniedOutbound, 0, 'Application attempted unexpected outbound traffic');
  const proof = { passed: true, kind: 'isolated-full-application-code-rollback', privateWork: work, privatePersistence: persistence, restoredSnapshotSha256: fixture.snapshotSha256, phases: records, providerCalls, deniedOutbound, syntheticIdentityTransport: true, liveProviderRollbackPerformed: false, liveDatabaseAttached: false, sourceAssetsChanged: false, supplementalCompatibility:supplemental?{requiredForOlderCode:true,overlayNamespace:supplemental.namespace,files:supplemental.rows.length,manifestSha256:supplemental.manifestSha256,mapSha256:supplemental.mapSha256,preBuildInventoryProof:supplemental.builds,persistedNamespaceUrlsVerifiedAcrossAllVersions:true}:null };
  writeFileSync(join(work, 'rollback-proof.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });console.log(JSON.stringify(proof));
} finally { if (runtime) await runtime.dispose(); }

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
