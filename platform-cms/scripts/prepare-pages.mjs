/** Provider build bootstrap: verify pinned source reconstruction, then materialize
 * ignored generated JSON. Full HTML reconstruction remains in Python CI checks.
 * No network, provider SDK, Python runtime, or third-party dependency is used.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),file=path=>new URL(path,root);
const json=path=>JSON.parse(readFileSync(file(path),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const build=json('source-pages/review-build.json'),provenance=json('source-pages/provenance.json'),manifest=json('source-manifest.json');
assert.equal(build.version,1);assert.equal(build.format,'gzip-json-utf8');
const packed=readFileSync(file('source-pages/generated-review-pages.json.gz'));
assert.equal(packed.readUInt32LE(4),0,'review gzip must have a deterministic timestamp');
assert.equal(packed[9],255,'review gzip must have a platform-independent header');
assert.equal(sha(packed),build.packedSha256,'pinned review gzip identity mismatch');
const payload=gunzipSync(packed,{maxOutputLength:40*1024*1024});
assert.equal(payload.length,build.payloadBytes);assert.equal(sha(payload),build.payloadSha256,'pinned review payload hash mismatch');
const pages=JSON.parse(payload.toString('utf8')),routes=Object.keys(pages).sort();
const identities=json('source-pages/field-identities.json');assert.equal(identities.format,1);
if(provenance.assetMap){const pin=provenance.assetMap,bytes=readFileSync(file('source-pages/'+pin.file)),map=JSON.parse(bytes);assert.equal(pin.file,'asset-map.json');assert.equal(sha(bytes),pin.sha256,'pinned snapshot asset map mismatch');assert.equal(map.snapshotId,provenance.snapshotId);assert.equal(map.snapshotId,pin.snapshotId);assert.equal(sha(readFileSync(file('source-snapshot-assets-manifest.json'))),map.manifestSha256,'snapshot asset manifest drift');}
assert.equal(routes.length,build.routeCount);assert.equal(routes.length,provenance.logicalPageCount);
for(const object of [build.sources,provenance.pages,manifest])assert.deepEqual(routes,Object.keys(object).sort(),'pinned route identity mismatch');
for(const slug of routes){
 const identityPage=identities.pages[slug];assert.ok(identityPage,'field identity page missing');
 assert.equal(identityPage.sourceTemplateSha256,manifest[slug].sha256,'template changed without reviewed identity migration');
 assert.deepEqual(identityPage.active.map(({id,...field})=>[id,field]),Object.entries(pages[slug].fields),'stable field registry does not match generated fields');
 const allIds=[...identityPage.active,...identityPage.retired].map(x=>x.id);assert.equal(new Set(allIds).size,allIds.length,'retired field identity reused');
 assert.deepEqual(Object.fromEntries(identityPage.retired.map(x=>[x.id,x.value])),pages[slug].retired??{},'retired recovery originals missing');
 const identity=build.sources[slug],source=provenance.pages[slug],entry=manifest[slug];
 assert.match(identity.fixture,/^current-[a-f0-9]{20}\.html\.gz$/);
 assert.equal(identity.fixture,source.fixture);assert.equal(identity.fixture,entry.fixture);
 assert.equal(identity.sourceSha256,source.sourceSha256);assert.equal(identity.sourceSha256,entry.sourceSha256);
 const fixture=readFileSync(file('source-pages/'+identity.fixture));assert.equal(sha(fixture),identity.fixtureSha256,'source fixture gzip changed: '+slug);
 assert.equal(sha(gunzipSync(fixture,{maxOutputLength:4*1024*1024})),identity.sourceSha256,'raw source fixture hash mismatch: '+slug);
 const page=pages[slug],html=page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix;
 const reviewed=html.replace(/ data-(?:edit|image)-id="(?:text|image)-\d+"/g,'');
 assert.equal(sha(reviewed),source.reviewSha256,'generated review page hash mismatch: '+slug);assert.equal(source.reviewSha256,entry.sha256);
}
const release=json('lib/site-release.json');assert.equal(release.mode,'review');assert.equal(release.pages,routes.length);assert.equal(release.contentRelease,sha(readFileSync(file('source-manifest.json'))));assert.equal(release.capturedAt,provenance.capturedAt);assert.deepEqual(release.redirects??[],provenance.redirects??[],'source redirects changed without release metadata');
// No output is written until all pinned source identities and review payloads pass.
mkdirSync(file('lib/'),{recursive:true});writeFileSync(file('lib/generated-pages.json'),payload);
console.log(JSON.stringify({prepared:true,routes:routes.length,payloadSha256:build.payloadSha256,source:'verified pinned source reconstruction',networkRequests:0,pythonRequired:false}));
