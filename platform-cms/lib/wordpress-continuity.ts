/** Local preparation only. No runtime flag can activate this adapter. Original
 * WordPress remains the only business writer; no payment interpretation/retry. */
export type LegacyContinuity={schema:1;mode:'cloudflare-route-origin';sourceCommit:string;approvalHash:string;originRoutingProof:string;formsProof:string;businessProof:string};
type AcceptedProfile={origin:string;aliasOrigin:string;sourceCommit:string;gates:Record<string,boolean>};
const hash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function acceptedWordPressContinuity(value:unknown,profile:AcceptedProfile):LegacyContinuity|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as LegacyContinuity;
 if(Object.keys(v).sort().join(',')!=='approvalHash,businessProof,formsProof,mode,originRoutingProof,schema,sourceCommit'||v.schema!==1||v.mode!=='cloudflare-route-origin'||v.sourceCommit!==profile.sourceCommit||profile.origin!=='https://derech-tkuma.com'||profile.aliasOrigin!=='https://www.derech-tkuma.com'||profile.gates.ownerCutoverApproved!==true||profile.gates.sourceRoutingVerified!==true||profile.gates.providerConnectionsAccepted!==true||![v.approvalHash,v.originRoutingProof,v.formsProof,v.businessProof].every(hash))return null;
 return Object.freeze({...v});
}
const managed=/^\/product\/managed-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/$/;
/** URL/query/body are retained byte-for-byte. Native /admin,/api,/login and
 * managed informational pages are never dispatched to the legacy writer. */
export function wordpressRoute(request:Request):boolean{
 const u=new URL(request.url);if(!['https://derech-tkuma.com','https://www.derech-tkuma.com'].includes(u.origin))return false;
 let p:string;try{p=decodeURIComponent(u.pathname);}catch{return false;}
 if(/%(?:2f|5c)/i.test(u.pathname)||/[\\\u0000-\u001f]/.test(p)||p.includes('//')||/^\/(?:admin|api|auth|login|logout|media|_next|__pilot__|measurement-frame|visitor-configuration)(?:\/|$)/i.test(p)||managed.test(p))return false;
 if(['wc-api','wc-ajax','add-to-cart'].some(key=>u.searchParams.has(key)))return true;
 return /^\/(?:wp-admin|wp-json|cart|checkout|my-account|order-pay|order-received|wc-api|product|product-category)(?:\/|$)/i.test(p)||/^\/(?:wp-login|wp-cron|wp-comments-post)\.php$/i.test(p);
}
const wpCookie=/^(?:wordpress_(?:logged_in_|sec_)?[a-f0-9]{32}|wordpress_test_cookie|wp-settings-(?:time-)?\d+|wp_woocommerce_session_[a-f0-9]{32}|woocommerce_(?:items_in_cart|cart_hash)|wp-wpml_current_language)$/;
export function wordpressCookieHeader(raw:string|null){return(raw??'').split(';').map(x=>x.trim()).filter(x=>{const i=x.indexOf('=');return i>0&&wpCookie.test(x.slice(0,i));}).join('; ');}
export function wordpressRequest(request:Request){
 const headers=new Headers(request.headers);for(const key of [...headers.keys()])if(/^(?:authorization|proxy-authorization|host|x-platform-|oai-|x-oai-|x-auth-|x-cms-|x-derech-|x-supabase-|cf-access-)/i.test(key))headers.delete(key);
 const cookie=wordpressCookieHeader(request.headers.get('cookie'));if(cookie)headers.set('cookie',cookie);else headers.delete('cookie');
 headers.set('cache-control','no-cache');
 return new Request(request,{headers,redirect:'manual'});
}
const unavailable=()=>new Response('Existing site action unavailable; no automatic retry',{status:502,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow'}});
export async function dispatchWordPress(request:Request,fetcher:typeof fetch=fetch):Promise<Response>{
 if(!wordpressRoute(request))return new Response('Not a WordPress route',{status:404,headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
 // Exactly one request, including POST. Timeout/unknown outcomes never replay.
 try{const incoming=wordpressRequest(request),response=await fetcher(incoming,{redirect:'manual',signal:AbortSignal.timeout(15000)}),headers=new Headers(response.headers);
  const cookies=headers.getSetCookie();headers.delete('set-cookie');for(const cookie of cookies){const name=cookie.slice(0,cookie.indexOf('='));if(wpCookie.test(name))headers.append('set-cookie',cookie);}
  headers.set('cache-control','private, no-store');headers.delete('x-derech-public-profile');headers.delete('x-platform-authenticated-id');
  const url=new URL(request.url),publicCatalog=/^\/(?:product|product-category)(?:\/|$)/.test(url.pathname)&&['GET','HEAD'].includes(request.method)&&!['wc-api','wc-ajax','add-to-cart'].some(key=>url.searchParams.has(key));
  if(!publicCatalog||response.status>=400)headers.set('x-robots-tag','noindex, nofollow');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }catch{return unavailable();}
}
async function boundedText(response:Response,max=1500000){if(response.status!==200||!response.headers.get('content-type')?.includes('text/html')||!response.body)throw new Error('source_unavailable');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('source_unavailable');chunks.push(value);}}catch(error){await reader.cancel();throw error;}const joined=new Uint8Array(size);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(joined);}
/** Parse inert JSON only. Never execute recovered source scripts. */
export function elementorNonce(html:string){
 const marker=/\bvar\s+ElementorProFrontendConfig\s*=\s*/g;const first=marker.exec(html);if(!first||marker.exec(html))throw new Error('source_nonce_unavailable');let at=first.index+first[0].length,start=at,depth=0,string=false,escape=false,end=-1;
 if(html[at]!=='{')throw new Error('source_nonce_unavailable');for(;at<html.length&&at-start<65536;at++){const c=html[at];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;}else if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=at+1;break;}}
 if(end<0||!/^\s*;/.test(html.slice(end)))throw new Error('source_nonce_unavailable');const value=JSON.parse(html.slice(start,end));if(typeof value?.nonce!=='string'||!/^[a-f0-9]{10}$/.test(value.nonce))throw new Error('source_nonce_unavailable');return {nonce:value.nonce,start,end,value};
}
/** Replace only captured public nonce and the exact prepared guard. No business
 * fields, form IDs, provider URLs, source JS or CMS draft data are imported. */
