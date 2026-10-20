import assert from 'node:assert/strict';
import {verifyPlatformAuthLive} from './verify-platform-auth-live.mjs';
const origin='https://fixture.workers.dev',sha='f'.repeat(40);
const base={'x-derech-release':sha,'x-robots-tag':'noindex, nofollow','cache-control':'private, no-store'};
for(const requireMfa of [true,false])for(const failure of [null,'access-login','api-forgery','unconfigured','unsafe-cookie','cached-login','stale-release','mfa-policy']){
 const result=await verifyPlatformAuthLive(origin,sha,async(url,init)=>{
  assert.equal(init.redirect,'manual');assert.equal(init.headers['x-platform-authenticated-aal'],'aal2');
  const path=new URL(url).pathname,headers={...base,...(failure==='stale-release'?{'x-derech-release':'a'.repeat(40)}:{})};
  if(path==='/login/')return new Response('<button id="google-login"></button><input id="email-code"><input id="mfa-code">',{status:200,headers:{...headers,...(failure==='cached-login'?{'cache-control':'public,max-age=600'}:{}),'content-security-policy':"script-src 'nonce-abc123'; frame-ancestors 'none'"}});
  if(path==='/api/auth/session')return Response.json({configured:failure!=='unconfigured',authenticated:false,policy:{requireMfa:failure==='mfa-policy'?!requireMfa:requireMfa},csrfToken:'a'.repeat(64)},{headers:{...headers,'set-cookie':'__Host-platform-csrf=fixture; Path=/; HttpOnly; '+(failure==='unsafe-cookie'?'Domain=fixture.workers.dev':'Secure')}});
  if(path==='/admin/')return new Response(null,{status:302,headers:{...headers,location:failure==='access-login'?'https://old.cloudflareaccess.com/cdn-cgi/access/login/app':'/login/?next=%2Fadmin%2F'}});
  return Response.json({},{status:failure==='api-forgery'?200:401,headers});
 },{requireMfa});
 assert.equal(result.passed,failure===null,failure??'secure-shared-auth');
 assert.equal(result.realUserLoginVerified,false);assert(!JSON.stringify(result).includes('csrfToken'));assert(!JSON.stringify(result).includes('set-cookie'));
}
console.log('Shared auth live gate rejects old Access redirects, forged API acceptance, missing provider config, unsafe cookies, caching and stale release; no session/CSRF values reported.');
