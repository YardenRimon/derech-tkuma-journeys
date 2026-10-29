/** Disabled native cart/Grow wiring. No routes, SDK, invoices, provider calls at
 * construction, policy provisioning, scope initialization or schedulers. */
import {D1GuestCarts,type CartScope} from './cart-d1';
import {D1CartPayments} from './cart-payment-d1';
import {CartPaymentExecutor} from './cart-payment-executor';
import {cartPaymentRequest,cartPaymentCallbackRequest,type CartPaymentHttpContext} from './cart-payment-http';
import {CartError} from './cart-core';
import {paymentIngress} from './payment-http';
import {productionRelease} from './visitor-release';
import {getPublishedPage} from './cms';
import type {GrowSourceRelease} from './grow-source-core';
export type CartPaymentRuntimeBindings={DB?:D1Database;CART_MODE?:string;CART_PAYMENT_MODE?:string;CART_PAYMENT_ACCEPT_NEW?:string;CMS_ADAPTER_MODE?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string;PAYMENT_RATE_SECRET?:string};
export type NativeCartPaymentReceipt=Awaited<ReturnType<D1CartPayments['receiptStatus']>>;
const origins={review:'https://derech-tkuma-review.22yarden22.workers.dev',production:'https://derech-tkuma.com'},postPaths=['/api/cart/payment/','/api/payments/grow/callback/'],receiptPaths=['/payment/success/','/payment/cancel/'];
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function need(v:unknown,status=503):asserts v{if(!v)throw new CartError(status,'native_payment_unavailable');}
function admission(url:URL,b:CartPaymentRuntimeBindings,scope:CartScope){
 need(scope?.tenantId==='derech'&&scope.siteId==='derech-main'&&Object.keys(scope).sort().join(',')==='siteId,tenantId'&&b.CMS_ADAPTER_MODE==='isolated-d1'&&b.CMS_TENANT_ID===scope.tenantId&&b.CMS_SITE_ID===scope.siteId&&b.DB&&typeof b.DB.prepare==='function');
 const review=b.CART_MODE==='review'&&b.CART_PAYMENT_MODE==='sandbox',production=b.CART_MODE==='production'&&b.CART_PAYMENT_MODE==='production';need(review||production);const mode=review?'review' as const:'production' as const,environment=review?'sandbox' as const:'production' as const;need(url.origin===origins[mode]&&!url.username&&!url.password&&!url.hash,403);
 // Never accept a caller/env boolean or injected release resolver as approval.
 const profile=production?productionRelease(url):null;if(production)need(profile&&profile.paymentsReady===true&&profile.paymentEvidence?.acknowledgmentContract==='installed-wallet-23/v1'&&hash(profile.approvalReceiptHash)&&hash(profile.paymentEvidence.acceptanceHash)&&hash(profile.paymentEvidence.termsHash));
 const expectedRelease:GrowSourceRelease|null=profile?{stage:'production',origin:'https://derech-tkuma.com',paymentsReady:true,approvalReceiptHash:profile.approvalReceiptHash,paymentEvidenceHash:profile.paymentEvidence!.acceptanceHash}:null;
 return{mode,environment,profile,expectedRelease};
}
async function storeFor(b:CartPaymentRuntimeBindings,scope:CartScope,gate:ReturnType<typeof admission>){
 // A read must never initialize an unregistered or differently scoped DB.
 const row=await b.DB!.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();need(row&&row.tenant_id===scope.tenantId&&row.site_id===scope.siteId,403);
 const carts=new D1GuestCarts(b.DB!,scope,{cartTtlMs:48*60*60*1000,holdTtlMs:60*60*1000});
 return new D1CartPayments(b.DB!,carts,{expectedEnvironment:gate.environment,expectedRelease:gate.expectedRelease,requireBuyerRetention:true,assertLegalHash:async legalHash=>{
  need(hash(legalHash),409);const source=await getPublishedPage('/תקנון-אתר/');need(typeof source==='string',503);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  // Hash this exact published string as UTF8. Do not JSON-hash it or pass it
  // through a final public/SDK/production overlay before establishing consent.
  need(digest===legalHash&&(!gate.profile||gate.profile.paymentEvidence?.termsHash===digest),409);
 }});
}
function unavailable(error:unknown){const status=error instanceof CartError&&[400,401,403,404,405,408,409,413,415,429].includes(error.status)?error.status:503;return Response.json({accepted:false,code:status===403?'payment_request_denied':status===405?'payment_method_denied':'payment_unavailable'},{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','x-content-type-options':'nosniff',vary:'Cookie'}});}
export async function cartPaymentRuntimeRequest(request:Request,bindings:CartPaymentRuntimeBindings,scope:CartScope,dependencies:{transport?:typeof fetch}={}):Promise<Response>{
 try{const url=new URL(request.url),gate=admission(url,bindings,scope);need(request.method==='POST',405);need(postPaths.includes(url.pathname)&&request.url===url.origin+url.pathname,403);const secret=bindings.PAYMENT_RATE_SECRET;need(typeof secret==='string'&&/^[a-zA-Z0-9_-]{32,256}$/.test(secret));const store=await storeFor(bindings,scope,gate),executor=new CartPaymentExecutor(store,dependencies.transport??fetch),context:CartPaymentHttpContext={mode:gate.mode,environment:gate.environment,productionApproved:gate.profile!==null,acceptNewOrders:bindings.CART_PAYMENT_ACCEPT_NEW==='true',store,executor,ingress:(req,kind)=>paymentIngress(bindings.DB!,scope,req,secret,kind,Date.now())};return url.pathname===postPaths[0]?await cartPaymentRequest(request,context):await cartPaymentCallbackRequest(request,context);
 }catch(error){return unavailable(error);}
}
function receiptId(url:URL){const fields=new Map<string,string>();for(const[key,value]of url.searchParams){need(['order','order_id','response','cField1'].includes(key)&&!fields.has(key),400);fields.set(key,value);}need(Number(fields.has('order'))+Number(fields.has('order_id'))===1,400);const id=fields.get('order')??fields.get('order_id');need(hash(id),400);if(fields.has('response'))need(/^[a-zA-Z_-]{1,32}$/.test(fields.get('response')!),400);if(fields.has('cField1'))need(fields.get('cField1')===id,400);return id;}
/** Opaque order capability only. No owner cookie, ingress writes, legal page,
 * active policy replacement, SDK credential or provider transport is consulted.
 * Store.load keeps the original approved release/policy snapshot of the order.
 */
export async function readNativeCartPaymentReceipt(request:Request,bindings:CartPaymentRuntimeBindings,scope:CartScope):Promise<NativeCartPaymentReceipt>{
 const url=new URL(request.url),gate=admission(url,bindings,scope);need(request.method==='GET',405);need(receiptPaths.includes(url.pathname),403);const id=receiptId(url),store=await storeFor(bindings,scope,gate);return store.receiptStatus(id);
}
