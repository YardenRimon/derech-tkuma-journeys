/** Disabled, receive-only native form wiring. Never initializes scope, policy,
 * privacy authority or provider configuration; all activation inputs are owned
 * by deployment/server storage. No public route is installed here. */
import {QUOTE_CATALOG} from './quote-core';
import {getBasePage} from './cms';
import {productionRelease} from './visitor-release';
import {createSubmissionHttpHandler,type SubmissionHttpRuntime} from './submission-http';
import {D1Submissions} from './submission-d1';
import {R2ContactPrivacy} from './contact-privacy';
import {RATING_SOURCE_PATHS,type SubmissionPolicy,type SubmissionWorkflow,type SubmissionPolicies,type SubmissionSources} from './submission-core';
import type {ContactScope} from './contact-core';
export type SubmissionRuntimeBindings={SUBMISSION_MODE?:string;SUBMISSION_ENV?:string;SUBMISSION_WORKFLOWS?:string;CMS_ADAPTER_MODE?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string;DB?:D1Database;BUCKET?:R2Bucket;CONTACT_PRIVACY_AUTHORITY_ID?:string;SUBMISSION_SIGNATURE_MODE?:string};
export type PublicRatingConfiguration={} | {enabled:true;mode:'review'|'production';pageId:string;productionApproved:boolean};
const scope:Readonly<ContactScope>=Object.freeze({tenantId:'derech',siteId:'derech-main'}),origins={review:'https://derech-tkuma-review.22yarden22.workers.dev',production:'https://derech-tkuma.com'};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const unavailable=()=>Response.json({accepted:false,code:'submission_unavailable'},{status:503,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
function admission(url:URL,b:SubmissionRuntimeBindings){
 if(b.SUBMISSION_MODE!=='receive-only'||!['review','production'].includes(b.SUBMISSION_ENV??'')||!['rating','quote','rating,quote'].includes(b.SUBMISSION_WORKFLOWS??'')||b.CMS_ADAPTER_MODE!=='isolated-d1'||b.CMS_TENANT_ID!==scope.tenantId||b.CMS_SITE_ID!==scope.siteId||!b.DB||typeof b.DB.prepare!=='function'||!b.BUCKET||!uuid(b.CONTACT_PRIVACY_AUTHORITY_ID)||url.search||url.hash||url.username||url.password)return null;
 if(b.SUBMISSION_SIGNATURE_MODE!==undefined&&!['disabled','enabled'].includes(b.SUBMISSION_SIGNATURE_MODE))return null;
 const environment=b.SUBMISSION_ENV as 'review'|'production';if(url.origin!==origins[environment])return null;
 const release=environment==='production'?productionRelease(url):null;if(environment==='production'&&(!release||!release.contactReady||!hash(release.approvalReceiptHash)))return null;
 return{environment,workflows:b.SUBMISSION_WORKFLOWS!.split(',') as SubmissionWorkflow[],approvalHash:release?.approvalReceiptHash};
}
async function isolated(db:D1Database){
 // assertIsolatedD1Scope initializes missing scope. Intake and public config
 // must only read a pre-existing registration, never create one as a side effect.
 const row=await db.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();
 if(!row||row.tenant_id!==scope.tenantId||row.site_id!==scope.siteId)throw new Error('submission_scope_unavailable');
}
function parsedPolicy(raw:unknown,workflow:SubmissionWorkflow):SubmissionPolicy|null{
 if(typeof raw!=='string'||raw.length>4096)return null;let p:SubmissionPolicy;try{p=JSON.parse(raw);}catch{return null;}
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='approvalEvidenceHash,consentPolicyVersion,days,policyId,schema,scope,workflow'||p.schema!==1||!p.scope||Object.keys(p.scope).sort().join(',')!=='siteId,tenantId'||p.scope.tenantId!==scope.tenantId||p.scope.siteId!==scope.siteId||p.workflow!==workflow||typeof p.policyId!=='string'||!/^[a-zA-Z0-9._:/-]{1,100}$/.test(p.policyId)||!Number.isSafeInteger(p.days)||p.days<1||p.days>3650||!hash(p.approvalEvidenceHash)||(workflow==='rating'?p.consentPolicyVersion!==null:typeof p.consentPolicyVersion!=='string'||!/^[a-zA-Z0-9._:/-]{1,100}$/.test(p.consentPolicyVersion)))return null;
 return p;
}
function scopedPolicies(db:D1Database):SubmissionPolicies{return{async get(s,workflow){if(s.tenantId!==scope.tenantId||s.siteId!==scope.siteId||!['rating','quote'].includes(workflow))return null;const row=await db.prepare('SELECT value FROM cms_settings WHERE key=?').bind('submission_policy:'+scope.tenantId+':'+scope.siteId+':'+workflow).first<{value:string}>();return parsedPolicy(row?.value,workflow);}};}
async function pageId(path:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path)));return'rating-'+[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,20);}
const sources:SubmissionSources={async ratingPage(s,id){if(s.tenantId!==scope.tenantId||s.siteId!==scope.siteId)return null;for(const path of RATING_SOURCE_PATHS){if(await pageId(path)!==id)continue;const title=getBasePage(path).title;if(typeof title!=='string'||!title.trim())return null;return{pageId:id,path,title,canonical:'https://derech-tkuma.com'+path};}return null;}};
async function runtime(url:URL,b:SubmissionRuntimeBindings){const gate=admission(url,b);if(!gate)return null;await isolated(b.DB!);const policies=scopedPolicies(b.DB!),privacy=new R2ContactPrivacy(b.BUCKET,b.CONTACT_PRIVACY_AUTHORITY_ID);return{gate,policies,privacy};}
export async function submissionRuntimeRequest(request:Request,bindings:SubmissionRuntimeBindings):Promise<Response>{
 try{const url=new URL(request.url);if(url.pathname!=='/api/submissions/'||request.method!=='POST')return unavailable();const prepared=await runtime(url,bindings);if(!prepared)return unavailable();
  // The HTTP/core policy checks occur before quota/storage mutation and require
  // the selected workflow's exact explicit policy. No broad policy fallback.
  const config:SubmissionHttpRuntime={mode:'receive-only',environment:prepared.gate.environment,productionApproved:prepared.gate.environment==='production',productionApprovalHash:prepared.gate.approvalHash,enabledWorkflows:prepared.gate.workflows,scope:{...scope},db:bindings.DB!,bucket:bindings.SUBMISSION_SIGNATURE_MODE==='enabled'?bindings.BUCKET!:undefined,store:new D1Submissions(bindings.DB!),privacy:prepared.privacy,policies:prepared.policies,sources};return await createSubmissionHttpHandler(config)(request);
 }catch{return unavailable();}
}
export async function publicRatingConfiguration(url:URL,bindings:SubmissionRuntimeBindings):Promise<PublicRatingConfiguration>{
 try{const gate=admission(url,bindings);if(!gate||!gate.workflows.includes('rating'))return{};const path=decodeURIComponent(url.pathname);if(!RATING_SOURCE_PATHS.includes(path))return{};const prepared=await runtime(url,bindings);if(!prepared||!await prepared.policies.get(scope,'rating'))return{};await prepared.privacy.check(scope);const id=await pageId(path);if(!await sources.ratingPage(scope,id))return{};return{enabled:true,mode:gate.environment,pageId:id,productionApproved:gate.environment==='production'};}catch{return{};}
}

export type PublicQuoteConfiguration={} | {enabled:true;mode:'review'|'production';productionApproved:boolean;consentPolicyVersion:string;serviceIds:number[];signatureEnabled:boolean};
export async function publicQuoteConfiguration(url:URL,bindings:SubmissionRuntimeBindings):Promise<PublicQuoteConfiguration>{
 try{const gate=admission(url,bindings);if(!gate||!gate.workflows.includes('quote')||decodeURIComponent(url.pathname)!=='/הצעה/')return{};const prepared=await runtime(url,bindings);if(!prepared)return{};const policy=await prepared.policies.get(scope,'quote');if(!policy||!policy.consentPolicyVersion)return{};await prepared.privacy.check(scope);return{enabled:true,mode:gate.environment,productionApproved:gate.environment==='production',consentPolicyVersion:policy.consentPolicyVersion,serviceIds:QUOTE_CATALOG.map(service=>service.id),signatureEnabled:bindings.SUBMISSION_SIGNATURE_MODE==='enabled'};}catch{return{};}
}
