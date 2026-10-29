/* eslint-disable @next/next/no-css-tags, @next/next/no-html-link-for-pages -- Full navigation refreshes server permissions and page controllers. */
import type { ReactNode } from "react";
import AdminNavigation from "./AdminNavigation";
import { LayoutDashboard, FilePenLine, MapPinned, ClipboardList, ChartNoAxesCombined, History, Users, ExternalLink } from "lucide-react";
import { chatGPTSignOutPath, getAuthProvider } from "@/app/chatgpt-auth";

type Props = { children: ReactNode; active: string; title: string; description?: string; email?: string | null; role?: string; id?: string; className?: string; canPublish?: boolean; currentEmail?: string };
const links = [
  { href: "/admin/dashboard", label: "תמונת מצב", icon: LayoutDashboard, admin: true },
  { href: "/admin", label: "עמודי האתר", icon: FilePenLine },
  { href: "/admin/collections", label: "סיורים ומועדים", icon: MapPinned },
  { href: "/admin/tasks", label: "שאלות ומשימות", icon: ClipboardList },
  { href: "/admin/submissions", label: "דירוגים והצעות מחיר", icon: ClipboardList, admin: true },
  { href: "/admin/reports", label: "דוחות והיסטוריה", icon: ChartNoAxesCombined, admin: true },
  { href: "/admin/execution", label: "ביצוע ושחזור", icon: History, admin: true },
  { href: "/admin/users", label: "משתמשים והרשאות", icon: Users, admin: true },
];
export default function AdminShell({ children, active, title, description, email, role, id, className = "", canPublish, currentEmail }: Props) {
 const isAdmin = role === "system_admin";
 return <div className="admin-shell" dir="rtl">
  <link rel="stylesheet" href="/admin/runtime/admin.css" />
  <a className="admin-skip" href="#admin-main-content">דילוג לתוכן</a>
  <header className="admin-header">
   <a href={isAdmin ? "/admin/dashboard" : "/admin"} className="admin-brand" aria-label="דרך התקומה — ניהול האתר"><img className="admin-brand-logo" src="/wp-content/uploads/2025/08/לוגו-דרך-התקומה-1024x206.webp" width="1024" height="206" alt="דרך התקומה"/><small>סביבת הניהול</small></a>
   <div className="admin-header-actions">{getAuthProvider() === "supabase" && <a className="admin-open-site" href="/login/?settings=password">הגדרות כניסה</a>}<span className="admin-preview-badge"><i aria-hidden="true" />סביבת בדיקה</span><a className="admin-open-site" href="/" target="_blank" rel="noopener noreferrer">צפייה באתר <ExternalLink size={14} aria-hidden="true"/></a></div>
  </header>
  <div className="admin-shell-body">
   <aside className="admin-sidebar"><div className="admin-sidebar-label">ניהול האתר</div><AdminNavigation activeLabel={links.find(link => link.href === active)?.label || "ניהול האתר"}>{links.filter(link => !link.admin || isAdmin).map(link => <a key={link.href} href={link.href} aria-current={active === link.href ? "page" : undefined}><span className="admin-nav-icon" aria-hidden="true"><link.icon size={19} strokeWidth={1.6}/></span>{link.label}</a>)}</AdminNavigation><div className="admin-account"><span className="admin-avatar" aria-hidden="true">{isAdmin ? "מ" : "ע"}</span><div><strong>{isAdmin ? "מנהל מערכת" : "עורך תוכן"}</strong>{email && <span className="admin-account-email" dir="ltr">{email}</span>}</div><a id="logout" href={chatGPTSignOutPath("/")}>התנתקות</a></div></aside>
   <div className="admin-main-column"><main id={id || "admin-main-content"} className={`admin-main ${className}`} data-role={role} data-can-publish={canPublish === undefined ? undefined : String(canPublish)} data-current-email={currentEmail}>
    <div id={id ? "admin-main-content" : undefined} className="admin-page-heading" tabIndex={-1}><span className="admin-eyebrow">ניהול דרך התקומה</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {children}
   </main><footer className="admin-footer"><span>דרך התקומה · ניהול התוכן והעבודה</span><span>השינויים נשמרים בטיוטה. פרסום נעשה בנפרד.</span></footer></div>
  </div>
 </div>;
}
