import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const origin='http://127.0.0.1:5174',seed=JSON.parse(readFileSync(new URL('../lib/current-collections.json',import.meta.url)));
const login=await fetch(origin+'/signin-with-chatgpt?return_to=%2Fadmin',{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
async function call(path,body,status=200){const r=await fetch(origin+path,{headers:{cookie,...(body?{origin,'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
// Local emulator only. This suite installs the exact current source as the review baseline.
for(const entry of seed.records){const path='/api/collections/'+entry.kind;const existing=(await call(path)).records.find(x=>x.id===entry.id);let row=(await call(path,{id:entry.id,operation:'save',expectedRevision:existing?.revision??0,content:entry.content})).record;await call(path,{id:entry.id,operation:'publish',expectedRevision:row.revision});}
const first=seed.records.find(x=>x.kind==='occurrence'),path='/api/collections/occurrence';let row=(await call(path+'?id='+first.id)).record;
const baseline=await(await fetch(origin+encodeURI('/סיורים/'))).text();
row=(await call(path,{id:first.id,operation:'save',expectedRevision:row.revision,content:{...first.content,priceMinor:19950,title:'בדיקת טיוטה מקומית'}})).record;
assert.equal(await(await fetch(origin+encodeURI('/סיורים/'))).text(),baseline,'collection draft cannot change public page');
row=(await call(path,{id:first.id,operation:'publish',expectedRevision:row.revision})).record;
const changed=await(await fetch(origin+encodeURI('/סיורים/'))).text();assert.ok(changed.includes('199.50'));assert.ok(changed.includes('בדיקת טיוטה מקומית'));assert.ok(changed.includes('18/10/26'));
row=(await call(path,{id:first.id,operation:'save',expectedRevision:row.revision,content:first.content})).record;
await call(path,{id:first.id,operation:'publish',expectedRevision:row.revision});
assert.equal(await(await fetch(origin+encodeURI('/סיורים/'))).text(),baseline,'restore exact original source projection');
const page=await call('/api/cms/page?slug='+encodeURIComponent('/סיורים/'));const managed=Object.keys(page.managedFields)[0];assert.ok(managed);
await call('/api/cms/save',{slug:page.slug,revision:page.revision,draft:{...page.draft,fields:{...page.draft.fields,[managed]:{value:'page bypass'}}}},400);
const publicTours=await call('/api/public/collections/tour'),publicOccurrences=await call('/api/public/collections/occurrence');assert.equal(publicTours.records.filter(x=>seed.records.some(y=>y.id===x.id)).length,4);assert.equal(publicOccurrences.records.filter(x=>seed.records.some(y=>y.id===x.id)).length,6);
console.log('PASS actual local HTTP: 4 source tours+6 occurrences initialized/published, source dates/prices, draft hidden, actual public card title/price updated and restored, page-editor authority enforced.');
