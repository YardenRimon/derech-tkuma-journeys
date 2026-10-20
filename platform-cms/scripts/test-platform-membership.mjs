import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync,readFileSync } from 'node:fs';
const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const db={prepare(sql){let args=[];return{bind(...input){args=input;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return{results:sqlite.prepare(sql).all(...args),success:true};},async run(){return{success:true,meta:sqlite.prepare(sql).run(...args)};}};},async batch(statements){return Promise.all(statements.map(x=>x.run()));}};
const fixture={identity:{userId:'owner-shared-subject',email:'owner@example.invalid',displayName:'בעלים',fullName:null},env:{DB:db,CMS_ADAPTER_MODE:'isolated-d1',CMS_TENANT_ID:'derech',CMS_SITE_ID:'derech-main'}};
globalThis.__membershipFixture=fixture;
sqlite.exec("INSERT INTO cms_settings VALUES('cms_users_bootstrapped','1');INSERT INTO cms_deployment_scope VALUES(1,'derech','derech-main')");
sqlite.prepare('INSERT INTO cms_users(email,auth_user_id,cf_access_user_id,role,active,can_publish,revision,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?)').run('owner@example.invalid','sites-original','access-original','system_admin',1,0,9,'fixture','fixture');
sqlite.prepare('INSERT INTO cms_users(email,role,active,can_publish,revision,created_at,updated_at)VALUES(?,?,?,?,?,?,?)').run('editor@example.invalid','content_editor',1,0,3,'fixture','fixture');
try{
 const result=await build({entryPoints:[new URL('../lib/access.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'fixture-boundary',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/^@\/app\/chatgpt-auth$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='env'?'export const env=globalThis.__membershipFixture.env':'export const getAuthProvider=()=>"supabase";export const getChatGPTUser=async()=>globalThis.__membershipFixture.identity',loader:'js'}));}}]});
 const {authorizeCmsUser}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const user=await authorizeCmsUser('users');assert.equal(user.role,'system_admin');assert.equal(user.canPublish,true);
 let row=sqlite.prepare('SELECT * FROM cms_users WHERE email=?').get('owner@example.invalid');assert.equal(row.platform_auth_user_id,'owner-shared-subject');assert.equal(row.auth_user_id,'sites-original');assert.equal(row.cf_access_user_id,'access-original');assert.equal(row.revision,9);
 fixture.identity={...fixture.identity,userId:'different-subject-same-email'};await assert.rejects(authorizeCmsUser(),error=>error.status===403);
 fixture.identity={...fixture.identity,userId:'outsider',email:'outsider@example.invalid'};await assert.rejects(authorizeCmsUser(),error=>error.status===403);
 fixture.identity={...fixture.identity,userId:'editor-shared-subject',email:'editor@example.invalid'};assert.equal((await authorizeCmsUser()).role,'content_editor');await assert.rejects(authorizeCmsUser('users'),error=>error.status===403);await assert.rejects(authorizeCmsUser('publish'),error=>error.status===403);
 sqlite.prepare('UPDATE cms_users SET active=0 WHERE email=?').run('editor@example.invalid');await assert.rejects(authorizeCmsUser(),error=>error.status===403);
 fixture.identity={...fixture.identity,userId:'owner-shared-subject',email:'owner@example.invalid'};fixture.env.CMS_TENANT_ID='other';await assert.rejects(authorizeCmsUser(),error=>error.status===503);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cms_users').get().n,2);
 console.log('Shared identity CMS membership: independent stable subject pin, legacy pins/history retained, same-email different-subject denial, no outsider membership, editor grants, immediate revocation and tenant/site mismatch denial.');
}finally{delete globalThis.__membershipFixture;sqlite.close();}
