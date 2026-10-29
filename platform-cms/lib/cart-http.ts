/** Guest-cart HTTP boundary. No buyer, payment/provider or fulfillment surface. */
import {CartError,type GuestCart,type CartQuote} from './cart-core';
export const guestCartPath='/api/cart/';
export const guestCartCookie='__Host-derech-cart';
export const guestCartMaximumAgeMs=48*60*60*1000;
const reviewOrigin='https://derech-tkuma-review.22yarden22.workers.dev';
const productionOrigin='https://derech-tkuma.com';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type GuestCartStore={
 create(owner:string):Promise<{cartId:string;cart:GuestCart}>;
 get(owner:string,cartId:string):Promise<GuestCart>;
 change(owner:string,cartId:string,change:unknown):Promise<GuestCart>;
 review(owner:string,cartId:string):Promise<{quoteId:string;cart:GuestCart;quote:CartQuote}>;
};
export type GuestCartHttpContext={
 mode:'review'|'production';productionApproved:boolean;
 store:GuestCartStore;clock:()=>number;uuid:()=>string;
 /** Existing server-side scoped rate ledger; called before body parsing/storage. */
 ingress:(request:Request,kind:'read'|'write')=>Promise<void>;
 reserveNew:()=>Promise<void>;
};
function need(value:unknown,code:string,status=400):asserts value{if(!value)throw new CartError(status,code);}
function object(value:unknown){need(value&&typeof value==='object'&&!Array.isArray(value),'invalid_cart_request');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:string[]){need(Object.keys(value).sort().join(',')===keys.sort().join(','),'unexpected_cart_fields');}
export function guestCartPublicView(cart:GuestCart){
 return {revision:cart.revision,expiresAt:cart.expiresAt,lines:cart.lines.map(line=>({productId:line.productId,quantity:line.quantity}))};
}
export function guestCartPublicQuote(quote:CartQuote){
 // Construct, never spread a private inventory/catalog/hold/source object.
 return {currency:quote.currency,lineItems:quote.lineItems.map(line=>({productId:line.productId,kind:line.kind,title:line.title,quantity:line.quantity,unitPriceMinor:line.unitPriceMinor,lineTotalMinor:line.lineTotalMinor})),subtotalMinor:quote.subtotalMinor,taxMinor:quote.taxMinor,shippingMinor:quote.shippingMinor,discountMinor:quote.discountMinor,totalMinor:quote.totalMinor,legalHash:quote.legalHash,walletCapabilities:[...quote.walletCapabilities]};
}
export function guestCartIdentity(request:Request){
 const found=(request.headers.get('cookie')??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(guestCartCookie+'='));
 need(found.length<=1,'cart_session_invalid',403);if(!found.length)return null;
 const token=found[0].slice(guestCartCookie.length+1);const pieces=token.split('.');
 need(pieces.length===2&&pieces.every(piece=>uuid.test(piece)),'cart_session_invalid',403);
 return {cartId:pieces[0],ownerId:pieces[1]};
}
export async function readGuestCartJson(request:Request){
 const length=request.headers.get('content-length');need(length===null||/^\d+$/.test(length)&&Number(length)<=8192,'cart_request_too_large',413);
 need(!request.signal.aborted,'cart_request_timeout',408);need(request.body,'invalid_cart_request');
 const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined,stop:()=>void=()=>{};
 const deadline=new Promise<never>((_,reject)=>{
  stop=()=>{reject(new CartError(408,'cart_request_timeout'));void reader.cancel().catch(()=>{});};
  timer=setTimeout(stop,5000);
 });
 const onAbort=()=>stop();request.signal.addEventListener('abort',onAbort,{once:true});
 const read=async()=>{
  const parts:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192){void reader.cancel().catch(()=>{});throw new CartError(413,'cart_request_too_large');}parts.push(part.value);}
  const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.byteLength;}return data;
 };
 try{
  const data=await Promise.race([read(),deadline]);
  try{return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));}catch(error){if(error instanceof CartError)throw error;throw new CartError(400,'invalid_cart_json');}
 }finally{
  if(timer!==undefined)clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);
  // An untrusted stream's cancel promise may never settle. Never await it.
  try{reader.releaseLock();}catch{/* The bounded response must still finish. */}
 }
}

function answer(value:unknown,status=200,cookie?:string){return Response.json(value,{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','vary':'Cookie',...(cookie?{'set-cookie':cookie}:{}),...(status===429?{'retry-after':'60'}:{})}});}
export async function guestCartRequest(request:Request,context:GuestCartHttpContext){
 try{
  const origin=context.mode==='review'?reviewOrigin:productionOrigin;
  need(context.mode==='review'||context.mode==='production'&&context.productionApproved,'cart_disabled',503);
  need(request.url===origin+guestCartPath,'cart_target_denied',403);
  need(request.method==='GET'||request.method==='POST','cart_method_denied',405);
  if(request.method==='POST'){
   need(request.headers.get('origin')===origin&&request.headers.get('sec-fetch-site')==='same-origin'&&request.headers.get('x-derech-cart')==='1','cart_csrf_denied',403);
   need(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json','cart_encoding_invalid',415);
  }
  await context.ingress(request,request.method==='GET'?'read':'write');
  const session=guestCartIdentity(request);
  if(request.method==='GET'){
   if(!session)return answer({accepted:true,cart:null});
   return answer({accepted:true,cart:guestCartPublicView(await context.store.get(session.ownerId,session.cartId))});
  }
  const input=await readGuestCartJson(request);
  if(input.operation==='create'){
   exact(input,['operation']);
   if(session){try{return answer({accepted:true,cart:guestCartPublicView(await context.store.get(session.ownerId,session.cartId))});}catch(error){if(!(error instanceof CartError)||!['cart_expired','cart_not_found'].includes(error.code))throw error;}}
   await context.reserveNew();
   const ownerId=context.uuid();need(uuid.test(ownerId),'cart_session_unavailable',503);
   const created=await context.store.create(ownerId);need(uuid.test(created.cartId),'cart_session_unavailable',503);
   const remaining=created.cart.expiresAt-context.clock();need(Number.isSafeInteger(remaining)&&remaining>0&&remaining<=guestCartMaximumAgeMs,'cart_expiry_unavailable',503);
   const cookie=guestCartCookie+'='+created.cartId+'.'+ownerId+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+Math.floor(remaining/1000);
   return answer({accepted:true,cart:guestCartPublicView(created.cart)},201,cookie);
  }
  need(session,'cart_session_required',401);
  if(input.operation==='change'){
   exact(input,['operation','change']);return answer({accepted:true,cart:guestCartPublicView(await context.store.change(session.ownerId,session.cartId,input.change))});
  }
  if(input.operation==='review'){
   exact(input,['operation']);const result=await context.store.review(session.ownerId,session.cartId);need(uuid.test(result.quoteId),'cart_quote_unavailable',503);
   return answer({accepted:true,quoteId:result.quoteId,cart:guestCartPublicView(result.cart),quote:guestCartPublicQuote(result.quote)});
  }
  throw new CartError(400,'invalid_cart_operation');
 }catch(error){return answer({accepted:false,code:error instanceof CartError?error.code:'cart_unavailable'},error instanceof CartError?error.status:503);}
}
