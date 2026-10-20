import {env} from 'cloudflare:workers';
import {assertIsolatedD1Scope,CmsError} from '@/lib/access';
import {getD1,jsonError} from '@/lib/cms';
import {siteScope} from '@/lib/site-scope';
import {CollectionError} from '@/lib/collection-core';
import {validateSeoRequest,seoSnapshot} from './seo-request';
export const dynamic='force-dynamic';
/** Fixed private readback only. It never delegates to interactive auth or execution writes. */
export async function POST(request:Request){
 try{
  await validateSeoRequest(request,(env as unknown as {CMS_EXECUTION_SECRET?:string}).CMS_EXECUTION_SECRET);
  const db=getD1();await assertIsolatedD1Scope(db);
  const value=await seoSnapshot(db,siteScope()),raw=JSON.stringify(value);
  if(new TextEncoder().encode(raw).byteLength>500000)throw new CmsError(503,'תמונת SEO חורגת מהמגבלה');
  return new Response(raw,{headers:{'content-type':'application/json','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
 }catch(error){const response=jsonError(error instanceof CollectionError?new CmsError(error.status,error.message):error);response.headers.set('cache-control','no-store');response.headers.set('x-robots-tag','noindex, nofollow');return response;}
}
