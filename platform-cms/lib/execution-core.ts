import { CollectionError, validateContent, type Tour, type Scope, type Record as ContentRecord, type Snapshot } from './collection-core';
import { D1Collections } from './collection-d1';
export type Effect = {effectKey:string;itemId:10;target:'route-oz';before:Tour;after:Tour};
export type Receipt = {effectKey:string;state:'applied_draft'|'rolled_back'|'conflict';revision:number;requestHash:string;before:ContentRecord|null;after:ContentRecord;at:string;rollbackRevision?:number};
export const receiptKey=(key:string)=>`cms_execution:${key}`;
export function effectOf(input:unknown):Effect {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CollectionError(400,'עדכון תוכן אינו תקין');
 const x=input as Effect;
 if(Object.keys(x).sort().join(',')!=='after,before,effectKey,itemId,target'||!/^[a-f0-9]{64}$/.test(x.effectKey)||x.itemId!==10||x.target!=='route-oz')throw new CollectionError(403,'העדכון אינו בתכנית המאושרת');
 const before=validateContent('tour',x.before) as Tour,after=validateContent('tour',x.after) as Tour;
 if(before.slug!=='עוז-מול-תופת'||before.title!=='עוז מול תופת'||Object.keys({...before,...after}).some(k=>k!=='description'&&JSON.stringify(before[k as keyof Tour])!==JSON.stringify(after[k as keyof Tour]))||!/^במסלול עוז מול תופת יש [1-9][0-9]? נקודות עצירה\.$/.test(after.description)||before.description===after.description)throw new CollectionError(403,'רק תיקון מספר התחנות המאושר מותר');
 return {effectKey:x.effectKey,itemId:10,target:'route-oz',before,after};
}
const canonical=(v:unknown):string=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as {[k:string]:unknown})[k])).join(',')+'}':Array.isArray(v)?'['+v.map(canonical).join(',')+']':JSON.stringify(v);
export async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function verifySignature(raw:string,time:string|null,signature:string|null,secret:string|undefined,now=Date.now()) {
 if(!secret||secret.length<40)throw new CollectionError(503,'חיבור השרת טרם הוגדר');
 if(!time||!/^\d{10}$/.test(time)||Math.abs(now-Number(time)*1000)>300000||!signature||!/^[a-f0-9]{64}$/.test(signature))throw new CollectionError(401,'חתימת שרת אינה תקינה');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new Uint8Array(signature.match(/../g)!.map(x=>parseInt(x,16)));
 if(!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(time+'\n'+raw)))throw new CollectionError(401,'חתימת שרת אינה תקינה');
}
export class ExecutionStore extends D1Collections {
 async receipt(key:string):Promise<Receipt|null>{const row=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(receiptKey(key)).first<{value:string}>();return row?JSON.parse(row.value):null;}
 async apply(scope:Scope,input:unknown):Promise<Receipt> {
  const effect=effectOf(input),requestHash=await hash(effect),existing=await this.receipt(effect.effectKey);
  if(existing){if(existing.requestHash!==requestHash)throw new CollectionError(409,'מפתח הביצוע כבר שימש לתוכן אחר');return existing;}
  const previous=await this.get(scope,'tour',effect.target);
  if(!previous||canonical(previous.draft)!==canonical(effect.before))throw new CollectionError(409,'התוכן השתנה; העדכון נשמר לבדיקה ולא נדרס');
  const at=new Date().toISOString(),next={...previous,draft:effect.after,revision:previous.revision+1,updatedAt:at,updatedBy:'service:approved-execution'};
  const receipt:Receipt={effectKey:effect.effectKey,state:'applied_draft',revision:next.revision,requestHash,before:previous,after:next,at};
  await this.atomic(previous,next,{version:next.revision,operation:'save',record:next,actorId:next.updatedBy,at},receipt,false);
  return receipt;
 }
 async rollback(scope:Scope,key:string,expectedRevision:number,actorId:string):Promise<Receipt>{
  if(!/^[a-f0-9]{64}$/.test(key))throw new CollectionError(400,'מפתח ביצוע אינו תקין');
  const receipt=await this.receipt(key);if(!receipt)throw new CollectionError(404,'הביצוע לא נמצא');
  if(receipt.state==='rolled_back')return receipt;
  const previous=await this.get(scope,'tour','route-oz');
  if(!previous||previous.revision!==expectedRevision||previous.revision!==receipt.revision||canonical(previous)!==canonical(receipt.after))throw new CollectionError(409,'קיימת עריכה חדשה יותר; יש לבדוק את ההיסטוריה לפני שחזור');
  const at=new Date().toISOString(),next={...previous,draft:receipt.before?.draft??null,revision:previous.revision+1,updatedAt:at,updatedBy:actorId};
  const rolled={...receipt,state:'rolled_back' as const,rollbackRevision:next.revision};
  await this.atomic(previous,next,{version:next.revision,operation:'restore',record:next,actorId,at},rolled,true);return rolled;
 }
 private async atomic(previous:ContentRecord,next:ContentRecord,audit:Snapshot,receipt:Receipt,replace:boolean){
  const token=crypto.randomUUID(),{tenantId,siteId,kind,id}=next;
  const guard='SELECT tenant_id,site_id,kind,id,revision FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND operation_token=?';
  const args=[tenantId,siteId,kind,id,token];
  const result=await this.db.batch([
   this.db.prepare('UPDATE cms_records SET record_json=?,published_json=?,published_version=?,revision=?,updated_at=?,operation_token=? WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND revision=? AND '+(replace?'EXISTS':'NOT EXISTS')+' (SELECT 1 FROM cms_settings WHERE key=?)').bind(JSON.stringify(next),next.published===null?null:JSON.stringify(next.published),next.publishedVersion,next.revision,next.updatedAt,token,tenantId,siteId,kind,id,previous.revision,receiptKey(receipt.effectKey)),
   this.db.prepare(`INSERT INTO cms_record_history (tenant_id,site_id,kind,id,version,snapshot_json) SELECT tenant_id,site_id,kind,id,revision,? FROM (${guard})`).bind(JSON.stringify(audit),...args),
   this.db.prepare(replace?`UPDATE cms_settings SET value=? WHERE key=? AND EXISTS (${guard})`:`INSERT INTO cms_settings (value,key) SELECT ?,? WHERE EXISTS (${guard})`).bind(JSON.stringify(receipt),receiptKey(receipt.effectKey),...args)
  ]);
  if(result[0].meta.changes!==1)throw new CollectionError(409,'התוכן השתנה בזמן העדכון');
 }
}
