// Prepared receiver only: no schedule, provider token, notification or sender.
const ORIGIN = 'https://derech-vps-heartbeat.22yarden22.workers.dev';
const KEY = 'monitor/derech/vps/heartbeat-v1.json';
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const reply = (status, value) => new Response(JSON.stringify(value), {status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
}});
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const secretValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function signature(secret, method, path, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${method}\n${path}\n${timestamp}\n${digest}`)));
}

export async function handle(request, env, now = Math.floor(Date.now() / 1000)) {
  try {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || url.search || !['/heartbeat', '/status'].includes(url.pathname)) return reply(404, {code: 'not_found'});
    if (!Number.isSafeInteger(now) || !secretValid(env.HEARTBEAT_WRITE_HMAC) || !secretValid(env.HEARTBEAT_READ_HMAC)
      || env.HEARTBEAT_WRITE_HMAC === env.HEARTBEAT_READ_HMAC || !env.HEARTBEAT_BUCKET) return reply(503, {code: 'unavailable'});
    if (request.method !== (url.pathname === '/heartbeat' ? 'POST' : 'GET')) return reply(405, {code: 'method_rejected'});
    const at = request.headers.get('X-Derech-Heartbeat-Time');
    const signed = request.headers.get('X-Derech-Heartbeat-Signature');
    if (!/^\d{10}$/.test(at || '') || Math.abs(Number(at) - now) > 60 || !/^[a-f0-9]{64}$/.test(signed || '')) return reply(401, {code: 'unauthorized'});
    // Bound streaming reads, including a missing or dishonest Content-Length.
    const chunks = []; let size = 0;
    if (request.body) {
      const reader = request.body.getReader();
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2048) { await reader.cancel(); return reply(413, {code: 'too_large'}); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const purpose = url.pathname === '/heartbeat' ? env.HEARTBEAT_WRITE_HMAC : env.HEARTBEAT_READ_HMAC;
    // Compare using native HMAC verification, without logging any input.
    const verifyKey = await crypto.subtle.importKey('raw', encoder.encode(purpose), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
    const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
    const message = encoder.encode(`${request.method}\n${url.pathname}\n${at}\n${digest}`);
    const sigBytes = Uint8Array.from(signed.match(/../g), x => parseInt(x, 16));
    if (!await crypto.subtle.verify('HMAC', verifyKey, sigBytes, message)) return reply(401, {code: 'unauthorized'});
    if (url.pathname === '/status' && body) return reply(400, {code: 'invalid_request'});
    const previous = await env.HEARTBEAT_BUCKET.get(KEY);
    const prior = previous ? await previous.json() : null;
    if (url.pathname === '/status') {
      if (!prior) return reply(503, {code: 'not_initialized'});
      return reply(200, {schema: 'derech-vps-heartbeat/v1', checkedAt: now, heartbeat: prior});
    }
    const value = JSON.parse(body);
    if (!exact(value, ['schema', 'observedAt', 'ready']) || value.schema !== 'derech-vps-heartbeat/v1'
      || !Number.isSafeInteger(value.observedAt) || value.observedAt !== Number(at) || typeof value.ready !== 'boolean') return reply(400, {code: 'invalid_request'});
    if (prior && (prior.observedAt >= value.observedAt || prior.receivedAt > now)) return reply(409, {code: 'replay_rejected'});
    const receipt = {schema: value.schema, observedAt: value.observedAt, receivedAt: now, ready: value.ready};
    const saved = await env.HEARTBEAT_BUCKET.put(KEY, JSON.stringify(receipt), {
      onlyIf: previous ? {etagMatches: previous.etag} : {etagDoesNotMatch: '*'},
      httpMetadata: {contentType: 'application/json'},
    });
    if (!saved) return reply(409, {code: 'concurrent_update'});
    return reply(200, {accepted: true, observedAt: value.observedAt, receivedAt: now});
  } catch {
    return reply(503, {code: 'unavailable'});
  }
}

export default {fetch(request, env) { return handle(request, env); }};
