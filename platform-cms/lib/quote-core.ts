/** Pure server authority for the public source quote calculator.
 * No intake, storage, booking, payment, signature processing or delivery.
 * Source catalogue/copy is public; provider and mail configuration stay private.
 */
export const QUOTE_CATALOG_VERSION = 'source-2026-10-28' as const;
const sourceCatalog = [
  {
    "id": 1,
    "category": "בסיס",
    "label": "הדרכת סיור עומק עד 40 משתתפים",
    "unitPriceMinor": 190000,
    "priceKind": "fixed",
    "initiallySelected": true
  },
  {
    "id": 13,
    "category": "בסיס",
    "label": "הדרכת סיור עומק עד 60 משתתפים",
    "unitPriceMinor": 230000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 14,
    "category": "בסיס",
    "label": "סיור פרטי באנגלית עד 50 איש",
    "unitPriceMinor": 240000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 2,
    "category": "תוכן מיוחד",
    "label": "5 מחבלים בסלון הבית / עדות חיה - ישי ספז",
    "unitPriceMinor": 160000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 3,
    "category": "עדות חיה",
    "label": "תושבת קיבוץ בארי: סיפור של תופת וצמיחה",
    "unitPriceMinor": 420000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 4,
    "category": "מבט פיקודי",
    "label": "שיחה WITH קצין בכיר (אל״מ/תא״ל)",
    "unitPriceMinor": 490000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 5,
    "category": "התנדבות",
    "label": "עבודת אדמה חקלאית (גיזום/קטיף/עישוב)",
    "unitPriceMinor": 140000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 6,
    "category": "התנדבות",
    "label": "טביעת אצבע בדרך: בניית ספסלים למצפי הנצחה",
    "unitPriceMinor": 600000,
    "priceKind": "fixed",
    "initiallySelected": false
  },
  {
    "id": 7,
    "category": "אירוח",
    "label": "פריסת שטח קלה: מאפים, ירקות, שתייה",
    "unitPriceMinor": 2600,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 8,
    "category": "אירוח",
    "label": "כריך בלחם טרי: בשרי או צמחוני + שתייה",
    "unitPriceMinor": 6500,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 9,
    "category": "אירוח",
    "label": "ארוחת צהריים בקיבוץ עלומים: בשרי/צמחוני",
    "unitPriceMinor": 9500,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 10,
    "category": "אירוח",
    "label": "לאנץ׳ בוקס מעושנים ותבשילים",
    "unitPriceMinor": 11000,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 11,
    "category": "אירוח",
    "label": "ארוחת גריל בשרי מסעדה בשדרות",
    "unitPriceMinor": 11500,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 15,
    "category": "אירוח",
    "label": "חלה / פרנה / פיתה שניצל",
    "unitPriceMinor": 5300,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 16,
    "category": "אירוח",
    "label": "מנת פלאפל מוכנה / פרודוקטים להכנה עצמית (מינימום 20 מנות להזמנה)",
    "unitPriceMinor": 2900,
    "priceKind": "pax",
    "initiallySelected": false
  },
  {
    "id": 12,
    "category": "לוגיסטיקה",
    "label": "דמי משלוח להזמנת מזון לשטח",
    "unitPriceMinor": 10000,
    "priceKind": "fixed",
    "initiallySelected": false
  }
] as const;
export type QuoteServiceId = (typeof sourceCatalog)[number]['id'];
export type QuotePriceKind = 'fixed' | 'pax';
export const QUOTE_CATALOG = Object.freeze(sourceCatalog.map(service => Object.freeze({ ...service })));
export const QUOTE_SOURCE_RULES = Object.freeze({
  defaultParticipantCount: 40,
  minimumParticipantCount: 1,
  signatureRequired: false,
  pdfActive: false,
  sourceTaxLabel: 'פטור ממע״מ',
  taxStatusIndependentlyVerified: false,
  capacityLabelsEnforced: false,
  falafelMinimumLabelEnforced: false,
});
export type QuoteSelection = {
  catalogVersion: typeof QUOTE_CATALOG_VERSION;
  selectedServiceIds: QuoteServiceId[];
  participantCount: number;
};
export type QuoteLine = {
  serviceId: QuoteServiceId; category: string; label: string;
  priceKind: QuotePriceKind; quantity: number; unitPriceMinor: number; totalMinor: number;
};
export type QuoteCalculation = QuoteSelection & {
  currency: 'ILS'; lines: QuoteLine[]; selectedServiceCount: number;
  categorySubtotals: { category: string; totalMinor: number }[];
  totalMinor: number; displayTotalIls: number; displayPerParticipantIls: number;
  orderSummary: string;
};
export class QuoteError extends Error {
  readonly status = 400;
  readonly code: 'invalid_quote_selection' | 'quote_catalog_mismatch' | 'quote_total_overflow';
  constructor(code: 'invalid_quote_selection' | 'quote_catalog_mismatch' | 'quote_total_overflow') { super(code);this.code = code; }
}
const invalid = (): never => { throw new QuoteError('invalid_quote_selection'); };
const limit = BigInt(Number.MAX_SAFE_INTEGER);
const safeMinor = (value: bigint) => {
  if (value < BigInt(0) || value > limit) throw new QuoteError('quote_total_overflow');
  return Number(value);
};
const roundPositiveRatio = (numerator: bigint, denominator: bigint) => Number((BigInt(2) * numerator + denominator) / (BigInt(2) * denominator));
const formatIls = (value: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(value);

/** Caller gets a fresh selection; no mutable shared default or browser total. */
export function defaultQuoteSelection(): QuoteSelection {
  return { catalogVersion: QUOTE_CATALOG_VERSION, selectedServiceIds: QUOTE_CATALOG.filter(service => service.initiallySelected).map(service => service.id), participantCount: QUOTE_SOURCE_RULES.defaultParticipantCount };
}

/** Strict native schema intentionally rejects source parseInt/coercion quirks.
 * Browser prices, hidden total/summary, arbitrary quantities and extra keys are
 * not accepted. Zero selections and multiple base selections are source-valid.
 */
export function validateQuoteSelection(value: unknown): QuoteSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return invalid();
  const supplied = value as Record<string, unknown>;
  const names = ['catalogVersion', 'selectedServiceIds', 'participantCount'];
  if (Object.keys(supplied).length !== names.length || names.some(name => !Object.hasOwn(supplied, name))) return invalid();
  if (supplied.catalogVersion !== QUOTE_CATALOG_VERSION) throw new QuoteError('quote_catalog_mismatch');
  const pax = supplied.participantCount, ids = supplied.selectedServiceIds;
  if (typeof pax !== 'number' || !Number.isSafeInteger(pax) || pax < QUOTE_SOURCE_RULES.minimumParticipantCount || !Array.isArray(ids) || ids.length > QUOTE_CATALOG.length) return invalid();
  const selected = new Set<QuoteServiceId>();
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || !QUOTE_CATALOG.some(service => service.id === id) || selected.has(id as QuoteServiceId)) return invalid();
    selected.add(id as QuoteServiceId);
  }
  // Checkbox/source catalogue order is canonical regardless of request order.
  return { catalogVersion: QUOTE_CATALOG_VERSION, selectedServiceIds: QUOTE_CATALOG.filter(service => selected.has(service.id)).map(service => service.id), participantCount: pax };
}

