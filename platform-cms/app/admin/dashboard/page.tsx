import AdminShell from "../AdminShell";
import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { authorizeCmsUser } from '@/lib/access';
import { getD1 } from '@/lib/cms';
import { siteScope } from '@/lib/site-scope';
import { operationalReport, taskLabels, dateLabel } from '@/lib/report-core';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function DashboardPage(){
 await requireChatGPTUser('/admin/dashboard');const user=await authorizeCmsUser('users');
 const r=await operationalReport(getD1(),siteScope(),user.role==='system_admin');
 const pending=r.commands.find(x=>x.state==='pending')?.count??0;
 const blocked=r.tasks.filter(x=>x.status==='blocked'||x.status==='waiting_info');
 const active=r.tasks.filter(x=>!['done','cancelled'].includes(x.status));
 return <AdminShell active="/admin/dashboard" title="תמונת מצב העבודה" description="התוכן, המשימות והפעולות שדורשות תשומת לב — במבט אחד." email={user.email} role={user.role}>
 <p className="admin-intro">הדוח מרכז את הנתונים שנקלטו באתר הניהול. פעולה הממתינה לסנכרון אינה שינוי שאושר במקור; יצירת טיוטה אינה פרסום.</p>
 <aside className={`admin-notice ${r.taskSource.freshness==='recent'?'is-current':'is-warning'}`} role="status"><strong>{r.taskSource.freshness==='recent'?'מקור המשימות נבדק לאחרונה':r.taskSource.freshness==='missing'?'טרם התקבל אימות סנכרון מהשרת':'בדיקת מקור המשימות אינה עדכנית או שזמנה אינו תקין'}</strong><p>בדיקת המקור האחרונה: {dateLabel(r.taskSource.checkedAt)}</p><p>זמני קליטת שינויים בפריטים — הישן ביותר: {dateLabel(r.taskSource.oldestAt)} · האחרון: {dateLabel(r.taskSource.newestAt)}</p><small>{r.taskSource.note}</small></aside>
 <section aria-label="מדדי תפעול" className="admin-metrics">
 {[['משימות במערכת',r.taskTotal],['פעילות ברשימה',active.length],['חסומות או חסרות מידע ברשימה',blocked.length],['תשובות הממתינות לסנכרון',pending],['רשומות תוכן',r.contentTotal],['טיוטות שונות מהתוכן הציבורי ברשימה',r.content.filter(x=>x.draftDiffers).length]].map(([name,count])=><article key={String(name)} className="admin-metric"><h2>{name}</h2><strong>{count}</strong></article>)}
 </section>
 {(r.taskRowsTruncated||r.contentRowsTruncated)&&<p role="status">הרשימות מוגבלות ל־200 רשומות. המספרים המסומנים ״ברשימה״ אינם ספירה מלאה.</p>}
 <section className="admin-card"><div className="admin-section-heading"><h2>מה דורש טיפול</h2><a href="/admin/tasks">כל המשימות ←</a></div>{blocked.length?<ul>{blocked.slice(0,20).map(t=><li key={t.id}><a href="/admin/tasks">{t.title}</a> — {taskLabels[t.status]??t.status} · {t.assigneeLabel}</li>)}</ul>:<p>{r.taskTotal?'לא זוהו חסמים ברשימת המשימות שנקלטה.':'טרם נקלטו משימות; אי אפשר להסיק שאין חסמים.'}</p>}</section>
 <section className="admin-card"><h2>ביצוע אוטומטי בשרת</h2>{r.execution?<><p>זמן תמונת המקור: {dateLabel(r.execution.sourceAt)} · {r.executionFreshness==='recent'?'נקלט לאחרונה':'תמונה ישנה או זמן לא תקין'}</p><p>{r.execution.jobs.length} פעולות בתמונה; {r.execution.jobs.filter(x=>['queued','needs_review','failed'].includes(x.state)).length} בתור או דורשות טיפול.</p></>:<p>טרם התקבלה תמונת ביצוע תקינה מהשרת. אין כאן קביעה שהמנגנון פעיל, שנכשל או שאין עבודה.</p>}<a href="/admin/reports">פתיחת פרטי הביצוע והתוכן</a></section>
 <p>אין בדוח זה נתוני תנועה, פניות, הזמנות או הכנסות מאומתים. דוחות ביצועים עסקיים נשארים במסלול המדידה הנפרד.</p>
 </AdminShell>;
}
