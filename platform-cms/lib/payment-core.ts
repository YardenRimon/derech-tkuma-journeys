/** Server-owned order state. No route, scheduler, card data, fulfillment or provider defaults. */
import {validateContent,resourceId,type Scope,type Record as CollectionRecord,type Tour,type Occurrence} from './collection-core';
export class PaymentError extends Error{constructor(public status:number,public code:string){super(code);}}
export function paymentRequire(value:unknown,code:string,status=400):asserts value{if(!value)throw new PaymentError(status,code);}
export const paymentCanonical=(value:unknown):string=>value&&typeof value==='object'&&!Array.isArray(value)?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+paymentCanonical((value as {[key:string]:unknown})[k])).join(',')+'}':Array.isArray(value)?'['+value.map(paymentCanonical).join(',')+']':JSON.stringify(value);
export async function paymentHash(value:unknown){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(paymentCanonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function paymentScope(scope:Scope){paymentRequire(scope.tenantId==='derech'&&scope.siteId==='derech-main','payment_scope_denied',403);return scope.tenantId+':'+scope.siteId+':';}
export function paymentExact(value:unknown,keys:string[]):asserts value is {[key:string]:unknown}{paymentRequire(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'payment_fields_invalid');}
export type Buyer={fullName:string;phone:string;email:string};
export async function paymentBuyerFingerprint(secret:string,buyer:Buyer){paymentRequire(typeof secret==='string'&&/^[a-zA-Z0-9_-]{32,256}$/.test(secret),'payment_privacy_unconfigured',503);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('payment-buyer/v1\n'+paymentCanonical(buyer)));return[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function paymentBuyer(input:unknown):Buyer{paymentExact(input,['fullName','phone','email']);paymentRequire(typeof input.fullName==='string'&&input.fullName.length<=160&&/^[\p{L}\p{M}][\p{L}\p{M} .'-]+\s[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(input.fullName)&&!/[\r\n<>]/.test(input.fullName),'payment_buyer_invalid');paymentRequire(typeof input.phone==='string'&&/^05\d{8}$/.test(input.phone),'payment_buyer_invalid');paymentRequire(typeof input.email==='string'&&input.email.length<=254&&(input.email===''||/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email)),'payment_buyer_invalid');return{fullName:input.fullName,phone:input.phone,email:input.email};}
export type Quote={tourId:string;occurrenceId:string;tourVersion:number;occurrenceVersion:number;tourRevision:number;occurrenceRevision:number;sourceHash:string;title:string;startsAt:string;unitPriceMinor:number;quantity:number;capacity:number;amountMinor:number;currency:'ILS'};
export type Process={processId:string;processToken:string;authCode:string;expiresAt:number};
export type VerifiedTransaction={transactionId:string;transactionTokenHash:string;asmachta:string;amountMinor:number;currency:'ILS';currencyAuthority:'verified-merchant-config';providerEvidenceHash:string};
export type PaymentAcknowledgment={state:'not_attempted'|'pending'|'sending'|'confirmed'|'contract_blocked';attemptAt:number|null;requestHash:string|null;receiptHash:string|null};
export type Order=Scope&{schema:1;id:string;revision:number;requestHash:string;buyerHash:string;quote:Quote;configHash:string;environment:'sandbox'|'production';state:'prepared'|'creating'|'checkout_ready'|'uncertain'|'paid_verified';process:Process|null;transaction:VerifiedTransaction|null;acknowledgment:PaymentAcknowledgment;createdAt:string;updatedAt:string};
export type PaymentEffect=Scope&{kind:'payment_verified';key:string;orderId:string;transactionId:string;amountMinor:number;currency:'ILS';noFulfillment:true;noAutomaticMessage:true;at:string};
export interface PaymentStore{source(scope:Scope,kind:'tour'|'occurrence',id:string):Promise<CollectionRecord|null>;get(scope:Scope,id:string):Promise<Order|null>;commit(previous:Order|null,next:Order,effect?:PaymentEffect):Promise<void>;}
export interface PaymentGateway{readonly configHash:string;readonly environment:'sandbox'|'production';create(order:Order,buyer:Buyer):Promise<Process>;verify(order:Order,callback:unknown):Promise<VerifiedTransaction>;matches(order:Order,callback:unknown):Promise<boolean>;acknowledge?(order:Order,callback:unknown):Promise<{requestHash:string;receiptHash:string}>;}
export type OrderInput={idempotencyKey:string;occurrenceId:string;quantity:number;expectedTourVersion:number;expectedOccurrenceVersion:number};
export async function quotePayment(store:PaymentStore,scope:Scope,input:OrderInput,now=Date.now()):Promise<Quote>{
 paymentScope(scope);resourceId(input.occurrenceId);paymentRequire(Number.isSafeInteger(input.quantity)&&input.quantity>=1&&input.quantity<=10,'payment_quantity_invalid');
 const occurrenceRecord=await store.source(scope,'occurrence',input.occurrenceId);paymentRequire(occurrenceRecord?.published&&occurrenceRecord.id===input.occurrenceId&&occurrenceRecord.kind==='occurrence'&&occurrenceRecord.tenantId===scope.tenantId&&occurrenceRecord.siteId===scope.siteId,'payment_occurrence_unavailable',409);
 const occurrence=validateContent('occurrence',occurrenceRecord.published) as Occurrence,tourRecord=await store.source(scope,'tour',occurrence.tourId);paymentRequire(tourRecord?.published&&tourRecord.id===occurrence.tourId&&tourRecord.kind==='tour'&&tourRecord.tenantId===scope.tenantId&&tourRecord.siteId===scope.siteId,'payment_tour_unavailable',409);
 const tour=validateContent('tour',tourRecord.published) as Tour;
 paymentRequire(tourRecord.publishedVersion===input.expectedTourVersion&&occurrenceRecord.publishedVersion===input.expectedOccurrenceVersion&&Number.isSafeInteger(input.expectedTourVersion)&&input.expectedTourVersion>=1&&Number.isSafeInteger(input.expectedOccurrenceVersion)&&input.expectedOccurrenceVersion>=1,'payment_source_version_conflict',409);
 paymentRequire(occurrence.startsAt&&Number.isFinite(now)&&Date.parse(occurrence.startsAt)>now&&occurrence.capacity!==null&&occurrence.capacity>=input.quantity,'payment_booking_details_unverified',409);
 paymentRequire(occurrence.priceMinor>0&&Number.isSafeInteger(occurrence.priceMinor*input.quantity)&&occurrence.priceMinor*input.quantity<=100000000,'payment_amount_invalid',409);
 const sourceHash=await paymentHash({tour:{id:tourRecord.id,version:tourRecord.publishedVersion,revision:tourRecord.revision,content:tour},occurrence:{id:occurrenceRecord.id,version:occurrenceRecord.publishedVersion,revision:occurrenceRecord.revision,content:occurrence}});
 return{tourId:tourRecord.id,occurrenceId:occurrenceRecord.id,tourVersion:tourRecord.publishedVersion,occurrenceVersion:occurrenceRecord.publishedVersion,tourRevision:tourRecord.revision,occurrenceRevision:occurrenceRecord.revision,sourceHash,title:tour.title,startsAt:occurrence.startsAt,unitPriceMinor:occurrence.priceMinor,quantity:input.quantity,capacity:occurrence.capacity,amountMinor:occurrence.priceMinor*input.quantity,currency:'ILS'};
}
export class Payments{
 constructor(readonly store:PaymentStore,readonly gateway:PaymentGateway,readonly clock:()=>number,private readonly privacySecret:string){}
 async prepare(scope:Scope,raw:unknown,buyerInput:unknown,reserveNew?:()=>Promise<void>){
  paymentScope(scope);paymentExact(raw,['idempotencyKey','occurrenceId','quantity','expectedTourVersion','expectedOccurrenceVersion']);paymentRequire(typeof raw.idempotencyKey==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(raw.idempotencyKey),'payment_idempotency_invalid');
  const buyer=paymentBuyer(buyerInput),input=raw as unknown as OrderInput,buyerHash=await paymentBuyerFingerprint(this.privacySecret,buyer),requestHash=await paymentHash({...input,buyerHash}),id=await paymentHash({scope,key:input.idempotencyKey}),existing=await this.store.get(scope,id);
  if(existing){paymentRequire(existing.requestHash===requestHash&&existing.configHash===this.gateway.configHash,'payment_idempotency_conflict',409);return existing;}
  const at=this.clock(),quote=await quotePayment(this.store,scope,input,at),next:Order={...scope,schema:1,id,revision:1,requestHash,buyerHash,quote,configHash:this.gateway.configHash,environment:this.gateway.environment,state:'prepared',process:null,transaction:null,acknowledgment:{state:'not_attempted',attemptAt:null,requestHash:null,receiptHash:null},createdAt:new Date(at).toISOString(),updatedAt:new Date(at).toISOString()};if(reserveNew)await reserveNew();await this.store.commit(null,next);return next;
 }
 async checkout(scope:Scope,id:string,buyerInput:unknown){
  paymentScope(scope);const buyer=paymentBuyer(buyerInput),order=await this.store.get(scope,id);paymentRequire(order&&order.configHash===this.gateway.configHash&&order.buyerHash===await paymentBuyerFingerprint(this.privacySecret,buyer),'payment_order_conflict',409);
  if(order.state==='paid_verified')return this.publicView(order);
  if(order.state==='checkout_ready'){paymentRequire(order.process&&this.clock()<order.process.expiresAt,'payment_checkout_expired',409);return this.publicView(order);}
  paymentRequire(order.state==='prepared','payment_attempt_requires_reconciliation',409);
  const current=await quotePayment(this.store,scope,{idempotencyKey:'unused-server-quote',occurrenceId:order.quote.occurrenceId,quantity:order.quote.quantity,expectedTourVersion:order.quote.tourVersion,expectedOccurrenceVersion:order.quote.occurrenceVersion},this.clock());paymentRequire(paymentCanonical(current)===paymentCanonical(order.quote),'payment_source_changed',409);
  const claimed:Order={...order,revision:order.revision+1,state:'creating',updatedAt:new Date(this.clock()).toISOString()};await this.store.commit(order,claimed);
  let process:Process;try{process=await this.gateway.create(claimed,buyer);}catch{const uncertain:Order={...claimed,revision:claimed.revision+1,state:'uncertain',updatedAt:new Date(this.clock()).toISOString()};await this.store.commit(claimed,uncertain);throw new PaymentError(503,'payment_attempt_uncertain');}
  const ready:Order={...claimed,revision:claimed.revision+1,state:'checkout_ready',process,updatedAt:new Date(this.clock()).toISOString()};await this.store.commit(claimed,ready);return this.publicView(ready);
 }
 async callback(scope:Scope,id:string,input:unknown){
  paymentScope(scope);const order=await this.store.get(scope,id);paymentRequire(order&&order.configHash===this.gateway.configHash&&order.process,'payment_order_unavailable',409);
  if(order.state==='paid_verified'){paymentRequire(await this.gateway.matches(order,input),'payment_callback_replay_conflict',409);return this.acknowledge(order,input);}
  paymentRequire(order.state==='checkout_ready','payment_callback_state_conflict',409);
  const transaction=await this.gateway.verify(order,input);paymentRequire(transaction.amountMinor===order.quote.amountMinor&&transaction.currency===order.quote.currency&&transaction.currencyAuthority==='verified-merchant-config','payment_transaction_mismatch',409);
  const at=new Date(this.clock()).toISOString(),next:Order={...order,revision:order.revision+1,state:'paid_verified',transaction,acknowledgment:{state:'pending',attemptAt:null,requestHash:null,receiptHash:null},updatedAt:at};
  const effect:PaymentEffect={...scope,kind:'payment_verified',key:await paymentHash({scope,orderId:id,kind:'payment_verified'}),orderId:id,transactionId:transaction.transactionId,amountMinor:transaction.amountMinor,currency:transaction.currency,noFulfillment:true,noAutomaticMessage:true,at};await this.store.commit(order,next,effect);return this.acknowledge(next,input);
 }
 private async acknowledge(order:Order,input:unknown){
  if(order.acknowledgment.state==='confirmed')return this.publicView(order);
  if(!this.gateway.acknowledge){const blocked:Order={...order,revision:order.revision+1,acknowledgment:{...order.acknowledgment,state:'contract_blocked'},updatedAt:new Date(this.clock()).toISOString()};await this.store.commit(order,blocked);return this.publicView(blocked);}
  if(order.acknowledgment.state==='sending'&&order.acknowledgment.attemptAt!==null&&this.clock()-order.acknowledgment.attemptAt<30000)throw new PaymentError(503,'payment_acknowledgment_pending');
  const claimed:Order={...order,revision:order.revision+1,acknowledgment:{...order.acknowledgment,state:'sending',attemptAt:this.clock()},updatedAt:new Date(this.clock()).toISOString()};await this.store.commit(order,claimed);
  let saved:Order;try{const result=await this.gateway.acknowledge(claimed,input);saved={...claimed,revision:claimed.revision+1,acknowledgment:{...claimed.acknowledgment,state:'confirmed',...result},updatedAt:new Date(this.clock()).toISOString()};}
  catch(error){saved={...claimed,revision:claimed.revision+1,acknowledgment:{...claimed.acknowledgment,state:error instanceof PaymentError&&error.code==='payment_ack_contract_missing_fields'?'contract_blocked':'pending'},updatedAt:new Date(this.clock()).toISOString()};}
  await this.store.commit(claimed,saved);return this.publicView(saved);
 }
 publicView(order:Order){return{orderId:order.id,state:order.state,amountMinor:order.quote.amountMinor,currency:order.quote.currency,...(order.state==='checkout_ready'&&order.process?{authCode:order.process.authCode,expiresAt:order.process.expiresAt}:{}),...(order.transaction?{confirmation:order.transaction.asmachta}:{}),capacityReserved:order.state!=='prepared',fulfillmentAllowed:false,acknowledgmentState:order.acknowledgment.state,acknowledgmentImplemented:typeof this.gateway.acknowledge==='function'};}
}

export async function paymentReadBytes(body:ReadableStream<Uint8Array>|null,limit:number,milliseconds=5000){
 const reader=body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new PaymentError(408,'payment_body_timeout'));void reader.cancel();},milliseconds);});
 try{for(;;){const {done,value}=await Promise.race([reader.read(),expired]);if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new PaymentError(413,'payment_body_oversized');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;}finally{if(timer)clearTimeout(timer);reader.releaseLock();}
}
