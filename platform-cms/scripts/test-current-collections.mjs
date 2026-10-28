import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {validateContent,CollectionError} from '../lib/collection-core.ts';
const {values:options}=parseArgs({options:{collections:{type:'string'},pages:{type:'string'},provenance:{type:'string'}}});
const input=(option,relative)=>option?pathToFileURL(option):new URL(relative,import.meta.url);
const collectionsUrl=input(options.collections,'../lib/current-collections.json'),pagesUrl=input(options.pages,'../lib/generated-pages.json'),provenanceUrl=input(options.provenance,'../source-pages/provenance.json');
// Execute the real projection module through the project's TypeScript compiler; no DOM/provider mock.
const moduleUrl=new URL('../lib/collection-projection.ts',import.meta.url);
let source=readFileSync(moduleUrl,'utf8').replace("'./collection-core'",JSON.stringify(new URL('../lib/collection-core.ts',import.meta.url).href)).replace("'./current-collections.json'",JSON.stringify(collectionsUrl.href));
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText;
const {projectPublishedCollections:project,managedCollectionFields,tourHref}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const data=JSON.parse(readFileSync(collectionsUrl)),pages=JSON.parse(readFileSync(pagesUrl)),provenance=JSON.parse(readFileSync(provenanceUrl));
const html=slug=>pages[slug].shellPrefix+pages[slug].sections.map(x=>x.html).join('')+pages[slug].shellSuffix;
const tours=data.records.filter(x=>x.kind==='tour'),occurrences=data.records.filter(x=>x.kind==='occurrence');assert.equal(tours.length,4);
const legacyExpected=[['7844','2026-10-16','16/10/26',17000],['7920','2026-10-18','18/10/26',17000],['7681','2026-10-20','20/10/26',24900],['7899','2026-10-23','23/10/2026',17000],['7882','2026-10-27','27/10/26',17000],['7891','2026-10-30','30/10/2026',17000]];
const currentExpected=[...legacyExpected.slice(2),['8249','2026-11-03','03/11/26',17000],['8251','2026-11-13','13/11/26',17000],['8253','2026-11-19','19/11/26',17000],['8255','2026-11-27','27/11/26',17000],['8257','2026-11-30','30/11/26',17000]];
let expected;
if(provenance.snapshotId==='wordpress-public-20261028'){
 assert.ok(provenance.capturedAt.startsWith('2026-10-28'));assert.equal(provenance.logicalPageCount,51);assert.equal(Object.keys(pages).length,51);expected=currentExpected;
}else{
 assert.equal(provenance.snapshotId,undefined);assert.equal(provenance.capturedAt,'2026-10-19T17:35:54.172502+00:00');assert.equal(provenance.logicalPageCount,37);assert.equal(Object.keys(pages).length,37);expected=legacyExpected;
}
assert.equal(occurrences.length,expected.length);
assert.deepEqual(occurrences.map(x=>[x.provenance.productId,x.content.date,x.content.dateLabel,x.content.priceMinor]),expected);
assert.ok(!data.records.some(x=>x.id==='source-product-7969'),'physical stone product has no invented dated tour');
for(const tour of tours){
 const titleBinding=data.bindings.find(x=>x.id===tour.id&&x.page===tour.content.sourcePath&&x.field==='title');assert.ok(titleBinding);
 assert.equal(pages[tour.content.sourcePath].fields[titleBinding.fieldId].value,tour.content.title);
 assert.equal(tour.content.description,tour.id==='route-points'?'מסלול תמציתי וממוקד שמביא את הסיפור בשלוש תחנות עוצמתיות':'');
}
// Renumber every editable field in a private fixture to prove selection follows source semantics.
const scratch=mkdtempSync(join(tmpdir(),'derech-collection-bindings-'));
try{
 const shifted=structuredClone(pages),rekey=id=>'semantic-'+id;
 for(const page of Object.values(shifted)){
  page.fields=Object.fromEntries(Object.entries(page.fields).map(([key,value])=>[rekey(key),value]));
  const rewrite=text=>text.replace(/data-edit-id="([^"]+)"/g,(_,id)=>'data-edit-id="'+rekey(id)+'"');
  page.shellPrefix=rewrite(page.shellPrefix);page.shellSuffix=rewrite(page.shellSuffix);for(const section of page.sections)section.html=rewrite(section.html);
 }
 const shiftedFile=join(scratch,'pages.json'),outputFile=join(scratch,'collections.json');writeFileSync(shiftedFile,JSON.stringify(shifted));
 const result=spawnSync('python3',[fileURLToPath(new URL('./prepare-current-collections.py',import.meta.url)),'--pages',shiftedFile,'--provenance',fileURLToPath(provenanceUrl),'--output',outputFile],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
 const regenerated=JSON.parse(readFileSync(outputFile));assert.deepEqual(regenerated.records,data.records);
 assert.deepEqual(regenerated.bindings,data.bindings.map(binding=>({...binding,...(binding.fieldId?.startsWith('text-')?{fieldId:rekey(binding.fieldId),selector:'[data-edit-id="'+rekey(binding.fieldId)+'"]'}:{}),...(binding.currencyFieldId?{currencyFieldId:rekey(binding.currencyFieldId)}:{})})));
}finally{rmSync(scratch,{recursive:true,force:true});}

