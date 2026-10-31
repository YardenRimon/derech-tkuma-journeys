/** Reviewed display snapshot only. Never probes providers or changes readiness. */
export const readinessStatuses=['live_verified','local_verified','historical','blocked','unverified'] as const;
export type ReadinessStatus=typeof readinessStatuses[number];
export const technicalStatuses=['not_configured','awaiting_owner','pending_provider','configured_unverified','verified_read','verified_action','degraded','revoked','legacy_active','intentionally_disabled'] as const;
export type TechnicalStatus=typeof technicalStatuses[number];
export const readinessRequirements=['public_continuity','staff_operations','optional'] as const;
export type ReadinessRequirement=typeof readinessRequirements[number];
export type ReadinessEvidence={label:string;reference:string};
export type ReadinessConnection={id:string;title:string;asset:string;capability:string;technicalStatus:TechnicalStatus;requiredFor:ReadinessRequirement;fallback:string;status:ReadinessStatus;checkedAt:string|null;evidence:ReadinessEvidence[];missing:string;owner:string;nextStep:string;impact:string};
export type IntegrationReadinessSnapshot={schema:1;snapshotAt:string;stage:'local-preparation';reviewOrigin:'https://derech-tkuma-review.22yarden22.workers.dev';deployedCommit:string;connections:ReadinessConnection[]};
export const readinessStatusLabels:Record<ReadinessStatus,string>={live_verified:'בדיקה חיה מתועדת',local_verified:'בדיקה מקומית בלבד',historical:'ראיה קודמת בלבד',blocked:'מידע על חסם',unverified:'אין ראיה מספקת'};
export const technicalStatusLabels:Record<TechnicalStatus,string>={not_configured:'לא הוגדר',awaiting_owner:'ממתין לפעולת בעל הנכס',pending_provider:'ממתין לאישור הספק',configured_unverified:'הוגדר אך היכולת טרם אומתה',verified_read:'קריאה בנכס אומתה',verified_action:'פעולה מסוימת אומתה',degraded:'פעילות לקויה או בדיקה שאינה עדכנית',revoked:'הגישה נשללה',legacy_active:'ממשיך במערכת המקורית',intentionally_disabled:'כבוי במכוון'};
export const readinessRequirementLabels:Record<ReadinessRequirement,string>={public_continuity:'נדרש לרציפות האתר הציבורי',staff_operations:'נדרש לעבודת הצוות',optional:'אפשרות להמשך — אינו תנאי להשקה'};
export class ReadinessSnapshotError extends Error{constructor(){super('readiness_snapshot_invalid');}}
function fail():never{throw new ReadinessSnapshotError();}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).sort().join(',')===[...expected].sort().join(',');
const iso=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'));
// This is a safe human summary, never an export of account/callback/config data.
const sensitive=/(?:bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{10,}\.|(?:access[_-]?token|api[_-]?key|client[_-]?secret|password|authorization|cookie|signature)\s*[:=]|-----BEGIN|(?:\?|&)(?:[^\s]*=)|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
function text(value:unknown,max=900){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||sensitive.test(value))fail();return value;}
function reference(value:unknown){const v=text(value,240);if(/^docs\/[a-z0-9][a-z0-9._/-]*\.md(?:#[a-z0-9-]+)?$/.test(v)&&!v.includes('..')&&!v.includes('//'))return v;
 if(/^https:\/\/github\.com\/YardenRimon\/derech-tkuma-journeys\/(?:actions\/runs\/\d+|commit\/[a-f0-9]{40})$/.test(v))return v;
 if(/^https:\/\/(?:derech-tkuma-review\.22yarden22\.workers\.dev|derech-tkuma\.com)\/$/.test(v))return v;
 return fail();}
export function parseIntegrationReadiness(value:unknown):IntegrationReadinessSnapshot{
 if(!record(value)||!keys(value,['schema','snapshotAt','stage','reviewOrigin','deployedCommit','connections'])||value.schema!==1||!iso(value.snapshotAt)||value.stage!=='local-preparation'||value.reviewOrigin!=='https://derech-tkuma-review.22yarden22.workers.dev'||typeof value.deployedCommit!=='string'||!/^[a-f0-9]{40}$/.test(value.deployedCommit)||!Array.isArray(value.connections)||value.connections.length<1||value.connections.length>24)fail();
 const ids=new Set<string>();for(const raw of value.connections){
  if(!record(raw)||!keys(raw,['id','title','asset','capability','technicalStatus','requiredFor','fallback','status','checkedAt','evidence','missing','owner','nextStep','impact'])||typeof raw.id!=='string'||!/^[a-z][a-z0-9-]{0,49}$/.test(raw.id)||ids.has(raw.id)||!technicalStatuses.includes(raw.technicalStatus as TechnicalStatus)||!readinessRequirements.includes(raw.requiredFor as ReadinessRequirement)||!readinessStatuses.includes(raw.status as ReadinessStatus)||raw.checkedAt!==null&&!iso(raw.checkedAt)||!Array.isArray(raw.evidence)||raw.evidence.length>6)fail();
  ids.add(raw.id);text(raw.title,120);text(raw.asset,200);text(raw.capability,300);text(raw.fallback);text(raw.missing);text(raw.owner,160);text(raw.nextStep);text(raw.impact);
  if(raw.checkedAt!==null&&Date.parse(raw.checkedAt as string)>Date.parse(value.snapshotAt as string))fail();
  if(['live_verified','local_verified','historical'].includes(raw.status as string)&&(raw.checkedAt===null||raw.evidence.length===0))fail();
  if(['verified_read','verified_action'].includes(raw.technicalStatus as string)&&raw.status!=='live_verified')fail();
  for(const item of raw.evidence){if(!record(item)||!keys(item,['label','reference']))fail();text(item.label,160);reference(item.reference);}
 }
 return structuredClone(value) as unknown as IntegrationReadinessSnapshot;
}
export function readinessDateLabel(value:string|null){return value?new Intl.DateTimeFormat('he-IL',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jerusalem'}).format(new Date(value)):'לא נרשמה בדיקה';}
