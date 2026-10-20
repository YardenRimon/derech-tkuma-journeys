/** Purpose-scoped encrypted backup ingress. No external read/list/delete API. */
export const protocol='cms-ciphertext-upload-v1',receiptPurpose='cms-ciphertext-receipt-v1';
export const path='/v1/backups/derech/derech-main',maxBytes=16*1024*1024;
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
async function readBody(request,expected){const reader=request.body?.getReader();require(reader,400,'empty_body');const chunks=[];let total=0;for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes||total>expected){await reader.cancel();throw new Rejected(413,'body_limit');}chunks.push(value);}require(total===expected,400,'size_mismatch');const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;}
export async function receive(request,env,now=Date.now()){
 try{
  const url=new URL(request.url);
  require(request.method==='POST',405,'method_not_allowed');
  require(env.BACKUP_UPLOAD_ENABLED==='true'&&env.BACKUP_BUCKET&&typeof env.BACKUP_UPLOAD_HMAC==='string'&&/^[a-f0-9]{64}$/.test(env.BACKUP_UPLOAD_HMAC),503,'receiver_disabled');
  require(typeof env.BACKUP_RECEIVER_ORIGIN==='string'&&/^https:\/\/[^/?#]+$/.test(env.BACKUP_RECEIVER_ORIGIN)&&url.origin===env.BACKUP_RECEIVER_ORIGIN&&url.protocol==='https:'&&url.pathname===path&&!url.search&&!url.hash,404,'not_found');
  require(!request.headers.has('origin')&&!request.headers.has('cookie'),403,'browser_context_rejected');
  const time=request.headers.get('x-backup-time')??'',created=request.headers.get('x-backup-created-at')??'',sizeText=request.headers.get('x-backup-size')??'',sha=request.headers.get('x-backup-sha256')??'',signature=request.headers.get('x-backup-signature')??'';
  require(/^\d{10}$/.test(time)&&Math.abs(now/1000-Number(time))<=120,401,'signature_rejected');
  require(/^[1-9]\d{0,8}$/.test(sizeText)&&/^[a-f0-9]{64}$/.test(sha)&&/^[a-f0-9]{64}$/.test(signature),400,'invalid_metadata');
  const size=Number(sizeText);require(size<=maxBytes,413,'body_limit');
  const date=dateOf(created);require(now-date.getTime()>=-120000&&now-date.getTime()<=7*86400000,400,'capture_time_rejected');
  const key=await crypto.subtle.importKey('raw',unhex(env.BACKUP_UPLOAD_HMAC),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  require(await crypto.subtle.verify('HMAC',key,unhex(signature),utf8.encode(signingMessage(url.origin,time,created,sizeText,sha))),401,'signature_rejected');
  require(request.headers.get('content-type')==='application/pkcs7-mime',415,'encrypted_der_required');
  const declared=request.headers.get('content-length');if(declared!==null)require(declared===sizeText,400,'size_mismatch');
  const bytes=await readBody(request,size);require(await sha256(bytes)===sha,422,'digest_mismatch');checkEncryptedDer(bytes);
  const storageKey=objectKey(created,sha),metadata={protocol,tenantId:scope.tenantId,siteId:scope.siteId,createdAt:created,ciphertextSha256:sha};
  // If-None-Match:* is an atomic create-only precondition, including races.
  const stored=await env.BACKUP_BUCKET.put(storageKey,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:sha,httpMetadata:{contentType:'application/pkcs7-mime',cacheControl:'no-store'},customMetadata:metadata,storageClass:'Standard'});
  const object=stored??await env.BACKUP_BUCKET.head(storageKey);
  require(object&&object.key===storageKey&&object.size===size&&Object.entries(metadata).every(([k,v])=>object.customMetadata?.[k]===v),409,'stored_object_conflict');
  const copy=await env.BACKUP_BUCKET.get(storageKey,{onlyIf:{etagMatches:object.etag}});
  require(copy&&copy.body&&copy.size===size&&copy.etag===object.etag,502,'stored_copy_unverified');
  const returned=new Uint8Array(await copy.arrayBuffer());require(returned.byteLength===size&&await sha256(returned)===sha,502,'stored_copy_unverified');
  const receipt={protocol,scope,key:storageKey,createdAt:created,ciphertextBytes:size,ciphertextSha256:sha,objectEtag:object.etag,objectVersion:object.version,verified:true,duplicate:stored===null};
  const raw=JSON.stringify(receipt),receiptSignature=await sign(env.BACKUP_UPLOAD_HMAC,receiptPurpose+'\n'+raw);
  return new Response(raw,{status:stored?201:200,headers:{...headers,'content-type':'application/json','x-backup-receipt-signature':receiptSignature}});
 }catch(error){return reply({ok:false,code:error instanceof Rejected?error.message:'storage_unavailable'},error instanceof Rejected?error.status:503,request.method==='POST'?{}:{allow:'POST'});}
}
