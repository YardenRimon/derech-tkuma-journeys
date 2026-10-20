import vinext from 'vinext';
import {defineConfig} from 'vite';
import {compressedSourcePages} from './build/cloudflare-source-plugin';
import {productionBuildInput} from './scripts/build-production.mjs';
export default defineConfig(async()=>{
 const {profile,config,sourceCommit,profileSha256}=productionBuildInput(process.env);
 const {cloudflare}=await import('@cloudflare/vite-plugin');
 return{
  envPrefix:'DERECH_DISABLED_CLIENT_ENV_',
  define:{__DERECH_PRODUCTION_BUILD__:'true',__DERECH_PRODUCTION_PROFILE__:JSON.stringify(profile),__PLATFORM_AUTH_PROVIDER__:JSON.stringify('supabase'),__PLATFORM_AUTH_REQUIRE_MFA__:JSON.stringify(config.vars.PLATFORM_AUTH_REQUIRE_MFA!=='false')},
  build:{outDir:'dist-production'},
  environments:{rsc:{build:{outDir:'dist-production/server'}},ssr:{build:{outDir:'dist-production/server/ssr'}},client:{build:{outDir:'dist-production/client'}}},
  plugins:[vinext({rscOutDir:'dist-production/server',ssrOutDir:'dist-production/server/ssr',clientOutDir:'dist-production/client'}),compressedSourcePages(),cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']},inspectorPort:false,config:{...config,main:'./build/production-worker.ts',vars:{...config.vars,PLATFORM_RELEASE_SHA:sourceCommit,DERECH_PRODUCTION_PROFILE_SHA256:profileSha256}}})],
 };
});
