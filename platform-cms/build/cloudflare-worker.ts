import handler from 'vinext/server/fetch-handler';
import {accessDiagnosticsEnabled,accessDiagnosticPath,ACCESS_DIAGNOSTIC_SCOPE_HEADER,reportAccessHeaderPresence} from '../lib/cloudflare-access';
export default {
 async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  // Caller-controlled Sites identity headers never cross the standalone boundary.
  const headers=new Headers(request.headers);for(const key of [...headers.keys()])if(key.startsWith('oai-authenticated-user-'))headers.delete(key);
  const config=env as unknown as {PLATFORM_RELEASE_SHA?:string;PLATFORM_RELEASE_STAGE?:string;CF_ACCESS_ISSUER?:string;CF_ACCESS_AUDIENCE?:string;CF_ACCESS_DIAGNOSTICS?:string};
  // A visitor cannot opt a request into diagnostics or carry a forged scope marker.
  headers.delete(ACCESS_DIAGNOSTIC_SCOPE_HEADER);
  if(accessDiagnosticsEnabled(config)&&accessDiagnosticPath(new URL(request.url).pathname)){
   headers.set(ACCESS_DIAGNOSTIC_SCOPE_HEADER,'1');
   reportAccessHeaderPresence('worker',headers.has('cf-access-jwt-assertion'));
  }
  const response=config.PLATFORM_RELEASE_STAGE!=='review'||!config.CF_ACCESS_ISSUER||!config.CF_ACCESS_AUDIENCE
   ?new Response('Review identity configuration unavailable',{status:503})
   :await handler.fetch(new Request(request,{headers}),env,ctx);
  const result=new Response(response.body,response);result.headers.set('x-robots-tag','noindex, nofollow');
  if(/^[a-f0-9]{40}$/.test(config.PLATFORM_RELEASE_SHA??''))result.headers.set('x-derech-release',config.PLATFORM_RELEASE_SHA!);
  return result;
 }
};
