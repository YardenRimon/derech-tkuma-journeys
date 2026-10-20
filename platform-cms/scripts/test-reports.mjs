import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {operationalReport,parseExecutionMirror,freshness,ReportError,executionReportKey} from '../lib/report-core.ts';
const sqlite=new DatabaseSync(':memory:');
for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
const db={prepare(sql){const stmt=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return stmt.get(...this.args)??null;},async all(){return{results:stmt.all(...this.args)};}};}};
const scope={tenantId:'derech',siteId:'site-a'},other={tenantId:'other',siteId:'site-b'},now='2026-10-19T18:00:00Z';
const load=()=>operationalReport(db,scope,true,now);
await assert.rejects(operationalReport(db,scope,false,now),e=>e instanceof ReportError&&e.status===403);
let r=await load();assert.equal(r.taskTotal,0);assert.equal(r.execution,null);assert.equal(r.taskSource.freshness,'missing');assert.equal(r.analyticsAvailable,false);
for(const s of [scope,other]){
 const record={...s,revision:1,syncedAt:'2026-10-19T16:00:00Z',snapshot:{externalId:'27',title:s===scope?'מחיר חסר':'tenant-secret',status:'waiting_info',assigneeLabel:'רזיאל'}};
 sqlite.prepare('INSERT INTO cms_task_mirrors VALUES(?,?,?,?,?,?,?,?)').run(s.tenantId,s.siteId,'27',JSON.stringify(record),'person@example.test',1,record.syncedAt,'token');
 const content={...s,id:'tour-a',kind:'tour',draft:{title:'טיוטה'},published:{title:'ישן'},publishedVersion:1,updatedAt:'2026-10-19T17:55:00Z'};
 sqlite.prepare('INSERT INTO cms_records VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenantId,s.siteId,'tour','tour-a',JSON.stringify(content),JSON.stringify(content.published),1,2,content.updatedAt,'token');
 sqlite.prepare('INSERT INTO cms_record_history VALUES(?,?,?,?,?,?)').run(s.tenantId,s.siteId,'tour','tour-a',2,JSON.stringify({operation:'save',at:content.updatedAt,record:content}));
 sqlite.prepare('INSERT INTO cms_task_commands VALUES(?,?,?,?,?,?,?,?)').run(s.tenantId,s.siteId,'27','command-'+s.tenantId,'{}','pending','','2026-10-19T17:59:00Z');
}
r=await load();assert.equal(r.taskTotal,1);assert.equal(r.tasks[0].title,'מחיר חסר');assert.equal(r.commands[0].count,1);assert.equal(r.content.length,1);assert.equal(r.content[0].draftDiffers,true);assert.equal(r.history[0].operation,'save');assert.equal(r.taskSource.freshness,'missing');assert.equal(r.taskSource.oldestAt,'2026-10-19T16:00:00Z');assert(!JSON.stringify(r).includes('tenant-secret'));assert(!JSON.stringify(r).includes('person@example.test'));
const mirror={schemaVersion:1,...scope,sourceAt:'2026-10-19T17:59:00Z',jobs:[{id:'effect-a',itemId:26,recipe:'lead_workflow',state:'executed_private',updatedAt:'2026-10-19T17:58:00Z',summary:'נוצר רישום פרטי'}]};
assert.equal(parseExecutionMirror(JSON.stringify(mirror),scope).jobs[0].state,'executed_private');
const applied={...mirror,jobs:[{...mirror.jobs[0],cmsState:'applied_draft',cmsRevision:2}]};
assert.equal(parseExecutionMirror(JSON.stringify(applied),scope).jobs[0].cmsRevision,2);
assert.equal(parseExecutionMirror(JSON.stringify({...mirror,jobs:[{...mirror.jobs[0],cmsState:'applied_draft'}]}),scope),null);
for(const invalid of [{...mirror,tenantId:'other'},{...mirror,jobs:[{...mirror.jobs[0],state:'published'}]},{...mirror,sourceAt:'not-a-date'},{...mirror,jobs:[mirror.jobs[0],mirror.jobs[0]]}])assert.equal(parseExecutionMirror(JSON.stringify(invalid),scope),null);
sqlite.prepare('INSERT INTO cms_settings(key,value) VALUES(?,?)').run(executionReportKey,JSON.stringify(mirror));r=await load();assert.equal(r.executionFreshness,'recent');assert.equal(r.execution.jobs.length,1);
// An unchanged task's old import time must not create a false sync alarm.
assert.equal(r.taskSource.freshness,'recent');assert.equal(r.taskSource.checkedAt,mirror.sourceAt);assert.equal(r.taskSource.oldestAt,'2026-10-19T16:00:00Z');
const updateMirror=value=>sqlite.prepare('UPDATE cms_settings SET value=? WHERE key=?').run(JSON.stringify(value),executionReportKey);
updateMirror({...mirror,sourceAt:'2026-10-19T16:59:00Z'});
const row=sqlite.prepare('SELECT record_json FROM cms_task_mirrors WHERE tenant_id=? AND site_id=?').get(scope.tenantId,scope.siteId);const record=JSON.parse(row.record_json);record.syncedAt=now;
sqlite.prepare('UPDATE cms_task_mirrors SET synced_at=?,record_json=? WHERE tenant_id=? AND site_id=?').run(now,JSON.stringify(record),scope.tenantId,scope.siteId);
r=await load();assert.equal(r.taskSource.freshness,'stale','a fresh item must not mask an old server report');
updateMirror({...mirror,tenantId:'wrong-tenant'});r=await load();assert.equal(r.taskSource.freshness,'missing');assert.equal(r.taskSource.checkedAt,null);
sqlite.prepare('DELETE FROM cms_settings WHERE key=?').run(executionReportKey);r=await load();assert.equal(r.taskSource.freshness,'missing','manual fresh import does not prove a connected server');
sqlite.prepare('INSERT INTO cms_settings(key,value) VALUES(?,?)').run(executionReportKey,JSON.stringify({...mirror,sourceAt:'2026-10-20T00:00:00Z'}));r=await load();assert.equal(r.taskSource.freshness,'invalid');
updateMirror(mirror);
assert.equal(freshness('2026-10-20T00:00:00Z',now),'invalid');
const api=readFileSync(new URL('../app/api/reports/route.ts',import.meta.url),'utf8');assert(api.includes("authorizeCmsUser('users')"));assert(api.includes('no-store'));assert(!api.includes('export async function POST'));
for(const page of ['dashboard','reports']){const source=readFileSync(new URL(`../app/admin/${page}/page.tsx`,import.meta.url),'utf8');assert(source.includes("authorizeCmsUser('users')"));assert(!source.includes('dangerouslySetInnerHTML'));}
sqlite.close();console.log('Reports: scoped SQLite aggregates, admin gate, empty/stale state, command-vs-effect separation, mirror validation, and read-only routes passed.');
