import {receiveMultipart,multipartPath,encryptedPrefix,claimV1FinalKey,inspectExistingFinalKey} from './multipart-core.mjs';
/** Purpose-scoped encrypted backup ingress. No external read/list/delete API. */
export const protocol='cms-ciphertext-upload-v1',receiptPurpose='cms-ciphertext-receipt-v1';
export const path='/v1/backups/derech/derech-main',maxBytes=16*1024*1024;
export const v1WriteMax=8*1024*1024,verifyExistingPath=path+'/verify-existing',verifyExistingPurpose='cms-ciphertext-verify-existing-v1';
export const verifyExistingMessage=(origin,time,created,size,sha)=>[verifyExistingPurpose,'POST',origin,verifyExistingPath,time,created,size,sha].join('\n');
const scope={tenantId:'derech',siteId:'derech-main'};
const utf8=new TextEncoder(),hex=x=>[...new Uint8Array(x)].map(n=>n.toString(16).padStart(2,'0')).join('');
const unhex=s=>new Uint8Array(s.match(/../g).map(x=>parseInt(x,16)));
export const sha256=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
export async function sign(secret,message){const key=await crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,utf8.encode(message)));}
export const signingMessage=(origin,time,created,size,sha)=>[protocol,'POST',origin,path,time,created,size,sha].join('\n');
export function objectKey(created,sha){return `derech/derech-main/${created.slice(0,4)}/${created.slice(4,6)}/${created.slice(6,8)}/${created}-${sha}.cms`;}
class Rejected extends Error{constructor(status,code){super(code);this.status=status;}}
function require(ok,status,code){if(!ok)throw new Rejected(status,code);}
const headers={'cache-control':'no-store','x-robots-tag':'noindex, nofollow, noarchive','x-content-type-options':'nosniff'};
function reply(value,status=200,extra={}){return new Response(JSON.stringify(value),{status,headers:{...headers,'content-type':'application/json',...extra}});}
function dateOf(stamp){require(/^\d{8}T\d{6}Z$/.test(stamp),400,'invalid_metadata');const value=new Date(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(9,11)}:${stamp.slice(11,13)}:${stamp.slice(13,15)}Z`);require(!Number.isNaN(value.getTime())&&value.toISOString().replace(/[-:]/g,'').replace('.000','')===stamp,400,'invalid_metadata');return value;}
function derItem(bytes,offset,tag){require(bytes[offset]===tag,422,'encrypted_der_required');let length=bytes[offset+1],start=offset+2;require(length!==undefined,422,'encrypted_der_required');if(length&128){const count=length&127;require(count>=1&&count<=4&&bytes[start]!==0,422,'encrypted_der_required');length=0;for(let i=0;i<count;i++){require(start+i<bytes.length,422,'encrypted_der_required');length=length*256+bytes[start+i];}start+=count;require(length>=128,422,'encrypted_der_required');}require(start+length<=bytes.length,422,'encrypted_der_required');return{start,end:start+length};}
export function checkEncryptedDer(bytes){
 // Public ContentInfo envelope/OID check; neither Worker nor VPS has a private
 // decrypt key. Uploader also runs OpenSSL CMS parsing before any network call.
 const top=derItem(bytes,0,0x30);require(top.end===bytes.length,422,'encrypted_der_required');
 const oid=derItem(bytes,top.start,0x06),expected='2a864886f70d010703';require(hex(bytes.slice(oid.start,oid.end))===expected,422,'encrypted_der_required');
 const explicit=derItem(bytes,oid.end,0xa0);require(explicit.end===top.end,422,'encrypted_der_required');
 const envelope=derItem(bytes,explicit.start,0x30);require(envelope.end===explicit.end&&envelope.end-envelope.start>32,422,'encrypted_der_required');
 const aes=Uint8Array.from([6,9,0x60,0x86,0x48,1,0x65,3,4,1,0x2a]);let found=false;
 for(let i=envelope.start;i<=envelope.end-aes.length;i++)if(aes.every((x,j)=>bytes[i+j]===x)){found=true;break;}
 require(found,422,'aes256_envelope_required');
}
async function readBody(request,expected){
 const reader=request.body?.getReader();require(reader,400,'empty_body');
 // The authenticated size is already bounded. Keep one owned input allocation,
 // rather than retaining every source chunk and then allocating a second copy.
 const bytes=new Uint8Array(expected);let total=0,finished=false;
 try{for(;;){const{done,value}=await reader.read();if(done){finished=true;break;}require(value instanceof Uint8Array,400,'size_mismatch');require(value.byteLength<=expected-total&&value.byteLength<=maxBytes-total,413,'body_limit');bytes.set(value,total);total+=value.byteLength;}require(total===expected,400,'size_mismatch');return bytes;}
 finally{if(!finished)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function verifyStoredBody(body,expected,sha,checkPrefix=false){
 require(body&&typeof body.pipeThrough==='function',502,'stored_copy_unverified');
 // Workers' native incremental digest consumes the independently fetched R2
 // bytes. No arrayBuffer/retained chunks/full second ciphertext allocation, and
 // no production fallback that could weaken stored-byte verification.
 const digest=new crypto.DigestStream('SHA-256');let total=0,prefixBytes=0;const prefix=checkPrefix?new Uint8Array(Math.min(expected,65536)):null;
 const result=digest.digest;void result.catch(()=>{});
 try{await body.pipeThrough(new TransformStream({transform(chunk,controller){require(chunk instanceof Uint8Array&&chunk.byteLength<=expected-total,502,'stored_copy_unverified');if(prefix&&prefixBytes<prefix.length){const part=chunk.subarray(0,prefix.length-prefixBytes);prefix.set(part,prefixBytes);prefixBytes+=part.length;}total+=chunk.byteLength;controller.enqueue(chunk);}})).pipeTo(digest);require(total===expected&&hex(await result)===sha,502,'stored_copy_unverified');}
 catch{throw new Rejected(502,'stored_copy_unverified');}
 if(prefix){try{encryptedPrefix(prefix,expected);}catch{throw new Rejected(422,'encrypted_der_required');}}
}
async function existingKind(bucket,object,created,sha,size){try{return await inspectExistingFinalKey(bucket,object,created,sha,size);}catch(error){if(error?.status)throw new Rejected(409,'stored_object_conflict');throw error;}}
async function legacyReceipt(env,object,created,sha,size,{duplicate=true,status=200,checkPrefix=true}={}){
 const storageKey=objectKey(created,sha);require(await existingKind(env.BACKUP_BUCKET,object,created,sha,size)==='v1',409,'stored_object_conflict');
 require(object.httpMetadata?.contentType==='application/pkcs7-mime'&&typeof object.etag==='string'&&typeof object.version==='string'&&[object.etag,object.version].every(v=>v.length>0&&v.length<=256&&/^[\x20-\x7e]+$/.test(v)),409,'stored_object_conflict');
 const copy=await env.BACKUP_BUCKET.get(storageKey,{onlyIf:{etagMatches:object.etag}});require(copy?.body&&copy.key===storageKey&&copy.size===size&&copy.etag===object.etag&&copy.version===object.version,502,'stored_copy_unverified');await verifyStoredBody(copy.body,size,sha,checkPrefix);
 const final=await env.BACKUP_BUCKET.head(storageKey);require(final&&final.etag===object.etag&&final.version===object.version&&await existingKind(env.BACKUP_BUCKET,final,created,sha,size)==='v1',409,'stored_object_conflict');
 const receipt={protocol,scope,key:storageKey,createdAt:created,ciphertextBytes:size,ciphertextSha256:sha,objectEtag:object.etag,objectVersion:object.version,verified:true,duplicate},raw=JSON.stringify(receipt);return new Response(raw,{status,headers:{...headers,'content-type':'application/json','x-backup-receipt-signature':await sign(env.BACKUP_UPLOAD_HMAC,receiptPurpose+'\n'+raw)}});
}
export async function receive(request,env,now=Date.now()){
 if(new URL(request.url).pathname.startsWith(multipartPath+'/'))return receiveMultipart(request,env,now);
 try{
  const url=new URL(request.url),verifyOnly=url.pathname===verifyExistingPath;
  require(request.method==='POST',405,'method_not_allowed');
  require(env.BACKUP_UPLOAD_ENABLED==='true'&&env.BACKUP_BUCKET&&typeof env.BACKUP_UPLOAD_HMAC==='string'&&/^[a-f0-9]{64}$/.test(env.BACKUP_UPLOAD_HMAC),503,'receiver_disabled');
  require(typeof env.BACKUP_RECEIVER_ORIGIN==='string'&&/^https:\/\/[^/?#]+$/.test(env.BACKUP_RECEIVER_ORIGIN)&&url.origin===env.BACKUP_RECEIVER_ORIGIN&&url.protocol==='https:'&&(url.pathname===path||verifyOnly)&&!url.search&&!url.hash,404,'not_found');
  require(!request.headers.has('origin')&&!request.headers.has('cookie'),403,'browser_context_rejected');
  const time=request.headers.get('x-backup-time')??'',created=request.headers.get('x-backup-created-at')??'',sizeText=request.headers.get('x-backup-size')??'',sha=request.headers.get('x-backup-sha256')??'',signature=request.headers.get('x-backup-signature')??'';
  require(/^\d{10}$/.test(time)&&Math.abs(now/1000-Number(time))<=120,401,'signature_rejected');require(/^[1-9]\d{0,8}$/.test(sizeText)&&/^[a-f0-9]{64}$/.test(sha)&&/^[a-f0-9]{64}$/.test(signature),400,'invalid_metadata');const size=Number(sizeText);require(size<=maxBytes,413,'body_limit');
  const date=dateOf(created);require(now-date.getTime()>=-120000&&now-date.getTime()<=7*86400000,400,'capture_time_rejected');const key=await crypto.subtle.importKey('raw',unhex(env.BACKUP_UPLOAD_HMAC),{name:'HMAC',hash:'SHA-256'},false,['verify']),message=(verifyOnly?verifyExistingMessage:signingMessage)(url.origin,time,created,sizeText,sha);require(await crypto.subtle.verify('HMAC',key,unhex(signature),utf8.encode(message)),401,'signature_rejected');
  require(request.headers.get('content-type')===(verifyOnly?'application/json':'application/pkcs7-mime'),415,verifyOnly?'content_type_rejected':'encrypted_der_required');const declared=request.headers.get('content-length');if(declared!==null)require(declared===(verifyOnly?'2':sizeText),400,'size_mismatch');const storageKey=objectKey(created,sha),bucket=env.BACKUP_BUCKET;
  if(verifyOnly){const control=await readBody(request,2);require(control[0]===123&&control[1]===125,400,'invalid_operation');const object=await bucket.head(storageKey);require(object,404,'existing_v1_not_found');const kind=await existingKind(bucket,object,created,sha,size);require(kind!=='v2',404,'existing_v1_not_found');return await legacyReceipt(env,object,created,sha,size);}
  // Compatibility for an old client is existing-object verification only.
  // Never allocate/read/PUT a new incoming v1 ciphertext above the write bound.
  if(size>v1WriteMax){const object=await bucket.head(storageKey);require(object,413,'body_limit');return await legacyReceipt(env,object,created,sha,size);}
  const bytes=await readBody(request,size);require(await sha256(bytes)===sha,422,'digest_mismatch');checkEncryptedDer(bytes);const prior=await bucket.head(storageKey);if(prior)return await legacyReceipt(env,prior,created,sha,size,{checkPrefix:false});
  try{await claimV1FinalKey(bucket,created,sha,size);}catch(error){if(error?.status)throw new Rejected(409,'stored_object_conflict');throw error;}
  const metadata={protocol,tenantId:scope.tenantId,siteId:scope.siteId,createdAt:created,ciphertextSha256:sha},stored=await bucket.put(storageKey,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:sha,httpMetadata:{contentType:'application/pkcs7-mime',cacheControl:'no-store'},customMetadata:metadata,storageClass:'Standard'}),object=stored??await bucket.head(storageKey);require(object,409,'stored_object_conflict');return await legacyReceipt(env,object,created,sha,size,{duplicate:stored===null,status:stored?201:200,checkPrefix:false});
 }catch(error){return reply({ok:false,code:error instanceof Rejected?error.message:'storage_unavailable'},error instanceof Rejected?error.status:503,request.method==='POST'?{}:{allow:'POST'});}
}
