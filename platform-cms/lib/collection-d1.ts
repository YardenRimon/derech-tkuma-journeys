import type { CollectionStore, Scope, Kind, Record as ContentRecord, Snapshot, Content, Occurrence, ParentPublicationProof } from "./collection-core";
// @ts-expect-error Explicit extension preserves existing Node type-stripping adapter consumers.
import {isCapturedCollection,publicationKey,publicationPath,parsePublication,routeClaim,routeClaimKey,listManagedPublications,resolveManagedPublication,type ManagedPublication,type ManagedPublicationListOptions} from './managed-publication.ts';
// @ts-expect-error Explicit extension preserves existing Node type-stripping adapter consumers.
import {CollectionError,resourceId,kindOf,validateContent} from './collection-core.ts';
// @ts-expect-error Explicit extension preserves existing Node type-stripping adapter consumers.
import {publicationScope} from './managed-publication.ts';
export type CollectionPageOptions={cursor?:string|null;limit?:number};
function pageOptions(scope:Scope,kind:Kind,options:CollectionPageOptions){
 publicationScope(scope);kindOf(kind);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['cursor','limit'].includes(key)))throw new CollectionError(400,'בקשת רשימה אינה תקינה');
 const cursor=options.cursor??null,limit=options.limit??50;if(cursor!==null)resourceId(cursor);if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new CollectionError(400,'גודל הרשימה אינו תקין');return{cursor,limit};
}
function invalidPage():never{throw new CollectionError(503,'הרשומות אינן זמינות להצגה');}
/** Single provider boundary. A Postgres implementation must preserve this CAS + immutable history contract. */
export class D1Collections implements CollectionStore {
  db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  listManaged(scope:Scope,options:ManagedPublicationListOptions={}){return listManagedPublications(this.db,scope,options);}
  resolveManaged(scope:Scope,path:string){return resolveManagedPublication(this.db,scope,path);}
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
  /** Authenticated management page. Stable IDs do not reorder after edits. */
  async listPage(scope:Scope,kind:Kind,options:CollectionPageOptions={}){
    const {cursor,limit}=pageOptions(scope,kind,options),rows:{success?:boolean;results:{id:string;record_json:string}[]}=await this.db.prepare('SELECT id,record_json FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id>? ORDER BY id LIMIT ?').bind(scope.tenantId,scope.siteId,kind,cursor??'',limit+1).all();
    if(rows.success===false||!Array.isArray(rows.results)||rows.results.length>limit+1)invalidPage();
    const records=rows.results.slice(0,limit).map(row=>{try{const record=JSON.parse(row.record_json) as ContentRecord;resourceId(row.id);if(!record||record.id!==row.id||record.kind!==kind||record.tenantId!==scope.tenantId||record.siteId!==scope.siteId||!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isSafeInteger(record.publishedVersion)||record.publishedVersion<0||(record.publishedVersion===0&&record.published!==null))invalidPage();if(record.draft!==null)validateContent(kind,record.draft);if(record.published!==null)validateContent(kind,record.published);return record;}catch{invalidPage();}});
    return{records,nextCursor:rows.results.length>limit?records.at(-1)!.id:null};
  }
  /** Published columns only. Parent membership is a scoped PK join across all
   * published tours, never an administrative/200-row parent enumeration. */
  async publishedPage(scope:Scope,kind:Kind,options:CollectionPageOptions={}){
    const {cursor,limit}=pageOptions(scope,kind,options),parent=kind==='occurrence';
    const join=parent?" LEFT JOIN cms_records p ON p.tenant_id=r.tenant_id AND p.site_id=r.site_id AND p.kind='tour' AND p.id=CASE WHEN json_valid(r.published_json) THEN json_extract(r.published_json,'$.tourId') END":'';
    const visible=parent?' AND (NOT json_valid(r.published_json) OR (p.published_json IS NOT NULL AND p.published_version>0))':'';
    const rows:{success?:boolean;results:{id:string;published_json:string;published_version:number;parent_json?:string}[]}=await this.db.prepare('SELECT r.id,r.published_json,r.published_version'+(parent?',p.published_json AS parent_json':'')+' FROM cms_records r'+join+' WHERE r.tenant_id=? AND r.site_id=? AND r.kind=? AND r.published_json IS NOT NULL AND r.published_version>0 AND r.id>?'+visible+' ORDER BY r.id LIMIT ?').bind(scope.tenantId,scope.siteId,kind,cursor??'',limit+1).all();
    if(rows.success===false||!Array.isArray(rows.results)||rows.results.length>limit+1)invalidPage();
    const records=rows.results.slice(0,limit).map(row=>{try{resourceId(row.id);if(!Number.isSafeInteger(row.published_version)||row.published_version<1)invalidPage();const content=validateContent(kind,JSON.parse(row.published_json));if(parent)validateContent('tour',JSON.parse(row.parent_json!));return{id:row.id,content,version:row.published_version};}catch{invalidPage();}});
    return{records,nextCursor:rows.results.length>limit?records.at(-1)!.id:null};
  }
  async history(scope: Scope, kind: Kind, id: string) {
    const rows = await this.db.prepare("SELECT snapshot_json FROM cms_record_history WHERE tenant_id=? AND site_id=? AND kind=? AND id=? ORDER BY version DESC LIMIT 100").bind(scope.tenantId,scope.siteId,kind,id).all<{snapshot_json:string}>();
    return rows.results.map(row=>JSON.parse(row.snapshot_json) as Snapshot);
  }
  async commit(previous: ContentRecord|null, next: ContentRecord, audit: Snapshot, parentProof?:ParentPublicationProof) {
    const token=crypto.randomUUID();
    const {tenantId,siteId,kind,id}=next,scope={tenantId,siteId};
    const serialized=JSON.stringify(next),published=next.published===null?null:JSON.stringify(next.published);
    let condition='',conditions:unknown[]=[],publication:ManagedPublication|undefined,oldRegistry:string|null=null;
    // Captured identities keep their existing source routes and byte projection.
    // Only actual publication changes can create/update the managed registry.
    if(!isCapturedCollection(scope,kind,id)&&next.publishedVersion>(previous?.publishedVersion??0)){
      const existing=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(publicationKey(scope,kind,id)).first<{value:string}>();
      oldRegistry=existing?.value??null;
      const prior=oldRegistry===null?null:parsePublication(oldRegistry,scope,kind,id);
      if(prior&&(!previous||prior.publishedVersion!==previous.publishedVersion||(prior.state==='withdrawn')!==(previous.published===null)))return false;
      if(next.published!==null||prior){
        const path=next.published===null?prior!.path:publicationPath(next,prior?.path,crypto.randomUUID());
        if(prior&&prior.path!==path)return false; // Renames require a future redirect workflow.
        publication={schema:1,scope,kind,id,path,template:kind,publishedVersion:next.publishedVersion,publishedAt:next.updatedAt,state:next.published===null?'withdrawn':'published',registration:kind==='occurrence'?'closed':'not_applicable'};
        const registryKey=publicationKey(scope,kind,id),claimKey=routeClaimKey(scope,path),claim=routeClaim(publication);
        condition+=oldRegistry===null?' AND NOT EXISTS(SELECT 1 FROM cms_settings WHERE key=?)':' AND EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)';conditions.push(registryKey,...(oldRegistry===null?[]:[oldRegistry]));
        condition+=prior?' AND EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)':' AND NOT EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value<>?)';conditions.push(claimKey,claim);
        if(kind==='occurrence'&&next.published!==null){
          const tourId=(next.published as Occurrence).tourId;
          // Proof belongs to this exact change, not mutable adapter state shared
          // by concurrent publishers. No HTTP/body value creates this proof.
          if(!parentProof||Object.keys(parentProof).sort().join(',')!=='id,publishedJSON,publishedVersion'||parentProof.id!==tourId||!Number.isSafeInteger(parentProof.publishedVersion)||parentProof.publishedVersion<1||typeof parentProof.publishedJSON!=='string')return false;
          condition+=" AND EXISTS(SELECT 1 FROM cms_records WHERE tenant_id=? AND site_id=? AND kind='tour' AND id=? AND published_version=? AND published_json=?)";
          conditions.push(tenantId,siteId,tourId,parentProof.publishedVersion,parentProof.publishedJSON);
        }
      }
    }
    const write=previous
      ? this.db.prepare('UPDATE cms_records SET record_json=?,published_json=?,published_version=?,revision=?,updated_at=?,operation_token=? WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND revision=?'+condition).bind(serialized,published,next.publishedVersion,next.revision,next.updatedAt,token,tenantId,siteId,kind,id,previous.revision,...conditions)
      : this.db.prepare('INSERT OR IGNORE INTO cms_records (record_json,published_json,published_version,revision,updated_at,operation_token,tenant_id,site_id,kind,id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE 1'+condition).bind(serialized,published,next.publishedVersion,next.revision,next.updatedAt,token,tenantId,siteId,kind,id,...conditions);
    const statements=[write];
    if(publication){
      const committed='EXISTS(SELECT 1 FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND operation_token=?)',args=[tenantId,siteId,kind,id,token];
      // Follow-on ledger writes depend on a fresh server-only batch token. A
      // failed/replayed record CAS cannot leave a route or registry behind.
      statements.push(this.db.prepare('INSERT INTO cms_settings(key,value) SELECT ?,? WHERE '+committed+' ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE cms_settings.value=excluded.value').bind(routeClaimKey(scope,publication.path),routeClaim(publication),...args));
      statements.push(this.db.prepare('INSERT INTO cms_settings(key,value) SELECT ?,? WHERE '+committed+' ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(publicationKey(scope,kind,id),JSON.stringify(publication),...args));
    }
    statements.push(this.db.prepare('INSERT INTO cms_record_history (tenant_id,site_id,kind,id,version,snapshot_json) SELECT tenant_id,site_id,kind,id,revision,? FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND operation_token=?').bind(JSON.stringify(audit),tenantId,siteId,kind,id,token));
    const result=await this.db.batch(statements);return result[0].meta.changes===1;
  }
}
