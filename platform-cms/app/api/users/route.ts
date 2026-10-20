import { authorizeCmsUser, authIdColumn, CmsError, getAccessDb, normalizeCmsEmail, type CmsRole } from "@/lib/access";
import { jsonError, requireSameOrigin } from "@/lib/cms";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type UserRow = {
  email: string;
  role: CmsRole;
  active: number;
  can_publish: number;
  revision: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function role(value: unknown): CmsRole {
  if (value !== "system_admin" && value !== "content_editor") throw new CmsError(400, "תפקיד אינו תקין");
  return value;
}
function flag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new CmsError(400, `${name} חייב להיות ערך כן/לא`);
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new CmsError(400, "מספר גרסה אינו תקין");
  return value as number;
}
function exactKeys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in body))) {
    throw new CmsError(400, "פרטי הבקשה אינם תקינים");
  }
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 8192) throw new CmsError(413, "הבקשה גדולה מדי");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 8192) throw new CmsError(413, "הבקשה גדולה מדי");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new CmsError(400, "JSON לא תקין"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CmsError(400, "פרטי הבקשה אינם תקינים");
  return data as Record<string, unknown>;
}
function publicUser(row: UserRow) {
  return {
    email: row.email,
    role: row.role,
    active: row.active === 1,
    canPublish: row.role === "system_admin" || row.can_publish === 1,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}
async function listUsers() {
  const rows = await getAccessDb().prepare(`SELECT email, role, active, can_publish, revision,
      created_at, updated_at, last_login_at FROM cms_users
      ORDER BY CASE role WHEN 'system_admin' THEN 0 ELSE 1 END, email`).all<UserRow>();
  return rows.results.map(publicUser);
}

export async function GET() {
  try {
    const current = await authorizeCmsUser("users");
    return reply({ users: await listUsers(), currentEmail: current.email });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await authorizeCmsUser("users");
    const body = await readBody(request);
    const db = getAccessDb();
    const identityColumn = authIdColumn();
    const now = new Date().toISOString();
    if (body.op === "create") {
      exactKeys(body, ["op", "email", "role", "canPublish"]);
      const email = normalizeCmsEmail(body.email);
      const newRole = role(body.role);
      const canPublish = flag(body.canPublish, "הרשאת פרסום");
      try {
        const results = await db.batch([
          db.prepare(`INSERT INTO cms_users
            (email, auth_user_id, role, active, can_publish, revision, created_at, updated_at)
            SELECT ?, NULL, ?, 1, ?, 1, ?, ?
            WHERE EXISTS (SELECT 1 FROM cms_users WHERE email = ? AND ${identityColumn} = ?
              AND role = 'system_admin' AND active = 1)`)
            .bind(email, newRole, Number(canPublish), now, now, actor.email, actor.userId),
          db.prepare(`INSERT INTO cms_permission_audit
            (actor_email, subject_email, operation, old_role, new_role, old_active, new_active, old_can_publish, new_can_publish, changed_at)
            SELECT ?, ?, 'create', NULL, ?, NULL, 1, NULL, ?, ?
            WHERE EXISTS (SELECT 1 FROM cms_users WHERE email = ? AND created_at = ?)
              AND EXISTS (SELECT 1 FROM cms_users WHERE email = ? AND ${identityColumn} = ?
                AND role = 'system_admin' AND active = 1)`)
            .bind(actor.email, email, newRole, Number(canPublish), now,
              email, now, actor.email, actor.userId),
        ]);
        if (results[0].meta.changes !== 1) throw new CmsError(403, "הרשאת המנהל שלך השתנתה. טען מחדש.");
      } catch (error) {
        if (/UNIQUE|constraint/i.test(String(error))) throw new CmsError(409, "כתובת האימייל כבר קיימת במערכת");
        throw error;
      }
      return reply({ users: await listUsers(), currentEmail: actor.email }, 201);
    }
    if (body.op === "update") {
      exactKeys(body, ["op", "email", "revision", "role", "active", "canPublish"]);
      const email = normalizeCmsEmail(body.email);
      const expectedRevision = revision(body.revision);
      const newRole = role(body.role);
      const active = flag(body.active, "מצב פעילות");
      const canPublish = flag(body.canPublish, "הרשאת פרסום");
      if (email === actor.email && (newRole !== "system_admin" || !active)) {
        throw new CmsError(409, "לא ניתן להשעות את עצמך או להסיר את הרשאת המנהל שלך");
      }
      const current = await db.prepare("SELECT revision FROM cms_users WHERE email = ?").bind(email).first<{ revision: number }>();
      if (!current) throw new CmsError(404, "המשתמש לא נמצא");
      if (current.revision !== expectedRevision) throw new CmsError(409, "המשתמש השתנה מאז שפתחת אותו. טען מחדש.");
      const guard = `(role != 'system_admin' OR active != 1 OR (? = 'system_admin' AND ? = 1)
        OR (SELECT COUNT(*) FROM cms_users WHERE role = 'system_admin' AND active = 1) > 1)
        AND EXISTS (SELECT 1 FROM cms_users AS actor WHERE actor.email = ? AND actor.${identityColumn} = ?
          AND actor.role = 'system_admin' AND actor.active = 1)`;
      const results = await db.batch([
        db.prepare(`INSERT INTO cms_permission_audit
          (actor_email, subject_email, operation, old_role, new_role, old_active, new_active, old_can_publish, new_can_publish, changed_at)
          SELECT ?, email, 'update', role, ?, active, ?, can_publish, ?, ?
          FROM cms_users WHERE email = ? AND revision = ? AND ${guard}`)
          .bind(actor.email, newRole, Number(active), Number(canPublish), now,
            email, expectedRevision, newRole, Number(active), actor.email, actor.userId),
        db.prepare(`UPDATE cms_users SET role = ?, active = ?, can_publish = ?,
          revision = revision + 1, updated_at = ?
          WHERE email = ? AND revision = ? AND ${guard}`)
          .bind(newRole, Number(active), Number(canPublish), now,
            email, expectedRevision, newRole, Number(active), actor.email, actor.userId),
      ]);
      if (results[1].meta.changes !== 1) {
        const actorStillAdmin = await db.prepare(`SELECT 1 FROM cms_users WHERE email = ? AND ${identityColumn} = ? AND role = 'system_admin' AND active = 1`)
          .bind(actor.email, actor.userId).first();
        if (!actorStillAdmin) throw new CmsError(403, "הרשאת המנהל שלך השתנתה. טען מחדש.");
        throw new CmsError(409, "חייב להישאר לפחות מנהל פעיל אחד. טען מחדש.");
      }
      return reply({ users: await listUsers(), currentEmail: actor.email });
    }
    throw new CmsError(400, "פעולה לא מוכרת");
  } catch (error) { return jsonError(error); }
}
