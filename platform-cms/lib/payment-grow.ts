/** Official Grow Light API boundary. Disabled without an exact server-owned sandbox acceptance. */
import {PaymentError,paymentRequire,paymentExact,paymentHash,paymentCanonical,paymentReadBytes,type Order,type Buyer,type Process,type VerifiedTransaction,type PaymentGateway} from './payment-core';
export const growSandbox='https://sandbox.meshulam.co.il/api/light/server/1.0/';
export const growProduction='https://secure.meshulam.co.il/api/light/server/1.0/';
export const paymentProductionOrigin='https://derech-tkuma.com';
export const paymentReviewOrigin='https://derech-tkuma-review.22yarden22.workers.dev';
export const paymentCallbackPath='/api/payments/grow/callback/';
const acceptedHash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export type GrowPaymentConfig={schema:1;enabled:true;provider:'grow';tenantId:'derech';siteId:'derech-main';environment:'sandbox'|'production';pageCode:string;userId:string;currency:'ILS';currencyEvidenceHash:string;acceptanceHash:string;callbackVerification:'stored-process-token-and-approved-readback/v1';creditOnlyVerified:true;walletPageVerified:true;merchantVerified:true;callbackReadbackApproved:true;acknowledgmentContract:'full-documented-form/v1';acknowledgmentEvidenceHash:string;finalReleaseHash:string|null;productionApprovalHash:string|null;termsHash:string};
export function paymentEvidence(config:GrowPaymentConfig){return{provider:'grow',environment:'production',currency:'ILS',acceptanceHash:config.acceptanceHash,currencyEvidenceHash:config.currencyEvidenceHash,acknowledgmentEvidenceHash:config.acknowledgmentEvidenceHash,termsHash:config.termsHash,callbackVerification:config.callbackVerification,acknowledgmentContract:config.acknowledgmentContract};}
export function paymentConfig(raw:unknown):Readonly<GrowPaymentConfig>|null{
 if(raw==null)return null;
 if(typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===1&&(raw as {enabled?:unknown}).enabled===false)return null;
 paymentExact(raw,['schema','enabled','provider','tenantId','siteId','environment','pageCode','userId','currency','currencyEvidenceHash','acceptanceHash','callbackVerification','creditOnlyVerified','walletPageVerified','merchantVerified','callbackReadbackApproved','acknowledgmentContract','acknowledgmentEvidenceHash','finalReleaseHash','productionApprovalHash','termsHash']);
 paymentRequire(raw.schema===1&&raw.enabled===true&&raw.provider==='grow'&&raw.tenantId==='derech'&&raw.siteId==='derech-main'&&(raw.environment==='sandbox'||raw.environment==='production')&&raw.currency==='ILS'&&raw.callbackVerification==='stored-process-token-and-approved-readback/v1'&&raw.creditOnlyVerified===true&&raw.walletPageVerified===true&&raw.merchantVerified===true&&raw.callbackReadbackApproved===true&&acceptedHash(raw.currencyEvidenceHash)&&acceptedHash(raw.acceptanceHash)&&acceptedHash(raw.acknowledgmentEvidenceHash)&&acceptedHash(raw.termsHash)&&raw.acknowledgmentContract==='full-documented-form/v1'&&(raw.environment==='sandbox'?raw.finalReleaseHash===null&&raw.productionApprovalHash===null:acceptedHash(raw.finalReleaseHash)&&acceptedHash(raw.productionApprovalHash)),'payment_provider_not_accepted',503);
 for(const key of ['pageCode','userId'])paymentRequire(typeof raw[key]==='string'&&/^[a-zA-Z0-9]{6,128}$/.test(raw[key] as string),'payment_credentials_invalid',503);
 return Object.freeze(structuredClone(raw)) as Readonly<GrowPaymentConfig>;
}
export function paymentMinor(value:unknown):number{paymentRequire(typeof value==='string'&&/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value),'payment_provider_amount_invalid',409);const [whole,fraction='']=value.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));paymentRequire(Number.isSafeInteger(minor)&&minor>0&&minor<=100000000,'payment_provider_amount_invalid',409);return minor;}
const decimal=(minor:number)=>Math.floor(minor/100)+'.'+String(minor%100).padStart(2,'0');
const token=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9]{16,256}$/.test(v);
const identifier=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,15}$/.test(v);
async function sameToken(a:string,b:string){const left=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(a)),right=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(b));const x=new Uint8Array(left),y=new Uint8Array(right);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
export type GrowCallback={processId:string;processToken:string;transactionId:string;transactionToken:string;sumMinor:number;statusCode:'2';transactionTypeId:'1';orderId:string;asmachta:string};
const callbackFields=new Set(['err','status',...['asmachta','cardSuffix','cardType','cardTypeCode','cardBrand','cardBrandCode','cardExp','firstPaymentSum','periodicalPaymentSum','status','statusCode','transactionTypeId','paymentType','sum','paymentsNum','allPaymentsNum','paymentDate','description','fullName','payerPhone','payerEmail','transactionId','transactionToken','processId','processToken','payerBankAccountDetails'].map(x=>'data['+x+']'),'data[customFields][cField1]','data[paymentLinkProcessId]','data[paymentLinkProcessToken]']);
/** Grow documents form fields, not a JSON webhook or a signed HMAC header. */
export function growCallback(raw:unknown):GrowCallback{
 paymentRequire(raw instanceof URLSearchParams,'payment_callback_encoding_invalid');const fields=new Map<string,string>();for(const [key,value] of raw){paymentRequire(callbackFields.has(key)&&!fields.has(key)&&value.length<=1000,'payment_callback_fields_invalid');fields.set(key,value);}
 paymentRequire(fields.get('status')==='1'&&fields.get('err')===''&&fields.get('data[statusCode]')==='2'&&fields.get('data[transactionTypeId]')==='1'&&fields.get('data[allPaymentsNum]')==='1','payment_callback_not_paid_credit',409);
 const processId=fields.get('data[processId]'),processToken=fields.get('data[processToken]'),transactionId=fields.get('data[transactionId]'),transactionToken=fields.get('data[transactionToken]'),orderId=fields.get('data[customFields][cField1]'),asmachta=fields.get('data[asmachta]');
 paymentRequire(identifier(processId)&&identifier(transactionId)&&token(processToken)&&token(transactionToken)&&acceptedHash(orderId)&&typeof asmachta==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(asmachta),'payment_callback_identity_invalid',409);
 return{processId:processId!,processToken:processToken!,transactionId:transactionId!,transactionToken:transactionToken!,sumMinor:paymentMinor(fields.get('data[sum]')),statusCode:'2',transactionTypeId:'1',orderId:orderId!,asmachta:asmachta!};
}
/** Future route helper: bounded form-only parser; never logs or persists raw card/buyer fields. */
export async function readGrowCallback(request:Request){
 paymentRequire(request.method==='POST','payment_callback_method_invalid',405);const type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();paymentRequire(type==='application/x-www-form-urlencoded'||type==='multipart/form-data','payment_callback_encoding_invalid',415);
 const bytes=await paymentReadBytes(request.body,16384);
 let fields:URLSearchParams;try{if(type==='multipart/form-data'){const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')!}}).formData();fields=new URLSearchParams();for(const [key,value] of form){paymentRequire(typeof value==='string','payment_callback_encoding_invalid');fields.append(key,value);}}else{const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);paymentRequire(!/%(?![a-f0-9]{2})/i.test(raw),'payment_callback_encoding_invalid');fields=new URLSearchParams(raw);}}catch{throw new PaymentError(400,'payment_callback_encoding_invalid');}growCallback(fields);return fields;
}
export type GrowFetch=(url:string,init:RequestInit)=>Promise<Response>;
export class GrowGateway implements PaymentGateway{
 readonly config:Readonly<GrowPaymentConfig>;readonly environment:'sandbox'|'production';readonly origin:string;readonly base:string;
 private constructor(config:Readonly<GrowPaymentConfig>,readonly configHash:string,readonly transport:GrowFetch,readonly clock:()=>number){this.config=config;this.environment=config.environment;this.origin=config.environment==='sandbox'?paymentReviewOrigin:paymentProductionOrigin;this.base=config.environment==='sandbox'?growSandbox:growProduction;}
 static async accepted(raw:unknown,transport?:GrowFetch,clock=()=>Date.now(),release?:{stage:string;origin:string;paymentsReady:boolean;approvalReceiptHash:string;paymentEvidence?:unknown}|null){
  const config=paymentConfig(raw);paymentRequire(config&&typeof transport==='function','payments_disabled',503);
  if(config.environment==='production')paymentRequire(release?.stage==='production'&&release.origin===paymentProductionOrigin&&release.paymentsReady===true&&release.approvalReceiptHash===config.productionApprovalHash&&paymentCanonical(release.paymentEvidence)===paymentCanonical(paymentEvidence(config))&&await paymentHash(release)===config.finalReleaseHash,'payment_final_release_not_accepted',503);
  return new GrowGateway(config,await paymentHash(config),transport,clock);
 }
 private async post(method:'createPaymentProcess'|'getTransactionInfo'|'approveTransaction',fields:Record<string,string>){
  const body=new FormData();for(const [key,value] of Object.entries(fields))body.set(key,value);
  const controller=new AbortController(),started=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;
  const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new PaymentError(503,'payment_provider_transport_uncertain'));},8000);});
  try{
   const response=await Promise.race([this.transport(this.base+method,{method:'POST',body,headers:{accept:'application/json'},redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal}),expired]);
   paymentRequire(response.status===200&&response.url===this.base+method&&response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json','payment_provider_response_invalid',503);
   const bytes=await Promise.race([paymentReadBytes(response.body,65536,Math.max(1,8000-(performance.now()-started))),expired]);let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new PaymentError(503,'payment_provider_response_invalid');}
   paymentRequire(result&&typeof result==='object'&&!Array.isArray(result)&&(result.status===1||result.status==='1')&&result.err===''&&(method==='approveTransaction'?result.data===''&&result.message==='':result.data&&typeof result.data==='object'&&!Array.isArray(result.data)),'payment_provider_response_invalid',503);return (method==='approveTransaction'?result:result.data) as Record<string,unknown>;
  }catch(error){if(error instanceof PaymentError&&error.status===409)throw error;throw new PaymentError(503,'payment_provider_transport_uncertain');}
  finally{if(timer)clearTimeout(timer);}
 }
 async create(order:Order,buyer:Buyer):Promise<Process>{
  paymentRequire(order.configHash===this.configHash&&order.environment===this.environment&&order.state==='creating'&&order.quote.currency===this.config.currency,'payment_provider_order_conflict',409);
  const started=this.clock(),data=await this.post('createPaymentProcess',{pageCode:this.config.pageCode,userId:this.config.userId,chargeType:'1',sum:decimal(order.quote.amountMinor),paymentNum:'1',description:order.quote.title,'pageField[fullName]':buyer.fullName,'pageField[phone]':buyer.phone,'pageField[email]':buyer.email,cField1:order.id,'transactionTypes[0]':'1',notifyUrl:this.origin+paymentCallbackPath,successUrl:this.origin+'/payment/success/?order='+order.id,cancelUrl:this.origin+'/payment/cancel/?order='+order.id});
  const id=typeof data.processId==='number'&&Number.isSafeInteger(data.processId)?String(data.processId):data.processId;
  paymentRequire(identifier(id)&&token(data.processToken)&&typeof data.authCode==='string'&&data.authCode.length>=16&&data.authCode.length<=2000&&!/[\s<>"']/.test(data.authCode),'payment_provider_process_invalid',503);
  paymentRequire(Number.isFinite(started)&&this.clock()>=started&&this.clock()-started<10000,'payment_provider_deadline_invalid',503);
  return{processId:id as string,processToken:data.processToken as string,authCode:data.authCode as string,expiresAt:started+600000};
 }
 private async bound(order:Order,raw:unknown){const callback=growCallback(raw);paymentRequire(order.configHash===this.configHash&&order.environment===this.environment&&order.tenantId===this.config.tenantId&&order.siteId===this.config.siteId&&order.process&&callback.orderId===order.id&&callback.processId===order.process.processId&&await sameToken(callback.processToken,order.process.processToken)&&callback.sumMinor===order.quote.amountMinor&&order.quote.currency===this.config.currency,'payment_callback_binding_conflict',409);return callback;}
 async verify(order:Order,raw:unknown):Promise<VerifiedTransaction>{
  const callback=await this.bound(order,raw);
  // Inquiry on each callback is not Grow's default documented flow. This path
  // requires the explicit merchant-specific callbackReadbackApproved gate above.
  const data=await this.post('getTransactionInfo',{pageCode:this.config.pageCode,transactionId:callback.transactionId,transactionToken:callback.transactionToken});
  paymentRequire(String(data.statusCode)==='2'&&String(data.transactionTypeId)==='1'&&String(data.allPaymentsNum)==='1'&&String(data.processId)===callback.processId&&data.processToken===callback.processToken&&String(data.transactionId)===callback.transactionId&&data.transactionToken===callback.transactionToken&&data.asmachta===callback.asmachta&&paymentMinor(data.sum)===order.quote.amountMinor,'payment_readback_mismatch',409);
  // The published Grow response has no currency field. Currency authority is
  // the separately verified merchant/page configuration; never fabricate a field.
  paymentRequire(!Object.hasOwn(data,'currency')||data.currency==='ILS','payment_currency_mismatch',409);
  return{transactionId:callback.transactionId,transactionTokenHash:await paymentHash(callback.transactionToken),asmachta:callback.asmachta,amountMinor:order.quote.amountMinor,currency:'ILS',currencyAuthority:'verified-merchant-config',providerEvidenceHash:await paymentHash({transactionId:callback.transactionId,processId:callback.processId,statusCode:2,amountMinor:order.quote.amountMinor,currencyEvidenceHash:this.config.currencyEvidenceHash})};
 }
 async acknowledge(order:Order,raw:unknown){
  await this.bound(order,raw);paymentRequire(order.state==='paid_verified'&&order.transaction&&this.config.acknowledgmentContract==='full-documented-form/v1','payment_ack_order_unverified',409);
  // Exact documented request parameters. Missing merchant callback fields stay
  // blocked; never fill payment-link/card/customer fields from guesses or storage.
  const required=['transactionId','transactionToken','transactionTypeId','paymentType','sum','firstPaymentSum','periodicalPaymentSum','paymentsNum','allPaymentsNum','paymentDate','asmachta','description','fullName','payerPhone','payerEmail','cardSuffix','cardType','cardTypeCode','cardBrand','cardBrandCode','cardExp','processId','processToken','paymentLinkProcessId','paymentLinkProcessToken'];
  paymentRequire(raw instanceof URLSearchParams,'payment_ack_contract_missing_fields',409);const fields:Record<string,string>={pageCode:this.config.pageCode};
  for(const name of required){const value=raw.get('data['+name+']');paymentRequire(value!==null&&value.length<=1000,'payment_ack_contract_missing_fields',409);fields[name]=value;}
  paymentRequire(fields.paymentType==='2'&&/^\d{4}$/.test(fields.cardSuffix)&&/^\d{4}$/.test(fields.cardExp)&&/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(fields.paymentDate)&&identifier(fields.paymentLinkProcessId)&&token(fields.paymentLinkProcessToken),'payment_ack_contract_missing_fields',409);
  const requestHash=await paymentHash(fields),receipt=await this.post('approveTransaction',fields);return{requestHash,receiptHash:await paymentHash(receipt)};
 }
 async matches(order:Order,raw:unknown){try{const callback=await this.bound(order,raw);return order.transaction?.transactionId===callback.transactionId&&order.transaction.transactionTokenHash===await paymentHash(callback.transactionToken)&&order.transaction.asmachta===callback.asmachta;}catch{return false;}}
}
