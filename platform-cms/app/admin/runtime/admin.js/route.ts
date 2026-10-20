import asset from '../../../../managed-assets/admin.js?raw';
import { authorizeCmsUser, CmsError } from '@/lib/access';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { await authorizeCmsUser('content'); }
  catch (error) { return new Response('Access required', { status: error instanceof CmsError ? error.status : 503, headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' } }); }
  return new Response(asset, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' } });
}
