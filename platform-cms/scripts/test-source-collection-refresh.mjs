import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {Collections,CollectionError} from '../lib/collection-core.ts';
import {D1Collections} from '../lib/collection-d1.ts';
const oldUrl=new URL('../source-pages/previous-collections-20261019.json',import.meta.url),newUrl=new URL('../lib/current-collections.json',import.meta.url),coreUrl=new URL('../lib/collection-core.ts',import.meta.url);
const previous=JSON.parse(readFileSync(oldUrl)),current=JSON.parse(readFileSync(newUrl));
let source=readFileSync(new URL('../lib/source-collection-refresh.ts',import.meta.url),'utf8').replace("'../source-pages/previous-collections-20261019.json'",JSON.stringify(oldUrl.href)).replace("'./current-collections.json'",JSON.stringify(newUrl.href)).replace("'./collection-core'",JSON.stringify(coreUrl.href));
const moduleUrl='data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText).toString('base64');
const {previewSourceCollectionRefresh:preview,applySourceCollectionRefresh:apply,sourceRefreshRequest,sourceCollectionHash}=await import(moduleUrl);
const scope={tenantId:'derech',siteId:'derech-main'},actor={id:'source-reviewer',canPublish:true,role:'system_admin'};
const ack=plan=>({operation:'apply',sourceHash:plan.sourceHash,expectedRevisions:plan.expectedRevisions});
const fail=(promise,status)=>assert.rejects(promise,error=>error instanceof CollectionError&&error.status===status);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const db={prepare(sql){const stmt=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return stmt.get(...this.args)??null;},async all(){return {results:stmt.all(...this.args)};},async run(){const {changes}=stmt.run(...this.args);return {meta:{changes:Number(changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const store=new D1Collections(db),cms=new Collections(store);return {sqlite,db,store,cms};
}
async function seed(f){for(const entry of previous.records){const saved=await f.cms.change(scope,actor,entry.kind,entry.id,{operation:'save',expectedRevision:0,content:entry.content});await f.cms.change(scope,actor,entry.kind,entry.id,{operation:'publish',expectedRevision:saved.revision});}}
const originalEntry=id=>previous.records.find(row=>row.id===id);
const currentEntry=id=>current.records.find(row=>row.id===id);
const auditRows=f=>f.sqlite.prepare('SELECT kind,id,version,snapshot_json FROM cms_record_history ORDER BY kind,id,version').all();
const beforeAudit=f=>new Map(auditRows(f).map(row=>[[row.kind,row.id,row.version].join(':'),row.snapshot_json]));
function preservedHistory(f,prior){for(const row of auditRows(f)){const old=prior.get([row.kind,row.id,row.version].join(':'));if(old)assert.equal(row.snapshot_json,old,'old immutable snapshots must remain byte-exact');}}
{
 const f=fixture();await seed(f);
 const oz=await f.cms.change(scope,actor,'tour','route-oz',{operation:'save',expectedRevision:2,content:{...originalEntry('route-oz').content,description:'טיוטה פרטית של רזיאל'}});
 const retired=await f.cms.change(scope,actor,'occurrence','source-product-7844',{operation:'save',expectedRevision:2,content:{...originalEntry('source-product-7844').content,note:'טיוטה עצמאית במועד שהוסר'}});
 await f.cms.change(scope,actor,'occurrence','source-product-7920',{operation:'delete',expectedRevision:2});
 let points=await f.cms.change(scope,actor,'tour','route-points',{operation:'save',expectedRevision:2,content:{...originalEntry('route-points').content,image:'/media/editor-choice.webp',description:'תיאור שפורסם בניהול'}});
 points=await f.cms.change(scope,actor,'tour','route-points',{operation:'publish',expectedRevision:points.revision});
 const custom=await f.cms.change(scope,actor,'tour','unrelated',{operation:'save',expectedRevision:0,content:{...originalEntry('route-oz').content,slug:'custom'}});
 const prior=beforeAudit(f),plan=await preview(f.store,scope,actor);
 assert.equal(plan.expectedRevisions.length,15);assert.equal(plan.items.filter(item=>item.action==='insert').length,5);assert.equal(plan.items.filter(item=>item.action==='withdraw').length,2);assert.equal(plan.items.filter(item=>item.action==='refresh').length,3);
 assert.deepEqual(plan.items.find(item=>item.id==='route-points').conflicts.map(conflict=>conflict.field),['image']);assert.deepEqual(plan.items.find(item=>item.id==='route-contact').conflicts,[],'namespace-only source aliases never create an approval conflict');
 const result=await apply(f.store,scope,actor,ack(plan));assert.equal(result.complete,true);assert.equal(result.applied.length,10);
 assert.deepEqual((await f.store.get(scope,'tour','route-oz')).draft,oz.draft);
 assert.deepEqual((await f.store.get(scope,'occurrence','source-product-7844')).draft,retired.draft);
 assert.equal((await f.store.get(scope,'occurrence','source-product-7920')).draft,null);
 assert.equal((await f.store.get(scope,'occurrence','source-product-7844')).published,null);
 const publishedPoints=await f.store.get(scope,'tour','route-points');assert.equal(publishedPoints.published.description,points.published.description);assert.equal(publishedPoints.published.image,currentEntry('route-points').content.image);assert.deepEqual(publishedPoints.draft,publishedPoints.published,'draft following its published value follows the source update');assert.equal(publishedPoints.revision,points.revision+1);assert.equal(publishedPoints.publishedVersion,points.publishedVersion+1);
 const audit=(await f.store.history(scope,'tour','route-points'))[0];assert.equal(audit.operation,'source_refresh');assert.equal(audit.sourceRefresh.sourceHash,await sourceCollectionHash());assert.equal(audit.sourceRefresh.conflicts[0].published,'/media/editor-choice.webp');
 assert.deepEqual(await f.store.get(scope,'tour','unrelated'),custom);
 for(const entry of current.records.filter(row=>row.id.startsWith('source-product-82'))){const row=await f.store.get(scope,entry.kind,entry.id);assert.equal(row.revision,1);assert.equal(row.publishedVersion,1);assert.deepEqual(row.draft,entry.content);assert.deepEqual(row.published,entry.content);}
 assert.equal((await f.store.published(scope,'occurrence')).length,9);assert.equal((await f.store.list(scope,'occurrence')).length,11);
 preservedHistory(f,prior);
 const after=beforeAudit(f),rerun=await apply(f.store,scope,actor,ack(await preview(f.store,scope,actor)));assert.equal(rerun.applied.length,0);assert.deepEqual(beforeAudit(f),after,'second refresh appends no history or revisions');
 await fail(apply(f.store,scope,actor,ack(plan)),409);assert.deepEqual(beforeAudit(f),after,'replayed stale acknowledgement never repeats an update');
 await fail(f.cms.change(scope,actor,'tour','route-oz',{operation:'source_refresh',expectedRevision:(await f.store.get(scope,'tour','route-oz')).revision}),400);
 f.sqlite.close();
}
{
 const f=fixture();await seed(f);const plan=await preview(f.store,scope,actor);await f.cms.change(scope,actor,'tour','open-tour',{operation:'save',expectedRevision:2,content:{...originalEntry('open-tour').content,description:'עריכה לאחר תצוגה מקדימה'}});const prior=beforeAudit(f);
 await fail(apply(f.store,scope,actor,ack(plan)),409);assert.deepEqual(beforeAudit(f),prior,'preflight rejects stale plan before any source writes');
 const fresh=await preview(f.store,scope,actor),realCommit=f.store.commit.bind(f.store);let calls=0;
 f.store.commit=async(...args)=>{if(++calls!==2)return realCommit(...args);const previous=args[0],raced={...previous,revision:previous.revision+1,draft:{...previous.draft,description:'טיוטה שנשמרה בזמן העדכון'}};await realCommit(previous,raced,{version:raced.revision,operation:'save',record:raced,actorId:'concurrent-editor',at:'fixture-race'});return realCommit(...args);};
 const partial=await apply(f.store,scope,actor,ack(fresh));assert.equal(partial.complete,false);assert.equal(partial.applied.length,1);
 f.store.commit=realCommit;const retry=await apply(f.store,scope,actor,ack(await preview(f.store,scope,actor)));assert.equal(retry.complete,true);assert.equal(retry.applied.length,9);assert.equal((await f.store.history(scope,'tour',partial.applied[0].id)).filter(row=>row.operation==='source_refresh').length,1);assert.equal((await f.store.get(scope,'tour','open-tour')).draft.description,'עריכה לאחר תצוגה מקדימה');
 assert.equal((await f.store.get(scope,'tour',partial.staleRecord.id)).draft.description,'טיוטה שנשמרה בזמן העדכון');preservedHistory(f,prior);f.sqlite.close();
}
{
 const f=fixture();await seed(f);await f.cms.change(scope,actor,'tour','route-contact',{operation:'delete',expectedRevision:2});await f.cms.change(scope,actor,'tour','route-contact',{operation:'publish',expectedRevision:3});
 const tombstone=await f.store.get(scope,'tour','route-contact'),plan=await preview(f.store,scope,actor);assert.equal(plan.items.find(item=>item.id==='route-contact').action,'preserve_deleted');await apply(f.store,scope,actor,ack(plan));const preserved=await f.store.get(scope,'tour','route-contact');assert.equal(preserved.published,null);assert.deepEqual(preserved.draft,tombstone.draft);assert.equal(preserved.publishedVersion,tombstone.publishedVersion);assert.equal(preserved.revision,tombstone.revision+1);assert.equal(preserved.sourceRefreshHash,await sourceCollectionHash(),'withdrawn record records the transition without resurrection');
 f.sqlite.close();
}
{
 const f=fixture();await seed(f);const old=await f.store.get(scope,'tour','route-contact'),next={...old,published:currentEntry('route-contact').content,publishedVersion:2,revision:3};await f.store.commit(old,next,{version:3,operation:'publish',record:next,actorId:actor.id,at:'fixture'});
 const plan=await preview(f.store,scope,actor);await apply(f.store,scope,actor,ack(plan));const after=await f.store.get(scope,'tour','route-contact');assert.equal(after.revision,4);assert.equal(after.publishedVersion,2,'draft-only catch-up never increments public version');assert.deepEqual(after.draft,next.published);f.sqlite.close();
}
{
 const f=fixture();const plan=await preview(f.store,scope,actor);assert.equal(plan.items.filter(item=>item.action==='insert').length,13);const result=await apply(f.store,scope,actor,ack(plan));assert.equal(result.applied.length,13);
 for(const badScope of [{...scope,tenantId:'other'},{...scope,siteId:'other'}]){await fail(preview(f.store,badScope,actor),403);await fail(apply(f.store,badScope,actor,ack(plan)),403);assert.equal((await f.store.list(badScope,'tour')).length,0);}
 await fail(preview(f.store,scope,{...actor,role:'content_editor'}),403);await fail(preview(f.store,scope,{...actor,canPublish:false}),403);
 const valid=ack(await preview(f.store,scope,actor));await fail(apply(f.store,scope,actor,{...valid,sourceHash:'0'.repeat(64)}),409);
 for(const bad of [{operation:'preview',tenantId:'derech'},{...valid,content:{}},{...valid,expectedRevisions:valid.expectedRevisions.map((row,index)=>index?row:{...row,id:'unrelated'})},{...valid,expectedRevisions:valid.expectedRevisions.slice(1)}])assert.throws(()=>sourceRefreshRequest(bad),CollectionError);
 const wrongStore={...f.store,get:async()=>({...scope,tenantId:'other',kind:'tour',id:'open-tour',revision:1})};await fail(preview(wrongStore,scope,actor),403);f.sqlite.close();
}
{
 const f=fixture();await seed(f);let row=await f.cms.change(scope,actor,'occurrence','source-product-7844',{operation:'save',expectedRevision:2,content:{...originalEntry('source-product-7844').content,dateLabel:'16/10/2026',note:'הערה שפורסמה לאחר צילום המקור'}});row=await f.cms.change(scope,actor,'occurrence','source-product-7844',{operation:'publish',expectedRevision:row.revision});
 const plan=await preview(f.store,scope,actor),item=plan.items.find(item=>item.id===row.id);assert.equal(item.action,'withdraw');assert.deepEqual(item.conflicts.map(conflict=>conflict.field),['note']);await apply(f.store,scope,actor,ack(plan));const after=await f.store.get(scope,'occurrence',row.id);assert.equal(after.published,null);assert.deepEqual(after.draft,row.draft);assert.equal((await f.store.history(scope,'occurrence',row.id))[0].sourceRefresh.conflicts[0].nextSource,null);f.sqlite.close();
}
{
 const f=fixture();await seed(f);await f.cms.change(scope,actor,'tour','route-contact',{operation:'delete',expectedRevision:2});await apply(f.store,scope,actor,ack(await preview(f.store,scope,actor)));const row=await f.store.get(scope,'tour','route-contact');assert.equal(row.draft,null,'independent null draft remains null while published image updates');assert.deepEqual(row.published,currentEntry('route-contact').content);f.sqlite.close();
}
{
 const f=fixture();await seed(f);const plan=await preview(f.store,scope,actor),prior=beforeAudit(f),before=await f.store.get(scope,'tour','route-contact');
 f.sqlite.exec("CREATE TRIGGER synthetic_history_failure BEFORE INSERT ON cms_record_history WHEN json_extract(NEW.snapshot_json,'$.operation')='source_refresh' BEGIN SELECT RAISE(ABORT,'synthetic history failure'); END;");
 await assert.rejects(apply(f.store,scope,actor,ack(plan)),/synthetic history failure/);assert.deepEqual(await f.store.get(scope,'tour','route-contact'),before,'failed audit insert rolls back the record write in the same D1 transaction');assert.deepEqual(beforeAudit(f),prior);f.sqlite.close();
}
{
 const f=fixture();await seed(f);await apply(f.store,scope,actor,ack(await preview(f.store,scope,actor)));
 let row=await f.store.get(scope,'tour','route-points');assert.equal(row.sourceRefreshHash,await sourceCollectionHash());row=await f.cms.change(scope,actor,'tour',row.id,{operation:'save',expectedRevision:row.revision,content:{...row.published,image:'/media/later-owner-choice.webp'}});row=await f.cms.change(scope,actor,'tour',row.id,{operation:'publish',expectedRevision:row.revision});row=await f.cms.change(scope,actor,'tour',row.id,{operation:'save',expectedRevision:row.revision,content:{...row.draft,description:'טיוטה פרטית מאוחרת'}});
 let revived=await f.store.get(scope,'occurrence','source-product-7844');revived=await f.cms.change(scope,actor,'occurrence',revived.id,{operation:'publish',expectedRevision:revived.revision});assert.ok(revived.published);
 const prior=beforeAudit(f),plan=await preview(f.store,scope,actor);assert.equal(plan.items.find(item=>item.id===row.id).action,'already_applied');assert.equal(plan.items.find(item=>item.id===revived.id).action,'already_applied');const result=await apply(f.store,scope,actor,ack(plan));assert.equal(result.applied.length,0);assert.deepEqual(await f.store.get(scope,'tour',row.id),row,'repeating same source snapshot preserves later manual publication and private draft');assert.deepEqual(await f.store.get(scope,'occurrence',revived.id),revived,'repeating same source snapshot preserves manual revival');assert.deepEqual(beforeAudit(f),prior);
 // A marker for another reviewed source does not suppress this transition.
 const previousRow=await f.store.get(scope,'tour','route-contact'),otherMarker={...previousRow,sourceRefreshHash:'0'.repeat(64),revision:previousRow.revision+1};await f.store.commit(previousRow,otherMarker,{version:otherMarker.revision,operation:'save',record:otherMarker,actorId:actor.id,at:'different-source-marker'});const nextPlan=await preview(f.store,scope,actor);assert.equal(nextPlan.items.find(item=>item.id===otherMarker.id).action,'refresh');await apply(f.store,scope,actor,ack(nextPlan));assert.equal((await f.store.get(scope,'tour',otherMarker.id)).sourceRefreshHash,await sourceCollectionHash());f.sqlite.close();
}
// Execute the real route with scoped local adapter and synthetic identity; no HTTP provider is used.
const routeFixture=fixture();await seed(routeFixture);let mode='admin',permissionChecks=[];
globalThis.__sourceRefreshFixture={db:routeFixture.db,scope,authorize:async permission=>{permissionChecks.push(permission);if(mode==='anonymous')throw new CollectionError(401,'יש להתחבר');return {userId:actor.id,role:mode==='editor'?'content_editor':'system_admin',canPublish:mode!=='no-publish'};}};
const dataModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const accessModule=dataModule(`import {CollectionError} from ${JSON.stringify(coreUrl.href)};export const CmsError=CollectionError;export const authorizeCmsUser=p=>globalThis.__sourceRefreshFixture.authorize(p);`);
const cmsText=readFileSync(new URL('../lib/cms.ts',import.meta.url),'utf8'),sameOrigin=cmsText.slice(cmsText.indexOf('export function requireSameOrigin('),cmsText.indexOf('\nexport async function getPageRow('));
const cmsModule=dataModule(`import {CollectionError as CmsError} from ${JSON.stringify(coreUrl.href)};${ts.transpileModule(sameOrigin,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText};export const getD1=()=>globalThis.__sourceRefreshFixture.db;export const jsonError=error=>Response.json({error:error.message},{status:error.status||500,headers:{'cache-control':'no-store'}});`);
let route=readFileSync(new URL('../app/api/collections/source-refresh/route.ts',import.meta.url),'utf8');for(const [from,to] of [["@/lib/access",accessModule],["@/lib/cms",cmsModule],["@/lib/collection-core",coreUrl.href],["@/lib/collection-d1",new URL('../lib/collection-d1.ts',import.meta.url).href],["@/lib/site-scope",dataModule('export const siteScope=()=>globalThis.__sourceRefreshFixture.scope;')],["@/lib/source-collection-refresh",moduleUrl]])route=route.replace(JSON.stringify(from),JSON.stringify(to)).replace("'"+from+"'",JSON.stringify(to));
const {POST}=await import(dataModule(ts.transpileModule(route,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText));
const request=(body,extra={})=>new Request('https://review.example/api/collections/source-refresh'+(extra.query||''),{method:'POST',headers:{origin:'https://review.example','content-type':'application/json',...extra.headers},body:typeof body==='string'?body:JSON.stringify(body)});
assert.equal((await POST(request({operation:'preview'},{headers:{origin:'https://evil.example'}}))).status,403);
for(const state of ['anonymous','editor','no-publish']){mode=state;assert.equal((await POST(request({operation:'preview'}))).status,state==='anonymous'?401:403);}mode='admin';
for(const [input,extra,status] of [['x'.repeat(9000),{},413],[{operation:'preview'},{headers:{'content-length':'9000'}},413],['{',{},400],[{operation:'preview',tenantId:'other'},{},400],[{operation:'preview'},{query:'?siteId=other'},400]])assert.equal((await POST(request(input,extra))).status,status);
const previewResponse=await POST(request({operation:'preview'}));assert.equal(previewResponse.status,200);assert.equal(previewResponse.headers.get('cache-control'),'no-store');const plan=(await previewResponse.json()).plan;assert.equal((await POST(request(ack(plan)))).status,200);assert.equal((await POST(request(ack(plan)))).status,409);assert.ok(permissionChecks.every(permission=>permission==='publish'));
routeFixture.sqlite.close();delete globalThis.__sourceRefreshFixture;
console.log('PASS source refresh: actual SQLite/D1 per-record atomic CAS/history, exact old/new source, independent/null/retired drafts, conflict audit, unrelated and withdrawn rows, 5 new dates, one public-version increment, stale/partial retry/idempotence, fixed scope, system-admin authorization, strict IDs/hash/body and bounded same-origin route.');
