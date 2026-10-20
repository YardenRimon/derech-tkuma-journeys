import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";
import {compressedSourcePages}from"./build/cloudflare-source-plugin";
import {readFile}from'node:fs/promises';
import {assertNode24,validateCloudflareConfig}from'./scripts/build-cloudflare.mjs';
export default defineConfig(async () => {
  const target=process.env.PLATFORM_DEPLOY_TARGET??'sites';
  if(target!=='sites'&&target!=='cloudflare')throw new Error('Unknown platform deployment target');
  const standalone=target==='cloudflare';
  const portable=standalone?JSON.parse(await readFile(process.env.PLATFORM_CF_CONFIG_PATH??'wrangler.cloudflare.json','utf8')):null;
  if(standalone){assertNode24();validateCloudflareConfig(portable);if(!/^[a-f0-9]{40}$/.test(process.env.PLATFORM_RELEASE_SHA??''))throw new Error('Use the checked Cloudflare build with full source SHA');}
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    define: { __PLATFORM_AUTH_PROVIDER__: JSON.stringify(standalone?(portable.vars.PLATFORM_AUTH_MODE??'cloudflare-access'):'sites') },
    server: { host:'127.0.0.1', watch: { useFsEvents: false, usePolling: true } },
    plugins: [vinext(), ...(standalone?[compressedSourcePages()]:[]), ...(!standalone?[sites({mockAuth:true})]:[]), cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, inspectorPort:false,
      config: standalone?{...portable,main:'./build/cloudflare-worker.ts',vars:{...portable.vars,PLATFORM_RELEASE_SHA:process.env.PLATFORM_RELEASE_SHA}}:{ main:"./build/sites-worker.ts", compatibility_date:"2026-05-15", compatibility_flags:["nodejs_compat"],
        d1_databases:[{binding:"DB",database_name:"platform-cms-local",database_id:"00000000-0000-4000-8000-000000000000"}],
        r2_buckets:[{binding:"BUCKET",bucket_name:"platform-cms-local"}] }
    })]
  };
});
