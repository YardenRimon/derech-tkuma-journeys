import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url)),bundle=await build({entryPoints:[root+'lib/product-projection.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'es2022',logLevel:'silent'});
const {currentProductBindings,productProjectionPages,managedProductFields,managedPageFields,physicalProductPriceFields,projectPublishedProducts}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const pages=JSON.parse(readFileSync(root+'lib/generated-pages.json','utf8')),seed=JSON.parse(readFileSync(root+'lib/current-collections.json','utf8')).records,records=seed.map(row=>({kind:row.kind,id:row.id,published:structuredClone(row.content),publishedVersion:1}));
const htmlFor=path=>{const page=pages[path];return page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix;};
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function field(html,id){const matches=[...html.matchAll(new RegExp('<([a-zA-Z][\\w:-]*)\\b[^>]*\\bdata-edit-id="'+id+'"[^>]*>([\\s\\S]*?)<\\/\\1>','g'))];assert.equal(matches.length,1,'unique actual source field '+id);return matches[0];}
function amount(html,id){const match=field(html,id),start=match.index+match[0].length,value=/^\s*([\d,.]+)/.exec(html.slice(start));assert.ok(value,'currency field owns adjacent actual numeric price');return {start:start+value[0].indexOf(value[1]),end:start+value[0].length,value:value[1]};}
function anchor(html,id){const matches=[...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].filter(match=>match[0].includes('data-edit-id="'+id+'"'));assert.equal(matches.length,1);return matches[0][0];}
function jsonld(html){return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));}
function ids(html){return [...html.matchAll(/\bdata-(?:edit|image)-id="[^"]*"/g)].map(match=>match[0]);}
const expectedMap={'/product/03-11-26/':'source-product-8249','/product/13-11-26/':'source-product-8251','/product/19-11-26/':'source-product-8253','/product/20-10-26/':'source-product-7681','/product/23-10-2026/':'source-product-7899','/product/27-10-26/':'source-product-7882','/product/27-11-26/':'source-product-8255','/product/30-10-2026/':'source-product-7891','/product/30-11-26/':'source-product-8257'};
assert.deepEqual(productProjectionPages,expectedMap);assert.equal(currentProductBindings.length,54);assert.equal(currentProductBindings.filter(row=>row.main).length,9);assert.equal(currentProductBindings.reduce((sum,row)=>sum+Object.keys(row.fields).length,0),164);assert.ok(currentProductBindings.every(row=>row.productId!=='7969'));assert.deepEqual([...new Set(Object.values(productProjectionPages))].sort(),seed.filter(row=>row.kind==='occurrence').map(row=>row.id).sort());
const changedPrices=records.map(row=>row.kind==='occurrence'?{...row,published:{...row.published,priceMinor:row.published.priceMinor+1234}}:row);
let productOrOfferSchemas=0,hiddenPriceInputs=0,priceMetas=0;
for(const path of Object.keys(pages)){
 const html=htmlFor(path);assert.equal(projectPublishedProducts(html,path,records),html,'published seed byte equality '+path);assert.equal(projectPublishedProducts(html,path,[]),html,'missing rows never fabricate products');
 if(!productProjectionPages[path]){assert.equal(projectPublishedProducts(html,path,changedPrices),html,'non-target / physical page unchanged '+path);continue;}
 const bindings=currentProductBindings.filter(row=>row.page===path),managed=managedProductFields(path),edits=[];
 for(const binding of bindings){const initial=seed.find(row=>row.id===binding.id).content;assert.equal(field(html,binding.fields.title)[2],escape(initial.title));assert.equal(field(html,binding.fields.dateLabel)[2],escape(initial.dateLabel));assert.ok(['₪','&#8362;','&#x20aa;'].includes(field(html,binding.fields.priceMinor)[2]));assert.match(anchor(html,binding.purchaseField),new RegExp('add-to-cart='+binding.productId+'(?:&amp;|&#038;|&)'));assert.equal(Number(amount(html,binding.fields.priceMinor).value.replaceAll(',',''))*100,initial.priceMinor);
  for(const [key,id]of Object.entries(binding.fields)){assert.equal(managed[id].kind,'occurrence');assert.equal(managed[id].id,binding.id);assert.equal(managed[id].field,key);if(key==='note')assert.equal(field(html,id)[2],escape(initial.note));}
  const numeric=amount(html,binding.fields.priceMinor);edits.push({...numeric,value:((initial.priceMinor+1234)/100).toFixed(2)});
 }
 let expected=html;for(const edit of edits.sort((a,b)=>b.start-a.start))expected=expected.slice(0,edit.start)+edit.value+expected.slice(edit.end);const projected=projectPublishedProducts(html,path,changedPrices);assert.equal(projected,expected,'only all represented numeric prices change; header/footer/logo/physical card/source fields remain byte-identical');assert.deepEqual(ids(projected),ids(html));assert.equal(projectPublishedProducts(projected,path,changedPrices),projected,'price overlay idempotent');
 const walk=value=>{if(!value||typeof value!=='object')return;if(['Product','Offer','AggregateOffer'].includes(value['@type']))productOrOfferSchemas++;for(const child of Object.values(value))if(Array.isArray(child))child.forEach(walk);else walk(child);};jsonld(html).forEach(walk);hiddenPriceInputs+=[...html.matchAll(/<input\b[^>]*name="[^"]*price[^\"]*"/gi)].length;priceMetas+=[...html.matchAll(/<meta\b[^>]*(?:property|itemprop|name)="[^"]*price[^\"]*"/gi)].length;
 const main=bindings.find(row=>row.main),target=records.find(row=>row.id===main.id),unsafe='</script><img src=x onerror="alert(1)"> & "';
 const hostile=records.map(row=>row.id===main.id?{...row,published:{...row.published,title:unsafe,dateLabel:unsafe,note:unsafe}}:row),safe=projectPublishedProducts(html,path,hostile);assert.equal(field(safe,main.fields.title)[2],escape(unsafe));assert.equal(field(safe,main.fields.dateLabel)[2],escape(unsafe));assert.ok(!safe.includes('<img src=x onerror='));assert.equal([...safe.matchAll(/<script\b/g)].length,[...html.matchAll(/<script\b/g)].length);assert.equal([...safe.matchAll(/<\/script>/g)].length,[...html.matchAll(/<\/script>/g)].length);assert.deepEqual(ids(safe),ids(html));
 const graph=jsonld(safe).flatMap(value=>value['@graph']??[]),pageSchema=graph.find(row=>row['@type']==='WebPage'&&row.url==='https://derech-tkuma.com'+path),crumb=graph.find(row=>row['@type']==='BreadcrumbList'&&row['@id']==='https://derech-tkuma.com'+path+'#breadcrumb');assert.ok(pageSchema.name.startsWith(unsafe+' - '));assert.equal(crumb.itemListElement.at(-1).name,unsafe);assert.equal(pageSchema.url,'https://derech-tkuma.com'+path,'a date edit does not invent a new source route');assert.equal(projectPublishedProducts(safe,path,hostile),safe);
 const draft={...target,publishedVersion:0,published:{...target.published,priceMinor:1}};Object.defineProperty(draft,'draft',{get(){throw new Error('draft read');}});assert.equal(projectPublishedProducts(html,path,[draft]),html);const publishedWithPrivateDraft={...target};Object.defineProperty(publishedWithPrivateDraft,'draft',{get(){throw new Error('draft read');}});assert.equal(projectPublishedProducts(html,path,[publishedWithPrivateDraft]),html);
 assert.equal(projectPublishedProducts(html,path,[{...target,id:'unrelated-source-product'}]),html);
 const withdrawn=projectPublishedProducts(html,path,records.map(row=>row.id===main.id?{...row,published:null,publishedVersion:2}:row)),purchase=anchor(withdrawn,main.purchaseField);assert.ok(!/\bhref\s*=|add-to-cart=|data-product[_-]id=/.test(purchase),'cart client cannot find a live source href after withdrawal');assert.match(purchase,/aria-disabled="true"/);assert.match(purchase,/\binert\b/);assert.match(purchase,/המועד אינו זמין כרגע/);assert.deepEqual(ids(withdrawn),ids(html));assert.equal(projectPublishedProducts(withdrawn,path,records.map(row=>row.id===main.id?{...row,published:null,publishedVersion:2}:row)),withdrawn);
}
assert.equal(productOrOfferSchemas,0,'all nine actual source pages retain WebPage/Breadcrumb schema; no additional Product/Offer price authority exists');assert.equal(hiddenPriceInputs,0,'no hidden actual price authority');assert.equal(priceMetas,0,'no retained price meta authority');
const path='/product/03-11-26/',html=htmlFor(path),related=currentProductBindings.find(row=>row.page===path&&!row.main),withdrawnRelated=projectPublishedProducts(html,path,records.map(row=>row.id===related.id?{...row,published:null,publishedVersion:2}:row));assert.match(anchor(withdrawnRelated,related.purchaseField),/aria-disabled="true"/);const main=currentProductBindings.find(row=>row.page===path&&row.main);assert.equal(anchor(withdrawnRelated,main.purchaseField),anchor(html,main.purchaseField));
for(const time of ['מתחיל בשעה 9:00','צהריים בשעה 13:30','מתחיל בשעה 10:00'])for(const page of Object.keys(productProjectionPages)){const input=htmlFor(page);if(input.includes(time))assert.ok(projectPublishedProducts(input,page,changedPrices).includes(time),'captured times outside existing seed fields stay unchanged');}
const tourWithdrawn=projectPublishedProducts(html,path,records.map(row=>row.kind==='tour'&&row.id==='open-tour'?{...row,published:null,publishedVersion:2}:row));for(const binding of currentProductBindings.filter(row=>row.page===path))assert.match(anchor(tourWithdrawn,binding.purchaseField),/aria-disabled="true"/);assert.equal(projectPublishedProducts(htmlFor('/product/אבן-התקומה/'),'/product/אבן-התקומה/',changedPrices),htmlFor('/product/אבן-התקומה/'));
// Verify every physical price leaf against its exact captured product scope,
// independently of the ownership map. Editorial text remains ordinary content.
const expectedPhysical={
 '/product/אבן-התקומה/':'text-64',
 '/product/03-11-26/':'text-89','/product/13-11-26/':'text-89','/product/19-11-26/':'text-89',
 '/product/20-10-26/':'text-94','/product/23-10-2026/':'text-93','/product/27-10-26/':'text-94',
 '/product/27-11-26/':'text-89','/product/30-10-2026/':'text-93','/product/30-11-26/':'text-89',
};
assert(Object.isFrozen(physicalProductPriceFields));assert(physicalProductPriceFields.every(Object.isFrozen));
assert.deepEqual(Object.fromEntries(physicalProductPriceFields.map(row=>[row.page,row.fieldId])),expectedPhysical);
let physicalScopes=0;
for(const [path,page]of Object.entries(pages)){
 const html=htmlFor(path),loopStarts=[...html.matchAll(/<div\b[^>]*data-elementor-type="loop-item"[^>]*>/g)],scopes=[];
 for(let i=0;i<loopStarts.length;i++)if(/\be-loop-item-7969\b/.test(loopStarts[i][0]))scopes.push(html.slice(loopStarts[i].index,loopStarts[i+1]?.index??html.length));
 if(path==='/product/אבן-התקומה/')scopes.push(html.slice(html.indexOf('elementor-element-d238136'),loopStarts[0]?.index??html.length));
 const priceLeaves=scopes.flatMap(scope=>{
  assert(scope.includes('add-to-cart=7969'),'physical source purchase identity proves scope');
  return [...scope.matchAll(/<span\b[^>]*class="woocommerce-Price-currencySymbol"[^>]*data-edit-id="([^"]+)"[^>]*>([^<]+)<\/span>\s*([0-9,.]+)/g)];
 });
 assert.equal(priceLeaves.length,expectedPhysical[path]?1:0,'all source physical price scopes accounted for '+path);
 for(const match of priceLeaves){
  physicalScopes++;assert.equal(match[1],expectedPhysical[path]);assert.equal(match[2],'&#8362;');
  assert.equal(amount(html,match[1]).value,match[3],'numeric source price has no independent editable leaf');
  assert.equal(page.fields[match[1]].value,'₪');
  const descriptor={kind:'catalog',id:'source-product-7969',field:'currency',label:'מטבע מחיר אבן התקומה',readOnly:true};
  assert.deepEqual(managedProductFields(path)[match[1]],descriptor);assert.deepEqual(managedPageFields(path)[match[1]],descriptor);
 }
 assert.equal(Object.values(managedProductFields(path)).filter(row=>row.kind==='catalog').length,priceLeaves.length);
 // Ownership only: source bytes and all event price/title/date projections keep
 // their existing behavior; no catalog value is invented from an occurrence.
 assert.equal(projectPublishedProducts(html,path,records),html);
}
assert.equal(physicalScopes,10);
const stone='/product/אבן-התקומה/';assert.deepEqual(Object.keys(managedProductFields(stone)),['text-64']);
for(const id of ['text-62','text-63','text-65','text-66']){assert(pages[stone].fields[id]);assert.equal(managedProductFields(stone)[id],undefined);assert.equal(managedPageFields(stone)[id],undefined,'stone editorial field stays page-editable '+id);}
for(const binding of currentProductBindings){assert.equal(managedProductFields(binding.page)[binding.fields.priceMinor].kind,'occurrence','existing event price ownership unchanged');}
console.log('PASS pure product projection: all51 seed documents byte-identical; verified main9 +45 related event scopes/164 field IDs; all source prices track published occurrences; no retained Product/Offer/hidden/meta price authority; escaped title/date/note and safe source metadata; drafts/unrelated rows ignored; source href disabled on withdrawals; physical page/card and captured times preserved; exact10 physical currency leaves catalog-controlled/read-only while editorial fields stay editable, with no catalog price projection. No DB/provider/network IO.');
