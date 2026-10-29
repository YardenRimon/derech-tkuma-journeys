import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture={identity:null,error:null,headers:new Headers(),calls:[],handlerCalls:0};
globalThis.__derechPolicyFixture=fixture;
try {
 for(const required of [true,false]) {
  const compiled=await build({entryPoints:[root+'build/cloudflare-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent',define:{__PLATFORM_AUTH_PROVIDER__:'"supabase"',__PLATFORM_AUTH_REQUIRE_MFA__:String(required)},plugins:[{name:'offline-transport',setup(b){
   for(const [filter,name]of [[/^vinext\/server\/fetch-handler$/,'handler'],[/lib\/platform-auth$/,'provider'],[/^next\/headers$/,'headers'],[/^next\/navigation$/,'navigation'],[/^cloudflare:workers$/,'env']])b.onResolve({filter},()=>({path:name,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',resolveDir:root,contents:path==='handler'?`import {getChatGPTUser} from ${JSON.stringify(root+'app/chatgpt-auth.ts')};export default{async fetch(request){const f=globalThis.__derechPolicyFixture;f.handlerCalls++;f.headers=request.headers;return Response.json({user:await getChatGPTUser()});}};`:path==='provider'?`export {appendPlatformAuthCookies} from ${JSON.stringify(root+'lib/platform-auth-core.ts')};export async function readPlatformAuthIdentity(request,options){const f=globalThis.__derechPolicyFixture;f.calls.push({options,forged:request.headers.has('x-platform-authenticated-id')||request.headers.has('oai-authenticated-user-id')});if(f.error)throw f.error;return{identity:f.identity,cookiesToSet:['__Host-platform-auth=fixture; Path=/; HttpOnly; Secure']};}`:path==='headers'?'export const headers=async()=>globalThis.__derechPolicyFixture.headers;':path==='navigation'?'export function redirect(path){throw new Error("redirect:"+path)}':'export const env={};'}));
  }}]});
  const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const env={PLATFORM_RELEASE_STAGE:'review',CF_ACCESS_ISSUER:'https://fixture.cloudflareaccess.com',CF_ACCESS_AUDIENCE:'synthetic',PLATFORM_RELEASE_SHA:'f'.repeat(40)};
  const identity={userId:'verified-owner',email:'owner@example.invalid',displayName:'Owner',fullName:'Owner'};
  for(const aal of ['aal1','aal2']){
   fixture.identity={...identity,aal};fixture.error=null;fixture.calls=[];fixture.handlerCalls=0;
   const response=await worker.fetch(new Request('https://fixture.workers.dev/api/users/?requireMfa=false',{headers:{'x-platform-authenticated-id':'forged','x-platform-authenticated-aal':'aal2','oai-authenticated-user-id':'forged'}}),env,{});
   assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].forged,false);assert.equal(fixture.calls[0].options.requireAal2,required);
   const permitted=!required||aal==='aal2';assert.equal(response.status,permitted?200:403);assert.equal(fixture.handlerCalls,permitted?1:0);
   if(permitted){const data=await response.json();assert.equal(data.user.userId,'verified-owner');assert.equal(data.user.email,'owner@example.invalid');assert.equal(fixture.headers.get('x-platform-authenticated-aal'),aal);assert.match(response.headers.get('set-cookie'),/HttpOnly/);}
  }
  fixture.error={status:401,code:'unauthenticated'};fixture.handlerCalls=0;
  const denied=await worker.fetch(new Request('https://fixture.workers.dev/api/users/',{headers:{'x-platform-authenticated-id':'forged','x-platform-authenticated-aal':'aal2'}}),env,{});
  assert.equal(denied.status,401);assert.equal(fixture.handlerCalls,0);assert.match(denied.headers.get('x-robots-tag'),/noindex/);
 }
 console.log('Fixed MFA policy: actual Worker and app adapter agree; optional verified AAL1 works, default requires AAL2, forged headers/queries cannot change policy, anonymous denied, refreshed cookies retained. Offline provider.');
} finally {delete globalThis.__derechPolicyFixture;}
