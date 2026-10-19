import {spawnSync}from'node:child_process';import{readFileSync}from'node:fs';import{fileURLToPath,pathToFileURL}from'node:url';import path from'node:path';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function assertNode24(version=process.versions.node){if(Number(version.split('.')[0])!==24)throw new Error('Cloudflare release requires Node24');}
const configured=value=>typeof value==='string'&&value.length>0&&!/(?:replace|placeholder|example|change.?me|todo|00000000)/i.test(value);
export function validateCloudflareConfig(config){
 const errors=[],vars=config?.vars??{},db=config?.d1_databases?.find(x=>x.binding==='DB'),bucket=config?.r2_buckets?.find(x=>x.binding==='BUCKET');
 if(config?.name!=='derech-tkuma-review')errors.push('Worker name must be derech-tkuma-review');
 if(!/^[a-f0-9]{32}$/.test(config?.account_id??'')||!configured(config.account_id))errors.push('Real account_id required');
 if(!db||db.database_name!=='derech-tkuma-cms-review'||!configured(db.database_id)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(db.database_id))errors.push('Real DB binding UUID and isolated review database name required');
 if(config?.d1_databases?.length!==1||config?.r2_buckets?.length!==1||bucket?.bucket_name!=='derech-tkuma-media-review')errors.push('Exactly one isolated DB and BUCKET binding required');
 if(config?.workers_dev!==true||config?.preview_urls!==false||config?.routes?.length||config?.route)errors.push('Review deployment must use workers.dev only, preview URLs disabled, and no domain routes');
 if(config?.assets?.run_worker_first!==true||config?.assets?.binding!=='ASSETS')errors.push('ASSETS binding and worker-first routing are required for static noindex responses');
 if(config?.main!=='./build/cloudflare-worker.ts'||!config?.compatibility_flags?.includes('nodejs_compat'))errors.push('Standalone Worker entry and nodejs_compat required');
 try{const issuer=new URL(vars.CF_ACCESS_ISSUER);if(!configured(vars.CF_ACCESS_ISSUER)||issuer.origin!==vars.CF_ACCESS_ISSUER||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.origin))throw 0;}catch{errors.push('Exact configured Cloudflare Access issuer required');}
 if(!configured(vars.CF_ACCESS_AUDIENCE)||!/^[a-f0-9]{32,128}$/.test(vars.CF_ACCESS_AUDIENCE))errors.push('Real Access application audience required');
 try{const origin=new URL(vars.PLATFORM_PUBLIC_ORIGIN);if(!configured(vars.PLATFORM_PUBLIC_ORIGIN)||origin.origin!==vars.PLATFORM_PUBLIC_ORIGIN||origin.protocol!=='https:'||!origin.hostname.endsWith('.workers.dev'))throw 0;}catch{errors.push('Configured workers.dev preview origin required');}
 if(vars.CMS_ADAPTER_MODE!=='isolated-d1'||vars.CMS_TENANT_ID!=='derech'||vars.CMS_SITE_ID!=='derech-main'||vars.PLATFORM_RELEASE_STAGE!=='review')errors.push('Isolated derech/derech-main review scope required');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vars.CMS_OWNER_EMAIL??''))errors.push('Configured CMS owner email required');
 if(Object.keys(vars).some(key=>/(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CREDENTIAL)/.test(key)))errors.push('Runtime secrets must use provider secret storage, never config vars');
 if(errors.length)throw new Error('Cloudflare config blocked:\n- '+errors.join('\n- '));return config;
}
export function resolveReleaseSha(environment){const sha=environment.WORKERS_CI_COMMIT_SHA??environment.GITHUB_SHA??environment.PLATFORM_RELEASE_SHA;if(!/^[a-f0-9]{40}$/.test(sha??''))throw new Error('A full source commit SHA is required');return sha;}
export function sanitizedEnvironment(environment){return Object.fromEntries(Object.entries(environment).filter(([key])=>!/(?:CLOUDFLARE|(^|_)CF_|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|PRIVATE_KEY|COOKIE|BEARER|JWT|DATABASE_URL|SIGNING_KEY|CMS_OWNER_EMAIL|PLATFORM_DEPLOY_TARGET|PLATFORM_RELEASE_SHA|PLATFORM_CF_CONFIG_PATH)/i.test(key)));}
export function releasePlan(environment,config){assertNode24();validateCloudflareConfig(config);const sha=resolveReleaseSha(environment),base=sanitizedEnvironment(environment);return [
 [process.execPath,['scripts/verify-public-assets.mjs'],base],
 ['npm',['run','prepare:pages:verify'],base],
 ['npm',['run','check'],base],['npm',['test'],base],
 [process.execPath,['--experimental-strip-types','scripts/test-backup.mjs'],base],
 [process.execPath,['--experimental-strip-types','scripts/test-contact.mjs'],base],
 ['npm',['run','build'],{...base,PLATFORM_DEPLOY_TARGET:'cloudflare',PLATFORM_RELEASE_SHA:sha,PLATFORM_CF_CONFIG_PATH:environment.PLATFORM_CF_CONFIG_PATH??path.join(projectRoot,'wrangler.cloudflare.json')}],
 [process.execPath,['scripts/verify-cloudflare-size.mjs'],base],
 ];}
export function runRelease(environment=process.env,runner=spawnSync){const configPath=environment.PLATFORM_CF_CONFIG_PATH??path.join(projectRoot,'wrangler.cloudflare.json'),config=JSON.parse(readFileSync(configPath,'utf8'));for(const [command,args,env]of releasePlan({...environment,PLATFORM_CF_CONFIG_PATH:configPath},config)){const result=runner(command,args,{cwd:projectRoot,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error('Cloudflare build gate failed: '+args.join(' '));}}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{runRelease();}catch(error){console.error(error.message);process.exitCode=1;}}
