import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { loginClientSource } from '../app/login/login-client.mjs';

const sourceUrl = new URL('../app/login/route.ts', import.meta.url);
const source = (await readFile(sourceUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, sourceUrl).href}'`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
assert.equal((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
const { GET, loginReturnTo } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'));

for (const target of [null, '//evil.example/admin', 'https://evil.example/admin', '/admin/\\evil', '/admin/%2f%2fevil', '/admin/%0aevil', '/admin/../api/users', '/admin-other', '/admin/%zz', '/admin/\u0000x', '/admin/with space']) assert.equal(loginReturnTo(target), '/admin/', 'unsafe destination falls back safely');
for (const target of ['/admin', '/admin/tasks', '/admin/edit?slug=%2F']) assert.equal(loginReturnTo(target), target);
const attack = '</script><img src=x onerror=alert(1)>';
const response = await GET(new Request('https://preview.example/login/?next=' + encodeURIComponent('/admin/?q=' + attack)));
const html = await response.text();
const plainHtml = await (await GET(new Request('https://preview.example/login/'))).text();
assert.equal(response.status, 200);
assert.match(html, /<html lang="he" dir="rtl">/);
assert.match(html, /לוגו-דרך-התקומה-1024x206\.webp/);
assert.match(html, /id="email-code"[^>]+pattern="\[0-9\]\{8\}"[^>]+maxlength="8"/);
assert.match(html, /id="mfa-code"[^>]+pattern="\[0-9\]\{6\}"[^>]+maxlength="6"/);
assert.match(html, /id="new-password"[^>]+autocomplete="new-password"[^>]+minlength="12"/);
assert.equal((html.match(/<script\b/g) || []).length, 1);
assert.equal((html.match(/<\/script>/g) || []).length, 1);
assert.ok(!html.includes(attack));
assert.ok(!html.includes('onerror='));
assert.match(response.headers.get('cache-control'), /no-store/);
assert.match(response.headers.get('x-robots-tag'), /noindex/);
assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
const nonce = html.match(/<script nonce="([a-f0-9]{48})">/)[1];
assert.ok(html.includes(`<style nonce="${nonce}">`));
assert.ok(response.headers.get('content-security-policy').includes(`script-src 'nonce-${nonce}'`));
assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
assert.ok(!plainHtml.includes(nonce), 'nonces differ for each response');
assert.doesNotMatch(loginClientSource('/admin/'), /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|console\./);
new vm.Script(loginClientSource('/admin/'));
assert.ok(!loginClientSource('/admin/?q=</script>').includes('</script>'));

const token = 'a'.repeat(64), factor = '10000000-0000-4000-8000-000000000001', challenge = '20000000-0000-4000-8000-000000000002';
const identity = { userId: 'user', email: 'owner@example.org', displayName: '<svg onload=alert(1)>', aal: 'aal1' };
const methods = { google: true, password: true, emailOtp: true };
const signedOut = { configured: true, authenticated: false, csrfToken: token, methods };
const mfaSession = (enrolled = false) => ({ configured: true, authenticated: true, csrfToken: token, identity, mfaRequired: true, factors: enrolled ? [{ id: factor, friendlyName: '<img src=x onerror=alert(1)>', status: 'verified' }] : [] });
const verified = { authenticated: true, identity: { ...identity, aal: 'aal2' }, mfaRequired: false, returnTo: '/admin/tasks' };
const flush = async () => { for (let step = 0; step < 10; step++) await new Promise(resolve => setImmediate(resolve)); };

class Element {
  constructor(id, attributes = '') {
    this.id = id; this.attributes = {}; this.dataset = {}; this.events = {}; this.value = ''; this.hidden = /\bhidden\b/.test(attributes); this.disabled = /\bdisabled\b/.test(attributes); this.readOnly = false; this.children = []; this.textContent = ''; this.type = attributes.match(/\btype="([^"]+)"/)?.[1] || ''; this.customValidity = ''; this.focused = false;
  }
  set innerHTML(value) { throw new Error('unsafe HTML sink used: ' + value); }
  set outerHTML(value) { throw new Error('unsafe HTML sink used: ' + value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'src') delete this.src; }
  addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
  emit(name, extra = {}) { for (const handler of this.events[name] || []) handler({ preventDefault() {}, ...extra }); }
  focus() { this.focused = true; }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  reportValidity() { return !this.customValidity; }
  setCustomValidity(message) { this.customValidity = message; }
  set href(value) { this.destination = value; }
  get href() { return new URL(this.destination || '', 'https://preview.example').href; }
}

async function boot(replies, search = '', referrer = '') {
  const elements = new Map([...plainHtml.matchAll(/<[^>]*\bid="([^"]+)"([^>]*)>/g)].map(match => [match[1], new Element(match[1], match[2])]));
  elements.get('password-set-form').reportValidity = () => !elements.get('confirm-password').customValidity;
  const events = {}, requests = [], destinations = [];
  const context = {
    document: { referrer, getElementById(id) { assert.ok(elements.has(id), 'missing UI element ' + id); return elements.get(id); }, createElement(tag) { return new Element(tag); } },
    location: { origin: 'https://preview.example', search, assign(value) { destinations.push(value); } },
    navigator: { clipboard: { async writeText() {} } },
    URL, URLSearchParams, AbortController,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; },
    addEventListener(name, handler) { events[name] = handler; },
    async fetch(url, options) {
      const reply = replies.shift();
      assert.ok(reply, 'unexpected fetch ' + url);
      requests.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      return { ok: reply.status === undefined || reply.status < 400, async json() { return reply.body ?? reply; } };
    },
  };
  vm.runInNewContext(loginClientSource('/admin/tasks'), context);
  await flush();
  return { element: id => elements.get(id), requests, destinations, events, async emit(id, name = 'click', extra) { elements.get(id).emit(name, extra); await flush(); } };
}

let ui = await boot([signedOut]);
assert.equal(ui.element('signin-controls').disabled, false);
assert.equal(ui.element('signin-view').hidden, false);
assert.equal(ui.element('signin-submit').textContent, 'כניסה עם סיסמה');
await ui.emit('forgot-password');
assert.equal(ui.element('panel-password').hidden, true);
assert.equal(ui.element('panel-otp').hidden, false);
assert.equal(ui.element('password').required, false);
assert.match(ui.element('auth-status').textContent, /בלי לשנות את הסיסמה/);
await ui.emit('tab-otp', 'keydown', { key: 'Home' });
assert.equal(ui.element('panel-password').hidden, false);
await ui.emit('toggle-password');
assert.equal(ui.element('password').type, 'text');

const withoutEmailOtp = { ...signedOut, methods: { ...methods, emailOtp: false } };
ui = await boot([withoutEmailOtp, { authenticated: true, identity, mfaRequired: true }, { ...mfaSession(true), methods: withoutEmailOtp.methods }, { challengeId: challenge }, verified]);
assert.equal(ui.element('signin-controls').disabled, false);
assert.equal(ui.element('tab-password').disabled, false);
assert.equal(ui.element('google-login').disabled, false);
assert.equal(ui.element('tab-otp').disabled, true);
assert.equal(ui.element('tab-otp').attributes['aria-disabled'], 'true');
assert.equal(ui.element('forgot-password').disabled, true);
assert.equal(ui.element('forgot-password').hidden, true);
assert.equal(ui.element('email-otp-unavailable').hidden, false);
assert.equal(ui.element('signin-method-summary').textContent, 'עם Google או סיסמה.');
await ui.emit('tab-otp');
await ui.emit('forgot-password');
await ui.emit('resend-otp');
await ui.emit('tab-password', 'keydown', { key: 'End' });
assert.equal(ui.element('panel-password').hidden, false);
assert.equal(ui.element('panel-otp').hidden, true);
assert.equal(ui.requests.length, 1, 'unavailable email OTP paths cannot send requests');
ui.element('email').value = 'owner@example.org';
ui.element('password').value = 'an existing password';
await ui.emit('signin-form', 'submit');
assert.equal(ui.requests[1].url, '/api/auth/password');
assert.equal(ui.element('mfa-controls').disabled, false, 'MFA remains enabled when email OTP is unavailable');
ui.element('mfa-code').value = '123456';
await ui.emit('mfa-form', 'submit');
assert.equal(ui.destinations[0], 'https://preview.example/admin/tasks');
assert.equal(ui.requests.some(request => request.url.includes('/otp/')), false);

ui = await boot([withoutEmailOtp, { redirectUrl: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=google' }]);
await ui.emit('google-login');
assert.equal(ui.requests[1].url, '/api/auth/oauth/google');
assert.equal(ui.destinations.length, 1, 'Google remains available without email OTP');

ui = await boot([signedOut, { status: 503, body: { error: { code: 'method_unavailable' } } }]);
await ui.emit('tab-otp');
ui.element('email').value = 'owner@example.org';
await ui.emit('signin-form', 'submit');
assert.equal(ui.element('otp-entry').hidden, true, 'unavailable method never displays a sent state');
assert.equal(ui.element('tab-otp').disabled, true);
assert.equal(ui.element('panel-password').hidden, false);
assert.match(ui.element('auth-status').textContent, /עדיין בהקמה/);
await ui.emit('resend-otp');
assert.equal(ui.requests.length, 2);

ui = await boot([{ status: 503, body: { configured: false, error: { code: 'auth_unavailable', message: attack } } }]);
assert.equal(ui.element('signin-controls').disabled, true);
assert.equal(ui.element('unavailable-view').hidden, false);
assert.equal(ui.element('legacy-access').hidden, true, 'unknown legacy mode must not loop to admin');
assert.ok(!ui.element('auth-status').textContent.includes(attack));
await ui.emit('google-login');
assert.equal(ui.requests.length, 1, 'disabled/unconfigured actions make no API call');

ui = await boot([signedOut, { sent: true }, { authenticated: true, identity, mfaRequired: true }, mfaSession(true), { challengeId: challenge }, verified]);
await ui.emit('tab-otp');
ui.element('email').value = 'Owner@Example.org';
await ui.emit('signin-form', 'submit');
assert.equal(ui.element('otp-actions').hidden, false);
assert.equal(ui.element('email').readOnly, true);
assert.equal(ui.element('resend-otp').disabled, true);
assert.match(ui.element('auth-status').textContent, /אם קיים חשבון מורשה/);
assert.deepEqual(ui.requests[1].body, { email: 'owner@example.org', returnTo: '/admin/tasks' });
assert.equal(ui.requests[1].headers['x-platform-auth-csrf'], token);
ui.element('email-code').value = '12345678';
await ui.emit('signin-form', 'submit');
assert.equal(ui.requests[2].body.token, '12345678');
assert.equal(ui.element('mfa-view').hidden, false);
assert.equal(ui.element('account-name').textContent, identity.displayName, 'untrusted names stay plain text');
assert.equal(ui.element('mfa-factor').children[0].textContent, '<img src=x onerror=alert(1)>');
assert.equal(ui.destinations.length, 0, 'AAL1 cannot enter CMS');
ui.element('mfa-code').value = '123456';
await ui.emit('mfa-form', 'submit');
assert.deepEqual(ui.requests[4].body, { factorId: factor });
assert.deepEqual(ui.requests[5].body, { factorId: factor, challengeId: challenge, code: '123456', returnTo: '/admin/tasks' });
assert.equal(ui.destinations[0], 'https://preview.example/admin/tasks');
assert.equal(ui.element('mfa-code').value, '');

ui = await boot([mfaSession(), { factorId: factor, qrCode: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', secret: 'ABCDEFGHIJKLMNOP' }]);
assert.equal(ui.element('mfa-enroll').hidden, false);
assert.equal(ui.element('mfa-verify').hidden, true);
await ui.emit('mfa-enroll');
assert.equal(ui.element('mfa-setup').hidden, false);
assert.equal(ui.element('mfa-secret').textContent, 'ABCDEFGHIJKLMNOP');
assert.equal(ui.element('mfa-verify').hidden, false);
ui.events.pagehide();
assert.equal(ui.element('mfa-secret').textContent, '');

ui = await boot([signedOut, { status: 403, body: { error: { code: 'csrf_rejected', message: attack } } }, signedOut]);
ui.element('email').value = 'owner@example.org';
ui.element('password').value = 'password';
await ui.emit('signin-form', 'submit');
assert.equal(ui.element('refresh-session').hidden, false);
assert.ok(!ui.element('auth-status').textContent.includes(attack));
await ui.emit('refresh-session');
assert.equal(ui.element('signin-controls').disabled, false);
assert.equal(ui.element('password').value, '');
assert.equal(ui.element('mfa-qr').src, undefined);

ui = await boot([mfaSession(), { factorId: factor, qrCode: 'https://evil.example/collect', secret: 'ABCDEFGHIJKLMNOP' }]);
await ui.emit('mfa-enroll');
assert.equal(ui.element('mfa-setup').hidden, true, 'remote QR URLs are rejected');
assert.equal(ui.element('mfa-qr').src, undefined);

ui = await boot([signedOut, { redirectUrl: 'https://evil.example/steal?provider=google' }]);
await ui.emit('google-login');
assert.equal(ui.destinations.length, 0, 'arbitrary OAuth redirects are rejected');
ui = await boot([signedOut, { redirectUrl: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=google&x=test' }]);
await ui.emit('google-login');
assert.equal(ui.destinations.length, 1);

ui = await boot([{ configured: true, csrfToken: token, ...verified }, { passwordUpdated: true }], '?settings=password');
assert.equal(ui.element('password-view').hidden, false);
assert.equal(ui.element('password-controls').disabled, false);
assert.equal(ui.destinations.length, 0);
ui.element('new-password').value = 'A strong personal password';
ui.element('confirm-password').value = 'different';
await ui.emit('password-set-form', 'submit');
assert.equal(ui.requests.length, 1, 'mismatched confirmation is not sent');
ui.element('confirm-password').value = 'A strong personal password';
await ui.emit('confirm-password', 'input');
await ui.emit('password-set-form', 'submit');
assert.equal(ui.requests[1].url, '/api/auth/password/set');
assert.deepEqual(ui.requests[1].body, { password: 'A strong personal password' });
assert.equal(ui.element('new-password').value, '');
assert.equal(ui.element('confirm-password').value, '');
assert.match(ui.element('auth-status').textContent, /הסיסמה נשמרה/);

const authenticatedSession = { configured: true, csrfToken: token, ...verified };
ui = await boot([authenticatedSession, authenticatedSession, { signedOut: true }, signedOut, signedOut], '?logout=1', 'https://foreign.invalid/logout-link');
assert.equal(ui.requests.length, 1, 'opening a foreign logout link only reads session state');
assert.equal(ui.requests[0].method, 'GET');
assert.equal(ui.element('logout-view').hidden, false);
assert.equal(ui.element('confirm-logout').disabled, false);
assert.equal(ui.element('logout-account').textContent, identity.email);
assert.equal(ui.element('logout-cancel').href, 'https://preview.example/admin/tasks');
assert.equal(ui.destinations.length, 0);
ui.events.pageshow({ persisted: true });
await flush();
assert.equal(ui.requests.filter(request => request.method === 'POST').length, 0, 'page restore also requires intentional logout confirmation');
ui.element('confirm-logout').emit('click');
ui.element('confirm-logout').emit('click');
await flush();
assert.equal(ui.requests[2].url, '/api/auth/logout');
assert.equal(ui.requests[2].method, 'POST');
assert.equal(ui.requests[2].headers['x-platform-auth-csrf'], token);
assert.deepEqual(ui.requests[2].body, {});
assert.equal(ui.element('signin-view').hidden, false);
assert.equal(ui.element('logout-view').hidden, true);
assert.equal(ui.element('success-view').hidden, true);
assert.equal(ui.destinations.length, 0, 'explicit logout never redirects back into CMS');
assert.match(ui.element('auth-status').textContent, /התנתקת מהחשבון/);
await ui.emit('confirm-logout');
ui.events.pageshow({ persisted: true });
await flush();
assert.equal(ui.requests.filter(request => request.url === '/api/auth/logout').length, 1, 'double-clicks, repeated confirmation and restoring this page do not repeat logout');

ui = await boot([signedOut], '?logout=1', 'https://foreign.invalid/logout-link');
assert.equal(ui.requests.length, 1, 'a signed-out visitor never sends a logout POST');
assert.equal(ui.element('signin-view').hidden, false);
assert.equal(ui.element('logout-view').hidden, true);

ui = await boot([mfaSession(true), { signedOut: true }, signedOut]);
await ui.emit('logout');
assert.equal(ui.requests[1].url, '/api/auth/logout');
assert.equal(ui.element('signin-view').hidden, false);
assert.equal(ui.element('mfa-secret').textContent, '');

console.log('PASS login UI: Hebrew RTL/original branding, unique nonce CSP/noindex/no-store, safe destinations and DOM, syntax, password/email OTP8, TOTP6 enrollment/challenge/verification, unavailable/retry/logout, OAuth redirect restriction, AAL2-only password setting and secret cleanup.');
