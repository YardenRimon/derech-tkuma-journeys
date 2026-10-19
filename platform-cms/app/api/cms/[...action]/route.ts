import {
  CmsError, asRevision, emptyDraft, getBasePage, getBucket,
  getD1, getPageRow, jsonError, listPages, normalizeSlug, renderDocument,
  requireSameOrigin, validateDraft, type Draft,
} from "@/lib/cms";
import { authorizeCmsUser } from "@/lib/access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function action(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-1); }
function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 500_000) throw new CmsError(413, "הבקשה גדולה מדי");
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 500_000) throw new CmsError(413, "הבקשה גדולה מדי");
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new CmsError(400, "JSON לא תקין"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CmsError(400, "בקשה לא תקינה");
  return value as Record<string, unknown>;
}
function requestedSlug(value: unknown): string {
  if (typeof value !== "string") throw new CmsError(400, "חסרה כתובת העמוד");
  return normalizeSlug(value);
}
function conflict(): never { throw new CmsError(409, "העמוד השתנה מאז שפתחת אותו. טען אותו מחדש לפני שמירה."); }

export async function GET(request: Request) {
  try {
    const user = await authorizeCmsUser("content");
    const route = action(request);
    const slug = requestedSlug(new URL(request.url).searchParams.get("slug"));
    const base = getBasePage(slug);
    const row = await getPageRow(slug);
    if (route === "page") {
      return noStore({ slug, title: base.title, pages: listPages(), base,
        draft: row ? JSON.parse(row.draft_json) : emptyDraft(base),
        revision: row?.revision ?? 0, publishedVersion: row?.published_version ?? 0,
        updatedAt: row?.updated_at ?? null,
        permissions: { role: user.role, canPublish: user.canPublish } });
    }
    if (route === "history") {
      const rows = await getD1().prepare("SELECT version, published_by AS publishedBy, published_at AS publishedAt FROM cms_versions WHERE slug = ? ORDER BY version DESC LIMIT 30").bind(slug).all();
      return noStore({ slug, versions: rows.results, permissions: { role: user.role, canPublish: user.canPublish } });
    }
    throw new CmsError(404, "פעולה לא מוכרת");
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const route = action(request);
    if (route !== "upload" && route !== "save" && route !== "publish" && route !== "rollback") {
      throw new CmsError(404, "פעולה לא מוכרת");
    }
    const user = await authorizeCmsUser(route === "publish" || route === "rollback" ? "publish" : "content");
    if (route === "upload") return await upload(request);
    const body = await readJson(request);
    const slug = requestedSlug(body.slug);
    const base = getBasePage(slug);
    const revision = asRevision(body.revision);
    const db = getD1();
    const current = await getPageRow(slug);
    if (revision !== (current?.revision ?? 0)) conflict();
    const now = new Date().toISOString();

    if (route === "save") {
      const draft = await validateDraft(base, body.draft);
      const serialized = JSON.stringify(draft);
      if (current) {
        const result = await db.prepare("UPDATE cms_pages SET draft_json = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE slug = ? AND revision = ?")
          .bind(serialized, user.userId, now, slug, revision).run();
        if (result.meta.changes !== 1) conflict();
      } else {
        const result = await db.prepare("INSERT OR IGNORE INTO cms_pages (slug, draft_json, revision, published_version, updated_by, updated_at) VALUES (?, ?, 1, 0, ?, ?)")
          .bind(slug, serialized, user.userId, now).run();
        if (result.meta.changes !== 1) conflict();
      }
      return noStore({ slug, revision: revision + 1 });
    }

    if (!current) throw new CmsError(400, "שמור את הטיוטה לפני הפרסום");
    if (route === "publish") {
      const draft = await validateDraft(base, JSON.parse(current.draft_json)) as Draft;
      const html = await renderDocument(base, draft);
      const results = await db.batch([
        db.prepare("INSERT INTO cms_versions (slug, version, html, draft_json, published_by, published_at) SELECT slug, published_version + 1, ?, draft_json, ?, ? FROM cms_pages WHERE slug = ? AND revision = ?")
          .bind(html, user.userId, now, slug, revision),
        db.prepare("UPDATE cms_pages SET published_html = ?, published_version = published_version + 1, revision = revision + 1, updated_by = ?, updated_at = ? WHERE slug = ? AND revision = ?")
          .bind(html, user.userId, now, slug, revision),
      ]);
      if (results[1].meta.changes !== 1) conflict();
      return noStore({ slug, revision: revision + 1, publishedVersion: current.published_version + 1 });
    }
    if (route === "rollback") {
      const version = asRevision(body.version);
      if (version < 1) throw new CmsError(400, "מספר פרסום אינו תקין");
      const prior = await db.prepare("SELECT html, draft_json FROM cms_versions WHERE slug = ? AND version = ?").bind(slug, version).first<{ html: string; draft_json: string }>();
      if (!prior) throw new CmsError(404, "הגרסה לא נמצאה");
      await validateDraft(base, JSON.parse(prior.draft_json));
      const results = await db.batch([
        db.prepare("INSERT INTO cms_versions (slug, version, html, draft_json, published_by, published_at) SELECT slug, published_version + 1, ?, ?, ?, ? FROM cms_pages WHERE slug = ? AND revision = ?")
          .bind(prior.html, prior.draft_json, user.userId, now, slug, revision),
        db.prepare("UPDATE cms_pages SET draft_json = ?, published_html = ?, published_version = published_version + 1, revision = revision + 1, updated_by = ?, updated_at = ? WHERE slug = ? AND revision = ?")
          .bind(prior.draft_json, prior.html, user.userId, now, slug, revision),
      ]);
      if (results[1].meta.changes !== 1) conflict();
      return noStore({ slug, revision: revision + 1, publishedVersion: current.published_version + 1 });
    }
    throw new CmsError(404, "פעולה לא מוכרת");
  } catch (error) { return jsonError(error); }
}

async function upload(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new CmsError(415, "ניתן להעלות PNG, JPEG או WebP בלבד");
  const max = 5 * 1024 * 1024;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > max) throw new CmsError(413, "התמונה גדולה מ־5MB");
  const reader = request.body?.getReader();
  if (!reader) throw new CmsError(400, "לא צורפה תמונה");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); throw new CmsError(413, "התמונה גדולה מ־5MB"); }
    chunks.push(value);
  }
  if (total < 12) throw new CmsError(415, "קובץ תמונה לא תקין");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const isPng = bytes.subarray(0, 8).every((v, i) => v === [137,80,78,71,13,10,26,10][i]);
  const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp = String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if ((contentType === "image/png" && !isPng) || (contentType === "image/jpeg" && !isJpeg) || (contentType === "image/webp" && !isWebp)) {
    throw new CmsError(415, "תוכן הקובץ אינו תואם לסוג התמונה");
  }
  const key = crypto.randomUUID();
  await getBucket().put(key, bytes, { httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" } });
  return noStore({ url: `/media/${key}` }, 201);
}
