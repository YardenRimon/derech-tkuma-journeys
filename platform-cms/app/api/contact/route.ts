import {NATIVE_FORM_REPLACEMENT_ENABLED,frozenBusinessResponse} from '@/lib/business-scope';
import {env} from 'cloudflare:workers';
import {assertIsolatedD1Scope} from '@/lib/access';
import {siteScope} from '@/lib/site-scope';
import {Contacts,ContactError,checkContactRequest,readContactJson,type ContactConfig} from '@/lib/contact-core';
import {D1Contacts} from '@/lib/contact-d1';
import {R2ContactPrivacy} from '@/lib/contact-privacy';
import {contactIngress,contactRetentionDays} from '@/lib/contact-controls';
export const dynamic='force-dynamic';
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow',...(status===429?{'retry-after':'60'}:{})}});
export async function POST(request:Request){if(!NATIVE_FORM_REPLACEMENT_ENABLED)return frozenBusinessResponse();
 try{
  const config=env as unknown as ContactConfig&{DB?:D1Database;BUCKET?:R2Bucket;CONTACT_RETENTION_DAYS?:string;CONTACT_PRIVACY_AUTHORITY_ID?:string};
  checkContactRequest(request,config);
  const days=contactRetentionDays(config),scope=siteScope();
  if(scope.tenantId!=='derech'||scope.siteId!=='derech-main'||!config.DB)throw new ContactError(503,'contact_disabled');
  await assertIsolatedD1Scope(config.DB);
  const reserveNew=await contactIngress(config.DB,scope,request);
  const input=await readContactJson(request),service=new Contacts(new D1Contacts(config.DB),days,new R2ContactPrivacy(config.BUCKET,config.CONTACT_PRIVACY_AUTHORITY_ID));
  await service.expire(scope,2);
  return send(await service.submit(scope,input,new Date(),reserveNew),202);
 }catch(error){
  return send({accepted:false,code:error instanceof ContactError?error.code:'contact_unavailable'},error instanceof ContactError?error.status:503);
 }
}
