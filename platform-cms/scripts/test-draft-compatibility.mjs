import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitStoredDraft, normalizeOrder, parseStoredDraft } from '../lib/draft-compatibility.ts';

const base = {
  title: 'עמוד בדיקה', page: '/',
  sections: ['first', 'new', 'middle', 'last'].map(id => ({ id, html: `<section>${id}</section>` })),
  fields: {
    text: { type: 'text', value: 'טקסט מקורי' },
    image: { type: 'image', value: 'https://derech-tkuma.com/wp-content/uploads/old.jpg', alt: 'מקור' },
    local: { type: 'image', value: '/original/path/photo.webp' },
  },
  shellPrefix: '', shellSuffix: '',
};
const stored = (fields = {}, extra = {}) => ({ fields, order: ['last', 'first', 'removed', 'middle', 'first'], ...extra });
const fit = (fields, extra) => fitStoredDraft(base, stored(fields, extra));

const original = {
  removed: { value: 'שינוי שנמחק\n<טקסט>', english: 'Exact translation', alt: 'תיאור ישן' },
  text: { value: 'טקסט חדש', english: 'New text' },
};
const recovered = fit(original);
assert.deepEqual(recovered.stale, [{ name: 'removed', reason: 'removed', ...original.removed, was: null }]);
assert.deepEqual(recovered.draft.fields.text, original.text);
assert.equal(Object.hasOwn(recovered.draft.fields, 'removed'), false);
assert.deepEqual(recovered.draft.order, ['last', 'first', 'new', 'middle']);
assert.deepEqual(normalizeOrder(base, []), ['first', 'new', 'middle', 'last']);
assert.deepEqual(normalizeOrder(base, ['middle', 5, '__proto__', 'last']), ['first', 'new', 'middle', 'last']);
assert.deepEqual(normalizeOrder(base, ['last', 'middle', 'first']), ['last', 'middle', 'first', 'new']);

const malformed = ['', '{broken', 'null', '[]', '{}', '{"fields":{},"order":null}',
  '{"fields":[],"order":[]}', '{"fields":{"text":null},"order":[]}',
  '{"fields":{"text":{"value":3}},"order":[]}', '{"fields":{"text":{}},"order":[]}',
  '{"fields":{},"order":[1]}'];
for (const text of malformed) assert.throws(() => parseStoredDraft(text), undefined, text);
for (const value of [null, [], {}, { fields: {}, order: [null] }, { fields: { text: { value: null } }, order: [] }]) {
  assert.throws(() => fitStoredDraft(base, value));
}
assert.deepEqual(parseStoredDraft('{"fields":{},"order":[]}'), { fields: {}, order: [] });

const prototypeInput = parseStoredDraft('{"fields":{"__proto__":{"value":"one"},"constructor":{"value":"two"},"toString":{"value":"three"}},"order":["__proto__"]}');
const prototypeResult = fitStoredDraft(base, prototypeInput);
assert.deepEqual(prototypeResult.stale.map(field => field.name), ['__proto__', 'constructor', 'toString']);
assert.equal(Object.getPrototypeOf(prototypeResult.draft.fields), null);
assert.equal(Object.keys(prototypeResult.draft.fields).length, 0);
assert.equal(Object.prototype.value, undefined);
const ownPrototypeBase = { ...base, fields: JSON.parse('{"__proto__":{"type":"text","value":"original"}}') };
const ownPrototypeResult = fitStoredDraft(ownPrototypeBase, prototypeInput);
assert.equal(ownPrototypeResult.draft.fields.__proto__.value, 'one');
assert.equal(Object.getPrototypeOf(ownPrototypeResult.draft.fields), null);
assert.throws(() => fitStoredDraft(base, { fields: { text: Object.create({ value: 'inherited' }) }, order: [] }));

