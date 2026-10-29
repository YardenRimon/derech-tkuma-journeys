import { authorizeCmsUser, CmsError } from '@/lib/access';
import { getD1, jsonError } from '@/lib/cms';
import { siteScope } from '@/lib/site-scope';
import { operationalReport, ReportError } from '@/lib/report-core';
export const dynamic='force-dynamic';
export async function GET(request: Request) {
 try {
  const user=await authorizeCmsUser('users');
  if (new URL(request.url).search) throw new CmsError(400,'הקשר הדוח נקבע בשרת; אין פרמטרים לבחירת אתר');
  return Response.json(await operationalReport(getD1(),siteScope(),user.role==='system_admin'),{headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow'}});
 } catch(error) { const response=jsonError(error instanceof ReportError?new CmsError(error.status,error.message):error);response.headers.set('cache-control','private, no-store');return response; }
}
