import type {CommonSubmissionStored} from './submission-core';
import type {ContactStore,ContactStored,ContactRecord,ContactScope} from './contact-core';
function contactScope(scope:ContactScope){if(!scope||![scope.tenantId,scope.siteId].every(value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)))throw new Error('invalid_contact_scope');}
export type ContactAdmin={email:string;userId:string;identityColumn:'auth_user_id'|'cf_access_user_id'|'platform_auth_user_id'};
/** Leads/tombstones/audit use the existing complete settings backup. The only
 * new table is transient abuse counters, recreated empty on recovery. */
export class D1Contacts implements ContactStore{
 db:D1Database;admin?:ContactAdmin;#commonSnapshots=new WeakMap<object,string>();
 constructor(db:D1Database,admin?:ContactAdmin){this.db=db;this.admin=admin;}
 private prefix(scope:ContactScope){contactScope(scope);return `contact:v1:${scope.tenantId}:${scope.siteId}:`;}
 private key(scope:ContactScope,key:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key))throw new Error('invalid_contact_key');return this.prefix(scope)+key;}
 private guard(){
  if(!this.admin)return {sql:'',args:[] as string[]};
  if(!['auth_user_id','cf_access_user_id','platform_auth_user_id'].includes(this.admin.identityColumn))throw new Error('contact_forbidden');
  return {sql:` AND EXISTS(SELECT 1 FROM cms_users WHERE email=? AND ${this.admin.identityColumn}=? AND active=1 AND role='system_admin')`,args:[this.admin.email,this.admin.userId]};
 }
 private parse(value:string,scope:ContactScope,key?:string){const record=JSON.parse(value) as ContactStored;if(![1,2].includes(record.schema)||key&&record.key!==key||record.scope?.tenantId!==scope.tenantId||record.scope?.siteId!==scope.siteId)throw new Error('contact_record_scope');return record;}
 /** Narrow bridge for marker reconciliation/requested erasure only. The
  * strict schema3 writer and parser remain in D1Submissions. No runtime import
  * is added to this legacy standalone adapter. */
 private commonParsed(value:string,scope:ContactScope,key?:string):CommonSubmissionStored{
  const record=JSON.parse(value) as CommonSubmissionStored;
  if(record.schema!==3){const legacy=this.parse(value,scope,key);this.#commonSnapshots.set(legacy,value);return legacy;}
  if(record.scope?.tenantId!==scope.tenantId||record.scope?.siteId!==scope.siteId||key&&record.key!==key||!['rating','quote'].includes(record.workflow)||!Number.isSafeInteger(record.revision)||record.revision<1||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.key))throw new Error('contact_record_scope');
  this.#commonSnapshots.set(record,value);return record;
 }
 async getCommon(scope:ContactScope,key:string){const g=this.guard(),row=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?'+g.sql).bind(this.key(scope,key),...g.args).first<{value:string}>();return row?this.commonParsed(row.value,scope,key):null;}
 async casCommon(previous:CommonSubmissionStored,next:CommonSubmissionStored){
  const raw=this.#commonSnapshots.get(previous);
  if(raw===undefined||JSON.stringify(previous)!==JSON.stringify(JSON.parse(raw))||previous.schema===2||next.schema!==2||previous.key!==next.key||previous.scope.tenantId!==next.scope.tenantId||previous.scope.siteId!==next.scope.siteId||next.revision!==previous.revision+1||Object.keys(next).sort().join(',')!=='actorId,erasedAt,key,reason,revision,schema,scope'||!['expired','requested'].includes(next.reason)||!Number.isFinite(Date.parse(next.erasedAt))||new Date(next.erasedAt).toISOString()!==next.erasedAt||Object.keys(next.scope).sort().join(',')!=='siteId,tenantId'||next.actorId!==null&&typeof next.actorId!=='string')throw new Error('contact_cas_scope');
  const g=this.guard(),result=await this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=?'+g.sql).bind(JSON.stringify(next),this.key(previous.scope,previous.key),raw,...g.args).run();if(result.meta.changes===1)this.#commonSnapshots.set(next,JSON.stringify(next));return result.meta.changes===1;
 }
 async scanCommon(scope:ContactScope,after:string|null,limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('contact_scan_limit');const g=this.guard(),prefix=this.prefix(scope),result=await this.db.prepare('SELECT key,value FROM cms_settings WHERE key LIKE ? AND key>?'+g.sql+' ORDER BY key LIMIT ?').bind(prefix+'%',after===null?prefix:this.key(scope,after),...g.args,limit).all<{key:string;value:string}>();return result.results.map(row=>this.commonParsed(row.value,scope,row.key.slice(prefix.length)));}
 async get(scope:ContactScope,key:string){const record=await this.getCommon(scope,key);return record?.schema===3?null:record;}

 async insert(record:ContactRecord){const result=await this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) VALUES(?,?)').bind(this.key(record.scope,record.key),JSON.stringify(record)).run();return result.meta.changes===1;}
 async cas(previous:ContactStored,next:ContactStored){
  if(previous.key!==next.key||previous.scope.tenantId!==next.scope.tenantId||previous.scope.siteId!==next.scope.siteId||next.revision!==previous.revision+1)throw new Error('contact_cas_scope');
  const g=this.guard(),result=await this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=?'+g.sql).bind(JSON.stringify(next),this.key(previous.scope,previous.key),JSON.stringify(previous),...g.args).run();return result.meta.changes===1;
 }
 async expired(scope:ContactScope,at:string,legacyCutoff:string,limit:number){
  const g=this.guard(),result=await this.db.prepare(`SELECT value FROM cms_settings WHERE key LIKE ? AND json_extract(value,'$.schema')=1
   AND (json_extract(value,'$.retention.expiresAt')<=? OR json_extract(value,'$.createdAt')<=?)`+g.sql+' ORDER BY key LIMIT ?')
   .bind(this.prefix(scope)+'%',at,legacyCutoff,...g.args,limit).all<{value:string}>();
  return result.results.map(row=>this.parse(row.value,scope) as ContactRecord);
 }
 async scan(scope:ContactScope,after:string|null,limit:number){
  const g=this.guard(),prefix=this.prefix(scope),result=await this.db.prepare("SELECT value FROM cms_settings WHERE key LIKE ? AND key>? AND json_extract(value,'$.schema') IN (1,2)"+g.sql+' ORDER BY key LIMIT ?')
   .bind(prefix+'%',after===null?prefix:this.key(scope,after),...g.args,limit).all<{value:string}>();
  return result.results.map(row=>this.parse(row.value,scope));
 }
 async auditRead(record:ContactRecord,at:string){
  if(!this.admin)throw new Error('contact_forbidden');
  const g=this.guard(),key=`contact-audit:v1:${record.scope.tenantId}:${record.scope.siteId}:${crypto.randomUUID()}`;
  const receipt={schema:1,scope:record.scope,action:'read',key:record.key,revision:record.revision,actorId:this.admin.userId,at};
  const result=await this.db.prepare('INSERT INTO cms_settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)'+g.sql)
   .bind(key,JSON.stringify(receipt),this.key(record.scope,record.key),JSON.stringify(record),...g.args).run();
  if(result.meta.changes!==1)throw new Error('contact_access_changed');
 }
 async cleanAudit(scope:ContactScope,cutoff:string){
  contactScope(scope);const g=this.guard();
  await this.db.prepare("DELETE FROM cms_settings WHERE key IN (SELECT key FROM cms_settings WHERE key LIKE ? AND json_extract(value,'$.at')<? LIMIT 100)"+g.sql)
   .bind(`contact-audit:v1:${scope.tenantId}:${scope.siteId}:%`,cutoff,...g.args).run();
 }
}
