/** Pure bounded outside-observation policy; no network or credentials. */
export const LEDGER_SCHEMA='derech-independent-watchdog/v1';
export const SCOPE='derech:owner-vps';
export const HEARTBEAT_SCHEMA='derech-vps-heartbeat/v1';
export const CALENDAR_SHA256='848224e2f848aa551df3c13efdacb9d997530547be40a6499fed3a0594e82f51';
export const LOOKAHEAD=12;
const sourceHashes={'time_policy.py':'f04b387d52695ada11e54e605c12a21703d6e97091e9ca0e97a6bc1a7401bc75','sacred_calendar.py':'7c96354bfe4f5cdcf9ca6c5cbf46bc7d01f2aec203a636ab883ccf2eb2cbef82',cache:'4603f1812239371d31b7396e0a1cd23aa21622a2c6fc751ba75aab1bdd5eb4db'};
export const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export const epoch=value=>Number.isSafeInteger(value)&&value>=0;
export function validCalendar(value){
 if(!exact(value,['schema','timezone','validFrom','validUntil','closed','sourceHashes','versions','safetySeconds','equivalenceChecks'])||value.schema!=='derech-independent-calendar/v1'||value.timezone!=='Asia/Jerusalem'||value.validFrom!==1790812800||value.validUntil!==1859241600||value.safetySeconds!==120||value.equivalenceChecks!==1846||!exact(value.sourceHashes,Object.keys(sourceHashes))||Object.entries(sourceHashes).some(([key,hash])=>value.sourceHashes[key]!==hash)||!exact(value.versions,['pyluach','astral'])||value.versions.pyluach!=='2.3.0'||value.versions.astral!=='3.2'||!Array.isArray(value.closed)||value.closed.length!==121)return false;
 let end=value.validFrom;
 for(const interval of value.closed){if(!Array.isArray(interval)||interval.length!==2||!interval.every(epoch)||interval[0]<end||interval[0]>=interval[1]||interval[1]>value.validUntil)return false;end=interval[1];}
 return true;
}
export function calendarAllowed(calendar,now,lookahead=LOOKAHEAD){
 if(!epoch(now)||!Number.isSafeInteger(lookahead)||lookahead<0||!validCalendar(calendar)||now<calendar.validFrom||now+lookahead>=calendar.validUntil)return false;
 return !calendar.closed.some(([start,end])=>now<end&&now+lookahead>=start);
}
export function initialLedger(fixture=false){return {schema:LEDGER_SCHEMA,scope:SCOPE,fixture,revision:0,generation:0,observationAttempt:null,lastCheck:null,lastHeartbeat:null,failures:[],incident:null,history:[]};}
const states=['pending','sending','sent','uncertain','cancelled'];
function validDelivery(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!states.includes(value.state)||Object.keys(value).some(key=>!['state','claimId','claimedAt','messageId','sentAt','recipientId'].includes(key)))return false;
 if(['pending','cancelled'].includes(value.state)&&!exact(value,['state']))return false;
 if(['sending','uncertain'].includes(value.state)&&!exact(value,['state','claimId','claimedAt']))return false;
 if(value.state==='sent'&&!exact(value,['state','claimId','claimedAt','messageId','sentAt','recipientId']))return false;
 if(['sending','sent','uncertain'].includes(value.state)&&(!/^[a-f\d-]{36}$/.test(value.claimId??'')||!epoch(value.claimedAt)))return false;
 if(value.state==='sent'&&(!Number.isSafeInteger(value.messageId)||value.messageId<1||!epoch(value.sentAt)||typeof value.recipientId!=='string'||!/^[1-9]\d{0,15}$/.test(value.recipientId)))return false;
 return true;
}
function validIncident(value,generation){return exact(value,['id','firstSeen','healthyAt','opening','recovery'])&&value.id===SCOPE+':'+generation&&epoch(value.firstSeen)&&(value.healthyAt===null||epoch(value.healthyAt))&&validDelivery(value.opening)&&validDelivery(value.recovery);}
export function validLedger(value,fixture=false){
 if(!exact(value,['schema','scope','fixture','revision','generation','observationAttempt','lastCheck','lastHeartbeat','failures','incident','history'])||value.schema!==LEDGER_SCHEMA||value.scope!==SCOPE||value.fixture!==fixture||!epoch(value.revision)||!epoch(value.generation)||!Array.isArray(value.failures)||value.failures.length>8||!value.failures.every(epoch)||!Array.isArray(value.history)||value.history.length>32)return false;
 if(value.observationAttempt!==null&&(!exact(value.observationAttempt,['id','startedAt'])||!/^[a-f\d-]{36}$/.test(value.observationAttempt.id)||!epoch(value.observationAttempt.startedAt)))return false;
 if(value.lastCheck!==null&&!epoch(value.lastCheck)||value.lastHeartbeat!==null&&!epoch(value.lastHeartbeat)||value.failures.some((at,i)=>i&&at<=value.failures[i-1])||value.lastCheck!==null&&value.failures.some(at=>at>value.lastCheck))return false;
 if(value.incident!==null&&!validIncident(value.incident,value.generation))return false;
 return value.history.every(item=>exact(item,['id','firstSeen','closedAt','reason','opening','recovery'])&&typeof item.id==='string'&&/^derech:owner-vps:[1-9]\d*$/.test(item.id)&&epoch(item.firstSeen)&&epoch(item.closedAt)&&item.closedAt>=item.firstSeen&&['recovered','recovered_before_notice','observation_lost_before_notice'].includes(item.reason)&&validDelivery(item.opening)&&validDelivery(item.recovery));
}
export function validHeartbeat(value,now,lastHeartbeat=null){
 return exact(value,['schema','observedAt','receivedAt','ready'])&&value.schema===HEARTBEAT_SCHEMA&&typeof value.ready==='boolean'&&epoch(value.observedAt)&&epoch(value.receivedAt)&&Math.abs(value.observedAt-value.receivedAt)<=60&&value.receivedAt<=now&&(lastHeartbeat===null||value.observedAt>=lastHeartbeat);
}
export const frozen=ledger=>!!ledger.incident&&[ledger.incident.opening,ledger.incident.recovery].some(value=>['sending','uncertain'].includes(value.state));
function closeIncident(ledger,now,reason){const incident=ledger.incident;ledger.history=[...ledger.history,{id:incident.id,firstSeen:incident.firstSeen,closedAt:now,reason,opening:incident.opening,recovery:incident.recovery}].slice(-32);ledger.incident=null;ledger.failures=[];}
export function incompleteObservation(previous,now){
 const ledger=structuredClone(previous);ledger.observationAttempt=null;ledger.failures=[];
 if(ledger.incident?.opening.state==='pending'){ledger.incident.opening={state:'cancelled'};ledger.incident.recovery={state:'cancelled'};closeIncident(ledger,now,'observation_lost_before_notice');}
 else if(ledger.incident)ledger.incident.healthyAt=null;
 return ledger;
}
/** Each invocation is a new trusted outside read; heartbeat age alone is not a new observation. */
export function transition(previous,heartbeat,{now,fixture=false}={}){
 if(!epoch(now)||!validLedger(previous,fixture))return {state:'internal_only',reason:'ledger_invalid',ledger:null,candidate:null};
 const ledger=structuredClone(previous);
 if(frozen(ledger))return {state:'frozen',reason:'delivery_unconfirmed',ledger:null,candidate:null};
 if(ledger.lastCheck!==null&&now<=ledger.lastCheck)return {state:'internal_only',reason:'observation_replayed',ledger:null,candidate:null};
 ledger.observationAttempt=null;
 if(!validHeartbeat(heartbeat,now,ledger.lastHeartbeat)){
  ledger.failures=[];
  if(ledger.incident?.opening.state==='pending'){ledger.incident.opening={state:'cancelled'};ledger.incident.recovery={state:'cancelled'};closeIncident(ledger,now,'observation_lost_before_notice');}
  else if(ledger.incident)ledger.incident.healthyAt=null;
  return {state:'internal_only',reason:'heartbeat_unknown',ledger,candidate:null};
 }
 const last=ledger.lastCheck;ledger.lastHeartbeat=heartbeat.observedAt;ledger.lastCheck=now;
 if(last===null||now-last>720){
  ledger.failures=[];
  if(ledger.incident?.opening.state==='pending'){ledger.incident.opening={state:'cancelled'};ledger.incident.recovery={state:'cancelled'};closeIncident(ledger,now,'observation_lost_before_notice');}
 }
 const bad=!heartbeat.ready||now-heartbeat.receivedAt>600,incident=ledger.incident;
 if(!bad){
  ledger.failures=[];
  if(!incident)return {state:'healthy',ledger,candidate:null};
  if(incident.opening.state==='pending'){
   incident.opening={state:'cancelled'};incident.recovery={state:'cancelled'};closeIncident(ledger,now,'recovered_before_notice');
   return {state:'healthy',ledger,candidate:null};
  }
  if(incident.opening.state==='sent'&&incident.recovery.state==='pending'){
   incident.healthyAt=now;return {state:'recovery_candidate',ledger,candidate:'recovery'};
  }
  return {state:'internal_only',reason:'incident_invalid',ledger:null,candidate:null};
 }
 if(incident){incident.healthyAt=null;return {state:'open',ledger,candidate:incident.opening.state==='pending'?'opening':null};}
 ledger.failures=[...ledger.failures,now].slice(-8);
 if(ledger.failures.length>=3&&now-ledger.failures[0]>=900){
  ledger.generation++;
  ledger.incident={id:SCOPE+':'+ledger.generation,firstSeen:ledger.failures[0],healthyAt:null,opening:{state:'pending'},recovery:{state:'pending'}};
  return {state:'opening_candidate',ledger,candidate:'opening'};
 }
 return {state:'observing',ledger,candidate:null};
}
export function claimed(ledger,kind,now,claimId){const next=structuredClone(ledger);next.incident[kind]={state:'sending',claimedAt:now,claimId};return next;}
export function settled(ledger,kind,receipt,now){
 const next=structuredClone(ledger);
 next.incident[kind]={...next.incident[kind],state:'sent',messageId:receipt.messageId,recipientId:receipt.recipientId,sentAt:now};
 if(kind==='recovery')closeIncident(next,now,'recovered');
 return next;
}
export function uncertain(ledger,kind){const next=structuredClone(ledger);next.incident[kind].state='uncertain';return next;}

