import handler from 'vinext/server/fetch-handler';
import {serveCloudflareBuildAsset} from './cloudflare-assets.mjs';
import {accessDiagnosticsEnabled,accessDiagnosticPath,ACCESS_DIAGNOSTIC_SCOPE_HEADER,reportAccessHeaderPresence} from '../lib/cloudflare-access';
import { stripIdentityHeaders, platformAuthBoundary } from './platform-auth-boundary';
import { readPlatformAuthIdentity, appendPlatformAuthCookies } from '../lib/platform-auth';
declare const __PLATFORM_AUTH_PROVIDER__: 'cloudflare-access' | 'supabase';
declare const __PLATFORM_AUTH_REQUIRE_MFA__: boolean;
export default {
 async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  // Caller-controlled Sites identity headers never cross the standalone boundary.
  const strippedRequest=stripIdentityHeaders(request);
  const headers=new Headers(strippedRequest.headers);
  const config=env as unknown as {PLATFORM_RELEASE_SHA?:string;PLATFORM_RELEASE_STAGE?:string;CF_ACCESS_ISSUER?:string;CF_ACCESS_AUDIENCE?:string;CF_ACCESS_DIAGNOSTICS?:string};
  // A visitor cannot opt a request into diagnostics or carry a forged scope marker.
  headers.delete(ACCESS_DIAGNOSTIC_SCOPE_HEADER);
  if(accessDiagnosticsEnabled(config)&&accessDiagnosticPath(new URL(request.url).pathname)){
   headers.set(ACCESS_DIAGNOSTIC_SCOPE_HEADER,'1');
   reportAccessHeaderPresence('worker',headers.has('cf-access-jwt-assertion'));
  }
  // Construct once: Request(input) transfers a POST stream, even when the asset
  // classifier returns null without reading it. A second copy from input throws.
  let sanitizedRequest=new Request(strippedRequest,{headers});
  let authCookies:string[]=[];
  let authResponse:Response|undefined;
  if(__PLATFORM_AUTH_PROVIDER__==='supabase'){
   const authenticated=await platformAuthBoundary(sanitizedRequest,(input)=>readPlatformAuthIdentity(input,{requireAal2:__PLATFORM_AUTH_REQUIRE_MFA__}),{requireMfa:__PLATFORM_AUTH_REQUIRE_MFA__});
   sanitizedRequest=authenticated.request;authCookies=authenticated.cookiesToSet;authResponse=authenticated.response;
  }
  const response=config.PLATFORM_RELEASE_STAGE!=='review'||!config.CF_ACCESS_ISSUER||!config.CF_ACCESS_AUDIENCE
   ?new Response('Review identity configuration unavailable',{status:503})
   :authResponse??await serveCloudflareBuildAsset(sanitizedRequest,env as Cloudflare.Env & {ASSETS?:{fetch:(request:Request)=>Promise<Response>}})??await handler.fetch(sanitizedRequest,env,ctx);
  const result=authCookies.length?appendPlatformAuthCookies(response,authCookies):new Response(response.body,response);result.headers.set('x-robots-tag','noindex, nofollow');
  if(/^[a-f0-9]{40}$/.test(config.PLATFORM_RELEASE_SHA??''))result.headers.set('x-derech-release',config.PLATFORM_RELEASE_SHA!);
  return result;
 }
};
