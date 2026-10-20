/** Monotonic erasure authority, independent of D1 snapshots. No person fields,
 * fingerprint, provider token or operator identity is retained in R2. */
import {ContactError,contactScope,type ContactScope,type ContactPrivacy,type ContactDeletionMarker} from './contact-core';
export const contactPrivacyPrefix='privacy/contact-erased/v1/';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function contactPrivacyKey(scope:ContactScope,key:string){contactScope(scope);if(!uuid.test(key))throw new ContactError(400,'invalid_idempotency_key');return `${contactPrivacyPrefix}${scope.tenantId}/${scope.siteId}/${key}.json`;}
export function contactPrivacyAuthorityKey(scope:ContactScope){contactScope(scope);return `${contactPrivacyPrefix}${scope.tenantId}/${scope.siteId}/authority.json`;}
export function parseContactPrivacyKey(value:string){
 if(!value.startsWith(contactPrivacyPrefix))return null;
 const parts=value.slice(contactPrivacyPrefix.length).split('/');
 if(parts.length!==3||!parts[2].endsWith('.json'))return null;
 const scope={tenantId:parts[0],siteId:parts[1]},key=parts[2].slice(0,-5);
 try{if(parts[2]==='authority.json'&&contactPrivacyAuthorityKey(scope)===value)return{scope,kind:'authority' as const};}catch{return null;}
 try{return contactPrivacyKey(scope,key)===value?{scope,key,kind:'marker' as const}:null;}catch{return null;}
}
export class R2ContactPrivacy implements ContactPrivacy{
 bucket:R2Bucket|undefined;authorityId:string|undefined;checked=new Set<string>();
 constructor(bucket:R2Bucket|undefined,authorityId?:string){this.bucket=bucket;this.authorityId=authorityId;}
 async check(scope:ContactScope){
  try{
   const key=contactPrivacyAuthorityKey(scope);if(this.checked.has(key))return;
   if(!this.bucket||!this.authorityId||!uuid.test(this.authorityId))throw new Error('missing_authority');
   const object=await this.bucket.get(key);if(!object||object.size>2048)throw new Error('unknown_authority');
   const value=JSON.parse(await object.text());
   if(!value||Object.keys(value).sort().join(',')!=='authorityId,schema,scope'||value.schema!==1||value.authorityId!==this.authorityId||!value.scope||Object.keys(value.scope).sort().join(',')!=='siteId,tenantId'||value.scope.tenantId!==scope.tenantId||value.scope.siteId!==scope.siteId)throw new Error('unknown_authority');
   this.checked.add(key);
  }catch{throw new ContactError(503,'contact_privacy_unavailable');}
 }
 async get(scope:ContactScope,key:string):Promise<ContactDeletionMarker|null>{
  try{
   await this.check(scope);if(!this.bucket)throw new Error('missing_binding');
   const object=await this.bucket.get(contactPrivacyKey(scope,key));if(!object)return null;
   if(object.size>2048)throw new Error('invalid_marker');
   const marker=JSON.parse(await object.text()) as ContactDeletionMarker;
   if(!marker||Object.keys(marker).sort().join(',')!=='erasedAt,key,reason,schema,scope'||marker.schema!==1||marker.key!==key||!marker.scope||Object.keys(marker.scope).sort().join(',')!=='siteId,tenantId'||marker.scope.tenantId!==scope.tenantId||marker.scope.siteId!==scope.siteId||!['expired','requested'].includes(marker.reason)||typeof marker.erasedAt!=='string'||!Number.isFinite(Date.parse(marker.erasedAt))||new Date(marker.erasedAt).toISOString()!==marker.erasedAt)throw new Error('invalid_marker');
   return marker;
  }catch{throw new ContactError(503,'contact_privacy_unavailable');}
 }
 async ensure(marker:ContactDeletionMarker){
  try{
   const existing=await this.get(marker.scope,marker.key);if(existing)return existing;
   if(!this.bucket)throw new Error('missing_binding');
   // R2 conditional creation never overwrites an earlier marker. There is no
   // deletion method and no expiry. D1/media restore must preserve this prefix.
   await this.bucket.put(contactPrivacyKey(marker.scope,marker.key),JSON.stringify(marker),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},customMetadata:{purpose:'contact-erasure-v1'}});
   const persisted=await this.get(marker.scope,marker.key);if(!persisted)throw new Error('unverified_marker');return persisted;
  }catch{throw new ContactError(503,'contact_privacy_unavailable');}
 }
}

/** Deliberate owner initialization only; never auto-run on intake or restore.
 * The nonsecret ID must be pinned in deployment config and preserved forever. */
export async function initializeContactPrivacyAuthority(bucket:R2Bucket,scope:ContactScope,authorityId:string){
 if(!uuid.test(authorityId))throw new ContactError(503,'contact_privacy_unavailable');
 const key=contactPrivacyAuthorityKey(scope),existing=await bucket.get(key);
 if(!existing)await bucket.put(key,JSON.stringify({schema:1,scope:{...scope},authorityId}),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},customMetadata:{purpose:'contact-erasure-authority-v1'}});
 await new R2ContactPrivacy(bucket,authorityId).check(scope);
 return{verified:true as const,authorityId};
}
