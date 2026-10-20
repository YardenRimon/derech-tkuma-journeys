import { assertIsolatedD1Scope } from "@/lib/access";
import { CmsError,jsonError,getD1 } from "@/lib/cms";
import { kindOf,CollectionError } from "@/lib/collection-core";
import { D1Collections } from "@/lib/collection-d1";
import { siteScope } from "@/lib/site-scope";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 try {
 await assertIsolatedD1Scope(getD1());
 const kind=kindOf(new URL(request.url).pathname.split('/').filter(Boolean).at(-1));const store=new D1Collections(getD1()),scope=siteScope();
 let records=await store.published(scope,kind);
 // Withdrawn tours also hide their occurrences from the public projection.
 if(kind==="occurrence"){const tours=new Set((await store.published(scope,"tour")).map(x=>x.id));records=records.filter(x=>"tourId" in x.content&&tours.has(x.content.tourId));}
 return Response.json({records},{headers:{"cache-control":"public, max-age=0, s-maxage=60","x-robots-tag":"noindex, nofollow"}});
 }catch(e){return jsonError(e instanceof CollectionError?new CmsError(e.status,e.message):e);}
}
