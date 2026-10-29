import {authorizeCmsUser,CmsError} from '@/lib/access';
import {requireSameOrigin,jsonError,getD1} from '@/lib/cms';
import {CollectionError} from '@/lib/collection-core';
import {D1Collections} from '@/lib/collection-d1';
import {siteScope} from '@/lib/site-scope';
import {sourceRefreshRequest,previewSourceCollectionRefresh,applySourceCollectionRefresh} from '@/lib/source-collection-refresh';
export const dynamic='force-dynamic';
const send=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function body(request:Request){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))throw new CmsError(413,'הבקשה גדולה מדי');
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new CmsError(413,'הבקשה גדולה מדי');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return sourceRefreshRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch(error){if(error instanceof CollectionError)throw error;throw new CmsError(400,'בקשת עדכון אינה תקינה');}
}
export async function POST(request:Request){
 try{
  requireSameOrigin(request);const user=await authorizeCmsUser('publish');
  if(user.role!=='system_admin'||!user.canPublish)throw new CmsError(403,'עדכון תוכן המקור מחייב מנהל מערכת');
  if(new URL(request.url).search)throw new CmsError(400,'בקשת עדכון אינה תקינה');
  const input=await body(request),scope=siteScope(),store=new D1Collections(getD1()),actor={id:user.userId,canPublish:user.canPublish,role:user.role};
  if(input.operation==='preview')return send({plan:await previewSourceCollectionRefresh(store,scope,actor)});
  const result=await applySourceCollectionRefresh(store,scope,actor,input);return send(result,result.complete?200:409);
 }catch(error){return jsonError(error instanceof CollectionError?new CmsError(error.status,error.message):error);}
}
