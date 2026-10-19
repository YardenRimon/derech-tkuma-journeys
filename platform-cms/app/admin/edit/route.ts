import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import { CmsError, emptyDraft, getBasePage, getPageRow, renderDocument } from "@/lib/cms";
import { authorizeCmsUser } from "@/lib/access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL(chatGPTSignInPath(`/admin/edit${url.search}`), request.url));
  try {
    await authorizeCmsUser("content");
    const slug = url.searchParams.get("slug") ?? "/";
    const base = getBasePage(slug);
    const row = await getPageRow(slug);
    const draft = row ? JSON.parse(row.draft_json) : emptyDraft(base);
    let html = await renderDocument(base, draft);
    const script = '<script src="/editor.js" defer></script>';
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${script}</body>`) : `${html}${script}`;
    return new Response(html, { headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow", "x-frame-options": "SAMEORIGIN",
      "content-security-policy": "frame-ancestors 'self'",
    } });
  } catch (error) {
    console.error("Editor unavailable", error);
    const status = error instanceof CmsError ? error.status : 503;
    return new Response(status === 403 ? "אין הרשאה" : "העורך אינו זמין כרגע", { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  }
}
