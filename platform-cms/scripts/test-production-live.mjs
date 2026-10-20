import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {verifyProductionLive,ProductionLiveError,productionSourceManifest,protectedProductionPaths,productionNoindexPaths,expectedProductionSitemap,expectedProductionRobots} from './verify-production-live.mjs';
import {fixtureProfile,fixturePortable,fixtureSource} from './production-profile-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),privateCanary='PRIVATE-PROVIDER-TOKEN-OR-PAYLOAD';
const built=await build({stdin:{contents:`export * from './lib/visitor-release';export * from './lib/review-runtime';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',define:{__DERECH_PRODUCTION_BUILD__:'true',__DERECH_PRODUCTION_PROFILE__:JSON.stringify(fixtureProfile)},logLevel:'silent'});
const production=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sourcePages=JSON.parse(gunzipSync(readFileSync(new URL('../source-pages/generated-review-pages.json.gz',import.meta.url)))),htmlPages=new Map();
for(const [path,page]of Object.entries(sourcePages)){const html=production.prepareReviewRuntime(page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix);htmlPages.set(path,production.prepareProductionPage(html,new URL(path,fixtureProfile.origin),fixtureProfile));}
const assets=new Map(['production-guard.js','production-visitor.js'].map(name=>['/'+name,readFileSync(new URL('../public/'+name,import.meta.url))]));
const firstPath=Object.keys(productionSourceManifest)[0],fallbackPath=Object.keys(productionSourceManifest).find(path=>path!=='/thanks/'&&!productionSourceManifest[path].canonical),canonicalPath=Object.keys(productionSourceManifest).find(path=>productionSourceManifest[path].canonical);
function fixtureResponse(path,forged){
 const headers={'x-derech-release':fixtureProfile.sourceCommit},spec={status:200,headers,body:''};
 if(htmlPages.has(path)){headers['content-type']='text/html; charset=utf-8';spec.body=htmlPages.get(path);if(!production.productionIndexablePath(path))headers['x-robots-tag']='noindex, nofollow';}
 else if(assets.has(path)){headers['content-type']='application/javascript';headers['x-robots-tag']='noindex';spec.body=assets.get(path);}
 else if(path==='/robots.txt'){headers['content-type']='text/plain';spec.body=production.productionRobots(fixtureProfile);}
 else if(path==='/sitemap.xml'){headers['content-type']='application/xml';spec.body=production.productionSitemap();}
 else if(path==='/api/health'){headers['content-type']='application/json';headers['x-robots-tag']='noindex';spec.body=JSON.stringify({status:'ready',mode:'review',contentRelease:fixtureSource.contentRelease,pages:37,database:true,mediaBinding:true});}
 else if(path==='/__production-verifier-unknown__/'){spec.status=404;headers['x-robots-tag']='noindex';}
 else if(protectedProductionPaths.includes(path)){headers['x-robots-tag']='noindex, nofollow';headers['cache-control']='private, no-store';spec.status=path.startsWith('/admin')?302:401;if(spec.status===302)headers.location='/login/?next='+encodeURIComponent(path);}
 else assert.fail('unexpected read path: '+path);
 return spec;
}
function harness(mutate=()=>{}){
 const calls=[];
 const fetcher=async(url,options)=>{
  const parsed=new URL(url),path=decodeURIComponent(parsed.pathname),forged=Object.hasOwn(options.headers,'x-platform-authenticated-id'),spec=fixtureResponse(path,forged);
  calls.push({url,options,path,forged});
  const response=mutate({path,forged,spec,index:calls.length-1,url,options});
  return response instanceof Response?response:new Response(spec.body,{status:spec.status,headers:spec.headers});
 };
 return{calls,fetcher};
}
const verify=(h,patch={})=>verifyProductionLive({profile:structuredClone(fixtureProfile),config:structuredClone(fixturePortable),fetcher:h.fetcher,...patch});
async function denied(mutate,reason,path){const h=harness(mutate);await assert.rejects(verify(h),error=>{assert.ok(error instanceof ProductionLiveError);assert.equal(error.message,'Production live verification failed');assert.equal(error.checks.length,1);assert.equal(error.checks[0].reason,reason);if(path)assert.equal(error.checks[0].path,path);const text=JSON.stringify(error.checks);assert.ok(!text.includes(privateCanary));assert.ok(!text.includes(fixturePortable.vars.CMS_OWNER_EMAIL));return true;});return h;}
await test('actual production transform of all frozen 37 pages passes 55 strictly read-only canonical-origin checks',async()=>{
 const originalNoindex=Object.entries(sourcePages).filter(([,page])=>(page.shellPrefix+page.shellSuffix).match(/<meta\b[^>]*>/gi)?.filter(tag=>!tag.includes('data-pilot-policy')).some(tag=>/\bname=["']robots["']/i.test(tag)&&/\bnoindex\b/i.test(tag))).map(([path])=>path).sort();
 assert.deepEqual(originalNoindex,[...productionNoindexPaths].sort(),'exact original source noindex inventory');
 assert.equal(htmlPages.size,37);assert.equal(expectedProductionSitemap().length,32);assert.equal(production.productionRobots(fixtureProfile),expectedProductionRobots());
 const h=harness(),proof=await verify(h);
 assert.deepEqual({...proof,checks:undefined},{productionLiveVerified:true,sourceCommit:fixtureProfile.sourceCommit,publicPages:37,sitemapUrls:32,productionAssets:2,protectedChecks:12,requests:55,readOnly:true,realOwnerLoginVerified:false,formDeliveryVerified:false,paymentVerified:false,measurementDeliveryVerified:false,checks:undefined});
 assert.equal(h.calls.length,55);assert.equal(h.calls.filter(call=>htmlPages.has(call.path)).length,37);assert.equal(proof.checks.filter(check=>check.kind==='forged_denied').length,6);
 for(const {url,options,path,forged}of h.calls){assert.equal(new URL(url).origin,fixtureProfile.origin);assert.equal(new URL(url).search,'');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.cookie,undefined);if(forged){assert.ok(protectedProductionPaths.includes(path));assert.equal(options.headers['x-platform-authenticated-email'],fixturePortable.vars.CMS_OWNER_EMAIL);}else assert.equal(options.headers['x-platform-authenticated-id'],undefined);}
 assert.ok(!JSON.stringify(proof).includes(fixturePortable.vars.CMS_OWNER_EMAIL));
});
await test('validated explicit release profile/config and injected transport are mandatory before any GET',async()=>{
 for(const patch of [{profile:{...fixtureProfile,origin:'https://foreign.test'}},{profile:{...fixtureProfile,gates:{...fixtureProfile.gates,ownerCutoverApproved:false}}},{profile:{...fixtureProfile,sourceRelease:'0'.repeat(64)}},{config:{...fixturePortable,workers_dev:true}},{config:{...fixturePortable,vars:{...fixturePortable.vars,PLATFORM_PUBLIC_ORIGIN:'https://foreign.test'}}}]){const h=harness();await assert.rejects(verify(h,patch),error=>error instanceof ProductionLiveError&&error.checks[0].reason==='production_profile_not_accepted');assert.equal(h.calls.length,0);}
 const original=globalThis.fetch;let globalCalls=0;globalThis.fetch=()=>{globalCalls++;throw Error('global fetch forbidden');};try{await assert.rejects(verifyProductionLive({profile:fixtureProfile,config:fixturePortable}),error=>error.checks[0].reason==='explicit_inputs_required');assert.equal(globalCalls,0);}finally{globalThis.fetch=original;}
 for(const maxWaitMs of [0,180001,NaN,1.5]){const h=harness();await assert.rejects(verify(h,{maxWaitMs}),error=>error.checks[0].reason==='explicit_inputs_required');assert.equal(h.calls.length,0);}
});
await test('source identity and unfollowed responses are mandatory on public and protected reads',async()=>{
 for(const path of [firstPath,'/production-visitor.js','/robots.txt','/api/health','/api/tasks/'])await denied(({path:seen,spec})=>{if(seen===path)spec.headers['x-derech-release']='f'.repeat(40);},'source_header_mismatch',path);
 for(const property of ['url','redirected'])await denied(({path,spec})=>{if(path!==firstPath)return;const response=new Response(spec.body,{status:200,headers:spec.headers});Object.defineProperty(response,property,{value:property==='url'?'https://foreign.test/'+privateCanary:true});return response;},'redirect_followed',firstPath);
});
await test('only the 33 source-indexable public pages may index; four original noindex pages stay noindex',async()=>{
 for(const value of ['noindex','none','NOINDEX, NOFOLLOW'])await denied(({path,spec})=>{if(path===firstPath)spec.headers['x-robots-tag']=value;},'indexing_policy_mismatch',firstPath);
 for(const name of ['robots','googlebot','bingbot'])await denied(({path,spec})=>{if(path===firstPath)spec.body=spec.body.replace(/<head\b[^>]*>/i,match=>match+`<meta name="${name}" content="noindex">`);},'indexing_policy_mismatch',firstPath);
 for(const target of productionNoindexPaths){
  await denied(({path,spec})=>{if(path===target)delete spec.headers['x-robots-tag'];},'indexing_policy_mismatch',target);
  await denied(({path,spec})=>{if(path===target)spec.body=spec.body.replace(/<meta\b[^>]*\bname=["']robots["'][^>]*>/gi,'');},'indexing_policy_mismatch',target);
 }
});
await test('review guard and visitor policies cannot leak into production HTML',async()=>{
 for(const markup of ['<script src="/__pilot__/guard.js"></script>','<div data-pilot-policy="review"></div>','<script data-visitor-policy="review" src="/visitor-policy.js"></script>'])await denied(({path,spec})=>{if(path===firstPath)spec.body=spec.body.replace('</head>',markup+'</head>');},'review_policy_present',firstPath);
 for(const src of ['/visitor-policy.js','/__pilot__/other.js'])await denied(({path,spec})=>{if(path===firstPath)spec.body=spec.body.replace('</head>',`<script src="${src}"></script></head>`);},'review_visitor_present',firstPath);
});
await test('both exact production visitor tags must be first, same origin, unique and correctly marked',async()=>{
 const changes=[html=>html.replace('src="/production-guard.js"','src="https://foreign.test/production-guard.js"'),html=>html.replace('data-production-policy="guard-first"','data-production-policy="wrong"'),html=>html.replace('data-production-policy="consent"','data-production-policy="wrong"'),html=>html.replace('<script src="/production-guard.js"','<script type="module" src="/production-guard.js"'),html=>html.replace('type="module" src="/production-visitor.js"','src="/production-visitor.js"'),html=>html.replace('/production-guard.js"','/production-guard.js?version=wrong"'),html=>html.replace('</head>','<script src="/production-guard.js" data-production-policy="guard-first"></script></head>'),html=>html.replace(/<head\b[^>]*>/i,match=>match+'<script src="/unexpected-first.js"></script>'),html=>html.replace(/<script type="module" src="\/production-visitor\.js"[^>]*><\/script>/,'')];
 for(const change of changes)await denied(({path,spec})=>{if(path===firstPath)spec.body=change(spec.body);},'production_visitor_or_order_mismatch',firstPath);
});
await test('source canonicals are preserved and absent canonicals require the fixed marked self URL',async()=>{
 assert.ok(canonicalPath&&fallbackPath);
 await denied(({path,spec})=>{if(path===canonicalPath)spec.body=spec.body.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i,'<link rel="canonical" href="https://derech-tkuma.com/wrong/">');},'canonical_mismatch',canonicalPath);
 for(const replacement of ['<link rel="canonical" href="https://foreign.test/">','<link rel="canonical" href="'+fixtureProfile.origin+fallbackPath+'">','<link rel="canonical" data-production-policy="source-self-canonical" href="'+fixtureProfile.origin+fallbackPath+'?source=wrong">'])await denied(({path,spec})=>{if(path===fallbackPath)spec.body=spec.body.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i,replacement);},'canonical_mismatch',fallbackPath);
 await denied(({path,spec})=>{if(path===firstPath)spec.body=spec.body.replace('</head>','<link rel="canonical" href="https://derech-tkuma.com/"></head>');},'canonical_mismatch',firstPath);
 await denied(({path,spec})=>{if(path===firstPath)spec.body=spec.body.replace('src="/production-guard.js"','src="/production-guard.js" src="/'+privateCanary+'"');},'public_policy_markup_invalid',firstPath);
});
await test('unavailable, malformed and oversized public HTML fail closed',async()=>{
 for(const patch of [{status:500},{headers:{'content-type':'application/json'}}])await denied(({path,spec})=>{if(path!==firstPath)return;if(patch.status)spec.status=patch.status;else Object.assign(spec.headers,patch.headers);},'public_html_unavailable',firstPath);
 await denied(({path,spec})=>{if(path===firstPath)spec.body='<p>not a document</p>';},'public_document_invalid',firstPath);
 await denied(({path,spec})=>{if(path===firstPath)spec.body='x'.repeat(2*1024*1024+1);},'response_bound',firstPath);
});
await test('production policy assets are exact source bytes with nonpublic indexing',async()=>{
 for(const path of assets.keys()){
  await denied(({path:seen,spec})=>{if(seen===path)spec.body='changed';},'production_asset_bytes_mismatch',path);
  await denied(({path:seen,spec})=>{if(seen===path)delete spec.headers['x-robots-tag'];},'production_asset_policy_mismatch',path);
  await denied(({path:seen,spec})=>{if(seen===path)spec.headers['content-type']='text/html';},'production_asset_policy_mismatch',path);
 }
 const path='/production-guard.js';await denied(({path:seen,spec})=>{if(seen===path)spec.body=Buffer.alloc(assets.get(path).length+2);},'production_asset_bound',path);
});
await test('robots and sitemap must match the fixed 32 canonical public URLs and remain discoverable',async()=>{
 for(const path of ['/robots.txt','/sitemap.xml'])await denied(({path:seen,spec})=>{if(seen===path)spec.headers['x-robots-tag']='noindex';},'public_discovery_policy_mismatch',path);
 for(const change of [body=>body.replace('Allow: /','Disallow: /'),body=>body.replace('derech-tkuma.com/sitemap.xml','foreign.test/sitemap.xml'),body=>body.replace('Disallow: /api/\n','')])await denied(({path,spec})=>{if(path==='/robots.txt')spec.body=change(spec.body);},'robots_mismatch','/robots.txt');
 for(const change of [body=>body.replace(/<url>[\s\S]*?<\/url>/,''),body=>body.replace('</urlset>','<url><loc>https://derech-tkuma.com/thanks/</loc></url></urlset>'),body=>body.replace(/<loc>[^<]*<\/loc>/,'<loc>https://foreign.test/</loc>'),body=>body.replace('<urlset','<!DOCTYPE x [<!ENTITY leak "private">]><urlset'),body=>body.replace('http://www.sitemaps.org/schemas/sitemap/0.9','https://foreign.test/schema')])await denied(({path,spec})=>{if(path==='/sitemap.xml')spec.body=change(spec.body);},'sitemap_mismatch','/sitemap.xml');
 await denied(({path,spec})=>{if(path==='/sitemap.xml')spec.body=spec.body.replace(/<loc>[^<]*<\/loc>/,()=>'<loc>'+expectedProductionSitemap()[1]+'</loc>');},'sitemap_mismatch','/sitemap.xml');
 await denied(({path,spec})=>{if(path==='/sitemap.xml')spec.headers['content-type']='text/html';},'sitemap_mismatch','/sitemap.xml');
});
await test('health is bounded, release-correct and noindex; unknown routes stay noindex 404',async()=>{
 for(const path of ['/api/health','/__production-verifier-unknown__/'])await denied(({path:seen,spec})=>{if(seen===path)delete spec.headers['x-robots-tag'];},'nonpublic_indexing_or_status_mismatch',path);
 await denied(({path,spec})=>{if(path==='/__production-verifier-unknown__/')spec.status=200;},'nonpublic_indexing_or_status_mismatch','/__production-verifier-unknown__/');
 for(const patch of [{status:'degraded'},{contentRelease:'0'.repeat(64)},{pages:36},{database:false},{mediaBinding:false}])await denied(({path,spec})=>{if(path==='/api/health')spec.body=JSON.stringify({...JSON.parse(spec.body),...patch});},'health_invalid','/api/health');
 for(const body of [privateCanary,'x'.repeat(16385)])await denied(({path,spec})=>{if(path==='/api/health')spec.body=body;},'health_invalid','/api/health');
});
await test('anonymous and forged administrative identity must be denied with noindex and no-store',async()=>{
 for(const forged of [false,true])for(const path of ['/admin/','/api/tasks/']){
  const reason=forged?'forged_access_not_denied':'anonymous_access_not_denied';
  for(const change of [spec=>{spec.status=200;delete spec.headers.location;},spec=>{delete spec.headers['x-robots-tag'];},spec=>{spec.headers['cache-control']='public, max-age=3600';},spec=>{spec.headers.location='https://foreign.test/login/?token='+privateCanary;}])await denied(({path:seen,forged:seenForged,spec})=>{if(seen===path&&seenForged===forged)change(spec);},reason,path);
 }
 await denied(({path,spec})=>{if(path==='/admin/')spec.headers.location='/auth-required';},'anonymous_access_not_denied','/admin/');
 await denied(({path,spec})=>{if(path==='/api/tasks/')spec.headers.location='/login/';},'anonymous_access_not_denied','/api/tasks/');
});
await test('request failures and injected deadlines are bounded and disclose no raw payload',async()=>{
 await denied(({path})=>{if(path===firstPath)throw Error(privateCanary+' '+fixturePortable.vars.CMS_OWNER_EMAIL);},'request_failed',firstPath);
 let clock=0;const h=harness(()=>{clock=180001;});await assert.rejects(verify(h,{now:()=>clock}),error=>error instanceof ProductionLiveError&&error.checks[0].reason==='verification_deadline');assert.equal(h.calls.length,1);
});
await test('CLI with no explicit private production profile/config rejects before network with a fixed error',()=>{
 const script=fileURLToPath(new URL('./verify-production-live.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script],{env:{UNUSED_SECRET:privateCanary},encoding:'utf8'});assert.equal(result.status,1);assert.equal(result.stdout,'');const message=JSON.parse(result.stderr);assert.deepEqual(message,{productionLiveVerified:false,checks:[{passed:false,reason:'explicit_production_inputs_invalid'}]});assert.ok(!result.stderr.includes(privateCanary));
});