for(const entry of data.records){validateContent(entry.kind,entry.content);const url=new URL(entry.provenance.sourceUrl);const page=decodeURIComponent(url.pathname);assert.equal(entry.provenance.sourceHash,provenance.pages[page].sourceSha256);}
for(const entry of occurrences){assert.equal(entry.content.startsAt,null);assert.equal(entry.content.endsAt,null);assert.equal(entry.content.capacity,null);assert.equal(entry.content.meetingPoint,'');assert.ok(html('/סיורים/').includes(entry.content.dateLabel));assert.ok(html('/סיורים/').includes(entry.provenance.priceLiteral));}
const one=occurrences[0],another=occurrences[1],published=data.records.map(x=>({kind:x.kind,id:x.id,published:x.content,publishedVersion:1}));
for(const slug of Object.keys(pages)){
 assert.equal(project(html(slug),slug,[]),html(slug),'unseeded default unchanged');
 assert.equal(project(html(slug),slug,published),html(slug),'publishing exact imported values preserves all original DOM bytes');
 assert.equal(project(html(slug),slug,[{kind:one.kind,id:one.id,published:null,publishedVersion:0,draft:{...one.content,dateLabel:'PRIVATE'}}]),html(slug),'draft-only rows never leak');
}
const changed={kind:one.kind,id:one.id,published:{...one.content,title:'<שינוי בטוח>',dateLabel:'תאריך מאושר',priceMinor:19950},publishedVersion:1,draft:{...one.content,title:'PRIVATE DRAFT'}};
const output=project(html('/סיורים/'),'/סיורים/',[changed]);assert.ok(output.includes('&lt;שינוי בטוח&gt;'));assert.ok(output.includes('תאריך מאושר'));assert.ok(output.includes('199.50'));assert.ok(!output.includes('PRIVATE DRAFT'));assert.ok(output.includes(another.content.dateLabel),'another card must remain exact');
const withdrawn=project(html('/סיורים/'),'/סיורים/',[{...changed,published:null,publishedVersion:2}]);assert.ok(!withdrawn.includes('e-loop-item-'+one.provenance.productId));assert.ok(!withdrawn.includes(one.content.dateLabel));assert.ok(withdrawn.includes(another.content.dateLabel));assert.ok(withdrawn.includes('/__pilot__/guard.js'));
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
console.log('PASS source-derived collections: 4 tours/'+occurrences.length+' exact dated prices, source provenance, date-only/null unknowns, strict fields/path/time validation, unchanged source DOM, published-only text/price/image/link overlay, withdrawal and managed authority map.');
