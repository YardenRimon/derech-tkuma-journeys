import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { authorizeCmsUser } from "@/lib/access";
import Script from "next/script";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function TasksPage() {
 await requireChatGPTUser("/admin/tasks"); const user=await authorizeCmsUser("content");
 return <main id="task-app" dir="rtl">
  <link rel="stylesheet" href="/admin.css"/><link rel="stylesheet" href="/tasks.css"/>
  <header><h1>שאלות, בדיקות ובקשות גישה</h1><nav aria-label="ניהול האתר"><a href="/admin">עריכת עמודים</a> · <a href="/admin/collections">סיורים ומועדים</a> · <a href={chatGPTSignOutPath("/")}>התנתקות</a></nav></header>
  <p>כאן מרוכזות משימות האתר מתוך מערכת העבודה. השאלה והציטוט מוצגים כפי שנקלטו. תשובה נשמרת לבדיקה וסנכרון; מצב המקור מתעדכן רק לאחר אישור הסנכרון.</p>
  <p className="task-note">בירור תוכן אינו משנה את התוכן באתר ואינו עוצר את העתקת התוכן הקיים. אל תכתוב כאן סיסמאות או פרטי תשלום.</p>
  {user.role==='system_admin' && <details><summary>עדכון רשימה ממערכת העבודה</summary><p>למנהל בלבד: בחר קובץ עדכון שהופק ממערכת העבודה. משימות קיימות ישמרו על זהותן ועל היסטוריית המענה.</p><label>קובץ עדכון משימות <input id="task-import" type="file" accept="application/json,.json"/></label></details>}
  <div className="task-filters"><label>סוג <select id="task-category"><option value="">הכול</option><option value="content_review">שאלת תוכן</option><option value="contradiction">סתירה בתוכן</option><option value="access_request">בקשת גישה</option></select></label><label>מצב <select id="task-filter-status"><option value="">הכול</option><option value="active">פתוחות</option><option value="done">הושלמו</option><option value="cancelled">בוטלו</option></select></label><button id="tasks-refresh" type="button">רענון</button></div>
  <p id="task-message" role="status" aria-live="polite"/><div className="task-workspace"><section aria-label="רשימת משימות" id="task-list"/><section aria-label="פרטי המשימה" id="task-detail"><p>בחר משימה להצגת השאלה ולכתיבת תשובה.</p></section></div>
  <Script src="/tasks.js" strategy="afterInteractive"/>
 </main>;
}
