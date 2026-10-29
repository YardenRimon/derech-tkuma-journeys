/** Public receipt pages: read saved state only. A browser return never confirms a payment. */
import {paymentRequire,paymentScope,PaymentError,type Order} from './payment-core';
import {GrowGateway,paymentConfig,paymentReviewOrigin,paymentProductionOrigin} from './payment-grow';
import {D1Payments} from './payment-d1';
import {productionRelease,type ProductionProfile} from './visitor-release';
import type {Scope} from './collection-core';
export type PaymentReceiptKind='success'|'cancel';
export type PaymentReceiptBindings={DB?:D1Database;PAYMENT_CONFIG?:string;CMS_ADAPTER_MODE?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
export type PaymentReceiptStatus='confirmed'|'paid_pending_ack'|'pending'|'unverified'|'disabled';
const paths={success:'/payment/success/',cancel:'/payment/cancel/'};
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function receiptQuery(url:URL){
 paymentRequire(url.href.length<=512,'payment_receipt_query_invalid',400);const fields=new Map<string,string>();
 for(const [key,value] of url.searchParams){paymentRequire(['order','response','cField1'].includes(key)&&!fields.has(key)&&value.length<=64,'payment_receipt_query_invalid',400);fields.set(key,value);}
 const id=fields.get('order');paymentRequire(id===undefined||hash(id),'payment_receipt_query_invalid',400);
 if(fields.has('response'))paymentRequire(/^[a-zA-Z_-]{1,32}$/.test(fields.get('response')!),'payment_receipt_query_invalid',400);
 if(fields.has('cField1'))paymentRequire(id&&fields.get('cField1')===id,'payment_receipt_query_invalid',400);
 return id??null; // Every provider/browser response parameter is deliberately non-authoritative.
}
function savedStatus(order:Order|null):PaymentReceiptStatus{
 if(!order)return'unverified';
 if(order.state==='paid_verified'&&order.acknowledgment?.state==='confirmed'&&hash(order.acknowledgment.requestHash)&&hash(order.acknowledgment.receiptHash)&&Number.isSafeInteger(order.quote.amountMinor)&&order.quote.amountMinor>0&&order.quote.currency==='ILS'&&order.transaction?.amountMinor===order.quote.amountMinor&&order.transaction.currency===order.quote.currency&&order.transaction.currencyAuthority==='verified-merchant-config'&&hash(order.transaction.transactionTokenHash)&&hash(order.transaction.providerEvidenceHash))return'confirmed';
 return'pending';
}
export async function readPaymentReceipt(request:Request,bindings:PaymentReceiptBindings,scope:Scope,kind:PaymentReceiptKind,releaseFor:(url:URL)=>ProductionProfile|null=productionRelease):Promise<PaymentReceiptStatus>{
 paymentRequire(request.method==='GET','payment_receipt_method_invalid',405);paymentScope(scope);const url=new URL(request.url);paymentRequire(url.pathname===paths[kind]&&!url.hash,'payment_receipt_target_denied',403);const id=receiptQuery(url);
 const raw=bindings.PAYMENT_CONFIG;paymentRequire(typeof raw==='string'&&new TextEncoder().encode(raw).byteLength<=8192,'payments_disabled',503);let value;try{value=JSON.parse(raw);}catch{throw new PaymentError(503,'payments_disabled');}
 const config=paymentConfig(value);paymentRequire(config&&bindings.DB,'payments_disabled',503);const origin=config.environment==='sandbox'?paymentReviewOrigin:paymentProductionOrigin;paymentRequire(url.origin===origin,'payment_receipt_target_denied',403);
 // Config/profile validation only. No gateway method or provider transport runs.
 const gateway=await GrowGateway.accepted(config,async()=>{throw new Error('receipt_transport_forbidden');},()=>Date.now(),config.environment==='production'?releaseFor(url):null);
 paymentRequire(bindings.CMS_ADAPTER_MODE==='isolated-d1'&&bindings.CMS_TENANT_ID===scope.tenantId&&bindings.CMS_SITE_ID===scope.siteId,'payment_receipt_scope_unavailable',503);
 // The shared assertIsolatedD1Scope can initialize scope. Receipt GET must not write.
 const deployed=await bindings.DB.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();paymentRequire(deployed?.tenant_id===scope.tenantId&&deployed.site_id===scope.siteId,'payment_receipt_scope_unavailable',503);
 if(!id)return'unverified';
 const order=await new D1Payments(bindings.DB).get(scope,id);if(order&&(order.configHash!==gateway.configHash||order.environment!==config.environment))return'unverified';return savedStatus(order);
}
const styles=`:root{color-scheme:light;--green:#254d3f;--ink:#253c33;--muted:#617064;--cream:#f7f5ef;--line:#dce4d6;--gold:#bd985c}*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:var(--cream);color:var(--ink);font:16px/1.75 Arial,"Noto Sans Hebrew",sans-serif;display:flex;flex-direction:column}a{color:var(--green);text-underline-offset:4px}a:focus-visible{outline:3px solid var(--gold);outline-offset:5px}.skip{position:fixed;top:-100px;right:18px;padding:10px 16px;background:white;z-index:2}.skip:focus{top:12px}header{background:#fff;border-bottom:1px solid var(--line);padding:20px 32px}.brand{display:inline-block;max-width:100%;line-height:0}.brand img{width:230px;max-width:100%;height:auto}main{flex:1;display:grid;place-items:center;padding:48px 20px}.card{width:100%;max-width:640px;border:1px solid var(--line);border-radius:22px;padding:38px;background:#fff;box-shadow:0 12px 40px #213e2f08;overflow-wrap:anywhere}.eyebrow{font-size:13px;color:#88714c;margin:0 0 12px}.mark{width:52px;height:52px;display:grid;place-items:center;border-radius:50%;background:#eef3e9;color:var(--green);font-size:26px;margin-bottom:20px}h1{font-size:30px;line-height:1.35;margin:0 0 16px;letter-spacing:-.6px}p{margin:0 0 16px;color:var(--muted)}.state{margin:22px 0;border:1px solid var(--line);background:#f4f7ef;padding:17px 20px;border-radius:12px}.state strong{display:block;color:var(--green);font-size:18px;margin-bottom:4px}.state p{margin:0;font-size:14px}.links{display:flex;gap:12px;flex-wrap:wrap;margin-top:25px}.links a{display:inline-flex;justify-content:center;align-items:center;min-height:46px;padding:11px 18px;border:1px solid var(--green);border-radius:9px;text-decoration:none;flex:1;min-width:150px}.links .primary{background:var(--green);color:#fff}footer{text-align:center;padding:18px 20px 26px;font-size:12px;color:var(--muted)}@media(max-width:520px){header{padding:17px 22px}.brand img{width:190px}main{padding:28px 16px}.card{padding:27px 23px;border-radius:17px}h1{font-size:25px}.links{display:grid;grid-template-columns:1fr}.links a{min-width:0}.state{padding:15px 16px}}`;
function html(kind:PaymentReceiptKind,status:PaymentReceiptStatus,nonce:string){
 const confirmed=status==='confirmed',paid=confirmed||status==='paid_pending_ack',title=kind==='cancel'?'חזרת מעמוד התשלום':paid?'התשלום אומת':'בדיקת מצב התשלום';
 const heading=confirmed?'התשלום התקבל ואומת':status==='paid_pending_ack'?'התשלום אומת; העדכון ממתין לבדיקה':status==='pending'?'ממתינים לאישור מלא':status==='disabled'?'בדיקת התשלום אינה זמינה כרגע':'אין כאן אישור לתשלום';
 const message=confirmed?'אישור התשלום התקבל ונשמר במערכת.':status==='paid_pending_ack'?'ספק התשלום אימת את החיוב. העדכון הסופי במערכת עדיין דורש בדיקה. אין צורך לשלם שוב.':status==='pending'?'מצב התשלום עדיין בבדיקה. אפשר לרענן את העמוד בעוד כמה רגעים, או לפנות אלינו לבירור.':'אפשר לפנות אלינו לבירור מצב התשלום.';
 const intro=kind==='cancel'?'החזרה לעמוד הזה אינה מבטלת תשלום ואינה מבצעת החזר. מצב התשלום מופיע להלן.':'המצב המוצג כאן נקבע לפי האישור שנשמר במערכת. עצם החזרה מעמוד התשלום אינה אישור לחיוב.';
 return`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${title} | דרך התקומה</title><style nonce="${nonce}">${styles}</style></head><body><a class="skip" href="#receipt-main" rel="noreferrer">דילוג לתוכן</a><header><a class="brand" href="/" rel="noreferrer" aria-label="דרך התקומה — חזרה לאתר"><img src="/wp-content/uploads/2025/08/לוגו-דרך-התקומה-1024x206.webp" width="1024" height="206" alt="דרך התקומה"></a></header><main id="receipt-main"><section class="card" aria-labelledby="receipt-title" data-payment-receipt="${status}"><p class="eyebrow">דרך התקומה</p><div class="mark" aria-hidden="true">${confirmed?'✓':'·'}</div><h1 id="receipt-title">${title}</h1><p>${intro}</p><div class="state" role="status"><strong>${heading}</strong><p>${message}</p></div><nav class="links" aria-label="המשך ובירור"><a class="primary" href="/" rel="noreferrer">חזרה לאתר</a><a href="https://wa.me/972535955166" target="_blank" rel="noopener noreferrer">לבירור ב־WhatsApp</a></nav></section></main><footer>דרך התקומה</footer></body></html>`;
}
export async function paymentReceiptPage(request:Request,bindings:PaymentReceiptBindings,scope:Scope,kind:PaymentReceiptKind,releaseFor:(url:URL)=>ProductionProfile|null=productionRelease){
 let status:PaymentReceiptStatus='unverified',code=200;try{status=await readPaymentReceipt(request,bindings,scope,kind,releaseFor);}catch(error){code=error instanceof PaymentError?error.status:503;status=code===503?'disabled':'unverified';}
 return paymentReceiptResponse(kind,status,code);
}
/** Shared branded private renderer, with no provider or storage authority. */
export function paymentReceiptResponse(kind:PaymentReceiptKind,status:PaymentReceiptStatus,code=200){
 const nonce=[...crypto.getRandomValues(new Uint8Array(24))].map(x=>x.toString(16).padStart(2,'0')).join('');return new Response(html(kind,status,nonce),{status:code,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store, max-age=0','x-robots-tag':'noindex, nofollow, noarchive','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`}});
}
