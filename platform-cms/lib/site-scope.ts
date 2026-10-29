import { env } from "cloudflare:workers";
import { CmsError } from "@/lib/access";
import type { Scope } from "./collection-core";
/** Pilot scope is deployment-owned, never read from a body, query string, domain or free header.
 * Shared SaaS replaces this with verified active membership + site grant resolution.
 */
export function siteScope(): Scope {
 const config=env as unknown as {CMS_TENANT_ID?:string;CMS_SITE_ID?:string};
 if(!config.CMS_TENANT_ID||!config.CMS_SITE_ID) throw new CmsError(503,"הקשר האתר טרם הוגדר");
 return {tenantId:config.CMS_TENANT_ID,siteId:config.CMS_SITE_ID};
}
