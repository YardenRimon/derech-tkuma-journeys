import {NATIVE_COMMERCE_ENABLED,frozenBusinessResponse} from '@/lib/business-scope';
import {env} from 'cloudflare:workers';
import {siteScope} from '@/lib/site-scope';
import {cartPaymentRuntimeRequest,type CartPaymentRuntimeBindings} from '@/lib/cart-payment-runtime';
export const dynamic='force-dynamic';
async function nativeOrder(request:Request){if(!NATIVE_COMMERCE_ENABLED)return frozenBusinessResponse();try{return await cartPaymentRuntimeRequest(request,env as unknown as CartPaymentRuntimeBindings,siteScope());}catch{return Response.json({accepted:false,code:'payment_unavailable'},{status:503,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});}}
export {nativeOrder as POST};
