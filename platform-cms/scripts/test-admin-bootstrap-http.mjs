import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const origin='http://127.0.0.1:5174';
async function login(handle=''){const r=await fetch(origin+'/signin-with-chatgpt?return_to=%2Fadmin'+(handle?'&test_user='+handle:''),{redirect:'manual'});assert.equal(r.status,302);return r.headers.get('set-cookie').split(';')[0];}
const get=(path,cookie,headers={})=>fetch(origin+path,{headers:{cookie,...headers}});
const owner=await login();let response=await get('/api/users',owner);assert.equal(response.status,200);const {users}=await response.json();
assert.equal(users.filter(x=>x.email==='admin2@sites.test').length,1,'config addresses must dedupe');
assert.equal(users.find(x=>x.email==='admin2@sites.test').role,'system_admin','configured admin must override editor overlap');
assert.equal(users.find(x=>x.email==='editor@sites.test').role,'content_editor');assert.equal(users.length,3,'invalid config must not grant access');
// The admin row is initially unbound. An authenticated outsider cannot claim it using headers.
const outsider=await login('outsider');assert.equal((await get('/api/users',outsider,{'oai-authenticated-user-id':'local_admin2','oai-authenticated-user-email':'admin2@sites.test'})).status,403);
const admin=await login('admin2');response=await get('/api/cms/page?slug=/',admin);assert.equal(response.status,200);const adminPage=await response.json();assert.equal(adminPage.permissions.role,'system_admin');assert.equal(adminPage.permissions.canPublish,true);assert.equal((await get('/api/users',admin)).status,200);
// The same verified email with a different stable subject cannot take over the pinned row.
const replacement=await login('admin_replacement');assert.equal((await get('/api/users',replacement)).status,403);
assert.equal((await get('/api/users',admin)).status,200,'original subject remains valid');
const editor=await login('editor');response=await get('/api/cms/page?slug=/',editor);assert.equal(response.status,200);assert.equal((await response.json()).permissions.canPublish,false);assert.equal((await get('/api/users',editor)).status,403);
response=await fetch(origin+'/api/cms/publish',{method:'POST',headers:{cookie:editor,origin,'content-type':'application/json'},body:JSON.stringify({slug:'/',revision:0})});assert.equal(response.status,403);
// Exercise the actual Vinext/RSC HTTP pipeline: direct-handler bundles do not
// catch the CSS transform mistaking an uppercase GET declaration for a component.
const shell=await get('/admin/',owner);assert.equal(shell.status,200);
assert.match(await shell.text(),/<link\b[^>]*rel="stylesheet"[^>]*href="\/admin\/runtime\/admin\.css"/);
const css=await get('/admin/runtime/admin.css',owner,{accept:'text/css,*/*;q=0.1','sec-fetch-dest':'style'});
assert.equal(css.status,200,'protected CSS must remain a real HTTP Response after RSC transforms');
assert.equal(css.headers.get('content-type'),'text/css; charset=utf-8');
assert.equal(css.headers.get('cache-control'),'private, no-store');
assert.equal(css.headers.get('x-robots-tag'),'noindex, nofollow');
assert.equal(css.headers.get('x-content-type-options'),'nosniff');
assert.deepEqual(Buffer.from(await css.arrayBuffer()),readFileSync(new URL('../managed-assets/admin.css',import.meta.url)),'the shell must receive exact managed CSS bytes');
const anonymousCss=await fetch(origin+'/admin/runtime/admin.css',{headers:{accept:'text/css','sec-fetch-dest':'style'},redirect:'manual'});
assert.equal(anonymousCss.status,401,'anonymous CSS request must be denied after RSC transforms');
assert.equal(anonymousCss.headers.get('cache-control'),'private, no-store');
assert.equal(anonymousCss.headers.get('x-robots-tag'),'noindex, nofollow');
assert.equal(await anonymousCss.text(),'Access required','denied CSS must not expose asset bytes');
console.log('PASS bootstrap HTTP: normalized/deduped explicit admin config, editor/admin separation, outsider+spoofed headers cannot bind admin, correct verified subject binds unpinned row, replacement subject rejected, original remains valid, editor publish denied, actual Vinext CSS exact bytes/MIME/security headers and anonymous denial');
