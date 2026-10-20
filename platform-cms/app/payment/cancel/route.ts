import {env} from 'cloudflare:workers';
import {siteScope} from '@/lib/site-scope';
import {paymentReceiptPage,type PaymentReceiptBindings} from '@/lib/payment-status';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{return await paymentReceiptPage(request,env as unknown as PaymentReceiptBindings,siteScope(),'cancel');}catch{return paymentReceiptPage(request,{}, {tenantId:'derech',siteId:'derech-main'},'cancel');}}
