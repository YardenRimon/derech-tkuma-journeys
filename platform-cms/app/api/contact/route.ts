import {env} from 'cloudflare:workers';
import {assertIsolatedD1Scope} from '@/lib/access';
import {siteScope} from '@/lib/site-scope';
import {Contacts,ContactError,readContactRequest,type ContactConfig} from '@/lib/contact-core';
import {D1Contacts} from '@/lib/contact-d1';
export const dynamic='force-dynamic';
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
export async function POST(request:Request){
 try{
  const config=env as unknown as ContactConfig&{DB?:D1Database};
  // Review and every unset/misspelled mode fail before any read or write.
  const input=await readContactRequest(request,config),scope=siteScope();
  if(scope.tenantId!=='derech'||scope.siteId!=='derech-main'||!config.DB)throw new ContactError(503,'contact_disabled');
  await assertIsolatedD1Scope(config.DB);
  return send(await new Contacts(new D1Contacts(config.DB)).submit(scope,input),202);
 }catch(error){
  // No payload, provider errors, addresses, phone numbers or webhook data in
  // response/logs. Durable storage is never represented as external delivery.
  return send({accepted:false,code:error instanceof ContactError?error.code:'contact_unavailable'},error instanceof ContactError?error.status:503);
 }
}
