import {env} from 'cloudflare:workers';
import {siteScope} from '@/lib/site-scope';
import {cartRuntimeRequest,type CartBindings} from '@/lib/cart-runtime';
export const dynamic='force-dynamic';
async function cartRequest(request:Request){
 try{return await cartRuntimeRequest(request,env as unknown as CartBindings,siteScope());}
 catch{return Response.json({accepted:false,code:'cart_disabled'},{status:503,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});}
}
export {cartRequest as GET,cartRequest as POST};
