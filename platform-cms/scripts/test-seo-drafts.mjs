import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';
import {Collections} from '../lib/collection-core.ts';
let source=readFileSync(new URL('../lib/seo-draft-core.ts',import.meta.url),'utf8');
for(const name of ['collection-core','collection-d1'])source=source.replaceAll("'./"+name+"'",JSON.stringify(new URL('../lib/'+name+'.ts',import.meta.url).href));
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText;
const seoModule='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
const {SeoDraftStore,seoHash,seoValues,seoIdentity,seoEffectOf,SEO_ORIGIN}=await import(seoModule);
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
let race;
const db={prepare(sql){const stmt=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return stmt.get(...this.args)??null;},async all(){return{results:stmt.all(...this.args)};},async run(){const {changes}=stmt.run(...this.args);return{meta:{changes:Number(changes)}};}};},async batch(statements){if(race){const run=race;race=null;await run();}sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const scope={tenantId:'derech',siteId:'derech-main'},store=new SeoDraftStore(db),cms=new Collections(store),actor={id:'owner',canPublish:true};
const seed=JSON.parse(readFileSync(new URL('../lib/current-collections.json',import.meta.url),'utf8'));
for(const row of seed.records){await cms.change(scope,actor,row.kind,row.id,{operation:'save',expectedRevision:0,content:row.content});await cms.change(scope,actor,row.kind,row.id,{operation:'publish',expectedRevision:1});}
const projection={tours:{records:await store.published(scope,'tour')},occurrences:{records:await store.published(scope,'occurrence')}};
const readbacks=await Promise.all(projection.tours.records.map(row=>store.readback(scope,row.id)));
const python=(name,value)=>{const script=`import sys,json;sys.path.insert(0,sys.argv[1]);from execution import ${name};v=json.load(sys.stdin);print(json.dumps(${name}(*v),ensure_ascii=False))`;const result=spawnSync('python3',['-B','-c',script,new URL('../../production/seo',import.meta.url).pathname],{input:JSON.stringify(value),encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
const plan=python('prepare',[projection,readbacks]);assert.equal(plan.effects.length,4);assert.equal(plan.no_publish,true);
for(const effect of plan.effects){assert.deepEqual(await seoEffectOf(effect),effect);assert.deepEqual(effect.values,seoValues(effect.source));assert.equal(effect.effectKey,await seoHash(seoIdentity(effect)));}
const snapshot=()=>({records:sqlite.prepare('SELECT * FROM cms_records ORDER BY tenant_id,site_id,kind,id').all(),history:sqlite.prepare('SELECT * FROM cms_record_history ORDER BY tenant_id,site_id,kind,id,version').all()});
const baseline=snapshot(),effect=plan.effects[0];
const receipt=await store.applySeo(scope,effect),readback=await store.readback(scope,effect.target);
assert.equal(receipt.state,'applied_draft');assert.equal(receipt.revision,1);assert.deepEqual(readback.draft,receipt.after);assert.equal(readback.history.length,1);
assert.deepEqual(python('verify_readback',[effect,readback]),{effectKey:effect.effectKey,state:'verified_private_draft',revision:1,source_unchanged:true,no_publish:true});
assert.deepEqual(await store.applySeo(scope,effect),receipt);assert.equal((await store.historyDrafts(scope,effect.target)).length,1);
assert.equal(python('prepare',[projection,await Promise.all(projection.tours.records.map(row=>store.readback(scope,row.id)))]).effects.length,3);
assert.deepEqual(snapshot(),baseline,'private proposals must not touch content records, publication or content history');
for(const patch of [{itemId:10},{origin:'https://derech-tkuma.com'},{publicationAllowed:true},{kind:'publish'},{values:{...effect.values,seo_title:'fabricated'}},{target:'other'},{effectKey:'f'.repeat(64)},{operation:'publish'}])await assert.rejects(seoEffectOf({...effect,...patch}),e=>[400,403].includes(e.status));
await assert.rejects(store.applySeo({...scope,siteId:'other'},effect),e=>e.status===403);assert.equal(await store.draft({...scope,siteId:'other'},effect.target),null);assert.equal(await store.receipt({...scope,siteId:'other'},effect.effectKey),null);assert.equal((await store.listDrafts({...scope,siteId:'derech_main'})).length,0);assert.equal((await store.historyDrafts({...scope,siteId:'derech_main'},effect.target)).length,0);
const rolled=await store.rollbackSeo(scope,effect.effectKey,1,'owner');assert.equal(rolled.state,'rolled_back');assert.equal(rolled.rollbackRevision,2);assert.equal((await store.draft(scope,effect.target)).state,'withdrawn');assert.equal((await store.draft(scope,effect.target)).values,null);assert.equal((await store.historyDrafts(scope,effect.target)).length,2);assert.equal((await store.applySeo(scope,effect)).state,'rolled_back','source-key tombstone forbids silent reapplication');assert.deepEqual(snapshot(),baseline);
const second=plan.effects[1];await assert.rejects(store.applySeo(scope,{...second,expectedRecordRevision:second.expectedRecordRevision+1}),e=>e.status===409);assert.equal(await store.draft(scope,second.target),null);
// Simulate an editor changing the source after validation but before SQL CAS.
race=()=>cms.change(scope,actor,'tour',second.target,{operation:'save',expectedRevision:2,content:{...second.source.content,imageAlt:'new editor'}});
await assert.rejects(store.applySeo(scope,second),e=>e.status===409);assert.equal(await store.draft(scope,second.target),null);assert.equal(await store.receipt(scope,second.effectKey),null);assert.equal((await store.historyDrafts(scope,second.target)).length,0);
const third=plan.effects[2];await store.applySeo(scope,third);
await cms.change(scope,actor,'tour',third.target,{operation:'save',expectedRevision:2,content:{...third.source.content,description:'Published revision two'}});await cms.change(scope,actor,'tour',third.target,{operation:'publish',expectedRevision:3});
const nextSource=(await store.readback(scope,third.target)).source;const next={...third,source:nextSource,values:seoValues(nextSource),expectedRecordRevision:4,expectedDraftRevision:1};next.effectKey=await seoHash(seoIdentity(next));
await store.applySeo(scope,next);await assert.rejects(store.rollbackSeo(scope,third.effectKey,1,'owner'),e=>e.status===409,'later private proposal blocks old rollback');
await store.rollbackSeo(scope,next.effectKey,2,'owner');assert.deepEqual((await store.draft(scope,next.target)).values,third.values,'rollback restores exact prior proposal');assert.deepEqual(await store.published(scope,'occurrence'),projection.occurrences.records);
// Missing published source, forged source values and double-encoded routing fail.
const fourth=plan.effects[3];await assert.rejects(store.applySeo(scope,{...fourth,expectedDraftRevision:9}),e=>e.status===409);
const forged={...fourth,source:{...fourth.source,version:99}};forged.effectKey=await seoHash(seoIdentity(forged));await assert.rejects(store.applySeo(scope,forged),e=>e.status===409);
assert.throws(()=>seoValues({id:'x',version:1,content:{...fourth.source.content,title:'<b>unsupported</b>'}}),e=>e.status===403);
assert.throws(()=>seoValues({id:'x',version:1,content:{...fourth.source.content,sourcePath:'/a%252fb'}}),e=>e.status===403);
// A history constraint error must undo the draft and receipt together.
const badKey='cms_seo_history:derech:derech-main:'+fourth.target+':000000000001';sqlite.prepare('INSERT INTO cms_settings(key,value) VALUES(?,?)').run(badKey,'{}');await assert.rejects(store.applySeo(scope,fourth));assert.equal(await store.draft(scope,fourth.target),null);assert.equal(await store.receipt(scope,fourth.effectKey),null);
console.log('PASS task29 SEO actual SQLite + Python adapter:4 current-source draft groups, matching cross-language hashes, CAS/source race, atomic rollback on SQL failure, immutable content/publication, scoped readback/history, replay and tombstones, rollback/newer-edit conflict, task/origin/recipe/publication denial');

// Exercise the actual existing gateway handler. Only the provider/auth boundary is a local fixture;
// signature validation, packet checks, request lock, store, report parser and SQL are real.
sqlite.prepare('DELETE FROM cms_settings WHERE key=?').run(badKey);
const fixtureKey='__derechSeoRouteFixture',fixture={db,scope,secret:'local-seo-fixture-only-'+'.'.repeat(48),authorized:true};globalThis[fixtureKey]=fixture;
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const fixtureRef='globalThis.'+fixtureKey;
const accessModule=moduleUrl(`export class CmsError extends Error {constructor(status,message){super(message);this.status=status;}};export async function authorizeCmsUser(){if(!${fixtureRef}.authorized)throw new CmsError(401,'denied');return {userId:'owner',email:'owner@fixture.invalid',role:'owner'};}export async function assertIsolatedD1Scope(){};`);
const cmsModule=moduleUrl(`import {CmsError} from ${JSON.stringify(accessModule)};export function getD1(){return ${fixtureRef}.db;}export function jsonError(e){return Response.json({error:e.message},{status:e.status??500});}export function requireSameOrigin(request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new CmsError(403,'origin denied');}`);
let legacySource=readFileSync(new URL('../lib/execution-core.ts',import.meta.url),'utf8');for(const name of ['collection-core','collection-d1'])legacySource=legacySource.replaceAll("'./"+name+"'",JSON.stringify(new URL('../lib/'+name+'.ts',import.meta.url).href));
const legacyModule=moduleUrl(ts.transpileModule(legacySource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText);
const maintenanceBundle=await build({stdin:{contents:"export * from './lib/contact-maintenance';export * from './lib/contact-core';export * from './lib/contact-execution';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const maintenanceModule=moduleUrl(maintenanceBundle.outputFiles[0].text);
let routeSource=readFileSync(new URL('../app/api/execution/route.ts',import.meta.url),'utf8');
const routes={'cloudflare:workers':moduleUrl(`export const env={get CMS_EXECUTION_SECRET(){return ${fixtureRef}.secret;},get CONTACT_RETENTION_DAYS(){return ${fixtureRef}.retention;}};`),'@/lib/access':accessModule,'@/lib/cms':cmsModule,'@/lib/site-scope':moduleUrl(`export function siteScope(){return ${fixtureRef}.scope;}`),'@/lib/execution-core':legacyModule,'@/lib/seo-draft-core':seoModule,'@/lib/contact-maintenance':maintenanceModule,'@/lib/contact-execution':maintenanceModule,'@/lib/contact-core':maintenanceModule};
for(const name of ['collection-core','task-d1','task-core','report-core'])routes['@/lib/'+name]=new URL('../lib/'+name+'.ts',import.meta.url).href;
for(const [name,url] of Object.entries(routes))routeSource=routeSource.replaceAll("'"+name+"'",JSON.stringify(url));
routeSource=routeSource.replace("import seed from '@/lib/current-collections.json';",'const seed='+JSON.stringify(seed)+';');
const gateway=await import(moduleUrl(ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText));
const origin='https://local-fixture.invalid';
const packet={schemaVersion:1,tasks:[],effects:[fourth],report:{schemaVersion:1,...scope,sourceAt:new Date().toISOString(),jobs:[]}};
function signed(value,valid=true){const raw=JSON.stringify(value),time=String(Math.floor(Date.now()/1000));return new Request(origin+'/api/execution',{method:'POST',body:raw,headers:{'content-type':'application/json','x-bridge-time':time,'x-bridge-signature':valid?createHmac('sha256',fixture.secret).update(time+'\n'+raw).digest('hex'):'0'.repeat(64)}});}
const beforeGateway=snapshot();let response=await gateway.POST(signed(packet,false));assert.equal(response.status,401);assert.equal(await store.draft(scope,fourth.target),null);
fixture.retention='30';response=await gateway.POST(signed(packet));assert.equal(response.status,503,'unavailable privacy authority fails inside the signed execution lock');assert.equal(await store.draft(scope,fourth.target),null);fixture.retention=undefined;
response=await gateway.POST(signed(packet));assert.equal(response.status,200);assert.equal((await response.json()).receipts[0].state,'applied_draft');assert.deepEqual(snapshot(),beforeGateway);
response=await gateway.POST(signed(packet));assert.equal(response.status,200);assert.equal((await store.historyDrafts(scope,fourth.target)).length,1);
response=await gateway.GET(new Request(origin+'/api/execution?seoTourId='+fourth.target));assert.equal(response.status,200);const routeReadback=await response.json();assert.equal(python('verify_readback',[fourth,routeReadback]).state,'verified_private_draft');
response=await gateway.GET(new Request(origin+'/api/execution?effectKey='+fourth.effectKey));assert.equal((await response.json()).receipt.kind,'seo_draft');
fixture.authorized=false;assert.equal((await gateway.GET(new Request(origin+'/api/execution?seoTourId='+fourth.target))).status,401);fixture.authorized=true;
const rollback=(originHeader)=>new Request(origin+'/api/execution',{method:'POST',headers:{'content-type':'application/json',origin:originHeader},body:JSON.stringify({operation:'rollback',effectKey:fourth.effectKey,expectedRevision:1})});
assert.equal((await gateway.POST(rollback('https://other.invalid'))).status,403);response=await gateway.POST(rollback(origin));assert.equal(response.status,200);assert.equal((await response.json()).receipt.state,'rolled_back');
response=await gateway.POST(signed(packet));assert.equal((await response.json()).receipts[0].state,'rolled_back');assert.deepEqual(snapshot(),beforeGateway);
console.log('PASS existing gateway route: actual HMAC denial/acceptance, scoped admin readback, replay, same-origin owner rollback and tombstone; public collection bytes unchanged');
delete globalThis[fixtureKey];
