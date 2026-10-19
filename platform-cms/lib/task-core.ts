/** Provider-neutral projection of the existing platform work_items, never a second task registry. */
export type TaskScope = Readonly<{ tenantId: string; siteId: string }>;
export const taskStatuses = ["open", "in_progress", "waiting_info", "blocked", "done", "cancelled"] as const;
export type TaskStatus = typeof taskStatuses[number];
export type TaskActor = { email: string; isAdmin: boolean };
export type TaskSnapshot = {
 externalId: string; externalVersion: string; title: string;
 category: "content_review" | "contradiction" | "access_request";
 sourceUrl: string; sourceHash: string; linkedTarget: string; quotedContent: string; question: string;
 assigneeEmail: string; assigneeLabel: string; status: TaskStatus; answer: string;
};
export type TaskRecord = TaskScope & { revision: number; snapshot: TaskSnapshot; syncedAt: string };
export type TaskCommand = {
 key: string; externalId: string; externalVersion: string; actorEmail: string;
 answer: string; requestedStatus: TaskStatus; state: "pending" | "accepted" | "rejected";
 createdAt: string; resultNote: string;
};
export type TaskAudit = { revision: number; operation: "import" | "request"; actorEmail: string; at: string; snapshot: TaskSnapshot; command?: TaskCommand };
export type TaskReceipt = { key: string; state: "accepted" | "rejected"; note: string };
export interface TaskStore {
 get(scope: TaskScope, id: string): Promise<TaskRecord | null>;
 list(scope: TaskScope, actor: TaskActor): Promise<TaskRecord[]>;
 commands(scope: TaskScope, id?: string): Promise<TaskCommand[]>;
 command(scope: TaskScope, key: string): Promise<TaskCommand | null>;
 history(scope: TaskScope, id: string): Promise<TaskAudit[]>;
 commit(previous: TaskRecord | null, next: TaskRecord, audit: TaskAudit, command?: TaskCommand, receipts?: TaskReceipt[]): Promise<boolean>;
}
export class TaskError extends Error {
 status: number;
 constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (message: string): never => { throw new TaskError(400, message); };
const text = (value: unknown, max: number, required = true): string =>
 typeof value === "string" && value.length <= max && (!required || !!value.trim()) ? value : fail("שדה משימה אינו תקין");
export function taskId(value: unknown): string { return typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) ? value : fail("הפניה למשימה אינה תקינה"); }
export function taskStatus(value: unknown): TaskStatus { return taskStatuses.includes(value as TaskStatus) ? value as TaskStatus : fail("מצב המשימה אינו מוכר"); }
export function commandKey(value: unknown): string { return typeof value === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(value) ? value : fail("מפתח פעולה אינו תקין"); }
export function validateTaskSnapshot(input: unknown): TaskSnapshot {
 if (!input || typeof input !== "object" || Array.isArray(input)) return fail("תמונת המשימה אינה תקינה");
 const x = input as Record<string, unknown>;
 const sourceUrl = text(x.sourceUrl, 2000, false);
 if (sourceUrl) { let url; try { url = new URL(sourceUrl); } catch { return fail("כתובת המקור אינה תקינה"); } if (url.protocol !== "https:" || url.username || url.password) return fail("כתובת המקור אינה תקינה"); }
 const email = text(x.assigneeEmail, 254).trim().toLowerCase();
 if (!/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email)) return fail("אימייל האחראי אינו תקין");
 if (!["content_review", "contradiction", "access_request"].includes(x.category as string)) return fail("סוג המשימה אינו מוכר");
 const sourceHash = text(x.sourceHash, 64, false);
 if (sourceHash && !/^[a-f0-9]{64}$/.test(sourceHash)) return fail("חתימת המקור אינה תקינה");
 return { externalId: taskId(x.externalId), externalVersion: text(x.externalVersion, 120), title: text(x.title, 300), category: x.category as TaskSnapshot["category"], sourceUrl, sourceHash, linkedTarget: text(x.linkedTarget, 500, false), quotedContent: text(x.quotedContent, 15000, false), question: text(x.question, 10000), assigneeEmail: email, assigneeLabel: text(x.assigneeLabel, 200), status: taskStatus(x.status), answer: text(x.answer, 10000, false) };
}
export function canReadTask(actor: TaskActor, record: TaskRecord): boolean { return actor.isAdmin || actor.email === record.snapshot.assigneeEmail; }
export class Tasks {
 store: TaskStore;
 constructor(store: TaskStore) { this.store = store; }
 async readable(scope: TaskScope, actor: TaskActor, id: string): Promise<TaskRecord> {
  const record = await this.store.get(scope, taskId(id));
  if (!record || !canReadTask(actor, record)) throw new TaskError(404, "המשימה לא נמצאה");
  return record;
 }
 async import(scope: TaskScope, actor: TaskActor, input: unknown, expectedRevision: number, receipts: TaskReceipt[] = []): Promise<TaskRecord> {
  if (!actor.isAdmin) throw new TaskError(403, "סנכרון משימות מחייב הרשאת מנהל");
  const snapshot = validateTaskSnapshot(input), previous = await this.store.get(scope, snapshot.externalId);
  this.revision(previous, expectedRevision);
  if (receipts.length > 100 || new Set(receipts.map(x=>x?.key)).size !== receipts.length) return fail("אישורי סנכרון כפולים או רבים מדי");
  for (const receipt of receipts) {
   if (!receipt || typeof receipt !== "object") return fail("אישור סנכרון אינו תקין");
   commandKey(receipt.key); text(receipt.note, 1000, false);
   if (receipt.state !== "accepted" && receipt.state !== "rejected") return fail("אישור סנכרון אינו תקין");
   const command = await this.store.command(scope, receipt.key);
   if (!command || command.externalId !== snapshot.externalId || command.state !== "pending") throw new TaskError(409, "פעולת הסנכרון אינה ממתינה למשימה זו");
   if (receipt.state === "accepted" && command.externalVersion === snapshot.externalVersion) throw new TaskError(409, "נדרש מצב מקור מעודכן לפני אישור פעולה");
   if (receipt.state === "accepted" && command.requestedStatus !== snapshot.status) throw new TaskError(409, "מצב המקור אינו תואם לפעולה שאושרה");
  }
  if (previous?.snapshot.externalVersion === snapshot.externalVersion && JSON.stringify(previous.snapshot) !== JSON.stringify(snapshot)) throw new TaskError(409, "תוכן המקור השתנה ללא גרסת מקור חדשה");
  if (previous && JSON.stringify(previous.snapshot) === JSON.stringify(snapshot) && !receipts.length) return previous;
  const now = new Date().toISOString(), next = { ...scope, revision: (previous?.revision ?? 0) + 1, snapshot, syncedAt: now };
  if (!await this.store.commit(previous, next, { revision: next.revision, operation: "import", actorEmail: actor.email, at: now, snapshot }, undefined, receipts)) throw new TaskError(409, "המשימה השתנתה. טען אותה מחדש");
  return next;
 }
 async request(scope: TaskScope, actor: TaskActor, id: string, input: { key: unknown; expectedRevision: number; answer: unknown; requestedStatus: unknown }): Promise<TaskCommand> {
  const record = await this.readable(scope, actor, id), key = commandKey(input.key), answer = text(input.answer, 10000, false), requestedStatus = taskStatus(input.requestedStatus);
  const existing = await this.store.command(scope, key);
  if (existing) {
   if (existing.externalId !== id || existing.actorEmail !== actor.email || existing.answer !== answer || existing.requestedStatus !== requestedStatus) throw new TaskError(409, "מפתח הפעולה כבר שימש לבקשה אחרת");
   return existing;
  }
  this.revision(record, input.expectedRevision);
  if (!answer.trim() && requestedStatus === record.snapshot.status) return fail("יש להוסיף תשובה או לשנות מצב");
  if ((await this.store.commands(scope, id)).some(x => x.state === "pending")) throw new TaskError(409, "קיימת תשובה הממתינה לסנכרון. יש להמתין לאישור המקור");
  const now = new Date().toISOString(), command: TaskCommand = { key, externalId: id, externalVersion: record.snapshot.externalVersion, actorEmail: actor.email, answer, requestedStatus, state: "pending", createdAt: now, resultNote: "" };
  const next = { ...record, revision: record.revision + 1 };
  if (!await this.store.commit(record, next, { revision: next.revision, operation: "request", actorEmail: actor.email, at: now, snapshot: record.snapshot, command }, command)) throw new TaskError(409, "המשימה השתנתה. טען אותה מחדש");
  return command;
 }
 private revision(previous: TaskRecord | null, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 0) return fail("גרסה אינה תקינה");
  if ((previous?.revision ?? 0) !== expected) throw new TaskError(409, "המשימה השתנתה. טען אותה מחדש");
 }
}