export const ORIGIN='https://derech-vps-watchdog.22yarden22.workers.dev';
export const FIXTURE_ORIGIN='https://derech-vps-watchdog-fixture.22yarden22.workers.dev';
export const KEYS=Object.freeze({heartbeat:'monitor/derech/vps/heartbeat-v1.json',ledger:'monitor/derech/vps/watchdog-v1.json'});
export const FIXTURE_KEYS=Object.freeze({heartbeat:'monitor/derech/vps/fixture/heartbeat-v1.json',ledger:'monitor/derech/vps/fixture/watchdog-v1.json'});
export const MESSAGES=Object.freeze({
 opening:'ניטור עצמאי: התקבל רצף בדיקות שמצריך בדיקה של השרת והשירותים הקיימים. נא לבדוק את זמינותם.',
 recovery:'ניטור עצמאי: התקבל אות בריאות תקין לאחר ההתראה הקודמת. נא לוודא שהשירותים פועלים כרגיל.',
 fixtureOpening:'בדיקת מסירה בלבד: נבדקת התראת בדיקת השרת. אין כאן דיווח על תקלה אמיתית.',
 fixtureRecovery:'בדיקת מסירה בלבד: נבדקת הודעת התאוששות. אין כאן דיווח על תקלה אמיתית או התאוששות אמיתית.',
});
