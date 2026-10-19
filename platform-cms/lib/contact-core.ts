/** Server-only contact intake. Captured configuration is not proof of delivery. */
export const CONTACT_POLICY = 'source-2026-10-19';
export const CONTACT_FORMS = {
 '0899899': { postId:'13', kind:'home', sourceActionsVerified:true },
 '1b8a2d8': { postId:'1489', kind:'footer', sourceActionsVerified:false },
 'af355f0': { postId:'18', kind:'routes', sourceActionsVerified:true },
 'c5cb8a0': { postId:'5133', kind:'rating', sourceActionsVerified:false },
 'aa2b8e0': { postId:'5982', kind:'quote', sourceActionsVerified:false },
} as const;
export type ContactScope = {tenantId:string;siteId:string};
export type ContactInput = {idempotencyKey:string;formId:keyof typeof CONTACT_FORMS;fullName:string;phone:string;email:string;consent:{contact:true;policyVersion:typeof CONTACT_POLICY};honeypot:string};
export type ContactRecord = {schema:1;scope:ContactScope;key:string;receipt:string;fingerprint:string;source:{formId:string;postId:string};fields:{fullName:string;phone:string;email:string};consent:{contact:true;policyVersion:string;receivedAt:string};createdAt:string;revision:number;outbox:{state:'pending_routing'|'sending'|'provider_accepted'|'unknown'|'failed';attemptToken:string|null;contractId:string|null;receiptHash:string|null}};
export interface ContactStore {get(scope:ContactScope,key:string):Promise<ContactRecord|null>;insert(record:ContactRecord):Promise<boolean>;cas(previous:ContactRecord,next:ContactRecord):Promise<boolean>}
export class ContactError extends Error {status:number;code:string;constructor(status:number,code:string){super(code);this.status=status;this.code=code;}}
function fail(status:number,code:string):never{throw new ContactError(status,code);}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function contactScope(scope:ContactScope){if(!scope||![scope.tenantId,scope.siteId].every(x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(x)))fail(503,'scope_unavailable');return scope;}
function text(value:unknown,max:number){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail(400,'invalid_submission');return value.normalize('NFC').trim().replace(/\s+/g,' ');}
export function validateContact(value:unknown):ContactInput{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail(400,'invalid_submission');
 const x=value as Record<string,unknown>;
 if(Object.keys(x).some(k=>!['idempotencyKey','formId','fullName','phone','email','consent','honeypot'].includes(k)))fail(400,'invalid_submission');
 if(typeof x.idempotencyKey!=='string'||!uuid.test(x.idempotencyKey))fail(400,'invalid_idempotency_key');
 if(typeof x.formId!=='string'||!Object.hasOwn(CONTACT_FORMS,x.formId))fail(400,'unknown_form');
 const formId=x.formId as keyof typeof CONTACT_FORMS;
 // Footer, rating and quote backend contracts are not yet known. Do not invent
 // lead semantics, signature storage, order amounts or routing for those forms.
 if(!CONTACT_FORMS[formId].sourceActionsVerified)fail(503,'form_contract_pending');
 if(x.honeypot!=='')fail(400,'invalid_submission');
 const c=x.consent as Record<string,unknown>|undefined;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['contact','policyVersion'].includes(k))||c.contact!==true||c.policyVersion!==CONTACT_POLICY)fail(400,'consent_required');
 const fullName=text(x.fullName,120);if(fullName.length<2)fail(400,'invalid_submission');
 let phone=text(x.phone,32);if(!/^[+0-9() -]+$/.test(phone))fail(400,'invalid_submission');phone=phone.replace(/[() -]/g,'');
 if(/^0[2-9]\d{7,8}$/.test(phone))phone='+972'+phone.slice(1);
 if(!/^\+[1-9]\d{7,14}$/.test(phone))fail(400,'invalid_submission');
 const email=text(x.email,254).toLowerCase();if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))fail(400,'invalid_submission');
 return{idempotencyKey:(x.idempotencyKey as string).toLowerCase(),formId,fullName,phone,email,consent:{contact:true,policyVersion:CONTACT_POLICY},honeypot:''};
}
export async function contactHash(value:unknown){const raw=JSON.stringify(value);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export type VerifiedContactRouting={kind:'make';verified:true;contractId:string;scope:ContactScope;formIds:string[]};
export class Contacts{
 store:ContactStore;
 constructor(store:ContactStore){this.store=store;}
 async submit(scope:ContactScope,value:unknown,now=new Date()){
  contactScope(scope);const input=validateContact(value),source={formId:input.formId,postId:CONTACT_FORMS[input.formId].postId};
  const fields={fullName:input.fullName,phone:input.phone,email:input.email};
  const fingerprint=await contactHash({scope,source,fields,consent:input.consent});
  let previous=await this.store.get(scope,input.idempotencyKey);
  if(previous){if(previous.fingerprint!==fingerprint)fail(409,'idempotency_conflict');return this.publicReceipt(previous);}
  const at=now.toISOString();const record:ContactRecord={schema:1,scope:{...scope},key:input.idempotencyKey,receipt:crypto.randomUUID(),fingerprint,source,fields,consent:{...input.consent,receivedAt:at},createdAt:at,revision:1,outbox:{state:'pending_routing',attemptToken:null,contractId:null,receiptHash:null}};
  if(!await this.store.insert(record)){previous=await this.store.get(scope,input.idempotencyKey);if(!previous||previous.fingerprint!==fingerprint)fail(409,'idempotency_conflict');return this.publicReceipt(previous);}
  return this.publicReceipt(record);
 }
 publicReceipt(record:ContactRecord){return{accepted:true as const,receipt:record.receipt,state:'stored_pending_processing' as const};}
 async claim(scope:ContactScope,key:string,expectedRevision:number,routing:VerifiedContactRouting|null){
  contactScope(scope);
  if(!routing||routing.kind!=='make'||routing.verified!==true||!/^[a-f0-9]{64}$/.test(routing.contractId)||routing.scope.tenantId!==scope.tenantId||routing.scope.siteId!==scope.siteId)fail(503,'routing_unverified');
  const record=await this.store.get(scope,key);if(!record)fail(404,'not_found');
  if(!routing.formIds.includes(record.source.formId)||record.revision!==expectedRevision||record.outbox.state!=='pending_routing')fail(409,'delivery_conflict');
  const next:ContactRecord={...record,revision:record.revision+1,outbox:{state:'sending',attemptToken:crypto.randomUUID(),contractId:routing.contractId,receiptHash:null}};
  if(!await this.store.cas(record,next))fail(409,'delivery_conflict');return next;
 }
 async settle(scope:ContactScope,key:string,token:string,outcome:'provider_accepted'|'unknown'|'failed',receiptHash:string|null=null){
  contactScope(scope);if(!['provider_accepted','unknown','failed'].includes(outcome)||receiptHash!==null&&!/^[a-f0-9]{64}$/.test(receiptHash)||outcome==='provider_accepted'&&!receiptHash)fail(400,'invalid_delivery_receipt');
  const previous=await this.store.get(scope,key);if(!previous||previous.outbox.state!=='sending'||previous.outbox.attemptToken!==token)fail(409,'delivery_conflict');
  const next:ContactRecord={...previous,revision:previous.revision+1,outbox:{...previous.outbox,state:outcome,receiptHash}};
  if(!await this.store.cas(previous,next))fail(409,'delivery_conflict');return next;
 }
}
/** Deliberately unconnected: source configuration alone does not verify a Make
 * scenario, recipients, idempotency, provider acknowledgement or mail delivery. */
export function unconnectedMakeAdapter(){return{connected:false as const,async deliver(_record:ContactRecord):Promise<never>{return fail(503,'routing_unverified');}};}
export type ContactConfig={CONTACT_MODE?:string;CONTACT_ORIGIN?:string};
export function contactEnabled(config:ContactConfig,requestOrigin:string){
 if(config.CONTACT_MODE!=='receive-only'||!config.CONTACT_ORIGIN||!['https://derech-tkuma.com','https://www.derech-tkuma.com'].includes(config.CONTACT_ORIGIN)||requestOrigin!==config.CONTACT_ORIGIN)fail(503,'contact_disabled');
}
export async function readContactRequest(request:Request,config:ContactConfig){
 const url=new URL(request.url);contactEnabled(config,url.origin);
 if(url.search||request.headers.get('origin')!==url.origin||!['same-origin','none'].includes(request.headers.get('sec-fetch-site')??'same-origin'))fail(403,'origin_rejected');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))fail(415,'json_required');
 const reader=request.body?.getReader();if(!reader)fail(400,'invalid_submission');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>10000){await reader.cancel();fail(413,'request_too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{return fail(400,'invalid_submission');}
}
