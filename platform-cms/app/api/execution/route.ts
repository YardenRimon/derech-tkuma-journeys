import {env} from 'cloudflare:workers';
import {authorizeCmsUser,assertIsolatedD1Scope,CmsError} from '@/lib/access';
import {getD1,jsonError,requireSameOrigin} from '@/lib/cms';
import {siteScope} from '@/lib/site-scope';
import {CollectionError,Collections} from '@/lib/collection-core';
import {ExecutionStore,verifySignature,effectOf,hash} from '@/lib/execution-core';
import seed from '@/lib/current-collections.json';
import {SeoDraftStore} from '@/lib/seo-draft-core';
import {maintainContacts} from '@/lib/contact-maintenance';
import {dispatchOneContact,type ContactDeliveryConfig} from '@/lib/contact-execution';
import {ContactError} from '@/lib/contact-core';
import {D1Tasks} from '@/lib/task-d1';
import {Tasks,TaskError,type TaskReceipt} from '@/lib/task-core';
import {parseExecutionMirror} from '@/lib/report-core';
export const dynamic='force-dynamic';
const send=(x:unknown,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
export async function GET(request:Request){try{await authorizeCmsUser('users');const params=new URL(request.url).searchParams,db=getD1(),scope=siteScope(),seo=new SeoDraftStore(db);
 if(params.has('seoTourId')){if(params.size!==1)throw new CmsError(400,'בקשת SEO אינה תקינה');return send(await seo.readback(scope,params.get('seoTourId')!));}
 const key=params.get('effectKey');if(params.size!==1||!key||!/^[a-f0-9]{64}$/.test(key))throw new CmsError(400,'מפתח ביצוע אינו תקין');return send({receipt:await new ExecutionStore(db).receipt(key)??await seo.receipt(scope,key)});
 }catch(e){return failure(e);}}
export async function POST(request:Request){
 let release:(()=>Promise<unknown>)|undefined;
 try{
  const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000){await reader.cancel();throw new CmsError(413,'הבקשה גדולה מדי');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const raw=new TextDecoder().decode(bytes);
  let body;try{body=JSON.parse(raw);}catch{throw new CmsError(400,'בקשה אינה תקינה');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new CmsError(400,'בקשה אינה תקינה');
  const db=getD1(),scope=siteScope(),store=new ExecutionStore(db);
  if(body.operation==='rollback'){
   requireSameOrigin(request);const user=await authorizeCmsUser('users');
   const seo=new SeoDraftStore(db);return send({receipt:await seo.receipt(scope,body.effectKey)?await seo.rollbackSeo(scope,body.effectKey,body.expectedRevision,user.userId):await store.rollback(scope,body.effectKey,body.expectedRevision,user.userId)});
  }
  await verifySignature(raw,request.headers.get('x-bridge-time'),request.headers.get('x-bridge-signature'),(env as unknown as {CMS_EXECUTION_SECRET?:string}).CMS_EXECUTION_SECRET);
  await assertIsolatedD1Scope(db);
  if(scope.tenantId!=='derech'||scope.siteId!=='derech-main')throw new CmsError(403,'חיבור השרת אינו שייך לאתר');
  if(body.schemaVersion!==1||Object.keys(body).some(k=>!['schemaVersion','tasks','effects','report','commandReceipts'].includes(k))||!Array.isArray(body.tasks)||body.tasks.length>200||!Array.isArray(body.effects)||body.effects.length>20||!Array.isArray(body.commandReceipts??[])||(body.commandReceipts??[]).length>200)throw new CmsError(400,'תמונת השרת אינה תקינה');
  const report=parseExecutionMirror(JSON.stringify(body.report),scope);
  if(!report)throw new CmsError(400,'דוח השרת אינו תקין');
  // Serialize machine requests even when a client times out while D1 continues.
  // An expired signed packet cannot roll the task projection backwards.
  const token=crypto.randomUUID(),now=Date.now(),lockValue=JSON.stringify({token,expires:now+120000});
  const lock=await db.batch([
   db.prepare("DELETE FROM cms_settings WHERE key='execution_gateway_lock' AND json_extract(value,'$.expires')<?").bind(now),
   db.prepare("INSERT OR IGNORE INTO cms_settings(key,value) VALUES('execution_gateway_lock',?)").bind(lockValue)
  ]);
  if(lock[1].meta.changes!==1)throw new CmsError(409,'סנכרון קודם עדיין בעבודה');
  release=()=>db.prepare("DELETE FROM cms_settings WHERE key='execution_gateway_lock' AND value=?").bind(lockValue).run();
  const checkpoint=await db.prepare("SELECT value FROM cms_settings WHERE key='execution_gateway_checkpoint'").first<{value:string}>();
  if(checkpoint&&Number(checkpoint.value)>Number(request.headers.get('x-bridge-time')))throw new CmsError(409,'תמונת השרת ישנה מסנכרון קודם');
  const contactConfig=env as unknown as ContactDeliveryConfig&{BUCKET?:R2Bucket};
  // Bounded maintenance shares the authenticated scope and existing request lock.
  await maintainContacts(db,contactConfig.BUCKET,scope,contactConfig);
  await dispatchOneContact(db,contactConfig.BUCKET,scope,contactConfig);
  const tasksStore=new D1Tasks(db),tasks=new Tasks(tasksStore),actor={email:'service:execution@derech.invalid',isAdmin:true},taskResults=[];
  for(const snapshot of body.tasks){
   const previous=await tasksStore.get(scope,String(snapshot.externalId));
   const pending=await tasksStore.commands(scope,String(snapshot.externalId));
   const receipts=(body.commandReceipts??[]).filter((r:TaskReceipt)=>pending.some(c=>c.key===r.key&&c.state==='pending'));
   try{const record=await tasks.import(scope,actor,snapshot,previous?.revision??0,receipts);taskResults.push({id:snapshot.externalId,revision:record.revision});}
   catch(e){if(e instanceof TaskError&&e.status===409)taskResults.push({id:snapshot.externalId,state:'conflict'});else throw e;}
  }
  const receipts=[];
  for(const effect of body.effects){try{
   if(effect?.kind==='seo_draft'){receipts.push(await new SeoDraftStore(db).applySeo(scope,effect));continue;}
   const checked=effectOf(effect);
   if(!await store.get(scope,'tour',checked.target)){
    const initial=seed.records.find(x=>x.kind==='tour'&&x.id===checked.target);
    if(!initial||await hash(initial.content)!==await hash(checked.before))throw new CollectionError(409,'גרסת המקור אינה תואמת ל־CMS');
    await new Collections(store).change(scope,{id:'service:approved-source-seed',canPublish:false},'tour',checked.target,{operation:'save',expectedRevision:0,content:initial.content});
   }
   receipts.push(await store.apply(scope,checked));
  }catch(e){if(e instanceof CollectionError&&(e.status===409||e.status===403))receipts.push({effectKey:effect.effectKey,state:e.status===409?'conflict':'rejected',note:e.message});else throw e;}}
  await db.prepare("INSERT INTO cms_settings(key,value) VALUES('server_execution_report_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(report)).run();
  await db.prepare("INSERT INTO cms_settings(key,value) VALUES('execution_gateway_checkpoint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(request.headers.get('x-bridge-time')).run();
  return send({receipts,commands:(await tasksStore.commands(scope)).filter(c=>c.state==='pending'),tasks:taskResults,receivedAt:new Date().toISOString()});
 }catch(e){return failure(e);}finally{if(release)await release();}
}
function failure(e:unknown){return jsonError(e instanceof CollectionError||e instanceof TaskError||e instanceof ContactError?new CmsError(e.status,e.message):e);}
