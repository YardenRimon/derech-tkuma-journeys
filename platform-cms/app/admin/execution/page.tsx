import AdminShell from '../AdminShell';
import {authorizeCmsUser} from '@/lib/access';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {getD1} from '@/lib/cms';
import {siteScope} from '@/lib/site-scope';
import {SeoDraftStore} from '@/lib/seo-draft-core';
import type {Receipt} from '@/lib/execution-core';
import type {Tour} from '@/lib/collection-core';
import Script from 'next/script';
export const dynamic='force-dynamic';
export default async function ExecutionPage(){
 await requireChatGPTUser('/admin/execution');const user=await authorizeCmsUser('users'),db=getD1();
 const rows=await db.prepare("SELECT value FROM cms_settings WHERE key LIKE 'cms_execution:%' ORDER BY key LIMIT 200").all<{value:string}>();
 const receipts=rows.results.map(r=>JSON.parse(r.value) as Receipt);
 const seo=new SeoDraftStore(db),drafts=await seo.listDrafts(siteScope());
 const proposals=await Promise.all(drafts.map(draft=>seo.readback(siteScope(),draft.tourId)));
 return <AdminShell active="/admin/execution" title="ביצוע תוכן ושחזור" description="טיוטות תוכן והצעות לקידום בגוגל, עם היסטוריה ואפשרות שחזור." email={user.email} role={user.role}>
  <p className="admin-notice">עדכונים אוטומטיים נשמרים לבדיקה כטיוטה. הם אינם מתפרסמים באתר מעצמם. שחזור כאן מחזיר את הטיוטה בלבד ושומר את ההיסטוריה.</p>
  <p id="execution-status" role="status"/>
  <h2>הצעות לקידום בגוגל</h2>
  {!proposals.length&&<p className="admin-empty">טרם נוצרו הצעות לקידום. כשהבדיקה האוטומטית תושלם, ההצעות יופיעו כאן.</p>}
  {proposals.map(view=>{
   const draft=view.draft!,values=draft.values,receipt=view.receipt;
   return <article key={draft.tourId} className="admin-card execution-card">
    <h3>{values?.seo_title||view.source?.content.title||'הצעה שנמשכה'}</h3>
    <p>{draft.state==='withdrawn'?'ההצעה שוחזרה':'טיוטה לבדיקה — לא פורסמה'} · גרסה {draft.revision} · {new Date(draft.updatedAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</p>
    {values&&<dl><dt>כותרת בתוצאות החיפוש</dt><dd>{values.seo_title}</dd><dt>תיאור בתוצאות החיפוש</dt><dd>{values.meta_description||'אין תיאור במקור — נדרשת השלמה'}</dd><dt>כתובת העמוד המוצעת</dt><dd dir="ltr" style={{overflowWrap:"anywhere",marginInlineStart:0}}>{values.canonical}</dd></dl>}
    <p>ההצעה מבוססת על התוכן שפורסם, בגרסה {draft.sourcePublishedVersion}. אישור ההצעה והפרסום הם שלב נפרד.</p>
    <details><summary>היסטוריית ההצעה ({view.history.length})</summary><ol>{view.history.map(item=><li key={item.draft.revision}>גרסה {item.draft.revision} · {item.operation==='restore'?'שחזור':'שמירת הצעה'} · {new Date(item.draft.updatedAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</li>)}</ol></details>
    {receipt?.state==='applied_draft'&&draft.revision===receipt.revision&&<button type="button" data-effect-key={receipt.effectKey} data-revision={draft.revision}>שחזור ההצעה למצב הקודם</button>}
   </article>;
  })}
  <h2>עדכוני תוכן</h2>
  {!receipts.length&&<p className="admin-empty">טרם התקבל ביצוע תוכן ב־CMS.</p>}
  {receipts.map(r=><article key={r.effectKey} className="admin-card execution-card">
   <h3>עוז מול תופת — מספר התחנות</h3><p>{r.state==='rolled_back'?'הטיוטה שוחזרה':'עודכן בטיוטה'} · גרסה {r.rollbackRevision??r.revision} · {new Date(r.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</p>
   <div className="execution-comparison"><section><h4>לפני</h4><p>{(r.before?.draft as Tour)?.description||'תיאור ריק'}</p></section><section><h4>אחרי</h4><p>{(r.after.draft as Tour)?.description}</p></section></div>
   <p><a href="/admin/collections">פתיחת הטיוטה והיסטוריית התוכן</a></p>
   {r.state!=='rolled_back'&&<button type="button" data-effect-key={r.effectKey} data-revision={r.revision}>שחזור הטיוטה למצב שלפני העדכון</button>}
  </article>)}
  <Script src="/execution-admin.js" strategy="afterInteractive"/>
 </AdminShell>;
}
