/** Private task-29 proposals. Never used by public rendering or publishing. */
import {CollectionError,resourceId,validateContent,type Scope,type Tour} from './collection-core';
import {D1Collections} from './collection-d1';
export const SEO_ORIGIN='https://derech-tkuma-review.22yarden22.workers.dev';
export type SeoValues={seo_title:string;meta_description:string|null;canonical:string;sitemap_entry:string};
export type SeoSource={id:string;content:Tour;version:number};
export type SeoEffect={kind:'seo_draft';effectKey:string;itemId:29;target:string;origin:typeof SEO_ORIGIN;source:SeoSource;values:SeoValues;expectedRecordRevision:number;expectedDraftRevision:number;publicationAllowed:false};
export type SeoDraft=Scope&{tourId:string;revision:number;state:'proposed'|'withdrawn';origin:typeof SEO_ORIGIN;sourceHash:string;sourcePublishedVersion:number;sourceRecordRevision:number;values:SeoValues|null;publicationAllowed:false;updatedAt:string;updatedBy:string;operationToken:string};
export type SeoReceipt={kind:'seo_draft';effectKey:string;state:'applied_draft'|'rolled_back';revision:number;requestHash:string;before:SeoDraft|null;after:SeoDraft;at:string;rollbackRevision?:number};
const canonical=(v:unknown):string=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as {[k:string]:unknown})[k])).join(',')+'}':Array.isArray(v)?'['+v.map(canonical).join(',')+']':JSON.stringify(v);
export async function seoHash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function exact(value:unknown,keys:string[]):asserts value is {[key:string]:unknown}{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw new CollectionError(400,'מבנה הצעת SEO אינו תקין');}
function revision(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||Number(value)<min)throw new CollectionError(400,'גרסת הצעת SEO אינה תקינה');}
function plain(value:string){
 // This recipe copies plain source text only. Markup/entities need editorial work.
 if(/<|>|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/iu.test(value))throw new CollectionError(403,'מקור SEO דורש בדיקה ידנית');
 return value.replace(/\s+/gu,' ').trim();
}
export function seoValues(source:SeoSource,origin=SEO_ORIGIN):SeoValues{
 const tour=validateContent('tour',source.content) as Tour;
 const path=tour.sourcePath??'/'+tour.slug+'/';let decoded;try{decoded=decodeURIComponent(path);}catch{throw new CollectionError(403,'נתיב SEO אינו תקין');}
 if(/%[a-f\d]{2}|[\x00-\x1f\x7f]/iu.test(decoded))throw new CollectionError(403,'נתיב SEO אינו תקין');
 const title=plain(tour.title),description=plain(tour.description);
 if(!title)throw new CollectionError(403,'כותרת מקור חסרה');
 const canonical=origin+path;
 return {seo_title:title,meta_description:description?[...description].slice(0,155).join(''):null,canonical,sitemap_entry:canonical};
}
export function seoIdentity(effect:Pick<SeoEffect,'kind'|'itemId'|'target'|'origin'|'source'>){return {kind:effect.kind,itemId:effect.itemId,target:effect.target,origin:effect.origin,source:effect.source};}
export function seoRequest(effect:SeoEffect){return {...seoIdentity(effect),values:effect.values,publicationAllowed:false};}
export async function seoEffectOf(input:unknown):Promise<SeoEffect>{
 exact(input,['kind','effectKey','itemId','target','origin','source','values','expectedRecordRevision','expectedDraftRevision','publicationAllowed']);
 if(input.kind!=='seo_draft'||input.itemId!==29||input.origin!==SEO_ORIGIN||input.publicationAllowed!==false||typeof input.effectKey!=='string'||!/^[a-f0-9]{64}$/.test(input.effectKey))throw new CollectionError(403,'הצעת SEO אינה בתכנית הטיוטות');
 resourceId(input.target);revision(input.expectedRecordRevision,1);revision(input.expectedDraftRevision);
 exact(input.source,['id','content','version']);resourceId(input.source.id);revision(input.source.version,1);
 if(input.source.id!==input.target||canonical(validateContent('tour',input.source.content))!==canonical(input.source.content))throw new CollectionError(403,'מקור הצעת SEO אינו תקין');
 const effect=input as unknown as SeoEffect;
 if(canonical(effect.values)!==canonical(seoValues(effect.source))||await seoHash(seoIdentity(effect))!==effect.effectKey)throw new CollectionError(403,'הצעת SEO אינה תואמת למקור');
 return effect;
}
function prefix(scope:Scope){for(const part of [scope.tenantId,scope.siteId])if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(part))throw new CollectionError(403,'הקשר הצעת SEO אינו תקין');return scope.tenantId+':'+scope.siteId+':';}
const draftKey=(scope:Scope,id:string)=>'cms_seo_draft:'+prefix(scope)+resourceId(id);
const historyKey=(scope:Scope,id:string,rev:number)=>'cms_seo_history:'+prefix(scope)+resourceId(id)+':'+String(rev).padStart(12,'0');
const receiptKey=(scope:Scope,key:string)=>{if(!/^[a-f0-9]{64}$/.test(key))throw new CollectionError(400,'מפתח הצעת SEO אינו תקין');return 'cms_seo_execution:'+prefix(scope)+key;};
export class SeoDraftStore extends D1Collections{
 private async setting<T>(key:string):Promise<T|null>{const row=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(key).first<{value:string}>();return row?JSON.parse(row.value) as T:null;}
 async draft(scope:Scope,id:string){return this.setting<SeoDraft>(draftKey(scope,id));}
 async receipt(scope:Scope,key:string){return this.setting<SeoReceipt>(receiptKey(scope,key));}
 async listDrafts(scope:Scope){const start='cms_seo_draft:'+prefix(scope);const rows=await this.db.prepare('SELECT value FROM cms_settings WHERE substr(key,1,?)=? ORDER BY key LIMIT 200').bind(start.length,start).all<{value:string}>();return rows.results.map(row=>JSON.parse(row.value) as SeoDraft).filter(row=>row.tenantId===scope.tenantId&&row.siteId===scope.siteId);}
 async historyDrafts(scope:Scope,id:string){const start='cms_seo_history:'+prefix(scope)+resourceId(id)+':';const rows=await this.db.prepare('SELECT value FROM cms_settings WHERE substr(key,1,?)=? ORDER BY key DESC LIMIT 100').bind(start.length,start).all<{value:string}>();return rows.results.map(row=>JSON.parse(row.value) as {operation:'save'|'restore';draft:SeoDraft});}
 async readback(scope:Scope,id:string){
  const record=await this.get(scope,'tour',resourceId(id));
  const source=record?.published?{id,content:record.published as Tour,version:record.publishedVersion}:null;
  const effectKey=source?await seoHash({kind:'seo_draft',itemId:29,target:id,origin:SEO_ORIGIN,source}):null;
  return {tourId:id,recordRevision:record?.revision??0,source,draft:await this.draft(scope,id),history:await this.historyDrafts(scope,id),receipt:effectKey?await this.receipt(scope,effectKey):null};
 }
 async applySeo(scope:Scope,input:unknown):Promise<SeoReceipt>{
  if(scope.tenantId!=='derech'||scope.siteId!=='derech-main')throw new CollectionError(403,'חיבור SEO אינו שייך לאתר');
  const effect=await seoEffectOf(input),requestHash=await seoHash(seoRequest(effect)),existing=await this.receipt(scope,effect.effectKey);
  if(existing){if(existing.requestHash!==requestHash)throw new CollectionError(409,'מפתח SEO כבר שימש לתוכן אחר');return existing;}
  const record=await this.get(scope,'tour',effect.target),previous=await this.draft(scope,effect.target);
  if(!record?.published||record.revision!==effect.expectedRecordRevision||canonical({id:record.id,content:record.published,version:record.publishedVersion})!==canonical(effect.source)||(previous?.revision??0)!==effect.expectedDraftRevision)throw new CollectionError(409,'מקור או טיוטת SEO השתנו; טען מחדש');
  const at=new Date().toISOString(),next:SeoDraft={...scope,tourId:effect.target,revision:(previous?.revision??0)+1,state:'proposed',origin:effect.origin,sourceHash:await seoHash(effect.source),sourcePublishedVersion:effect.source.version,sourceRecordRevision:record.revision,values:effect.values,publicationAllowed:false,updatedAt:at,updatedBy:'service:approved-execution:task29',operationToken:crypto.randomUUID()};
  const receipt:SeoReceipt={kind:'seo_draft',effectKey:effect.effectKey,state:'applied_draft',revision:next.revision,requestHash,before:previous,after:next,at};
  await this.atomicSeo(scope,previous,next,receipt,false,record.revision);
  // Report success only from the authoritative saved receipt and actual readback.
  const saved=await this.receipt(scope,effect.effectKey),draft=await this.draft(scope,effect.target);
  if(!saved||canonical(saved)!==canonical(receipt)||canonical(draft)!==canonical(next))throw new CollectionError(409,'לא התקבלה קבלת SEO תואמת');
  return saved;
 }
 async rollbackSeo(scope:Scope,key:string,expectedRevision:number,actorId:string):Promise<SeoReceipt>{
  revision(expectedRevision,1);const receipt=await this.receipt(scope,key);if(!receipt)throw new CollectionError(404,'ביצוע SEO לא נמצא');if(receipt.state==='rolled_back')return receipt;
  const previous=await this.draft(scope,receipt.after.tourId);
  if(!actorId||!previous||previous.revision!==expectedRevision||previous.revision!==receipt.revision||canonical(previous)!==canonical(receipt.after))throw new CollectionError(409,'טיוטת SEO נערכה מאז; אין שחזור אוטומטי');
  const at=new Date().toISOString(),next:SeoDraft={...(receipt.before??previous),revision:previous.revision+1,...(!receipt.before?{state:'withdrawn' as const,values:null}:{}),updatedAt:at,updatedBy:actorId,operationToken:crypto.randomUUID()};
  const rolled={...receipt,state:'rolled_back' as const,rollbackRevision:next.revision};
  await this.atomicSeo(scope,previous,next,rolled,true);
  return (await this.receipt(scope,key))!;
 }
 private async atomicSeo(scope:Scope,previous:SeoDraft|null,next:SeoDraft,receipt:SeoReceipt,replace:boolean,recordRevision?:number){
  const key=draftKey(scope,next.tourId),rkey=receiptKey(scope,receipt.effectKey),value=JSON.stringify(next);
  const sourceGuard=replace?'':" AND EXISTS (SELECT 1 FROM cms_records WHERE tenant_id=? AND site_id=? AND kind='tour' AND id=? AND revision=?)";
  const sourceArgs=replace?[]:[scope.tenantId,scope.siteId,next.tourId,recordRevision!];
  const receiptGuard=' AND '+(replace?'EXISTS':'NOT EXISTS')+' (SELECT 1 FROM cms_settings WHERE key=?)';
  const write=previous?this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=?'+receiptGuard+sourceGuard).bind(value,key,JSON.stringify(previous),rkey,...sourceArgs):this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM cms_settings WHERE key=?)'+receiptGuard+sourceGuard).bind(key,value,key,rkey,...sourceArgs);
  const guard='EXISTS (SELECT 1 FROM cms_settings WHERE key=? AND value=?)',audit={operation:replace?'restore':'save',draft:next};
  const result=await this.db.batch([write,this.db.prepare('INSERT INTO cms_settings(key,value) SELECT ?,? WHERE '+guard).bind(historyKey(scope,next.tourId,next.revision),JSON.stringify(audit),key,value),this.db.prepare(replace?'UPDATE cms_settings SET value=? WHERE key=? AND '+guard:'INSERT INTO cms_settings(value,key) SELECT ?,? WHERE '+guard).bind(JSON.stringify(receipt),rkey,key,value)]);
  if(result[0].meta.changes!==1)throw new CollectionError(409,'טיוטת SEO השתנתה בזמן השמירה');
 }
}
