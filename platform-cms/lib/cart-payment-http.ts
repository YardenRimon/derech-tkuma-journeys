/** Native cart payment HTTP. Authority/transport/quotas are server-owned;
 * neither a browser success redirect nor an SDK event settles an order. */
import {guestCartIdentity,readGuestCartJson} from './cart-http';
import type {D1CartPayments} from './cart-payment-d1';
import type {CartPaymentExecutor} from './cart-payment-executor';
import {CartError} from './cart-core';
import {readGrowSourceCallback} from './grow-source-core';
export type CartPaymentHttpContext={mode:'review'|'production';environment:'sandbox'|'production';productionApproved:boolean;acceptNewOrders:boolean;store:Pick<D1CartPayments,'prepare'|'ownedStatus'|'cancelPrepared'>;executor:Pick<CartPaymentExecutor,'create'|'settleCallback'>;ingress:(request:Request,kind:'order'|'callback')=>Promise<()=>Promise<void>>};
const originFor=(mode:string)=>mode==='review'?'https://derech-tkuma-review.22yarden22.workers.dev':'https://derech-tkuma.com';
function need(value:unknown,status=400):asserts value{if(!value)throw new CartError(status,'native_payment_request_denied');}
function configured(context:CartPaymentHttpContext|undefined):asserts context is CartPaymentHttpContext{need(context&&typeof context.ingress==='function'&&context.store&&context.executor&&typeof context.acceptNewOrders==='boolean'&&((context.mode==='review'&&context.environment==='sandbox')||(context.mode==='production'&&context.environment==='production'&&context.productionApproved===true)),503);}
const send=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','x-content-type-options':'nosniff','vary':'Cookie',...(status===429?{'retry-after':'60'}:{})}});
function failure(error:unknown){const status=(error as {status?:number})?.status;return send({accepted:false,code:status===405?'payment_method_denied':status===429?'payment_rate_limited':status===408?'payment_request_timeout':status===413?'payment_request_too_large':status===401?'payment_session_required':status===404?'payment_order_not_found':status===409?'payment_check_required':status===403?'payment_request_denied':status===400||status===415?'payment_request_invalid':'payment_unavailable'},[400,401,403,404,405,408,409,413,415,429].includes(status??0)?status:503);}
function exact(value:Record<string,unknown>,keys:string[]){need(Object.keys(value).sort().join(',')===[...keys].sort().join(','));}
function orderId(value:unknown):asserts value is string{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));}
function publicStatus(row:Awaited<ReturnType<D1CartPayments['ownedStatus']>>){return {orderId:row.orderId,state:row.state,amountMinor:row.amountMinor,currency:row.currency,acknowledgmentState:row.acknowledgmentState,reconciliationRequired:row.reconciliationRequired,noFulfillment:true,...(row.state==='checkout_ready'&&typeof row.authCode==='string'?{authCode:row.authCode}:{})};}
export async function cartPaymentRequest(request:Request,context?:CartPaymentHttpContext){
 try{configured(context);need(request.method==='POST',405);const origin=originFor(context.mode);need(request.url===origin+'/api/cart/payment/'&&request.headers.get('origin')===origin&&request.headers.get('sec-fetch-site')==='same-origin'&&request.headers.get('x-derech-payment')==='1',403);need(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json',415);need(!request.headers.has('content-encoding'));
  const session=guestCartIdentity(request);need(session,401);const reserveNew=await context.ingress(request,'order');need(typeof reserveNew==='function',503);const input=await readGuestCartJson(request);
  if(input.operation==='prepare'){exact(input,['operation','checkout']);need(context.acceptNewOrders,503);return send({accepted:true,order:publicStatus(await context.store.prepare(session.ownerId,session.cartId,input.checkout,reserveNew))});}
  exact(input,['operation','orderId']);orderId(input.orderId);
  if(input.operation==='status')return send({accepted:true,order:publicStatus(await context.store.ownedStatus(session.ownerId,input.orderId))});
  if(input.operation==='cancel')return send({accepted:true,order:publicStatus(await context.store.cancelPrepared(session.ownerId,input.orderId))});
  need(input.operation==='create');const before=await context.store.ownedStatus(session.ownerId,input.orderId);
  // Replays expose the same owned status, never a fresh provider attempt.
  if(before.state==='prepared')need(context.acceptNewOrders,503);
  const result=before.state==='prepared'?await context.executor.create(session.ownerId,input.orderId):before;
  return send({accepted:true,order:publicStatus(result)},result.reconciliationRequired?202:200);
 }catch(error){return failure(error);}
}
export async function cartPaymentCallbackRequest(request:Request,context?:CartPaymentHttpContext){
 try{configured(context);need(request.method==='POST',405);need(request.url===originFor(context.mode)+'/api/payments/grow/callback/',403);await context.ingress(request,'callback');const fields=await readGrowSourceCallback(request),id=fields.get('data[customFields][cField1]');orderId(id);
  const result=await context.executor.settleCallback(id,fields);
  return send({accepted:true,settlement:result.settlement,acknowledgment:result.acknowledgment,noFulfillment:true});
 }catch(error){return failure(error);}
}
