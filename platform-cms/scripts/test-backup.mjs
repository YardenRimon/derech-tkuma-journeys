import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync}from'node:fs';
import {tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';import{createHmac}from'node:crypto';
import{build}from'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/backup-core';export * from './lib/contact-core';export * from './lib/contact-d1';export * from './lib/contact-privacy';export * from './lib/contact-maintenance';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent'});
const {exportBackup,backupRequest,verifyBackupSignature,canonical,sha256,backupPurpose,backupMigrations,backupInventory,Contacts,D1Contacts,R2ContactPrivacy,initializeContactPrivacyAuthority,contactPrivacyKey,contactPrivacyAuthorityKey,reconcileContactRestore}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const migrationFiles=readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort();
const sqlite=new DatabaseSync(':memory:');for(const path of migrationFiles)sqlite.exec(readFileSync(new URL('../drizzle/'+path,import.meta.url),'utf8'));
function databaseAdapter(database){return{prepare(sql){const statement=database.prepare(sql);return{args:[],bind(...args){this.args=args;return this;},async first(){return statement.get(...this.args)??null},async all(){return{success:true,results:statement.all(...this.args)}},async run(){return{success:true,meta:{changes:Number(statement.run(...this.args).changes)}}}}},async batch(statements){database.exec('BEGIN');try{const result=await Promise.all(statements.map(x=>x.all()));database.exec('COMMIT');return result}catch(e){database.exec('ROLLBACK');throw e}}};}
const db=databaseAdapter(sqlite);
const scope={tenantId:'derech',siteId:'derech-main'},key='4aa04942-642d-43ea-86df-992038ed28bf',data=new TextEncoder().encode('fixture-image-bytes'),etag='a'.repeat(32),object={key,size:data.length,etag,uploaded:new Date('2026-10-19T00:00:00Z'),httpMetadata:{contentType:'image/png',contentLanguage:undefined,cacheExpiry:new Date('2026-10-21T00:00:00Z')}};
let media=[object];const bucket={async head(key){return media.find(x=>x.key===key)??null},async list(){return{objects:media,truncated:false}}};
sqlite.prepare('INSERT INTO cms_deployment_scope VALUES(1,?,?)').run(scope.tenantId,scope.siteId);
sqlite.prepare('INSERT INTO cms_settings VALUES(?,?)').run('cms_users_bootstrapped','true');
sqlite.prepare('INSERT INTO cms_users(email,role,active,can_publish,revision,created_at,updated_at,auth_user_id)VALUES(?,?,?,?,?,?,?,?)').run('owner@example.test','system_admin',1,1,7,'2026-10-19','2026-10-19','auth-fixture');
const platformAuthPin='b37e01d1-4cfa-489c-859f-b2824854087d';sqlite.prepare('UPDATE cms_users SET platform_auth_user_id=?').run(platformAuthPin);
sqlite.prepare('INSERT INTO platform_auth_rate_limits VALUES(?,?,?,?)').run('e'.repeat(64),1000,4,1060);
sqlite.prepare('INSERT INTO contact_rate_limits VALUES(?,?,?,?)').run('f'.repeat(64),1000,4,1060);
for(let id=1;id<=1205;id++)sqlite.prepare('INSERT INTO cms_permission_audit(actor_email,subject_email,operation,changed_at)VALUES(?,?,?,?)').run('owner@example.test','owner@example.test','fixture','2026-10-19');
sqlite.exec('DELETE FROM cms_permission_audit WHERE id=1205');
sqlite.prepare('INSERT INTO cms_pages VALUES(?,?,?,?,?,?,?)').run('/','{"fields":{"x":{"value":"שלום"}},"order":[]}',9,'<html>published</html>',2,'actor','2026-10-19');
for(let version=1;version<=2;version++)sqlite.prepare('INSERT INTO cms_versions VALUES(?,?,?,?,?,?)').run('/',version,'<html>v'+version+'</html>','{"fields":{},"order":[]}','actor','2026-10-19');
const wrapper=await exportBackup(db,bucket,scope,{contentRelease:'fixture'});assert.equal(wrapper.snapshot.tables.length,11);assert.equal(wrapper.snapshot.tables.find(x=>x.name==='cms_permission_audit').count,1204);assert.equal(wrapper.snapshot.sqliteSequence[0].seq,1205);assert.equal(wrapper.snapshot.media.length,1);
assert.equal(wrapper.snapshot.migrations.length,8);assert.equal(wrapper.snapshot.tables.find(x=>x.name==='cms_users').rows[0].platform_auth_user_id,platformAuthPin);assert.ok(!wrapper.snapshot.tables.some(x=>x.name==='platform_auth_rate_limits'),'transient auth counters are excluded from the archive');assert.ok(!wrapper.snapshot.tables.some(x=>x.name==='contact_rate_limits'),'transient contact counters are excluded from the archive');
assert.deepEqual(wrapper.snapshot.migrations,await Promise.all(migrationFiles.map(async name=>({name,sha256:await sha256(readFileSync(new URL('../drizzle/'+name,import.meta.url)))}))));
const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));assert.deepEqual(journal.entries.map(x=>x.tag+'.sql'),migrationFiles);assert.deepEqual(journal.entries.map(x=>x.idx),[0,1,2,3,4,5,6,7]);assert.equal(journal.entries.at(-1).tag,'0008_contact_controls');assert.equal(migrationFiles.some(x=>x.startsWith('0007_')),false);
const wire=JSON.parse(JSON.stringify(wrapper));assert.equal(await sha256(canonical(wire.snapshot)),wire.sha256,'R2 optional metadata and Dates retain the snapshot digest after HTTP JSON serialization');assert.deepEqual(wire.snapshot.media[0].httpMetadata,{contentType:'image/png',cacheExpiry:'2026-10-21T00:00:00.000Z'});
const raw=canonical({purpose:backupPurpose,operation:'snapshot',...scope}),secret='backup-only-credential-'+'.'.repeat(40),time='1792432800',path='/api/backup/';const signature=createHmac('sha256',secret).update(`${backupPurpose}\nPOST\n${path}\n${time}\n${raw}`).digest('hex');
await verifyBackupSignature(raw,time,signature,secret,path,Number(time)*1000);
for(const args of[[raw,time,signature,secret,'/api/execution/'],[raw+' ',time,signature,secret,path],[raw,time,signature,'different-secret-'+'.'.repeat(40),path],[raw,time,signature,secret,path,Number(time)*1000+120001]])await assert.rejects(verifyBackupSignature(...args),e=>e.status===401);
assert.throws(()=>backupRequest({purpose:backupPurpose,operation:'snapshot',...scope,sql:'SELECT 1'},scope));assert.throws(()=>backupRequest({purpose:backupPurpose,operation:'snapshot',...scope,tenantId:'other'},scope));assert.throws(()=>backupRequest({purpose:backupPurpose,operation:'object',...scope,key:'../other',etag},scope));
sqlite.prepare('INSERT INTO cms_records VALUES(?,?,?,?,?,?,?,?,?,?)').run('other','site','tour','t','{}',null,0,1,'now','token');await assert.rejects(exportBackup(db,bucket,scope,{}),e=>e.status===503);sqlite.exec('DELETE FROM cms_records');
media=[{...object,key:'other-tenant/private.txt'}];await assert.rejects(exportBackup(db,bucket,scope,{}),e=>e.status===503);media=[object];
sqlite.prepare('INSERT INTO cms_settings VALUES(?,?)').run('smtp_password','never-export');await assert.rejects(exportBackup(db,bucket,scope,{}),e=>e.status===503);sqlite.prepare('DELETE FROM cms_settings WHERE key=?').run('smtp_password');
sqlite.exec('CREATE TABLE cms_unreviewed(extra TEXT)');await assert.rejects(exportBackup(db,bucket,scope,{}),e=>e.status===503);sqlite.exec('DROP TABLE cms_unreviewed');
const truncated={...db,async batch(statements){const results=await db.batch(statements);const index=results.findIndex(result=>result.results.length===1204);results[index].results.pop();return results;}};await assert.rejects(exportBackup(truncated,bucket,scope,{}),e=>e.status===507);
const previousDraft=sqlite.prepare('SELECT draft_json FROM cms_pages').get().draft_json;sqlite.prepare('UPDATE cms_pages SET draft_json=?').run('{"image":"/media/11111111-1111-4111-8111-111111111111"}');await assert.rejects(exportBackup(db,bucket,scope,{}),e=>e.status===503);sqlite.prepare('UPDATE cms_pages SET draft_json=?').run(previousDraft);
const dir=mkdtempSync(join(tmpdir(),'cms-backup-test-'));
async function writeArchive(destination,archive){mkdirSync(join(destination,'media'),{recursive:true});writeFileSync(join(destination,'snapshot.json'),canonical(archive));writeFileSync(join(destination,'media',key),data);writeFileSync(join(destination,'manifest.json'),canonical({format:'cms-backup-complete-v1',scope,snapshotSha256:archive.sha256,media:[{key,size:data.length,sha256:await sha256(data)}]}));}
await writeArchive(dir,wrapper);
const target=join(dir,'restored.sqlite'),restore=new URL('../../scripts/cms-backup-restore.py',import.meta.url).pathname,migrations=new URL('../drizzle/',import.meta.url).pathname;
const run=(destination,source=dir,migrationSource=migrations)=>spawnSync('/usr/bin/python3',[restore,'--backup',source,'--target',destination,'--migrations',migrationSource],{encoding:'utf8'});
let result=run(target);assert.equal(result.status,0,result.stderr);const proof=JSON.parse(result.stdout);assert.equal(proof.integrity,'ok');assert.equal(proof.mediaObjects,1);assert.equal(proof.tableCounts.cms_versions,2);
const restored=new DatabaseSync(target);assert.equal(restored.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('cms_permission_audit').seq,1205);assert.equal(restored.prepare('SELECT revision,platform_auth_user_id FROM cms_users').get().revision,7);assert.equal(restored.prepare('SELECT platform_auth_user_id FROM cms_users').get().platform_auth_user_id,platformAuthPin);assert.equal(restored.prepare('SELECT published_version FROM cms_pages').get().published_version,2);assert.equal(restored.prepare('SELECT count(*) AS n FROM platform_auth_rate_limits').get().n,0,'transient auth rate table is recreated empty from trusted migration SQL');assert.equal(restored.prepare('SELECT count(*) AS n FROM contact_rate_limits').get().n,0,'transient contact rate table is recreated empty from trusted migration SQL');restored.close();

