/** Offline DOM/event proof for the native client and the actual retained guard. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({ stdin: { contents: `export * from './lib/contact-client';`, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
const { preparePublicContacts, contactClientSource } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const pages = JSON.parse(readFileSync(new URL('../lib/generated-pages.json', import.meta.url))), policy = { CONTACT_MODE: 'receive-only', CONTACT_ORIGIN: 'https://derech-tkuma.com' };
const native = contactClientSource();new vm.Script(native);assert.doesNotMatch(native, /innerHTML|outerHTML|insertAdjacentHTML|console\.|location\.assign|sendBeacon/);
for(const [slug, page] of Object.entries(pages)) {
  const source = page.shellPrefix + page.sections.map(section => section.html).join('') + page.shellSuffix;
  assert.equal(preparePublicContacts(source, new URL(encodeURI(slug), 'https://review.workers.dev'), policy), source, 'review receive-only misconfiguration remains byte-identical/guarded');
  assert.equal(preparePublicContacts(source, new URL(encodeURI(slug), policy.CONTACT_ORIGIN), {}), source, 'unset production mode cannot wire a form');
  const wired = preparePublicContacts(source, new URL(encodeURI(slug), policy.CONTACT_ORIGIN), policy);
  if(['0899899','af355f0','1b8a2d8'].some(id=>source.includes('value="'+id+'"'))) {
    assert.equal((wired.match(/data-native-contact=/g) ?? []).length, 1);assert.ok(wired.indexOf('data-native-contact=') < wired.indexOf('/__pilot__/guard.js'), 'private fetch is captured before the guard');
    assert.equal(wired.replace(/<script data-native-contact="[^"]+">[\s\S]*?<\/script>/, ''), source, 'original DOM/copy/script order is unchanged');assert.equal(preparePublicContacts(wired, new URL(encodeURI(slug), policy.CONTACT_ORIGIN), policy), wired);
  } else assert.equal(wired, source, 'pages without a verified contact widget never get a client');
}
const key = '10000000-0000-4000-8000-000000000001', receipt = '20000000-0000-4000-8000-000000000002';
const accepted = { status: 202, body: { accepted: true, receipt, state: 'stored_pending_processing' } };
const flush = async () => { for(let index = 0;index < 8;index++) await new Promise(resolve => setImmediate(resolve)); };
class Element {
  constructor() { this.attributes = {};this.value = '';this.checked = false;this.disabled = false;this.children = [];this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  set innerHTML(_value) { throw new Error('unsafe HTML sink'); }
  append(child) { this.children.push(child);if(child.name) this.fields?.set(child.name, child); }
  appendChild(child) { this.append(child);return child; }
}
class Form extends Element {
  constructor(id, post) { super();this.fields = new Map();this.button = new Element();for(const [name, value] of Object.entries({ form_id: id, post_id: post, 'form_fields[fullname]': 'שם בדיקה', 'form_fields[phone]': '0501234567', 'form_fields[email]': 'synthetic@example.test', 'form_fields[message]': 'שורה א\nשורה ב' })) { const field = new Element();field.value = value;this.fields.set(name, field); }const consent = new Element();consent.checked = true;this.fields.set('form_fields[field_1704896]', consent);this.elements = { namedItem: name => this.fields.get(name) ?? null }; }
  matches(selector) { return selector === 'form.elementor-form'; }
  reportValidity() { return this.valid !== false; }
  querySelector() { return this.children.find(child => Object.hasOwn(child.attributes, 'data-native-contact-status')) ?? null; }
  querySelectorAll() { return [this.button]; }
  submit() { throw new Error('source submit must never run'); }
}
async function boot(replies, { id = '0899899', post = '13', storage = new Map(), origin = policy.CONTACT_ORIGIN } = {}) {
  const form = new Form(id, post), windowEvents = {}, documentEvents = {}, requests = [], timers = [], listeners = (target, name, callback) => { (target[name] ??= []).push(callback); };
  const context = { location: { origin, href: origin + '/' }, crypto: { randomUUID: () => key }, URL, DOMException, AbortController, HTMLFormElement: Form,
    XMLHttpRequest: class { open() {} },navigator: { sendBeacon: () => false },
    document: { readyState: 'complete', querySelectorAll: () => [form], createElement: () => new Element(), addEventListener: (name, callback) => listeners(documentEvents, name, callback) },
    sessionStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value), removeItem: name => storage.delete(name) },
    addEventListener: (name, callback) => listeners(windowEvents, name, callback),open: () => null,
    setTimeout: callback => { timers.push(callback);return timers.length; },clearTimeout: () => {},
    async fetch(url, options) { requests.push({ url, ...options, payload: JSON.parse(options.body) });const response = replies.shift();assert.ok(response, 'unexpected fetch');if(response.error) throw new TypeError('private network detail');if(response.timeout) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('private timeout detail', 'AbortError')), { once: true }));return { status: response.status, async json() { if(response.malformed) throw new Error('private parse detail');return response.body; } }; },
  };
  context.window = context;vm.runInNewContext(native, context);
  vm.runInNewContext(readFileSync(new URL('../public/__pilot__/guard.js', import.meta.url), 'utf8'), context);
  let legacyCalls = 0;listeners(documentEvents, 'submit', () => { legacyCalls++; });
  return { form, requests, storage, timers, context, get legacyCalls() { return legacyCalls; }, async submit() { const event = { target: form, stopped: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };for(const listener of [...(windowEvents.submit ?? []), ...(documentEvents.submit ?? [])]) { if(event.stopped) break;listener(event); }await flush();return event; } };
}
for(const [id, post] of [['0899899', '13'], ['af355f0', '18'], ['1b8a2d8', '1489']]) {
  const browser = await boot([accepted], { id, post });const event = await browser.submit();assert.equal(event.defaultPrevented, true);assert.equal(browser.legacyCalls, 0);assert.equal(browser.requests.length, 1);assert.equal(browser.requests[0].url, '/api/contact/');assert.equal(browser.requests[0].method, 'POST');assert.equal(browser.requests[0].credentials, 'same-origin');assert.equal(browser.requests[0].redirect, 'error');assert.equal(browser.requests[0].cache, 'no-store');assert.equal(browser.requests[0].payload.formId, id);if(id==='1b8a2d8')assert.equal(browser.requests[0].payload.message,'שורה א\nשורה ב');else assert.ok(!Object.hasOwn(browser.requests[0].payload,'message'));assert.equal(browser.requests[0].payload.consent.contact, true);assert.equal(browser.requests[0].payload.honeypot, '');assert.equal(browser.form.button.disabled, true);assert.match(browser.form.querySelector().textContent, /נשמרו וממתינים לעיבוד/);assert.doesNotMatch(browser.form.querySelector().textContent, /נשלח|נחזור|התקבל/);await browser.submit();assert.equal(browser.requests.length, 1, 'double-click/replay after acceptance cannot create another submission');
  await assert.rejects(() => browser.context.fetch('/api/contact/', { method: 'POST' }), error => error.name === 'NotAllowedError', 'global guard remains active');
}
for(const [id, post] of [['1b8a2d8', '999'], ['c5cb8a0', '5133'], ['aa2b8e0', '5982'], ['0899899', '999']]) { const browser = await boot([], { id, post });const event = await browser.submit();assert.equal(browser.requests.length, 0);assert.equal(event.defaultPrevented, true, 'unknown forms still reach the retained blocking guard'); }
const retry = await boot([{ error: true }, accepted]);await retry.submit();assert.equal(retry.form.button.disabled, false);assert.match(retry.form.querySelector().textContent, /לא ניתן לוודא/);assert.ok([...retry.storage.values()].every(value => /^[a-f0-9-]{36}$/.test(value)));await retry.submit();assert.deepEqual(retry.requests[0].payload, retry.requests[1].payload, 'uncertain retry preserves exactly one UUID/payload');
const timedOut = await boot([{ timeout: true }, accepted]);await timedOut.submit();await timedOut.submit();assert.equal(timedOut.requests.length, 1, 'in-flight double-click cannot submit twice');assert.equal(timedOut.form.button.disabled, true);timedOut.timers[0]();await flush();assert.equal(timedOut.requests[0].signal.aborted, true);assert.equal(timedOut.form.button.disabled, false);await timedOut.submit();assert.deepEqual(timedOut.requests[0].payload, timedOut.requests[1].payload, 'actual timeout signal preserves the attempt UUID');
const reloadStorage = new Map(), first = await boot([{ error: true }], { storage: reloadStorage });await first.submit();const reloaded = await boot([accepted], { storage: reloadStorage });await reloaded.submit();assert.equal(first.requests[0].payload.idempotencyKey, reloaded.requests[0].payload.idempotencyKey, 'reload retry retains UUID without storing personal fields');
const conflict = await boot([{ error: true }, { status: 409, body: { accepted: false, code: 'idempotency_conflict' } }]);await conflict.submit();conflict.form.fields.get('form_fields[fullname]').value = 'שינוי אחר';await conflict.submit();assert.equal(conflict.requests[0].payload.idempotencyKey, conflict.requests[1].payload.idempotencyKey);assert.match(conflict.form.querySelector().textContent, /הפרטים השתנו/);assert.equal(conflict.form.button.disabled, false);
const invalid = await boot([accepted]);invalid.form.valid = false;await invalid.submit();assert.equal(invalid.requests.length, 0);
const unconfirmed = await boot([{ status: 202, body: { accepted: true, receipt, state: 'delivered' } }]);await unconfirmed.submit();assert.equal(unconfirmed.form.button.disabled, false);assert.doesNotMatch(unconfirmed.form.querySelector().textContent, /אסמכתה/);
const review = await boot([], { origin: 'https://review.workers.dev' });await review.submit();assert.equal(review.requests.length, 0, 'even a manually executed client cannot submit on review');
console.log('PASS native contact client: exact source DOM/copy, server-only production gate, review/unknown forms blocked, private JSON capture prevents Elementor duplicate, same-UUID uncertain/reload retry, changed-payload conflict, consent validation and honest opaque stored receipt.');
