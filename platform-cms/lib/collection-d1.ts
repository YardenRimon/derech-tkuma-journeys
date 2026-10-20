import type { CollectionStore, Scope, Kind, Record as ContentRecord, Snapshot, Content } from "./collection-core";
/** Single provider boundary. A Postgres implementation must preserve this CAS + immutable history contract. */
export class D1Collections implements CollectionStore {
  db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  async get(scope: Scope, kind: Kind, id: string) {
    const row = await this.db.prepare("SELECT record_json FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id=?").bind(scope.tenantId,scope.siteId,kind,id).first<{record_json:string}>();
    return row ? JSON.parse(row.record_json) as ContentRecord : null;
  }
  async list(scope: Scope, kind: Kind) {
    const rows = await this.db.prepare("SELECT record_json FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? ORDER BY updated_at DESC LIMIT 200").bind(scope.tenantId,scope.siteId,kind).all<{record_json:string}>();
    return rows.results.map(row=>JSON.parse(row.record_json) as ContentRecord);
  }
  async published(scope: Scope, kind: Kind) {
    // Never select draft JSON in public reads.
    const rows = await this.db.prepare("SELECT id,published_json,published_version FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND published_json IS NOT NULL ORDER BY id LIMIT 200").bind(scope.tenantId,scope.siteId,kind).all<{id:string;published_json:string;published_version:number}>();
    return rows.results.map(row=>({id:row.id,content:JSON.parse(row.published_json) as Content,version:row.published_version}));
  }
  async history(scope: Scope, kind: Kind, id: string) {
    const rows = await this.db.prepare("SELECT snapshot_json FROM cms_record_history WHERE tenant_id=? AND site_id=? AND kind=? AND id=? ORDER BY version DESC LIMIT 100").bind(scope.tenantId,scope.siteId,kind,id).all<{snapshot_json:string}>();
    return rows.results.map(row=>JSON.parse(row.snapshot_json) as Snapshot);
  }
  async commit(previous: ContentRecord|null, next: ContentRecord, audit: Snapshot) {
    const token=crypto.randomUUID();
    const {tenantId,siteId,kind,id}=next;
    const serialized=JSON.stringify(next),published=next.published===null?null:JSON.stringify(next.published);
    const write=previous
      ? this.db.prepare("UPDATE cms_records SET record_json=?,published_json=?,published_version=?,revision=?,updated_at=?,operation_token=? WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND revision=?").bind(serialized,published,next.publishedVersion,next.revision,next.updatedAt,token,tenantId,siteId,kind,id,previous.revision)
      : this.db.prepare("INSERT OR IGNORE INTO cms_records (record_json,published_json,published_version,revision,updated_at,operation_token,tenant_id,site_id,kind,id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(serialized,published,next.publishedVersion,next.revision,next.updatedAt,token,tenantId,siteId,kind,id);
    const result=await this.db.batch([write,this.db.prepare("INSERT INTO cms_record_history (tenant_id,site_id,kind,id,version,snapshot_json) SELECT tenant_id,site_id,kind,id,revision,? FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND operation_token=?").bind(JSON.stringify(audit),tenantId,siteId,kind,id,token)]);
    return result[0].meta.changes===1;
  }
}
