import importlib.util
from pathlib import Path
import shutil
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('vps_policy', Path(__file__).with_name('site-review-vps-policy.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def response(now, at=1000, ready=True):
    return {'schema': 'derech-vps-heartbeat/v1', 'checkedAt': now, 'heartbeat': {
        'schema': 'derech-vps-heartbeat/v1', 'observedAt': at, 'receivedAt': at, 'ready': ready}}


class ExternalVpsPolicyTests(unittest.TestCase):
    def step(self, state, now, *, at=1000, ready=True, allowed=True):
        return m.transition(state, response(now, at, ready), now=now, allowed=allowed)

    def opened(self):
        state = None
        for now in [2000, 2450, 2900]:
            state, result = self.step(state, now)
        self.assertEqual(result['state'], 'opening_candidate')
        return state

    def test_three_distinct_observations_and_fifteen_minutes_both_required(self):
        state, result = self.step(None, 2000)
        for now in [2001, 2002, 2600]:
            state, result = self.step(state, now)
            self.assertEqual(result['state'], 'observing')
        state, result = self.step(state, 2900)
        self.assertEqual(result['state'], 'opening_candidate')
        state, result = self.step(state, 3000)
        self.assertIsNone(result['event'])
        with self.assertRaisesRegex(ValueError, 'clock_invalid'):
            self.step(state, 3000)

    def test_gaps_and_unverified_transport_reset_persistence(self):
        state, _ = self.step(None, 2000)
        state, _ = self.step(state, 2450)
        state, result = self.step(state, 3300)
        self.assertEqual(state['failures'], [3300])
        state, result = m.transition(state, None, now=3400, allowed=True)
        self.assertEqual(result['state'], 'internal_only')
        self.assertEqual(state['failures'], [])

    def test_sacred_time_fails_closed_without_advancing_state(self):
        state, _ = self.step(None, 2000)
        for gate in [False, None, 1, 'true']:
            after, result = self.step(state, 2450, allowed=gate)
            self.assertEqual(after, state)
            self.assertEqual(result['state'], 'held')

    def test_provider_read_freshness_and_clock_and_scope(self):
        for now in [float('nan'), float('inf'), True]:
            with self.assertRaises(ValueError): self.step(None, now)
        for r in [response(1000), response(2001), {'email': 'secret-canary@example.invalid'}]:
            with self.assertRaises(ValueError) as raised:
                m.transition(None, r, now=2000, allowed=True)
            self.assertNotIn('secret-canary', str(raised.exception))
        state, _ = self.step(None, 2000)
        state['scope'] = 'other-tenant'
        with self.assertRaisesRegex(ValueError, 'scope_invalid'): self.step(state, 2450)

    def test_foreign_or_regressed_heartbeat_is_rejected(self):
        state, _ = self.step(None, 2000)
        with self.assertRaisesRegex(ValueError, 'heartbeat_regressed'): self.step(state, 2450, at=999)
        r = response(2450); r['heartbeat']['receivedAt'] = 2200
        with self.assertRaisesRegex(ValueError, 'heartbeat_invalid'):
            m.transition(state, r, now=2450, allowed=True)

    def test_recovery_requires_fresh_health_then_owner_ack_not_issue_creation(self):
        state = self.opened(); incident_id = state['incident']['id']
        receipt = {'incidentId': incident_id, 'ownerAcknowledged': True}
        with self.assertRaises(ValueError):
            m.acknowledge_recovery(state, incident_id=incident_id, opening_receipt=receipt, now=3000, allowed=True)
        state, result = self.step(state, 3000, at=3000)
        self.assertEqual(result['state'], 'recovery_candidate')
        self.assertIsNone(result['event'])
        for receipt_bad in [{'issueNumber': 1}, {'incidentId': incident_id, 'ownerAcknowledged': 1}]:
            with self.assertRaises(ValueError):
                m.acknowledge_recovery(state, incident_id=incident_id, opening_receipt=receipt_bad, now=3000, allowed=True)
        for now, allowed in [(3000, False), (3091, True)]:
            with self.assertRaises(ValueError):
                m.acknowledge_recovery(state, incident_id=incident_id, opening_receipt=receipt, now=now, allowed=allowed)
        recovered = m.acknowledge_recovery(state, incident_id=incident_id, opening_receipt=receipt, now=3000, allowed=True)
        self.assertIsNone(recovered['incident'])
        with self.assertRaises(ValueError):
            m.acknowledge_recovery(recovered, incident_id=incident_id, opening_receipt=receipt, now=3001, allowed=True)

    def test_new_failure_cancels_prior_healthy_candidate(self):
        state = self.opened()
        state, _ = self.step(state, 3000, at=3000)
        state, _ = self.step(state, 3100, at=3100, ready=False)
        self.assertNotIn('healthyAt', state['incident'])


class HeartbeatReceiverProtocolTests(unittest.TestCase):
    def test_workerd_real_r2_conditional_write_and_default_fetch_entry(self):
        root = Path(__file__).resolve().parents[1]
        package = root / 'platform-cms/node_modules/miniflare/dist/src/index.js'
        node = shutil.which('node') or '/private/tmp/derech-npm-runtime/bin/node'
        if not package.exists() or not Path(node).exists():
            self.skipTest('Workerd fixture requires installed platform-cms Miniflare and Node')
        worker = Path(__file__).with_name('site-review-vps-heartbeat-worker.mjs')
        script = r'''
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ??= webcrypto;
const {Miniflare} = await import(process.argv[1]);
const {signature} = await import(process.argv[2]);
const ORIGIN = 'https://derech-vps-heartbeat.22yarden22.workers.dev';
const mf = new Miniflare({modules:true, scriptPath:new URL(process.argv[2]).pathname,
  compatibilityDate:'2026-05-15', bindings:{HEARTBEAT_WRITE_HMAC:'a'.repeat(64),HEARTBEAT_READ_HMAC:'b'.repeat(64)},
  r2Buckets:['HEARTBEAT_BUCKET']});
try {
  const at = Math.floor(Date.now()/1000);
  const body = JSON.stringify({schema:'derech-vps-heartbeat/v1',observedAt:at,ready:true});
  const writeHeaders = {'X-Derech-Heartbeat-Time':String(at),'X-Derech-Heartbeat-Signature':await signature('a'.repeat(64),'POST','/heartbeat',String(at),body)};
  let r = await mf.dispatchFetch(ORIGIN+'/heartbeat',{method:'POST',body,headers:writeHeaders});
  assert.equal(r.status,200); assert.equal((await r.json()).accepted,true);
  r = await mf.dispatchFetch(ORIGIN+'/heartbeat',{method:'POST',body,headers:writeHeaders});
  assert.equal(r.status,409);
  const headers = {'X-Derech-Heartbeat-Time':String(at),'X-Derech-Heartbeat-Signature':await signature('b'.repeat(64),'GET','/status',String(at),'')};
  r = await mf.dispatchFetch(ORIGIN+'/status',{headers});
  assert.equal(r.status,200); assert.equal((await r.json()).heartbeat.observedAt,at);
  console.log('Workerd and actual R2 conditional write fixture passed');
} finally { await mf.dispose(); }
'''
        result = subprocess.run([node, '--input-type=module', '-e', script, package.as_uri(), worker.as_uri()], capture_output=True, text=True, timeout=30, cwd=root)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_real_webcrypto_request_stream_hmac_and_atomic_store(self):
        node = shutil.which('node')
        if node is None:
            local = Path('/private/tmp/derech-npm-runtime/bin/node')
            if local.exists(): node = str(local)
        if node is None: self.skipTest('Node runtime required for Worker protocol fixture')
        source = Path(__file__).with_name('site-review-vps-heartbeat-worker.mjs').as_uri()
        script = r'''
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ??= webcrypto;
const {handle, signature} = await import(process.argv[1]);
const ORIGIN = 'https://derech-vps-heartbeat.22yarden22.workers.dev';
const KEY = 'monitor/derech/vps/heartbeat-v1.json';
const now = 1792522800; let stored = null, etag = 0, calls = 0, conflict = false;
const env = {HEARTBEAT_WRITE_HMAC: 'a'.repeat(64), HEARTBEAT_READ_HMAC: 'b'.repeat(64), HEARTBEAT_BUCKET: {
  async get(key) { assert.equal(key, KEY); calls++; return stored ? {etag: String(etag), json: async () => structuredClone(stored)} : null; },
  async put(key, value, options) {
    assert.equal(key, KEY); calls++;
    if (conflict) return null;
    assert.deepEqual(options.onlyIf, stored ? {etagMatches: String(etag)} : {etagDoesNotMatch: '*'});
    stored = JSON.parse(value); etag++; return {etag: String(etag)};
  }
}};
const body = at => JSON.stringify({schema:'derech-vps-heartbeat/v1',observedAt:at,ready:true});
async function request(path, {method = path === '/heartbeat' ? 'POST' : 'GET', at = now, key = path === '/heartbeat' ? env.HEARTBEAT_WRITE_HMAC : env.HEARTBEAT_READ_HMAC, value = method === 'POST' ? body(at) : '', origin = ORIGIN} = {}) {
  const sig = await signature(key, method, path, String(at), value);
  return new Request(origin + path, {method, headers:{'X-Derech-Heartbeat-Time':String(at),'X-Derech-Heartbeat-Signature':sig}, ...(method === 'POST' ? {body:value} : {})});
}
let result = await handle(new Request(ORIGIN+'/status'), env, now);
assert.equal(result.status,401); assert.equal(result.headers.get('X-Robots-Tag'),'noindex, nofollow');
assert.equal((await handle(await request('/status'),env,now)).status,503);
assert.equal((await handle(await request('/heartbeat'),env,now)).status,200);
result = await handle(await request('/status'),env,now);
assert.equal(result.status,200); assert.equal((await result.json()).heartbeat.receivedAt,now);
assert.equal((await handle(await request('/heartbeat'),env,now)).status,409);
assert.equal((await handle(await request('/status',{key:env.HEARTBEAT_WRITE_HMAC}),env,now)).status,401);
assert.equal((await handle(await request('/heartbeat',{key:env.HEARTBEAT_READ_HMAC}),env,now)).status,401);
assert.equal((await handle(await request('/status',{at:now-61}),env,now)).status,401);
const before = calls;
assert.equal((await handle(await request('/status',{origin:'https://foreign.invalid'}),env,now)).status,404);
assert.equal((await handle(new Request(ORIGIN+'/status?secret=canary'),env,now)).status,404);
assert.equal(calls,before);
const pii = JSON.stringify({schema:'derech-vps-heartbeat/v1',observedAt:now+1,ready:true,email:'canary@example.invalid'});
result = await handle(await request('/heartbeat',{at:now+1,value:pii}),env,now+1);
assert.equal(result.status,400); assert.ok(!(await result.text()).includes('canary'));
assert.equal((await handle(await request('/heartbeat',{value:'x'.repeat(2049)}),env,now)).status,413);
conflict = true;
assert.equal((await handle(await request('/heartbeat',{at:now+1}),env,now+1)).status,409);
assert.equal(stored.observedAt,now);
env.HEARTBEAT_BUCKET.get = async () => {throw new Error('secret-canary');};
result = await handle(await request('/status'),env,now);
assert.equal(result.status,503); assert.ok(!(await result.text()).includes('secret-canary'));
assert.equal((await handle(await request('/status'),{...env,HEARTBEAT_READ_HMAC:env.HEARTBEAT_WRITE_HMAC},now)).status,503);
console.log('Worker protocol fixture passed; no external network');
'''
        result = subprocess.run([node, '--input-type=module', '-e', script, source], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__': unittest.main()