// Produce the actual previous schema by running only immutable migrations0..5,
// then export its real columns/rows/schema through the normal backup function.
// Only the historical migration declaration and enclosing digest are synthetic.
const legacy=new DatabaseSync(':memory:'),legacyFiles=migrationFiles.slice(0,6);assert.equal(legacyFiles.at(-1),'0005_yummy_wither.sql');
for(const path of legacyFiles)legacy.exec(readFileSync(new URL('../drizzle/'+path,import.meta.url),'utf8'));
legacy.prepare('INSERT INTO cms_deployment_scope VALUES(1,?,?)').run(scope.tenantId,scope.siteId);
legacy.prepare('INSERT INTO cms_settings VALUES(?,?)').run('cms_users_bootstrapped','true');
legacy.prepare('INSERT INTO cms_users(email,role,active,can_publish,revision,created_at,updated_at,auth_user_id,cf_access_user_id)VALUES(?,?,?,?,?,?,?,?,?)').run('legacy@example.test','system_admin',1,1,3,'2026-10-18','2026-10-18','old-auth-pin','old-access-pin');
const legacyArchive=await exportBackup(databaseAdapter(legacy),bucket,scope,{contentRelease:'legacy-six-migration-fixture'});
legacyArchive.snapshot.migrations=await Promise.all(legacyFiles.map(async name=>({name,sha256:await sha256(readFileSync(new URL('../drizzle/'+name,import.meta.url)))})));legacyArchive.sha256=await sha256(canonical(legacyArchive.snapshot));
assert.equal(legacyArchive.snapshot.tables.find(x=>x.name==='cms_users').columns.some(x=>x.name==='platform_auth_user_id'),false);
const legacyDirectory=join(dir,'legacy'),legacyTarget=join(dir,'legacy-restored.sqlite');await writeArchive(legacyDirectory,legacyArchive);
result=run(legacyTarget,legacyDirectory);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).integrity,'ok');
const restoredLegacy=new DatabaseSync(legacyTarget);assert.equal(restoredLegacy.prepare('SELECT auth_user_id,cf_access_user_id FROM cms_users').get().auth_user_id,'old-auth-pin');assert.equal(restoredLegacy.prepare('SELECT auth_user_id,cf_access_user_id FROM cms_users').get().cf_access_user_id,'old-access-pin');assert.equal(restoredLegacy.prepare('PRAGMA table_info(cms_users)').all().some(x=>x.name==='platform_auth_user_id'),false,'later auth migration is not applied to an older archived schema');assert.equal(restoredLegacy.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='platform_auth_rate_limits'").get().n,0);restoredLegacy.close();legacy.close();

// A real7-migration archive restores to its exact older schema with8known files.
const priorAuth=new DatabaseSync(':memory:'),priorFiles=migrationFiles.slice(0,7);assert.equal(priorFiles.at(-1),'0006_platform_auth.sql');
for(const name of priorFiles)priorAuth.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
priorAuth.prepare('INSERT INTO cms_deployment_scope VALUES(1,?,?)').run(scope.tenantId,scope.siteId);
priorAuth.prepare('INSERT INTO cms_users(email,role,active,can_publish,revision,created_at,updated_at,platform_auth_user_id)VALUES(?,?,?,?,?,?,?,?)').run('prior@example.test','system_admin',1,1,5,'2026-10-19','2026-10-19',platformAuthPin);
priorAuth.prepare('INSERT INTO platform_auth_rate_limits VALUES(?,?,?,?)').run('c'.repeat(64),1000,3,1060);
const priorArchive=await exportBackup(databaseAdapter(priorAuth),bucket,scope,{contentRelease:'real-seven-migration-fixture'});priorArchive.snapshot.migrations=backupMigrations.slice(0,7);priorArchive.sha256=await sha256(canonical(priorArchive.snapshot));
const priorDir=join(dir,'prior-seven'),priorTarget=join(dir,'prior-seven.sqlite');await writeArchive(priorDir,priorArchive);result=run(priorTarget,priorDir);assert.equal(result.status,0,result.stderr);
const restoredPrior=new DatabaseSync(priorTarget);assert.equal(restoredPrior.prepare('SELECT platform_auth_user_id FROM cms_users').get().platform_auth_user_id,platformAuthPin);assert.equal(restoredPrior.prepare('SELECT count(*) AS n FROM platform_auth_rate_limits').get().n,0);assert.equal(restoredPrior.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='contact_rate_limits'").get().n,0,'later contact migration is not applied to a historical7-migration archive');restoredPrior.close();priorAuth.close();

// Recomputed envelope hashes prevent these rejection cases being mistaken for
// generic snapshot tamper tests: the declaration itself must match a prefix.
const migrationCases=[
 ['empty',[]],
 ['missing-middle',[...legacyArchive.snapshot.migrations.slice(0,1),...legacyArchive.snapshot.migrations.slice(2)]],
 ['modified-hash',legacyArchive.snapshot.migrations.map((item,index)=>index===0?{...item,sha256:'0'.repeat(64)}:item)],
 ['out-of-order',[legacyArchive.snapshot.migrations[1],legacyArchive.snapshot.migrations[0],...legacyArchive.snapshot.migrations.slice(2)]],
 ['unknown',[...wrapper.snapshot.migrations,{name:'0007_untrusted.sql',sha256:'0'.repeat(64)}]],
 ['duplicate',[legacyArchive.snapshot.migrations[0],...legacyArchive.snapshot.migrations]],
 ['snapshot-sql',legacyArchive.snapshot.migrations.map((item,index)=>index===0?{...item,sql:'CREATE TABLE cms_untrusted(secret TEXT);'}:item)],
];
for(const[label,declaration]of migrationCases){
 const invalid=structuredClone(legacyArchive);invalid.snapshot.migrations=declaration;invalid.sha256=await sha256(canonical(invalid.snapshot));const source=join(dir,'invalid-'+label),destination=join(dir,'invalid-'+label+'.sqlite');await writeArchive(source,invalid);result=run(destination,source);assert.notEqual(result.status,0,'rejects '+label+' migration declaration');assert.match(result.stderr,/Migration source identity mismatch/);assert.ok(!existsSync(destination),'failed prefix validation removes isolated target');
}
// A matching declaration is insufficient when its actual immutable file is
// absent or changed at the receiver. No snapshot-provided SQL is substituted.
for(const issue of['missing-source','modified-source']){
 const localMigrations=join(dir,issue);mkdirSync(localMigrations);for(const name of migrationFiles){if(issue==='missing-source'&&name===legacyFiles[0])continue;const bytes=readFileSync(new URL('../drizzle/'+name,import.meta.url));writeFileSync(join(localMigrations,name),issue==='modified-source'&&name===legacyFiles[0]?Buffer.concat([bytes,Buffer.from('\n-- changed source identity\n')]):bytes);}
 const destination=join(dir,issue+'.sqlite');result=run(destination,legacyDirectory,localMigrations);assert.notEqual(result.status,0,'rejects '+issue);assert.match(result.stderr,/Migration source identity mismatch/);assert.ok(!existsSync(destination));
}
// Independent erasure authority is validated/excluded from media, then survives
// restoring an older D1/settings snapshot that still contains erased PII.
const authorityId='10000000-0000-4000-8000-000000000005',privacyConfig={contactPrivacyAuthorityId:authorityId},privacyValues=new Map();
const privacyMeta=async(key,value)=>({key,size:Buffer.byteLength(value),etag:(await sha256(value)).slice(0,32),uploaded:new Date('2026-10-21T00:00:00Z'),httpMetadata:{contentType:'application/json'}});
const protectedBucket={
 async get(key){const value=privacyValues.get(key);return value===undefined?null:{...(await privacyMeta(key,value)),async text(){return value;}};},
 async put(key,value,options){assert.ok(key.startsWith('privacy/contact-erased/v1/'),'contact privacy adapter writes only its fixed prefix');if(options?.onlyIf?.etagDoesNotMatch==='*'&&privacyValues.has(key))return null;privacyValues.set(key,String(value));return privacyMeta(key,String(value));},
 async head(key){return key===object.key?object:privacyValues.has(key)?privacyMeta(key,privacyValues.get(key)):null;},
 async list(){return{objects:[object,...await Promise.all([...privacyValues].map(([key,value])=>privacyMeta(key,value)))],truncated:false};},
};
await initializeContactPrivacyAuthority(protectedBucket,scope,authorityId);
const privacy=new R2ContactPrivacy(protectedBucket,authorityId),contacts=new Contacts(new D1Contacts(db),30,privacy),now=new Date('2026-10-21T09:00:00.000Z');
const input=(id=crypto.randomUUID())=>({idempotencyKey:id,formId:'0899899',fullName:'Synthetic privacy fixture',phone:'0501234567',email:'privacy-fixture@example.test',honeypot:'',consent:{contact:true,policyVersion:'source-2026-10-19'}});
const erasedInput=input(),expiredInput=input(),freshInput=input();await contacts.submit(scope,erasedInput,now);await contacts.submit(scope,expiredInput,new Date(now.getTime()-31*86400000));await contacts.submit(scope,freshInput,now);
// An archived routine-maintenance cursor must not skip restore reconciliation.
sqlite.prepare('INSERT INTO cms_settings(key,value) VALUES(?,?)').run('contact-maintenance:v1:derech:derech-main',JSON.stringify({after:'ffffffff-ffff-4fff-8fff-ffffffffffff',at:now.toISOString()}));
const beforeErase=await exportBackup(db,protectedBucket,scope,{contentRelease:'before-erasure'},privacyConfig);assert.equal(beforeErase.snapshot.media.length,1);assert.ok(canonical(beforeErase.snapshot.tables).includes(erasedInput.email));
await contacts.erase(scope,erasedInput.idempotencyKey,1,'requested',now,'synthetic-owner');
const markerKey=contactPrivacyKey(scope,erasedInput.idempotencyKey),authorityKey=contactPrivacyAuthorityKey(scope),markerBytes=privacyValues.get(markerKey),authorityBytes=privacyValues.get(authorityKey);
const privacySnapshot=await exportBackup(db,protectedBucket,scope,{contentRelease:'after-erasure'},privacyConfig);assert.deepEqual(privacySnapshot.snapshot.media.map(x=>x.key),[key]);assert(!canonical(privacySnapshot.snapshot.media).includes('privacy/'));assert(!canonical(privacySnapshot.snapshot).includes(authorityId));
await assert.rejects(exportBackup(db,protectedBucket,scope,{}),e=>e.status===503,'private keys cannot be skipped without pinned authority');
await assert.rejects(exportBackup(db,protectedBucket,scope,{}, {contactPrivacyAuthorityId:'20000000-0000-4000-8000-000000000005'}),e=>e.status===503);
assert.throws(()=>backupRequest({purpose:backupPurpose,operation:'object',...scope,key:markerKey,etag},scope),'private marker cannot be fetched through media backup operation');
for(const extraKey of ['privacy/contact-erased/v1/derech/derech-main/not-a-uuid.json','privacy/contact-erased/v1/derech/derech-main/authority.json/extra','privacy/contact-erased/v1/other/other-main/authority.json','unreviewed/private.json']){
 privacyValues.set(extraKey,'{}');await assert.rejects(backupInventory(protectedBucket,scope,privacyConfig),e=>e.status===503,'unknown or cross-scope private key fails closed');privacyValues.delete(extraKey);
}
privacyValues.set(markerKey,JSON.stringify({...JSON.parse(markerBytes),email:'private-canary@example.test'}));await assert.rejects(backupInventory(protectedBucket,scope,privacyConfig),e=>e.status===503,'marker body must match exact immutable schema');privacyValues.set(markerKey,markerBytes);
privacyValues.set(authorityKey,JSON.stringify({...JSON.parse(authorityBytes),extra:true}));await assert.rejects(backupInventory(protectedBucket,scope,privacyConfig),e=>e.status===503);privacyValues.set(authorityKey,authorityBytes);
privacyValues.delete(authorityKey);await assert.rejects(backupInventory(protectedBucket,scope,privacyConfig),e=>e.status===503,'missing authority is not an empty initialized bucket');privacyValues.set(authorityKey,authorityBytes);
const privacyDirectory=join(dir,'privacy-historical'),privacyTarget=join(dir,'privacy-historical.sqlite');await writeArchive(privacyDirectory,beforeErase);
const independentBefore=canonical([...privacyValues]);result=run(privacyTarget,privacyDirectory);assert.equal(result.status,0,result.stderr);assert.equal(canonical([...privacyValues]),independentBefore,'SQLite/media archive restore never writes the independent R2 authority or markers');
const privacyRestored=new DatabaseSync(privacyTarget),restoredAdapter=databaseAdapter(privacyRestored),restoredStore=new D1Contacts(restoredAdapter);
assert.equal((await restoredStore.get(scope,erasedInput.idempotencyKey)).schema,1,'historical encrypted snapshot really contains the earlier personal record');
let cursor=null,scanned=0,redacted=0,gate;do{gate=await reconcileContactRestore(restoredAdapter,protectedBucket,scope,{CONTACT_RETENTION_DAYS:'30',CONTACT_PRIVACY_AUTHORITY_ID:authorityId},cursor,now);assert.ok(gate.scanned<=2);cursor=gate.nextCursor;scanned+=gate.scanned;redacted+=gate.redacted;}while(cursor!==null);
assert.equal(gate.state,'ready');assert.equal(scanned,3);assert.equal(redacted,2);assert.equal((await restoredStore.get(scope,erasedInput.idempotencyKey)).schema,2);assert.equal((await restoredStore.get(scope,expiredInput.idempotencyKey)).schema,2);assert.equal((await restoredStore.get(scope,freshInput.idempotencyKey)).schema,1);assert.equal(privacyValues.get(markerKey),markerBytes);assert.equal(privacyValues.get(authorityKey),authorityBytes);
const restoredContacts=new Contacts(restoredStore,30,new R2ContactPrivacy(protectedBucket,authorityId));await assert.rejects(restoredContacts.submit(scope,erasedInput,now),e=>e.status===410);await assert.rejects(restoredContacts.read(scope,erasedInput.idempotencyKey,now),e=>e.status===410);await assert.rejects(restoredContacts.claim(scope,erasedInput.idempotencyKey,1,{kind:'make',verified:true,contractId:'d'.repeat(64),scope,formIds:['0899899']},now),e=>e.status===410);
for(const raw of [erasedInput.email,erasedInput.fullName,'0501234567'])assert.ok(!canonical(await restoredStore.get(scope,erasedInput.idempotencyKey)).includes(raw));
assert.equal(privacyRestored.prepare('SELECT count(*) AS n FROM platform_auth_rate_limits').get().n,0);assert.equal(privacyRestored.prepare('SELECT count(*) AS n FROM contact_rate_limits').get().n,0);privacyRestored.close();

assert.notEqual(run(target).status,0,'refuses existing target');writeFileSync(join(dir,'media',key),'tampered');const bad=join(dir,'bad.sqlite');assert.notEqual(run(bad).status,0,'rejects tampered media');assert(!existsSync(bad));
rmSync(dir,{recursive:true,force:true});sqlite.close();console.log('Backup: full1204-row capture, purpose/path/time HMAC, scope/secret/key isolation, media SHA, real6/7/8-migration archive restores with8available, both transient tables empty, exact scoped privacy authority/marker validation and exclusion, historical PII reconciliation against preserved independent erasure authority, strict migration prefix/hash/schema checks, identity/revisions/history/sequence, tamper+overwrite rejection passed.');
