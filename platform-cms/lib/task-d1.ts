import type { TaskStore, TaskScope, TaskActor, TaskRecord, TaskCommand, TaskAudit, TaskReceipt } from "./task-core";
/** D1 is a projection/command gateway only. The existing platform SQLite work_items remains authoritative. */
export class D1Tasks implements TaskStore {
 db: D1Database;
 constructor(db: D1Database) { this.db = db; }
 async get(scope: TaskScope, id: string) {
  const row = await this.db.prepare("SELECT record_json FROM cms_task_mirrors WHERE tenant_id=? AND site_id=? AND external_id=?").bind(scope.tenantId,scope.siteId,id).first<{record_json:string}>();
  return row ? JSON.parse(row.record_json) as TaskRecord : null;
 }
 async list(scope: TaskScope, actor: TaskActor) {
  const rows = await this.db.prepare("SELECT record_json FROM cms_task_mirrors WHERE tenant_id=? AND site_id=? AND (?=1 OR assignee_email=?) ORDER BY synced_at DESC, external_id LIMIT 200").bind(scope.tenantId,scope.siteId,Number(actor.isAdmin),actor.email).all<{record_json:string}>();
  return rows.results.map(row=>JSON.parse(row.record_json) as TaskRecord);
 }
 async commands(scope: TaskScope, id?: string) {
  const rows = await this.db.prepare("SELECT command_json,state,result_note FROM cms_task_commands WHERE tenant_id=? AND site_id=? AND ((? IS NULL AND state='pending') OR external_id=?) ORDER BY created_at DESC LIMIT 200").bind(scope.tenantId,scope.siteId,id??null,id??null).all<{command_json:string;state:TaskCommand["state"];result_note:string}>();
  return rows.results.map(row=>({...JSON.parse(row.command_json),state:row.state,resultNote:row.result_note}) as TaskCommand);
 }
 async command(scope: TaskScope, key: string) {
  const row = await this.db.prepare("SELECT command_json,state,result_note FROM cms_task_commands WHERE tenant_id=? AND site_id=? AND command_key=?").bind(scope.tenantId,scope.siteId,key).first<{command_json:string;state:TaskCommand["state"];result_note:string}>();
  return row ? {...JSON.parse(row.command_json),state:row.state,resultNote:row.result_note} as TaskCommand : null;
 }
 async history(scope: TaskScope, id: string) {
  const rows = await this.db.prepare("SELECT audit_json FROM cms_task_audit WHERE tenant_id=? AND site_id=? AND external_id=? ORDER BY revision DESC LIMIT 100").bind(scope.tenantId,scope.siteId,id).all<{audit_json:string}>();
  return rows.results.map(row=>JSON.parse(row.audit_json) as TaskAudit);
 }
 async commit(previous: TaskRecord|null, next: TaskRecord, audit: TaskAudit, command?: TaskCommand, receipts: TaskReceipt[] = []) {
  const token=crypto.randomUUID(),{tenantId,siteId,snapshot}=next,id=snapshot.externalId;
  const values=[JSON.stringify(next),snapshot.assigneeEmail,next.revision,next.syncedAt,token,tenantId,siteId,id];
  const write=previous
   ? this.db.prepare("UPDATE cms_task_mirrors SET record_json=?,assignee_email=?,revision=?,synced_at=?,operation_token=? WHERE tenant_id=? AND site_id=? AND external_id=? AND revision=?").bind(...values,previous.revision)
   : this.db.prepare("INSERT OR IGNORE INTO cms_task_mirrors (record_json,assignee_email,revision,synced_at,operation_token,tenant_id,site_id,external_id) VALUES (?,?,?,?,?,?,?,?)").bind(...values);
  const guard="SELECT tenant_id,site_id,external_id FROM cms_task_mirrors WHERE tenant_id=? AND site_id=? AND external_id=? AND operation_token=?";
  const statements=[write,this.db.prepare(`INSERT INTO cms_task_audit (tenant_id,site_id,external_id,revision,audit_json) SELECT tenant_id,site_id,external_id,?,? FROM (${guard})`).bind(next.revision,JSON.stringify(audit),tenantId,siteId,id,token)];
  if(command)statements.push(this.db.prepare(`INSERT INTO cms_task_commands (tenant_id,site_id,external_id,command_key,command_json,state,result_note,created_at) SELECT tenant_id,site_id,external_id,?,?,'pending','',? FROM (${guard})`).bind(command.key,JSON.stringify(command),command.createdAt,tenantId,siteId,id,token));
  for(const receipt of receipts)statements.push(this.db.prepare(`UPDATE cms_task_commands SET state=?,result_note=? WHERE tenant_id=? AND site_id=? AND external_id=? AND command_key=? AND state='pending' AND EXISTS (${guard})`).bind(receipt.state,receipt.note,tenantId,siteId,id,receipt.key,tenantId,siteId,id,token));
  const result=await this.db.batch(statements);return result[0].meta.changes===1;
 }
}
