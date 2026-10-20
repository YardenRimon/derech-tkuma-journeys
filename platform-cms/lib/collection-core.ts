/** Shared CMS domain: no provider SDK, identity headers, or tenant chosen by the caller. */
export type Scope = Readonly<{ tenantId: string; siteId: string }>;
export type Kind = "tour" | "occurrence";
export type Actor = { id: string; canPublish: boolean };
export type Tour = { title: string; slug: string; sourcePath?: string; description: string; image: string; imageAlt: string };
export type Occurrence = { tourId: string; title?: string; date: string; dateLabel: string; startsAt: string|null; endsAt: string|null; timezone: string; meetingPoint: string; priceMinor: number; currency: "ILS"; capacity: number|null; note?: string };
export type Content = Tour | Occurrence;
export type Record = Scope & { id: string; kind: Kind; revision: number; draft: Content | null; published: Content | null; publishedVersion: number; updatedAt: string; updatedBy: string };
export type Change = { operation: "save" | "delete" | "publish" | "restore"; expectedRevision: number; content?: unknown; version?: number };
export type Snapshot = { version: number; operation: Change["operation"]; record: Record; actorId: string; at: string };
export class CollectionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface CollectionStore {
  get(scope: Scope, kind: Kind, id: string): Promise<Record | null>;
  list(scope: Scope, kind: Kind): Promise<Record[]>;
  published(scope: Scope, kind: Kind): Promise<{ id: string; content: Content; version: number }[]>;
  history(scope: Scope, kind: Kind, id: string): Promise<Snapshot[]>;
  commit(previous: Record | null, next: Record, audit: Snapshot): Promise<boolean>;
}
const text = (x: unknown, max: number, required = true) => {
  if (typeof x !== "string" || x.length > max || (required && !x.trim())) throw new CollectionError(400, "שדה תוכן אינו תקין");
  return x;
};
export function resourceId(x: unknown): string {
  if (typeof x !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(x)) throw new CollectionError(400, "מזהה רשומה אינו תקין");
  return x;
}
export function kindOf(x: unknown): Kind {
  if (x !== "tour" && x !== "occurrence") throw new CollectionError(404, "סוג תוכן אינו מוכר");
  return x;
}
export function sourcePath(value: unknown): string {
 const path=text(value,500);
 let decoded;try{decoded=decodeURIComponent(path);}catch{throw new CollectionError(400,"כתובת המקור אינה תקינה");}
 if(!path.startsWith('/')||path.startsWith('//')||/[?#\\\s<>"']/.test(decoded)||decoded.includes('//')||decoded.split('/').some(x=>x==='.'||x==='..'))throw new CollectionError(400,"כתובת המקור חייבת להיות נתיב מקומי");
 return path;
}
export function validateContent(kind: Kind, input: unknown): Content {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CollectionError(400, "תוכן אינו תקין");
  const x = input as { [key: string]: unknown };
  const allowed=kind==='tour'?['title','slug','sourcePath','description','image','imageAlt']:['tourId','title','date','dateLabel','startsAt','endsAt','timezone','meetingPoint','priceMinor','currency','capacity','note'];
  if(Object.keys(x).some(key=>!allowed.includes(key)))throw new CollectionError(400,"שדה תוכן אינו מוכר");
  if (kind === "tour") {
    const slug = text(x.slug, 160);
    if (!/^[\p{L}\p{N}-]+$/u.test(slug)) throw new CollectionError(400, "כתובת סיור אינה תקינה");
    const image = text(x.image, 2000, false);
    if (image && (!image.startsWith("/") || image.startsWith("//") || /[\s<>"']/.test(image))) throw new CollectionError(400, "כתובת תמונה אינה תקינה");
    return { title: text(x.title, 160), slug, ...(x.sourcePath===undefined?{}:{sourcePath:sourcePath(x.sourcePath)}), description: text(x.description, 10000, false), image, imageAlt: text(x.imageAlt, 500, false) };
  }
  const startsAt = x.startsAt==null||x.startsAt===''?null:text(x.startsAt, 40), endsAt = x.endsAt==null||x.endsAt===''?null:text(x.endsAt, 40), timezone = text(x.timezone, 80);
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!!startsAt!==!!endsAt || (startsAt&&endsAt&&(!instant.test(startsAt)||!instant.test(endsAt)||!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(startsAt)))) throw new CollectionError(400, "יש למלא זוג זמני התחלה וסיום תקינים, או להשאיר את שניהם לא ידועים");
  const date=text(x.date??startsAt?.slice(0,10),10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||(startsAt&&!startsAt.startsWith(date+'T')))throw new CollectionError(400,"תאריך המועד אינו תקין");
  try { new Intl.DateTimeFormat("he", { timeZone: timezone }); } catch { throw new CollectionError(400, "אזור זמן אינו תקין"); }
  const priceMinor = x.priceMinor as number, capacity = x.capacity as number|null;
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0 || priceMinor > 100000000 || x.currency !== "ILS" || (capacity!==null&&(!Number.isSafeInteger(capacity)||capacity<1||capacity>100000))) throw new CollectionError(400, "מחיר או קיבולת אינם תקינים");
  return { tourId: resourceId(x.tourId), ...(x.title===undefined?{}:{title:text(x.title,160)}), date, dateLabel:text(x.dateLabel??date,100), startsAt, endsAt, timezone, meetingPoint: text(x.meetingPoint, 1000,false), priceMinor, currency: "ILS", capacity, ...(x.note===undefined?{}:{note:text(x.note,1000,false)}) };
}
export class Collections {
  store: CollectionStore;
  constructor(store: CollectionStore) { this.store = store; }
  async change(scope: Scope, actor: Actor, kind: Kind, id: string, change: Change): Promise<Record> {
    resourceId(id);
    if (!scope.tenantId || !scope.siteId || !actor.id) throw new CollectionError(403, "חסר הקשר מורשה");
    if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new CollectionError(400, "גרסה אינה תקינה");
    if (change.operation === "publish" && !actor.canPublish) throw new CollectionError(403, "אין הרשאת פרסום");
    const previous = await this.store.get(scope, kind, id);
    if ((previous?.revision ?? 0) !== change.expectedRevision) throw new CollectionError(409, "הרשומה השתנתה, טען אותה מחדש");
    if (!previous && change.operation !== "save") throw new CollectionError(404, "הרשומה לא נמצאה");
    const now = new Date().toISOString();
    const next: Record = previous ? structuredClone(previous) : { ...scope, id, kind, revision: 0, draft: null, published: null, publishedVersion: 0, updatedAt: now, updatedBy: actor.id };
    if (change.operation === "save") next.draft = validateContent(kind, change.content);
    else if (change.operation === "delete") next.draft = null;
    else if (change.operation === "restore") {
      const snapshot = (await this.store.history(scope, kind, id)).find(x => x.version === change.version);
      if (!snapshot) throw new CollectionError(404, "הגרסה לא נמצאה");
      next.draft = snapshot.record.draft === null ? null : validateContent(kind, snapshot.record.draft);
    } else if (change.operation === "publish") {
      next.published = next.draft === null ? null : validateContent(kind, next.draft); next.publishedVersion++;
    } else throw new CollectionError(400, "פעולה אינה מוכרת");
    // A related record is looked up only inside the same authenticated scope.
    const occurrence = (change.operation === "publish" ? next.published : next.draft) as Occurrence | null;
    if (kind === "occurrence" && occurrence) {
      const tour = await this.store.get(scope, "tour", occurrence.tourId);
      if (!tour || (change.operation === "publish" ? !tour.published : !tour.draft)) throw new CollectionError(400, "הסיור המקושר אינו זמין במצב הנדרש");
    }
    next.revision++; next.updatedAt = now; next.updatedBy = actor.id;
    const audit: Snapshot = { version: next.revision, operation: change.operation, record: structuredClone(next), actorId: actor.id, at: now };
    if (!await this.store.commit(previous, next, audit)) throw new CollectionError(409, "הרשומה השתנתה, טען אותה מחדש");
    return next;
  }
}
