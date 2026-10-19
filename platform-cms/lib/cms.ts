import { env } from "cloudflare:workers";
import { CmsError, assertIsolatedD1Scope } from "@/lib/access";
import generatedPages from "@/lib/generated-pages.json";
import { managedCollectionFields, projectPublishedCollections } from "@/lib/collection-projection";
import { D1Collections } from "@/lib/collection-d1";
import { siteScope } from "@/lib/site-scope";
import visualResources from "@/lib/visual-resource-map.json";
import { prepareReviewRuntime } from "@/lib/review-runtime";

export { CmsError } from "@/lib/access";

export type Field = { type: "text" | "image"; value: string; alt?: string };
export type BasePage = {
  slug?: string;
  title: string;
  description?: string | null;
  page: string;
  sections: { id: string; html: string }[];
  fields: Record<string, Field>;
  shellPrefix: string;
  shellSuffix: string;
};
export type Draft = {
  fields: Record<string, { value: string; alt?: string; english?: string }>;
  order: string[];
  seo?: { title: string; description: string };
};
export type PageRow = {
  slug: string;
  draft_json: string;
  revision: number;
  published_html: string | null;
  published_version: number;
  updated_by: string;
  updated_at: string;
};

const pages = generatedPages as Record<string, BasePage>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function normalizeSlug(value: string): string {
  let raw: string;
  try { raw = decodeURIComponent(value).trim(); } catch { throw new CmsError(400, "כתובת העמוד אינה תקינה"); }
  if (!raw.startsWith("/") || raw.includes("?") || raw.includes("#") || raw.includes("//")) {
    throw new CmsError(400, "כתובת העמוד אינה תקינה");
  }
  return raw === "/" ? "/" : `${raw.replace(/\/+$/, "")}/`;
}

export function getBasePage(slug: string): BasePage {
  const normalized=normalizeSlug(slug), page = pages[normalized];
  if (!page) throw new CmsError(404, "העמוד לא נמצא");
  return {...page,slug:normalized};
}

export function listPages() {
  return Object.entries(pages).map(([slug, page]) => ({ slug, title: page.title }));
}

export function emptyDraft(base: BasePage): Draft {
  return { fields: {}, order: base.sections.map((section) => section.id) };
}

export function editablePageDraft(base:BasePage,draft:Draft):Draft{
 const managed=managedCollectionFields(base.slug??'/');
 return {...draft,fields:Object.fromEntries(Object.entries(draft.fields).filter(([id])=>!managed[id]))};
}

function bindingEnv() {
  return env as unknown as { DB?: D1Database; BUCKET?: R2Bucket; CMS_OWNER_EMAIL?: string; CMS_EDITOR_EMAILS?: string };
}

export function getD1(): D1Database {
  const db = bindingEnv().DB;
  if (!db) throw new CmsError(503, "מסד הנתונים אינו זמין");
  return db;
}

export function getBucket(): R2Bucket {
  const bucket = bindingEnv().BUCKET;
  if (!bucket) throw new CmsError(503, "אחסון הקבצים אינו זמין");
  return bucket;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new CmsError(403, "מקור הבקשה אינו מורשה");
}

export async function getPageRow(slug: string): Promise<PageRow | null> {
  const db = getD1();
  await assertIsolatedD1Scope(db);
  return db.prepare("SELECT * FROM cms_pages WHERE slug = ?").bind(normalizeSlug(slug)).first<PageRow>();
}

export async function validateDraft(base: BasePage, input: unknown): Promise<Draft> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CmsError(400, "טיוטה לא תקינה");
  const candidate = input as Partial<Draft>;
  const managed=managedCollectionFields(base.slug??'/');
  if (!candidate.fields || typeof candidate.fields !== "object" || Array.isArray(candidate.fields)) throw new CmsError(400, "שדות הטיוטה אינם תקינים");
  if (!Array.isArray(candidate.order)) throw new CmsError(400, "סדר המקטעים אינו תקין");
  if(Object.keys(candidate.fields).some(id=>managed[id]))throw new CmsError(400,'שדות סיורים ומועדים נערכים במסך סיורים ומועדים');
  const ids = base.sections.map((section) => section.id);
  if (candidate.order.length !== ids.length || new Set(candidate.order).size !== ids.length || candidate.order.some((id) => !ids.includes(id))) {
    throw new CmsError(400, "סדר המקטעים חייב לכלול כל מקטע פעם אחת");
  }
  const cleaned: Draft = { fields: Object.create(null) as Draft["fields"], order: [...candidate.order] };
  if (candidate.seo !== undefined) {
    const seo = candidate.seo;
    if (!seo || typeof seo !== "object" || Array.isArray(seo) ||
        typeof seo.title !== "string" || !seo.title.trim() || seo.title.length > 120 ||
        typeof seo.description !== "string" || seo.description.length > 320) {
      throw new CmsError(400, "נתוני SEO אינם תקינים");
    }
    cleaned.seo = { title: seo.title, description: seo.description };
  }
  const originals = new Set(Object.values(base.fields).filter((field) => field.type === "image").map((field) => field.value));
  for (const [id, supplied] of Object.entries(candidate.fields)) {
    const definition = Object.hasOwn(base.fields, id) ? base.fields[id] : undefined;
    if (!definition || !supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new CmsError(400, `שדה לא מוכר: ${id}`);
    const value = (supplied as { value?: unknown }).value;
    if (typeof value !== "string") throw new CmsError(400, `ערך לא תקין: ${id}`);
    if (definition.type === "text") {
      if (value.length > 10_000) throw new CmsError(400, `הטקסט ארוך מדי: ${id}`);
      const english = (supplied as { english?: unknown }).english;
      if (english !== undefined && (typeof english !== "string" || english.length > 10_000)) throw new CmsError(400, `התרגום ארוך מדי: ${id}`);
      cleaned.fields[id] = { value, ...(english === undefined ? {} : { english }) };
    } else {
      const alt = (supplied as { alt?: unknown }).alt;
      if (alt !== undefined && (typeof alt !== "string" || alt.length > 500)) throw new CmsError(400, `תיאור תמונה לא תקין: ${id}`);
      if (originals.has(value)) {
        if (!originals.has(value)) throw new CmsError(400, `תמונה מקורית לא מוכרת: ${id}`);
      } else {
        const match = /^\/media\/([0-9a-f-]+)$/i.exec(value);
        if (!match || !uuidPattern.test(match[1]) || !(await getBucket().head(match[1]))) throw new CmsError(400, `תמונה שהועלתה לא נמצאה: ${id}`);
      }
      cleaned.fields[id] = { value, ...(alt === undefined ? {} : { alt }) };
    }
  }
  return cleaned;
}

