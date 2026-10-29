// @ts-expect-error Explicit extension preserves existing Node type-stripping adapter consumers.
import {CollectionError,resourceId,validateContent,type Scope,type Kind,type Content,type Record as ContentRecord} from './collection-core.ts';
import source from './current-collections.json' with {type:'json'};
import previousSource from '../source-pages/previous-collections-20261019.json' with {type:'json'};
import sourcePages from '../source-manifest.json' with {type:'json'};
import release from './site-release.json' with {type:'json'};
/** Public route ownership is deployment/server data, never a draft sourcePath.
 * New occurrences deliberately have no catalog registration or stock policy. */
export type ManagedPublication={schema:1;scope:Scope;kind:Kind;id:string;path:string;template:Kind;publishedVersion:number;publishedAt:string;state:'published'|'withdrawn';registration:'closed'|'not_applicable'};
export type ManagedPublicationEntry=Omit<ManagedPublication,'state'>&{content:Content|null;parentPublishedVersion:number|null;state:'published'|'withdrawn'|'parent_withdrawn'};
export class ManagedPublicationError extends Error{readonly status=503;constructor(){super('managed_publication_unavailable');}}
export type ManagedPublicationListOptions={cursor?:string|null;limit?:number;kind?:Kind;parentId?:string};
export const MANAGED_PUBLICATION_PAGE_LIMIT=50,MANAGED_PUBLICATION_MAX_PAGE=100;
const sourceIds=new Set([...source.records,...previousSource.records].map(row=>row.kind+':'+row.id));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const scopeId=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const reserved=new Set(['admin','api','auth','auth-required','login','logout','payment','cart','checkout','media','_next','__pilot__','__source_assets__','visitor-configuration','measurement-frame','robots.txt','sitemap.xml','maslulim','product']);
const sourcePaths=new Set([...Object.keys(sourcePages),...release.redirects.map(row=>row.route)].map(path=>decodeURIComponent(path).normalize('NFC').toLowerCase()));
function conflict():never{throw new CollectionError(409,'כתובת הפרסום תפוסה או אינה זמינה; טען את הרשומה ובדוק את כתובתה');}
export function publicationScope(scope:Scope){if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).sort().join(',')!=='siteId,tenantId'||typeof scope.tenantId!=='string'||typeof scope.siteId!=='string'||!scopeId.test(scope.tenantId)||!scopeId.test(scope.siteId))throw new ManagedPublicationError();return scope;}
export function isCapturedCollection(scope:Scope,kind:Kind,id:string){return scope.tenantId==='derech'&&scope.siteId==='derech-main'&&sourceIds.has(kind+':'+id);}
export function publicationPrefix(scope:Scope){publicationScope(scope);return 'managed-publication:v1:'+scope.tenantId+':'+scope.siteId+':';}
// Hex UTF-8 identities avoid letting a public slug/ID masquerade as a secret
// setting key in the existing backup credential-name safeguard.
const encodedKey=(value:string)=>Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('');
export function publicationKey(scope:Scope,kind:Kind,id:string){resourceId(id);return publicationPrefix(scope)+kind+':'+encodedKey(id);}
export function routeClaimKey(scope:Scope,path:string){publicationScope(scope);return 'managed-route:v1:'+scope.tenantId+':'+scope.siteId+':'+encodedKey(path);}
/** Canonical decoded NFC paths, with a trailing slash and lowercase letters.
 * One encoding layer is accepted; separators/dot segments/double encoding fail. */
