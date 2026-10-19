import { env } from "cloudflare:workers";
import { getChatGPTUser, getAuthProvider, type ChatGPTUser } from "@/app/chatgpt-auth";

export function authIdColumn(): "auth_user_id" | "cf_access_user_id" {
  return getAuthProvider() === "cloudflare-access" ? "cf_access_user_id" : "auth_user_id";
}

export type CmsRole = "system_admin" | "content_editor";
export type CmsPermission = "content" | "publish" | "users";
export type AuthorizedCmsUser = ChatGPTUser & {
  role: CmsRole;
  canPublish: boolean;
  revision: number;
};

type UserRow = {
  email: string;
  auth_user_id: string | null;
  role: string;
  active: number;
  can_publish: number;
  revision: number;
};

export class CmsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getAccessDb(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new CmsError(503, "מסד הנתונים אינו זמין");
  return db;
}

export function normalizeCmsEmail(value: unknown): string {
  if (typeof value !== "string") throw new CmsError(400, "כתובת אימייל אינה תקינה");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email)) {
    throw new CmsError(400, "כתובת אימייל אינה תקינה");
  }
  return email;
}

async function ensureBootstrap(db: D1Database, user: ChatGPTUser) {
  const done = await db.prepare("SELECT value FROM cms_settings WHERE key = 'cms_users_bootstrapped'").first<{ value: string }>();
  if (done) return;

  const config = env as unknown as { CMS_OWNER_EMAIL?: string; CMS_ADMIN_EMAILS?: string; CMS_EDITOR_EMAILS?: string };
  let ownerEmail: string;
  try { ownerEmail = normalizeCmsEmail(config.CMS_OWNER_EMAIL); }
  catch { throw new CmsError(503, "הרשאת הבעלים טרם הוגדרה"); }
  const additionalAdmins = new Set<string>();
  for (const item of (config.CMS_ADMIN_EMAILS ?? "").split(",")) {
    if (!item.trim()) continue;
    try { const email = normalizeCmsEmail(item); if (email !== ownerEmail) additionalAdmins.add(email); }
    catch { /* Invalid configured entries grant no access. */ }
  }
  const legacyEditors = new Set<string>();
  for (const item of (config.CMS_EDITOR_EMAILS ?? "").split(",")) {
    if (!item.trim()) continue;
    try {
      const email = normalizeCmsEmail(item);
      if (email !== ownerEmail && !additionalAdmins.has(email)) legacyEditors.add(email);
    } catch { /* Invalid legacy entries grant no access. */ }
  }

  const pins = await db.prepare("SELECT key, value FROM cms_settings WHERE key = 'owner_user_id' OR key LIKE 'editor_user_id:%' OR key LIKE 'admin_user_id:%'")
    .all<{ key: string; value: string }>();
  const pinMap = new Map(getAuthProvider() === "sites" ? pins.results.map(({ key, value }) => [key, value]) : []);
  const signedInEmail = user.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const initialUsers: { email: string; role: CmsRole; authId: string | null }[] = [
    { email: ownerEmail, role: "system_admin", authId: pinMap.get("owner_user_id") || (signedInEmail === ownerEmail ? user.userId : null) },
    ...[...additionalAdmins].map((email) => ({
      email, role: "system_admin" as const,
      authId: pinMap.get(`admin_user_id:${email}`) || (signedInEmail === email ? user.userId : null),
    })),
    ...[...legacyEditors].map((email) => ({
      email, role: "content_editor" as const,
      authId: pinMap.get(`editor_user_id:${email}`) || (signedInEmail === email ? user.userId : null),
    })),
  ];
  for (const initial of initialUsers) {
    statements.push(db.prepare(`INSERT INTO cms_users
      (email, ${authIdColumn()}, role, active, can_publish, revision, created_at, updated_at)
      SELECT ?, ?, ?, 1, 0, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM cms_settings WHERE key = 'cms_users_bootstrapped')`)
      .bind(initial.email, initial.authId, initial.role, now, now));
    statements.push(db.prepare(`INSERT INTO cms_permission_audit
      (actor_email, subject_email, operation, old_role, new_role, old_active, new_active, old_can_publish, new_can_publish, changed_at)
      SELECT 'system:bootstrap', ?, 'bootstrap', NULL, ?, NULL, 1, NULL, 0, ?
      WHERE NOT EXISTS (SELECT 1 FROM cms_settings WHERE key = 'cms_users_bootstrapped')`)
      .bind(initial.email, initial.role, now));
  }
  statements.push(db.prepare("INSERT OR IGNORE INTO cms_settings (key, value) VALUES ('cms_users_bootstrapped', '1')"));
  await db.batch(statements);
}

