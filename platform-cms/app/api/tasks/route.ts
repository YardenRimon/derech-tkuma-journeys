import { authorizeCmsUser, CmsError } from "@/lib/access";
import { requireSameOrigin, jsonError, getD1 } from "@/lib/cms";
import { Tasks, TaskError, taskId, type TaskActor, type TaskReceipt } from "@/lib/task-core";
import { D1Tasks } from "@/lib/task-d1";
import { siteScope } from "@/lib/site-scope";
export const dynamic = "force-dynamic";
const send = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failure = (error: unknown) => jsonError(error instanceof TaskError ? new CmsError(error.status, error.message) : error);
export async function GET(request: Request) {
 try {
  const user = await authorizeCmsUser("content"), actor: TaskActor = { email: user.email, isAdmin: user.role === "system_admin" };
  const scope = siteScope(), store = new D1Tasks(getD1()), service = new Tasks(store), url = new URL(request.url), id = url.searchParams.get("id");
  if (url.searchParams.get("gateway") === "1") {
   if (!actor.isAdmin) throw new CmsError(403, "סנכרון משימות מחייב הרשאת מנהל");
   return send({ authority: "platform-work-items", scope, commands: (await store.commands(scope)).filter(x=>x.state === "pending") });
  }
  if (!id) return send({ records: await store.list(scope, actor), authority: "platform-work-items", syncMode: "manual-gateway" });
  const record = await service.readable(scope, actor, taskId(id));
  return send({ record, commands: await store.commands(scope,id), history: await store.history(scope,id) });
 } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
 try {
  requireSameOrigin(request);
  const raw = await request.text(); if (new TextEncoder().encode(raw).length > 50000) throw new CmsError(413, "הבקשה גדולה מדי");
  let body; try { body = JSON.parse(raw); } catch { throw new CmsError(400, "בקשה אינה תקינה"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CmsError(400, "בקשה אינה תקינה");
  if (["tenantId","siteId","tenant_id","site_id"].some(key=>Object.hasOwn(body,key))) throw new CmsError(400, "הקשר האתר נקבע בשרת");
  const user = await authorizeCmsUser(body.operation === "import" ? "users" : "content");
  const actor = { email: user.email, isAdmin: user.role === "system_admin" }, scope = siteScope(), service = new Tasks(new D1Tasks(getD1()));
  if (body.operation === "import") {
   if (body.receipts !== undefined && !Array.isArray(body.receipts)) throw new CmsError(400, "אישורי סנכרון אינם תקינים");
   return send({ record: await service.import(scope, actor, body.snapshot, body.expectedRevision, body.receipts as TaskReceipt[] | undefined) });
  }
  if (body.operation !== "request") throw new CmsError(400, "פעולה אינה מוכרת");
  return send({ command: await service.request(scope, actor, taskId(body.id), body), syncState: "pending", message: "התשובה נשמרה וממתינה לסנכרון עם מערכת המשימות" }, 202);
 } catch (error) { return failure(error); }
}
