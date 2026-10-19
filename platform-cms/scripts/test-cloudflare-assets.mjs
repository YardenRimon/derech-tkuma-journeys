import assert from'node:assert/strict';
import{build}from'esbuild';
import{mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';
import{collectCloudflareClientAssets}from'./cloudflare-client-assets.mjs';
import{verifyCloudflareLive,LiveVerificationError,publicAssetPaths}from'./verify-cloudflare-live.mjs';
import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
// Bundle the actual wrapper; only Vinext and diagnostic collaborators are stubbed.
// The stub reproduces the publicFiles-only behavior: a build chunk would be 404.
const bundled=await build({entryPoints:[path.join(root,'build/cloudflare-worker.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent',plugins:[{name:'offline-collaborators',setup(b){
 b.onResolve({filter:/^vinext\/server\/fetch-handler$/},()=>({path:'handler',namespace:'fixture'}));
 b.onResolve({filter:/lib\/cloudflare-access$/},()=>({path:'diagnostics',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({contents:name==='handler'?`export default{fetch(request){globalThis.__derechAssetFixture.handler.push(request);return new Response('vinext route',{status:new URL(request.url).pathname.startsWith('/_next/')?404:200});}}`:`export const accessDiagnosticsEnabled=()=>false,accessDiagnosticPath=()=>false,ACCESS_DIAGNOSTIC_SCOPE_HEADER='x-fixture-diagnostic',reportAccessHeaderPresence=()=>{};`,loader:'js'}));
}}]});
const{default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const sha='d'.repeat(40),origin='https://fixture.workers.dev';
let assets=[],handler=[];globalThis.__derechAssetFixture={handler};
const env={PLATFORM_RELEASE_STAGE:'review',CF_ACCESS_ISSUER:'https://fixture.cloudflareaccess.com',CF_ACCESS_AUDIENCE:'synthetic',PLATFORM_RELEASE_SHA:sha,ASSETS:{async fetch(request){assets.push(request);if(request.headers.has('if-none-match'))return new Response(null,{status:304});return new Response(request.method==='HEAD'?null:'exact emitted chunk',{headers:{'content-type':'text/javascript','etag':'fixture'}});}}};
try{
 for(const name of['rolldown-runtime-abc.js','framework-def.js','index-ghi.js','lazy-module-jkl.js']){
  const response=await worker.fetch(new Request(origin+'/_next/static/chunks/'+name+'?v=1',{headers:{'oai-authenticated-user-email':'forged','range':'bytes=0-3'}}),env,{});
  assert.equal(response.status,200);assert.equal(await response.text(),'exact emitted chunk');assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(response.headers.get('x-derech-release'),sha);
  assert.equal(assets.at(-1).headers.get('range'),'bytes=0-3');assert(!assets.at(-1).headers.has('oai-authenticated-user-email'));assert.equal(new URL(assets.at(-1).url).search,'?v=1');
 }
 assert.equal(handler.length,0,'generated chunks must bypass Vinext publicFiles lookup');
 let response=await worker.fetch(new Request(origin+'/_next/static/chunks/index-ghi.js',{method:'HEAD'}),env,{});assert.equal(response.status,200);assert.equal(await response.text(),'');
 response=await worker.fetch(new Request(origin+'/_next/static/chunks/index-ghi.js',{headers:{'if-none-match':'fixture'}}),env,{});assert.equal(response.status,304);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
 const count=assets.length;
 for(const [pathname,method,status]of[['/_next/static/chunks/index.js','POST',405],['/_next/static/chunks/%2fadmin.js','GET',404]]){response=await worker.fetch(new Request(origin+pathname,{method}),env,{});assert.equal(response.status,status);}
 assert.equal(assets.length,count);
 response=await worker.fetch(new Request(origin+'/_next/static/chunks/index.js'),{...env,ASSETS:undefined},{});assert.equal(response.status,503);
 response=await worker.fetch(new Request(origin+'/_next/static/chunks/index.js'),{...env,CF_ACCESS_AUDIENCE:undefined},{});assert.equal(response.status,503);assert.equal(assets.length,count,'identity configuration still fails closed before binding access');
 for(const pathname of['/admin/','/admin.css','/api/users/','/.vite/manifest.json','/editor.js']){await worker.fetch(new Request(origin+pathname),env,{});assert.equal(new URL(handler.at(-1).url).pathname,pathname);}
 assert.equal(assets.length,count,'no admin/API/public route was diverted to build assets');
}finally{delete globalThis.__derechAssetFixture;}

const directory=mkdtempSync(path.join(tmpdir(),'derech-client-graph-'));
try{
 mkdirSync(path.join(directory,'.vite'));mkdirSync(path.join(directory,'_next/static/chunks'),{recursive:true});
 const entries={entry:{file:'_next/static/chunks/index-a.js',isEntry:true,imports:['framework'],dynamicImports:['lazy'],css:['_next/static/chunks/main-a.css']},framework:{file:'_next/static/chunks/framework-b.js'},lazy:{file:'_next/static/chunks/lazy-c.js'}};
 const save=()=>writeFileSync(path.join(directory,'.vite/manifest.json'),JSON.stringify(entries));save();
 writeFileSync(path.join(directory,'vinext-client-entry-manifest.json'),JSON.stringify({appBrowserEntry:entries.entry.file}));
 for(const file of[...Object.values(entries).map(item=>item.file),...entries.entry.css])writeFileSync(path.join(directory,file),'emitted '+file);
 const graph=collectCloudflareClientAssets(directory);assert.equal(graph.length,4);assert(graph.some(file=>file.path===entries.lazy.file));assert(graph.every(file=>file.bytes>0&&file.sha256.length===64));
 entries.entry.imports.push('missing');save();assert.throws(()=>collectCloudflareClientAssets(directory),/dependency/);entries.entry.imports.pop();
 entries.lazy.file='../escape.js';save();assert.throws(()=>collectCloudflareClientAssets(directory),/Unsafe/);entries.lazy.file='_next/static/chunks/missing.js';save();assert.throws(()=>collectCloudflareClientAssets(directory),/ENOENT/);
 // The deploy live gate must fail when the source graph exists but its JS is 404,
 // wrong bytes or HTML, even when all older public checks and APIs pass.
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),clientBytes=Buffer.from('emitted client'),client={path:'_next/static/chunks/index-a.js',bytes:clientBytes.length,sha256:hash(clientBytes)},manifest={files:publicAssetPaths.map((name,index)=>({path:name.slice(1),bytes:1,sha256:hash(Buffer.from(String(index)))}))},release={contentRelease:'fixture',pages:37};
 for(const failure of['404','hash','html','missing-reference','external-reference']){
  await assert.rejects(verifyCloudflareLive({origin,sha,ownerEmail:'fixture@example.invalid',accessIssuer:'https://fixture.cloudflareaccess.com',manifest,release,clientAssets:[client],maxAttempts:1,fetcher:async url=>{
   const name=decodeURI(new URL(url).pathname),headers={'x-derech-release':sha,'x-robots-tag':'noindex, nofollow'};
   if(name.startsWith('/_next/static/')&&failure.endsWith('reference'))return new Response(clientBytes,{headers:{...headers,'content-type':'text/javascript'}});
   if(name.startsWith('/_next/static/'))return new Response(failure==='hash'?'wrong client bytes':'<html>login</html>',{status:failure==='404'?404:200,headers:{...headers,'content-type':failure==='html'?'text/html':'text/javascript'}});
   if(name==='/')return new Response('<meta name="robots" content="noindex"><script src="/__pilot__/guard.js"></script>'+ (failure==='missing-reference'?'<link rel="modulepreload" href="/_next/static/chunks/missing.js">':failure==='external-reference'?'<script src="https://forbidden.invalid/_next/static/chunks/index-a.js"></script>':'<script type="module" src="/_next/static/chunks/index-a.js"></script>'),{headers:{...headers,'content-type':'text/html'}});
   if(name==='/robots.txt')return new Response('User-agent: *\nAllow: /',{headers:{...headers,'content-type':'text/plain'}});
   if(name==='/api/health')return Response.json({status:'ready',mode:'review',...release,database:true,mediaBinding:true},{headers});
   const index=publicAssetPaths.indexOf(name);if(index>=0)return new Response(String(index),{headers:{...headers,'content-type':index?'text/javascript':'image/webp'}});
   return new Response(null,{status:403});
  }}),error=>error instanceof LiveVerificationError&&error.checks.some(check=>(check.path==='/'+client.path||failure.endsWith('reference')&&check.path==='/')&&!check.passed));
 }
}finally{rmSync(directory,{recursive:true,force:true});}
console.log('Cloudflare browser assets: actual wrapper bypasses Vinext 404 for generated graph; GET/HEAD/conditional headers, noindex/release, restricted namespace, complete lazy/CSS graph and live chunk-denial gates passed.');
