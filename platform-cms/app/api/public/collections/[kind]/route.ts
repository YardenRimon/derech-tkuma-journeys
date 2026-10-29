import { assertIsolatedD1Scope } from "@/lib/access";
import { CmsError,jsonError,getD1 } from "@/lib/cms";
import { kindOf,CollectionError } from "@/lib/collection-core";
import { D1Collections } from "@/lib/collection-d1";
import { siteScope } from "@/lib/site-scope";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 try {
 await assertIsolatedD1Scope(getD1());
 const url=new URL(request.url),kind=kindOf(url.pathname.split('/').filter(Boolean).at(-1)),store=new D1Collections(getD1()),scope=siteScope();
 if([...url.searchParams.keys()].some(key=>!['cursor','limit'].includes(key))||['cursor','limit'].some(key=>url.searchParams.getAll(key).length>1))throw new CmsError(400,'בקשת רשימה אינה תקינה');
 const cursor=url.searchParams.get('cursor'),rawLimit=url.searchParams.get('limit');if(rawLimit!==null&&!/^[1-9]\d*$/.test(rawLimit))throw new CmsError(400,'גודל הרשימה אינו תקין');
 const page=await store.publishedPage(scope,kind,{cursor,...(rawLimit===null?{}:{limit:Number(rawLimit)})});
 return Response.json(page,{headers:{"cache-control":"public, max-age=0, s-maxage=60","x-robots-tag":"noindex, nofollow"}});
 }catch(e){return jsonError(e instanceof CollectionError?new CmsError(e.status,e.message):e);}
}
