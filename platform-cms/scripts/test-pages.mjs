import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const pages=JSON.parse(readFileSync(new URL('../lib/generated-pages.json',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('../source-manifest.json',import.meta.url)));
const provenance=JSON.parse(readFileSync(new URL('../source-pages/provenance.json',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const localize=value=>value.replace(/https?:\\\/\\\/(?:www\.)?derech-tkuma\.com(?=\\\/|["']|$)/gi,(match,offset,string)=>string.slice(offset+match.length).startsWith('\\/')?'':'\\/').replace(/(?:https?:)?\/\/(?:www\.)?derech-tkuma\.com(?=\/|[\s"'<>)]|$)/gi,(match,offset,string)=>string.slice(offset+match.length).startsWith('/')?'':'/');
const scriptBlocks=html=>[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map(m=>({attrs:m[1],body:m[2]}));
const tracking=/googletagmanager|google-analytics|google-analytics-for-wordpress|monsterinsights|__gtagTracker|GoogleAnalyticsObject|\bgtag\s*\(|\bfbq\s*\(|fbevents|hotjar|clarity\.ms|maspik-signals|pixel\./i;
const payment=/meshulam[_-]payment|configureGrowSdk|\bGrowSDK\b|grow-sdk|grow\.payments/i;
const canonical=html=>[...html.matchAll(/<link\b[^>]*>/gi)].filter(m=>/\brel\s*=\s*["']canonical["']/i.test(m[0])).map(m=>m[0]);
assert.equal(Object.keys(pages).length,37,'all current logical routes must be present');
assert.equal(provenance.capturedHtmlCount,38);assert.equal(provenance.aliases.length,1);assert.equal(provenance.logicalPageCount,37);
assert.deepEqual(Object.keys(pages).sort(),Object.keys(provenance.pages).sort());assert.deepEqual(Object.keys(pages).sort(),Object.keys(manifest).sort());
const inventoryUrl=new URL('../../migration/source-2026-10-19/inventory.json',import.meta.url);
let inventory;
if(existsSync(inventoryUrl)){
 inventory=JSON.parse(readFileSync(inventoryUrl));
 const routes=[...new Set(inventory.pages.map(x=>x.route==='/'?'/':x.route.replace(/\/+$/,'')+'/'))].sort();
 assert.deepEqual(Object.keys(pages).sort(),routes,'current capture inventory logical coverage');
}
let textCount=0,imageCount=0,patchCount=0,disabledCount=0;
for(const [slug,page]of Object.entries(pages)){
 const record=provenance.pages[slug],fixtureBytes=gunzipSync(readFileSync(new URL('../source-pages/'+record.fixture,import.meta.url))),source=fixtureBytes.toString('utf8');
 assert.equal(sha(fixtureBytes),record.sourceSha256,slug+' exact captured UTF-8 bytes');assert.equal(Buffer.byteLength(source),record.sourceBytes);assert.equal(sha(source),record.sourceSha256,'no decoder replacement');
 if(inventory){const captured=inventory.pages.find(x=>(x.route==='/'?'/':x.route.replace(/\/+$/,'')+'/')===slug);assert.equal(record.sourceSha256,captured.source_sha256);assert.equal(record.canonical,captured.canonical??null);const actualUrl=new URL('../../migration/source-2026-10-19/'+captured.local_path,import.meta.url);if(existsSync(actualUrl))assert.deepEqual(fixtureBytes,readFileSync(actualUrl));}
 const chars=Array.from(source),parts=[];let cursor=0;
 for(const patch of record.patches){
  assert.ok(patch.start>=cursor&&patch.end>=patch.start,slug+' non-overlapping source offsets');const before=chars.slice(patch.start,patch.end).join('');assert.equal(sha(before),patch.beforeSha256);
  if(patch.kind==='own-site-url'){const following=chars.slice(patch.end,patch.end+2).join('');assert.equal(patch.replacement+following,localize(before+following),'only own-site origins may change');}
  else if(patch.kind==='review-protection'){
   assert.equal(patch.start,patch.end);assert.match(patch.replacement,/noindex,nofollow,noarchive/);assert.match(patch.replacement,/form-action &#x27;none&#x27;/);assert.match(patch.replacement,/connect-src &#x27;self&#x27;/);assert.match(patch.replacement,/src="\/__pilot__\/guard\.js"/);
  }else if(patch.kind==='disabled-tracking-script'||patch.kind==='disabled-payment-script'){
   assert.match(before,/^<script\b[\s\S]*<\/script\s*>$/i);assert.ok((patch.kind==='disabled-payment-script'?payment:tracking).test(before));assert.equal(patch.replacement,`<!-- pilot-disabled-${patch.kind==='disabled-payment-script'?'payment':'tracking'}-script sha256=${sha(before)} -->`);disabledCount++;
  }else assert.fail('unapproved transformation: '+patch.kind);
  parts.push(chars.slice(cursor,patch.start).join(''),patch.replacement);cursor=patch.end;patchCount++;
 }
 parts.push(chars.slice(cursor).join(''));const reviewed=parts.join('');
 assert.equal(sha(reviewed),record.reviewSha256);assert.equal(manifest[slug].sha256,record.reviewSha256);assert.equal(manifest[slug].sourceSha256,record.sourceSha256);
 const annotated=page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix;
 assert.equal(annotated.replace(/ data-(?:edit|image)-id="(?:text|image)-\d+"/g,''),reviewed,'only CMS leaf annotations may change reviewed source');
 assert.deepEqual(canonical(reviewed),canonical(source),'original source canonical identity must remain exact');
 assert.match(annotated,/<meta name="robots" content="noindex,nofollow,noarchive" data-pilot-policy="current-source-review">/);
 assert.equal(scriptBlocks(reviewed)[0].attrs,' src="/__pilot__/guard.js" data-pilot-policy="guard-first"','guard must execute before original scripts');
 const ids=[...annotated.matchAll(/ data-(?:edit|image)-id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,Object.keys(page.fields).length);
 const texts=Object.values(page.fields).filter(x=>x.type==='text').map(x=>x.value),images=Object.values(page.fields).filter(x=>x.type==='image');
 assert.equal(sha(JSON.stringify(texts)),record.sourceTextValuesSha256,'all source text leaf values incl prices/dates/whitespace remain exact');assert.equal(texts.length,record.textFields);assert.equal(images.length,record.imageFields);
 assert.equal(page.sections.length,1,'one locked source body preserves nested source layout');assert.equal(page.page,slug==='/'?'index.html':slug.slice(1)+'index.html');
 textCount+=texts.length;imageCount+=images.length;
}
for(const alias of provenance.aliases)assert.ok(pages[alias.logicalRoute],'captured slash alias must resolve to imported logical route');
assert.ok(!existsSync(new URL('../public/source-pages',import.meta.url))&&!existsSync(new URL('../public/_source',import.meta.url)),'raw source must remain outside public/');
assert.ok(existsSync(new URL('../public/__pilot__/guard.js',import.meta.url)),'existing review guard must be packaged');
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))),lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);assert.deepEqual(pkg.devDependencies,lock.packages[''].devDependencies);
console.log(`PASS ${Object.keys(pages).length} current source pages / ${provenance.capturedHtmlCount} captures: ${textCount} exact text values, ${imageCount} image leaves, full route/hash/canonical coverage, ${patchCount} audited URL/review patches (${disabledCount} disabled scripts), guard-first/CSP/noindex and standalone fixtures; dependency lock aligned.`);
