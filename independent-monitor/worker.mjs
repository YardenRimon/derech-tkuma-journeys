/** Prepared independent owner-only watchdog. Activation requires separate credential approval. */
import calendar from './calendar.json' with {type:'json'};
import {ORIGIN,FIXTURE_ORIGIN,KEYS,FIXTURE_KEYS,MESSAGES,CALENDAR_SHA256,LOOKAHEAD,LEDGER_SCHEMA,SCOPE,calendarAllowed,validCalendar,validLedger,initialLedger,incompleteObservation,transition,claimed,settled,uncertain,frozen} from './policy.mjs';
const textEncoder=new TextEncoder();
const hex=value=>[...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const sha=async text=>hex(await crypto.subtle.digest('SHA-256',textEncoder.encode(text)));
const secretValid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reply=(status,value)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'}});
export async function signature(secret,method,path,timestamp,body=''){
 const key=await crypto.subtle.importKey('raw',textEncoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,textEncoder.encode(`${method}\n${path}\n${timestamp}\n${await sha(body)}`)));
}
function notifyConfig(env){
 const owner=env.OWNER_CHAT_ID,token=env.TELEGRAM_BOT_TOKEN;
 if(typeof owner!=='string'||!/^[1-9]\d{0,15}$/.test(owner)||!Number.isSafeInteger(Number(owner))||typeof token!=='string'||!/^[1-9]\d{4,15}:[A-Za-z0-9_-]{30,80}$/.test(token))return null;
 return {owner,token};
}
function modeOf(env){if(env.FIXTURE_MODE!==undefined&&!['true','false'].includes(env.FIXTURE_MODE))return null;const fixture=env.FIXTURE_MODE==='true';return {fixture,keys:fixture?FIXTURE_KEYS:KEYS,origin:fixture?FIXTURE_ORIGIN:ORIGIN};}
/** Injection is module-only for isolated tests. HTTP requests cannot override any dependency. */
export function createWatchdog({clock=()=>Math.floor(Date.now()/1000),fetchImpl=globalThis.fetch,calendarValue=calendar}={}){
 const verified=Promise.resolve().then(async()=>validCalendar(calendarValue)&&await sha(JSON.stringify(calendarValue)+'\n')===CALENDAR_SHA256).catch(()=>false);
 const allowed=()=>calendarAllowed(calendarValue,clock(),LOOKAHEAD);
 function guard(){if(!allowed())throw Error('policy_closed');}
 async function readObject(bucket,key,max=65536){
  guard();const object=await bucket.get(key);guard();if(!object)return null;
  if(!Number.isSafeInteger(object.size)||object.size<0||object.size>max||typeof object.etag!=='string'||!object.etag||object.etag.length>128)throw Error('object_invalid');
  guard();const raw=await object.text();guard();if(textEncoder.encode(raw).byteLength>max)throw Error('object_invalid');
  return {value:JSON.parse(raw),etag:object.etag};
 }
 async function writeObject(bucket,key,ledger,previous){
  guard();const next={...ledger,revision:(previous?.value.revision??0)+1};
  if(!validLedger(next,next.fixture))throw Error('ledger_invalid');
  guard();const object=await bucket.put(key,JSON.stringify(next),{onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
  if(!object)return null;
  if(typeof object.etag!=='string'||!object.etag)throw Error('commit_unconfirmed');
  return {value:next,etag:object.etag};
 }
 async function providerReceipt(response,owner){
  if(response.status!==200||response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body)throw Error('delivery_unconfirmed');
  const reader=response.body.getReader();let count=0;const chunks=[];
  try{for(;;){guard();const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>8192)throw Error('delivery_unconfirmed');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  guard();const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),result=value?.result;
  if(value?.ok!==true||!Number.isSafeInteger(result?.message_id)||result.message_id<1||!Number.isSafeInteger(result?.chat?.id)||String(result.chat.id)!==owner||result.chat.type!=='private')throw Error('delivery_unconfirmed');
  return {messageId:result.message_id,recipientId:owner};
 }
 async function run(env){
  try{
   const mode=modeOf(env);if(!mode||!env.MONITOR_BUCKET||!await verified)return {state:'internal_only',code:'configuration_invalid'};
   if(!allowed())return {state:'held',code:'time_policy_closed'};
   let previous;try{previous=await readObject(env.MONITOR_BUCKET,mode.keys.ledger);}catch{return {state:allowed()?'internal_only':'held',code:'ledger_unavailable'};}
   let prior=previous?.value??initialLedger(mode.fixture);
   if(!validLedger(prior,mode.fixture))return {state:'internal_only',code:'ledger_invalid'};
   if(frozen(prior))return {state:'frozen',code:'delivery_unconfirmed'};
   const attemptNow=clock();
   if(prior.lastCheck!==null&&attemptNow<=prior.lastCheck)return {state:'internal_only',code:'observation_replayed'};
   if(prior.observationAttempt!==null)prior=incompleteObservation(prior,attemptNow);
   const attempt={...prior,observationAttempt:{id:crypto.randomUUID(),startedAt:attemptNow}};
   let durableAttempt;
   try{durableAttempt=await writeObject(env.MONITOR_BUCKET,mode.keys.ledger,attempt,previous);}catch{return {state:allowed()?'internal_only':'held',code:'observation_attempt_unconfirmed'};}
   if(!durableAttempt)return {state:'internal_only',code:'cas_conflict'};
   let heartbeat=null;try{heartbeat=(await readObject(env.MONITOR_BUCKET,mode.keys.heartbeat,2048))?.value??null;}catch{if(!allowed())return {state:'held',code:'time_policy_closed'};}
   const update=transition(durableAttempt.value,heartbeat,{now:clock(),fixture:mode.fixture});
   if(!update.ledger)return {state:update.state,code:update.reason??'no_change'};
   const config=env.ENABLE_NOTIFY==='true'?notifyConfig(env):null;
   let candidate=update.candidate;
   // A recovery belongs to the same verified personal destination as its opening.
   if(candidate==='recovery'&&config&&update.ledger.incident.opening.recipientId!==config.owner)candidate=null;
   if(!candidate||!config){
    let saved;try{saved=await writeObject(env.MONITOR_BUCKET,mode.keys.ledger,update.ledger,durableAttempt);}catch{return {state:allowed()?'internal_only':'held',code:'observation_unconfirmed'};}
    return {state:saved?update.state:'internal_only',code:saved?(heartbeat===null&&prior.lastCheck===null?'heartbeat_not_initialized':env.ENABLE_NOTIFY==='true'&&!config?'notification_unconfigured':'notification_disabled_or_not_required'):'cas_conflict'};
   }
   const claim=claimed(update.ledger,candidate,clock(),crypto.randomUUID());
   let durable;try{durable=await writeObject(env.MONITOR_BUCKET,mode.keys.ledger,claim,durableAttempt);}catch{return {state:allowed()?'internal_only':'held',code:'claim_unconfirmed'};}
   if(!durable)return {state:'internal_only',code:'cas_conflict'};
   // No retry after a durable sending claim, even on a timeout or uncertain commit.
   let receipt;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
   try{
    guard();const sendNow=clock();
    if(sendNow<update.ledger.lastCheck||sendNow-update.ledger.lastCheck>90||candidate==='recovery'&&(!heartbeat?.ready||sendNow-heartbeat.receivedAt>600))throw Error('observation_expired');
    const message=mode.fixture?MESSAGES[candidate==='opening'?'fixtureOpening':'fixtureRecovery']:MESSAGES[candidate];
    const response=await fetchImpl('https://api.telegram.org/bot'+config.token+'/sendMessage',{method:'POST',redirect:'manual',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:config.owner,text:message,disable_web_page_preview:true,protect_content:true})});
    receipt=await providerReceipt(response,config.owner);
   }catch{
    try{if(allowed())await writeObject(env.MONITOR_BUCKET,mode.keys.ledger,uncertain(durable.value,candidate),durable);}catch{}
    return {state:'frozen',code:'delivery_unconfirmed'};
   }finally{clearTimeout(timer);}
   try{
    guard();const final=settled(durable.value,candidate,receipt,clock());
    // readObject is deliberately not repeated: the claim's returned etag is the CAS boundary.
    const saved=await writeObject(env.MONITOR_BUCKET,mode.keys.ledger,final,durable);
    return saved?{state:candidate==='opening'?'opening_sent':'recovery_sent',code:'positive_private_receipt'}:{state:'frozen',code:'receipt_commit_unconfirmed'};
   }catch{return {state:'frozen',code:'receipt_commit_unconfirmed'};}
  }catch{return {state:'internal_only',code:'unavailable'};}
 }
 async function status(request,env){
  try{
   const mode=modeOf(env),url=new URL(request.url);
   if(!mode||url.origin!==mode.origin||url.pathname!=='/status'||url.search||url.hash)return reply(404,{code:'not_found'});
   if(request.method!=='GET')return reply(405,{code:'method_rejected'});
   if(request.body!==null)return reply(400,{code:'invalid_request'});
   const at=request.headers.get('X-Derech-Heartbeat-Time'),signed=request.headers.get('X-Derech-Heartbeat-Signature'),now=clock();
   if(!/^\d{10}$/.test(at??'')||Math.abs(Number(at)-now)>60||!/^[a-f0-9]{64}$/.test(signed??''))return reply(401,{code:'unauthorized'});
   if(!secretValid(env.WATCHDOG_READ_HMAC)||!env.MONITOR_BUCKET||!await verified)return reply(503,{code:'unavailable'});
   const key=await crypto.subtle.importKey('raw',textEncoder.encode(env.WATCHDOG_READ_HMAC),{name:'HMAC',hash:'SHA-256'},false,['verify']);
   if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signed.match(/../g),part=>parseInt(part,16)),textEncoder.encode(`GET\n/status\n${at}\n${await sha('')}`)))return reply(401,{code:'unauthorized'});
   if(!allowed())return reply(503,{code:'time_policy_closed'});
   const object=await readObject(env.MONITOR_BUCKET,mode.keys.ledger);
   if(!object)return reply(503,{code:'not_initialized'});
   const ledger=object.value;if(!validLedger(ledger,mode.fixture))return reply(503,{code:'unavailable'});
   return reply(200,{schema:LEDGER_SCHEMA,scope:SCOPE,fixture:mode.fixture,revision:ledger.revision,lastCheck:ledger.lastCheck,observationCount:ledger.failures.length,state:frozen(ledger)?'frozen':ledger.incident?'open':'healthy',incident:ledger.incident?{generation:ledger.generation,opening:ledger.incident.opening.state,recovery:ledger.incident.recovery.state}:null,notifyEnabled:env.ENABLE_NOTIFY==='true',notifyConfigured:!!notifyConfig(env)});
  }catch{return reply(503,{code:'unavailable'});}
 }
 return {run,status};
}
const watchdog=createWatchdog();
export default {async scheduled(_controller,env,_context){await watchdog.run(env);},async fetch(request,env){return watchdog.status(request,env);}};