export async function authorizeCmsUser(permission: CmsPermission = "content"): Promise<AuthorizedCmsUser> {
  const user = await getChatGPTUser();
  if (!user) throw new CmsError(401, "יש להתחבר כדי לערוך את האתר");
  const db = getAccessDb();
  await assertIsolatedD1Scope(db);
  await ensureBootstrap(db, user);
  const email = user.email.trim().toLowerCase();
  const identityColumn = authIdColumn();
  const selectUser = `SELECT email, ${identityColumn} AS auth_user_id, role, active, can_publish, revision FROM cms_users WHERE email = ?`;
  let row = await db.prepare(selectUser)
    .bind(email).first<UserRow>();
  if (!row || row.active !== 1 || (row.role !== "system_admin" && row.role !== "content_editor")) {
    throw new CmsError(403, "אין לך הרשאה לערוך את האתר");
  }
  if (!row.auth_user_id) {
    try {
      await db.prepare(`UPDATE cms_users SET ${identityColumn} = ? WHERE email = ? AND ${identityColumn} IS NULL AND active = 1`)
        .bind(user.userId, email).run();
    } catch { throw new CmsError(403, "זהות העורך אינה תואמת"); }
    row = await db.prepare(selectUser)
      .bind(email).first<UserRow>();
  }
  if (!row || row.auth_user_id !== user.userId || row.active !== 1) {
    throw new CmsError(403, "זהות העורך אינה תואמת");
  }
  if (permission === "users" && row.role !== "system_admin") throw new CmsError(403, "ניהול משתמשים מחייב הרשאת מנהל");
  if (permission === "publish" && row.role !== "system_admin" && row.can_publish !== 1) {
    throw new CmsError(403, "אין לך הרשאת פרסום");
  }
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  await db.prepare("UPDATE cms_users SET last_login_at = ? WHERE email = ? AND (last_login_at IS NULL OR last_login_at < ?)")
    .bind(now.toISOString(), email, cutoff).run();
  return { ...user, email, role: row.role as CmsRole, canPublish: row.role === "system_admin" || row.can_publish === 1, revision: row.revision };
}

/** The inherited page/user tables are deliberately deployment-isolated in this pilot.
 * Refuse to use a DB whose registered scope differs; shared SaaS needs a separate adapter.
 */
export async function assertIsolatedD1Scope(db: D1Database): Promise<void> {
  const config = env as unknown as { CMS_ADAPTER_MODE?: string; CMS_TENANT_ID?: string; CMS_SITE_ID?: string };
  if (config.CMS_ADAPTER_MODE !== "isolated-d1" || !config.CMS_TENANT_ID || !config.CMS_SITE_ID) {
    throw new CmsError(503, "מתאם האתר והפרדת הנתונים טרם הוגדרו");
  }
  await db.prepare("INSERT OR IGNORE INTO cms_deployment_scope (singleton,tenant_id,site_id) VALUES (1,?,?)")
    .bind(config.CMS_TENANT_ID,config.CMS_SITE_ID).run();
  const scope = await db.prepare("SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1").first<{tenant_id:string;site_id:string}>();
  if (!scope || scope.tenant_id !== config.CMS_TENANT_ID || scope.site_id !== config.CMS_SITE_ID) {
    throw new CmsError(503, "מסד הנתונים אינו שייך להקשר האתר");
  }
}
