import {currentCollectionSeed,type PublishedProjectionRecord} from './collection-projection';
import type {Scope,Kind,Content} from './collection-core';
/** Exact deployment source identities, never an admin list or visitor filter.
 * The composite primary key bounds this read to one lookup per known item. */
const identities=currentCollectionSeed.map(row=>Object.freeze({kind:row.kind as Kind,id:row.id}));
const key=(kind:string,id:string)=>kind+'\0'+id;
const known=new Set(identities.map(row=>key(row.kind,row.id)));
export class PublishedSourceReadError extends Error{readonly status=503;constructor(readonly code:'published_source_scope_invalid'|'published_source_unavailable'|'published_source_row_invalid'){super(code);}}
function need(ok:unknown,code:PublishedSourceReadError['code']):asserts ok{if(!ok)throw new PublishedSourceReadError(code);}
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const scopeId=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
/** Caller supplies the authenticated deployment scope. Only published columns
 * enter this boundary; explicit null withdrawals and version0 rows are kept.
 * Content validation remains in the existing projection, with no draft fallback.
 */
export async function loadPublishedSourceCollections(db:D1Database,scope:Scope):Promise<PublishedProjectionRecord[]>{
 need(scope&&typeof scope==='object'&&!Array.isArray(scope)&&Object.keys(scope).sort().join(',')==='siteId,tenantId'&&scopeId(scope.tenantId)&&scopeId(scope.siteId),'published_source_scope_invalid');
 need(db&&typeof db.prepare==='function'&&identities.length>0&&known.size===identities.length&&identities.every(row=>['tour','occurrence'].includes(row.kind)&&identifier(row.id)),'published_source_unavailable');
 const placeholders=identities.map(()=>'(?,?)').join(','),args=[scope.tenantId,scope.siteId,...identities.flatMap(row=>[row.kind,row.id])];
 let result:{success?:boolean;results:{kind:unknown;id:unknown;published_json:unknown;published_version:unknown}[]};
 try{result=await db.prepare('SELECT kind,id,published_json,published_version FROM cms_records WHERE tenant_id=? AND site_id=? AND (kind,id) IN ('+placeholders+')').bind(...args).all();}catch{throw new PublishedSourceReadError('published_source_unavailable');}
 need(result&&result.success!==false&&Array.isArray(result.results)&&result.results.length<=identities.length,'published_source_unavailable');
 const rows=new Map<string,PublishedProjectionRecord>();
 for(const raw of result.results){
  need(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).sort().join(',')==='id,kind,published_json,published_version'&&typeof raw.kind==='string'&&typeof raw.id==='string'&&known.has(key(raw.kind,raw.id)),'published_source_row_invalid');
  const id=key(raw.kind,raw.id);need(!rows.has(id)&&typeof raw.published_version==='number'&&Number.isSafeInteger(raw.published_version)&&raw.published_version>=0&&(raw.published_json===null||typeof raw.published_json==='string')&&(raw.published_version>0||raw.published_json===null),'published_source_row_invalid');
  let published:Content|null=null;if(raw.published_json!==null){let parsed:unknown;try{parsed=JSON.parse(raw.published_json);}catch{throw new PublishedSourceReadError('published_source_row_invalid');}need(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'published_source_row_invalid');published=parsed as Content;}
  rows.set(id,{kind:raw.kind as Kind,id:raw.id,published,publishedVersion:raw.published_version});
 }
 return identities.flatMap(identity=>{const row=rows.get(key(identity.kind,identity.id));return row?[row]:[];});
}