/** Integer minor units and BigInt intermediates prevent floating point or sum
 * overflow. No business participant maximum or label-only limits are invented.
 */
export function calculateQuote(value: unknown = defaultQuoteSelection()): QuoteCalculation {
  const selection = validateQuoteSelection(value), selected = new Set(selection.selectedServiceIds);
  const lines: QuoteLine[] = [], categories = new Map<string, bigint>();let total = BigInt(0);
  for (const service of QUOTE_CATALOG) {
    if (!selected.has(service.id)) continue;
    const quantity = service.priceKind === 'pax' ? selection.participantCount : 1;
    const line = BigInt(service.unitPriceMinor) * BigInt(quantity);
    const totalMinor = safeMinor(line);total += line;safeMinor(total);
    categories.set(service.category, (categories.get(service.category) ?? BigInt(0)) + line);
    lines.push({ serviceId: service.id, category: service.category, label: service.label, priceKind: service.priceKind, quantity, unitPriceMinor: service.unitPriceMinor, totalMinor });
  }
  const totalMinor = safeMinor(total), displayTotalIls = roundPositiveRatio(total, BigInt(100));
  const orderSummary = [`סיכום הזמנה (${formatIls(selection.participantCount)} משתתפים):`, ...lines.map(line => `• ${line.label}: ₪${formatIls(roundPositiveRatio(BigInt(line.totalMinor), BigInt(100)))}`), `סה"כ לתשלום: ₪${formatIls(displayTotalIls)}`].join('\n');
  return { ...selection, currency: 'ILS', lines, selectedServiceCount: lines.length,
    categorySubtotals: [...categories].map(([category, subtotal]) => ({ category, totalMinor: safeMinor(subtotal) })), totalMinor,
    displayTotalIls, displayPerParticipantIls: roundPositiveRatio(total, BigInt(selection.participantCount) * BigInt(100)), orderSummary };
}
