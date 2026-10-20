/** Explicit build only. No deploy command, domain mutation or profile creation. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {validateProductionProfile,validateProductionCloudflareConfig,canonicalProductionProfile} from '../../production/release-profile.mjs';
import {sanitizedEnvironment,assertNode24,resolveReleaseSha} from './build-cloudflare.mjs';
export const productionRoot=fileURLToPath(new URL('../',import.meta.url));
export function productionBuildInput(environment){
 assertNode24();const profilePath=environment.DERECH_PRODUCTION_PROFILE_PATH,configPath=environment.DERECH_PRODUCTION_CONFIG_PATH;
 if(!profilePath||!configPath)throw new Error('Explicit private production profile/config paths required');
 const sourceCommit=resolveReleaseSha(environment),source=JSON.parse(readFileSync(new URL('../lib/site-release.json',import.meta.url),'utf8'));
 const profile=validateProductionProfile(JSON.parse(readFileSync(profilePath,'utf8')),source.contentRelease,sourceCommit),config=validateProductionCloudflareConfig(JSON.parse(readFileSync(configPath,'utf8')),profile);
 return{profile,config,profilePath,configPath,sourceCommit,profileSha256:createHash('sha256').update(canonicalProductionProfile(profile)).digest('hex')};
}
export function productionBuildPlan(environment,input){
 const base=sanitizedEnvironment(environment);
 return[
  [process.execPath,['scripts/prepare-pages.mjs'],base],
  [process.execPath,['scripts/verify-public-assets.mjs'],base],
  [process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],base],
  ['npm',['test'],base],
  [process.execPath,['scripts/test-production-profile.mjs'],base],
  [process.execPath,['scripts/test-production-workerd.mjs'],base],
  [process.execPath,['--import','./scripts/sites-env.mjs','scripts/build-production-artifact.mjs'],{...base,DERECH_PRODUCTION_PROFILE_PATH:input.profilePath,DERECH_PRODUCTION_CONFIG_PATH:input.configPath,PLATFORM_RELEASE_SHA:input.sourceCommit}],
  [process.execPath,['scripts/validate-production-artifact.mjs'],{...base,DERECH_PRODUCTION_PROFILE_PATH:input.profilePath,DERECH_PRODUCTION_CONFIG_PATH:input.configPath,PLATFORM_RELEASE_SHA:input.sourceCommit}],
 ];
}
export function runProductionBuild(environment=process.env,runner=spawnSync){
 const input=productionBuildInput(environment),head=runner('git',['rev-parse','HEAD'],{cwd:productionRoot,encoding:'utf8'}),dirty=runner('git',['status','--porcelain','--untracked-files=no'],{cwd:productionRoot,encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==input.sourceCommit||dirty.status!==0||dirty.stdout.trim())throw new Error('Production build requires the exact clean accepted source checkout');
 for(const [command,args,env]of productionBuildPlan(environment,input)){const result=runner(command,args,{cwd:productionRoot,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error('Production build gate failed: '+args.join(' '));}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{runProductionBuild();}catch(error){console.error(error.message);process.exitCode=1;}}
