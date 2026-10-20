import AdminShell from "./AdminShell";
/* eslint-disable @next/next/no-css-tags, @next/next/no-html-link-for-pages -- Protected pages use full navigation to refresh server permissions and initialize their DOM editor. */
import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { listPages } from "@/lib/cms";
import { authorizeCmsUser, CmsError } from "@/lib/access";
import Script from "next/script";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function AdminPage() {
  await requireChatGPTUser("/admin");
  let email: string | null = null;
  let unavailable = false;
  let role = "content_editor";
  let canPublish = false;
  try {
    const user = await authorizeCmsUser("content");
    email = user.email;
    role = user.role;
    canPublish = user.canPublish;
  } catch (error) {
    unavailable = error instanceof CmsError && error.status === 503;
  }
  if (!email) {
    return <AdminShell active="/admin" title={unavailable ? "העריכה אינה זמינה כרגע" : "אין הרשאה"}><section className="admin-card"><p>{unavailable ? "נסה שוב בעוד כמה דקות." : "יש לפנות למנהל המערכת לקבלת הרשאה לחשבון שאיתו התחברת."}</p><a href={chatGPTSignOutPath("/admin")}>התחברות עם חשבון אחר</a></section></AdminShell>;
  }
  const pages = listPages();
  return <AdminShell active="/admin" title="עריכת עמודי האתר" description="בחר עמוד וערוך את התוכן ישירות בתצוגה המקדימה. שמור טיוטה ובדוק אותה לפני הפרסום." email={email} role={role} id="admin-app" className="admin-editor" canPublish={canPublish}>
      <div className="admin-toolbar">
        <label htmlFor="page-picker">עמוד</label>
        <select id="page-picker" defaultValue="/">{pages.map((page) => <option key={page.slug} value={page.slug}>{page.title}</option>)}</select>
        <button id="save" type="button">שמירת טיוטה</button>
        <button id="preview" type="button">תצוגה מקדימה</button>
        <button id="publish" type="button">פרסום</button>
        <button id="restore" type="button">היסטוריית פרסומים</button>
        {!canPublish && <span className="admin-permission-note">אפשר לשמור טיוטה; הפרסום נעשה בידי מנהל או עורך עם הרשאת פרסום.</span>}
        <span id="admin-status" role="status" aria-live="polite" />
      </div>
      <section id="admin-stale" className="admin-card" role="region" aria-label="שינויים ישנים לשחזור" hidden />
      <div id="admin-toast" hidden />
      <div className="admin-workspace">
        <iframe id="editor-frame" title="עריכת העמוד" src="/admin/edit?slug=/" />
        <aside id="admin-panel" aria-label="כלי עריכה">
          <div className="admin-tabs" role="tablist" aria-label="כלי עריכה">
            <button type="button" role="tab" aria-controls="panel-content" data-tab="field" aria-selected="true">תוכן</button>
            <button type="button" role="tab" aria-controls="panel-content" data-tab="sections" aria-selected="false">סדר עמוד</button>
            <button type="button" role="tab" aria-controls="panel-content" data-tab="seo" aria-selected="false">SEO</button>
            <button type="button" role="tab" aria-controls="panel-content" data-tab="history" aria-selected="false">גרסאות</button>
          </div>
          <div id="panel-content" role="tabpanel" />
        </aside>
      </div>
      <Script src="/admin/runtime/admin.js" strategy="afterInteractive" />
    </AdminShell>;
}
