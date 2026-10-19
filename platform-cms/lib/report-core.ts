/** Read-only operational projections. No analytics, execution, or publication authority. */
export type ReportScope = { tenantId: string; siteId: string };
export class ReportError extends Error { status:number; constructor(status: number, message: string) { super(message);this.status=status; } }
export const executionReportKey = 'server_execution_report_v1';
export const executionStates = ['queued','needs_review','failed','executed_private','cms_draft_applied','applied'] as const;
export type ExecutionJob = { id: string; itemId: number; recipe: string; state: typeof executionStates[number]; updatedAt: string; summary?: string; cmsState?: 'applied_draft'|'rolled_back'|'conflict'|'rejected'; cmsRevision?: number };
export type ExecutionMirror = { schemaVersion: 1; tenantId: string; siteId: string; sourceAt: string; jobs: ExecutionJob[] };
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const bounded = (x: unknown, length: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= length;
export function parseExecutionMirror(raw: string | null, scope: ReportScope): ExecutionMirror | null {
 if (!raw || raw.length > 300000) return null;
 try {
  const x = JSON.parse(raw);
  if (x.schemaVersion !== 1 || x.tenantId !== scope.tenantId || x.siteId !== scope.siteId || !timestamp(x.sourceAt) || !Array.isArray(x.jobs) || x.jobs.length > 200) return null;
  const ids = new Set<string>();
  for (const j of x.jobs) {
   if (!bounded(j.id,100) || ids.has(j.id) || !Number.isSafeInteger(j.itemId) || j.itemId < 1 || !bounded(j.recipe,100) || !executionStates.includes(j.state) || !timestamp(j.updatedAt) || (j.summary !== undefined && (typeof j.summary !== 'string' || j.summary.length > 1000))) return null;
   if(j.cmsState!==undefined&&!['applied_draft','rolled_back','conflict','rejected'].includes(j.cmsState))return null;
   if(j.cmsRevision!==undefined&&(!Number.isSafeInteger(j.cmsRevision)||j.cmsRevision<1))return null;
   if(j.cmsState==='applied_draft'&&j.cmsRevision===undefined)return null;
   ids.add(j.id);
  }
  return { schemaVersion:1, tenantId:scope.tenantId, siteId:scope.siteId, sourceAt:x.sourceAt, jobs:x.jobs.map((j: ExecutionJob)=>({id:j.id,itemId:j.itemId,recipe:j.recipe,state:j.state,updatedAt:j.updatedAt,...(j.summary===undefined?{}:{summary:j.summary}),...(j.cmsState===undefined?{}:{cmsState:j.cmsState}),...(j.cmsRevision===undefined?{}:{cmsRevision:j.cmsRevision})})) };
 } catch { return null; }
}
export function freshness(at: string | null, now: string) {
 if (!at || !timestamp(at)) return 'missing' as const;
 const age = Date.parse(now)-Date.parse(at);
 return age < -300000 ? 'invalid' as const : age > 15*60*1000 ? 'stale' as const : 'recent' as const;
}
export async function operationalReport(db: D1Database, scope: ReportScope, isAdmin: boolean, now = new Date().toISOString()) {
 if (!isAdmin) throw new ReportError(403,'דוחות תפעוליים זמינים למנהל בלבד');
 if (!scope.tenantId || !scope.siteId) throw new ReportError(503,'חסר הקשר אתר מורשה');
 const bind = (sql: string) => db.prepare(sql).bind(scope.tenantId,scope.siteId);
 const [taskRows, commands, contentRows, historyRows, taskTotal, contentTotal, sourceRange, mirrorRow, requestRows] = await Promise.all([
  bind('SELECT record_json FROM cms_task_mirrors WHERE tenant_id=? AND site_id=? ORDER BY synced_at DESC,external_id LIMIT 200').all<{record_json:string}>(),
  bind('SELECT state,COUNT(*) AS count FROM cms_task_commands WHERE tenant_id=? AND site_id=? GROUP BY state').all<{state:string;count:number}>(),
  bind('SELECT record_json FROM cms_records WHERE tenant_id=? AND site_id=? ORDER BY updated_at DESC LIMIT 200').all<{record_json:string}>(),
  bind('SELECT kind,id,version,snapshot_json FROM cms_record_history WHERE tenant_id=? AND site_id=? ORDER BY rowid DESC LIMIT 100').all<{kind:string;id:string;version:number;snapshot_json:string}>(),
  bind('SELECT COUNT(*) AS count FROM cms_task_mirrors WHERE tenant_id=? AND site_id=?').first<{count:number}>(),
  bind('SELECT COUNT(*) AS count FROM cms_records WHERE tenant_id=? AND site_id=?').first<{count:number}>(),
  bind('SELECT MIN(synced_at) AS oldest,MAX(synced_at) AS newest FROM cms_task_mirrors WHERE tenant_id=? AND site_id=?').first<{oldest:string|null;newest:string|null}>(),
  db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(executionReportKey).first<{value:string}>(),
  bind('SELECT external_id,command_key,command_json,state,result_note,created_at FROM cms_task_commands WHERE tenant_id=? AND site_id=? ORDER BY created_at DESC LIMIT 200').all<{external_id:string;command_key:string;command_json:string;state:string;result_note:string;created_at:string}>(),
 ]);
 const tasks = taskRows.results.map(row=>{const r=JSON.parse(row.record_json);if(r.tenantId!==scope.tenantId||r.siteId!==scope.siteId)throw new ReportError(503,'הקשר המשימות אינו תואם לאתר');return {id:r.snapshot.externalId,title:r.snapshot.title,status:r.snapshot.status,assigneeLabel:r.snapshot.assigneeLabel,syncedAt:r.syncedAt};});
 const content=contentRows.results.map(row=>{const r=JSON.parse(row.record_json);if(r.tenantId!==scope.tenantId||r.siteId!==scope.siteId)throw new ReportError(503,'הקשר התוכן אינו תואם לאתר');return {id:r.id,kind:r.kind,title:(r.draft??r.published)?.title??r.id,hasDraft:r.draft!==null,hasPublic:r.published!==null,draftDiffers:JSON.stringify(r.draft)!==JSON.stringify(r.published),updatedAt:r.updatedAt};});
 const history=historyRows.results.map(row=>{const r=JSON.parse(row.snapshot_json);if(r.record.tenantId!==scope.tenantId||r.record.siteId!==scope.siteId)throw new ReportError(503,'הקשר ההיסטוריה אינו תואם לאתר');return {id:row.id,kind:row.kind,version:row.version,operation:r.operation,at:r.at};});
 const execution=parseExecutionMirror(mirrorRow?.value??null,scope);
 const requests=requestRows.results.map(row=>({id:row.command_key,itemId:row.external_id,requestedStatus:JSON.parse(row.command_json).requestedStatus??'unknown',state:row.state,resultNote:row.result_note,createdAt:row.created_at}));
 return {generatedAt:now,authority:'scoped-d1-projection',taskSource:{oldestAt:sourceRange?.oldest??null,newestAt:sourceRange?.newest??null,freshness:freshness(sourceRange?.oldest??null,now),note:'זמן קליטת ההיטל, לא זמן בדיקת השרת או שינוי מקור. היטל עדכני אינו מוכיח שהסנכרון מחובר.'},tasks,taskTotal:taskTotal?.count??0,taskRowsTruncated:(taskTotal?.count??0)>tasks.length,commands:commands.results,requests,content,contentTotal:contentTotal?.count??0,contentRowsTruncated:(contentTotal?.count??0)>content.length,history,historyLimit:100,execution,executionFreshness:freshness(execution?.sourceAt??null,now),analyticsAvailable:false};
}
export type OperationalReport = Awaited<ReturnType<typeof operationalReport>>;
export const taskLabels: {[key:string]:string}={open:'פתוחה',in_progress:'בטיפול',waiting_info:'ממתינה למידע',blocked:'חסומה',done:'הושלמה במקור',cancelled:'בוטלה'};
export const jobLabels: {[key:string]:string}={queued:'בתור',needs_review:'נדרשת בדיקה',failed:'נכשל',executed_private:'תוצר פרטי נוצר',cms_draft_applied:'הוחל בטיוטת CMS',applied:'הוחל ביעד לפי דיווח השרת'};
export const dateLabel=(at:string|null)=>at&&timestamp(at)?new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jerusalem'}).format(new Date(at)):'אין נתון';
