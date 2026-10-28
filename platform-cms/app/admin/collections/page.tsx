import AdminShell from "../AdminShell";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { authorizeCmsUser } from "@/lib/access";
import Script from "next/script";
import currentCollections from "@/lib/current-collections.json";
export const dynamic="force-dynamic";
export default async function CollectionsPage(){
 await requireChatGPTUser('/admin/collections'); const user=await authorizeCmsUser('content');
 return <AdminShell active="/admin/collections" title="סיורים ומועדים" description="כל הסיורים, המועדים והפרטים שלהם במקום אחד. בחר רשומה לעריכה או הוסף רשומה חדשה." email={user.email} role={user.role} id="collection-app" canPublish={user.canPublish}>
 <div className="admin-notice"><strong>טיוטה, בדיקה, פרסום</strong><p>שמירה מעדכנת טיוטה. רק פרסום מעדכן את הכרטיסים באתר. שחזור מחזיר גרסה לטיוטה לבדיקה. רשומה חדשה ללא כרטיס מקור מחייבת חיבור לתצוגת האתר.</p></div>
 <details className="admin-disclosure"><summary>הנחיות עריכה וקליטה ראשונית</summary><p>למועד ללא שעות ידועות משאירים את שדות השעה ריקים; מספר משתתפים לא ידוע נשאר ריק. יש לעדכן את תצוגת התאריך המקורית כשמשנים תאריך.</p><button id="record-import-current" type="button">קליטת תוכן האתר הקיים לטיוטות</button><p className="admin-hint">לקליטה ראשונית בלבד. רשומות קיימות נשמרות; הפרסום נפרד.</p></details>
 {user.role==='system_admin'&&user.canPublish&&<details className="admin-disclosure"><summary>עדכון הסיורים והמועדים מהאתר המקורי</summary><p>הצג את השינויים שנקלטו מהאתר המקורי לפני פרסומם. מועדים חדשים יתווספו, מועדים שירדו מהמקור יוסרו מהתצוגה, וטיוטות עצמאיות והיסטוריית העריכה יישמרו.</p><button id="record-source-preview" type="button">הצגת העדכון</button><div id="record-source-plan" aria-live="polite"/><button id="record-source-apply" type="button" className="admin-publish" hidden>פרסום עדכון המקור</button><p id="record-source-status" role="status" aria-live="polite"/></details>}
 <script id="current-collection-seed" type="application/json" dangerouslySetInnerHTML={{__html:JSON.stringify(currentCollections).replace(/</g,"\\u003c")}}/>
 <div className="collection-workspace"><section className="admin-card collection-list-panel" aria-label="רשימת סיורים ומועדים"><div className="collection-list-heading"><label>סוג תוכן <select id="collection-kind"><option value="tour">סיורים</option><option value="occurrence">מועדים</option></select></label><button id="record-new" type="button">+ רשומה חדשה</button></div><div id="record-list" aria-label="רשומות קיימות"/></section>
 <section className="admin-card collection-editor" aria-label="עריכת הרשומה"><div className="collection-editor-heading"><h2 id="record-heading">רשומה חדשה</h2><p id="record-meta" className="admin-hint">פרטי התוכן</p></div><form id="record-form"><input id="record-id" type="hidden"/><div id="record-fields"/>
 <div className="admin-action-bar"><button type="submit" className="admin-primary">שמירת טיוטה</button><button id="record-publish" type="button" className="admin-publish" hidden={!user.canPublish}>פרסום</button><button id="record-history" type="button">היסטוריה</button><button id="record-delete" type="button" className="admin-danger">מחיקת טיוטה</button></div></form></section></div>
 <p id="record-status" role="status" aria-live="polite"/><div id="record-versions"/><Script src="/admin/runtime/collections.js" strategy="afterInteractive"/>
 </AdminShell>;
}
