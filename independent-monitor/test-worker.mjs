import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import calendar from './calendar.json' with {type:'json'};
import {createWatchdog,signature} from './worker.mjs';
import {KEYS,FIXTURE_KEYS,ORIGIN,FIXTURE_ORIGIN,MESSAGES,CALENDAR_SHA256,calendarAllowed,initialLedger,validLedger,transition,HEARTBEAT_SCHEMA} from './policy.mjs';
const tests=[];const test=(name,body)=>tests.push([name,body]);
const BASE=1792522800,OWNER='123456789',TOKEN='123456:'+ 'A'.repeat(35),SECRET='b'.repeat(64);
assert(calendarAllowed(calendar,BASE));
const heartbeat=(at,ready=true)=>({schema:HEARTBEAT_SCHEMA,observedAt:at,receivedAt:at,ready});
class Bucket{
 constructor(){this.rows=new Map();this.version=0;this.reads=[];this.writes=[];this.getHook=null;this.putHook=null;}
 seed(key,value){this.rows.set(key,{raw:typeof value==='string'?value:JSON.stringify(value),etag:String(++this.version)});}
 value(key){const row=this.rows.get(key);return row?JSON.parse(row.raw):null;}
 async get(key){this.reads.push(key);if(this.getHook)await this.getHook(key);const row=this.rows.get(key);return row?{etag:row.etag,size:Buffer.byteLength(row.raw),text:async()=>row.raw}:null;}
 async put(key,raw,options){this.writes.push(key);if(this.putHook)await this.putHook(key,raw,options,'before');const prior=this.rows.get(key);assert(options.onlyIf);if(prior?options.onlyIf.etagMatches!==prior.etag:options.onlyIf.etagDoesNotMatch!=='*')return null;const row={raw,etag:String(++this.version)};this.rows.set(key,row);if(this.putHook)await this.putHook(key,raw,options,'after');return {etag:row.etag};}
}
function scenario({enabled='true',fixture=true,at=BASE,fetchImpl}={}){
 let now=at;const bucket=new Bucket(),keys=fixture?FIXTURE_KEYS:KEYS,calls=[];
 const env={MONITOR_BUCKET:bucket,FIXTURE_MODE:fixture?'true':'false',ENABLE_NOTIFY:enabled,OWNER_CHAT_ID:OWNER,TELEGRAM_BOT_TOKEN:TOKEN,WATCHDOG_READ_HMAC:SECRET};
 const transport=async(url,options)=>{calls.push({url,options});if(fetchImpl)return fetchImpl(url,options,calls.length);return Response.json({ok:true,result:{message_id:calls.length,chat:{id:Number(OWNER),type:'private'}}});};
 const monitor=createWatchdog({clock:()=>now,fetchImpl:transport});
 return {env,bucket,keys,calls,monitor,get now(){return now;},set now(value){now=value;},setHeartbeat(at,ready){bucket.seed(keys.heartbeat,heartbeat(at,ready));},run(){return monitor.run(env);},ledger(){return bucket.value(keys.ledger);}};
}
async function opening(s,{at=BASE,ready=false,stale=false}={}){s.setHeartbeat(stale?at-1000:at-100,ready);for(const time of [at,at+450,at+900]){s.now=time;await s.run();}return s.ledger();}
async function request(s,{path='/status',origin=s.env.FIXTURE_MODE==='true'?FIXTURE_ORIGIN:ORIGIN,method='GET',at=s.now,key=SECRET,signed=true}={}){const headers=signed?{'X-Derech-Heartbeat-Time':String(at),'X-Derech-Heartbeat-Signature':await signature(key,method,path,String(at))}:{};return new Request(origin+path,{method,headers});}

