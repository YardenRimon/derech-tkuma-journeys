import AdminShell from "../AdminShell";
/* eslint-disable @next/next/no-css-tags, @next/next/no-html-link-for-pages -- Protected pages use full navigation to refresh server permissions and initialize their DOM editor. */
import { requireChatGPTUser, getAuthProvider } from "@/app/chatgpt-auth";
import { authorizeCmsUser, CmsError } from "@/lib/access";
import Script from "next/script";

export const dynamic = "force-dynamic";
export const metadata = { title: "משתמשים והרשאות | דרך התקומה", robots: { index: false, follow: false } };

export default async function UsersPage() {
  await requireChatGPTUser("/admin/users");
  let email = "";
  try { email = (await authorizeCmsUser("users")).email; }
  catch (error) {
    const unavailable = error instanceof CmsError && error.status === 503;
    return <AdminShell active="/admin/users" title={unavailable ? "ניהול המשתמשים אינו זמין כרגע" : "אין הרשאה לניהול משתמשים"}><section className="admin-card"><p>{unavailable ? "נסה שוב בעוד כמה דקות." : "ניהול המשתמשים והרשאותיהם זמין למנהלי מערכת בלבד."}</p><a href="/admin">חזרה לעריכת תוכן</a></section></AdminShell>;
  }
  return <AdminShell active="/admin/users" title="משתמשים והרשאות" description="ניהול גישת הצוות, תפקידי עריכה והרשאות פרסום." email={email} role="system_admin" id="user-management" currentEmail={email}>
    <div className="users-container">
      <div className="users-heading"><div><p>{getAuthProvider() === "sites" ? "המשתמשים מתחברים עם חשבון ChatGPT באימייל שמופיע כאן." : "המשתמשים מתחברים עם האימייל שמופיע כאן באמצעות ההתחברות המאובטחת של הארגון."}</p></div><button id="add-user" type="button" aria-expanded="false" aria-controls="create-user">הוסף משתמש</button></div>
      <p className="users-help">מנהל מערכת מנהל משתמשים ותוכן. עורך תוכן שומר טיוטות; ניתן להעניק לו גם הרשאת פרסום ושחזור גרסאות. לא נשלחות הודעות הזמנה.</p>
      <form id="create-user" className="user-form" hidden>
        <h2>הוספת משתמש</h2>
        <label>אימייל<input name="email" type="email" autoComplete="email" dir="ltr" maxLength={254} required /></label>
        <label>תפקיד<select name="role" defaultValue="content_editor"><option value="content_editor">עורך תוכן</option><option value="system_admin">מנהל מערכת</option></select></label>
        <label className="user-checkbox"><input name="canPublish" type="checkbox" />הרשאת פרסום ושחזור גרסאות</label>
        <p className="admin-hint">ההרשאה תקושר לזהות המשתמש בהתחברות הראשונה. ודא שזה האימייל שאיתו הוא מתחבר.</p>
        <div className="user-actions"><button type="submit">הוסף משתמש</button><button id="cancel-create" type="button">ביטול</button></div>
      </form>
      <div className="users-status-row"><p id="users-status" role="status" aria-live="polite">טוען משתמשים…</p><button id="refresh-users" type="button">רענן רשימה</button></div>
      <section id="users-list" aria-label="משתמשי האתר" />
    </div>
    <Script src="/users.js" strategy="afterInteractive" />
  </AdminShell>;
}
