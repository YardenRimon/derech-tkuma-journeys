import type { BasePage, Draft } from "./cms";

// Stored changes belong to the template IDs they were saved against. This
// adapter never guesses a replacement ID; incompatible changes remain
// recoverable, while only compatible changes reach rendering or editing.
type RecordValue = Record<string, unknown>;
type StoredDraft = RecordValue & {
  fields: Record<string, RecordValue & { value: string }>;
  order: string[];
};

export type StaleField = {
  name: string;
  reason: "removed" | "invalid";
  value: string;
  english?: unknown;
  alt?: unknown;
  was: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_PATTERN = /^\/media\/([0-9a-f-]+)$/i;
const TEXT_LIMIT = 10_000;
const ALT_LIMIT = 500;
const SEO_TITLE_LIMIT = 120;
const SEO_DESCRIPTION_LIMIT = 320;

function isRecord(value: unknown): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertStoredDraft(input: unknown): asserts input is StoredDraft {
  if (!isRecord(input) || !Object.hasOwn(input, "fields") || !isRecord(input.fields) ||
      !Object.hasOwn(input, "order") || !Array.isArray(input.order) ||
      !input.order.every((id) => typeof id === "string")) {
    throw new TypeError("Stored draft has an invalid fields/order structure");
  }
  for (const field of Object.values(input.fields)) {
    if (!isRecord(field) || !Object.hasOwn(field, "value") || typeof field.value !== "string") {
      throw new TypeError("Stored draft contains an invalid field value");
    }
  }
}

// The caller maps damaged storage to its conflict/error response. Malformed
// JSON or required data must never become an apparently valid empty draft.
export function parseStoredDraft(text: string): StoredDraft {
  if (typeof text !== "string") throw new TypeError("Stored draft must be JSON text");
  const input: unknown = JSON.parse(text);
  assertStoredDraft(input);
  return input;
}

// Preserve the saved order of surviving sections. Place each new section
// after its closest preceding section in the current template.
export function normalizeOrder(base: BasePage, order: unknown): string[] {
  const ids = base.sections.map((section) => section.id);
  const known = new Set(ids);
  const result: string[] = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id === "string" && known.has(id) && !result.includes(id)) result.push(id);
    }
  }
  ids.forEach((id, index) => {
    if (result.includes(id)) return;
    let at = 0;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      const position = result.indexOf(ids[earlier]);
      if (position !== -1) { at = position + 1; break; }
    }
    result.splice(at, 0, id);
  });
  return result;
}

export function fitStoredDraft(base: BasePage, input: unknown): { draft: Draft; stale: StaleField[] } {
  assertStoredDraft(input);
  const draft: Draft = {
    fields: Object.create(null) as Draft["fields"],
    order: normalizeOrder(base, input.order),
  };
  const stale: StaleField[] = [];
  const originals = new Set(Object.values(base.fields)
    .filter((field) => field.type === "image").map((field) => field.value));

  for (const [name, supplied] of Object.entries(input.fields)) {
    const definition = Object.hasOwn(base.fields, name) ? base.fields[name] : undefined;
    const value = supplied.value;
    const english = supplied.english;
    const alt = supplied.alt;
    const setAside = (reason: StaleField["reason"]) => stale.push({
      name, reason, value,
      ...(english === undefined ? {} : { english }),
      ...(alt === undefined ? {} : { alt }),
      was: definition ? definition.value : (base.retired && Object.hasOwn(base.retired,name) ? base.retired[name] : null),
    });
    if (!definition) { setAside("removed"); continue; }

    const englishOk = english === undefined || (typeof english === "string" && english.length <= TEXT_LIMIT);
    const altOk = alt === undefined || (typeof alt === "string" && alt.length <= ALT_LIMIT);
    if (!englishOk || !altOk) { setAside("invalid"); continue; }
    if (definition.type === "text") {
      if (value.length > TEXT_LIMIT) { setAside("invalid"); continue; }
      draft.fields[name] = { value, ...(english === undefined ? {} : { english: english as string }) };
    } else {
      const match = MEDIA_PATTERN.exec(value);
      // Current originals include exact legacy/remote URLs, not only assets.
      // R2 object existence is still checked by the server's write validator.
      if (!originals.has(value) && (!match || !UUID_PATTERN.test(match[1]))) {
        setAside("invalid"); continue;
      }
      draft.fields[name] = { value, ...(alt === undefined ? {} : { alt: alt as string }) };
    }
  }

  if (Object.hasOwn(input, "seo") && input.seo !== undefined) {
    const seo = input.seo;
    if (isRecord(seo) && Object.hasOwn(seo, "title") && Object.hasOwn(seo, "description") &&
        typeof seo.title === "string" && Boolean(seo.title.trim()) && seo.title.length <= SEO_TITLE_LIMIT &&
        typeof seo.description === "string" && seo.description.length <= SEO_DESCRIPTION_LIMIT) {
      draft.seo = { title: seo.title, description: seo.description };
    } else {
      stale.push({ name: "__seo__", reason: "invalid", value: JSON.stringify(seo), was: null });
    }
  }
  return { draft, stale };
}
