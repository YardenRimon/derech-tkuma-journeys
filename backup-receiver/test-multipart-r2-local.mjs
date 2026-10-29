/** Actual local multipart R2, synthetic encrypted bytes only, no account. */
import assert from 'node:assert/strict';
import {Miniflare} from '../platform-cms/node_modules/miniflare/dist/src/index.js';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {sign,sha256,objectKey} from './receiver-core.mjs';
import {multipartProtocol,multipartPath,partBytes,manifestText,sessionFor,multipartMessage} from './multipart-core.mjs';
const dir=mkdtempSync(join(tmpdir(),'derech-multipart-r2-')),origin='https://derech-cms-backup-receiver.example.workers.dev',secret='a'.repeat(64),encode=new TextEncoder();let mf;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-subj','/CN=synthetic-multipart-fixture','-days','1'],{stdio:'ignore'});
 writeFileSync(join(dir,'plain'),Buffer.alloc(17*1024*1024,0x41));execFileSync('openssl',['cms','-encrypt','-binary','-aes256','-outform','DER','-in',join(dir,'plain'),'-out',join(dir,'cipher.cms'),join(dir,'cert.pem')]);
 const bytes=new Uint8Array(readFileSync(join(dir,'cipher.cms'))),created=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),sha=await sha256(bytes),parts=[];
 for(let at=0;at<bytes.length;at+=partBytes){const chunk=bytes.slice(at,at+partBytes);parts.push({partNumber:parts.length+1,bytes:chunk.length,sha256:await sha256(chunk)});}
 const manifest={protocol:multipartProtocol,scope:{tenantId:'derech',siteId:'derech-main'},createdAt:created,ciphertextBytes:bytes.length,ciphertextSha256:sha,partBytes,parts},id=await sessionFor(manifest),rawManifest=encode.encode(manifestText(manifest));
 mf=new Miniflare({modules:true,scriptPath:new URL('./worker.mjs',import.meta.url).pathname,compatibilityDate:'2026-05-22',r2Buckets:{BACKUP_BUCKET:'local-multipart-only'},bindings:{BACKUP_UPLOAD_ENABLED:'true',BACKUP_RECEIVER_ORIGIN:origin,BACKUP_UPLOAD_HMAC:secret}});
 const bucket=await mf.getR2Bucket('BACKUP_BUCKET');
 async function call(action,{body=encode.encode('{}'),session=id,part=0,path=multipartPath+'/'+action,time=String(Math.floor(Date.now()/1000)),key=secret,extras={},digest}={}){const size=String(body.length),sha=digest??await sha256(body),headers={'content-type':action==='part'?'application/pkcs7-mime':'application/json','x-backup-time':time,'x-backup-session':session,'x-backup-part':String(part),'x-backup-size':size,'x-backup-sha256':sha,'x-backup-signature':await sign(key,multipartMessage(action,origin,time,session,String(part),size,sha)),...extras};return mf.dispatchFetch(origin+path,{method:'POST',body,headers});}
 // Linux may reset a deliberately unconsumed large rejected upload before
 // delivering its error status. This negative-only check also proves every
 // persisted object/version is unchanged; positive receipts never use it.
 async function deniedPart(opts,status){
  const snapshot=async()=>{const r=await bucket.list({limit:1000});assert(!r.truncated);return r.objects.map(({key,version,etag,size})=>({key,version,etag,size}));},before=await snapshot();
  try{assert.equal((await call('part',opts)).status,status);}
  catch(error){assert.equal(error?.message,'fetch failed');assert.equal(error?.cause?.code,'ECONNRESET');}
  assert.deepEqual(await snapshot(),before,'rejected part cannot mutate persistent state');
 }
 async function ok(action,opts,status=200){const r=await call(action,opts);assert.equal(r.status,status,await r.clone().text());const raw=await r.text();assert.equal(r.headers.get('x-backup-receipt-signature'),await sign(secret,`cms-ciphertext-${action}-receipt-v2\n${raw}`));return JSON.parse(raw);}
 const initial=await ok('create',{body:rawManifest},201);assert.equal(initial.key,objectKey(created,sha));assert.equal(initial.manifestSha256,await sha256(rawManifest));
 assert.deepEqual(await ok('create',{body:rawManifest}),initial);
 for(const [opts,status] of [[{body:rawManifest,key:'b'.repeat(64)},401],[{body:rawManifest,path:multipartPath+'/complete'},401],[{body:rawManifest,time:String(Math.floor(Date.now()/1000)-121)},401],[{body:rawManifest,path:'/v2/backups/other/derech-main/create'},404],[{body:rawManifest,extras:{origin}},403],[{body:rawManifest,extras:{cookie:'session=x'}},403],[{body:encode.encode('{}')},400]])assert.equal((await call('create',opts)).status,status);
 const conflict=structuredClone(manifest);conflict.parts[0].sha256='b'.repeat(64);assert.equal((await call('create',{body:encode.encode(manifestText(conflict))})).status,409);
 const over=structuredClone(manifest);over.ciphertextBytes=4*1024*1024*1024+1;assert.equal((await call('create',{body:encode.encode(manifestText(over))})).status,413);
 assert.equal((await call('complete')).status,409,'incomplete upload must not publish');assert.equal(await bucket.head(initial.key),null);
 const first=bytes.slice(0,partBytes),tampered=Uint8Array.from(first);tampered[512]^=1;
 await deniedPart({body:tampered,part:1,digest:parts[0].sha256},422);
 await deniedPart({body:tampered,part:1},409);
 await deniedPart({body:new Uint8Array(partBytes+1),part:1},413);
 await deniedPart({body:first,part:1,session:'0'.repeat(64)},404);
 const p1=await ok('part',{body:first,part:1},201);assert.deepEqual(await ok('part',{body:first,part:1}),p1);
 // Resume exact same session after a deliberately interrupted partial upload.
 const resumed=await ok('create',{body:rawManifest});assert.deepEqual(resumed.uploadedParts,[1]);assert.equal(resumed.storedComplete,false);
 for(const p of parts.slice(1))await ok('part',{body:bytes.slice((p.partNumber-1)*partBytes,p.partNumber*partBytes),part:p.partNumber},201);
 const done=await ok('complete');assert.equal(done.verified,false);assert.equal(done.globalReadbackRequired,true);assert.deepEqual(await ok('complete'),done);
 const stored=await bucket.get(initial.key);assert(stored);assert.equal(await sha256(await stored.arrayBuffer()),sha);
 let recovered=[];for(const p of parts){const r=await call('readback',{part:p.partNumber});assert.equal(r.status,200);const raw=r.headers.get('x-backup-readback-receipt');assert.equal(r.headers.get('x-backup-receipt-signature'),await sign(secret,'cms-ciphertext-readback-receipt-v2\n'+raw));const receipt=JSON.parse(raw),chunk=new Uint8Array(await r.arrayBuffer());assert.equal(receipt.objectVersion,done.objectVersion);assert.equal(chunk.length,p.bytes);assert.equal(await sha256(chunk),p.sha256);recovered.push(chunk);}
 const combined=new Uint8Array(bytes.length);let at=0;for(const chunk of recovered){combined.set(chunk,at);at+=chunk.length;}assert.equal(at,bytes.length);assert.equal(await sha256(combined),sha,'independent complete ciphertext hash, not inferred from parts');
 assert.equal((await call('cancel')).status,409);assert(await bucket.head(initial.key));
 // A different existing object can never be overwritten by complete/readback.
 await bucket.put(initial.key,encode.encode('tampered stored bytes'),{customMetadata:{tenantId:'other'}});assert.equal((await call('complete')).status,409);assert.equal((await call('readback',{part:1})).status,409);assert.equal(await (await bucket.get(initial.key)).text(),'tampered stored bytes');
 // Separate same-scope capture: authenticated cancellation aborts incomplete
 // upload and preserves its immutable cancellation receipt.
 const cancelled={...manifest,createdAt:new Date(Date.now()-60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')},cid=await sessionFor(cancelled);
 await ok('create',{session:cid,body:encode.encode(manifestText(cancelled))},201);await ok('cancel',{session:cid});assert.equal((await call('create',{session:cid,body:encode.encode(manifestText(cancelled))})).status,409);assert.equal(await bucket.head(objectKey(cancelled.createdAt,sha)),null);

 // Concurrent different manifests for one final key have exactly one winner.
 const racing={...manifest,createdAt:new Date(Date.now()-30*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')},racingOther=structuredClone(racing),racingId=await sessionFor(racing);racingOther.parts[0].sha256='d'.repeat(64);
 const race=await Promise.all([call('create',{session:racingId,body:encode.encode(manifestText(racing))}),call('create',{session:racingId,body:encode.encode(manifestText(racingOther))})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);await ok('cancel',{session:racingId});
 // Metadata-only maximum-size fixture does not allocate or hash 4GiB in Worker.
 const maximum={...manifest,createdAt:new Date(Date.now()-120000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),ciphertextBytes:4*1024*1024*1024,ciphertextSha256:'f'.repeat(64),parts:Array.from({length:512},(_,i)=>({partNumber:i+1,bytes:partBytes,sha256:'e'.repeat(64)}))},maxId=await sessionFor(maximum);
 await ok('create',{session:maxId,body:encode.encode(manifestText(maximum))},201);await ok('cancel',{session:maxId});await ok('cancel',{session:maxId});
 // Exactly eight CAS slots; the ninth concurrent-capacity reservation fails.
 const reservations=[];for(let n=0;n<8;n++){const m={...manifest,createdAt:new Date(Date.now()-(n+5)*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')},sid=await sessionFor(m);await ok('create',{session:sid,body:encode.encode(manifestText(m))},201);reservations.push(sid);}
 const ninth={...manifest,createdAt:new Date(Date.now()-20*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')},ninthId=await sessionFor(ninth);assert.equal((await call('create',{session:ninthId,body:encode.encode(manifestText(ninth))})).status,429);for(const sid of reservations)await ok('cancel',{session:sid});
 // Exercise expired incomplete cleanup in this same authenticated invocation.
 const expired={...manifest,createdAt:new Date(Date.now()-8*86400000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')},expiredId=await sessionFor(expired),expiredKey=objectKey(expired.createdAt,sha),mp=await bucket.createMultipartUpload(expiredKey),statePrefix='derech/derech-main/.multipart-v2/';
 await bucket.put(statePrefix+'active/0',JSON.stringify({sessionId:expiredId,manifestSha256:await sha256(encode.encode(manifestText(expired))),manifest:expired,key:expiredKey,uploadId:mp.uploadId,slot:0,openedAt:Date.now()-8*86400000}));
 await ok('create',{session:ninthId,body:encode.encode(manifestText(ninth))},201);assert(await bucket.head(statePrefix+'cancelled/'+expiredId));await assert.rejects(()=>mp.uploadPart(1,first));await ok('cancel',{session:ninthId});
 // A signed manifest does not waive encrypted-format checks on the first part.
 const plainFirst=new Uint8Array(partBytes),plainSha=await sha256(plainFirst),plainManifest={...manifest,createdAt:new Date(Date.now()-25*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),ciphertextSha256:'c'.repeat(64),parts:manifest.parts.map((p,i)=>i?{...p}:{...p,sha256:plainSha})};
 const plainId=await sessionFor(plainManifest);await ok('create',{session:plainId,body:encode.encode(manifestText(plainManifest))},201);assert.equal((await call('part',{session:plainId,part:1,body:plainFirst})).status,422);await ok('cancel',{session:plainId});
 assert.equal((await mf.dispatchFetch(origin+multipartPath+'/readback',{method:'GET'})).status,405);
 console.log('PASS actual local R2 >16MiB multipart, exact manifest/session resume, auth/replay/scope/malformed/size/tamper rejection, incomplete publication refusal, duplicate receipts, completed-object conflict, cancellation, and independently reassembled full ciphertext SHA256');
}finally{if(mf)await mf.dispose();rmSync(dir,{recursive:true,force:true});}
