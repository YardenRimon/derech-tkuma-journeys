/** Offline-only provider fixtures; no credentials, sessions or real outage. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const compiled=await build({stdin:{contents:"export * from './lib/identity-health';export {PLATFORM_AUTH_PROJECT_URL} from './lib/platform-auth-core';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent'});
const url='data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64');
const originalFetch=Object.getOwnPropertyDescriptor(globalThis,'fetch');let ambientReads=0;
Object.defineProperty(globalThis,'fetch',{configurable:true,get(){ambientReads++;throw Error('ambient fetch forbidden');}});
let module;
try{
 module=await import(url);
 for(const config of [{},{PLATFORM_AUTH_MODE:'mock'},{PLATFORM_AUTH_MODE:'cloudflare-access'}])assert.deepEqual(await module.identityHealth(config),{identityReady:true,identityState:'not_required'});
 assert.equal(ambientReads,0,'import/legacy/mock never access global fetch');
}finally{Object.defineProperty(globalThis,'fetch',originalFetch);}
const {createIdentityHealthProbe,PLATFORM_AUTH_PROJECT_URL}=module;
const address=PLATFORM_AUTH_PROJECT_URL+'/auth/v1/health',keyA='sb_publishable_synthetic_fixture_A',keyB='sb_publishable_synthetic_fixture_B',privateCanary='PRIVATE_PROVIDER_BODY_TOKEN_OR_ERROR';
const config=(key=keyA)=>({PLATFORM_AUTH_MODE:'supabase',PLATFORM_AUTH_SUPABASE_URL:PLATFORM_AUTH_PROJECT_URL,PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY:key});
const healthy={version:'v2.186.0',name:'GoTrue',description:'GoTrue is a user registration and authentication API'};
const response=(value=healthy,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const safe=result=>{assert.deepEqual(Object.keys(result).sort(),['identityReady','identityState']);const text=JSON.stringify(result);for(const forbidden of [privateCanary,keyA,keyB,PLATFORM_AUTH_PROJECT_URL,'GoTrue'])assert.ok(!text.includes(forbidden));return result;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let time=0,handler=()=>response();const requests=[],timers=[];
 const probe=createIdentityHealthProbe({clock:()=>time,fetchImpl:async(input,init)=>{requests.push({input,init});return handler(input,init);},setTimer(callback,milliseconds){const timer={callback,milliseconds,cleared:false};timers.push(timer);return timer;},clearTimer(timer){timer.cleared=true;}});
 return {probe,requests,timers,set time(value){time=value;},set handler(value){handler=value;}};
}
const logs=[],originalWarn=console.warn,originalError=console.error;
console.warn=(...values)=>logs.push(values);console.error=(...values)=>logs.push(values);
try{
 const f=fixture();safe(await f.probe(config()));assert.equal(f.requests.length,1);
 const request=f.requests[0];assert.equal(request.input,address);assert.equal(request.init.method,'GET');assert.equal(request.init.redirect,'manual');assert.equal(request.init.credentials,'omit');assert.equal(request.init.cache,'no-store');assert.equal(request.init.referrerPolicy,'no-referrer');assert.deepEqual(request.init.headers,{accept:'application/json',apikey:keyA});assert.equal(request.init.body,undefined);assert.equal(f.timers[0].milliseconds,2500);assert.equal(f.timers[0].cleared,true);
 const first=await f.probe(config());first.identityReady=false;f.time=59999;assert.equal((await f.probe(config())).identityReady,true);assert.equal(f.requests.length,1,'healthy cache has bounded60s lifetime and cannot be mutated by caller');
 f.time=60000;f.handler=()=>{throw new TypeError(privateCanary+' DNS '+address+' '+keyA);};assert.equal(safe(await f.probe(config())).identityReady,false);assert.equal(f.requests.length,2,'expired healthy result is not served during failed refresh');
 f.time=64999;assert.equal((await f.probe(config())).identityReady,false);assert.equal(f.requests.length,2,'failed cache is only5s');f.time=65000;f.handler=()=>response();assert.equal((await f.probe(config())).identityReady,true);assert.equal(f.requests.length,3);
 // Fixed config: no unapproved host, JWT, service role or header injection request.
 const bad=fixture();for(const value of [{...config(),PLATFORM_AUTH_SUPABASE_URL:PLATFORM_AUTH_PROJECT_URL+'/'},{...config(),PLATFORM_AUTH_SUPABASE_URL:PLATFORM_AUTH_PROJECT_URL+'.evil.invalid'},{...config(),PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY:'eyJ_admin_or_user_jwt'},{...config(),PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic_fixture'},{...config(),PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY:keyA+'\nheader'}])assert.equal(safe(await bad.probe(value)).identityReady,false);assert.equal(bad.requests.length,0);
 // Response cases model gateway, DNS/transport, redirects and malformed bodies.
 const cases=[()=>{throw Error(privateCanary);},()=>response({message:privateCanary},401),()=>response({message:privateCanary},503),()=>new Response('',{status:302,headers:{location:'https://outside.invalid/'+privateCanary}}),()=>new Response(JSON.stringify(healthy),{headers:{'content-type':'text/html'}}),()=>new Response('{'+privateCanary,{headers:{'content-type':'application/json'}}),()=>response(null),()=>response([]),()=>response({name:'GoTrue'}),()=>response({...healthy,name:'unexpected'}),()=>response({...healthy,description:privateCanary}),()=>response({...healthy,version:'x'.repeat(81)}),()=>response({...healthy,version:'v2\nprivate'}),()=>response({...healthy,extra:privateCanary}),()=>new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),()=>{const result=response();Object.defineProperty(result,'redirected',{value:true});return result;},()=>{const result=response();Object.defineProperty(result,'url',{value:'https://outside.invalid/'+privateCanary});return result;}];
 for(const make of cases){const c=fixture();c.handler=make;assert.equal(safe(await c.probe(config())).identityReady,false);assert.equal(c.requests.length,1);}
 for(const header of [null,'2049']){
  let cancelled=false;const c=fixture();c.handler=()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2049));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json',...(header?{'content-length':header}:{})}});
  assert.equal((await c.probe(config())).identityReady,false);await tick();assert.equal(cancelled,true,'oversize header/body is cancelled without raw output');
 }
 // Hard deadline covers both a fetch that ignores abort and a hanging body.
 for(const stage of ['headers','body']){
  const c=fixture();let cancelled=false;
  c.handler=stage==='headers'?()=>new Promise(()=>{}):()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
  const pending=c.probe(config());await tick();c.timers[0].callback();assert.equal((await pending).identityReady,false);assert.equal(c.requests[0].init.signal.aborted,true);assert.equal(c.timers[0].cleared,true);await tick();if(stage==='body')assert.equal(cancelled,true);
 }
 const same=fixture();let release;
 same.handler=()=>new Promise(resolve=>{release=resolve;});const a=same.probe(config()),b=same.probe(config());assert.equal(same.requests.length,1,'concurrent readers share one current provider attempt');release(response());assert.deepEqual(await a,await b);
 const rotation=fixture();let finishOld;
 rotation.handler=(_input,init)=>init.headers.apikey===keyA?new Promise(resolve=>{finishOld=resolve;}):response({message:privateCanary},503);
 const old=rotation.probe(config(keyA));assert.equal((await rotation.probe(config(keyB))).identityReady,false);finishOld(response());assert.equal((await old).identityReady,false,'old-key completion cannot restore healthy');assert.equal((await rotation.probe(config(keyB))).identityReady,false);assert.equal(rotation.requests.length,2);
 const mode=fixture();await mode.probe(config());assert.equal((await mode.probe({})).identityState,'not_required');await mode.probe(config());assert.equal(mode.requests.length,2,'mode change clears previous healthy ownership');
 assert.equal(logs.length,0,'provider/config/response details are never logged');
}finally{console.warn=originalWarn;console.error=originalError;}
// Exercise the actual existing health route with only the env/provider replaced.
const env={CMS_ADAPTER_MODE:'isolated-d1',CMS_TENANT_ID:'derech',CMS_SITE_ID:'derech-main',BUCKET:{},DB:{prepare(sql){return{async first(){return sql.includes('cms_deployment_scope')?{tenant_id:'derech',site_id:'derech-main'}:{n:8};}};}}};
globalThis.__identityHealthRoute={env};
const routeCompiled=await build({stdin:{contents:"export * from './app/api/health/route';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent',plugins:[{name:'offline-health-env',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'health-env',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__identityHealthRoute.env;',loader:'js'}));}}]});
const savedFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async()=>{calls++;throw Error('unconfigured mode must not call provider');};
try{
 const {GET}=await import('data:text/javascript;base64,'+Buffer.from(routeCompiled.outputFiles[0].text).toString('base64'));
 let http=await GET(),body=await http.json();assert.equal(http.status,200);assert.equal(body.mode,'review');assert.equal((await(await GET(new Request('https://derech-tkuma.com/api/health/'))).json()).mode,'review','request host cannot enable production health in a review build');assert.equal(body.status,'ready');assert.equal(body.identityReady,true);assert.equal(body.identityState,'not_required');assert.equal(calls,0);
 const {fixtureProfile}=await import('./production-profile-fixture.mjs');const productionRoute=await build({stdin:{contents:"export * from './app/api/health/route';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',logLevel:'silent',define:{__DERECH_PRODUCTION_BUILD__:'true',__DERECH_PRODUCTION_PROFILE__:JSON.stringify(fixtureProfile)},plugins:[{name:'isolated-production-health-env',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'health-env',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__identityHealthRoute.env;',loader:'js'}));}}]});const productionHealth=await import('data:text/javascript;base64,'+Buffer.from(productionRoute.outputFiles[0].text).toString('base64'));assert.equal((await(await productionHealth.GET(new Request('https://derech-tkuma.com/api/health/'))).json()).mode,'production');assert.equal((await(await productionHealth.GET(new Request('https://derech-tkuma-review.22yarden22.workers.dev/api/health/'))).json()).mode,'review');assert.equal(calls,0);
 for(const name of ['mode','pages','contentRelease','database','mediaBinding','mediaReadWriteTested'])assert.ok(Object.hasOwn(body,name));assert.equal(body.database,true);assert.equal(body.mediaBinding,true);
 Object.assign(env,config(keyA));globalThis.fetch=async(input,init)=>{calls++;assert.equal(input,address);assert.equal(init.headers.apikey,keyA);return response();};http=await GET();body=await http.json();assert.equal(http.status,200);assert.equal(body.status,'ready');assert.equal(body.identityState,'ready');
 Object.assign(env,config(keyB));globalThis.fetch=async()=>{calls++;throw Error(privateCanary);};http=await GET();body=await http.json();assert.equal(http.status,503);assert.equal(body.status,'starting');assert.equal(body.identityReady,false);assert.equal(body.identityState,'unavailable');assert.equal(body.database,true);assert.equal(body.mediaBinding,true);assert.match(http.headers.get('cache-control'),/no-store/);assert.match(http.headers.get('x-robots-tag'),/noindex/);for(const value of [privateCanary,address,keyA,keyB])assert.ok(!JSON.stringify(body).includes(value));
}finally{globalThis.fetch=savedFetch;delete globalThis.__identityHealthRoute;}
console.log('PASS identity health: lazy/nonSupabase zero-I/O, exact approved GET/apikey/no JWT, healthy JSON validation/body cap/hard deadline, DNS/status/redirect/body failures,60s/5s cache/coalescing/expiry/keyrotation, no secret logs/output, actual health route503 while existing DB/media/body contract remains intact. Provider fixtures only; no network.');

// Exercise actual edge fetch semantics, not just injected Node transports.
{
 const {Miniflare,Log,LogLevel}=await import('miniflare');
 const edge=await build({stdin:{contents:`import {createIdentityHealthProbe} from './lib/identity-health';export default {async fetch(){return Response.json(await createIdentityHealthProbe()({PLATFORM_AUTH_MODE:'supabase',PLATFORM_AUTH_SUPABASE_URL:'https://uawcxvkekfqxosfblpxr.supabase.co',PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_fixture_only_1234'}))}}`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
 let count=0,mode='ready';
 const runtime=new Miniflare({modules:true,script:edge.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),outboundService:async request=>{
  count++;assert.equal(request.url,'https://uawcxvkekfqxosfblpxr.supabase.co/auth/v1/health');assert.equal(request.method,'GET');assert.equal(request.headers.get('apikey'),'sb_publishable_synthetic_fixture_only_1234');assert.equal(request.headers.get('authorization'),null);
  return mode==='ready'?Response.json({version:'v2.197.0',name:'GoTrue',description:'GoTrue is a user registration and authentication API'}):mode==='redirect'?new Response(null,{status:302,headers:{location:'https://outside.invalid/never-follow'}}):Response.json({message:'fixture unavailable'},{status:503});
 }});
 try{for(const [index,state]of ['ready','redirect','unavailable'].entries()){mode=state;const result=await(await runtime.dispatchFetch('https://local-fixture.invalid/')).json();assert.equal(result.identityReady,state==='ready');assert.equal(count,index+1,'redirect must not trigger a second provider request');}}finally{await runtime.dispose();}
 console.log('PASS actual Workerd default fetch, manual redirects rejected without following, healthy and503 dependency states; synthetic outbound only');
}
