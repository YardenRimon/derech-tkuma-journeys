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
 const card={padding:20,border:'1px solid #ccd5d4',borderRadius:12,background:'#f6f9f8'};
 return <main dir="rtl" style={{maxWidth:1120,margin:'auto',padding:24,fontFamily:'Arial,sans-serif'}}><link rel="stylesheet" href="/admin.css"/>
 <header><h1>תמונת מצב העבודה</h1><nav aria-label="ניהול האתר"><a href="/admin">עמודי האתר</a> · <a href="/admin/collections">סיורים ומועדים</a> · <a href="/admin/tasks">שאלות ומשימות</a> · <a href="/admin/reports">דוחות והיסטוריה</a> · <a href="/admin/dashboard">רענון</a></nav></header>
 <p>הדוח מרכז את הנתונים שנקלטו באתר הניהול. פעולה הממתינה לסנכרון אינה שינוי שאושר במקור; יצירת טיוטה אינה פרסום.</p>
 <aside style={card} role="status"><strong>{r.taskSource.freshness==='recent'?'תמונת המשימות נקלט לאחרונה':r.taskSource.freshness==='missing'?'טרם נקלטו משימות':'תמונת המשימות ישן או שזמנו אינו תקין'}</strong><p>הקליטה הישנה ביותר: {dateLabel(r.taskSource.oldestAt)} · האחרונה: {dateLabel(r.taskSource.newestAt)}</p><small>{r.taskSource.note}</small></aside>
 <section aria-label="מדדי תפעול" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16,marginTop:20}}>
 {[['משימות במערכת',r.taskTotal],['פעילות ברשימה',active.length],['חסומות או חסרות מידע ברשימה',blocked.length],['תשובות הממתינות לסנכרון',pending],['רשומות תוכן',r.contentTotal],['טיוטות שונות מהתוכן הציבורי ברשימה',r.content.filter(x=>x.draftDiffers).length]].map(([name,count])=><article key={String(name)} style={card}><h2 style={{fontSize:16}}>{name}</h2><strong style={{fontSize:32}}>{count}</strong></article>)}
 </section>
 {(r.taskRowsTruncated||r.contentRowsTruncated)&&<p role="status">הרשימות מוגבלות ל־200 רשומות. המספרים המסומנים ״ברשימה״ אינם ספירה מלאה.</p>}
 <section><h2>מה דורש טיפול</h2>{blocked.length?<ul>{blocked.slice(0,20).map(t=><li key={t.id}><a href="/admin/tasks">{t.title}</a> — {taskLabels[t.status]??t.status} · {t.assigneeLabel}</li>)}</ul>:<p>{r.taskTotal?'לא זוהו חסמים ברשימת המשימות שנקלטה.':'טרם נקלטו משימות; אי אפשר להסיק שאין חסמים.'}</p>}</section>
 <section style={card}><h2>ביצוע אוטומטי בשרת</h2>{r.execution?<><p>זמן תמונת המקור: {dateLabel(r.execution.sourceAt)} · {r.executionFreshness==='recent'?'נקלט לאחרונה':'תמונה ישנה או זמן לא תקין'}</p><p>{r.execution.jobs.length} פעולות בתמונה; {r.execution.jobs.filter(x=>['queued','needs_review','failed'].includes(x.state)).length} בתור או דורשות טיפול.</p></>:<p>טרם התקבלה תמונת ביצוע תקינה מהשרת. אין כאן קביעה שהמנגנון פעיל, שנכשל או שאין עבודה.</p>}<a href="/admin/reports">פתיחת פרטי הביצוע והתוכן</a></section>
 <p>אין בדוח זה נתוני תנועה, פניות, הזמנות או הכנסות מאומתים. דוחות ביצועים עסקיים נשארים במסלול המדידה הנפרד.</p>
 </main>;
}
