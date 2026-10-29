import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {CONSENT_POLICY_VERSION as version, APPROVED_WHATSAPP, createVisitorPolicy, normalizeWhatsAppHref, installVisitorPolicy} from '../public/visitor-policy.js';
import {prepareReviewRuntime} from '../lib/review-runtime.ts';

const consent={policyVersion:version,analytics:true,marketing:false};
const config={verified:true,origin:'https://derech-tkuma.com',revision:'reviewed-1',strategy:'gtm',ga4Id:'G-DV3E8J77EX',gtmId:'GTM-5N7NPTL4',metaPixelId:'766863783155971'};
const delivered=[];
const enabled=overrides=>createVisitorPolicy({mode:'production',origin:config.origin,productionConfiguration:{...config},dispatch:event=>delivered.push(event),...overrides});
for(const policy of [createVisitorPolicy(),enabled({mode:'review'}),enabled({origin:'https://review.workers.dev'}),enabled({dispatch:null}),
  ...[{...config,verified:false},{...config,gtmId:'GTM-OTHER'},{...config,unexpected:'field'},null].map(productionConfiguration=>enabled({productionConfiguration}))]){
  assert.equal(policy.status().canDispatch,false);policy.setConsent(consent);
  assert.equal(policy.track('whatsapp_click',{placement:'other'}),false);
}
assert.equal(delivered.length,0,'review/unverified configuration never dispatches even after consent');
const policy=enabled();
assert.equal(policy.track('page_view',{pageKind:'home'}),false,'default consent denied');
for(const value of [{...consent,policyVersion:'old'},{...consent,analytics:'true'},{...consent,email:'private@example.invalid'},null])assert.equal(policy.setConsent(value),false);
assert.equal(policy.setConsent(consent),true);assert.equal(policy.status().canDispatch,true);
for(const [event,fields] of [['unknown',{}],['page_view',{pageKind:'/thanks/?email=private'}],['page_view',{pageKind:'home',url:'private'}],
  ['whatsapp_click',{placement:'private@example.invalid'}],['whatsapp_click',{placement:'other',phone:'0535955166'}],['page_view',[]]])assert.equal(policy.track(event,fields),false);
assert.equal(policy.track('page_view',{pageKind:'home'}),true);assert.equal(policy.track('whatsapp_click',{placement:'footer'}),true);
assert.deepEqual(delivered.map(({name,...fields})=>Object.keys(fields).sort()),[
  ['configurationRevision','pageKind','policyVersion','purpose'],['configurationRevision','placement','policyVersion','purpose']]);
assert.ok(Object.isFrozen(delivered[0]));policy.revoke();assert.equal(policy.status().canDispatch,false);
assert.equal(policy.track('page_view',{pageKind:'home'}),false);assert.equal(delivered.length,2,'no deferred/replayed event after revoke');
policy.setConsent({...consent,analytics:false,marketing:true});assert.equal(policy.track('page_view',{pageKind:'home'}),false,'marketing consent never substitutes analytics consent');
const mutable={...config,verified:false};const snapshot=enabled({productionConfiguration:mutable});mutable.verified=true;snapshot.setConsent(consent);assert.equal(snapshot.status().canDispatch,false);
const throwing=enabled({dispatch:()=>{throw new Error('offline')}});throwing.setConsent(consent);assert.equal(throwing.track('page_view',{pageKind:'home'}),false);

for(const phone of ['535955166','0535955166',APPROVED_WHATSAPP])for(const suffix of ['', '/', '?text=%D7%A9%D7%9C%D7%95%D7%9D+test&source=cta#same'])
  assert.equal(normalizeWhatsAppHref('https://wa.me/'+phone+suffix),'https://wa.me/'+APPROVED_WHATSAPP+suffix);
for(const href of ['https://wa.me/123','https://chat.whatsapp.com/source-group','https://wa.me.evil.invalid/535955166','http://wa.me/535955166',
  'https://user@wa.me/535955166','https://wa.me:8443/535955166','https://wa.me/535955166/more','//wa.me/535955166','javascript:alert(1)',null])assert.equal(normalizeWhatsAppHref(href),href);

const anchor=href=>({nodeType:1,textContent:'נשמח לדבר איתך',href,
  matches:selector=>selector==='a[href]',querySelectorAll:()=>[],getAttribute(){return this.href;},setAttribute(_name,value){this.href=value;},closest(){return this;}});
const links=[anchor('https://wa.me/535955166?text=%D7%A9%D7%9C%D7%95%D7%9D'),anchor('https://chat.whatsapp.com/source-group')];
const listeners=[];const doc={documentElement:{},querySelectorAll:()=>links,addEventListener:(name,handler)=>listeners.push({name,handler}),
 removeEventListener:(name,handler)=>{const index=listeners.findIndex(x=>x.name===name&&x.handler===handler);if(index>=0)listeners.splice(index,1);}};
