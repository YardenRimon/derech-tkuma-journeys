// Exercise the actual CMS request handler and SQL on an isolated SQLite DB.
// Identity and HTML rendering are synthetic; no provider or live CMS is used.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(new URL('../app/api/cms/[...action]/route.ts', import.meta.url),'utf8');
const stub = `
import {fitStoredDraft,parseStoredDraft} from './lib/draft-compatibility.ts';
export class CmsError extends Error { constructor(status,message){super(message);this.status=status;} }
const fixture=()=>globalThis.__cmsCompatibilityFixture;
export const asRevision=value=>{if(!Number.isSafeInteger(value)||value<0)throw new CmsError(400,'revision');return value;};
export const normalizeSlug=value=>value==='/'?'/':value.replace(/\\/+$/,'')+'/';
export const getBasePage=()=>fixture().base;
export const getD1=()=>fixture().db;
export const getBucket=()=>({head:async()=>true});
export const listPages=()=>[{slug:'/',title:'Synthetic'}];
export const emptyDraft=base=>({fields:{},order:base.sections.map(s=>s.id)});
export const compatibleStoredDraft=(base,raw)=>{try{return fitStoredDraft(base,parseStoredDraft(raw));}catch{throw new CmsError(409,'damaged');}};
export const requireSameOrigin=request=>{if(request.headers.get('origin')!==new URL(request.url).origin)throw new CmsError(403,'origin');};
export const getPageRow=async slug=>fixture().db.prepare('SELECT * FROM cms_pages WHERE slug = ?').bind(slug).first();
export const validateDraft=async(base,draft)=>{if(Object.keys(draft.fields).some(id=>!Object.hasOwn(base.fields,id)))throw new CmsError(400,'unknown field');return structuredClone(draft);};
export const renderDocument=async(base,draft)=>JSON.stringify({template:base.title,draft});
export const jsonError=error=>Response.json({error:error.message},{status:error.status||503});
export const authorizeCmsUser=async permission=>{const f=fixture();if(!f.identity)throw new CmsError(401,'anonymous');if(permission==='publish'&&!f.canPublish)throw new CmsError(403,'publisher');return {userId:'synthetic-owner',role:'system_admin',canPublish:f.canPublish};};
export const managedCollectionFields=()=>({});`;
const compiled=await build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'fixture-boundaries',setup(b){
  b.onResolve({filter:/^@\/lib\/(cms|access|collection-projection)$/},()=>({path:'cms-fixture',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'ts',resolveDir:root}));
}}]});
const handler=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE cms_pages(slug TEXT PRIMARY KEY,draft_json TEXT,revision INTEGER,published_html TEXT,published_version INTEGER,updated_by TEXT,updated_at TEXT);
CREATE TABLE cms_versions(slug TEXT,version INTEGER,html TEXT,draft_json TEXT,published_by TEXT,published_at TEXT,PRIMARY KEY(slug,version));`);
const prepare=sql=>{let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};};
globalThis.__cmsCompatibilityFixture={base:{title:'current-template',fields:{'text-1':{type:'text',value:'original'}},sections:[{id:'new'},{id:'body'}]},identity:true,canPublish:true,db:{prepare,async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
const f=globalThis.__cmsCompatibilityFixture;
const row=()=>sqlite.prepare('SELECT * FROM cms_pages WHERE slug=?').get('/');
const request=async(action,body,expected=200,origin='https://cms.invalid')=>{
  const r=await handler[body?'POST':'GET'](new Request('https://cms.invalid/api/cms/'+action+(body?'':'?slug=/'),body?{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}:{}));
  const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;
};
const old={fields:{'text-1':{value:'published'},'text-removed':{value:'recover me',english:'Recover',alt:'original alt'}},order:['body','retired']};
sqlite.prepare('INSERT INTO cms_pages VALUES(?,?,?,?,?,?,?)').run('/',JSON.stringify(old),4,'old-public-html',1,'actor','then');
sqlite.prepare('INSERT INTO cms_versions VALUES(?,?,?,?,?,?)').run('/',1,'old-public-html',JSON.stringify(old),'actor','then');
let p=await request('page');assert.equal(p.stale[0].value,'recover me');assert.equal(p.stale[0].english,'Recover');assert.deepEqual(p.draft.order,['new','body']);assert.equal(row().draft_json,JSON.stringify(old),'GET must never erase stale data');
await request('publish',{slug:'/',revision:4},409);assert.equal(row().published_version,1);
await request('save',{slug:'/',revision:4,draft:old,discardStale:true},409,'https://cms.invalid');
await request('save',{slug:'/',revision:4,draft:p.draft},409);assert.equal(row().draft_json,JSON.stringify(old));
await request('save',{slug:'/',revision:3,draft:p.draft,discardStale:true},409);
await request('save',{slug:'/',revision:4,draft:p.draft,discardStale:true});assert.equal(row().revision,5);
await request('publish',{slug:'/',revision:5});assert.equal(row().published_version,2);assert.equal(JSON.parse(row().published_html).template,'current-template');
const clean=JSON.parse(sqlite.prepare('SELECT draft_json FROM cms_versions WHERE version=2').get().draft_json);assert.deepEqual(clean.order,['new','body']);
await request('rollback',{slug:'/',revision:6,version:1});assert.equal(row().published_version,3);assert.equal(row().draft_json,JSON.stringify(old),'historical unmatched fields stay recoverable');assert.equal(JSON.parse(row().published_html).draft.fields['text-removed'],undefined);
f.canPublish=false;await request('rollback',{slug:'/',revision:7,version:0},403);await request('publish',{slug:'/',revision:7},403);f.canPublish=true;
await request('rollback',{slug:'/',revision:7,version:0},403,'https://foreign.invalid');
await request('rollback',{slug:'/',revision:7,version:0});assert.equal(row().published_version,4);assert.deepEqual(JSON.parse(row().draft_json),{fields:{},order:['new','body']});assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cms_versions').get().n,4,'reset adds history');
await request('rollback',{slug:'/',revision:8,version:2});assert.equal(JSON.parse(row().published_html).draft.fields['text-1'].value,'published','pre-reset version remains restorable');
sqlite.prepare('UPDATE cms_pages SET draft_json=?').run('{broken');
await request('page',null,409);await request('publish',{slug:'/',revision:9},409);assert.equal(row().draft_json,'{broken','damaged data is never overwritten implicitly');
f.identity=false;await request('page',null,401);await request('rollback',{slug:'/',revision:9,version:0},401);
sqlite.close();delete globalThis.__cmsCompatibilityFixture;
console.log('PASS actual CMS handler/SQLite: read-only recovery, explicit stale discard, stale/revision/origin/permission guards, fitted publication/history, source reset with restorable history, damaged JSON denial.');
