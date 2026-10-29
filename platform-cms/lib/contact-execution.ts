/** Trusted hook for the existing signed execution lock. No endpoint, timer,
 * sender or retry. Configuration/compiled sacred calendar fail closed. */
import calendar from '../../independent-monitor/calendar.json';
import {CALENDAR_SHA256,LOOKAHEAD,validCalendar,calendarAllowed} from '../../independent-monitor/policy.mjs';
import {Contacts,ContactError,contactScope,type ContactScope,type ContactRecord} from './contact-core';
import {D1Contacts} from './contact-d1';
import {R2ContactPrivacy} from './contact-privacy';
import {contactRetentionDays} from './contact-controls';
import {deliverContact,verifiedMakeContract} from './contact-delivery';
export type ContactDeliveryConfig={CONTACT_DELIVERY_MODE?:string;CONTACT_DELIVERY_SECRET?:string;CONTACT_DELIVERY_CONTRACT_SHA256?:string;CONTACT_RETENTION_DAYS?:string;CONTACT_PRIVACY_AUTHORITY_ID?:string};
type DispatchResult={state:'disabled'|'unconfigured'|'held'|'unavailable'|'idle'|'conflict'|'erased'|'provider_accepted'|'unknown'|'failed'|'sending';receipt?:string};
class Held extends Error{}
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
/** Injection is code-owned fixture plumbing, never derived from a request,
 * visitor choice, environment calendar override or remote response. */
export function createContactDispatcher({clock=()=>Math.floor(Date.now()/1000),fetchImpl=globalThis.fetch,calendarValue=calendar}:{clock?:()=>number;fetchImpl?:typeof fetch;calendarValue?:unknown}={}){
 const fixedCalendar=freeze(JSON.parse(JSON.stringify(calendarValue)));
 // Verify the complete exact shared calendar once per dispatcher/isolate.
 const verified=Promise.resolve().then(async()=>validCalendar(fixedCalendar)&&await sha(JSON.stringify(fixedCalendar)+'\n')===CALENDAR_SHA256).catch(()=>false);
 const allowed=()=>calendarAllowed(fixedCalendar,clock(),LOOKAHEAD);
 const gate=()=>{if(!allowed())throw new Held();};
 return async function dispatch(db:D1Database,bucket:R2Bucket|undefined,scope:ContactScope,config:ContactDeliveryConfig):Promise<DispatchResult>{
  if(config.CONTACT_DELIVERY_MODE!=='verified-make')return{state:'disabled'};
  let accepted:Awaited<ReturnType<typeof verifiedMakeContract>>[],days:number;
  try{
   contactScope(scope);if(scope.tenantId!=='derech'||scope.siteId!=='derech-main')return{state:'unconfigured'};
   const secret=config.CONTACT_DELIVERY_SECRET,proof=config.CONTACT_DELIVERY_CONTRACT_SHA256;
   if(typeof secret!=='string'||!secret||secret.length>8192||typeof proof!=='string'||! /^[a-f0-9]{64}$/.test(proof)||await sha(secret)!==proof)return{state:'unconfigured'};
   const parsed=JSON.parse(secret),contracts=Array.isArray(parsed)?parsed:[parsed];
   if(!contracts.length||contracts.length>2)return{state:'unconfigured'};
   accepted=await Promise.all(contracts.map(contract=>verifiedMakeContract(contract,scope)));
   const ids=accepted.flatMap(value=>value.contract.formIds);
   if(new Set(ids).size!==ids.length||new Set(accepted.map(value=>value.contract.endpoint)).size!==accepted.length)return{state:'unconfigured'};
   days=contactRetentionDays(config);
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(config.CONTACT_PRIVACY_AUTHORITY_ID??''))return{state:'unconfigured'};
  }catch{return{state:'unconfigured'};}
  if(!await verified||!allowed())return{state:'held'};
  try{
   const privacy=new R2ContactPrivacy(bucket,config.CONTACT_PRIVACY_AUTHORITY_ID);
   await privacy.check(scope);gate();
   const prefix=`contact:v1:${scope.tenantId}:${scope.siteId}:`,ids=accepted.flatMap(value=>value.contract.formIds);
   // Read only an opaque key/revision until Contacts performs authoritative
   // privacy/expiry checks. The SQL cannot select unknown forms or other sites.
   const candidate=await db.prepare(`SELECT json_extract(value,'$.key') AS contactKey,json_extract(value,'$.revision') AS revision,json_extract(value,'$.source.formId') AS formId
    FROM cms_settings WHERE key LIKE ? AND json_valid(value) AND json_extract(value,'$.schema')=1
    AND json_extract(value,'$.scope.tenantId')=? AND json_extract(value,'$.scope.siteId')=?
    AND key=?||json_extract(value,'$.key') AND json_extract(value,'$.outbox.state')='pending_routing'
    AND json_extract(value,'$.source.formId') IN (${ids.map(()=>'?').join(',')})
    AND ((json_extract(value,'$.source.formId')='0899899' AND json_extract(value,'$.source.postId')='13')
      OR (json_extract(value,'$.source.formId')='af355f0' AND json_extract(value,'$.source.postId')='18')
      OR (json_extract(value,'$.source.formId')='1b8a2d8' AND json_extract(value,'$.source.postId')='1489'))
    ORDER BY key LIMIT 1`).bind(prefix+'%',scope.tenantId,scope.siteId,prefix,...ids).first<{contactKey:string;revision:number;formId:string}>();
   if(!candidate)return{state:'idle'};
   const selected=accepted.find(value=>value.contract.formIds.includes(candidate.formId));
   if(!selected)return{state:'unavailable'};
   if(typeof candidate.contactKey!=='string'||!Number.isSafeInteger(candidate.revision)||candidate.revision<1)return{state:'unavailable'};
   const service=new Contacts(new D1Contacts(db),days,privacy),guarded=Object.create(service) as Contacts;
   let claimed:ContactRecord|undefined;
   guarded.claim=async(s,key,revision,routing)=>{gate();const result=await service.claim(s,key,revision,routing,new Date(clock()*1000));claimed=result;gate();return result;};
   guarded.settle=async(s,key,token,outcome,receiptHash=null)=>{gate();return service.settle(s,key,token,outcome,receiptHash,new Date(clock()*1000));};
   const fetcher:typeof fetch=async(input,init)=>{
    gate();if(await privacy.get(scope,candidate.contactKey))throw new ContactError(410,'submission_erased');gate();
    const expiry=claimed?Math.min(Date.parse(claimed.retention?.expiresAt??new Date(Date.parse(claimed.createdAt)+days*86400000).toISOString()),Date.parse(claimed.createdAt)+days*86400000):0;
    if(!claimed||!Number.isFinite(expiry)||expiry<=clock()*1000)throw new ContactError(410,'submission_erased');
    // At most one attempt; redirects and automatic resubmission are forbidden.
    return fetchImpl(input,init);
   };
   const result=await deliverContact(guarded,scope,candidate.contactKey,candidate.revision,selected.contract,fetcher);
   if(result.state==='provider_accepted'||result.state==='unknown'||result.state==='failed')return{state:result.state,receipt:result.receipt};
   return{state:'unavailable'};
  }catch(error){
   if(error instanceof Held)return{state:'held'};
   if(error instanceof ContactError&&error.status===410)return{state:'erased'};
   if(error instanceof ContactError&&error.status===409)return{state:'conflict'};
   return{state:'unavailable'};
  }
 };
}
export const dispatchOneContact=createContactDispatcher();
