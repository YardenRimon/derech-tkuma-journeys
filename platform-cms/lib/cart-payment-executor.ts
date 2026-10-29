/** Server-only orchestration. A persisted claim precedes every mutating provider
 * request; transport ambiguity never triggers a second create/ACK attempt. */
import type {D1CartPayments,CartPaymentDispatch} from './cart-payment-d1';
import {GrowSourceError} from './grow-source-core';
type Authority=Pick<D1CartPayments,'claimCreate'|'completeCreate'|'markCreateUncertain'|'readbackRequest'|'completeReadback'|'claimAck'|'completeAck'|'markAckUncertain'>;
const endpoints=new Set(['https://sandbox.meshulam.co.il/api/light/server/1.0/','https://secure.meshulam.co.il/api/light/server/1.0/'].flatMap(base=>['createPaymentProcess','getPaymentProcessInfo','approveTransaction'].map(method=>base+method)));
const methods={create:'createPaymentProcess',readback:'getPaymentProcessInfo',ack:'approveTransaction'} as const;
function transportError(){return new GrowSourceError('grow_source_transport_uncertain',503);}
export class CartPaymentExecutor{
 constructor(private authority:Authority,private transport:typeof fetch=fetch){}
 private async dispatch<T>(claim:CartPaymentDispatch,complete:(response:Response)=>Promise<T>,uncertain?:()=>Promise<unknown>):Promise<T>{
  const request=claim.request;
  // Descriptors are minted inside the authority; never take one from HTTP.
  if(!endpoints.has(request.url)||!request.url.endsWith('/'+methods[claim.kind])||request.method!=='POST'||request.redirect!=='manual'||request.credentials!=='omit'||request.cache!=='no-store'||request.timeoutMs!==8000||!(request.body instanceof URLSearchParams)||new TextEncoder().encode(request.body.toString()).byteLength>65536)throw new GrowSourceError('grow_source_dispatch_invalid',503);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),request.timeoutMs);
  let response:Response;
  try{
   try{response=await this.transport(request.url,{method:request.method,headers:request.headers,body:request.body,redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal});}
   catch{if(uncertain)await uncertain();throw transportError();}
   // The authority owns response validation and persistent uncertain marking.
   return await complete(response);
  }finally{clearTimeout(timer);}
 }
 async create(ownerId:string,orderId:string){
  const claim=await this.authority.claimCreate(ownerId,orderId);
  return this.dispatch(claim,response=>this.authority.completeCreate(claim,response),()=>this.authority.markCreateUncertain(claim));
 }
 async settleCallback(orderId:string,fields:URLSearchParams){
  const readback=await this.authority.readbackRequest(orderId,fields);
  const verified=await this.dispatch(readback,response=>this.authority.completeReadback(readback,response));
  // Readback has already atomically committed paid + inventory + one effect.
  // Failed ACK must never turn the paid result into a new checkout opportunity.
  try{
   const ack=await this.authority.claimAck(verified.verification);
   if('alreadyConfirmed' in ack)return {settlement:'verified' as const,acknowledgment:'confirmed' as const,noFulfillment:true as const};
   await this.dispatch(ack,response=>this.authority.completeAck(ack,response),()=>this.authority.markAckUncertain(ack));
   return {settlement:'verified' as const,acknowledgment:'confirmed' as const,noFulfillment:true as const};
  }catch(error){
   const code=error instanceof GrowSourceError?error.code:'';
   return {settlement:'verified' as const,acknowledgment:code==='grow_source_ack_contract_hold'?'blocked' as const:'reconciliation_required' as const,noFulfillment:true as const};
  }
 }
}
