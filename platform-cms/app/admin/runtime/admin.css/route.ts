import asset from '../../../../managed-assets/admin.css?raw';
import { authorizeCmsUser, CmsError } from '@/lib/access';
export const dynamic = 'force-dynamic';
// The RSC CSS transform wraps uppercase function declarations as components.
// Keep the local declaration lowercase and expose the HTTP method by alias.
async function getAdminStyles() {
  try { await authorizeCmsUser('content'); }
  catch (error) { return new Response('Access required', { status: error instanceof CmsError ? error.status : 503, headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' } }); }
  return new Response(asset, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' } });
}

export { getAdminStyles as GET };
