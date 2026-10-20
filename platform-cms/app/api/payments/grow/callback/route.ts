import {env} from 'cloudflare:workers';
import {siteScope} from '@/lib/site-scope';
import {paymentCallbackRequest,type PaymentBindings} from '@/lib/payment-http';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return await paymentCallbackRequest(request,env as unknown as PaymentBindings,siteScope());}catch{return Response.json({accepted:false,code:'payments_disabled'},{status:503,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});}}
