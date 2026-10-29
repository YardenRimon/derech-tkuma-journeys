/** Read-only published registry boundary. Draft sourcePath never grants a route. */
import {listManagedPublications,resolveManagedPublication,publicationKey,parsePublication,normalizeManagedPath,type ManagedPublicationEntry} from './managed-publication';
import {renderManagedDocument,appendManagedCards} from './managed-page';
import {validateContent,type Scope,type Tour,type Occurrence} from './collection-core';
import {currentCollectionSeed} from './collection-projection';
import {productionRelease,prepareProductionPage,productionCsp} from './visitor-release';
export type ManagedPageBindings={DB?:D1Database;CMS_ADAPTER_MODE?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
export class ManagedPageRuntimeError extends Error{readonly status=503;constructor(){super('managed_page_unavailable');}}
const same=(scope:Scope,b:ManagedPageBindings)=>scope?.tenantId==='derech'&&scope.siteId==='derech-main'&&b.CMS_ADAPTER_MODE==='isolated-d1'&&b.CMS_TENANT_ID===scope.tenantId&&b.CMS_SITE_ID===scope.siteId;
async function database(b:ManagedPageBindings,scope:Scope){if(!b.DB||!same(scope,b))throw new ManagedPageRuntimeError();const row=await b.DB.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();if(!row||row.tenant_id!==scope.tenantId||row.site_id!==scope.siteId)throw new ManagedPageRuntimeError();return b.DB;}
function cursor(url:URL){const values=url.searchParams.getAll('managed_cursor');if(values.length>1||values.length===1&&!/^(tour|occurrence):(?:[a-f0-9]{2}){1,80}$/.test(values[0]))throw new ManagedPageRuntimeError();return values[0]??null;}
const nextHref=(path:string,next:string|null)=>next?path+'?managed_cursor='+encodeURIComponent(next):null;
const visible=(entry:ManagedPublicationEntry)=>entry.state==='published'&&entry.content!==null;
async function parentFor(db:D1Database,scope:Scope,entry:ManagedPublicationEntry){
 if(entry.kind!=='occurrence'||!entry.content)return null;const id=(entry.content as Occurrence).tourId,row=await db.prepare("SELECT published_json,published_version FROM cms_records WHERE tenant_id=? AND site_id=? AND kind='tour' AND id=?").bind(scope.tenantId,scope.siteId,id).first<{published_json:string|null;published_version:number}>();if(!row?.published_json)return null;
 const tour=validateContent('tour',JSON.parse(row.published_json)) as Tour,source=currentCollectionSeed.find(record=>record.kind==='tour'&&record.id===id);if(source)return{title:tour.title,path:(source.content as Tour).sourcePath??'/maslulim/'+(source.content as Tour).slug+'/'};
 const stored=await db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(publicationKey(scope,'tour',id)).first<{value:string}>();if(!stored)return null;const publication=parsePublication(stored.value,scope,'tour',id),parent=await resolveManagedPublication(db,scope,publication.path);return parent&&visible(parent)?{title:(parent.content as Tour).title,path:parent.path}:null;
}
/** Unknown paths return null, allowing the existing source404 behavior. */
export async function managedPageResponse(request:Request,b:ManagedPageBindings,scope:Scope|(()=>Scope),loadPage:(path:string)=>Promise<string>):Promise<Response|null>{
 const url=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return null;let normalized:string;try{normalized=normalizeManagedPath(url.pathname);}catch{return null;}if(!b.DB||b.CMS_ADAPTER_MODE!=='isolated-d1')return null;
 const currentScope=typeof scope==='function'?scope():scope,db=await database(b,currentScope),entry=await resolveManagedPublication(db,currentScope,normalized);if(!entry)return null;
 const profile=productionRelease(url),indexable=profile!==null&&entry.kind==='tour'&&visible(entry);
 if(decodeURIComponent(url.pathname).normalize('NFC')!==entry.path)return new Response(null,{status:308,headers:{location:entry.path,'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
 const parent=await parentFor(db,currentScope,entry);if(entry.kind==='occurrence'&&visible(entry)&&!parent)throw new ManagedPageRuntimeError();
 const children=entry.kind==='tour'&&visible(entry)?await listManagedPublications(db,currentScope,{kind:'occurrence',parentId:entry.id,cursor:cursor(url),limit:50}):{entries:[],nextCursor:null},shellPath='/המסלולים/';let shell=await loadPage(shellPath);if(profile)shell=prepareProductionPage(shell,new URL(shellPath,url),profile);
 const html=renderManagedDocument(shell,entry,{parent,children:children.entries,nextHref:nextHref(entry.path,children.nextCursor),origin:url.origin,indexable});
 return new Response(request.method==='HEAD'?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=0, s-maxage=60','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN',...(!indexable?{'x-robots-tag':'noindex, nofollow'}:{}),...(profile?{'content-security-policy':productionCsp,'x-derech-public-profile':profile.sourceCommit,...(indexable?{'x-derech-managed-indexable':profile.sourceCommit}:{})}:{})}});
}
/** Adds only the next bounded page of new items; original source cards remain. */
export async function appendPublishedManagedCards(html:string,url:URL,b:ManagedPageBindings,scope:Scope|(()=>Scope)){
 const path=decodeURIComponent(url.pathname);let kind:'tour'|'occurrence',parentId:string|undefined,heading:string;
 if(['/המסלולים/','/maslulim/'].includes(path)){kind='tour';heading='המסלולים שלנו';}
 else if(path==='/סיורים/'){kind='occurrence';heading='מועדי סיור נוספים';}
 else{const parent=currentCollectionSeed.find(row=>row.kind==='tour'&&(row.content as Tour).sourcePath===path);if(!parent)return html;kind='occurrence';parentId=parent.id;heading='מועדי הסיור';}
 if(!b.DB||b.CMS_ADAPTER_MODE!=='isolated-d1')return html;const currentScope=typeof scope==='function'?scope():scope,db=await database(b,currentScope),batch=await listManagedPublications(db,currentScope,{kind,...(parentId?{parentId}:{}),cursor:cursor(url),limit:50});
 return appendManagedCards(html,batch.entries,{heading,nextHref:nextHref(path,batch.nextCursor),...(parentId?{insertion:'before-source-footer-1489' as const}:{})});
}
