import {authorizeCmsUser} from '@/lib/access';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {getD1} from '@/lib/cms';
import type {Receipt} from '@/lib/execution-core';
import type {Tour} from '@/lib/collection-core';
import Script from 'next/script';
export const dynamic='force-dynamic';
export default async function ExecutionPage(){
 await requireChatGPTUser('/admin/execution');await authorizeCmsUser('users');
 const rows=await getD1().prepare("SELECT value FROM cms_settings WHERE key LIKE 'cms_execution:%' ORDER BY key LIMIT 200").all<{value:string}>();
 const receipts=rows.results.map(r=>JSON.parse(r.value) as Receipt);
 return <main dir="rtl" style={{maxWidth:1100,margin:'40px auto',padding:24,fontFamily:'Arial,sans-serif'}}>
  <h1>ביצוע תוכן ושחזור</h1><nav><a href="/admin/dashboard">דאשבורד</a> · <a href="/admin/reports">דוחות</a> · <a href="/admin/collections">תוכן ופרסום</a></nav>
  <p>עדכונים שבוצעו ב־CMS לפי תכנית מאושרת. כל עדכון נשמר בטיוטה; פרסום נעשה בניהול התוכן. שחזור כאן מחזיר את הטיוטה בלבד ושומר את ההיסטוריה.</p>
  <p id="execution-status" role="status"/>
  {!receipts.length&&<p>טרם התקבל ביצוע תוכן ב־CMS.</p>}
  {receipts.map(r=><article key={r.effectKey} style={{border:'1px solid #ccc',borderRadius:12,padding:24,marginTop:24}}>
   <h2>עוז מול תופת — מספר התחנות</h2><p>{r.state==='rolled_back'?'הטיוטה שוחזרה':'עודכן בטיוטה'} · גרסה {r.rollbackRevision??r.revision} · {new Date(r.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:24}}><section><h3>לפני</h3><p>{(r.before?.draft as Tour)?.description||'תיאור ריק'}</p></section><section><h3>אחרי</h3><p>{(r.after.draft as Tour)?.description}</p></section></div>
   <p><a href="/admin/collections">פתיחת הטיוטה והיסטוריית התוכן</a></p>
   {r.state!=='rolled_back'&&<button type="button" data-effect-key={r.effectKey} data-revision={r.revision}>שחזור הטיוטה למצב שלפני העדכון</button>}
  </article>)}
  <Script src="/execution-admin.js" strategy="afterInteractive"/>
 </main>;
}
