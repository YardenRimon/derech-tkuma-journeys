import {env} from 'cloudflare:workers';
import {authorizeCmsUser,authIdColumn,CmsError} from '@/lib/access';
import {siteScope} from '@/lib/site-scope';
import {Contacts,ContactError,readContactJson} from '@/lib/contact-core';
import {D1Contacts} from '@/lib/contact-d1';
import {R2ContactPrivacy} from '@/lib/contact-privacy';
import {contactRetentionDays} from '@/lib/contact-controls';
export const dynamic='force-dynamic';
const send=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
export async function POST(request:Request){
 try{
  const url=new URL(request.url);
  if(url.search||request.headers.get('origin')!==url.origin||!['same-origin','none'].includes(request.headers.get('sec-fetch-site')??'same-origin'))throw new ContactError(403,'origin_rejected');
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new ContactError(415,'json_required');
  const user=await authorizeCmsUser('users');
  if(user.role!=='system_admin')throw new ContactError(403,'contact_forbidden');
  const config=env as unknown as {DB?:D1Database;BUCKET?:R2Bucket;CONTACT_RETENTION_DAYS?:string;CONTACT_PRIVACY_AUTHORITY_ID?:string};
  if(!config.DB)throw new ContactError(503,'contact_unavailable');
  const service=new Contacts(new D1Contacts(config.DB,{email:user.email,userId:user.userId,identityColumn:authIdColumn()}),contactRetentionDays(config),new R2ContactPrivacy(config.BUCKET,config.CONTACT_PRIVACY_AUTHORITY_ID));
  const scope=siteScope(),raw=await readContactJson(request);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ContactError(400,'invalid_submission');
  const body=raw as Record<string,unknown>,allowed=body.action==='read'?['action','key']:body.action==='erase'?['action','key','expectedRevision','confirmed']:body.action==='expire'?['action']:[];
  if(!allowed.length||allowed.some(key=>!Object.hasOwn(body,key))||Object.keys(body).some(key=>!allowed.includes(key)))throw new ContactError(400,'invalid_submission');
  if(body.action==='expire')return send(await service.expire(scope,2));
  if(typeof body.key!=='string')throw new ContactError(400,'invalid_idempotency_key');
  if(body.action==='read')return send({record:await service.read(scope,body.key)});
  if(body.confirmed!==true||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<1)throw new ContactError(400,'erasure_confirmation_required');
  return send({record:await service.erase(scope,body.key,body.expectedRevision as number,'requested',new Date(),user.userId)});
 }catch(error){
  const status=error instanceof ContactError||error instanceof CmsError?error.status:503;
  return send({accepted:false,code:error instanceof ContactError?error.code:status===401?'contact_unauthenticated':status===403?'contact_forbidden':'contact_unavailable'},status);
 }
}
