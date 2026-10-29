/** Distinct cart abuse buckets in the existing transient table; no queue/timer. */
import {CartError} from './cart-core';
import type {CartScope} from './cart-d1';
const validIp=(ip:string)=>/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)&&ip.split('.').every(part=>Number(part)<=255)||/^[a-f0-9:]{3,45}$/i.test(ip)&&ip.includes(':');
export async function cartIngress(db:D1Database,scope:CartScope,request:Request,kind:'read'|'write',now=Date.now()){
 if(scope.tenantId!=='derech'||scope.siteId!=='derech-main'||!Number.isSafeInteger(now)||now<0)throw new CartError(503,'cart_ingress_unavailable');
 const ip=request.headers.get('cf-connecting-ip');if(!ip||!validIp(ip))throw new CartError(503,'cart_ingress_unavailable');
 const seconds=Math.floor(now/1000);
 async function consume(label:string,value:string,window:number,limit:number){
  const start=Math.floor(seconds/window)*window,raw=JSON.stringify({scope,purpose:'guest-cart/v1',label,value,start});
  const key=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const row=await db.prepare('INSERT INTO contact_rate_limits(bucket_key,window_start,attempts,expires_at) VALUES(?,?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=contact_rate_limits.attempts+1 RETURNING attempts').bind(key,start,start+window).first<{attempts:number}>();
  if(!row||!Number.isSafeInteger(row.attempts))throw new CartError(503,'cart_ingress_unavailable');if(row.attempts>limit)throw new CartError(429,'cart_rate_limited');
 }
 try{
  await db.prepare('DELETE FROM contact_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM contact_rate_limits WHERE expires_at<=? LIMIT 50)').bind(seconds).run();
  await consume(kind+'-ip',ip,60,kind==='read'?120:60);
  await consume(kind+'-site','site',60,kind==='read'?1200:600);
 }catch(error){if(error instanceof CartError)throw error;throw new CartError(503,'cart_ingress_unavailable');}
 return async()=>{try{await consume('new-ip',ip,600,5);await consume('new-site','site',3600,200);}catch(error){if(error instanceof CartError)throw error;throw new CartError(503,'cart_ingress_unavailable');}};
}
