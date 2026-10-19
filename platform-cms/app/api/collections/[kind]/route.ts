import { authorizeCmsUser, CmsError } from "@/lib/access";
import { requireSameOrigin,jsonError,getD1 } from "@/lib/cms";
import { Collections,CollectionError,kindOf,resourceId,type Change } from "@/lib/collection-core";
import { D1Collections } from "@/lib/collection-d1";
import { siteScope } from "@/lib/site-scope";
export const dynamic="force-dynamic";
const send=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const failure=(e:unknown)=>jsonError(e instanceof CollectionError?new CmsError(e.status,e.message):e);
function kind(request:Request){return kindOf(new URL(request.url).pathname.split('/').filter(Boolean).at(-1));}
export async function GET(request:Request){
 try {
  await authorizeCmsUser("content");const scope=siteScope(),store=new D1Collections(getD1()),url=new URL(request.url),type=kind(request),id=url.searchParams.get("id");
  if(!id)return send({records:await store.list(scope,type)});
  resourceId(id);
  if(url.searchParams.get("history")==="1")return send({history:await store.history(scope,type,id)});
  const record=await store.get(scope,type,id);if(!record)throw new CmsError(404,"הרשומה לא נמצאה");return send({record});
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 try {
  requireSameOrigin(request);
  const text=await request.text();if(new TextEncoder().encode(text).length>50000)throw new CmsError(413,"הבקשה גדולה מדי");
  let body;try{body=JSON.parse(text);}catch{throw new CmsError(400,"בקשה אינה תקינה");}
  if(!body||typeof body!=="object"||Array.isArray(body))throw new CmsError(400,"בקשה אינה תקינה");
  const user=await authorizeCmsUser(body.operation==="publish"?"publish":"content");
  const service=new Collections(new D1Collections(getD1()));
  const record=await service.change(siteScope(),{id:user.userId,canPublish:user.canPublish},kind(request),resourceId(body.id),body as Change);
  return send({record});
 }catch(e){return failure(e);}
}
