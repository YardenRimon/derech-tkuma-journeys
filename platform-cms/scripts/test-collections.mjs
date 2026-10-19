import assert from 'node:assert/strict';
import {Collections,CollectionError,validateContent} from '../lib/collection-core.ts';
class MemoryStore{
 records=new Map(); audits=new Map(); conflict=false;
 key(s,k,id){return JSON.stringify([s.tenantId,s.siteId,k,id]);}
 async get(s,k,id){return structuredClone(this.records.get(this.key(s,k,id))??null);}
 async list(s,k){return [...this.records.values()].filter(x=>x.tenantId===s.tenantId&&x.siteId===s.siteId&&x.kind===k).map(x=>structuredClone(x));}
 async published(s,k){return (await this.list(s,k)).filter(x=>x.published).map(x=>({id:x.id,content:x.published,version:x.publishedVersion}));}
 async history(s,k,id){return structuredClone(this.audits.get(this.key(s,k,id))??[]);}
 async commit(previous,next,audit){const key=this.key(next,next.kind,next.id);if(this.conflict||(this.records.get(key)?.revision??0)!==(previous?.revision??0))return false;this.records.set(key,structuredClone(next));this.audits.set(key,[audit,...(this.audits.get(key)??[])]);return true;}
}
const store=new MemoryStore(),cms=new Collections(store),s={tenantId:'tenant-a',siteId:'site-a'},other={tenantId:'tenant-b',siteId:'site-a'},siteB={tenantId:'tenant-a',siteId:'site-b'};
const editor={id:'editor',canPublish:false},publisher={id:'publisher',canPublish:true};
const tour={title:'מסלול בדיקה',slug:'מסלול-בדיקה',description:'תיאור',image:'/example.webp',imageAlt:'צילום'};
const occurrence={tourId:'tour1',startsAt:'2027-01-01T10:00:00+02:00',endsAt:'2027-01-01T12:00:00+02:00',timezone:'Asia/Jerusalem',meetingPoint:'כניסה',priceMinor:10000,currency:'ILS',capacity:20};
const fail=(promise,status)=>assert.rejects(promise,e=>e instanceof CollectionError&&e.status===status);
let row=await cms.change(s,editor,'tour','tour1',{operation:'save',expectedRevision:0,content:tour});
assert.equal(row.revision,1);assert.deepEqual(await store.published(s,'tour'),[]);
assert.equal(await store.get(other,'tour','tour1'),null);assert.equal(await store.get(siteB,'tour','tour1'),null);
await fail(cms.change(s,editor,'tour','tour1',{operation:'publish',expectedRevision:1}),403);
await fail(cms.change(s,editor,'tour','tour1',{operation:'save',expectedRevision:0,content:tour}),409);
row=await cms.change(s,publisher,'tour','tour1',{operation:'publish',expectedRevision:1});assert.equal(row.publishedVersion,1);
row=await cms.change(s,editor,'tour','tour1',{operation:'save',expectedRevision:2,content:{...tour,title:'טיוטה פרטית'}});
assert.equal((await store.published(s,'tour'))[0].content.title,tour.title);
assert.equal((await store.history(s,'tour','tour1')).find(x=>x.version===1).record.draft.title,tour.title);
row=await cms.change(s,editor,'tour','tour1',{operation:'restore',expectedRevision:3,version:1});assert.equal(row.draft.title,tour.title);assert.equal(row.publishedVersion,1);
await fail(cms.change(other,editor,'occurrence','occ1',{operation:'save',expectedRevision:0,content:occurrence}),400);
let occurrenceRow=await cms.change(s,editor,'occurrence','occ1',{operation:'save',expectedRevision:0,content:occurrence});
occurrenceRow=await cms.change(s,publisher,'occurrence','occ1',{operation:'publish',expectedRevision:occurrenceRow.revision});assert.equal(occurrenceRow.publishedVersion,1);
row=await cms.change(s,editor,'tour','tour1',{operation:'delete',expectedRevision:row.revision});assert.equal(row.draft,null);assert.equal((await store.published(s,'tour')).length,1);
row=await cms.change(s,publisher,'tour','tour1',{operation:'publish',expectedRevision:row.revision});assert.equal((await store.published(s,'tour')).length,0);
await fail(cms.change(s,publisher,'occurrence','occ1',{operation:'publish',expectedRevision:occurrenceRow.revision}),400);
assert.throws(()=>validateContent('occurrence',{...occurrence,endsAt:'2027-01-01T08:00:00Z'}),CollectionError);
assert.throws(()=>validateContent('occurrence',{...occurrence,endsAt:'garbage'}),CollectionError);
assert.throws(()=>validateContent('tour',{...tour,image:'//outside.test/x'}),CollectionError);
store.conflict=true;await fail(cms.change(s,editor,'tour','new',{operation:'save',expectedRevision:0,content:tour}),409);
console.log('PASS collections: tenant/site isolation, editor/publisher separation, draft-only changes, CAS conflict, immutable history, restore, delete publication, occurrence linkage and validation');