export async function renderDocument(base: BasePage, draft: Draft): Promise<string> {
  // Historical page versions may predate typed collection ownership. Preserve
  // their audit JSON but never let those old field overrides compete publicly.
  draft=editablePageDraft(base,draft);
  const sections = new Map(base.sections.map((section) => [section.id, section.html]));
  const html = base.shellPrefix + draft.order.map((id) => {
    const section = sections.get(id);
    if (section === undefined) throw new CmsError(400, "מקטע לא מוכר");
    return section;
  }).join("") + base.shellSuffix;
  if (!draft.seo && Object.keys(draft.fields).length === 0) return localizeVisualResources(html);
  const rewriter = new HTMLRewriter()
    .on("head > title", { element(element) {
      if (draft.seo) element.setInnerContent(draft.seo.title, { html: false });
    } })
    .on('head > meta[name="description"]', { element(element) {
      if (draft.seo) element.setAttribute("content", draft.seo.description);
    } })
    .on('head > meta[property="og:title"]', { element(element) {
      if (draft.seo) element.setAttribute("content", draft.seo.title);
    } })
    .on('head > meta[property="og:description"]', { element(element) {
      if (draft.seo) element.setAttribute("content", draft.seo.description);
    } })
    .on("[data-edit-id]", { element(element) {
      const id = element.getAttribute("data-edit-id");
      if (!id || base.fields[id]?.type !== "text") return;
      const edit = draft.fields[id];
      if (edit?.english?.trim()) {
        const source = escapeHtml(edit.value);
        const translation = escapeHtml(edit.english);
        element.setInnerContent(`<span class="gt-src">${source}</span><span class="gt-alt" translate="no">${translation}</span>`, { html: true });
      } else if (edit) element.setInnerContent(edit.value, { html: false });
    } })
    .on("[data-image-id]", { element(element) {
      const id = element.getAttribute("data-image-id");
      if (!id || base.fields[id]?.type !== "image") return;
      const edit = draft.fields[id];
      if (edit) {
        element.setAttribute("src", edit.value);
        if (edit.value !== base.fields[id].value) { element.removeAttribute("srcset"); element.removeAttribute("sizes"); element.removeAttribute("data-src"); element.removeAttribute("data-srcset"); }
        if (edit.alt !== undefined) element.setAttribute("alt", edit.alt);
      }
    } });
  return localizeVisualResources(await rewriter.transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })).text());
}

function localizeVisualResources(html:string):string{
 html=prepareReviewRuntime(html);
 // Only exact proven static resources, never general external links, canonical or schema identities.
 for(const [url,path]of Object.entries(visualResources)){
  const local=encodeURI(path);
  html=html.split(url).join(local).split(url.replaceAll('/','\\/')).join(local.replaceAll('/','\\/'));
 }
 return html;
}

export async function getPublishedPage(slug: string): Promise<string> {
  const normalized = normalizeSlug(slug);
  const base = getBasePage(normalized);
  const row = await getPageRow(normalized);
  if (!row?.published_html) return applyPublishedCollections(await renderDocument(base, emptyDraft(base)),normalized);
  // Use the published revision, never the current (possibly unpublished) draft.
  // Re-render it with the deployed template so code releases update public pages.
  const published = await getD1().prepare(
    "SELECT draft_json FROM cms_versions WHERE slug = ? AND version = ?",
  ).bind(normalized, row.published_version).first<{ draft_json: string }>();
  if (!published) return applyPublishedCollections(row.published_html,normalized);
  return applyPublishedCollections(await renderDocument(base, JSON.parse(published.draft_json) as Draft),normalized);
}

export async function applyPublishedCollections(html:string,slug:string):Promise<string>{
 if(!Object.keys(managedCollectionFields(slug)).length)return html;
 const store=new D1Collections(getD1()),scope=siteScope();
 // Lists include explicit withdrawals. Projection never reads their draft values.
 const rows=(await Promise.all([store.list(scope,'tour'),store.list(scope,'occurrence')])).flat();
 return projectPublishedCollections(html,slug,rows);
}

export function jsonError(error: unknown): Response {
  if (error instanceof CmsError) return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
  console.error("CMS failure", error);
  return Response.json({ error: "הפעולה נכשלה. נסה שוב מאוחר יותר." }, { status: 503, headers: { "cache-control": "no-store" } });
}

export function asRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CmsError(400, "מספר גרסה אינו תקין");
  return value as number;
}

export function mediaKey(value: string): string | null {
  return uuidPattern.test(value) ? value.toLowerCase() : null;
}
