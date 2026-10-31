import AdminShell from '../AdminShell';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {authorizeCmsUser,CmsError} from '@/lib/access';
import snapshot from '@/lib/integration-readiness-snapshot.json';
import {parseIntegrationReadiness,readinessStatusLabels,technicalStatusLabels,readinessRequirementLabels,readinessDateLabel} from '@/lib/integration-readiness';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function ReadinessPage(){
 await requireChatGPTUser('/admin/readiness');const user=await authorizeCmsUser('users');
 if(user.role!=='system_admin')throw new CmsError(403,'הצגת מוכנות וחיבורים מחייבת הרשאת מנהל');
 const view=parseIntegrationReadiness(snapshot);
 return <AdminShell active="/admin/readiness" title="חיבורים ומוכנות למעבר" description="מה נבדק, מה חסר ומי אחראי לשלב הבא." email={user.email} role={user.role}>
  <aside className="admin-notice is-warning"><strong>תמונת הכנה מקומית — אינה אישור למעבר דומיין</strong><p>תמונת המצב עודכנה ב־{readinessDateLabel(view.snapshotAt)}. הנתונים הוזנו לפי הראיות המפורטות ואינם מתרעננים אוטומטית. תוצאה קודמת אינה הוכחה שהחיבור תקין כעת.</p><p>WordPress ו־Grow נשארים המערכות העסקיות הקיימות. הרחבות האיקומרס החדשות מוקפאות. אתר הבדיקה והניהול נשארים חסומים לאינדוקס; מעבר הדומיין דורש קבלה מפורשת של ירדן.</p></aside>
  <section className="admin-card"><h2>הגרסה שנרשמה בתמונת המצב</h2><p><a href={view.reviewOrigin} target="_blank" rel="noopener noreferrer">פתיחת אתר הבדיקה</a></p><p>מזהה גרסה: <code dir="ltr" style={{overflowWrap:'anywhere'}}>{view.deployedCommit}</code></p><p>תצוגה זו אינה בודקת פריסה ואינה מפעילה חיבורים. <a href="/admin/tasks">בקשות הגישה והשאלות נמצאות במשימות הקיימות.</a></p></section>
  <section aria-label="מצב החיבורים" style={{display:'grid',gap:'1rem'}}>{view.connections.map(item=><article key={item.id} className="admin-card" style={{minWidth:0,overflowWrap:'anywhere'}}>
   <div className="admin-section-heading" style={{flexWrap:'wrap',gap:'.5rem'}}><h2>{item.title}</h2><strong>מצב טכני: {technicalStatusLabels[item.technicalStatus]}</strong></div>
   <p><strong>נכס:</strong> {item.asset}</p><p><strong>יכולת:</strong> {item.capability}</p><p>{readinessRequirementLabels[item.requiredFor]}</p><p>סוג הראיה: {readinessStatusLabels[item.status]} · מועד בדיקה: {readinessDateLabel(item.checkedAt)}</p>
   <dl style={{margin:0,display:'grid',gap:'.4rem'}}><dt><strong>מה חסר</strong></dt><dd style={{marginInlineStart:0}}>{item.missing}</dd><dt><strong>אחראי</strong></dt><dd style={{marginInlineStart:0}}>{item.owner}</dd><dt><strong>השלב הבא והוראות החיבור</strong></dt><dd style={{marginInlineStart:0}}>{item.nextStep}</dd><dt><strong>השפעה על המעבר</strong></dt><dd style={{marginInlineStart:0}}>{item.impact}</dd><dt><strong>חלופה בטוחה</strong></dt><dd style={{marginInlineStart:0}}>{item.fallback}</dd></dl>
   <details style={{marginTop:'1rem'}}><summary>ראיות ומקורות ({item.evidence.length})</summary>{item.evidence.length?<ul>{item.evidence.map((entry,index)=><li key={index}>{entry.label}<br/><code dir="ltr" style={{overflowWrap:'anywhere'}}>{entry.reference}</code></li>)}</ul>:<p>אין ראיה שמאפשרת לקבוע שהחיבור אומת.</p>}</details>
  </article>)}</section>
 </AdminShell>;
}
