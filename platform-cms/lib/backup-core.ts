/** Read-only backup of the deployment-isolated pilot. No SQL or scope is caller-selected. */
export class BackupError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
export const backupPurpose='cms-backup-v1';
export const backupMigrations=[{"name":"0000_many_starhawk.sql","sha256":"5632baa062a554bc620b7c9d913677e2da7613674167cfc5aad20eb344bb77f5"},{"name":"0001_wooden_wong.sql","sha256":"c76d87e9abef517f47a29726d80e7ef962a17f5291ba4919b04cecbb1108e291"},{"name":"0002_certain_kulan_gath.sql","sha256":"e1a86b3e2aaa88141d5d6ed9e4de5352673d3ee944cf241398aaf00e0369a6c5"},{"name":"0003_collections.sql","sha256":"8ecb67585ed18309daae45bfead90114bb13bda8e2c8aa9508161dce67826514"},{"name":"0004_isolated_adapter.sql","sha256":"bebc5c0a6ee57f0f4485c6b4ee9aa4b78ae688eff0ef6eece0ef6993516e05f5"},{"name":"0005_yummy_wither.sql","sha256":"ddaeb5ef9f0de1f226da5f10a37f5d3d507bb9087037cbcebbb3e9bd099163ab"}];
export const backupTables=[
 ['cms_deployment_scope','singleton'],['cms_settings','key'],['cms_users','email'],['cms_permission_audit','id'],['cms_pages','slug'],['cms_versions','slug,version'],
 ['cms_records','tenant_id,site_id,kind,id'],['cms_record_history','tenant_id,site_id,kind,id,version'],['cms_task_mirrors','tenant_id,site_id,external_id'],['cms_task_commands','tenant_id,site_id,command_key'],['cms_task_audit','tenant_id,site_id,external_id,revision'],
] as const;
const scoped=new Set(['cms_records','cms_record_history','cms_task_mirrors','cms_task_commands','cms_task_audit']);
export const backupUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as {[k:string]:unknown})[k])).join(',')+'}':JSON.stringify(value);
export async function sha256(value:string|Uint8Array){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function verifyBackupSignature(raw:string,time:string|null,signature:string|null,secret:string|undefined,path:string,now=Date.now()){
 if(!secret||secret.length<40)throw new BackupError(503,'Backup credential is not configured');
 if(path!=='/api/backup/'&&path!=='/api/backup')throw new BackupError(401,'Invalid backup target');
 if(!time||!/^\d{10}$/.test(time)||Math.abs(now-Number(time)*1000)>120000||!signature||!/^[a-f0-9]{64}$/.test(signature))throw new BackupError(401,'Invalid backup signature');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,new Uint8Array(signature.match(/../g)!.map(x=>parseInt(x,16))),new TextEncoder().encode(`${backupPurpose}\nPOST\n${path}\n${time}\n${raw}`)))throw new BackupError(401,'Invalid backup signature');
}
export type BackupScope={tenantId:string;siteId:string};
export function backupRequest(value:unknown,scope:BackupScope):{operation:'snapshot'}|{operation:'object';key:string;etag:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BackupError(400,'Invalid backup request');
 const v=value as {[key:string]:unknown};
 if(v.purpose!==backupPurpose||v.tenantId!==scope.tenantId||v.siteId!==scope.siteId)throw new BackupError(403,'Backup scope does not match');
 const allowed=v.operation==='snapshot'?['operation','purpose','tenantId','siteId']:['operation','purpose','tenantId','siteId','key','etag'];
 if(Object.keys(v).some(k=>!allowed.includes(k)))throw new BackupError(400,'Unsupported backup field');
 if(v.operation==='snapshot')return {operation:'snapshot'};
 if(v.operation!=='object'||typeof v.key!=='string'||!backupUuid.test(v.key)||typeof v.etag!=='string'||!/^[a-fA-F0-9]{32}(?:-\d+)?$/.test(v.etag))throw new BackupError(400,'Invalid backup object');
 return {operation:'object',key:v.key,etag:v.etag};
}
export async function assertBackupScope(db:D1Database,scope:BackupScope){const row=await db.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();if(!row||row.tenant_id!==scope.tenantId||row.site_id!==scope.siteId)throw new BackupError(503,'Backup deployment scope does not match');}
export async function backupInventory(bucket:R2Bucket){
 const objects:{key:string;size:number;etag:string;uploaded:string;httpMetadata:R2HTTPMetadata;customMetadata:{[key:string]:string}}[]=[];let cursor:string|undefined;const seen=new Set<string>();
 do{const result=await bucket.list({limit:1000,cursor});for(const object of result.objects){if(!backupUuid.test(object.key))throw new BackupError(503,'Bucket isolation validation failed: unexpected object key');const head=await bucket.head(object.key);if(!head||head.etag!==object.etag||head.size!==object.size)throw new BackupError(409,'Media changed during inventory');objects.push({key:head.key,size:head.size,etag:head.etag,uploaded:head.uploaded.toISOString(),httpMetadata:head.httpMetadata??{},customMetadata:head.customMetadata??{}});}
 if(objects.length>10000)throw new BackupError(507,'Backup inventory exceeds supported memory bound; no partial backup returned');
 if(!result.truncated)break;cursor=result.cursor;if(!cursor||seen.has(cursor))throw new BackupError(503,'Incomplete object inventory');seen.add(cursor);
 }while(true);objects.sort((a,b)=>a.key.localeCompare(b.key));return objects;
}
export async function exportBackup(db:D1Database,bucket:R2Bucket,scope:BackupScope,release:unknown){
 await assertBackupScope(db,scope);const inventory=await backupInventory(bucket);
 // D1 batch executes these reads in one transaction. Count equality detects any provider truncation.
 const queries=[db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name LIKE 'cms_%' ORDER BY type,name"),db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name LIKE 'cms_%' ORDER BY name")];
 for(const [name,order]of backupTables){const where=scoped.has(name)?' WHERE tenant_id=? AND site_id=?':'';for(const sql of [`PRAGMA table_info(${name})`,`SELECT COUNT(*) AS n FROM ${name}${where}`,`SELECT * FROM ${name}${where} ORDER BY ${order}`]){let stmt=db.prepare(sql);if(where&&!sql.startsWith('PRAGMA'))stmt=stmt.bind(scope.tenantId,scope.siteId);queries.push(stmt);}if(scoped.has(name))queries.push(db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE tenant_id<>? OR site_id<>?`).bind(scope.tenantId,scope.siteId));}
 const results=await db.batch(queries);if(results.some(r=>!r.success))throw new BackupError(503,'Database snapshot failed');
 const schema=results[0].results as {type:string;name:string;tbl_name:string;sql:string|null}[];
 if(schema.filter(r=>r.type==='table').map(r=>r.name).sort().join(',')!==backupTables.map(([name])=>name).sort().join(','))throw new BackupError(503,'Unknown or missing CMS schema; no partial backup returned');
 let index=2;const tables=[];
 for(const [name]of backupTables){const columns=results[index++].results, count=Number((results[index++].results[0] as {n:number}).n),rows=results[index++].results;
 if(count!==rows.length)throw new BackupError(507,'Database response was truncated; no partial backup returned');
 if(scoped.has(name)&&Number((results[index++].results[0] as {n:number}).n)!==0)throw new BackupError(503,'Database contains another tenant scope');
 if(name==='cms_settings'&&rows.some(row=>/(?:secret|password|credential|api[_-]?key|access[_-]?token)/i.test(String((row as {key:string}).key))))throw new BackupError(503,'Credential-like setting requires a reviewed backup policy');
 tables.push({name,columns,count,rows,sha256:await sha256(canonical(rows))});}
 const deployment=tables[0].rows as {singleton:number;tenant_id:string;site_id:string}[];
 if(deployment.length!==1||deployment[0].tenant_id!==scope.tenantId||deployment[0].site_id!==scope.siteId)throw new BackupError(503,'Snapshot deployment scope does not match');
 if(canonical(inventory)!==canonical(await backupInventory(bucket)))throw new BackupError(409,'Media inventory changed during snapshot; retry later');
 const knownMedia=new Set(inventory.map(object=>object.key));for(const table of tables)for(const match of canonical(table.rows).replaceAll('\\/','/').matchAll(/\/media\/([0-9a-f-]{36})/gi)){if(!knownMedia.has(match[1].toLowerCase()))throw new BackupError(503,'A database media reference has no stored object');}
 const snapshot={format:backupPurpose,schemaVersion:1,scope,createdAt:new Date().toISOString(),release,migrations:backupMigrations,schema,sqliteSequence:results[1].results,tables,media:inventory,consistency:'transactional-d1-batch-and-stable-r2-inventory',excludes:['environment secrets','provider-internal tables','static source assets (separate source archive)']};
 const serialized=canonical(snapshot);if(new TextEncoder().encode(serialized).length>20*1024*1024)throw new BackupError(507,'Snapshot exceeds supported 20MiB bound; no partial backup returned');
 return {snapshot,sha256:await sha256(serialized)};
}
