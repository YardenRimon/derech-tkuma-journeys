/** Isolated transport for the existing verified Make route. Never invoked by
 * public intake; no dispatch endpoint, timer, sender, fallback or auto-retry. */
import {Contacts,ContactError,contactHash,CONTACT_FORMS,contactScope,type ContactScope,type ContactRecord,type VerifiedContactRouting} from './contact-core';
type Field='fullName'|'phone'|'email'|'message'|'formId'|'postId'|'consentAt'|'receipt';
export type MakeContactContract={
 schema:1;kind:'make';verified:true;scope:ContactScope;formIds:string[];
 endpoint:string;fields:Record<string,Field>;
 idempotency:{header:string;verified:true};
 acknowledgement:{status:200|201|202;field:string;value:string;receiptField:string};
 timeoutMs:number;
};
const baseFields:Field[]=['fullName','phone','email','formId','postId','consentAt','receipt'];
const exact=(x:Record<string,unknown>,names:string[])=>Object.keys(x).length===names.length&&names.every(name=>Object.hasOwn(x,name));
export async function verifiedMakeContract(value:unknown,scope:ContactScope){
 const bad=()=>{throw new ContactError(503,'routing_unverified');};
 contactScope(scope);
 if(!value||typeof value!=='object'||Array.isArray(value))return bad();
 const c=value as MakeContactContract;
 if(!exact(c as unknown as Record<string,unknown>,['schema','kind','verified','scope','formIds','endpoint','fields','idempotency','acknowledgement','timeoutMs'])||c.schema!==1||c.kind!=='make'||c.verified!==true||!c.scope||!exact(c.scope,['tenantId','siteId'])||c.scope.tenantId!==scope.tenantId||c.scope.siteId!==scope.siteId)return bad();
 if(!Array.isArray(c.formIds)||!c.formIds.length||new Set(c.formIds).size!==c.formIds.length||c.formIds.some(id=>!Object.hasOwn(CONTACT_FORMS,id)||!CONTACT_FORMS[id as keyof typeof CONTACT_FORMS].sourceActionsVerified))return bad();
 // Footer has a distinct source webhook and an optional textarea. A route
 // contract cannot conflate it with the home/routes group or drop its message.
 const footer=c.formIds.includes('1b8a2d8');
 if(footer&&c.formIds.length!==1)return bad();
 const fields:Field[]=footer?[...baseFields,'message']:baseFields;
 let url:URL;try{url=new URL(c.endpoint);}catch{return bad();}
 // Exact server-owned endpoint only; never body/query destinations, redirects,
 // credentials, arbitrary subdomains, IPs, ports or private-network URLs.
 if(url.protocol!=='https:'||!['hook.eu1.make.com','hook.eu2.make.com','hook.us1.make.com','hook.us2.make.com','hook.integromat.com'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash||!/^\/[a-z0-9_-]{10,256}$/i.test(url.pathname)||url.href!==c.endpoint)return bad();
 if(!c.fields||typeof c.fields!=='object'||Array.isArray(c.fields)||Object.keys(c.fields).length!==fields.length||Object.entries(c.fields).some(([key,field])=>!/^[a-z][a-z0-9_]{0,63}$/i.test(key)||!fields.includes(field))||new Set(Object.values(c.fields)).size!==fields.length)return bad();
 if(!c.idempotency||!exact(c.idempotency,['header','verified'])||c.idempotency.verified!==true||!/^x-[a-z0-9-]{1,60}$/.test(c.idempotency.header))return bad();
 const ack=c.acknowledgement;
 if(!ack||!exact(ack,['status','field','value','receiptField'])||![200,201,202].includes(ack.status)||!['field','receiptField'].every(key=>typeof ack[key as 'field'|'receiptField']==='string'&&/^[a-z][a-z0-9_]{0,63}$/i.test(ack[key as 'field'|'receiptField']))||ack.field===ack.receiptField||typeof ack.value!=='string'||!ack.value||ack.value.length>80||/[\x00-\x1f\x7f]/.test(ack.value)||!Number.isSafeInteger(c.timeoutMs)||c.timeoutMs<100||c.timeoutMs>10000)return bad();
 // Freeze a deep copy; validation and transport cannot race config mutation.
 const contract=JSON.parse(JSON.stringify(c)) as MakeContactContract;
 const contractId=await contactHash(contract);
 return{contract,routing:{kind:'make',verified:true,scope:{...scope},formIds:[...c.formIds],contractId} satisfies VerifiedContactRouting};
}
export async function deliverContact(service:Contacts,scope:ContactScope,key:string,revision:number,configuration:unknown,fetcher:typeof fetch=fetch){
 const {contract,routing}=await verifiedMakeContract(configuration,scope);
 const record=await service.claim(scope,key,revision,routing);
 const payload:Record<string,string>={},source:Record<Field,string>={...record.fields,message:record.fields.message??'',formId:record.source.formId,postId:record.source.postId,consentAt:record.consent.receivedAt,receipt:record.receipt};
 for(const [target,field]of Object.entries(contract.fields))payload[target]=source[field];
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let outcome:'provider_accepted'|'unknown'|'failed'='unknown',receiptHash:string|null=null;
 // The deadline also covers response-body streaming, not only fetch headers.
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('contact_delivery_deadline'));},contract.timeoutMs);});
 try{
  await Promise.race([deadline,(async()=>{
   const response=await fetcher(contract.endpoint,{method:'POST',redirect:'manual',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{'content-type':'application/json',[contract.idempotency.header]:record.receipt},body:JSON.stringify(payload)});
   // Any redirect/non-ack status may follow a side effect. It is uncertain and
   // must be reconciled at the provider, with no automatic second submission.
   if(response.status!==contract.acknowledgement.status||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();return;}
   const reader=response.body?.getReader();if(!reader)return;
   const chunks:Uint8Array[]=[];let count=0;
   for(;;){const value=await reader.read();if(value.done)break;count+=value.value.byteLength;if(count>2048){await reader.cancel();return;}chunks.push(value.value);}
   const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   let ack:Record<string,unknown>;try{ack=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return;}
   if(!ack||typeof ack!=='object'||Array.isArray(ack)||!exact(ack,[contract.acknowledgement.field,contract.acknowledgement.receiptField])||ack[contract.acknowledgement.field]!==contract.acknowledgement.value)return;
   const providerReceipt=ack[contract.acknowledgement.receiptField];
   if(typeof providerReceipt!=='string'||!/^[a-z0-9_.:-]{1,160}$/i.test(providerReceipt))return;
   receiptHash=await contactHash({contractId:routing.contractId,providerReceipt});outcome='provider_accepted';
  })()]);
 }catch{outcome='unknown';}finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
 // No provider response body, destination or person data is returned or logged.
 // A failed settle leaves sending: operator reconciliation is mandatory.
 const settled=await service.settle(scope,key,record.outbox.attemptToken!,outcome,receiptHash);
 return{state:settled.outbox.state,receipt:settled.receipt};
}
