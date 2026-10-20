/** Offline actual workerd: the deployed wrapper + installed Vinext header clones
 * and force-dynamic fetch patch must preserve binary/JSON mutation streams. */
import assert from'node:assert/strict';import{build}from'esbuild';import{Miniflare}from'miniflare';
import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=mkdtempSync(path.join(tmpdir(),'derech-request-workerd-'));
const handler=`
import {cloneRequestWithHeaders} from ${JSON.stringify(path.join(root,'node_modules/vinext/dist/server/request-pipeline.js'))};
import {ensureFetchPatch,runWithFetchCache,setCurrentForceDynamicFetchDefault} from ${JSON.stringify(path.join(root,'node_modules/vinext/dist/shims/fetch-cache.js'))};
export default{async fetch(request,env){
 ensureFetchPatch();
 return runWithFetchCache(async()=>{
  setCurrentForceDynamicFetchDefault(true);
  const clone=cloneRequestWithHeaders(request,new Headers(request.headers));
  const bytes=new Uint8Array(await clone.arrayBuffer());
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  // Only the isolated local test bucket is used; no provider network is available.
  await env.BUCKET.put('synthetic-transport-fixture',bytes,{httpMetadata:{contentType:clone.headers.get('content-type')}});
  const stored=await env.BUCKET.get('synthetic-transport-fixture');
  return Response.json({method:clone.method,path:new URL(clone.url).pathname,contentType:clone.headers.get('content-type'),bytes:bytes.length,sha,storedBytes:stored.size,storedContentType:stored.httpMetadata.contentType,spoofedSitesIdentity:clone.headers.has('oai-authenticated-user-email')});
 });
}};`;
let runtime;
try{
 const compiled=await build({entryPoints:[path.join(root,'build/cloudflare-worker.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',define:{__PLATFORM_AUTH_PROVIDER__:JSON.stringify('cloudflare-access')},external:['node:*','cloudflare:workers'],logLevel:'silent',plugins:[{name:'local-handler',setup(b){
  b.onResolve({filter:/^vinext\/server\/fetch-handler$/},()=>({path:'handler',namespace:'fixture'}));
  b.onResolve({filter:/lib\/cloudflare-access$/},()=>({path:'diagnostics',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({contents:name==='handler'?handler:`export const accessDiagnosticsEnabled=()=>false,accessDiagnosticPath=()=>false,ACCESS_DIAGNOSTIC_SCOPE_HEADER='x-local-diagnostics',reportAccessHeaderPresence=()=>{};`,loader:'js',resolveDir:root}));
 }}]});
 const sha='e'.repeat(40);
 runtime=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],r2Buckets:['BUCKET'],r2Persist:path.join(directory,'r2'),bindings:{PLATFORM_RELEASE_STAGE:'review',CF_ACCESS_ISSUER:'https://fixture.cloudflareaccess.com',CF_ACCESS_AUDIENCE:'synthetic-only',PLATFORM_RELEASE_SHA:sha},outboundService:()=>new Response('No outbound network in this fixture',{status:502})});
 const binary=Buffer.from(Array.from({length:16384},(_,index)=>index%256));
 for(const fixture of[{path:'/api/cms/upload/',method:'POST',mime:'image/webp',body:binary},{path:'/api/cms/save/',method:'POST',mime:'application/json',body:Buffer.from(JSON.stringify({text:'תוכן בדיקה',unicode:'✓',draft:true}))},{path:'/api/tasks/',method:'PATCH',mime:'application/json',body:Buffer.from('{"synthetic":"fixture"}')}]){
  const response=await runtime.dispatchFetch('https://local-fixture.invalid'+fixture.path,{method:fixture.method,headers:{'content-type':fixture.mime,'oai-authenticated-user-email':'untrusted@fixture.invalid'},body:fixture.body});
  assert.equal(response.status,200,fixture.path);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(response.headers.get('x-derech-release'),sha);
  assert.deepEqual(await response.json(),{method:fixture.method,path:fixture.path,contentType:fixture.mime,bytes:fixture.body.length,sha:createHash('sha256').update(fixture.body).digest('hex'),storedBytes:fixture.body.length,storedContentType:fixture.mime,spoofedSitesIdentity:false});
 }
 console.log('Cloudflare actual workerd mutation transport: wrapper constructs once, binary WebP/UTF8 JSON POST/PATCH survive real Vinext clones + fetch patch, local R2 bytes/MIME/hash and review/spoof protections passed; no provider network.');
}finally{if(runtime)await runtime.dispose();rmSync(directory,{recursive:true,force:true});}
