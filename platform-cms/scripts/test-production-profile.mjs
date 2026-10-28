import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {canonicalProductionProfile} from '../../production/release-profile.mjs';
import {fileURLToPath} from 'node:url';
import {validateProductionProfile,validateProductionCloudflareConfig,productionGates} from '../../production/release-profile.mjs';
import {validateCloudflareConfig} from './build-cloudflare.mjs';
import {fixtureProfile,fixturePortable,fixtureMeasurement,fixtureSource,fixtureConfiguration} from './production-profile-fixture.mjs';
import {readConsent,consentValue,POLICY_VERSION,CONSENT_COOKIE} from '../public/consent-state.js';
import {validVisitorConfiguration} from '../public/production-visitor.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function profileModule(accepted=true,indexingOverride=null){const result=await build({stdin:{contents:`export * from './lib/visitor-release';export * from './lib/review-runtime';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',define:{__DERECH_PRODUCTION_BUILD__:JSON.stringify(accepted),__DERECH_PRODUCTION_PROFILE__:JSON.stringify(fixtureProfile)},logLevel:'silent',plugins:indexingOverride===null?[]:[{name:'source-indexing-fixture',setup(builder){builder.onLoad({filter:/source-indexing\.json$/},()=>({contents:JSON.stringify(indexingOverride),loader:'json'}));}}]});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const prod=await profileModule(),review=await profileModule(false);
const sourceIndexing=JSON.parse(readFileSync(new URL('../source-pages/source-indexing.json',import.meta.url)));
assert.equal(prod.sourceIndexingValid,true,'hash-pinned source robots policy must validate');
const repin=policy=>{const {policySha256,...payload}=policy;return {...payload,policySha256:createHash('sha256').update(canonicalProductionProfile(payload)).digest('hex')};};
for(const corrupt of [{...sourceIndexing,policySha256:'0'.repeat(64)},repin({...sourceIndexing,noindexPaths:sourceIndexing.noindexPaths.slice(1)}),repin({...sourceIndexing,pages:{...sourceIndexing.pages,'/':{...sourceIndexing.pages['/'],sourceSha256:'0'.repeat(64)}}})]){const blocked=await profileModule(true,corrupt);assert.equal(blocked.sourceIndexingValid,false);assert.equal(blocked.productionRelease(new URL('https://derech-tkuma.com/')),null);assert.equal(blocked.productionIndexablePath('/'),false,'invalid policy cannot enable indexing');}
assert.doesNotThrow(()=>validateProductionProfile(fixtureProfile,fixtureSource.contentRelease,fixtureProfile.sourceCommit));assert.doesNotThrow(()=>validateProductionCloudflareConfig(fixturePortable,fixtureProfile));
assert.throws(()=>validateCloudflareConfig(fixturePortable),'review validator never accepts production target');
for(const bad of [{...fixtureProfile,stage:'review'},{...fixtureProfile,origin:'https://review.workers.dev'},{...fixtureProfile,sourceCommit:'f'.repeat(40)},{...fixtureProfile,sourceRelease:'0'.repeat(64)},{...fixtureProfile,approvalReceiptHash:''},{...fixtureProfile,extra:true},...productionGates.map(gate=>({...fixtureProfile,gates:{...fixtureProfile.gates,[gate]:false}})),{...fixtureProfile,measurement:{...fixtureMeasurement,gtmId:'GTM-N6ZC8824'}},{...fixtureProfile,measurement:{...fixtureMeasurement,strategy:'ga4-direct'}},{...fixtureProfile,measurement:{...fixtureMeasurement,verified:false}},{...fixtureProfile,measurement:{...fixtureMeasurement,purposeTagsVerified:false}}])assert.throws(()=>validateProductionProfile(bad,fixtureSource.contentRelease,fixtureProfile.sourceCommit));
for(const bad of [{...fixturePortable,workers_dev:true},{...fixturePortable,routes:[{pattern:'*.example.test/*',zone_name:'example.test'}]},{...fixturePortable,main:'./build/cloudflare-worker.ts'},{...fixturePortable,vars:{...fixturePortable.vars,PLATFORM_RELEASE_STAGE:'review'}},{...fixturePortable,r2_buckets:[{binding:'BUCKET',bucket_name:'other'}]}])assert.throws(()=>validateProductionCloudflareConfig(bad,fixtureProfile));
assert.throws(()=>validateProductionProfile({...fixtureProfile,paymentsReady:true},fixtureSource.contentRelease));
const paymentEvidence={provider:'grow',environment:'production',currency:'ILS',acceptanceHash:'a'.repeat(64),currencyEvidenceHash:'b'.repeat(64),acknowledgmentEvidenceHash:'c'.repeat(64),termsHash:'d'.repeat(64),callbackVerification:'stored-process-token-and-approved-readback/v1',acknowledgmentContract:'full-documented-form/v1'};
assert.doesNotThrow(()=>validateProductionProfile({...fixtureProfile,paymentsReady:true,paymentEvidence},fixtureSource.contentRelease));
assert.throws(()=>validateProductionProfile({...fixtureProfile,paymentsReady:true,paymentEvidence:{...paymentEvidence,environment:'sandbox'}},fixtureSource.contentRelease));
assert.throws(()=>validateProductionCloudflareConfig({...fixturePortable,vars:{...fixturePortable.vars,PAYMENT_CONFIG:'synthetic-secret-is-not-a-public-var'}},fixtureProfile));
const contactProfile={...fixtureProfile,contactReady:true};assert.throws(()=>validateProductionCloudflareConfig(fixturePortable,contactProfile));
const contactVars={...fixturePortable.vars,CONTACT_MODE:'receive-only',CONTACT_ORIGIN:fixtureProfile.origin,CONTACT_RETENTION_DAYS:'30',CONTACT_PRIVACY_AUTHORITY_ID:'12345678-1234-4234-8234-123456789abc'};
assert.doesNotThrow(()=>validateProductionCloudflareConfig({...fixturePortable,vars:contactVars},contactProfile));
for(const patch of [{CONTACT_MODE:'enabled'},{CONTACT_ORIGIN:'https://www.derech-tkuma.com'},{CONTACT_RETENTION_DAYS:'90'},{CONTACT_PRIVACY_AUTHORITY_ID:'missing'}])assert.throws(()=>validateProductionCloudflareConfig({...fixturePortable,vars:{...contactVars,...patch}},contactProfile));
for(const url of ['https://derech-tkuma.com/?mode=production','https://www.derech-tkuma.com/','https://review.workers.dev/?production=true','https://example.test/']){
 assert.equal(review.productionRelease(new URL(url)),null,'review build cannot use query/window/environment opt-ins');
 if(url.includes('review.workers')||url.includes('example.test'))assert.equal(prod.productionRelease(new URL(url)),null);
}
const pages=JSON.parse(gunzipSync(readFileSync(new URL('../source-pages/generated-review-pages.json.gz',import.meta.url))));
const injected='<meta name="referrer" content="strict-origin-when-cross-origin"><script src="/production-guard.js" data-production-policy="guard-first"></script><script type="module" src="/production-visitor.js" data-production-policy="consent"></script>';
let count=0;const originalNoindex=[];
for(const [path,page]of Object.entries(pages)){
 const html=prod.prepareReviewRuntime(page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix),url=new URL(path,fixtureProfile.origin),transformed=prod.prepareProductionPage(html,url,fixtureProfile);
 assert.equal(transformed.replace(prod.productionInsertion(html,url),''),html.replace(prod.exactReviewProtection,'').replace(prod.exactReviewVisitor,''),'only exact review policy/module removed plus one production insertion: '+path);
 if(/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html.replace(prod.exactReviewProtection,'')))originalNoindex.push(path);
 assert.equal(prod.productionIndexablePath(path),!prod.sourceNoindexPaths.has(path));
 const scripts=value=>[...value.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi)].map(match=>match[1]).filter(src=>!['/__pilot__/guard.js','/visitor-policy.js','/production-guard.js','/production-visitor.js'].includes(src));
 assert.deepEqual(scripts(transformed),scripts(html),'source script order: '+path);
 assert.deepEqual(transformed.match(/<!-- pilot-disabled-(?:tracking|payment)-script sha256=[a-f0-9]{64} -->/g),html.match(/<!-- pilot-disabled-(?:tracking|payment)-script sha256=[a-f0-9]{64} -->/g),'original SDKs remain disabled: '+path);
 assert.ok(!transformed.includes('/__pilot__/guard.js'));assert.ok(!transformed.includes('data-pilot-policy='));
 assert.throws(()=>prod.prepareProductionPage(html.replace(prod.exactReviewProtection,''),url,fixtureProfile));
 count++;
}
assert.equal(count,sourceIndexing.routeCount);assert.ok([37,51].includes(count));assert.deepEqual(originalNoindex.sort(),[...prod.sourceNoindexPaths].sort(),'source indexing intent is fixed and independently checked');assert.equal(prod.exactReviewVisitor.length,85);
assert.match(prod.productionCsp,/form-action 'none'/);assert.match(prod.productionCsp,/connect-src 'self'/);assert.doesNotMatch(prod.productionCsp,/google-analytics|googletagmanager|facebook/);
assert.match(prod.productionRobots(fixtureProfile),/Sitemap: https:\/\/derech-tkuma\.com\/sitemap\.xml/);assert.equal((prod.productionSitemap().match(/<loc>/g)??[]).length,32);
assert.equal(validVisitorConfiguration(fixtureConfiguration,fixtureProfile.origin),true);assert.equal(validVisitorConfiguration(fixtureConfiguration,'https://review.workers.dev'),false);assert.equal(validVisitorConfiguration({...fixtureConfiguration,configuration:{...fixtureMeasurement,gtmId:'GTM-N6ZC8824'}},fixtureProfile.origin),false);
const now=1800000000,revision=fixtureMeasurement.revision,c=consentValue(true,false,revision,now),cookie=CONSENT_COOKIE+'='+encodeURIComponent(JSON.stringify(c));
assert.deepEqual(readConsent(cookie,revision,now),c);
for(const value of ['',cookie+'; '+cookie,CONSENT_COOKIE+'=x'.repeat(601),CONSENT_COOKIE+'='+encodeURIComponent(JSON.stringify({...c,email:'private@example.test'})),CONSENT_COOKIE+'='+encodeURIComponent(JSON.stringify({...c,policyVersion:'old'})),CONSENT_COOKIE+'='+encodeURIComponent(JSON.stringify({...c,expires:now-1}))])assert.equal(readConsent(value,revision,now),null);
assert.equal(readConsent(cookie,'a'.repeat(64),now),null);assert.equal(readConsent(cookie,revision,c.expires+1),null);assert.equal(POLICY_VERSION,'2026-10-20');
console.log('PASS production profile: all owner/source/resource/measurement gates default closed, separate review validator, snapshot-pinned policy-only transform preserving source SDK disable/order/canonical, fixed CSP/robots/sitemap, server-only profile, bounded/versioned consent cookie and exact source IDs. Synthetic attestation only; no provider verified or called.');
