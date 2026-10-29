/** Receive-only HTTP boundary. No route is installed by importing this module.
 * Runtime policy/production approval are server authority; browser fields cannot
 * enable intake. Existing hashed contact ingress is mandatory. No delivery IO.
 */
import {contactIngress} from './contact-controls';
import {type ContactScope,type ContactPrivacy} from './contact-core';
import {Submissions,SubmissionError,validateRatingInput,validateQuoteInput,type SubmissionStore,type SubmissionPolicies,type SubmissionPolicy,type SubmissionSources,type SubmissionWorkflow} from './submission-core';
import {createSubmissionSignatureAuthority,SIGNATURE_PNG_LIMITS} from './submission-signature';
export const SUBMISSION_HTTP_LIMITS=Object.freeze({path:'/api/submissions/',maxBodyBytes:192*1024,maxRatingBytes:8*1024,bodyMilliseconds:5000,maxJsonDepth:16,maxJsonKeys:128});
const origins=Object.freeze({review:'https://derech-tkuma-review.22yarden22.workers.dev',production:'https://derech-tkuma.com'});
export type SubmissionHttpRuntime={mode:'receive-only';environment:'review'|'production';productionApproved?:boolean;productionApprovalHash?:string;enabledWorkflows:readonly SubmissionWorkflow[];scope:ContactScope;db:D1Database;store:SubmissionStore;privacy:ContactPrivacy;policies:SubmissionPolicies;sources:SubmissionSources;bucket?:R2Bucket;clock?:()=>Date};
function need(ok:unknown,code='invalid_submission',status=400):asserts ok{if(!ok)throw new SubmissionError(status,code);}
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function configured(runtime:SubmissionHttpRuntime|undefined):asserts runtime is SubmissionHttpRuntime{
 need(runtime&&runtime.mode==='receive-only'&&(runtime.environment==='review'||runtime.environment==='production')&&runtime.scope?.tenantId==='derech'&&runtime.scope.siteId==='derech-main'&&Object.keys(runtime.scope).sort().join(',')==='siteId,tenantId'&&Array.isArray(runtime.enabledWorkflows)&&runtime.enabledWorkflows.length>0&&runtime.enabledWorkflows.length<=2&&new Set(runtime.enabledWorkflows).size===runtime.enabledWorkflows.length&&runtime.enabledWorkflows.every(w=>w==='rating'||w==='quote')&&runtime.db&&typeof runtime.db.prepare==='function'&&runtime.store&&['get','insert','cas'].every(k=>typeof runtime.store[k as keyof SubmissionStore]==='function')&&runtime.privacy&&['check','get','ensure'].every(k=>typeof runtime.privacy[k as keyof ContactPrivacy]==='function')&&runtime.policies&&typeof runtime.policies.get==='function'&&runtime.sources&&typeof runtime.sources.ratingPage==='function','submission_disabled',503);
 need(runtime.environment!=='production'||runtime.productionApproved===true&&digest(runtime.productionApprovalHash),'submission_disabled',503);
}
async function policyFor(runtime:SubmissionHttpRuntime,workflow:SubmissionWorkflow):Promise<SubmissionPolicy>{
 const p=await runtime.policies.get(runtime.scope,workflow);need(p&&Object.keys(p).sort().join(',')==='approvalEvidenceHash,consentPolicyVersion,days,policyId,schema,scope,workflow'&&p.schema===1&&p.scope?.tenantId===runtime.scope.tenantId&&p.scope.siteId===runtime.scope.siteId&&Object.keys(p.scope).sort().join(',')==='siteId,tenantId'&&p.workflow===workflow&&typeof p.policyId==='string'&&/^[a-zA-Z0-9._:/-]{1,100}$/.test(p.policyId)&&Number.isSafeInteger(p.days)&&p.days>=1&&p.days<=3650&&digest(p.approvalEvidenceHash)&&(workflow==='rating'?p.consentPolicyVersion===null:typeof p.consentPolicyVersion==='string'&&/^[a-zA-Z0-9._:/-]{1,100}$/.test(p.consentPolicyVersion)),'submission_disabled',503);return structuredClone(p);
}
// JSON.parse alone silently accepts duplicate fields (including escaped keys).
// Scan structure/keys first; JSON.parse remains the grammar authority.
function strictJson(text:string):unknown{
 const stack:{object:boolean;key:boolean;keys:Set<string>}[]=[];let keys=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='"'){let j=i+1;for(;j<text.length;j++){if(text[j]==='\\'){j++;continue;}if(text[j]==='"')break;}need(j<text.length);const top=stack.at(-1);if(top?.object&&top.key){const key=JSON.parse(text.slice(i,j+1));need(!top.keys.has(key)&&++keys<=SUBMISSION_HTTP_LIMITS.maxJsonKeys);top.keys.add(key);top.key=false;}i=j;
  }else if(c==='{'||c==='['){stack.push({object:c==='{',key:c==='{',keys:new Set()});need(stack.length<=SUBMISSION_HTTP_LIMITS.maxJsonDepth);}else if(c==='}'||c===']')stack.pop();else if(c===','&&stack.at(-1)?.object)stack.at(-1)!.key=true;
 }
 return JSON.parse(text);
}
async function readBody(request:Request){
 need(!request.signal.aborted,'request_aborted',408);const length=request.headers.get('content-length');need(length===null||/^(0|[1-9]\d*)$/.test(length));need(length===null||Number(length)<=SUBMISSION_HTTP_LIMITS.maxBodyBytes,'request_too_large',413);need(request.body);
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let bytes=0,done=false,timer:ReturnType<typeof setTimeout>|undefined,rejectStop:(reason:unknown)=>void=()=>{};
 const stop=new Promise<never>((_,reject)=>{rejectStop=reject;timer=setTimeout(()=>reject(new SubmissionError(408,'request_timeout')),SUBMISSION_HTTP_LIMITS.bodyMilliseconds);});
 const abort=()=>rejectStop(new SubmissionError(408,'request_aborted'));request.signal.addEventListener('abort',abort,{once:true});
 try{if(request.signal.aborted)abort();while(true){const part=await Promise.race([reader.read(),stop]);if(part.done){done=true;break;}need(part.value instanceof Uint8Array);bytes+=part.value.byteLength;need(bytes<=SUBMISSION_HTTP_LIMITS.maxBodyBytes,'request_too_large',413);chunks.push(part.value.slice());}need(bytes>0);const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}try{return{value:strictJson(new TextDecoder('utf-8',{fatal:true}).decode(all)),bytes};}catch{throw new SubmissionError(400,'invalid_submission');}}
 finally{if(timer!==undefined)clearTimeout(timer);request.signal.removeEventListener('abort',abort);if(!done)void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
function signatureBytes(value:unknown){need(typeof value==='string'&&value.length>0&&value.length<=Math.ceil(SIGNATURE_PNG_LIMITS.maxBytes/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));const raw=atob(value);need(raw.length>0&&raw.length<=SIGNATURE_PNG_LIMITS.maxBytes&&btoa(raw)===value);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function send(body:unknown,status:number){return Response.json(body,{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...(status===405?{allow:'POST'}:{}),...(status===429?{'retry-after':'60'}:{})}});}
function failed(error:unknown){const e=error as {status?:number;code?:string};if(e?.status===429)return send({accepted:false,code:'rate_limited'},429);if(e?.status===410)return send({accepted:false,code:'submission_erased'},410);if(e?.status===409)return send({accepted:false,code:'submission_conflict'},409);if(e?.status===408)return send({accepted:false,code:'request_timeout'},408);if(e?.status===413)return send({accepted:false,code:'request_too_large'},413);if(e?.status===403)return send({accepted:false,code:'request_denied'},403);if(e?.status===405)return send({accepted:false,code:'method_not_allowed'},405);if(e?.status===400||e?.status===422)return send({accepted:false,code:'invalid_submission'},400);return send({accepted:false,code:'submission_unavailable'},503);}
export function createSubmissionHttpHandler(runtime?:SubmissionHttpRuntime){
 // Runtime is server-owned; copying the container prevents later property swaps.
 const config=runtime?{...runtime,scope:{...runtime.scope},enabledWorkflows:[...runtime.enabledWorkflows]}:undefined;
 return async(request:Request):Promise<Response>=>{try{
  configured(config);need(request.method==='POST','method_not_allowed',405);const origin=origins[config.environment];need(request.url===origin+SUBMISSION_HTTP_LIMITS.path&&request.headers.get('origin')===origin&&request.headers.get('sec-fetch-site')==='same-origin'&&request.headers.get('x-derech-submission')==='1','request_denied',403);need(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''));need(!request.headers.has('content-encoding'));
  const body=await readBody(request),raw=body.value;need(raw!==null&&typeof raw==='object'&&!Array.isArray(raw));const fields={...raw} as Record<string,unknown>,workflow=fields.workflow;need(workflow==='rating'||workflow==='quote');need(config.enabledWorkflows.includes(workflow),'submission_disabled',503);if(workflow==='rating')need(body.bytes<=SUBMISSION_HTTP_LIMITS.maxRatingBytes,'request_too_large',413);
  const supplied=Object.hasOwn(fields,'signaturePngBase64');need(!supplied||workflow==='quote');const encoded=fields.signaturePngBase64;delete fields.signaturePngBase64;const input=workflow==='rating'?validateRatingInput(fields):validateQuoteInput(fields),policy=await policyFor(config,workflow);if(input.workflow==='quote')need(input.consent.policyVersion===policy.consentPolicyVersion);const bytes=supplied?signatureBytes(encoded):undefined;need(!bytes||config.bucket&&typeof config.bucket.get==='function'&&typeof config.bucket.put==='function'&&typeof config.bucket.head==='function','submission_disabled',503);need(!request.signal.aborted,'request_aborted',408);
  const now=config.clock?.()??new Date();need(now instanceof Date&&Number.isFinite(now.getTime()),'submission_unavailable',503);const reserveNew=await contactIngress(config.db,config.scope,request,now.getTime());need(!request.signal.aborted,'request_aborted',408);
  // Pin the exact explicit policy used above for all stages of this request.
  const service=new Submissions(config.store,config.privacy,{async get(s,w){return s.tenantId===config.scope.tenantId&&s.siteId===config.scope.siteId&&w===workflow?structuredClone(policy):null;}},config.sources);
  const authority=bytes?await createSubmissionSignatureAuthority(config.bucket!,config.privacy,config.store,()=>now):undefined,prepared=bytes?await authority!.prepare(config.scope,input.idempotencyKey,bytes):undefined;need(!request.signal.aborted,'request_aborted',408);let result=await service.submit(config.scope,input,now,prepared,reserveNew);
  if(prepared){need(authority,'submission_unavailable',503);need(!request.signal.aborted,'request_aborted',408);const verified=await authority.verify(prepared);need(!request.signal.aborted,'request_aborted',408);result=await service.acceptAttachment(config.scope,input.idempotencyKey,verified,now);}need(result.kind==='accepted','submission_unavailable',503);return send(result.body,202);
 }catch(error){return failed(error);}};
}