test('calendar exact SHA, closures/lookahead, expired or malformed fail closed without I/O',async()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(calendar)+'\n').digest('hex'),CALENDAR_SHA256);
 for(const [start,end] of calendar.closed){assert.equal(calendarAllowed(calendar,start-12),false);assert.equal(calendarAllowed(calendar,start),false);assert.equal(calendarAllowed(calendar,end-1),false);assert.equal(calendarAllowed(calendar,end),true);}
 for(const at of [calendar.validFrom-1,calendar.validUntil,calendar.closed[0][0]]){const s=scenario({at});assert.equal((await s.run()).state,'held');assert.equal(s.bucket.reads.length+s.bucket.writes.length+s.calls.length,0);}
 const s=scenario(),bad=structuredClone(calendar);bad.closed[0][0]++;const monitor=createWatchdog({clock:()=>BASE,calendarValue:bad,fetchImpl:()=>{throw Error('must not send');}});assert.equal((await monitor.run(s.env)).state,'internal_only');assert.equal(s.bucket.reads.length,0);
});
test('missing/malformed initialization is internal only, never outage evidence',async()=>{
 const s=scenario();assert.equal((await s.run()).code,'heartbeat_not_initialized');assert.equal(s.ledger()?.incident??null,null);assert.equal(s.ledger()?.lastCheck??null,null);
 for(const value of ['bad-json',{schema:HEARTBEAT_SCHEMA,observedAt:BASE,receivedAt:BASE,ready:true,email:'private-canary'},{...heartbeat(BASE),ready:'yes'},heartbeat(BASE+1)]){s.bucket.seed(s.keys.heartbeat,value);assert.equal((await s.run()).state,'internal_only');assert.equal(s.ledger()?.incident??null,null);assert.equal(s.ledger()?.lastCheck??null,null);}
 assert.equal(s.calls.length,0);
});
test('disabled by default: stale source persists observations and pending incident without sends',async()=>{
 const s=scenario({enabled:undefined});delete s.env.ENABLE_NOTIFY;await opening(s,{ready:true,stale:true});assert.equal(s.calls.length,0);assert.equal(s.ledger().incident.opening.state,'pending');assert.equal(s.ledger().failures.length,3);assert.equal(s.ledger().generation,1);assert.equal(validLedger(s.ledger(),true),true);
});
test('ready=false needs distinct observations spanning900sec, not one read or repeated clock',async()=>{
 const s=scenario();s.setHeartbeat(BASE-10,false);s.now=BASE;await s.run();const revision=s.ledger().revision;await s.run();assert.equal(s.ledger().revision,revision);s.now=BASE+450;await s.run();assert.equal(s.calls.length,0);s.now=BASE+899;await s.run();assert.equal(s.calls.length,0);s.now=BASE+900;await s.run();assert.equal(s.calls.length,1);assert.equal(s.ledger().incident.opening.state,'sent');
});
test('gaps>720sec and unknown/malformed/regressed observations reset evidence',async()=>{
 for(const unknown of ['missing','throws','malformed','regressed']){
  const s=scenario();s.setHeartbeat(BASE-10,false);await s.run();s.now=BASE+450;await s.run();
  if(unknown==='missing')s.bucket.rows.delete(s.keys.heartbeat);
  if(unknown==='throws')s.bucket.getHook=key=>{if(key===s.keys.heartbeat)throw Error('token/private-canary');};
  if(unknown==='malformed')s.bucket.seed(s.keys.heartbeat,'{bad-json-private-canary');
  if(unknown==='regressed')s.setHeartbeat(BASE-11,false);
  s.now=BASE+600;assert.equal((await s.run()).state,'internal_only');assert.equal(s.ledger().failures.length,0);assert.equal(s.calls.length,0);
 }
 const s=scenario();s.setHeartbeat(BASE-100,false);await s.run();s.now=BASE+450;await s.run();s.now=BASE+1300;await s.run();assert.equal(s.ledger().failures.length,1);assert.equal(s.calls.length,0);
});
test('pending unsent incidents cancel after unknown/gaps and require3new observations over900sec',async()=>{
 for(const mode of ['unknown','gap','sacred_reopening']){
  const at=mode==='sacred_reopening'?calendar.closed[0][0]-2000:BASE;
  const s=scenario({enabled:'false',at});await opening(s,{at});assert.equal(s.ledger().incident.opening.state,'pending');
  if(mode==='unknown'){s.bucket.rows.delete(s.keys.heartbeat);s.now=at+1000;await s.run();s.setHeartbeat(s.now-10,false);s.now=at+1100;}
  if(mode==='gap')s.now=at+1800;
  if(mode==='sacred_reopening')s.now=calendar.closed[0][1]+1;
  s.env.ENABLE_NOTIFY='true';const first=s.now;await s.run();assert.equal(s.calls.length,0);assert.equal(s.ledger().history[0].reason,'observation_lost_before_notice');assert.equal(s.ledger().incident,null);
  s.now=first+450;await s.run();assert.equal(s.calls.length,0);s.now=first+900;await s.run();assert.equal(s.calls.length,1);assert.equal(s.ledger().generation,2);
 }
});
test('durable observation attempt resets evidence after read failure plus failed reset write or crash',async()=>{
 for(const failure of ['read_and_commit','crash_after_attempt']){
  const s=scenario({enabled:'false'});await opening(s);assert.equal(s.ledger().incident.opening.state,'pending');s.now=BASE+1200;
  if(failure==='read_and_commit'){
   s.bucket.getHook=key=>{if(key===s.keys.heartbeat)throw Error('heartbeat read failed');};
   s.bucket.putHook=(_key,raw,_options,phase)=>{if(phase==='before'&&JSON.parse(raw).observationAttempt===null)throw Error('reset commit failed');};
  }else s.bucket.putHook=(_key,raw,_options,phase)=>{if(phase==='after'&&JSON.parse(raw).observationAttempt!==null)throw Error('attempt ACK lost');};
  const outcome=await s.run();assert.equal(outcome.state,'internal_only');assert(s.ledger().observationAttempt);assert.equal(s.calls.length,0);
  s.bucket.getHook=null;s.bucket.putHook=null;s.env.ENABLE_NOTIFY='true';s.now=BASE+1500;await s.run();assert.equal(s.calls.length,0);assert.equal(s.ledger().observationAttempt,null);assert.equal(s.ledger().history[0].reason,'observation_lost_before_notice');assert.equal(s.ledger().incident,null);assert.equal(s.ledger().failures.length,1);
  s.now=BASE+1950;await s.run();assert.equal(s.calls.length,0);s.now=BASE+2400;await s.run();assert.equal(s.calls.length,1);assert.equal(s.ledger().generation,2);
 }
});
test('three fresh trusted stale reads trigger one fixed owner-only opening; fixture labeling is fixed',async()=>{
 const s=scenario();await opening(s,{ready:true,stale:true});assert.equal(s.calls.length,1);const call=s.calls[0];assert.equal(call.url,'https://api.telegram.org/bot'+TOKEN+'/sendMessage');assert.equal(call.options.redirect,'manual');const body=JSON.parse(call.options.body);assert.deepEqual(body,{chat_id:OWNER,text:MESSAGES.fixtureOpening,disable_web_page_preview:true,protect_content:true});assert(!body.text.includes(OWNER));
 for(const offset of [1200,1500,1800]){s.now=BASE+offset;await s.run();}assert.equal(s.calls.length,1);
});
test('concurrent schedules lose CAS before send and cannot duplicate opening',async()=>{
 const s=scenario();s.setHeartbeat(BASE-100,false);await s.run();s.now=BASE+450;await s.run();s.now=BASE+900;await Promise.all([s.run(),s.run(),s.run()]);assert.equal(s.calls.length,1);assert.equal(s.ledger().incident.opening.state,'sent');
});
test('persisted sending claim is visible before network',async()=>{
 const s=scenario({fetchImpl:async()=>{assert.equal(s.ledger().incident.opening.state,'sending');return Response.json({ok:true,result:{message_id:1,chat:{id:Number(OWNER),type:'private'}}});}});await opening(s);assert.equal(s.calls.length,1);
});
test('unknown network and provider results freeze incident; no automatic resend',async()=>{
 const invalid=[()=>{throw Error('URL '+TOKEN+' private-canary');},()=>Response.json({ok:false,description:'secret-canary'}),()=>Response.json({ok:true,result:{message_id:0,chat:{id:Number(OWNER),type:'private'}}}),()=>Response.json({ok:true,result:{message_id:1,chat:{id:Number(OWNER)+1,type:'private'}}}),()=>Response.json({ok:true,result:{message_id:1,chat:{id:-Number(OWNER),type:'group'}}}),()=>Response.json({ok:true,result:{message_id:1,chat:{id:Number(OWNER),type:'group'}}}),()=>new Response('canary',{status:302,headers:{location:'https://foreign.invalid'}}),()=>new Response('x'.repeat(8193),{headers:{'content-type':'application/json'}})];
 for(const response of invalid){const s=scenario({fetchImpl:response});await opening(s);assert.equal(s.ledger().incident.opening.state,'uncertain');s.now=BASE+1200;s.setHeartbeat(s.now,true);const result=await s.run();assert.equal(result.state,'frozen');assert(!JSON.stringify(result).includes('canary'));assert.equal(s.calls.length,1);}
});
test('post-success receipt commit loss leaves sending frozen and never resends',async()=>{
 const s=scenario();s.bucket.putHook=(_key,raw,_options,phase)=>{if(phase==='before'&&JSON.parse(raw).incident?.opening.state==='sent')throw Error('commit token '+TOKEN);};await opening(s);assert.equal(s.calls.length,1);assert.equal(s.ledger().incident.opening.state,'sending');s.now=BASE+1200;assert.equal((await s.run()).state,'frozen');assert.equal(s.calls.length,1);
});
test('claim write failure (including lost ACK) prevents transport',async()=>{
 for(const phase of ['before','after']){const s=scenario();s.bucket.putHook=(_key,raw,_options,at)=>{if(at===phase&&JSON.parse(raw).incident?.opening.state==='sending')throw Error('claim-lost');};await opening(s);assert.equal(s.calls.length,0);if(phase==='after'){assert.equal(s.ledger().incident.opening.state,'sending');s.now=BASE+1200;assert.equal((await s.run()).state,'frozen');}}
});
test('fresh health recovers exactly once after a verified opening',async()=>{
 const s=scenario();await opening(s);s.now=BASE+901;s.setHeartbeat(s.now,true);assert.equal((await s.run()).state,'recovery_sent');assert.equal(s.calls.length,2);assert.equal(JSON.parse(s.calls[1].options.body).text,MESSAGES.fixtureRecovery);assert.equal(s.ledger().incident,null);assert.equal(s.ledger().history[0].opening.state,'sent');assert.equal(s.ledger().history[0].recovery.state,'sent');s.now=BASE+1201;await s.run();assert.equal(s.calls.length,2);
});
test('unsent opening cancels on fresh health; destination changes block recovery',async()=>{
 const s=scenario({enabled:'false'});await opening(s);s.env.ENABLE_NOTIFY='true';s.now=BASE+901;s.setHeartbeat(s.now,true);await s.run();assert.equal(s.calls.length,0);assert.equal(s.ledger().incident,null);assert.equal(s.ledger().history[0].reason,'recovered_before_notice');
 const other=scenario();await opening(other);other.env.OWNER_CHAT_ID=String(Number(OWNER)+1);other.now=BASE+901;other.setHeartbeat(other.now,true);await other.run();assert.equal(other.calls.length,1);assert.equal(other.ledger().incident.recovery.state,'pending');
});
test('invalid tokens/group/zero recipient and nonexact enable value never send',async()=>{
 for(const patch of [{OWNER_CHAT_ID:'-123'},{OWNER_CHAT_ID:'0'},{OWNER_CHAT_ID:'1.5'},{OWNER_CHAT_ID:'9007199254740992'},{TELEGRAM_BOT_TOKEN:'private-canary'},{ENABLE_NOTIFY:'TRUE'}]){const s=scenario();Object.assign(s.env,patch);await opening(s);assert.equal(s.calls.length,0);assert.equal(s.ledger().incident.opening.state,'pending');}
});
test('calendar gate rechecked after claim and before receipt commit',async()=>{
 const start=calendar.closed[0][0],at=start-13;
 for(const crossing of ['claim','response']){
  const s=scenario({at});const initial=initialLedger(true);initial.lastCheck=at-450;initial.lastHeartbeat=at-1000;initial.failures=[at-900,at-450];s.bucket.seed(s.keys.ledger,initial);s.setHeartbeat(at-1000,true);
  if(crossing==='claim')s.bucket.putHook=(_key,raw,_options,phase)=>{if(phase==='after'&&JSON.parse(raw).incident?.opening.state==='sending')s.now=start-11;};
  else s.monitor=createWatchdog({clock:()=>s.now,fetchImpl:async()=>{s.calls.push({});s.now=start-11;return Response.json({ok:true,result:{message_id:1,chat:{id:Number(OWNER),type:'private'}}});}});
  await s.monitor.run(s.env);assert.equal(s.calls.length,crossing==='claim'?0:1);assert.equal(s.ledger().incident.opening.state,'sending');
  const reads=s.bucket.reads.length,writes=s.bucket.writes.length;await s.monitor.run(s.env);assert.equal(s.bucket.reads.length,reads);assert.equal(s.bucket.writes.length,writes);
 }
});
test('fixture/production fixed keys and fixed routes never cross',async()=>{
 const fixture=scenario();await opening(fixture);assert(fixture.bucket.reads.every(key=>Object.values(FIXTURE_KEYS).includes(key)));assert(fixture.bucket.writes.every(key=>key===FIXTURE_KEYS.ledger));assert.equal(fixture.bucket.value(KEYS.ledger),null);
 const production=scenario({fixture:false});await opening(production);assert.equal(JSON.parse(production.calls[0].options.body).text,MESSAGES.opening);assert(production.bucket.writes.every(key=>key===KEYS.ledger));assert.equal((await production.monitor.status(await request(production,{origin:FIXTURE_ORIGIN}),production.env)).status,404);
 const bad=scenario();bad.env.FIXTURE_MODE='TRUE';await bad.run();assert.equal(bad.bucket.reads.length,0);
});
test('status is exact-origin signed read-only GET with no query or mutation surface',async()=>{
 const s=scenario();await opening(s);const before=s.bucket.writes.length;
 let response=await s.monitor.status(await request(s,{signed:false}),s.env);assert.equal(response.status,401);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(response.headers.get('cache-control'),'no-store');
 for(const options of [{origin:'https://foreign.invalid'},{path:'/status?private-canary=secret'},{path:'/trigger'},{path:'/status',method:'POST'},{at:BASE-61},{key:'c'.repeat(64)}]){response=await s.monitor.status(await request(s,options),s.env);assert([401,404,405].includes(response.status));assert(!(await response.text()).includes('canary'));}
 response=await s.monitor.status(await request(s),s.env);assert.equal(response.status,200);const body=await response.json();assert.equal(body.incident.opening,'sent');assert(!JSON.stringify(body).includes(OWNER));assert(!JSON.stringify(body).includes(TOKEN));assert.equal(s.bucket.writes.length,before);
 const original=s.bucket.get;s.bucket.get=async()=>{throw Error(TOKEN+' private-canary');};response=await s.monitor.status(await request(s),s.env);assert.equal(response.status,503);assert(!(await response.text()).includes('canary'));s.bucket.get=original;
});
test('malformed durable ledger freezes without replacement or transport',async()=>{
 const s=scenario();s.setHeartbeat(BASE-100,false);s.bucket.seed(s.keys.ledger,{schema:'private-canary'});const before=s.bucket.rows.get(s.keys.ledger).raw;assert.equal((await s.run()).code,'ledger_invalid');assert.equal(s.bucket.rows.get(s.keys.ledger).raw,before);assert.equal(s.bucket.writes.length,0);assert.equal(s.calls.length,0);
});
test('pure policy preserves candidate authority for gaps, healthy and held boundaries',async()=>{
 let state=initialLedger(true);for(const at of [BASE,BASE+450,BASE+900]){const next=transition(state,heartbeat(BASE-100,false),{now:at,fixture:true});state=next.ledger;}assert.equal(state.incident.id,'derech:owner-vps:1');assert.equal(state.incident.firstSeen,BASE);assert.equal(validLedger(state,true),true);assert.equal(transition(state,null,{now:BASE+1200,fixture:true}).candidate,null);
});

