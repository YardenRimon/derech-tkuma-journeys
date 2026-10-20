/** Root-owned schema: platform_auth_rate_limits(bucket_key PK,window_start,
 * attempts,expires_at). All keys are SHA256 fingerprints, never passwords/OTP. */
import{authFailure}from'./platform-auth-core';
import type{PlatformAuthLimiter}from'./platform-auth-service';
export function platformAuthRateLimiter(db:D1Database|undefined,now=()=>Date.now()):PlatformAuthLimiter{
 return async(request,action,actor)=>{
  if(!db)return authFailure(503,'auth_unavailable');
  const rawIp=request.headers.get('cf-connecting-ip')??'unknown',ip=/^[0-9a-f:.]{3,64}$/i.test(rawIp)?rawIp:'unknown';
  const operation=action.replace(/^request\//,'');
  const rules=[{label:'ip:'+action,value:ip,window:60,limit:operation==='session'?60:operation.startsWith('mfa/')?10:15}];
  if(actor)rules.push({label:'actor:'+action,value:actor,window:action==='otp/send'||action==='password'?600:300,limit:5});
  try{
   // One bounded collection pass per sensitive ingress attempt. Session reads
   // and the later account/subject counters do not repeat this maintenance.
   if(action.startsWith('request/')||action==='oauth-callback'){
    const cleanup=await db.prepare('DELETE FROM platform_auth_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM platform_auth_rate_limits WHERE expires_at < ? LIMIT 100)').bind(Math.floor(now()/1000)).run();
    if(!cleanup.success)return authFailure(503,'auth_unavailable');
   }
   for(const rule of rules){const start=Math.floor(now()/1000/rule.window)*rule.window,bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rule.label+'\n'+rule.value)),key=[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
   const result=await db.prepare('INSERT INTO platform_auth_rate_limits(bucket_key,window_start,attempts,expires_at) VALUES(?,?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN platform_auth_rate_limits.window_start=excluded.window_start THEN platform_auth_rate_limits.attempts+1 ELSE 1 END,window_start=excluded.window_start,expires_at=excluded.expires_at RETURNING attempts').bind(key,start,start+rule.window).first<{attempts:number}>();
   if(!result||!Number.isSafeInteger(result.attempts))return authFailure(503,'auth_unavailable');if(result.attempts>rule.limit)return authFailure(429,'rate_limited');
  }}catch(error){if(error instanceof Error&&error.message==='rate_limited')throw error;return authFailure(503,'auth_unavailable');}
 };
}