let observeOptions,observerCallback,disconnected=false;
class Observer{constructor(callback){observerCallback=callback;}observe(_root,options){observeOptions=options;}disconnect(){disconnected=true;}}
let externalCalls=0;
const win={fetch:()=>{externalCalls++;return Promise.resolve({});},open:()=>{externalCalls++;}};
class XHR{open(){externalCalls++;}}class Form{submit(){externalCalls++;}}
const navigator={sendBeacon:()=>{externalCalls++;}};
runInNewContext(readFileSync(new URL('../public/__pilot__/guard.js',import.meta.url),'utf8'),{
 window:win,document:doc,location:{href:'https://review.workers.dev/',origin:'https://review.workers.dev'},navigator,
 XMLHttpRequest:XHR,HTMLFormElement:Form,URL,DOMException,
});
const installed=installVisitorPolicy(doc,{Observer});installed.setConsent(consent);
assert.equal(links[0].href,'https://wa.me/972535955166?text=%D7%A9%D7%9C%D7%95%D7%9D');assert.equal(links[0].textContent,'נשמח לדבר איתך');
assert.equal(links[1].href,'https://chat.whatsapp.com/source-group');assert.equal(installed.status().canDispatch,false);
const event={target:links[0],defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
for(const {name,handler} of listeners)if(name==='click'){handler(event);if(event.stopped)break;}
assert.equal(event.defaultPrevented,true,'original review guard still blocks WhatsApp navigation');assert.equal(event.stopped,true);
assert.equal(externalCalls,0);
assert.deepEqual(observeOptions,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
const added=anchor('https://wa.me/0535955166');observerCallback([{type:'childList',addedNodes:[added]}]);assert.equal(added.href,'https://wa.me/972535955166');
added.href='https://wa.me/535955166';observerCallback([{type:'attributes',target:added}]);assert.equal(added.href,'https://wa.me/972535955166');
installed.dispose();assert.equal(disconnected,true);assert.equal(installed.status().canDispatch,false);

const pages=JSON.parse(gunzipSync(readFileSync(new URL('../source-pages/generated-review-pages.json.gz',import.meta.url))));
const release=JSON.parse(readFileSync(new URL('../lib/site-release.json',import.meta.url))),provenance=JSON.parse(readFileSync(new URL('../source-pages/provenance.json',import.meta.url)));
const expectedPages=provenance.snapshotId==='wordpress-public-20261028'?51:37;assert.equal(release.pages,expectedPages);assert.equal(provenance.logicalPageCount,expectedPages);
let count=0;
for(const [route,page] of Object.entries(pages)){
 const html=page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix;
 const prepared=prepareReviewRuntime(html),again=prepareReviewRuntime(prepared);
 assert.equal(again,prepared,'runtime preparation remains idempotent: '+route);
 assert.equal((prepared.match(/src="\/visitor-policy\.js"/g)??[]).length,1,route);
 assert.ok(prepared.indexOf('/__pilot__/guard.js')<prepared.indexOf('/visitor-policy.js'),'guard remains first: '+route);
 const scriptSources=value=>[...value.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi)].map(match=>match[1]).filter(url=>url!=='/visitor-policy.js');
 // Runtime promotion is already independently covered; adding this module must not reorder source scripts.
 assert.deepEqual(scriptSources(prepared),scriptSources(html),'original script URLs retain their order: '+route);
 for(const match of html.matchAll(/href=["'](https:\/\/wa\.me\/\d+(?:[^"']*)?)["']/g)){
  const normalized=normalizeWhatsAppHref(match[1]);assert.ok(normalized.startsWith('https://wa.me/'+APPROVED_WHATSAPP),route);count++;
 }
}
assert.equal(Object.keys(pages).length,expectedPages);assert.ok(count>=189,'exercise all captured phone links');
// Vite copies this public module verbatim into the Cloudflare client artifact.
// Root can run this same test after its full build with --artifact to verify packaging.
if(process.argv.includes('--artifact'))assert.deepEqual(readFileSync(new URL('../dist/client/visitor-policy.js',import.meta.url)),readFileSync(new URL('../public/visitor-policy.js',import.meta.url)));
const source=readFileSync(new URL('../public/visitor-policy.js',import.meta.url),'utf8');
assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|sendBeacon|dataLayer|gtag|fbq|localStorage|sessionStorage)\b/,'no provider, network or persistence implementation');
console.log(`PASS visitor policy: deny-default review/config/consent, revocation and PII rejection; exact WhatsApp normalization for ${count} source anchors across ${expectedPages} pages; preserved CTA text, dynamic links and guard navigation block; local module injection/order; zero external calls${process.argv.includes('--artifact')?'; exact Cloudflare artifact bytes':''}.`);
