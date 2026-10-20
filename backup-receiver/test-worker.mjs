import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {receive,sign,sha256,protocol,receiptPurpose,path,maxBytes,objectKey,checkEncryptedDer} from './receiver-core.mjs';
const temporary=mkdtempSync(join(tmpdir(),'derech-backup-receiver-'));
let cipher;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem'),'-subj','/CN=local-backup-fixture','-days','1'],{stdio:'ignore'});
 writeFileSync(join(temporary,'plain.tar'),'private test payload: no customer records');
 execFileSync('openssl',['cms','-encrypt','-binary','-aes256','-outform','DER','-in',join(temporary,'plain.tar'),'-out',join(temporary,'cipher.cms'),join(temporary,'cert.pem')]);
 cipher=new Uint8Array(readFileSync(join(temporary,'cipher.cms')));
}finally{rmSync(temporary,{recursive:true,force:true});}
checkEncryptedDer(cipher);
const origin='https://derech-cms-backup-receiver.example.workers.dev',secret='a'.repeat(64),created='20261019T210000Z',now=Date.parse('2026-10-19T21:00:10Z'),sha=await sha256(cipher);
class Bucket{
 objects=new Map();puts=0;fail=false;corrupt=false;
 async put(key,bytes,options){this.puts++;assert.equal(options.onlyIf.get('if-none-match'),'*');assert.equal(options.sha256,await sha256(bytes));if(this.fail)throw new Error('PRIVATE_PROVIDER_SECRET');if(this.objects.has(key))return null;const value={key,size:bytes.length,etag:'etag-1',version:'version-1',customMetadata:options.customMetadata,data:Uint8Array.from(bytes)};this.objects.set(key,value);return value;}
 async head(key){return this.objects.get(key)??null;}
 async get(key,options){const object=this.objects.get(key);if(!object||options.onlyIf.etagMatches!==object.etag)return null;const bytes=Uint8Array.from(object.data);if(this.corrupt)bytes[bytes.length-1]^=1;return{...object,body:true,async arrayBuffer(){return bytes.buffer;}};}
}
const bucket=new Bucket(),env={BACKUP_BUCKET:bucket,BACKUP_UPLOAD_ENABLED:'true',BACKUP_RECEIVER_ORIGIN:origin,BACKUP_UPLOAD_HMAC:secret};
async function request({body=cipher,size=String(cipher.length),digest=sha,stamp=created,time=String(now/1000),method='POST',url=origin+path,headers={},signingSecret=secret}={}){const signature=await sign(signingSecret,[protocol,'POST',origin,path,time,stamp,size,digest].join('\n'));return new Request(url,{method,...(method==='POST'?{body}:{}),headers:{'content-type':'application/pkcs7-mime','x-backup-time':time,'x-backup-created-at':stamp,'x-backup-size':size,'x-backup-sha256':digest,'x-backup-signature':signature,...headers}});}
let response=await receive(await request(),env,now);assert.equal(response.status,201);assert.match(response.headers.get('x-robots-tag'),/noindex/);
let raw=await response.text(),receipt=JSON.parse(raw);assert.equal(receipt.key,objectKey(created,sha));assert.equal(receipt.verified,true);assert.equal(receipt.duplicate,false);assert.equal(response.headers.get('x-backup-receipt-signature'),await sign(secret,receiptPurpose+'\n'+raw));
response=await receive(await request(),env,now);assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);assert.equal(bucket.objects.size,1);
const raceBucket=new Bucket();const race=await Promise.all([receive(await request(),{...env,BACKUP_BUCKET:raceBucket},now),receive(await request(),{...env,BACKUP_BUCKET:raceBucket},now)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,201]);assert.equal(raceBucket.objects.size,1);
for(const [options,status]of [[{signingSecret:'b'.repeat(64)},401],[{time:String(now/1000-121)},401],[{time:String(now/1000+121)},401],[{url:origin+path+'?key=other'},404],[{url:origin+'/v1/backups/other/derech-main'},404],[{url:'https://evil.example'+path},404],[{headers:{origin}},403],[{headers:{cookie:'session=private'}},403],[{headers:{'content-type':'application/octet-stream'}},415],[{size:String(maxBytes+1)},413],[{size:String(cipher.length-1)},413],[{headers:{'content-length':'1'}},400],[{stamp:'20260231T210000Z'},400],[{stamp:'20261001T210000Z'},400]]){const before=bucket.puts;const r=await receive(await request(options),env,now);assert.equal(r.status,status,JSON.stringify(options));assert.equal(bucket.puts,before,'reject before storage');}
for(const method of ['GET','HEAD','DELETE','PUT','OPTIONS']){response=await receive(await request({method}),env,now);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');assert.match(response.headers.get('x-robots-tag'),/noindex/);}
const tampered=Uint8Array.from(cipher);tampered[tampered.length-1]^=1;response=await receive(await request({body:tampered}),env,now);assert.equal(response.status,422);
const plain=new TextEncoder().encode('unprotected plaintext');response=await receive(await request({body:plain,size:String(plain.length),digest:await sha256(plain)}),env,now);assert.equal(response.status,422);
response=await receive(await request(),{...env,BACKUP_UPLOAD_ENABLED:'false'},now);assert.equal(response.status,503);
const object=bucket.objects.get(receipt.key);object.customMetadata.tenantId='other';response=await receive(await request(),env,now);assert.equal(response.status,409);assert.equal(bucket.objects.size,1);object.customMetadata.tenantId='derech';
bucket.corrupt=true;response=await receive(await request(),env,now);assert.equal(response.status,502);assert.equal((await response.json()).code,'stored_copy_unverified');bucket.corrupt=false;
const failing=new Bucket();failing.fail=true;response=await receive(await request(),{...env,BACKUP_BUCKET:failing},now);assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('PRIVATE_PROVIDER_SECRET'));
console.log('PASS real OpenSSL DER envelope; purpose/time/origin/scope/HMAC; no read/list/delete; conditional immutable create/replay/race; limits; plaintext/tamper rejection; full stored-byte verification; signed receipt; storage error redaction');
