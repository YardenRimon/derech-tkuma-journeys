import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";
export default defineConfig(async () => {
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    define: { __PLATFORM_AUTH_PROVIDER__: JSON.stringify("sites") },
    server: { watch: { useFsEvents: false, usePolling: true } },
    plugins: [vinext(), sites({mockAuth:true}), cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, inspectorPort:false,
      config: { main:"./build/sites-worker.ts", compatibility_date:"2026-05-15", compatibility_flags:["nodejs_compat"],
        d1_databases:[{binding:"DB",database_name:"platform-cms-local",database_id:"00000000-0000-4000-8000-000000000000"}],
        r2_buckets:[{binding:"BUCKET",bucket_name:"platform-cms-local"}] }
    })]
  };
});
