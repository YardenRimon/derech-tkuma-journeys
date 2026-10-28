/** Read-only production acceptance. Importing this module performs no network.
 * Programmatic use requires an injected fetcher. CLI requires explicit validated
 * production profile/config paths and exact release SHA through build input.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateProductionProfile,validateProductionCloudflareConfig,productionOrigin,canonicalProductionProfile} from '../../production/release-profile.mjs';
import {productionBuildInput} from './build-production.mjs';
const release=JSON.parse(readFileSync(new URL('../lib/site-release.json',import.meta.url),'utf8'));
export const productionSourceManifest=JSON.parse(readFileSync(new URL('../source-manifest.json',import.meta.url),'utf8'));
export function readSourceIndexingProof(){
 const policy=JSON.parse(readFileSync(new URL('../source-pages/source-indexing.json',import.meta.url),'utf8')),provenanceBytes=readFileSync(new URL('../source-pages/provenance.json',import.meta.url)),provenance=JSON.parse(provenanceBytes);
 const hash=value=>createHash('sha256').update(value).digest('hex'),{policySha256,...payload}=policy,paths=Object.keys(productionSourceManifest).sort();
 const supported={37:['source-20261019','2026-10-19',4,32],51:['wordpress-public-20261028','2026-10-28',18,32]},expected=supported[paths.length];
 if(!expected||policy.version!==1||policy.origin!==productionOrigin||policy.snapshotId!==expected[0]||!policy.capturedAt.startsWith(expected[1])||policy.routeCount!==paths.length||policy.expectedSitemapCount!==expected[3]||hash(canonicalProductionProfile(payload))!==policySha256||hash(canonicalProductionProfile(productionSourceManifest))!==policy.sourceManifestCanonicalSha256||hash(provenanceBytes)!==policy.provenanceSha256||provenance.logicalPageCount!==paths.length||provenance.origin!==productionOrigin||JSON.stringify(Object.keys(policy.pages).sort())!==JSON.stringify(paths)||JSON.stringify(Object.keys(provenance.pages).sort())!==JSON.stringify(paths))throw Error('source_indexing_policy_mismatch');
 const noindexPaths=[];
 for(const path of paths){
  const record=provenance.pages[path],page=policy.pages[path],source=productionSourceManifest[path];
  if(!path.startsWith('/')||!path.endsWith('/')||/[?#\\%\x00-\x1f]/.test(path)||path!=='/'&&path.slice(1,-1).split('/').some(part=>!part||part==='.'||part==='..')||!/^current-[a-f0-9]{20}\.html\.gz$/.test(record.fixture)||page.fixture!==record.fixture||record.fixture!==source.fixture||page.sourceSha256!==record.sourceSha256||record.sourceSha256!==source.sourceSha256)throw Error('source_indexing_identity_mismatch');
  const raw=gunzipSync(readFileSync(new URL('../source-pages/'+record.fixture,import.meta.url)),{maxOutputLength:4*1024*1024});
  if(hash(raw)!==record.sourceSha256)throw Error('source_indexing_raw_hash_mismatch');
  const head=(raw.toString('utf8').match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1]??'').replace(/<!--([\s\S]*?)-->|<(script|style)\b[^>]*>[\s\S]*?<\/\2\s*>/gi,'');
  const robots=(head.match(/<meta\b[^>]*>/gi)??[]).map(attrs).filter(meta=>['robots','googlebot','bingbot'].includes(meta.name?.toLowerCase())).map(meta=>({name:meta.name.toLowerCase(),content:entities(meta.content??'')}));
  const denied=robots.some(tag=>/(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,;])/i.test(tag.content));
  if(page.noindex!==denied||JSON.stringify(page.robots)!==JSON.stringify(robots))throw Error('source_indexing_raw_robots_mismatch');
  if(denied)noindexPaths.push(path);
 }
 if(noindexPaths.length!==expected[2]||JSON.stringify(noindexPaths)!==JSON.stringify(policy.noindexPaths))throw Error('source_indexing_noindex_inventory_mismatch');
 return Object.freeze({snapshotId:policy.snapshotId,routeCount:paths.length,expectedSitemapCount:policy.expectedSitemapCount,noindexPaths:Object.freeze(noindexPaths),policySha256});
}
export const sourceIndexingProof=readSourceIndexingProof();
export const productionNoindexPaths=sourceIndexingProof.noindexPaths;
export const protectedProductionPaths=['/admin/','/admin/execution/','/api/users/','/api/tasks/','/api/reports/','/api/execution/'];
const assetNames=['production-guard.js','production-visitor.js'];
const digest=value=>createHash('sha256').update(value).digest('hex');
export class ProductionLiveError extends Error{constructor(checks){super('Production live verification failed');this.checks=checks;}}
const fail=(path,reason)=>{throw new ProductionLiveError([{path,passed:false,reason}]);};
function attrs(tag){const values={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)){const name=match[1].toLowerCase();if(Object.hasOwn(values,name))throw Error('duplicate_attribute');values[name]=match[2]??match[3]??match[4];}return values;}
function entities(value){return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,token=>{const text=token.slice(1,-1).toLowerCase(),named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};if(Object.hasOwn(named,text))return named[text];const code=text.startsWith('#x')?parseInt(text.slice(2),16):Number(text.slice(1));if(!Number.isSafeInteger(code)||code<1||code>0x10ffff)throw Error('entity_invalid');return String.fromCodePoint(code);});}
function normalizedUrl(value){const url=new URL(entities(value));if(url.origin!==productionOrigin||url.username||url.password||url.search||url.hash)throw Error('canonical_invalid');return decodeURIComponent(url.href);}
const noindex=value=>/(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,;])/i.test(value??'');
export function expectedProductionSitemap(){return [...new Set(Object.entries(productionSourceManifest).filter(([path])=>!productionNoindexPaths.includes(path)).map(([path,entry])=>normalizedUrl(entry.canonical??productionOrigin+path)))].sort();}
export function expectedProductionRobots(){return'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /auth-required\nDisallow: /measurement-frame/\nDisallow: /visitor-configuration/\nSitemap: '+productionOrigin+'/sitemap.xml\n';}
async function bounded(response,limit){const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('response_bound');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);}
export async function verifyProductionLive({profile,config,fetcher,now=Date.now,maxWaitMs=180000}={}){
 // There is deliberately no global-fetch default for imports/tests.
 if(typeof fetcher!=='function'||!Number.isSafeInteger(maxWaitMs)||maxWaitMs<1||maxWaitMs>180000)fail('/','explicit_inputs_required');
 try{profile=validateProductionProfile(profile,release.contentRelease,profile?.sourceCommit);validateProductionCloudflareConfig(config,profile);}catch{fail('/','production_profile_not_accepted');}
 const paths=Object.keys(productionSourceManifest),sitemap=expectedProductionSitemap();if(paths.length!==sourceIndexingProof.routeCount||sitemap.length!==sourceIndexingProof.expectedSitemapCount||release.pages!==sourceIndexingProof.routeCount)fail('/','source_inventory_unexpected');
 const deadline=now()+maxWaitMs,checks=[];
 async function get(path,{forged=false}={}){
  const url=new URL(encodeURI(path),profile.origin).href,remaining=deadline-now();if(remaining<=0)fail(path,'verification_deadline');
  try{
   const response=await fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(Math.max(1,Math.min(10000,remaining))),headers:{'user-agent':'DerechProductionReadVerifier/1.0',...(forged?{'x-platform-authenticated-id':'forged-production-verifier','x-platform-authenticated-email':config.vars.CMS_OWNER_EMAIL,'x-platform-authenticated-aal':'aal2','oai-authenticated-user-id':'forged-production-verifier','oai-authenticated-user-email':config.vars.CMS_OWNER_EMAIL,'cf-access-jwt-assertion':'forged-production-verifier'}:{})}});
   if(response.redirected||response.url&&response.url!==url){await response.body?.cancel();fail(path,'redirect_followed');}
   if(response.headers.get('x-derech-release')!==profile.sourceCommit){await response.body?.cancel();fail(path,'source_header_mismatch');}
   return response;
  }catch(error){if(error instanceof ProductionLiveError)throw error;fail(path,'request_failed');}
 }
 function passed(path,kind){checks.push({path,kind,passed:true});}
 for(const path of paths){
  const response=await get(path);
  if(response.status!==200||!response.headers.get('content-type')?.toLowerCase().startsWith('text/html')){await response.body?.cancel();fail(path,'public_html_unavailable');}
  let html;try{html=(await bounded(response,2*1024*1024)).toString('utf8');}catch{fail(path,'response_bound');}
  try{
   if(!/<html\b/i.test(html)||!/<head\b/i.test(html)||!/<body\b/i.test(html))fail(path,'public_document_invalid');
   const robots=(html.match(/<meta\b[^>]*>/gi)??[]).map(attrs).filter(meta=>['robots','googlebot','bingbot'].includes(meta.name?.toLowerCase())).map(meta=>entities(meta.content??''));
   if(productionNoindexPaths.includes(path)?!(noindex(response.headers.get('x-robots-tag'))&&robots.some(noindex)):noindex(response.headers.get('x-robots-tag'))||robots.some(noindex))fail(path,'indexing_policy_mismatch');
   if(/data-pilot-policy\s*=|\/__pilot__\/guard\.js|data-visitor-policy\s*=\s*["']review/i.test(html))fail(path,'review_policy_present');
   const scripts=(html.match(/<script\b[^>]*>/gi)??[]).map(attrs);
   const sourceScripts=scripts.filter(script=>script.src),targets=sourceScripts.map(script=>new URL(entities(script.src),profile.origin));
   if(targets.some(url=>decodeURIComponent(url.pathname)==='/visitor-policy.js'||decodeURIComponent(url.pathname).startsWith('/__pilot__/')))fail(path,'review_visitor_present');
   const guards=sourceScripts.filter((script,index)=>targets[index].origin===profile.origin&&targets[index].pathname==='/production-guard.js'),visitors=sourceScripts.filter((script,index)=>targets[index].origin===profile.origin&&targets[index].pathname==='/production-visitor.js');
   if(guards.length!==1||visitors.length!==1||guards[0]['data-production-policy']!=='guard-first'||visitors[0]['data-production-policy']!=='consent'||visitors[0].type!=='module'||guards[0].type!==undefined||sourceScripts[0]!==guards[0]||sourceScripts[1]!==visitors[0]||targets.slice(0,2).some(url=>url.search||url.hash))fail(path,'production_visitor_or_order_mismatch');
   const canonicals=(html.match(/<link\b[^>]*>/gi)??[]).map(attrs).filter(link=>(link.rel??'').toLowerCase().split(/\s+/).includes('canonical'));
   const expected=productionSourceManifest[path].canonical??profile.origin+path;
   let canonicalMatches=false;try{canonicalMatches=canonicals.length===1&&Boolean(canonicals[0].href)&&normalizedUrl(canonicals[0].href)===normalizedUrl(expected)&&Boolean(productionSourceManifest[path].canonical||canonicals[0]['data-production-policy']==='source-self-canonical');}catch{}
   if(!canonicalMatches)fail(path,'canonical_mismatch');
  }catch(error){if(error instanceof ProductionLiveError)throw error;fail(path,'public_policy_markup_invalid');}
  passed(path,'public_html');
 }
 for(const name of assetNames){
  const path='/'+name,response=await get(path),expected=readFileSync(new URL('../public/'+name,import.meta.url));
  if(response.status!==200||!response.headers.get('content-type')?.includes('javascript')||!noindex(response.headers.get('x-robots-tag'))){await response.body?.cancel();fail(path,'production_asset_policy_mismatch');}
  let body;try{body=await bounded(response,expected.length+1);}catch{fail(path,'production_asset_bound');}
  if(body.length!==expected.length||digest(body)!==digest(expected))fail(path,'production_asset_bytes_mismatch');passed(path,'production_asset');
 }
 for(const path of ['/robots.txt','/sitemap.xml']){
  const response=await get(path);
  if(response.status!==200||noindex(response.headers.get('x-robots-tag'))){await response.body?.cancel();fail(path,'public_discovery_policy_mismatch');}
  let text;try{text=(await bounded(response,128*1024)).toString('utf8');}catch{fail(path,'discovery_response_bound');}
  if(path==='/robots.txt'){
   if(!response.headers.get('content-type')?.startsWith('text/plain')||text.replaceAll('\r\n','\n').trim()!==expectedProductionRobots().trim())fail(path,'robots_mismatch');
  }else{
   try{
    const entries=[...text.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match=>normalizedUrl(match[1])).sort();
    if(!response.headers.get('content-type')?.includes('xml')||/<!DOCTYPE|<!ENTITY/i.test(text)||!/<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(text)||(text.match(/<url>/g)??[]).length!==sitemap.length||entries.length!==sitemap.length||JSON.stringify(entries)!==JSON.stringify(sitemap))fail(path,'sitemap_mismatch');
   }catch(error){if(error instanceof ProductionLiveError)throw error;fail(path,'sitemap_mismatch');}
  }
  passed(path,'discovery');
 }
 for(const path of ['/api/health','/__production-verifier-unknown__/']){
  const response=await get(path);
  if(response.status!==(path==='/api/health'?200:404)||!noindex(response.headers.get('x-robots-tag'))){await response.body?.cancel();fail(path,'nonpublic_indexing_or_status_mismatch');}
  if(path==='/api/health'){
   let health;try{health=JSON.parse((await bounded(response,16384)).toString('utf8'));}catch{fail(path,'health_invalid');}
   if(health.status!=='ready'||health.contentRelease!==release.contentRelease||health.pages!==sourceIndexingProof.routeCount||health.database!==true||health.mediaBinding!==true)fail(path,'health_invalid');
  }else await response.body?.cancel();
  passed(path,'nonpublic_noindex');
 }
 for(const forged of [false,true])for(const path of protectedProductionPaths){
  const response=await get(path,{forged}),location=response.headers.get('location');await response.body?.cancel();
  const redirect=(()=>{try{const url=new URL(location,profile.origin);return location!==null&&url.origin===profile.origin&&url.pathname==='/login/';}catch{return false;}})();
  const safe=noindex(response.headers.get('x-robots-tag'))&&response.headers.get('cache-control')?.includes('no-store');
  const denied=path.startsWith('/admin')?response.status===302&&redirect:[401,403].includes(response.status)&&!location;
  if(!safe||!denied)fail(path,forged?'forged_access_not_denied':'anonymous_access_not_denied');
  passed(path,forged?'forged_denied':'anonymous_denied');
 }
 if(now()>deadline)fail('/','verification_deadline');
 return {productionLiveVerified:true,sourceCommit:profile.sourceCommit,publicPages:sourceIndexingProof.routeCount,sitemapUrls:sitemap.length,productionAssets:assetNames.length,protectedChecks:protectedProductionPaths.length*2,requests:checks.length,readOnly:true,realOwnerLoginVerified:false,formDeliveryVerified:false,paymentVerified:false,measurementDeliveryVerified:false,checks};
}
export async function main(environment=process.env){
 const {profile,config}=productionBuildInput(environment);
 const proof=await verifyProductionLive({profile,config,fetcher:globalThis.fetch});console.log(JSON.stringify(proof));return proof;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({productionLiveVerified:false,checks:error instanceof ProductionLiveError?error.checks:[{passed:false,reason:'explicit_production_inputs_invalid'}]}));process.exitCode=1;});