export async function prepareWordPressForms(response:Response,request:Request,fetcher:typeof fetch=fetch):Promise<Response>{
 if(response.status!==200||!response.headers.get('content-type')?.includes('text/html')||!['GET','HEAD'].includes(request.method))return response;
 if(request.method==='HEAD')return response;
 const html=await boundedText(response),current=elementorNonce(html),url=new URL(request.url),sourceRequest=wordpressRequest(new Request(url.origin+'/',{headers:request.headers}));
 const fresh=await boundedText(await fetcher(sourceRequest,{redirect:'manual',signal:AbortSignal.timeout(10000)})),nonce=elementorNonce(fresh).nonce;
 const raw=html.slice(current.start,current.end),noncePattern=/("nonce"\s*:\s*")[a-f0-9]{10}(")/g;if([...raw.matchAll(noncePattern)].length!==1)throw new Error('source_nonce_unavailable');const next=raw.replace(noncePattern,(_match,start,end)=>start+nonce+end),guard='<script src="/production-guard.js" data-production-policy="guard-first"></script>';
 if(html.split(guard).length!==2)throw new Error('source_guard_unavailable');
 const body=(html.slice(0,current.start)+next+html.slice(current.end)).replace(guard,'<script src="/wordpress-continuity-guard.js" data-production-policy="existing-wordpress"></script>');
 const headers=new Headers(response.headers);headers.set('cache-control','private, no-store');headers.delete('etag');headers.delete('content-length');headers.set('content-security-policy',headers.get('content-security-policy')?.replace("form-action 'none'","form-action 'self'")??"default-src 'self'; form-action 'self'");
 return new Response(body,{status:200,headers});
}
