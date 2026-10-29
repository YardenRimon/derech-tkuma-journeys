/** Actual local workerd/R2 binding; no Cloudflare account or public network. */
import assert from 'node:assert/strict';
import {Miniflare} from '../platform-cms/node_modules/miniflare/dist/src/index.js';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {sign,sha256,protocol,path,receiptPurpose} from './receiver-core.mjs';
const directory=mkdtempSync(join(tmpdir(),'derech-backup-r2-local-'));
let mf;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-subj','/CN=local-r2-backup-fixture','-days','1'],{stdio:'ignore'});
 writeFileSync(join(directory,'plain'),'isolated encrypted R2 write and independent byte-read proof');
 execFileSync('openssl',['cms','-encrypt','-binary','-aes256','-outform','DER','-in',join(directory,'plain'),'-out',join(directory,'cipher.cms'),join(directory,'cert.pem')]);
 const bytes=new Uint8Array(readFileSync(join(directory,'cipher.cms'))),secret='a'.repeat(64),origin='https://derech-cms-backup-receiver.example.workers.dev';
 mf=new Miniflare({modules:true,scriptPath:new URL('./worker.mjs',import.meta.url).pathname,compatibilityDate:'2026-05-22',r2Buckets:{BACKUP_BUCKET:'private-local-backups'},bindings:{BACKUP_UPLOAD_ENABLED:'true',BACKUP_RECEIVER_ORIGIN:origin,BACKUP_UPLOAD_HMAC:secret}});
 const created=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),time=String(Math.floor(Date.now()/1000)),sha=await sha256(bytes);
 const headers={'content-type':'application/pkcs7-mime','x-backup-time':time,'x-backup-created-at':created,'x-backup-size':String(bytes.length),'x-backup-sha256':sha,'x-backup-signature':await sign(secret,[protocol,'POST',origin,path,time,created,String(bytes.length),sha].join('\n'))};
 let response=await mf.dispatchFetch(origin+path,{method:'POST',body:bytes,headers});assert.equal(response.status,201,await response.clone().text());const raw=await response.text(),receipt=JSON.parse(raw);assert.equal(receipt.verified,true);assert.equal(receipt.duplicate,false);assert.equal(response.headers.get('x-backup-receipt-signature'),await sign(secret,receiptPurpose+'\n'+raw));
 response=await mf.dispatchFetch(origin+path,{method:'POST',body:bytes,headers});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).duplicate,true);
 const bucket=await mf.getR2Bucket('BACKUP_BUCKET');const stored=await bucket.get(receipt.key);assert(stored);assert.equal(await sha256(await stored.arrayBuffer()),sha);assert.equal((await bucket.list()).objects.length,1);
 for(const method of ['GET','DELETE']){response=await mf.dispatchFetch(origin+path,{method});assert.equal(response.status,405);}
 assert.equal((await bucket.list()).objects.length,1);
 console.log('PASS actual local workerd/R2 conditional create-only PUT, duplicate no overwrite, independent stored-byte SHA256, signed receipt and external read/delete denial');
}finally{if(mf)await mf.dispose();rmSync(directory,{recursive:true,force:true});}
await import('./test-v1-resource-r2-local.mjs');
await import('./test-multipart-r2-local.mjs');
