/** Offline contract tests: real adapter SQL plus injected managed authority.
 * No provider accounts, live email, login, or external mutation is involved. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'platform-auth-contract-'));
const bundle = await build({ stdin: { contents: `export * from './lib/platform-auth-core';export * from './lib/platform-auth-service';export * from './lib/platform-auth-rate';export * from './lib/platform-auth-provider';`, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
const compiled = join(temporary, 'contract.mjs');
writeFileSync(compiled, bundle.outputFiles[0].text);
const auth = await import(pathToFileURL(compiled).href);
const { AUTH_COOKIE, CSRF_COOKIE, FLOW_COOKIE, PlatformAuthError, PlatformCookieJar, platformAuthConfig, verifiedPlatformIdentity, handlePlatformAuth, readVerifiedPlatformIdentity, platformAuthRateLimiter, createManagedPlatformProvider } = auth;
const config = { url: auth.PLATFORM_AUTH_PROJECT_URL, publishableKey: 'sb_publishable_synthetic_fixture_only', origin: 'https://admin.example.invalid', emailOtpReady: true };
const now = Date.now(), subject = '3153386f-40e0-4949-aab5-ce4e4858d644', factorId = 'bba3b819-ab9d-4b26-9036-b1ad999d2b34', challengeId = '4da3cf8d-4918-4aca-902a-12f65e1bb77f';
const csrf = 'c'.repeat(64);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims = {}, header = {}) => `${encode({ alg: 'ES256', typ: 'JWT', ...header })}.${encode({ iss: config.url + '/auth/v1', aud: 'authenticated', sub: subject, email: 'allowed@example.invalid', iat: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 600, aal: 'aal2', ...claims })}.c2lnbmF0dXJl`;
const user = { id: subject, email: 'allowed@example.invalid', email_confirmed_at: new Date(now - 60000).toISOString(), user_metadata: { full_name: 'Verified Provider User' } };
const errorIs = (status, code) => error => error instanceof PlatformAuthError && error.status === status && error.code === code;
function fixture(overrides = {}) {
  const state = { authenticated: false, aal: 'aal1', events: [], ...overrides };
  const factory = (_config, jar) => ({
    async getSession() { state.events.push('session'); return { data: { session: state.authenticated ? { access_token: state.jwt ?? token({ aal: state.aal }) } : null }, error: null }; },
    async getUser(jwt) { state.events.push(['user', jwt]); return { data: { user: state.user ?? user }, error: state.forged ? { code: 'bad_jwt' } : null }; },
    async signInWithPassword(input) { state.events.push(['password', input]); if (state.badPassword) return { error: new Error('redact provider detail') }; state.authenticated = true; jar.set(AUTH_COOKIE, 'server-transport-only'); return { error: null }; },
    async updateUser(input) { state.events.push(['updateUser', input]); return { error: state.badUpdate ? new Error('provider policy detail') : null }; },
    async signInWithOtp(input) { state.events.push(['otp-send', input]); return { error: state.unknownAccount ? new Error('account missing') : null }; },
    async verifyOtp(input) { state.events.push(['otp-verify', input]); if (state.badOtp) return { error: new Error('expired') }; state.authenticated = true; jar.set(AUTH_COOKIE, 'server-transport-only'); return { error: null }; },
    async signInWithOAuth(input) {
      state.events.push(['oauth', input]); jar.set(AUTH_COOKIE + '-code-verifier', JSON.stringify('verifier-fixture'));
      const target = new URL('/auth/v1/authorize', config.url); target.searchParams.set('provider', 'google'); target.searchParams.set('redirect_to', input.options.redirectTo); target.searchParams.set('code_challenge_method', 's256'); target.searchParams.set('code_challenge', 'c'.repeat(43));
      return { data: { url: state.badOAuthUrl ?? target.href }, error: null };
    },
    async exchangeCodeForSession(code) { state.events.push(['exchange', code]); if (state.codeUsed) return { error: new Error('single use') }; state.codeUsed = true; state.authenticated = true; jar.set(AUTH_COOKIE, 'oauth-server-transport'); return { error: null }; },
    async signOut(input) { state.events.push(['signOut', input]); state.authenticated = false; return { error: null }; },
    mfa: {
      async listFactors() { return { data: { all: state.factors ?? [{ id: factorId, factor_type: 'totp', status: 'verified', friendly_name: 'Platform CMS' }] }, error: null }; },
      async enroll(input) { state.events.push(['enroll', input]); state.factors = [{ id: factorId, factor_type: 'totp', status: 'unverified', friendly_name: 'Platform CMS' }]; return { data: { id: factorId, totp: { qr_code: 'data:image/svg+xml;utf-8,%3Csvg%2F%3E', secret: 'SYNTHETICSECRET', uri: 'otpauth://totp/fixture?secret=SYNTHETICSECRET' } }, error: null }; },
      async unenroll(input) { state.events.push(['unenroll', input]); return { error: null }; },
      async challenge(input) { state.events.push(['challenge', input]); return { data: { id: challengeId }, error: null }; },
      async verify(input) { state.events.push(['verify', input]); if (state.badMfa || state.mfaUsed) return { error: new Error('expired or reused') }; state.mfaUsed = true; state.aal = 'aal2'; jar.set(AUTH_COOKIE, 'mfa-upgraded-transport'); return { error: null }; },
    },
  });
  return { state, factory };
}
function cookies(response, old = new Map()) {
  for (const header of response.headers.getSetCookie()) {
    const [item] = header.split(';'), index = item.indexOf('='), name = item.slice(0, index), value = item.slice(index + 1);
    if (/Max-Age=0(?:;|$)/.test(header)) old.delete(name); else old.set(name, value);
  }
  return old;
}
const cookieHeader = jar => [...jar].map(([name, value]) => name + '=' + value).join('; ');
function post(action, input, headers = {}) {
  return new Request(config.origin + '/api/auth/' + action + '/', { method: 'POST', headers: { origin: config.origin, 'sec-fetch-site': 'same-origin', cookie: `${CSRF_COOKIE}=${csrf}`, 'x-platform-auth-csrf': csrf, 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
}
const run = (request, f, limiter = async () => {}) => handlePlatformAuth(request, { config, providerFactory: f.factory, limiter, now: () => now });

try {
  const validBindings = { PLATFORM_AUTH_SUPABASE_URL: config.url, PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, PLATFORM_AUTH_ORIGIN: config.origin };
  assert.deepEqual(platformAuthConfig({ ...validBindings, PLATFORM_AUTH_EMAIL_OTP_READY: 'true' }), config);
  for(const readiness of [undefined, false, true, 'false', 'TRUE', '']) assert.equal(platformAuthConfig({ ...validBindings, PLATFORM_AUTH_EMAIL_OTP_READY: readiness }).emailOtpReady, false, 'email OTP remains unavailable without exact explicit deployment readiness');
  for (const invalid of [
    { PLATFORM_AUTH_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' },
    { PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.service_role' },
    { PLATFORM_AUTH_ORIGIN: 'http://admin.example.invalid' },
    { PLATFORM_AUTH_ORIGIN: config.origin + '/' },
  ]) assert.throws(() => platformAuthConfig({ PLATFORM_AUTH_SUPABASE_URL: config.url, PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, PLATFORM_AUTH_ORIGIN: config.origin, ...invalid }), errorIs(503, 'auth_unavailable'));
  for (const value of ['https://attacker.invalid/admin/', '//attacker.invalid/admin/', '/admin/../../login/', '/admin/%2f%2fattacker.invalid', '/admin/\\evil', '/admin/%0d%0aheader', '/adminish/', '/login/']) assert.throws(() => auth.safeAuthReturnTo(value), errorIs(400, 'invalid_request'));
  assert.equal(auth.safeAuthReturnTo('/admin/content/?tab=draft#discard'), '/admin/content/?tab=draft');
  assert.throws(() => new PlatformCookieJar(`${AUTH_COOKIE}=one; ${AUTH_COOKIE}=two`), errorIs(400, 'invalid_request'));

  // A getSession object (or spoofed HTTP identity header) supplies no authority.
  const trusted = fixture({ authenticated: true, aal: 'aal2' });
  assert.equal((await verifiedPlatformIdentity(trusted.factory(config, new PlatformCookieJar(null)), config, true, now)).userId, subject);
  assert.equal(trusted.state.events.filter(event => Array.isArray(event) && event[0] === 'user').length, 1);
  const claimCases = [
    { iss: 'https://attacker.invalid/auth/v1' }, { aud: 'service_role' }, { sub: factorId }, { email: 'attacker@example.invalid' },
    { exp: now / 1000 - 1 }, { exp: Infinity }, { iat: now / 1000 + 120 }, { nbf: now / 1000 + 10 }, { aal: 'invalid' },
  ];
  for (const claims of claimCases) {
    const f = fixture({ authenticated: true, jwt: token(claims) });
    await assert.rejects(() => verifiedPlatformIdentity(f.factory(config, new PlatformCookieJar(null)), config, false, now), errorIs(401, 'unauthenticated'));
  }
  for (const changes of [{ email_confirmed_at: undefined }, { is_anonymous: true }, { email: 'bad' }, { id: 'not-a-subject' }]) {
    const f = fixture({ authenticated: true, user: { ...user, ...changes } });
    await assert.rejects(() => verifiedPlatformIdentity(f.factory(config, new PlatformCookieJar(null)), config, false, now), errorIs(401, 'unauthenticated'));
  }
  for (const changes of [{ forged: true }, { jwt: token({}, { alg: 'none' }) }, { jwt: 'malformed.token' }]) {
    const f = fixture({ authenticated: true, ...changes });
    await assert.rejects(() => verifiedPlatformIdentity(f.factory(config, new PlatformCookieJar(null)), config, false, now), errorIs(401, 'unauthenticated'));
  }
  const aal1 = fixture({ authenticated: true });
  await assert.rejects(() => readVerifiedPlatformIdentity(new Request(config.origin + '/admin/'), config, aal1.factory), errorIs(403, 'mfa_required'));
  const refreshed = (_config, jar) => { jar.set(AUTH_COOKIE, 'rotated-before-mfa-check'); return aal1.factory(config, jar); };
  await assert.rejects(() => readVerifiedPlatformIdentity(new Request(config.origin + '/admin/'), config, refreshed), error => errorIs(403, 'mfa_required')(error) && error.cookiesToSet.some(value => value.includes('rotated-before-mfa-check')));

  const loggedOut = fixture();
  let response = await run(new Request(config.origin + '/api/auth/session/', { headers: { 'x-platform-authenticated-id': subject, 'oai-authenticated-user-email': user.email } }), loggedOut);
  const session = await response.json();
  assert.equal(session.authenticated, false); assert.match(session.csrfToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(session.methods, { google: true, password: true, emailOtp: true });
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  for (const value of response.headers.getSetCookie()) { assert.match(value, /; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/); assert.ok(!value.includes('Domain=')); }
  for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: '' }, { 'x-platform-auth-csrf': '' }, { 'x-platform-auth-csrf': 'd'.repeat(64) }, { 'sec-fetch-site': 'cross-site' }]) {
    const f = fixture(); response = await run(post('password', { email: user.email, password: 'secret' }, headers), f);
    assert.equal(response.status, 403); assert.equal(f.state.events.length, 0, 'CSRF rejection occurs before managed auth');
  }
  response = await run(post('password', { email: user.email, password: 'secret' }, { 'content-type': 'text/plain' }), fixture()); assert.equal(response.status, 400);
  response = await run(post('password', { email: user.email, password: 'secret', unexpected: true }), fixture()); assert.equal(response.status, 400);
  response = await run(post('password', { email: user.email, password: 'x'.repeat(9000) }), fixture()); assert.equal(response.status, 413);
  const limited = fixture(); response = await run(post('password', { email: user.email, password: 'secret' }), limited, async () => { throw new PlatformAuthError(429, 'rate_limited'); }); assert.equal(response.status, 429); assert.equal(limited.state.events.length, 0);

  const password = fixture(); response = await run(post('password', { email: ' Allowed@Example.invalid ', password: 'secret', returnTo: '/admin/content/' }), password);
  const signedIn = await response.json(); assert.equal(response.status, 200); assert.equal(signedIn.identity.aal, 'aal1'); assert.equal(signedIn.mfaRequired, true); assert.equal(signedIn.returnTo, '/admin/content/'); assert.ok(!JSON.stringify(signedIn).includes('access_token'));
  response = await run(post('password', { email: user.email, password: 'secret' }), fixture({ badPassword: true })); assert.equal(response.status, 401); assert.ok(!JSON.stringify(await response.json()).includes('redact provider detail'));
  const otp = fixture({ unknownAccount: true }); response = await run(post('otp/send', { email: user.email, returnTo: '/admin/' }), otp); assert.equal(response.status, 202); assert.deepEqual(await response.json(), { sent: true }); assert.deepEqual(otp.state.events[0][1], { email: user.email, options: { shouldCreateUser: false } });
  const unavailableOtp = fixture(), disabledConfig = { ...config, emailOtpReady: false };let unavailableProviderCalls = 0, unavailableRateCalls = 0;
  const disabledOptions = { config: disabledConfig, providerFactory: (...args) => { unavailableProviderCalls++;return unavailableOtp.factory(...args); }, limiter: async () => { unavailableRateCalls++; }, now: () => now };
  for(const action of ['otp/send', 'otp/verify']) {
    response = await handlePlatformAuth(post(action, { email: user.email, ...(action==='otp/verify'?{token:'12345678'}:{}) }), disabledOptions);
    assert.equal(response.status, 503);const result = await response.json();assert.equal(result.error.code, 'method_unavailable');assert.equal(result.error.message, 'כניסה בקוד במייל תהיה זמינה לאחר חיבור דומיין המערכת');assert.equal(result.sent, undefined);
  }
  assert.equal(unavailableProviderCalls, 0, 'disabled OTP cannot construct a provider or send mail');assert.equal(unavailableRateCalls, 0, 'disabled OTP fails before actor/IP rate buckets');assert.equal(unavailableOtp.state.events.length, 0);
  response = await handlePlatformAuth(new Request(config.origin + '/api/auth/session/'), disabledOptions);assert.deepEqual((await response.json()).methods, { google: true, password: true, emailOtp: false });
  response = await run(post('otp/send', { email: user.email, returnTo: 'https://attacker.invalid' }), otp); assert.equal(response.status, 400);
  response = await run(post('otp/verify', { email: user.email, token: '123456' }), fixture()); assert.equal(response.status, 400, 'email OTP length follows the configured managed project');
  response = await run(post('otp/verify', { email: user.email, token: '12345678' }), fixture()); assert.equal(response.status, 200);
  response = await run(post('otp/verify', { email: user.email, token: '12345678' }), fixture({ badOtp: true })); assert.equal(response.status, 401);

  const google = fixture(); response = await run(post('oauth/google', { returnTo: '/admin/content/' }), google);
  assert.equal(response.status, 200); const redirect = new URL((await response.json()).redirectUrl), callback = new URL(redirect.searchParams.get('redirect_to'));
  assert.equal(redirect.origin, config.url); assert.equal(redirect.searchParams.get('code_challenge_method'), 's256'); assert.match(callback.searchParams.get('state'), /^[a-f0-9]{64}$/);
  const flowCookies = cookies(response); assert.match(response.headers.getSetCookie().find(value => value.startsWith(FLOW_COOKIE + '=')), /Max-Age=600/);
  const callbackRequest = (state = callback.searchParams.get('state'), jar = flowCookies, suffix = '') => new Request(config.origin + '/auth/callback/?code=single-use-code&state=' + state + suffix, { headers: { cookie: cookieHeader(jar) } });
  const beforeExchanges = google.state.events.filter(event => event[0] === 'exchange').length;
  for (const request of [callbackRequest('d'.repeat(64)), callbackRequest(undefined, new Map()), callbackRequest(undefined, flowCookies, '&state=' + callback.searchParams.get('state'))]) { response = await run(request, google); assert.equal(response.status, 401); }
  assert.equal(google.state.events.filter(event => event[0] === 'exchange').length, beforeExchanges, 'bad callbacks cannot consume a code');
  const oldState = new Map(flowCookies); oldState.set(FLOW_COOKIE, encodeURIComponent(JSON.stringify({ state: callback.searchParams.get('state'), returnTo: '/admin/', at: now - 600001 })));
  response = await run(callbackRequest(undefined, oldState), google); assert.equal(response.status, 401);
  response = await run(callbackRequest(), google); assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/login/?mfa=required&next=%2Fadmin%2Fcontent%2F');
  const consumed = cookies(response, new Map(flowCookies)); assert.ok(!consumed.has(FLOW_COOKIE)); assert.ok(![...consumed.keys()].some(name => name.includes('code-verifier')));
  response = await run(callbackRequest(undefined, consumed), google); assert.equal(response.status, 401);
  response = await run(callbackRequest(), google); assert.equal(response.status, 401, 'managed authorization code is single-use');
  response = await run(post('oauth/google', {}), fixture({ badOAuthUrl: 'https://attacker.invalid' })); assert.equal(response.status, 503);

  const mfa = fixture({ authenticated: true, factors: [] });
  response = await run(post('mfa/enroll', {}), mfa); assert.equal(response.status, 200); const enrollment = await response.json(); assert.equal(enrollment.factorId, factorId); assert.match(enrollment.qrCode, /^data:image\/svg\+xml/);
  response = await run(post('mfa/challenge', { factorId: subject }), mfa); assert.equal(response.status, 400, 'foreign factor cannot be challenged');
  response = await run(post('mfa/challenge', { factorId }), mfa); assert.equal(response.status, 200); assert.equal((await response.json()).challengeId, challengeId);
  response = await run(post('mfa/verify', { factorId, challengeId, code: '123456', returnTo: '/admin/' }), mfa); assert.equal(response.status, 200); assert.equal((await response.json()).identity.aal, 'aal2');
  response = await run(post('mfa/verify', { factorId, challengeId, code: '123456' }), mfa); assert.equal(response.status, 401, 'provider rejects reused TOTP/challenge');
  response = await run(post('password/set', { password: 'long password owned by user' }), fixture({ authenticated: true })); assert.equal(response.status, 403, 'password settings require MFA');
  const setting = fixture({ authenticated: true, aal: 'aal2' }); response = await run(post('password/set', { password: 'long password owned by user' }), setting); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { passwordUpdated: true }); assert.ok(setting.state.events.some(event => event[0] === 'updateUser'));
  response = await run(post('password/set', { password: 'short' }), setting); assert.equal(response.status, 400);
  response = await run(post('logout', {}, { cookie: `${CSRF_COOKIE}=${csrf}; ${AUTH_COOKIE}=a; ${AUTH_COOKIE}.0=b` }), setting); assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().filter(value => /Max-Age=0/.test(value)).length, 2); assert.deepEqual(setting.state.events.find(event => event[0] === 'signOut')[1], { scope: 'local' });

  // Real INSERT ... ON CONFLICT ... RETURNING on SQLite, called concurrently:
  // neither IP nor account limits depend on an unsafe read-then-write counter.
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE platform_auth_rate_limits(bucket_key TEXT PRIMARY KEY,window_start INTEGER,attempts INTEGER,expires_at INTEGER)');
  const db = { prepare(sql) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { return sqlite.prepare(sql).get(...this.args) ?? null; }, async run() { const result = sqlite.prepare(sql).run(...this.args); return { success: true, meta: { changes: Number(result.changes) } }; } }; } };
  let rateTime = now; const rate = platformAuthRateLimiter(db, () => rateTime);
  const rateRequest = index => new Request(config.origin + '/api/auth/password/', { headers: { 'cf-connecting-ip': '192.0.2.' + index } });
  const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => rate(rateRequest(index + 1), 'password', user.email)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 5, 'shared account counter is atomic across IPs');
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.code === 'rate_limited').length, 15);
  const rows = sqlite.prepare('SELECT * FROM platform_auth_rate_limits').all(); assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.bucket_key))); assert.ok(!JSON.stringify(rows).includes(user.email)); assert.ok(!JSON.stringify(rows).includes('192.0.2'));
  rateTime += 601000; await rate(rateRequest(1), 'password', user.email);
  const ipOutcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => rate(rateRequest(99), 'password', `other${index}@example.invalid`)));
  assert.equal(ipOutcomes.filter(result => result.status === 'fulfilled').length, 15, 'IP limit spans distinct accounts');
  // Expired counter retention is bounded per ingress operation; active windows
  // survive and a read-only session check performs no cleanup work.
  const seconds = Math.floor(rateTime / 1000), insertCounter = sqlite.prepare('INSERT INTO platform_auth_rate_limits VALUES(?,?,?,?)');
  for(let index = 0; index < 207; index++) insertCounter.run((index + 1000).toString(16).padStart(64, '0'), seconds - 1000, 1, seconds - 1);
  const retainedKey = '9'.repeat(64); insertCounter.run(retainedKey, seconds, 4, seconds + 600);
  const expiredCount = () => Number(sqlite.prepare('SELECT count(*) AS count FROM platform_auth_rate_limits WHERE expires_at < ?').get(seconds).count);
  const expiredBefore = expiredCount(); await rate(rateRequest(100), 'session'); assert.equal(expiredCount(), expiredBefore, 'session reads skip expired-counter cleanup');
  await rate(rateRequest(100), 'request/password'); assert.equal(expiredCount(), expiredBefore - 100, 'exactly one bounded cleanup deletes at most100 expired rows');
  assert.equal(sqlite.prepare('SELECT attempts FROM platform_auth_rate_limits WHERE bucket_key = ?').get(retainedKey).attempts, 4, 'active account windows survive cleanup');
  await rate(rateRequest(100), 'password', 'cleanup@example.invalid'); assert.equal(expiredCount(), expiredBefore - 100, 'later account increments do not repeat ingress cleanup');
  await rate(rateRequest(100), 'oauth-callback'); assert.equal(expiredCount(), expiredBefore - 200, 'callbacks also collect a bounded batch');
  let cleanupCounterWrites = 0;
  const cleanupFailure = { prepare(sql) { return { bind() { return this; }, async run() { return { success: false }; }, async first() { cleanupCounterWrites++; return { attempts: 1 }; } }; } };
  await assert.rejects(() => platformAuthRateLimiter(cleanupFailure)(rateRequest(1), 'request/password'), errorIs(503, 'auth_unavailable')); assert.equal(cleanupCounterWrites, 0, 'cleanup storage errors fail closed before increment/provider');
  await assert.rejects(() => platformAuthRateLimiter(undefined)(rateRequest(1), 'password'), errorIs(503, 'auth_unavailable')); sqlite.close();

  // The actual installed SSR provider is exercised with in-process fetch only.
  // It sends only to the fixed managed authority and never trusts cookie.user.
  const originalFetch = globalThis.fetch; const requests = [];
  try {
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init }); assert.equal(new URL(input).origin, config.url); assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
      if (new URL(input).pathname === '/auth/v1/user') {
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + token());
        return Response.json(user);
      }
      throw new Error('unexpected local transport request');
    };
    const transport = new PlatformCookieJar(null); transport.set(AUTH_COOKIE, JSON.stringify({ access_token: token(), refresh_token: 'synthetic-refresh', expires_at: Math.floor(now / 1000) + 600, expires_in: 600, token_type: 'bearer', user: { ...user, email: 'forged@cookie.invalid' } }));
    const result = await verifiedPlatformIdentity(createManagedPlatformProvider(config, transport), config, true, now); assert.equal(result.email, user.email); assert.ok(requests.length >= 1);
    const isolated = createManagedPlatformProvider(config, new PlatformCookieJar(null)); await assert.rejects(() => verifiedPlatformIdentity(isolated, config, true, now), errorIs(401, 'unauthenticated'));
    const oauthJar = new PlatformCookieJar(null), actualGoogle = await createManagedPlatformProvider(config, oauthJar).signInWithOAuth({ provider: 'google', options: { redirectTo: config.origin + '/auth/callback/?state=' + csrf, skipBrowserRedirect: true } });
    assert.equal(actualGoogle.error, null); assert.equal(new URL(actualGoogle.data.url).searchParams.get('code_challenge_method'), 's256'); assert.ok(oauthJar.hasVerifier());
    assert.ok(oauthJar.pending().every(value => value.includes('HttpOnly') && value.includes('Secure') && !value.includes('Domain=')));
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS shared managed auth: verified identity/claims/AAL2, CSRF/cookies, password+8-digit OTP+Google PKCE+single-use callback, owned MFA/password settings, atomic hashed D1 rate limits, request-isolated installed SSR adapter; entirely offline.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
