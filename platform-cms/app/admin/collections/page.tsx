import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { authorizeCmsUser } from "@/lib/access";
import Script from "next/script";
import currentCollections from "@/lib/current-collections.json";
export const dynamic="force-dynamic";
export default async function CollectionsPage(){
 await requireChatGPTUser('/admin/collections'); const user=await authorizeCmsUser('content');
 return <main dir="rtl" id="collection-app" data-can-publish={String(user.canPublish)} style={{maxWidth:1000,margin:'auto',padding:24,fontFamily:'Arial,sans-serif'}}>
 <link rel="stylesheet" href="/admin.css"/><header><h1>סיורים ומועדים</h1><nav><a href="/admin">עריכת עמודים</a> · <a href="/admin/tasks">שאלות ומשימות</a> · <a href={chatGPTSignOutPath('/')}>התנתקות</a></nav></header>
 <p>שמירה מעדכנת טיוטה. רק פרסום מעדכן את הנתונים הציבוריים בכרטיסים הקיימים. שחזור מחזיר גרסה לטיוטה לבדיקה לפני פרסום. רשומה חדשה ללא כרטיס מקור מחייבת חיבור לתצוגת האתר.</p>
 <p>למועד ללא שעות ידועות משאירים את שני שדות השעה ריקים; מספר משתתפים לא ידוע נשאר ריק. תצוגת התאריך שומרת את הניסוח המקורי, ויש לעדכן אותה כשמשנים את התאריך.</p>
 <button id="record-import-current" type="button">קליטת תוכן האתר הקיים לטיוטות</button><small>קליטה ראשונית בלבד; רשומות שכבר קיימות נשמרות. הפרסום נפרד.</small>
 <script id="current-collection-seed" type="application/json" dangerouslySetInnerHTML={{__html:JSON.stringify(currentCollections).replace(/</g,"\\u003c")}}/>
 <label>סוג תוכן <select id="collection-kind"><option value="tour">סיורים</option><option value="occurrence">מועדים</option></select></label>
 <button id="record-new" type="button">רשומה חדשה</button><div id="record-list"/>
 <form id="record-form"><input id="record-id" type="hidden"/><div id="record-fields"/>
 <button type="submit">שמירת טיוטה</button><button id="record-publish" type="button" hidden={!user.canPublish}>פרסום</button><button id="record-delete" type="button">מחיקת טיוטה</button><button id="record-history" type="button">היסטוריה</button></form>
 <p id="record-status" role="status" aria-live="polite"/><div id="record-versions"/><Script src="/collections.js" strategy="afterInteractive"/>
 </main>;
}
