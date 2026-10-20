import {PaymentError,paymentRequire,paymentHash,paymentScope,paymentReadBytes} from './payment-core';
import {GrowGateway,paymentConfig,growCallback,readGrowCallback,paymentReviewOrigin,paymentProductionOrigin,paymentCallbackPath,type GrowFetch} from './payment-grow';
import {D1Payments} from './payment-d1';
import {Payments,paymentExact} from './payment-core';
import {productionRelease,type ProductionProfile} from './visitor-release';
import {assertIsolatedD1Scope} from './access';
import type {Scope} from './collection-core';
export const paymentOrderPath='/api/payments/order/';
export type PaymentBindings={DB?:D1Database;PAYMENT_CONFIG?:string;PAYMENT_RATE_SECRET?:string};
export type PaymentDependencies={clock?:()=>number;transport?:GrowFetch;release?:(url:URL)=>ProductionProfile|null};
const answer=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow',...(status===429?{'retry-after':'60'}:{})}});
function failure(error:unknown){return answer({accepted:false,code:error instanceof PaymentError?error.code:'payment_unavailable'},error instanceof PaymentError?error.status:503);}

function exactRequest(request:Request,origin:string,path:string){paymentRequire(request.method==='POST','payment_method_invalid',405);paymentRequire(request.url===origin+path,'payment_target_denied',403);}
function csrf(request:Request,origin:string){paymentRequire(request.headers.get('origin')===origin&&request.headers.get('sec-fetch-site')==='same-origin'&&request.headers.get('x-payment-request')==='1','payment_csrf_denied',403);paymentRequire(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json','payment_encoding_invalid',415);}
async function runtime(request:Request,bindings:PaymentBindings,scope:Scope,dependencies:PaymentDependencies){
 paymentScope(scope);const raw=bindings.PAYMENT_CONFIG;paymentRequire(typeof raw==='string'&&new TextEncoder().encode(raw).byteLength<=8192,'payments_disabled',503);let value;try{value=JSON.parse(raw);}catch{throw new PaymentError(503,'payments_disabled');}
 const config=paymentConfig(value);paymentRequire(config&&bindings.DB,'payments_disabled',503);const secret=bindings.PAYMENT_RATE_SECRET;paymentRequire(typeof secret==='string'&&/^[a-zA-Z0-9_-]{32,256}$/.test(secret),'payment_ingress_unconfigured',503);
 const origin=config.environment==='sandbox'?paymentReviewOrigin:paymentProductionOrigin,release=config.environment==='production'?(dependencies.release??productionRelease)(new URL(request.url)):null;
 paymentRequire(new URL(request.url).origin===origin,'payment_target_denied',403);await assertIsolatedD1Scope(bindings.DB);
 const clock=dependencies.clock??(()=>Date.now()),gateway=await GrowGateway.accepted(config,dependencies.transport??((url,init)=>fetch(url,init)),clock,release),store=new D1Payments(bindings.DB);
 return{config,origin,clock,store,service:new Payments(store,gateway,clock,secret),db:bindings.DB,secret};
}
/** Edge-owned IP + keyed fingerprint; expiry counters share no auth/contact schema. */
export async function paymentIngress(db:D1Database,scope:Scope,request:Request,secret:string,kind:'order'|'callback',now:number){
 const prefix='payment_rate:'+paymentScope(scope),ip=request.headers.get('cf-connecting-ip');paymentRequire(ip&&((/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)&&ip.split('.').every(x=>Number(x)<=255))||/^[a-f0-9:]{3,45}$/i.test(ip)&&ip.includes(':')),'payment_ingress_unavailable',503);paymentRequire(Number.isFinite(now),'payment_ingress_unavailable',503);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const consume=async(label:string,value:string,seconds:number,limit:number)=>{const start=Math.floor(now/1000/seconds)*seconds,bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(label+'\n'+value+'\n'+start)),fingerprint=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const row=await db.prepare("INSERT INTO cms_settings(key,value) VALUES(?,json_object('count',1,'expiresAt',?)) ON CONFLICT(key) DO UPDATE SET value=json_set(cms_settings.value,'$.count',json_extract(cms_settings.value,'$.count')+1) RETURNING json_extract(value,'$.count') AS attempts").bind(prefix+fingerprint,(start+seconds)*1000).first<{attempts:number}>();paymentRequire(row&&Number.isSafeInteger(row.attempts),'payment_ingress_unavailable',503);paymentRequire(row.attempts<=limit,'payment_rate_limited',429);};
 await db.prepare("DELETE FROM cms_settings WHERE key IN (SELECT key FROM cms_settings WHERE key>=? AND key<? AND json_extract(value,'$.expiresAt')<=? LIMIT 20)").bind(prefix,prefix+'\uffff',now).run();
 await consume(kind+'-ip',ip,60,kind==='order'?15:60);await consume(kind+'-site','site',60,kind==='order'?100:600);
 return async()=>{await consume('new-order-ip',ip,600,5);await consume('new-order-site','site',3600,100);};
}
export async function paymentOrderRequest(request:Request,bindings:PaymentBindings,scope:Scope,dependencies:PaymentDependencies={}){
 try{const context=await runtime(request,bindings,scope,dependencies);exactRequest(request,context.origin,paymentOrderPath);csrf(request,context.origin);
  const reserveNew=await paymentIngress(context.db,scope,request,context.secret,'order',context.clock());const bytes=await paymentReadBytes(request.body,8192);let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new PaymentError(400,'payment_json_invalid');}
  paymentExact(body,['order','buyer','termsAccepted','termsHash']);paymentRequire(body.termsAccepted===true&&body.termsHash===context.config.termsHash,'payment_terms_not_accepted',400);
  const order=await context.service.prepare(scope,body.order,body.buyer,reserveNew);return answer(await context.service.checkout(scope,order.id,body.buyer));
 }catch(error){return failure(error);}
}
export async function paymentCallbackRequest(request:Request,bindings:PaymentBindings,scope:Scope,dependencies:PaymentDependencies={}){
 try{const context=await runtime(request,bindings,scope,dependencies);exactRequest(request,context.origin,paymentCallbackPath);await paymentIngress(context.db,scope,request,context.secret,'callback',context.clock());
  const raw=await readGrowCallback(request),callback=growCallback(raw),result=await context.service.callback(scope,callback.orderId,raw);
  if(result.acknowledgmentState!=='confirmed')return answer({accepted:false,code:result.acknowledgmentState==='contract_blocked'?'payment_ack_contract_missing_fields':'payment_acknowledgment_pending'},503);
  return answer({accepted:true});
 }catch(error){return failure(error);}
}
