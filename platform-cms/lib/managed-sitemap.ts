/** Published tour sitemaps. One bounded DB query per document; no draft reads. */
import {publicationPrefix,listManagedPublications,type ManagedPublicationEntry} from './managed-publication';
import type {Scope} from './collection-core';
import {productionSitemap,type ProductionProfile} from './visitor-release';
export type ManagedSitemapBindings={DB?:D1Database;CMS_ADAPTER_MODE?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
const paths=new Set(['/sitemap.xml','/sitemap-source.xml','/sitemap-managed.xml']),escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const MANAGED_SITEMAP_CHUNK=100;
export class ManagedSitemapError extends Error{readonly status=503;constructor(){super('managed_sitemap_unavailable');}}
function need(v:unknown):asserts v{if(!v)throw new ManagedSitemapError();}
function response(request:Request,profile:ProductionProfile,xml:string){return new Response(request.method==='HEAD'?null:xml,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store','x-derech-public-profile':profile.sourceCommit,'x-content-type-options':'nosniff'}});}
export function managedSitemapPath(path:string){return paths.has(path);}
export async function managedSitemapResponse(request:Request,b:ManagedSitemapBindings,scope:Scope,profile:ProductionProfile):Promise<Response|null>{
 const url=new URL(request.url);if(!paths.has(url.pathname)||!['GET','HEAD'].includes(request.method))return null;
 need(url.origin===profile.origin&&scope.tenantId==='derech'&&scope.siteId==='derech-main');
 if(url.pathname==='/sitemap-source.xml'){need(!url.search);return response(request,profile,productionSitemap());}
 if(!b.DB||b.CMS_ADAPTER_MODE!=='isolated-d1')return url.pathname==='/sitemap.xml'?null:new Response(request.method==='HEAD'?null:'Sitemap unavailable',{status:503,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
 need(b.CMS_TENANT_ID===scope.tenantId&&b.CMS_SITE_ID===scope.siteId);const registered=await b.DB.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();need(registered?.tenant_id===scope.tenantId&&registered?.site_id===scope.siteId);
 const prefix=publicationPrefix(scope),tourPrefix=prefix+'tour:';
 if(url.pathname==='/sitemap.xml'){
  need(!url.search);
  // Each boundary uses the same stable key ordering and 100 raw registry rows
  // as its child. Withdrawals can leave empty child files, never missing URLs.
  // The standard sitemap-index maximum is50,000 child files, not a record cap.
  const q='WITH ranked AS (SELECT key,row_number() OVER(ORDER BY key) AS seq,count(*) OVER() AS total FROM cms_settings WHERE key>=? AND key<?) SELECT key,seq,total FROM ranked WHERE seq=1 OR (seq%100=0 AND seq<total) ORDER BY seq LIMIT 50000',r=await b.DB.prepare(q).bind(tourPrefix,tourPrefix+'\uffff').all<{key:string;seq:number;total:number}>();need(r.success===true&&Array.isArray(r.results)&&r.results.length<50000);
  if(!r.results.length)return response(request,profile,productionSitemap());
  const total=r.results[0].total;need(Number.isSafeInteger(total)&&total>=1&&total<=49999*MANAGED_SITEMAP_CHUNK&&r.results.length===Math.ceil(total/MANAGED_SITEMAP_CHUNK));
  const files=[profile.origin+'/sitemap-source.xml',profile.origin+'/sitemap-managed.xml'];let previousKey='';
  for(const [index,row] of r.results.entries()){need(row.total===total&&row.seq===(index===0?1:index*MANAGED_SITEMAP_CHUNK)&&row.key>previousKey);previousKey=row.key;need(row.key.startsWith(tourPrefix)&&/^tour:(?:[a-f0-9]{2}){1,80}$/.test(row.key.slice(prefix.length))&&Number.isSafeInteger(row.seq)&&row.seq>=1&&Number.isSafeInteger(row.total)&&row.total>=row.seq);if(row.seq!==1)files.push(profile.origin+'/sitemap-managed.xml?after='+encodeURIComponent(row.key.slice(prefix.length)));}
  return response(request,profile,'<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+files.map(href=>'<sitemap><loc>'+escape(href)+'</loc></sitemap>').join('')+'</sitemapindex>');
 }
 const values=url.searchParams.getAll('after');need([...url.searchParams.keys()].every(k=>k==='after')&&values.length<=1&&(values.length===0||/^tour:(?:[a-f0-9]{2}){1,80}$/.test(values[0])));
 const batch=await listManagedPublications(b.DB,scope,{kind:'tour',cursor:values[0]??null,limit:MANAGED_SITEMAP_CHUNK});
 const urls=batch.entries.filter((e:ManagedPublicationEntry)=>e.kind==='tour'&&e.state==='published'&&e.content!==null).map(entry=>'<url><loc>'+escape(profile.origin+entry.path)+'</loc><lastmod>'+escape(entry.publishedAt)+'</lastmod></url>');
 return response(request,profile,'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.join('')+'</urlset>');
}
