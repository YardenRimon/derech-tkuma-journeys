import {publicationKey,parsePublication,isCapturedCollection} from '@/lib/managed-publication';
import { authorizeCmsUser, CmsError } from "@/lib/access";
import { requireSameOrigin,jsonError,getD1 } from "@/lib/cms";
import { Collections,CollectionError,kindOf,resourceId,type Change } from "@/lib/collection-core";
import { D1Collections } from "@/lib/collection-d1";
import { siteScope } from "@/lib/site-scope";
export const dynamic="force-dynamic";
const send=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const failure=(e:unknown)=>jsonError(e instanceof CollectionError?new CmsError(e.status,e.message):e);
function kind(request:Request){return kindOf(new URL(request.url).pathname.split('/').filter(Boolean).at(-1));}
async function publication(scope:ReturnType<typeof siteScope>,type:'tour'|'occurrence',id:string){
 if(isCapturedCollection(scope,type,id))return null;const row=await getD1().prepare('SELECT value FROM cms_settings WHERE key=?').bind(publicationKey(scope,type,id)).first<{value:string}>();if(!row)return null;const value=parsePublication(row.value,scope,type,id);return{path:value.path,state:value.state,registration:value.registration};
}
export async function GET(request:Request){
 try {
  await authorizeCmsUser("content");const scope=siteScope(),store=new D1Collections(getD1()),url=new URL(request.url),type=kind(request),id=url.searchParams.get("id");
  if(!url.searchParams.has('id')){
   if([...url.searchParams.keys()].some(key=>!['cursor','limit'].includes(key))||['cursor','limit'].some(key=>url.searchParams.getAll(key).length>1))throw new CmsError(400,'בקשת רשימה אינה תקינה');
   const cursor=url.searchParams.get('cursor'),rawLimit=url.searchParams.get('limit');if(rawLimit!==null&&!/^[1-9]\d*$/.test(rawLimit))throw new CmsError(400,'גודל הרשימה אינו תקין');
   return send(await store.listPage(scope,type,{cursor,...(rawLimit===null?{}:{limit:Number(rawLimit)})}));
  }
  if([...url.searchParams.keys()].some(key=>!['id','history'].includes(key))||url.searchParams.getAll('id').length!==1||url.searchParams.getAll('history').length>1||url.searchParams.has('history')&&url.searchParams.get('history')!=='1')throw new CmsError(400,'בקשת רשומה אינה תקינה');
  const recordId=resourceId(id);
  if(url.searchParams.get("history")==="1")return send({history:await store.history(scope,type,recordId)});
  const record=await store.get(scope,type,recordId);if(!record)throw new CmsError(404,"הרשומה לא נמצאה");return send({record,publication:await publication(scope,type,recordId)});
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
  const scope=siteScope(),type=kind(request),id=resourceId(body.id),record=await service.change(scope,{id:user.userId,canPublish:user.canPublish},type,id,body as Change);
  return send({record,publication:await publication(scope,type,id)});
 }catch(e){return failure(e);}
}