export function normalizeManagedPath(input:string){
 if(typeof input!=='string'||input.length>500||!input.startsWith('/')||/%(?:2f|5c)/i.test(input))conflict();
 let path:string;try{path=decodeURIComponent(input).normalize('NFC').toLowerCase();}catch{conflict();}
 if(/[\s\u0000-\u001f\u007f%?#\\<>"']/.test(path)||path.includes('//'))conflict();
 path=path.endsWith('/')?path:path+'/';const parts=path.slice(1,-1).split('/');
 if(parts.length!==2||!['maslulim','product'].includes(parts[0])||!parts[1]||!/^[-\p{L}\p{N}]+$/u.test(parts[1])||reserved.has(parts[1])||sourcePaths.has(path))conflict();
 if(parts[0]==='product'&&!uuid.test(parts[1].slice('managed-'.length)))conflict();
 if(parts[0]==='product'&&!parts[1].startsWith('managed-'))conflict();return path;
}
export function publicationPath(record:ContentRecord,assignedPath?:string,newRouteId?:string){
 if(!record.published)conflict();
 const content=validateContent(record.kind,record.published);
 if(record.kind==='occurrence'){
  // Legacy API IDs may be non-UUID. Allocate their route UUID once on the
  // server, then retain it in the registry. Ordinary UUID IDs keep that UUID.
  const route=assignedPath??'/product/managed-'+(uuid.test(record.id)?record.id:newRouteId??'')+'/';
  const normalized=normalizeManagedPath(route);if(!normalized.startsWith('/product/')||uuid.test(record.id)&&normalized!=='/product/managed-'+record.id+'/')conflict();return normalized;
 }
 const tour=content as import('./collection-core').Tour,path=normalizeManagedPath('/maslulim/'+tour.slug+'/');
 if(tour.sourcePath!==undefined&&normalizeManagedPath(tour.sourcePath)!==path)conflict();return path;
}
export function routeClaim(publication:Pick<ManagedPublication,'scope'|'kind'|'id'|'path'>){return JSON.stringify({schema:1,scope:{tenantId:publication.scope.tenantId,siteId:publication.scope.siteId},kind:publication.kind,id:publication.id,path:publication.path});}
export function parsePublication(raw:string,scope:Scope,kind?:Kind,id?:string):ManagedPublication{
 try{
  const p=JSON.parse(raw) as ManagedPublication;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='id,kind,path,publishedAt,publishedVersion,registration,schema,scope,state,template'||p.schema!==1||!p.scope||Object.keys(p.scope).sort().join(',')!=='siteId,tenantId'||p.scope.tenantId!==scope.tenantId||p.scope.siteId!==scope.siteId||!['tour','occurrence'].includes(p.kind)||(kind!==undefined&&p.kind!==kind)||(id!==undefined&&p.id!==id)||p.template!==p.kind||resourceId(p.id)!==p.id||isCapturedCollection(scope,p.kind,p.id)||normalizeManagedPath(p.path)!==p.path||!Number.isSafeInteger(p.publishedVersion)||p.publishedVersion<1||!['published','withdrawn'].includes(p.state)||p.registration!==(p.kind==='occurrence'?'closed':'not_applicable')||typeof p.publishedAt!=='string'||!Number.isFinite(Date.parse(p.publishedAt))||new Date(p.publishedAt).toISOString()!==p.publishedAt)throw new Error();
  if(p.kind==='tour'&&!p.path.startsWith('/maslulim/'))throw new Error();if(p.kind==='occurrence'&&uuid.test(p.id)&&p.path!=='/product/managed-'+p.id+'/')throw new Error();return p;
 }catch{throw new ManagedPublicationError();}
}
type PublicRow={registry_key:string;registry_json:string;kind:Kind|null;id:string|null;published_json:string|null;published_version:number|null;parent_published:number;parent_version:number|null;route_claim:string|null};
const publicSelect=`SELECT s.key AS registry_key,s.value AS registry_json,r.kind,r.id,r.published_json,r.published_version,CASE WHEN p.published_json IS NULL THEN 0 ELSE 1 END AS parent_published,p.published_version AS parent_version,c.value AS route_claim FROM cms_settings s LEFT JOIN cms_records r ON r.tenant_id=? AND r.site_id=? AND r.kind=CASE WHEN json_valid(s.value) THEN json_extract(s.value,'$.kind') END AND r.id=CASE WHEN json_valid(s.value) THEN json_extract(s.value,'$.id') END LEFT JOIN cms_records p ON p.tenant_id=r.tenant_id AND p.site_id=r.site_id AND p.kind='tour' AND p.id=CASE WHEN json_valid(r.published_json) THEN json_extract(r.published_json,'$.tourId') END LEFT JOIN cms_settings c ON c.key=?||lower(hex(CAST(CASE WHEN json_valid(s.value) THEN json_extract(s.value,'$.path') END AS BLOB))) `;
function publicEntry(row:PublicRow,scope:Scope):ManagedPublicationEntry{
 const p=parsePublication(row.registry_json,scope);if(row.route_claim!==routeClaim(p)||![0,1].includes(row.parent_published)||row.parent_version!==null&&(!Number.isSafeInteger(row.parent_version)||row.parent_version<0))throw new ManagedPublicationError();
 if(row.registry_key!==publicationKey(scope,p.kind,p.id)||row.kind!==p.kind||row.id!==p.id||row.published_version!==p.publishedVersion||(p.state==='withdrawn')!==(row.published_json===null))throw new ManagedPublicationError();
 let content:Content|null=null;try{if(row.published_json!==null)content=validateContent(p.kind,JSON.parse(row.published_json));}catch{throw new ManagedPublicationError();}
 try{if(content&&publicationPath({...scope,kind:p.kind,id:p.id,published:content} as ContentRecord,p.path)!==p.path)throw new Error();}catch{throw new ManagedPublicationError();}
 if(p.kind==='occurrence'&&content&&(!row.parent_published||!row.parent_version))return {...p,state:'parent_withdrawn',content:null,parentPublishedVersion:row.parent_version};
 return {...p,content,parentPublishedVersion:p.kind==='occurrence'?row.parent_version:null};
}
/** One scoped bounded query per page, including retained withdrawals. Caller
 * continues the opaque identity cursor; there is no silent 200-record cutoff.
 * SQL never selects record_json, drafts, inventory, or catalog configuration. */
export async function listManagedPublications(db:D1Database,scope:Scope,options:ManagedPublicationListOptions={}){
 publicationScope(scope);if(!options||typeof options!=='object'||Array.isArray(options))throw new CollectionError(400,'בקשת רשימה אינה תקינה');const cursor=options.cursor??null,limit=options.limit??MANAGED_PUBLICATION_PAGE_LIMIT;
 if(Object.keys(options).some(k=>!['cursor','limit','kind','parentId'].includes(k))||!Number.isSafeInteger(limit)||limit<1||limit>MANAGED_PUBLICATION_MAX_PAGE||cursor!==null&&(typeof cursor!=='string'||!/^(tour|occurrence):(?:[a-f0-9]{2}){1,80}$/.test(cursor)))throw new CollectionError(400,'בקשת רשימה אינה תקינה');
 if(options.kind!==undefined&&!['tour','occurrence'].includes(options.kind)||options.parentId!==undefined&&(options.kind!=='occurrence'||typeof options.parentId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(options.parentId))||options.kind&&cursor!==null&&!cursor.startsWith(options.kind+':'))throw new CollectionError(400,'בקשת רשימה אינה תקינה');
 const prefix=publicationPrefix(scope),scanPrefix=prefix+(options.kind?options.kind+':':''),filters:string[]=[],filterArgs:string[]=[];
 // The scoped key prefix already selects kind. Filtering on the LEFT JOIN
 // record would silently discard malformed/orphan registry rows before parse.
 if(options.parentId!==undefined){filters.push("(NOT json_valid(s.value) OR r.id IS NULL OR c.value IS NULL OR (r.published_json IS NOT NULL AND NOT json_valid(r.published_json)) OR CASE WHEN json_valid(r.published_json) THEN json_extract(r.published_json,'$.tourId') END=?)");filterArgs.push(options.parentId);}
 const result:{success?:boolean;results:PublicRow[]}=await db.prepare(publicSelect+'WHERE s.key>=? AND s.key<? AND s.key>?'+filters.map(filter=>' AND '+filter).join('')+' ORDER BY s.key LIMIT ?').bind(scope.tenantId,scope.siteId,routeClaimKey(scope,''),scanPrefix,scanPrefix+'\uffff',prefix+(cursor??''),...filterArgs,limit+1).all<PublicRow>();
 if(result.success===false||!Array.isArray(result.results)||result.results.length>limit+1)throw new ManagedPublicationError();
 const entries=result.results.slice(0,limit).map(row=>publicEntry(row,scope));
 return {entries,nextCursor:result.results.length>limit?result.results[limit-1].registry_key.slice(prefix.length):null};
}
/** Exact managed-route lookup; arbitrary/draft/source paths never authorize a
 * public page. Both retained claims and the public record must agree. */
export async function resolveManagedPublication(db:D1Database,scope:Scope,input:string):Promise<ManagedPublicationEntry|null>{
 publicationScope(scope);let path:string;try{path=normalizeManagedPath(input);}catch{return null;}
 const claim=await db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(routeClaimKey(scope,path)).first<{value:string}>();if(!claim)return null;
 let identity:{kind:Kind;id:string};try{identity=JSON.parse(claim.value);if(!['tour','occurrence'].includes(identity.kind))throw new Error();resourceId(identity.id);}catch{throw new ManagedPublicationError();}
 const row=await db.prepare(publicSelect+'WHERE s.key=?').bind(scope.tenantId,scope.siteId,routeClaimKey(scope,''),publicationKey(scope,identity.kind,identity.id)).first<PublicRow>();if(!row)throw new ManagedPublicationError();
 const entry=publicEntry(row,scope);if(entry.path!==path||claim.value!==routeClaim({...entry,scope}))throw new ManagedPublicationError();return entry;
}
