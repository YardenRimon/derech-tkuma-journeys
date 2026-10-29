/** Deployment-owned presentation gate; no public query or DOM may enable cart. */
import {preparePublicCart,type PublicCartConfig} from './cart-client';
import {preparePublicCheckout} from './checkout-client';
import {currentCollectionSeed} from './collection-projection';
import {cartRuntimeRequest,type CartBindings} from './cart-runtime';
import type {CartScope} from './cart-d1';
import {productionRelease,prepareProductionPage,productionCsp} from './visitor-release';
const sourceProductIds=[...currentCollectionSeed.filter(row=>row.kind==='occurrence').map(row=>row.id.replace(/^source-product-/,'')),'7969'];
export function publicCartConfiguration(url:URL,bindings:CartBindings):PublicCartConfig{
 const mode=bindings.CART_MODE;
 if(!bindings.DB||bindings.CMS_ADAPTER_MODE!=='isolated-d1'||!['review','production'].includes(mode??''))return {};
 const productionApproved=mode==='production'&&productionRelease(url)!==null;
 if(url.origin!==(mode==='review'?'https://derech-tkuma-review.22yarden22.workers.dev':'https://derech-tkuma.com')||mode==='production'&&!productionApproved)return {};
 return {enabled:true,mode:mode as 'review'|'production',productionApproved,productIds:sourceProductIds};
}
export function prepareCommercePage(html:string,url:URL,bindings:CartBindings){return preparePublicCart(html,url,publicCartConfiguration(url,bindings));}
/** Checkout must precede the captured source empty-cart redirect. Read the
 * existing private guest-cart boundary in process; never fetch our own API. */
export async function checkoutPageResponse(request:Request,bindings:CartBindings,scope:CartScope|(()=>CartScope),loadPage:(path:string)=>Promise<string>):Promise<Response|null>{
 const url=new URL(request.url),config=publicCartConfiguration(url,bindings);
 if(!['GET','HEAD'].includes(request.method)||url.pathname!=='/checkout/'||url.search||url.hash||config.enabled!==true)return null;
 const protectedHeaders={'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN','permissions-policy':'camera=(), microphone=(), geolocation=()','vary':'Cookie'};
 const api=new URL('/api/cart/',url),cartResponse=await cartRuntimeRequest(new Request(api,{headers:request.headers}),bindings,typeof scope==='function'?scope():scope);
 if(cartResponse.status===200){const state=await cartResponse.json() as {cart?:{lines?:unknown[]}|null};if(!state.cart?.lines?.length)return new Response(null,{status:302,headers:{...protectedHeaders,location:'/cart/'}});}
 // Keep an unavailable-cart view renderable, with no payment activation. The
 // client independently obtains its owned quote; no amounts enter HTML here.
 let html=await loadPage('/cart/');
 const profile=productionRelease(url);if(profile)html=prepareProductionPage(html,new URL('/cart/',url),profile);
 html=html.replace(/<meta\b[^>]*\bname=["']referrer["'][^>]*>/gi,'<meta name="referrer" content="no-referrer">');
 html=html.replace(/<head(?:\s[^>]*)?>/i,head=>head+'<meta name="robots" content="noindex,nofollow,noarchive">');
 html=html.replace(/<title>[\s\S]*?<\/title>/i,'<title>פרטי הרשמה | דרך התקומה</title>');
 html=html.replace(/(<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["'])[^"']*(["'][^>]*>)/i,(_all,start,end)=>start+url.origin+'/checkout/'+end);
 html=preparePublicCheckout(html,url,{...config,paymentReady:false});
 return new Response(html,{headers:{...protectedHeaders,...(profile?{'content-security-policy':productionCsp}:{})}});
}
