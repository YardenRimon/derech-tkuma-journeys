/** Server-owned technical limits. No raw IP, name, email or phone is persisted. */
import {ContactError,contactHash,contactScope,type ContactScope} from './contact-core';
export function contactRetentionDays(config:{CONTACT_RETENTION_DAYS?:string}){
 const raw=config.CONTACT_RETENTION_DAYS;
 if(!raw||!/^[1-9]\d{0,3}$/.test(raw)||Number(raw)>3650)throw new ContactError(503,'retention_unconfigured');
 return Number(raw);
}
export async function contactIngress(db:D1Database,scope:ContactScope,request:Request,now=Date.now()){
 contactScope(scope);
 // Only the edge-owned header is used. X-Forwarded-For/client fields cannot
 // select buckets. Workers supplies CF-Connecting-IP at the trusted ingress.
 const ip=request.headers.get('cf-connecting-ip');
 if(!ip||!(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)||/^[a-f0-9:]{3,45}$/i.test(ip)&&ip.includes(':')))throw new ContactError(503,'contact_unavailable');
 const seconds=Math.floor(now/1000);
 const consume=async(label:string,value:string,window:number,limit:number)=>{
  const start=Math.floor(seconds/window)*window;
  const key=await contactHash({scope,label,value,start});
  const row=await db.prepare(`INSERT INTO contact_rate_limits(bucket_key,window_start,attempts,expires_at) VALUES(?,?,1,?)
   ON CONFLICT(bucket_key) DO UPDATE SET attempts=contact_rate_limits.attempts+1 RETURNING attempts`)
   .bind(key,start,start+window).first<{attempts:number}>();
  if(!row||!Number.isSafeInteger(row.attempts))throw new ContactError(503,'contact_unavailable');
  if(row.attempts>limit)throw new ContactError(429,'rate_limited');
 };
 try{
  await db.prepare('DELETE FROM contact_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM contact_rate_limits WHERE expires_at<=? LIMIT 100)').bind(seconds).run();
  await consume('request-ip',ip,60,30);
 }catch(error){if(error instanceof ContactError)throw error;throw new ContactError(503,'contact_unavailable');}
 return async()=>{
  try{
   // A valid existing UUID replay is checked before reserving these counters.
   await consume('new-ip',ip,600,5);
   await consume('new-site','site',3600,200);
  }catch(error){if(error instanceof ContactError)throw error;throw new ContactError(503,'contact_unavailable');}
 };
}
