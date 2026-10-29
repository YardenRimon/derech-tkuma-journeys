import {NATIVE_COMMERCE_ENABLED,frozenBusinessResponse} from '@/lib/business-scope';
import {env} from 'cloudflare:workers';
import {siteScope} from '@/lib/site-scope';
import {nativePaymentReceiptPage} from '@/lib/native-payment-receipt';
import type {CartPaymentRuntimeBindings} from '@/lib/cart-payment-runtime';
import {paymentReceiptPage,type PaymentReceiptBindings} from '@/lib/payment-status';
export const dynamic='force-dynamic';
export async function GET(request:Request){if(!NATIVE_COMMERCE_ENABLED)return frozenBusinessResponse();try{const mode=(env as unknown as CartPaymentRuntimeBindings).CART_PAYMENT_MODE;if(mode==='sandbox'||mode==='production')return await nativePaymentReceiptPage(request,env as unknown as CartPaymentRuntimeBindings,siteScope(),'success');return await paymentReceiptPage(request,env as unknown as PaymentReceiptBindings,siteScope(),'success');}catch{return paymentReceiptPage(request,{}, {tenantId:'derech',siteId:'derech-main'},'success');}}
