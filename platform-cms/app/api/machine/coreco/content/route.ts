import { env } from 'cloudflare:workers';
import { getD1, jsonError, listPages, getBasePage, getPageRow, compatibleStoredDraft, emptyDraft, renderDocument, applyPublishedCollections } from '@/lib/cms';
import { assertIsolatedD1Scope, CmsError } from '@/lib/access';
import { Collections, CollectionError,kindOf,resourceId,type Change } from '@/lib/collection-core';
import { D1Collections } from '@/lib/collection-d1';
import { verifyCorecoBridge, CorecoBridgeError,consumeCorecoNonce } from '@/lib/coreco-bridge';
import {cmsEditorGet,cmsEditorPost} from '@/app/api/cms/[...action]/route';
import {Tasks,TaskError,taskId} from '@/lib/task-core';
import {D1Tasks} from '@/lib/task-d1';
import {operationalReport,ReportError} from '@/lib/report-core';
import {ExecutionStore} from '@/lib/execution-core';
import {SeoDraftStore} from '@/lib/seo-draft-core';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  const text=await request.text();if(new TextEncoder().encode(text).length>8*1024*1024)throw new CmsError(413,'הבקשה גדולה מדי');
  const config=env as unknown as {CORECO_BRIDGE_KEY?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
  const db=getD1();
  const identity=await verifyCorecoBridge(request,text,{key:config.CORECO_BRIDGE_KEY,tenant:config.CMS_TENANT_ID,site:config.CMS_SITE_ID,maxBytes:8*1024*1024},(nonce,expires)=>consumeCorecoNonce(db,nonce,expires));
  await assertIsolatedD1Scope(db);
  let body;try{body=JSON.parse(text);}catch{throw new CmsError(400,'בקשה אינה תקינה');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(x=>!['operation','kind','cursor','id','expectedRevision','content','action','slug','revision','draft','discardStale','version','contentType','data','answer','requestedStatus','key','effectKey'].includes(x)))throw new CmsError(400,'בקשה אינה תקינה');
  const scope={tenantId:identity.tenant,siteId:identity.site};
  const actor={userId:'coreco:'+identity.actor,role:identity.role==='admin'?'system_admin':'content_editor',canPublish:identity.role==='admin'};
  if(body.operation==='editor'){
   if(!['pages','page','history','save','publish','rollback','upload','render'].includes(body.action))throw new CmsError(400,'פעולה אינה מוכרת');
   if(body.action==='pages')return Response.json({pages:listPages()},{headers:{'cache-control':'private, no-store'}});
   if(['publish','rollback'].includes(body.action)&&!actor.canPublish)throw new CmsError(403,'אין הרשאת פרסום');
   if(body.action==='render'){
    const base=getBasePage(String(body.slug??'/')),row=await getPageRow(String(body.slug??'/'));
    const draft=row?compatibleStoredDraft(base,row.draft_json).draft:emptyDraft(base);
    return Response.json({html:await applyPublishedCollections(await renderDocument(base,draft),String(body.slug??'/'))},{headers:{'cache-control':'private, no-store'}});
   }
   const url=new URL('/api/cms/'+body.action+'/',request.url);url.searchParams.set('slug',String(body.slug??'/'));
   if(['page','history'].includes(body.action))return cmsEditorGet(new Request(url),actor);
   let payload:BodyInit,contentType='application/json';
   if(body.action==='upload'){
    if(typeof body.data!=='string'||body.data.length>7*1024*1024||!(/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))||typeof body.contentType!=='string')throw new CmsError(400,'קובץ אינו תקין');
    let raw:string;try{raw=atob(body.data);}catch{throw new CmsError(400,'קובץ אינו תקין');}
    if(raw.length>5*1024*1024)throw new CmsError(413,'התמונה גדולה מ־5MB');
    payload=Uint8Array.from(raw,c=>c.charCodeAt(0));contentType=body.contentType;
   }else{
    if(new TextEncoder().encode(text).length>500000)throw new CmsError(413,'הבקשה גדולה מדי');
    payload=JSON.stringify({slug:body.slug,revision:body.revision,draft:body.draft,discardStale:body.discardStale,version:body.version});
   }
   return cmsEditorPost(new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':contentType},body:payload}),actor);
  }
  if(body.operation==='operator'){
   if(identity.operator!==true||identity.role!=='admin')throw new CmsError(403,'נדרשת הרשאת מנהל מערכת');
   if(body.action==='reports')return Response.json(await operationalReport(db,scope,true),{headers:{'cache-control':'private, no-store'}});
   if(body.action==='execution'){
    const rows=await db.prepare("SELECT value FROM cms_settings WHERE key LIKE 'cms_execution:%' ORDER BY key LIMIT 200").all<{value:string}>();
    const seo=new SeoDraftStore(db),drafts=await seo.listDrafts(scope);
    return Response.json({receipts:rows.results.map(r=>JSON.parse(r.value)),proposals:await Promise.all(drafts.map(d=>seo.readback(scope,d.tourId)))},{headers:{'cache-control':'private, no-store'}});
   }
   if(body.action==='rollback'){
    if(typeof body.effectKey!=='string'||!(/^[a-f0-9]{64}$/.test(body.effectKey))||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)throw new CmsError(400,'בקשת שחזור אינה תקינה');
    const seo=new SeoDraftStore(db),receipt=await seo.receipt(scope,body.effectKey)?await seo.rollbackSeo(scope,body.effectKey,body.expectedRevision,actor.userId):await new ExecutionStore(db).rollback(scope,body.effectKey,body.expectedRevision,actor.userId);
    return Response.json({receipt},{headers:{'cache-control':'private, no-store'}});
   }
   throw new CmsError(400,'פעולה אינה מוכרת');
  }
  if(body.operation==='tasks'){
   if(!identity.email)throw new CmsError(403,'כתובת המשתמש חסרה');
   const taskActor={email:identity.email,isAdmin:identity.role==='admin'},taskStore=new D1Tasks(db),service=new Tasks(taskStore);
   if(body.action==='list')return Response.json({records:await taskStore.list(scope,taskActor)},{headers:{'cache-control':'private, no-store'}});
   const id=taskId(body.id);
   if(body.action==='get')return Response.json({record:await service.readable(scope,taskActor,id),commands:await taskStore.commands(scope,id),history:await taskStore.history(scope,id)},{headers:{'cache-control':'private, no-store'}});
   if(body.action==='request')return Response.json({command:await service.request(scope,taskActor,id,{expectedRevision:body.expectedRevision,key:body.key,answer:body.answer,requestedStatus:body.requestedStatus}),message:'התשובה נשמרה וממתינה לסנכרון עם מקור המשימות'},{status:202,headers:{'cache-control':'private, no-store'}});
   throw new CmsError(400,'פעולה אינה מוכרת');
  }
  if(new TextEncoder().encode(text).length>50000)throw new CmsError(413,'הבקשה גדולה מדי');
  const kind=kindOf(body.kind),store=new D1Collections(db);let result:unknown;
  if(body.operation==='list')result=await store.listPage(scope,kind,{cursor:body.cursor??null,limit:50});
  else if(body.operation==='get')result={record:await store.get(scope,kind,resourceId(body.id))};
  else if(['save','publish'].includes(body.operation)){
   if(body.operation==='publish'&&identity.role!=='admin')throw new CmsError(403,'אין הרשאת פרסום');
   const record=await new Collections(store).change(scope,{id:'coreco:'+identity.actor,canPublish:identity.role==='admin'},kind,resourceId(body.id),{operation:body.operation,expectedRevision:body.expectedRevision,content:body.content} as Change);result={record};
  }else throw new CmsError(400,'פעולה אינה מוכרת');
  return Response.json(result,{headers:{'cache-control':'private, no-store'}});
 }catch(error){return jsonError(error instanceof CorecoBridgeError||error instanceof CollectionError||error instanceof TaskError||error instanceof ReportError?new CmsError(error.status,error.message):error);}
}
