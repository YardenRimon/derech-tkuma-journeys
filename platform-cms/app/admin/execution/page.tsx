import AdminShell from "../AdminShell";
import {authorizeCmsUser} from '@/lib/access';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {getD1} from '@/lib/cms';
import type {Receipt} from '@/lib/execution-core';
import type {Tour} from '@/lib/collection-core';
import Script from 'next/script';
export const dynamic='force-dynamic';
export default async function ExecutionPage(){
 await requireChatGPTUser('/admin/execution');const user=await authorizeCmsUser('users');
 const rows=await getD1().prepare("SELECT value FROM cms_settings WHERE key LIKE 'cms_execution:%' ORDER BY key LIMIT 200").all<{value:string}>();
 const receipts=rows.results.map(r=>JSON.parse(r.value) as Receipt);
 return <AdminShell active="/admin/execution" title="ביצוע תוכן ושחזור" description="מעקב אחר עדכונים שהוחלו בטיוטות, והשוואה למצב הקודם." email={user.email} role={user.role}>
  <p className="admin-notice">עדכונים שבוצעו ב־CMS לפי תכנית מאושרת. כל עדכון נשמר בטיוטה; פרסום נעשה בניהול התוכן. שחזור כאן מחזיר את הטיוטה בלבד ושומר את ההיסטוריה.</p>
  <p id="execution-status" role="status"/>
  {!receipts.length&&<p className="admin-empty">טרם התקבל ביצוע תוכן ב־CMS.</p>}
  {receipts.map(r=><article key={r.effectKey} className="admin-card execution-card">
   <h2>עוז מול תופת — מספר התחנות</h2><p>{r.state==='rolled_back'?'הטיוטה שוחזרה':'עודכן בטיוטה'} · גרסה {r.rollbackRevision??r.revision} · {new Date(r.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</p>
   <div className="execution-comparison"><section><h3>לפני</h3><p>{(r.before?.draft as Tour)?.description||'תיאור ריק'}</p></section><section><h3>אחרי</h3><p>{(r.after.draft as Tour)?.description}</p></section></div>
   <p><a href="/admin/collections">פתיחת הטיוטה והיסטוריית התוכן</a></p>
   {r.state!=='rolled_back'&&<button type="button" data-effect-key={r.effectKey} data-revision={r.revision}>שחזור הטיוטה למצב שלפני העדכון</button>}
  </article>)}
  <Script src="/execution-admin.js" strategy="afterInteractive"/>
 </AdminShell>;
}
