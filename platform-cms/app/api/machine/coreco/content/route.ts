import { env } from 'cloudflare:workers';
import { getD1, jsonError } from '@/lib/cms';
import { assertIsolatedD1Scope, CmsError } from '@/lib/access';
import { Collections, CollectionError,kindOf,resourceId,type Change } from '@/lib/collection-core';
import { D1Collections } from '@/lib/collection-d1';
import { verifyCorecoBridge, CorecoBridgeError } from '@/lib/coreco-bridge';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  const text=await request.text();if(new TextEncoder().encode(text).length>50000)throw new CmsError(413,'הבקשה גדולה מדי');
  const config=env as unknown as {CORECO_BRIDGE_KEY?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
  const db=getD1();
  const identity=await verifyCorecoBridge(request,text,{key:config.CORECO_BRIDGE_KEY,tenant:config.CMS_TENANT_ID,site:config.CMS_SITE_ID},async(nonce,expires)=>{
   const result=await db.prepare('INSERT OR IGNORE INTO cms_coreco_nonces(nonce,expires_at) VALUES(?,?)').bind(nonce,expires).run();
   await db.prepare('DELETE FROM cms_coreco_nonces WHERE expires_at < ?').bind(Math.floor(Date.now()/1000)).run();
   return result.meta.changes===1;
  });
  await assertIsolatedD1Scope(db);
  let body;try{body=JSON.parse(text);}catch{throw new CmsError(400,'בקשה אינה תקינה');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(x=>!['operation','kind','cursor','id','expectedRevision','content'].includes(x)))throw new CmsError(400,'בקשה אינה תקינה');
  const scope={tenantId:identity.tenant,siteId:identity.site},kind=kindOf(body.kind),store=new D1Collections(db);let result:unknown;
  if(body.operation==='list')result=await store.listPage(scope,kind,{cursor:body.cursor??null,limit:50});
  else if(body.operation==='get')result={record:await store.get(scope,kind,resourceId(body.id))};
  else if(['save','publish'].includes(body.operation)){
   if(body.operation==='publish'&&identity.role!=='admin')throw new CmsError(403,'אין הרשאת פרסום');
   const record=await new Collections(store).change(scope,{id:'coreco:'+identity.actor,canPublish:identity.role==='admin'},kind,resourceId(body.id),{operation:body.operation,expectedRevision:body.expectedRevision,content:body.content} as Change);result={record};
  }else throw new CmsError(400,'פעולה אינה מוכרת');
  return Response.json(result,{headers:{'cache-control':'private, no-store'}});
 }catch(error){return jsonError(error instanceof CorecoBridgeError||error instanceof CollectionError?new CmsError(error.status,error.message):error);}
}
