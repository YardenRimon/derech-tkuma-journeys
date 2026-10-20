/** Memory-only immutable R2 fixture. Never connected to a provider binding. */
export const fixtureContactPrivacyAuthority='10000000-0000-4000-8000-000000000005';
export function contactPrivacyBucket(){
 const initial=new Map();for(const scope of [{tenantId:'derech',siteId:'derech-main'},{tenantId:'other',siteId:'other-main'}])initial.set(`privacy/contact-erased/v1/${scope.tenantId}/${scope.siteId}/authority.json`,JSON.stringify({schema:1,scope,authorityId:fixtureContactPrivacyAuthority}));
 return {objects:initial,failRead:false,failWrite:false,
  async get(key){if(this.failRead)throw new Error('fixture_unavailable');const value=this.objects.get(key);return value===undefined?null:{key,size:Buffer.byteLength(value),async text(){return value;}};},
  async put(key,value,options){if(this.failWrite)throw new Error('fixture_unavailable');if(options?.onlyIf?.etagDoesNotMatch==='*'&&this.objects.has(key))return null;this.objects.set(key,String(value));return{key,etag:'fixture'};}
 };
}
export function contactPrivacy(){const records=new Map();return{async check(){},async get(scope,key){return structuredClone(records.get(JSON.stringify([scope,key]))??null);},async ensure(marker){const key=JSON.stringify([marker.scope,marker.key]);if(!records.has(key))records.set(key,structuredClone(marker));return structuredClone(records.get(key));}};}
