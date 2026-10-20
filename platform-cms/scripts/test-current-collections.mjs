import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {validateContent,CollectionError} from '../lib/collection-core.ts';
// Execute the real projection module through the project's TypeScript compiler; no DOM/provider mock.
const moduleUrl=new URL('../lib/collection-projection.ts',import.meta.url);
let source=readFileSync(moduleUrl,'utf8').replace("'./collection-core'",JSON.stringify(new URL('../lib/collection-core.ts',import.meta.url).href)).replace("'./current-collections.json'",JSON.stringify(new URL('../lib/current-collections.json',import.meta.url).href));
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText;
const {projectPublishedCollections:project,managedCollectionFields,tourHref}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const data=JSON.parse(readFileSync(new URL('../lib/current-collections.json',import.meta.url))),pages=JSON.parse(readFileSync(new URL('../lib/generated-pages.json',import.meta.url))),provenance=JSON.parse(readFileSync(new URL('../source-pages/provenance.json',import.meta.url)));
const html=slug=>pages[slug].shellPrefix+pages[slug].sections.map(x=>x.html).join('')+pages[slug].shellSuffix;
const tours=data.records.filter(x=>x.kind==='tour'),occurrences=data.records.filter(x=>x.kind==='occurrence');assert.equal(tours.length,4);assert.equal(occurrences.length,6);
assert.deepEqual(occurrences.map(x=>[x.content.date,x.content.priceMinor]),[['2026-10-16',17000],['2026-10-18',17000],['2026-10-20',24900],['2026-10-23',17000],['2026-10-27',17000],['2026-10-30',17000]]);
for(const entry of data.records){validateContent(entry.kind,entry.content);const url=new URL(entry.provenance.sourceUrl);const page=decodeURIComponent(url.pathname);assert.equal(entry.provenance.sourceHash,provenance.pages[page].sourceSha256);}
for(const entry of occurrences){assert.equal(entry.content.startsAt,null);assert.equal(entry.content.endsAt,null);assert.equal(entry.content.capacity,null);assert.equal(entry.content.meetingPoint,'');assert.ok(html('/סיורים/').includes(entry.content.dateLabel));assert.ok(html('/סיורים/').includes(entry.provenance.priceLiteral));}
const one=occurrences[0],published=data.records.map(x=>({kind:x.kind,id:x.id,published:x.content,publishedVersion:1}));
for(const slug of Object.keys(pages)){
 assert.equal(project(html(slug),slug,[]),html(slug),'unseeded default unchanged');
 assert.equal(project(html(slug),slug,published),html(slug),'publishing exact imported values preserves all original DOM bytes');
 assert.equal(project(html(slug),slug,[{kind:one.kind,id:one.id,published:null,publishedVersion:0,draft:{...one.content,dateLabel:'PRIVATE'}}]),html(slug),'draft-only rows never leak');
}
const changed={kind:one.kind,id:one.id,published:{...one.content,title:'<שינוי בטוח>',dateLabel:'תאריך מאושר',priceMinor:19950},publishedVersion:1,draft:{...one.content,title:'PRIVATE DRAFT'}};
const output=project(html('/סיורים/'),'/סיורים/',[changed]);assert.ok(output.includes('&lt;שינוי בטוח&gt;'));assert.ok(output.includes('תאריך מאושר'));assert.ok(output.includes('199.50'));assert.ok(!output.includes('PRIVATE DRAFT'));assert.ok(output.includes('18/10/26'),'another card must remain exact');
const withdrawn=project(html('/סיורים/'),'/סיורים/',[{...changed,published:null,publishedVersion:2}]);assert.ok(!withdrawn.includes('e-loop-item-'+one.provenance.productId));assert.ok(!withdrawn.includes(one.content.dateLabel));assert.ok(withdrawn.includes('18/10/26'));assert.ok(withdrawn.includes('/__pilot__/guard.js'));
assert.equal(project(html('/סיורים/'),'/סיורים/',[{...changed,id:'unbound-new-record'}]),html('/סיורים/'),'unbound records do not invent presentation');
const fields=managedCollectionFields('/סיורים/');assert.equal(fields[data.bindings.find(x=>x.id===one.id&&x.field==='dateLabel').fieldId].id,one.id);
const dateOnly={...one.content};assert.deepEqual(validateContent('occurrence',dateOnly),dateOnly);
for(const change of [{startsAt:'2026-10-16T10:00:00+03:00'},{date:'2026-02-30'},{capacity:0},{surprise:'unknown'},{startsAt:'2026-10-16T12:00:00+03:00',endsAt:'2026-10-16T10:00:00+03:00'}])assert.throws(()=>validateContent('occurrence',{...dateOnly,...change}),CollectionError);
assert.throws(()=>validateContent('tour',{...tours[0].content,sourcePath:'//evil.example/'}),CollectionError);assert.throws(()=>validateContent('tour',{...tours[0].content,sourcePath:'/../admin/'}),CollectionError);
assert.equal(tourHref(tours[0].content),'/maslulim/נקודות-החיבור/');
const newPath='/maslulim/מסלול-חדש/';const changedLinks=project(html('/המסלולים/'),'/המסלולים/',[{kind:'tour',id:tours[0].id,published:{...tours[0].content,sourcePath:newPath},publishedVersion:1}]);assert.ok(changedLinks.includes('href="'+newPath+'"'));
const imageTour=tours.find(x=>x.content.image);assert.ok(imageTour);const imageOutput=project(html('/המסלולים/'),'/המסלולים/',[{kind:'tour',id:imageTour.id,published:{...imageTour.content,image:'/media/new.png',imageAlt:'תמונה חדשה'},publishedVersion:1}]);assert.ok(imageOutput.includes('src="/media/new.png"'));assert.ok(imageOutput.includes('alt="תמונה חדשה"'));
assert.ok(imageOutput.includes('background-image:url(&quot;/media/new.png&quot;)'),'published image must update the main source card background too');
const tourCard=data.bindings.find(x=>x.id===imageTour.id&&x.field==='visibility');const tourWithdrawn=project(html('/המסלולים/'),'/המסלולים/',[{kind:'tour',id:imageTour.id,published:null,publishedVersion:1}]);assert.ok(!tourWithdrawn.includes(tourCard.cardClass));assert.ok(tourWithdrawn.includes('מסלול עוז מול תופת'),'withdrawing one route must preserve another route card');
console.log('PASS source-derived collections: 4 tours/6 exact dated prices, source provenance, date-only/null unknowns, strict fields/path/time validation, unchanged source DOM, published-only text/price/image/link overlay, withdrawal and managed authority map.');
