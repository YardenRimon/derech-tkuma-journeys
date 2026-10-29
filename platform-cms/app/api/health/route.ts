import { env } from "cloudflare:workers";
import release from "@/lib/site-release.json";
import { identityHealth, type IdentityHealthConfig } from "@/lib/identity-health";
import {productionRelease} from "@/lib/visitor-release";
export const dynamic = "force-dynamic";
/** Read-only readiness, safe for an external uptime monitor. No auth/bootstrap writes. */
export async function GET(request?:Request) {
 const config=env as unknown as {DB?:D1Database;BUCKET?:R2Bucket;CMS_ADAPTER_MODE?:string;CMS_TENANT_ID?:string;CMS_SITE_ID?:string} & IdentityHealthConfig;
 let database=false;
 try {
  if(config.DB && config.CMS_ADAPTER_MODE==='isolated-d1' && config.CMS_TENANT_ID && config.CMS_SITE_ID){
   const scope=await config.DB.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();
   const tables=await config.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('cms_pages','cms_versions','cms_users','cms_records','cms_record_history','cms_task_mirrors','cms_task_commands','cms_task_audit')").first<{n:number}>();
   database=scope?.tenant_id===config.CMS_TENANT_ID && scope?.site_id===config.CMS_SITE_ID && tables?.n===8;
  }
 }catch{/* Diagnostics stay private; a public monitor gets readiness only. */}
 const mediaBinding=!!config.BUCKET,identity=await identityHealth(config),ready=database&&mediaBinding&&identity.identityReady;
 return Response.json({status:ready?'ready':'starting',mode:request&&productionRelease(new URL(request.url))?'production':'review',contentRelease:release.contentRelease,pages:release.pages,database,mediaBinding,mediaReadWriteTested:false,...identity},{status:ready?200:503,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
}