let passed=0;
for(const [name,body] of tests){try{await body();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name);throw error;}}
console.log(`PASS ${passed} isolated watchdog cases; no external network, credential transfer or messages`);

// Real Workerd/R2 acceptance uses Miniflare's reserved local scheduler endpoint only.
// It is not a Worker route, is not deployed, and offers no production clock override.
if(process.argv.includes('--workerd')){
 const packageUrl=new URL('../platform-cms/node_modules/miniflare/dist/src/index.js',import.meta.url);
 const esbuildUrl=new URL('../platform-cms/node_modules/esbuild/lib/main.js',import.meta.url);
 const {Miniflare}=await import(packageUrl.href),{build}=await import(esbuildUrl.href);
 const bundle=await build({entryPoints:[new URL('./worker.mjs',import.meta.url).pathname],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
 let outgoing=0;const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',unsafeTriggerHandlers:true,bindings:{FIXTURE_MODE:'true',ENABLE_NOTIFY:'false',WATCHDOG_READ_HMAC:SECRET},r2Buckets:['MONITOR_BUCKET'],outboundService:()=>{outgoing++;throw Error('external transport prohibited');}});
 try{
  const bucket=await mf.getR2Bucket('MONITOR_BUCKET'),now=Math.floor(Date.now()/1000);
  const prior=initialLedger(true);prior.revision=1;prior.lastCheck=now-450;prior.lastHeartbeat=now-1000;prior.failures=[now-900,now-450];
  await bucket.put(FIXTURE_KEYS.heartbeat,JSON.stringify(heartbeat(now-1000,true)));await bucket.put(FIXTURE_KEYS.ledger,JSON.stringify(prior));
  const latest=await bucket.get(FIXTURE_KEYS.ledger);const raceValues=[{...prior,revision:2},{...prior,revision:3}];const actualRace=await Promise.all(raceValues.map(value=>bucket.put(FIXTURE_KEYS.ledger,JSON.stringify(value),{onlyIf:{etagMatches:latest.etag}})));assert.equal(actualRace.filter(Boolean).length,1);
  await bucket.put(FIXTURE_KEYS.ledger,JSON.stringify(prior));
  let response=await mf.dispatchFetch(FIXTURE_ORIGIN+'/status');assert.equal(response.status,401);
  response=await mf.dispatchFetch(FIXTURE_ORIGIN+'/cdn-cgi/handler/scheduled');assert.equal(response.status,200);
  const saved=await (await bucket.get(FIXTURE_KEYS.ledger)).json();
  if(calendarAllowed(calendar,now))assert.equal(saved.incident.opening.state,'pending');else assert.deepEqual(saved,prior);
  const stamp=String(Math.floor(Date.now()/1000)),headers={'X-Derech-Heartbeat-Time':stamp,'X-Derech-Heartbeat-Signature':await signature(SECRET,'GET','/status',stamp)};
  response=await mf.dispatchFetch(FIXTURE_ORIGIN+'/status',{headers});assert.equal(response.status,calendarAllowed(calendar,Number(stamp))?200:503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(await bucket.get(KEYS.ledger),null);assert.equal(outgoing,0);
  console.log('PASS actual Workerd default scheduler/status and private R2 conditional race; fixture-only ledger, notifications disabled, zero outbound requests');
 }finally{await mf.dispose();}
}
