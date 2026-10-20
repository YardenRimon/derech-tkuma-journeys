/** Separate owner-accepted production entry. The review entry/validator stay
 * fixed to review and cannot opt into this code through runtime requests. */
import handler from 'vinext/server/fetch-handler';
import {serveCloudflareBuildAsset} from './cloudflare-assets.mjs';
import {stripIdentityHeaders,platformAuthBoundary} from './platform-auth-boundary';
import {readPlatformAuthIdentity,appendPlatformAuthCookies} from '../lib/platform-auth';
import {productionRelease,productionPublicPath,productionIndexablePath,productionCsp,productionRobots,productionSitemap} from '../lib/visitor-release';
declare const __PLATFORM_AUTH_REQUIRE_MFA__:boolean;
export default{
 async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  const url=new URL(request.url),profile=productionRelease(url);
  const rejected=(status=503)=>new Response('Production release unavailable',{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
  if(!profile)return rejected();
  if(url.origin!==profile.origin){
   if((request.method==='GET'||request.method==='HEAD')&&(productionPublicPath(url.pathname)||['/robots.txt','/sitemap.xml'].includes(url.pathname)))return new Response(null,{status:308,headers:{location:profile.origin+url.pathname,'cache-control':'public, max-age=300','x-robots-tag':'noindex, nofollow'}});
   return rejected(421);
  }
  if((/^\/api\/contact\/?$/.test(url.pathname)&&!profile.contactReady)||(/^\/api\/(?:payment|payments|orders)(?:\/|$)/.test(url.pathname)&&!profile.paymentsReady))return rejected();
  const config=env as unknown as {PLATFORM_RELEASE_STAGE?:string;PLATFORM_RELEASE_SHA?:string;PLATFORM_PUBLIC_ORIGIN?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
  if(config.PLATFORM_RELEASE_STAGE!=='production'||config.PLATFORM_RELEASE_SHA!==profile.sourceCommit||config.PLATFORM_PUBLIC_ORIGIN!==profile.origin||config.CMS_TENANT_ID!=='derech'||config.CMS_SITE_ID!=='derech-main')return rejected();
  if(['GET','HEAD'].includes(request.method)&&['/robots.txt','/sitemap.xml'].includes(url.pathname))return new Response(request.method==='HEAD'?null:url.pathname==='/robots.txt'?productionRobots(profile):productionSitemap(),{headers:{'content-type':url.pathname==='/robots.txt'?'text/plain; charset=utf-8':'application/xml; charset=utf-8','cache-control':'no-store','x-derech-release':profile.sourceCommit,'x-content-type-options':'nosniff'}});
  const stripped=stripIdentityHeaders(request),boundary=await platformAuthBoundary(stripped,input=>readPlatformAuthIdentity(input,{requireAal2:__PLATFORM_AUTH_REQUIRE_MFA__}),{requireMfa:__PLATFORM_AUTH_REQUIRE_MFA__});
  const response=boundary.response??await serveCloudflareBuildAsset(boundary.request,env as Cloudflare.Env&{ASSETS?:{fetch:(request:Request)=>Promise<Response>}})??await handler.fetch(boundary.request,env,ctx);
  const result=boundary.cookiesToSet.length?appendPlatformAuthCookies(response,boundary.cookiesToSet):new Response(response.body,response);
  // Only an actual known public HTML/robots/sitemap success can be indexed.
  // Errors, API/admin/media/assets and measurement documents remain noindex.
  const publicSuccess=result.status===200&&(productionIndexablePath(url.pathname)&&result.headers.get('x-derech-public-profile')===profile.sourceCommit||['/robots.txt','/sitemap.xml'].includes(url.pathname)&&result.headers.get('x-derech-public-profile')===profile.sourceCommit);
  if(publicSuccess){result.headers.delete('x-robots-tag');if(productionPublicPath(url.pathname))result.headers.set('content-security-policy',productionCsp);}
  else result.headers.set('x-robots-tag','noindex, nofollow');
  result.headers.delete('x-derech-public-profile');result.headers.set('x-derech-release',profile.sourceCommit);result.headers.set('x-content-type-options','nosniff');return result;
 }
};
