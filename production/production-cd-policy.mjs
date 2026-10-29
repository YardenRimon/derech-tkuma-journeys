/** Prepared production guard. Read-only GitHub proof; no provider deployment. */
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
export const repository='YardenRimon/derech-tkuma-journeys';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export class ProductionPolicyError extends Error{constructor(code){super('Production deployment blocked: '+code);this.code=code;}}
const deny=code=>{throw new ProductionPolicyError(code);};
export function selectProductionSource({eventName,event,ref,sourceSha}){
 if(eventName!=='workflow_dispatch'||event?.repository?.full_name!==repository||ref!=='refs/heads/main'||!sha(sourceSha))deny('untrusted_dispatch');
 return {repository,branch:'main',sha:sourceSha,event:'workflow_dispatch'};
}
export function checkProductionApplication(candidate,{head,exists=path=>existsSync(join(root,path))}){
 if(candidate?.repository!==repository||candidate.branch!=='main'||candidate.event!=='workflow_dispatch'||!sha(candidate.sha)||head!==candidate.sha)deny('checkout_identity');
 for(const path of ['platform-cms/package-lock.json','platform-cms/source-manifest.json','platform-cms/public-assets-manifest.json','platform-cms/scripts/build-production.mjs','platform-cms/scripts/validate-production-artifact.mjs','platform-cms/scripts/verify-production-live.mjs','production/release-profile.mjs','production/production-cd-policy.mjs'])if(!exists(path))deny('application_source_missing');
}
function sourceRun(run,candidate){return run&&run.name==='Shared CMS checks'&&run.path==='.github/workflows/site-ci.yml'&&run.event==='push'&&run.head_branch==='main'&&run.head_sha===candidate.sha&&run.repository?.full_name===repository&&run.head_repository?.full_name===repository&&Number.isSafeInteger(run.id)&&run.id>0&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0;}
async function boundedJson(response,limit){
 const reader=response.body?.getReader();if(!reader)deny('github_read_failed');const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)deny('github_response_bound');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{deny('github_read_failed');}
}
export async function verifyProductionSource(candidate,{token,fetcher=globalThis.fetch}={}){
 if(candidate?.repository!==repository||candidate.branch!=='main'||candidate.event!=='workflow_dispatch'||!sha(candidate.sha)||typeof token!=='string'||!token||token.length>4096||/[\r\n]/.test(token)||typeof fetcher!=='function')deny('verification_inputs');
 let remaining=6*1024*1024;
 async function get(path){
  const url=`https://api.github.com/repos/${repository}/${path}`;
  try{
   const response=await fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'DerechProductionSourceVerifier/1.0'}});
   if(response.status!==200||response.redirected||response.url&&response.url!==url||response.headers.has('location')||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')deny('github_read_failed');
   const value=await boundedJson(response,Math.min(2*1024*1024,remaining));remaining-=Buffer.byteLength(JSON.stringify(value));if(remaining<0)deny('github_response_bound');return value;
  }catch(error){if(error instanceof ProductionPolicyError)throw error;deny('github_read_failed');}
 }
 async function currentMain(){const ref=await get('git/ref/heads/main');if(ref.ref!=='refs/heads/main'||ref.object?.type!=='commit'||ref.object.sha!==candidate.sha)deny('superseded_source');}
 await currentMain();
 const listing=await get(`actions/workflows/site-ci.yml/runs?branch=main&event=push&head_sha=${candidate.sha}&per_page=100`);
 if(!Number.isSafeInteger(listing.total_count)||listing.total_count<1||listing.total_count>100||!Array.isArray(listing.workflow_runs)||listing.workflow_runs.length!==listing.total_count||listing.workflow_runs.some(run=>!sourceRun(run,candidate)))deny('ci_source_unverified');
 const selected=[...listing.workflow_runs].sort((a,b)=>b.id-a.id)[0];
 if(selected.status!=='completed'||selected.conclusion!=='success')deny('latest_ci_not_successful');
 const run=await get('actions/runs/'+selected.id);
 if(!sourceRun(run,candidate)||run.id!==selected.id||run.run_attempt!==selected.run_attempt||run.status!=='completed'||run.conclusion!=='success')deny('ci_readback_mismatch');
 const result=await get(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
 if(!Number.isSafeInteger(result.total_count)||result.total_count<1||result.total_count>100||!Array.isArray(result.jobs)||result.jobs.length!==result.total_count)deny('ci_jobs_unverified');
 const jobs=result.jobs.filter(job=>job.name==='verify');
 if(jobs.length!==1||jobs[0].run_id!==run.id||jobs[0].head_sha!==candidate.sha||jobs[0].status!=='completed'||jobs[0].conclusion!=='success'||jobs[0].run_attempt!==undefined&&jobs[0].run_attempt!==run.run_attempt)deny('verify_job_not_successful');
 await currentMain();
 return {productionSourceVerified:true,repository,sourceCommit:candidate.sha,branch:'main',workflowRunId:run.id,workflowAttempt:run.run_attempt};
}
export async function main(environment=process.env){
 if(environment.GITHUB_REPOSITORY!==repository)deny('repository');
 const candidate=selectProductionSource({eventName:environment.GITHUB_EVENT_NAME,event:JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH,'utf8')),ref:environment.GITHUB_REF,sourceSha:environment.GITHUB_SHA});
 if(environment.PLATFORM_RELEASE_SHA!==candidate.sha)deny('build_identity');
 checkProductionApplication(candidate,{head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()});
 const proof=await verifyProductionSource(candidate,{token:environment.GH_READ_TOKEN});console.log(JSON.stringify(proof));return proof;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error instanceof ProductionPolicyError?error.message:'Production deployment blocked: local_precondition');process.exitCode=1;});