for (const value of [base.fields.image.value, base.fields.local.value, '/media/3ffb093d-aeee-4a93-915e-8b3b652d70de']) {
  const result = fit({ image: { value, alt: 'תמונה נגישה' } });
  assert.equal(result.stale.length, 0, value);
  assert.deepEqual(result.draft.fields.image, { value, alt: 'תמונה נגישה' });
}
const currentPages = JSON.parse(readFileSync(new URL('../lib/generated-pages.json', import.meta.url), 'utf8'));
let currentImageCount = 0;
for (const current of Object.values(currentPages)) {
  const fields = Object.fromEntries(Object.entries(current.fields)
    .filter(([, field]) => field.type === 'image')
    .map(([id, field]) => [id, { value: field.value, ...(field.alt === undefined ? {} : { alt: field.alt }) }]));
  currentImageCount += Object.keys(fields).length;
  const result = fitStoredDraft(current, { fields, order: current.sections.map(section => section.id) });
  assert.equal(result.stale.length, 0, current.title);
  assert.deepEqual({ ...result.draft.fields }, fields);
}
assert.ok(currentImageCount > 0, 'Current generated content must exercise exact original image URLs');
for (const value of ['/assets/unknown.jpg', 'https://evil.invalid/image.jpg', '/media/not-a-uuid',
  '/media/3ffb093d-aeee-0a93-915e-8b3b652d70de', '/media/3ffb093d-aeee-4a93-915e-8b3b652d70de?x=1', 'javascript:alert(1)']) {
  const result = fit({ image: { value } });
  assert.equal(result.stale[0].value, value);
  assert.equal(result.stale[0].was, base.fields.image.value);
  assert.equal(Object.hasOwn(result.draft.fields, 'image'), false);
}

const seo = { title: 'כותרת'.repeat(25), description: 'תיאור שמור' };
assert.deepEqual(fit({}, { seo }).stale, [{ name: '__seo__', reason: 'invalid', value: JSON.stringify(seo), was: null }]);
for (const seo of [null, [], 'old seo', { title: ' ', description: '' }, { title: 'x', description: 7 },
  { title: 'x', description: 'y'.repeat(321) }]) {
  const result = fit({}, { seo });
  assert.equal(result.draft.seo, undefined);
  assert.deepEqual(JSON.parse(result.stale[0].value), seo);
}
const limitSeo = { title: 't'.repeat(120), description: 'd'.repeat(320) };
assert.deepEqual(fit({}, { seo: limitSeo }).draft.seo, limitSeo);

assert.equal(fit({ text: { value: 't'.repeat(10_000), english: 'e'.repeat(10_000) } }).stale.length, 0);
assert.equal(fit({ image: { value: base.fields.image.value, alt: 'a'.repeat(500) } }).stale.length, 0);
for (const field of [{ value: 't'.repeat(10_001) }, { value: 'kept', english: 'e'.repeat(10_001) },
  { value: 'kept', english: { invalid: true } }, { value: 'kept', alt: 7 }]) {
  const result = fit({ text: field });
  assert.equal(result.draft.fields.text, undefined);
  assert.equal(result.stale[0].reason, 'invalid');
  assert.equal(result.stale[0].was, base.fields.text.value);
  assert.deepEqual(result.stale[0].english, field.english);
  assert.deepEqual(result.stale[0].alt, field.alt);
}
for (const alt of ['a'.repeat(501), { invalid: true }, null]) {
  const result = fit({ image: { value: base.fields.image.value, alt } });
  assert.equal(result.draft.fields.image, undefined);
  assert.deepEqual(result.stale[0].alt, alt);
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
const frozenBase = freezeDeep(structuredClone(base));
const frozenInput = freezeDeep(stored(original, { seo: { title: 'valid', description: 'description' } }));
const beforeBase = JSON.stringify(frozenBase), beforeInput = JSON.stringify(frozenInput);
const noMutation = fitStoredDraft(frozenBase, frozenInput);
assert.equal(JSON.stringify(frozenBase), beforeBase);
assert.equal(JSON.stringify(frozenInput), beforeInput);
noMutation.draft.fields.text.value = 'changed output only';
noMutation.draft.order.reverse();
assert.equal(JSON.stringify(frozenInput), beforeInput);
assert.notEqual(noMutation.draft.seo, frozenInput.seo);

console.log(`PASS draft compatibility: exact stale recovery, order merge, damaged-storage refusal, prototype safety, ${currentImageCount} current originals/media, SEO and metadata recovery, limits and immutability`);
