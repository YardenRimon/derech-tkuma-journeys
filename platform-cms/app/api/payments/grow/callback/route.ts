import {NATIVE_COMMERCE_ENABLED,frozenBusinessResponse} from '@/lib/business-scope';
import {env} from 'cloudflare:workers';
import {siteScope} from '@/lib/site-scope';
import {cartPaymentRuntimeRequest,type CartPaymentRuntimeBindings} from '@/lib/cart-payment-runtime';
import {paymentCallbackRequest,type PaymentBindings} from '@/lib/payment-http';
export const dynamic='force-dynamic';
export async function POST(request:Request){if(!NATIVE_COMMERCE_ENABLED)return frozenBusinessResponse();try{const mode=(env as unknown as CartPaymentRuntimeBindings).CART_PAYMENT_MODE;if(mode==='sandbox'||mode==='production')return await cartPaymentRuntimeRequest(request,env as unknown as CartPaymentRuntimeBindings,siteScope());return await paymentCallbackRequest(request,env as unknown as PaymentBindings,siteScope());}catch{return Response.json({accepted:false,code:'payments_disabled'},{status:503,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});}}
