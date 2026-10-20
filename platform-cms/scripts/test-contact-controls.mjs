/** Real SQLite, actual route functions and a loopback HTTP provider fixture.
 * No credentials, external requests, live leads, DNS or provider settings. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {contactPrivacyBucket,fixtureContactPrivacyAuthority} from './contact-privacy-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({stdin:{contents:`export * from './lib/contact-core';export * from './lib/contact-d1';export * from './lib/contact-controls';export * from './lib/contact-delivery';export * from './lib/contact-privacy';export * from './lib/contact-maintenance';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent'});
const {Contacts,D1Contacts,contactIngress,contactRetentionDays,deliverContact,verifiedMakeContract,R2ContactPrivacy,contactPrivacyKey,maintainContacts,reconcileContactRestore,initializeContactPrivacyAuthority,parseContactPrivacyKey}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sqlite=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const db={prepare(sql){const statement=sqlite.prepare(sql);return{args:[],bind(...args){this.args=args;return this;},async first(){return statement.get(...this.args)??null;},async all(){return{results:statement.all(...this.args)};},async run(){return{success:true,meta:{changes:Number(statement.run(...this.args).changes)}};}};},async batch(statements){const out=[];sqlite.exec('BEGIN');try{for(const s of statements)out.push(await s.all());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const scope={tenantId:'derech',siteId:'derech-main'},other={tenantId:'other',siteId:'other-main'};
const bucket=contactPrivacyBucket(),privacy=new R2ContactPrivacy(bucket,fixtureContactPrivacyAuthority);
const store=new D1Contacts(db),service=new Contacts(store,30,privacy),now=new Date('2026-10-20T12:00:00Z');
const input=(key=crypto.randomUUID())=>({idempotencyKey:key,formId:'0899899',fullName:'שם בדיקה סינתטי',phone:'0501234567',email:'synthetic@example.test',consent:{contact:true,policyVersion:'source-2026-10-19'},honeypot:''});
const request=(ip='192.0.2.20')=>new Request('https://derech-tkuma.com/api/contact/',{headers:{'cf-connecting-ip':ip,'x-forwarded-for':'198.51.100.9'}});
const leadCount=()=>sqlite.prepare("SELECT count(*) n FROM cms_settings WHERE key LIKE 'contact:v1:%' AND json_extract(value,'$.schema')=1").get().n;
for(const value of [undefined,'','0','-1','30days','01','3651'])assert.throws(()=>contactRetentionDays({CONTACT_RETENTION_DAYS:value}),/retention_unconfigured/);
assert.equal(contactRetentionDays({CONTACT_RETENTION_DAYS:'30'}),30);
await assert.rejects(contactIngress(db,scope,new Request('https://derech-tkuma.com/api/contact/'),now.getTime()),/contact_unavailable/);
// A quota failure must happen before INSERT; equal UUID replay skips new quotas.
const first=input();let reserve=await contactIngress(db,scope,request(),now.getTime());const receipt=await service.submit(scope,first,now,reserve);
for(let i=1;i<5;i++){reserve=await contactIngress(db,scope,request(),now.getTime());await service.submit(scope,input(),now,reserve);}
reserve=await contactIngress(db,scope,request(),now.getTime());await assert.rejects(service.submit(scope,input(),now,reserve),e=>e.status===429);assert.equal(leadCount(),5);
reserve=await contactIngress(db,scope,request(),now.getTime());assert.deepEqual(await service.submit(scope,first,now,reserve),receipt,'lost-response replay survives new-lead quota');
const shared=await contactIngress(db,other,request(),now.getTime());await new Contacts(store,30,privacy).submit(other,input(),now,shared);assert.equal(leadCount(),6,'tenant buckets do not collide');
const counterText=JSON.stringify(sqlite.prepare('SELECT * FROM contact_rate_limits').all());for(const raw of ['192.0.2.20','synthetic@example.test','0501234567','שם בדיקה'])assert.ok(!counterText.includes(raw));
for(let i=0;i<30;i++)await contactIngress(db,scope,request('192.0.2.30'),now.getTime());
await assert.rejects(contactIngress(db,scope,request('192.0.2.30'),now.getTime()),e=>e.status===429);
await contactIngress(db,scope,request('192.0.2.30'),now.getTime()+61000);
// Atomic counters under concurrent requests permit exactly five new leads.
const reservations=await Promise.all(Array.from({length:12},()=>contactIngress(db,scope,request('192.0.2.40'),now.getTime())));
const attempts=await Promise.allSettled(reservations.map(reserve=>service.submit(scope,input(),now,reserve)));
assert.equal(attempts.filter(x=>x.status==='fulfilled').length,5);assert.equal(attempts.filter(x=>x.status==='rejected').length,7);
// Expiry strips PII/fingerprints/tokens; tombstones survive retries and claims.
const expiredInput=input();await service.submit(scope,expiredInput,new Date(now.getTime()-31*86400000));
const freshInput=input();await service.submit(scope,freshInput,now);
const report=await service.expire(scope,100,now);assert.equal(report.erased,1);
const erased=await store.get(scope,expiredInput.idempotencyKey);assert.equal(erased.schema,2);
for(const field of ['fields','consent','fingerprint','receipt','outbox','retention'])assert.ok(!(field in erased));
await assert.rejects(service.submit(scope,expiredInput,now),e=>e.status===410);assert.equal((await store.get(scope,freshInput.idempotencyKey)).schema,1);
const old=await store.get(scope,first.idempotencyKey);await assert.rejects(service.erase(scope,first.idempotencyKey,old.revision+1,'requested',now),e=>e.status===409);
await service.erase(scope,first.idempotencyKey,old.revision,'requested',now,'owner-subject');
await assert.rejects(service.submit(scope,first,now),e=>e.status===410);
assert.equal((await service.expire(other,100,now)).erased,0,'maintenance is tenant/site scoped');
// Current policy can shorten retention; it cannot extend a stored expiry.
const short=new Contacts(store,1,privacy);await assert.rejects(short.read(scope,freshInput.idempotencyKey,new Date(now.getTime()+2*86400000)),e=>e.status===410);
const later=input();await service.submit(scope,later,now);const longer=new Contacts(store,90,privacy);await assert.rejects(longer.read(scope,later.idempotencyKey,new Date(now.getTime()+31*86400000)),e=>e.status===410);
// At-action SQL authorization and durable access audit before any PII return.
sqlite.prepare("INSERT INTO cms_users(email,role,active,can_publish,revision,created_at,updated_at,platform_auth_user_id) VALUES(?, 'system_admin',1,0,1,?,?,?)").run('owner@example.test',now.toISOString(),now.toISOString(),'owner-subject');
const admin={email:'owner@example.test',userId:'owner-subject',identityColumn:'platform_auth_user_id'},managed=new Contacts(new D1Contacts(db,admin),30,privacy),privateInput=input();await service.submit(scope,privateInput,now);
assert.equal((await managed.read(scope,privateInput.idempotencyKey,now)).fields.email,privateInput.email);
const audit=sqlite.prepare("SELECT value FROM cms_settings WHERE key LIKE 'contact-audit:v1:%'").all();assert.equal(audit.length,1);assert.ok(!audit[0].value.includes(privateInput.email));
sqlite.prepare('UPDATE cms_users SET active=0 WHERE email=?').run(admin.email);
await assert.rejects(managed.read(scope,privateInput.idempotencyKey,now),e=>e.status===404);
await assert.rejects(managed.erase(scope,privateInput.idempotencyKey,1,'requested',now),e=>e.status===404);assert.equal((await store.get(scope,privateInput.idempotencyKey)).schema,1);
sqlite.prepare('UPDATE cms_users SET active=1 WHERE email=?').run(admin.email);
// Erasure authority survives restoring an older D1 value, independently of
// archived tombstones. Missing/unknown R2 state never permits contact access.
const restoreInput=input();await service.submit(scope,restoreInput,now);const beforeErase=await store.get(scope,restoreInput.idempotencyKey);
await service.erase(scope,restoreInput.idempotencyKey,1,'requested',now,'owner-subject');
const markerKey=contactPrivacyKey(scope,restoreInput.idempotencyKey),immutableBytes=bucket.objects.get(markerKey);
for(const raw of [restoreInput.email,restoreInput.phone,restoreInput.fullName,'owner-subject'])assert.ok(!immutableBytes.includes(raw));
await privacy.ensure({schema:1,scope,key:restoreInput.idempotencyKey,reason:'expired',erasedAt:new Date(now.getTime()+1000).toISOString()});assert.equal(bucket.objects.get(markerKey),immutableBytes,'first marker cannot be overwritten');
const restoreSql="UPDATE cms_settings SET value=? WHERE key=?",restoreKey='contact:v1:'+scope.tenantId+':'+scope.siteId+':'+restoreInput.idempotencyKey;
sqlite.prepare(restoreSql).run(JSON.stringify(beforeErase),restoreKey);
await assert.rejects(service.submit(scope,restoreInput,now),e=>e.status===410);assert.equal((await store.get(scope,restoreInput.idempotencyKey)).schema,2,'late replay redacts restored PII');
sqlite.prepare(restoreSql).run(JSON.stringify(beforeErase),restoreKey);
const reconciliation=await service.reconcile(scope,100,null,now);assert.ok(reconciliation.redacted>=1);assert.equal((await store.get(scope,restoreInput.idempotencyKey)).schema,2,'restore reconciliation strips old PII before activation');
const emptyAuthority=contactPrivacyBucket();emptyAuthority.objects.clear();
await assert.rejects(new R2ContactPrivacy(emptyAuthority,fixtureContactPrivacyAuthority).get(scope,restoreInput.idempotencyKey),e=>e.status===503,'empty/replaced bucket is unknown authority');
await assert.rejects(new R2ContactPrivacy(bucket,'20000000-0000-4000-8000-000000000006').get(scope,restoreInput.idempotencyKey),e=>e.status===503,'wrong pinned authority is unknown');
await initializeContactPrivacyAuthority(emptyAuthority,scope,fixtureContactPrivacyAuthority);assert.equal(await new R2ContactPrivacy(emptyAuthority,fixtureContactPrivacyAuthority).get(scope,crypto.randomUUID()),null,'deliberate initialization verifies absence');
await assert.rejects(initializeContactPrivacyAuthority(emptyAuthority,scope,'20000000-0000-4000-8000-000000000006'),e=>e.status===503,'authority cannot be silently replaced');
assert.equal(parseContactPrivacyKey(markerKey).kind,'marker');assert.equal(parseContactPrivacyKey('privacy/contact-erased/v1/derech/derech-main/authority.json').kind,'authority');assert.equal(parseContactPrivacyKey('privacy/contact-erased/v1/derech/../../bad.json'),null);
sqlite.prepare(restoreSql).run(JSON.stringify(beforeErase),restoreKey);let restoreCursor=null,restoreScanned=0,restoreState;
do{const proof=await reconcileContactRestore(db,bucket,scope,{CONTACT_RETENTION_DAYS:'30',CONTACT_PRIVACY_AUTHORITY_ID:fixtureContactPrivacyAuthority},restoreCursor,now);assert.ok(proof.scanned<=2);restoreCursor=proof.nextCursor;restoreScanned+=proof.scanned;restoreState=proof.state;}while(restoreCursor!==null);
assert.equal(restoreState,'ready');assert.ok(restoreScanned>2);assert.equal((await store.get(scope,restoreInput.idempotencyKey)).schema,2,'bounded full restore gate cannot skip an old snapshot deletion');
const unavailableInput=input();const countBeforeUnknown=leadCount();bucket.failRead=true;await assert.rejects(service.submit(scope,unavailableInput,now),e=>e.status===503);assert.equal(leadCount(),countBeforeUnknown);await assert.rejects(service.read(scope,privateInput.idempotencyKey,now),e=>e.status===503);bucket.failRead=false;
bucket.failWrite=true;await assert.rejects(service.erase(scope,privateInput.idempotencyKey,1,'requested',now),e=>e.status===503);assert.equal((await store.get(scope,privateInput.idempotencyKey)).schema,1,'marker must persist and verify before D1 erasure');bucket.failWrite=false;
assert.deepEqual(await maintainContacts(db,bucket,scope,{},now),{state:'disabled'});
const maintenanceInput=input();await service.submit(scope,maintenanceInput,new Date(now.getTime()-31*86400000));
const maintenance=await maintainContacts(db,bucket,scope,{CONTACT_RETENTION_DAYS:'30',CONTACT_PRIVACY_AUTHORITY_ID:fixtureContactPrivacyAuthority},now);assert.equal(maintenance.state,'complete');assert.ok(maintenance.reconciled.scanned<=2);assert.ok(maintenance.expired.examined<=2);assert.equal((await store.get(scope,maintenanceInput.idempotencyKey)).schema,2,'existing signed runtime hook can clean a quiet site');
// Actual management route with real authorization/scope SQL. Only the trusted
// upstream session reader and deployment bindings are injected offline.
sqlite.prepare("INSERT OR REPLACE INTO cms_settings(key,value) VALUES('cms_users_bootstrapped','1')").run();
sqlite.prepare("INSERT INTO cms_users(email,role,active,can_publish,revision,created_at,updated_at,platform_auth_user_id) VALUES(?, 'content_editor',1,0,1,?,?,?)").run('editor@example.test',now.toISOString(),now.toISOString(),'editor-subject');
globalThis.__contactControlBindings={DB:db,BUCKET:bucket,CONTACT_PRIVACY_AUTHORITY_ID:fixtureContactPrivacyAuthority,CONTACT_RETENTION_DAYS:'30',CMS_ADAPTER_MODE:'isolated-d1',CMS_TENANT_ID:scope.tenantId,CMS_SITE_ID:scope.siteId};
globalThis.__contactControlUser=null;
const routeBundle=await build({stdin:{contents:`export {POST} from './app/api/contact/manage/route';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent',plugins:[{name:'local-session',setup(builder){
 builder.onResolve({filter:/^(cloudflare:workers|@\/app\/chatgpt-auth)$/},args=>({path:args.path,namespace:'local-session'}));
 builder.onLoad({filter:/.*/,namespace:'local-session'},({path})=>({contents:path==='cloudflare:workers'?'export const env=globalThis.__contactControlBindings;':'export const getAuthProvider=()=>"supabase",getChatGPTUser=async()=>globalThis.__contactControlUser;',loader:'js'}));
}}]});
const {POST:manage}=await import('data:text/javascript;base64,'+Buffer.from(routeBundle.outputFiles[0].text).toString('base64'));
const manageInput=input();await service.submit(scope,manageInput);
const manageRequest=(body={action:'read',key:manageInput.idempotencyKey},headers={},suffix='')=>new Request('https://review.workers.dev/api/contact/manage/'+suffix,{method:'POST',headers:{origin:'https://review.workers.dev','content-type':'application/json',...headers},body:JSON.stringify(body)});
let managedResponse=await manage(manageRequest());assert.equal(managedResponse.status,401);
managedResponse=await manage(manageRequest(undefined,{'oai-authenticated-user-id':'owner-subject','oai-authenticated-user-email':admin.email}));assert.equal(managedResponse.status,401);
globalThis.__contactControlUser={userId:'editor-subject',email:'editor@example.test'};managedResponse=await manage(manageRequest());assert.equal(managedResponse.status,403);
globalThis.__contactControlUser={userId:admin.userId,email:admin.email};
managedResponse=await manage(manageRequest(undefined,{origin:'https://outside.invalid'}));assert.equal(managedResponse.status,403);
managedResponse=await manage(manageRequest(undefined,{},'?key='+manageInput.idempotencyKey));assert.equal(managedResponse.status,403);
managedResponse=await manage(manageRequest({action:'read',key:manageInput.idempotencyKey,tenantId:'other'}));assert.equal(managedResponse.status,400);
managedResponse=await manage(manageRequest());assert.equal(managedResponse.status,200);assert.equal((await managedResponse.json()).record.fields.email,manageInput.email);assert.match(managedResponse.headers.get('cache-control'),/private, no-store/);assert.match(managedResponse.headers.get('x-robots-tag'),/noindex/);
managedResponse=await manage(manageRequest({action:'erase',key:manageInput.idempotencyKey,expectedRevision:1,confirmed:false}));assert.equal(managedResponse.status,400);
managedResponse=await manage(manageRequest({action:'erase',key:manageInput.idempotencyKey,expectedRevision:2,confirmed:true}));assert.equal(managedResponse.status,409);
managedResponse=await manage(manageRequest({action:'erase',key:manageInput.idempotencyKey,expectedRevision:1,confirmed:true}));assert.equal(managedResponse.status,200);const deletion=await managedResponse.json();assert.equal(deletion.record.schema,2);assert.equal(deletion.record.actorId,admin.userId);assert.ok(!JSON.stringify(deletion).includes(manageInput.email));
managedResponse=await manage(manageRequest());assert.equal(managedResponse.status,410);
delete globalThis.__contactControlBindings;delete globalThis.__contactControlUser;
// Provider fixture handles real HTTP requests; configured external URL is only
// rewritten by this explicit test-only dependency, never by production code.
let providerMode='ok',requests=0;const server=createServer((req,res)=>{requests++;req.resume();req.on('end',()=>{if(providerMode==='timeout')return setTimeout(()=>{res.writeHead(202,{'content-type':'application/json'});res.end('{"state":"queued","id":"slow"}');},250);if(providerMode==='redirect'){res.writeHead(302,{location:'/duplicate'});return res.end();}res.writeHead(202,{'content-type':'application/json'});res.end(providerMode==='malformed'?'not-json':providerMode==='large'?'x'.repeat(2049):'{"state":"queued","id":"fixture-123"}');});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixture='http://127.0.0.1:'+server.address().port;
const config={schema:1,kind:'make',verified:true,scope,formIds:['0899899'],endpoint:'https://hook.eu2.make.com/synthetic_test_endpoint',fields:{name:'fullName',phone:'phone',email:'email',form:'formId',post:'postId',consent_at:'consentAt',receipt:'receipt'},idempotency:{header:'x-contact-idempotency',verified:true},acknowledgement:{status:202,field:'state',value:'queued',receiptField:'id'},timeoutMs:100};
const fetcher=async(url,options)=>{assert.equal(url,config.endpoint);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');const payload=JSON.parse(options.body);assert.match(options.headers['x-contact-idempotency'],/^[a-f0-9-]{36}$/);assert.equal(payload.post,'13');assert.ok(!Object.hasOwn(payload,'scope'));return fetch(fixture,options);};
try{
 for(const bad of [{...config,verified:false},{...config,scope:other},{...config,endpoint:'http://127.0.0.1:1/x'},{...config,endpoint:config.endpoint+'?email=private'},{...config,formIds:['aa2b8e0']},{...config,fields:{name:'fullName'}},{...config,idempotency:{header:'authorization',verified:true}},{...config,acknowledgement:{...config.acknowledgement,extra:'x'}},{...config,timeoutMs:10001}])await assert.rejects(verifiedMakeContract(bad,scope),/routing_unverified/);
 let deliveryInput=input();await service.submit(scope,deliveryInput);let result=await deliverContact(service,scope,deliveryInput.idempotencyKey,1,config,fetcher);assert.equal(result.state,'provider_accepted');assert.equal(requests,1);assert.ok(!JSON.stringify(result).includes(deliveryInput.email));
 await assert.rejects(deliverContact(service,scope,deliveryInput.idempotencyKey,1,config,fetcher),e=>e.status===409);assert.equal(requests,1,'accepted attempt cannot dispatch twice');
 for(const mode of ['malformed','large','redirect','timeout']){providerMode=mode;deliveryInput=input();await service.submit(scope,deliveryInput);const before=requests;result=await deliverContact(service,scope,deliveryInput.idempotencyKey,1,config,fetcher);assert.equal(result.state,'unknown',mode);assert.equal(requests,before+1);await assert.rejects(deliverContact(service,scope,deliveryInput.idempotencyKey,3,config,fetcher),e=>e.status===409);assert.equal(requests,before+1,'uncertain '+mode+' is not resent');}
}finally{await new Promise(resolve=>server.close(resolve));sqlite.close();}
console.log('PASS contact controls: actual scoped/atomic SQLite quotas before storage, replay allowance, expiry/deletion/tombstones/shortened policy, immutable R2 authority/older-snapshot redaction/fail-closed unknown privacy/quiet-runtime hook, access revocation and durable PII-free audit, real management route auth/role/origin/scope/revision/erase, strict contract, loopback HTTP success/malformed/oversize/redirect/deadline/no duplicate; no live requests.');
