/** Deployment-owned guest cart wiring; disabled until explicitly configured. */
import {assertIsolatedD1Scope} from './access';
import {D1GuestCarts,type CartScope} from './cart-d1';
import {guestCartRequest} from './cart-http';
import {cartIngress} from './cart-controls';
import {productionRelease} from './visitor-release';
export type CartBindings={DB?:D1Database;CART_MODE?:string;CMS_ADAPTER_MODE?:string};
const unavailable=()=>Response.json({accepted:false,code:'cart_disabled'},{status:503,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
export async function cartRuntimeRequest(request:Request,bindings:CartBindings,scope:CartScope){
 try{
  if(!['review','production'].includes(bindings.CART_MODE??'')||bindings.CMS_ADAPTER_MODE!=='isolated-d1'||!bindings.DB||scope.tenantId!=='derech'||scope.siteId!=='derech-main')return unavailable();
  const mode=bindings.CART_MODE as 'review'|'production',productionApproved=mode==='production'&&productionRelease(new URL(request.url))!==null;
  if(mode==='production'&&!productionApproved)return unavailable();
  await assertIsolatedD1Scope(bindings.DB);
  // Verified Woo source defaults: guest session48h; unpaid stock hold60min.
  // Payment creation separately latches uncertain holds beyond these TTLs.
  const store=new D1GuestCarts(bindings.DB,scope,{cartTtlMs:48*3600000,holdTtlMs:60*60000});
  let reserveNew:(()=>Promise<void>)|undefined;
  return await guestCartRequest(request,{mode,productionApproved,store,clock:()=>Date.now(),uuid:()=>crypto.randomUUID(),ingress:async(req,kind)=>{reserveNew=await cartIngress(bindings.DB!,scope,req,kind);},reserveNew:async()=>{if(!reserveNew)throw new Error('cart_ingress_unavailable');await reserveNew();}});
 }catch{return unavailable();}
}
