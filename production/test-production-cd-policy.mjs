import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectProductionSource,checkProductionApplication,verifyProductionSource,ProductionPolicyError,repository} from './production-cd-policy.mjs';
const sourceSha='a'.repeat(40),token='synthetic-github-read-token',privateCanary='PRIVATE-TOKEN-OR-PROVIDER-DETAIL';
const candidate=selectProductionSource({eventName:'workflow_dispatch',event:{repository:{full_name:repository}},ref:'refs/heads/main',sourceSha});
const ref=()=>({ref:'refs/heads/main',object:{type:'commit',sha:sourceSha}});
const run=(id=123,patch={})=>({id,run_attempt:2,name:'Shared CMS checks',path:'.github/workflows/site-ci.yml',event:'push',head_branch:'main',head_sha:sourceSha,repository:{full_name:repository},head_repository:{full_name:repository},status:'completed',conclusion:'success',...patch});
const job=patch=>({id:456,name:'verify',run_id:123,run_attempt:2,head_sha:sourceSha,status:'completed',conclusion:'success',...patch});
function harness(mutate=()=>{}){
 const calls=[];
 const stages=[['head',ref()],['listing',{total_count:1,workflow_runs:[run()]}],['run',run()],['jobs',{total_count:1,jobs:[job()]}],['finalHead',ref()]];
 const fetcher=async(url,options)=>{
  const index=calls.length;calls.push({url,options});
  assert.ok(index<stages.length,'only bounded expected repository reads');
  const [stage,data]=stages[index],replacement=mutate(stage,data,index);
  if(replacement instanceof Response)return replacement;
  const body=replacement===undefined?data:replacement;
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
 };
 return{calls,fetcher};
}
async function denied(mutate,code){const h=harness(mutate);await assert.rejects(verifyProductionSource(candidate,{token,fetcher:h.fetcher}),error=>{assert.ok(error instanceof ProductionPolicyError);assert.equal(error.code,code);assert.ok(!error.message.includes(privateCanary));assert.ok(!error.message.includes(token));return true;});return h;}
await test('only a fixed main manual dispatch with an exact lowercase commit is selectable',()=>{
 assert.deepEqual(candidate,{repository,branch:'main',sha:sourceSha,event:'workflow_dispatch'});
 const valid={eventName:'workflow_dispatch',event:{repository:{full_name:repository}},ref:'refs/heads/main',sourceSha};
 for(const patch of [{eventName:'push'},{eventName:'pull_request'},{eventName:'workflow_run'},{event:{repository:{full_name:'foreign/repository'}}},{event:{}},{ref:'refs/pull/1/merge'},{ref:'refs/heads/production-foundation-20261019'},{sourceSha:'a'.repeat(39)},{sourceSha:'A'.repeat(40)},{sourceSha:sourceSha+'\n'},{sourceSha:undefined}])assert.throws(()=>selectProductionSource({...valid,...patch}),error=>error.code==='untrusted_dispatch');
});
await test('checkout identity and required source files are checked before provider work',()=>{
 const files=[];assert.doesNotThrow(()=>checkProductionApplication(candidate,{head:sourceSha,exists:path=>(files.push(path),true)}));assert.equal(files.length,8);
 assert.ok(files.includes('platform-cms/scripts/verify-production-live.mjs'));
 assert.throws(()=>checkProductionApplication(candidate,{head:'b'.repeat(40),exists:()=>true}),error=>error.code==='checkout_identity');
 assert.throws(()=>checkProductionApplication({...candidate,repository:'foreign/repo'},{head:sourceSha,exists:()=>true}),error=>error.code==='checkout_identity');
 for(const missing of files)assert.throws(()=>checkProductionApplication(candidate,{head:sourceSha,exists:path=>path!==missing}),error=>error.code==='application_source_missing');
});
await test('exact successful main push is read back by attempt and main rechecked with GET only',async()=>{
 const h=harness(),proof=await verifyProductionSource(candidate,{token,fetcher:h.fetcher});
 assert.deepEqual(proof,{productionSourceVerified:true,repository,sourceCommit:sourceSha,branch:'main',workflowRunId:123,workflowAttempt:2});
 assert.equal(h.calls.length,5);
 assert.deepEqual(h.calls.map(call=>new URL(call.url).pathname),[`/repos/${repository}/git/ref/heads/main`,`/repos/${repository}/actions/workflows/site-ci.yml/runs`,`/repos/${repository}/actions/runs/123`,`/repos/${repository}/actions/runs/123/attempts/2/jobs`,`/repos/${repository}/git/ref/heads/main`]);
 for(const {url,options}of h.calls){assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(options.headers['x-github-api-version'],'2022-11-28');assert.equal(options.body,undefined);assert.ok(!url.includes(token));}
 assert.equal(new URL(h.calls[1].url).searchParams.get('head_sha'),sourceSha);assert.equal(new URL(h.calls[1].url).searchParams.get('event'),'push');
});
await test('unverified inputs cannot make any GitHub request',async()=>{
 for(const badToken of [undefined,'','a\nb','a\rb','x'.repeat(4097)]){let calls=0;await assert.rejects(verifyProductionSource(candidate,{token:badToken,fetcher:async()=>{calls++;}}),error=>error.code==='verification_inputs');assert.equal(calls,0);}
 for(const patch of [{repository:'foreign/repo'},{branch:'branch'},{event:'pull_request'},{sha:'f'.repeat(39)}])await assert.rejects(verifyProductionSource({...candidate,...patch},{token,fetcher:()=>{throw Error('must not fetch');}}),error=>error.code==='verification_inputs');
});
await test('foreign, PR, wrong workflow and incomplete run listings all fail closed',async()=>{
 for(const patch of [{event:'pull_request'},{head_sha:'b'.repeat(40)},{head_branch:'feature'},{name:'Unrelated checks'},{path:'.github/workflows/foreign.yml'},{repository:{full_name:'foreign/repo'}},{head_repository:{full_name:'foreign/repo'}},{id:0},{id:1.5},{run_attempt:0}])await denied((stage,data)=>stage==='listing'?{...data,workflow_runs:[run(123,patch)]}:undefined,'ci_source_unverified');
 for(const value of [{total_count:0,workflow_runs:[]},{total_count:101,workflow_runs:[run()]},{total_count:2,workflow_runs:[run()]},{total_count:1,workflow_runs:null}])await denied(stage=>stage==='listing'?value:undefined,'ci_source_unverified');
});
await test('a newer failure or in-progress run cannot be hidden behind an older success',async()=>{
 for(const patch of [{status:'completed',conclusion:'failure'},{status:'in_progress',conclusion:null},{status:'completed',conclusion:'cancelled'}])await denied(stage=>stage==='listing'?{total_count:2,workflow_runs:[run(122),run(123,patch)]}:undefined,'latest_ci_not_successful');
 const h=harness((stage,data)=>stage==='listing'?{total_count:2,workflow_runs:[run(123),run(122,{conclusion:'failure'})]}:undefined);assert.equal((await verifyProductionSource(candidate,{token,fetcher:h.fetcher})).workflowRunId,123);
});
await test('selected run readback and its verify job must agree on exact successful source and attempt',async()=>{
 for(const patch of [{id:124},{run_attempt:3},{conclusion:'failure'},{status:'queued'},{head_sha:'b'.repeat(40)},{event:'pull_request'},{head_repository:{full_name:'foreign/repo'}}])await denied(stage=>stage==='run'?run(123,patch):undefined,'ci_readback_mismatch');
 for(const patch of [{name:'verify-other'},{run_id:124},{head_sha:'b'.repeat(40)},{status:'queued'},{conclusion:'failure'},{run_attempt:1}])await denied(stage=>stage==='jobs'?{total_count:1,jobs:[job(patch)]}:undefined,'verify_job_not_successful');
 await denied(stage=>stage==='jobs'?{total_count:2,jobs:[job(),job({id:457})]}:undefined,'verify_job_not_successful');
 for(const value of [{total_count:0,jobs:[]},{total_count:101,jobs:[job()]},{total_count:2,jobs:[job()]}])await denied(stage=>stage==='jobs'?value:undefined,'ci_jobs_unverified');
});
await test('superseded main and non-commit references are denied initially and at final readback',async()=>{
 for(const stageName of ['head','finalHead'])for(const value of [{...ref(),object:{type:'commit',sha:'b'.repeat(40)}},{...ref(),object:{type:'tag',sha:sourceSha}},{...ref(),ref:'refs/heads/foreign'}])await denied(stage=>stage===stageName?value:undefined,'superseded_source');
});
await test('network, redirect, parsing and size failures reveal no credentials or raw error',async()=>{
 const responses=[()=>new Response(privateCanary,{status:403}),()=>new Response('',{status:302,headers:{location:'https://foreign.test/'+privateCanary}}),()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response(privateCanary,{headers:{'content-type':'application/json'}}),()=>{const response=new Response('{}',{headers:{'content-type':'application/json'}});Object.defineProperty(response,'url',{value:'https://foreign.test/'+privateCanary});return response;},()=>{const response=new Response('{}',{headers:{'content-type':'application/json'}});Object.defineProperty(response,'redirected',{value:true});return response;}];
 for(const response of responses)await denied(stage=>stage==='head'?response():undefined,'github_read_failed');
 await denied(stage=>{if(stage==='head')throw Error(privateCanary+' '+token);},'github_read_failed');
 await denied(stage=>stage==='head'?new Response(' '.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}}):undefined,'github_response_bound');
});
await test('prepared workflow stays manual, protected, source-pinned and checks again before deploy',()=>{
 const yaml=readFileSync(new URL('./github-workflows/site-production.yml',import.meta.url),'utf8');
 assert.match(yaml,/on:\n  workflow_dispatch:\n/);assert.doesNotMatch(yaml,/^  (?:push|pull_request|workflow_run|schedule):/m);
 assert.match(yaml,/if: github\.repository == 'YardenRimon\/derech-tkuma-journeys' && github\.ref == 'refs\/heads\/main' && vars\.DERECH_PRODUCTION_ENABLED == 'true'/);
 assert.match(yaml,/environment: derech-cloudflare-production/);assert.match(yaml,/cancel-in-progress: false/);assert.match(yaml,/persist-credentials: false/);assert.match(yaml,/ref: \$\{\{ github\.sha \}\}/);assert.match(yaml,/actions: read/);
 for(const action of yaml.matchAll(/uses: (\S+)/g))assert.match(action[1],/@[a-f0-9]{40}$/);
 const first=yaml.indexOf('node production/production-cd-policy.mjs'),install=yaml.indexOf('npm ci'),migrate=yaml.indexOf('npx wrangler d1 migrations apply'),last=yaml.indexOf('node ../production/production-cd-policy.mjs'),deploy=yaml.indexOf('npx wrangler deploy'),verify=yaml.indexOf('node scripts/verify-production-live.mjs');
 assert.ok(first>0&&first<install&&install<migrate&&migrate<last&&last<deploy&&deploy<verify);assert.equal((yaml.match(/GH_READ_TOKEN: \$\{\{ github\.token \}\}/g)??[]).length,3);assert.match(yaml,/if: always\(\)/);assert.doesNotMatch(yaml,/set -x|printenv|upload-artifact|workflow_run/);
});
await test('CLI rejects absent local context without leaking private environment values',()=>{
 const script=fileURLToPath(new URL('./production-cd-policy.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script],{env:{GITHUB_REPOSITORY:'foreign/repo',GH_READ_TOKEN:privateCanary},encoding:'utf8'});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'Production deployment blocked: repository');assert.ok(!result.stderr.includes(privateCanary));
});
