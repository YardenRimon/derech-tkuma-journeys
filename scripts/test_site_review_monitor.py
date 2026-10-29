import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('site_review_monitor', Path(__file__).with_name('site-review-monitor.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
RELEASE = 'a' * 64
SECRET = 'sensitive-value-must-never-be-output'


def sample(at, ok=False):
    return {'startedAt': at - 1, 'observedAt': at, 'ok': ok, 'probes': []}


def advance(state, at, ok=False, receipt=None):
    return m.transition(state, sample(at, ok), now=at, opening_receipt=receipt)


class IncidentTests(unittest.TestCase):
    def test_distinct_samples_and_persistence_both_required(self):
        state, result = advance(None, 1000)
        for at in (1001, 1002, 1600):
            state, result = advance(state, at)
            self.assertEqual(result['state'], 'observing')
        state, result = advance(state, 1900)
        self.assertEqual(result['newEvent']['kind'], 'actionable_open')
        state, result = advance(state, 2000)
        self.assertIsNone(result['newEvent'])
        with self.assertRaisesRegex(m.ProbeError, 'not_distinct'):
            advance(state, 2000)

    def test_sampling_gap_resets_unproven_outage(self):
        state, _ = advance(None, 1000)
        state, _ = advance(state, 1600)
        state, result = advance(state, 2500)
        self.assertEqual(result['state'], 'observing')
        self.assertEqual(state['incident']['failures'], 1)
        self.assertEqual(state['incident']['firstSeen'], 2500)

    def test_clock_skew_staleness_and_reversed_request_rejected(self):
        for observation in (sample(1001), sample(800), {'observedAt': 1000, 'startedAt': 1001, 'ok': False}, {'observedAt': float('nan'), 'startedAt': 999, 'ok': False}):
            with self.assertRaisesRegex(m.ProbeError, 'clock_invalid'):
                m.transition(None, observation, now=1000)

    def open_incident(self):
        state = None
        for at in (1000, 1450, 1900):
            state, result = advance(state, at)
        return state

    def test_recovery_requires_actual_sent_receipt_and_emits_once(self):
        state = self.open_incident()
        state, result = advance(state, 2000, True)
        self.assertEqual(result['state'], 'recovery_pending_receipt')
        self.assertIsNone(result['newEvent'])
        receipt = {'version': 1, 'origin': m.ORIGIN, 'incidentId': 'site-review:1', 'eventId': 'site-review:1:open', 'state': 'queued', 'messageId': 9}
        with self.assertRaisesRegex(m.ProbeError, 'receipt_invalid'):
            advance(state, 2100, True, receipt)
        receipt['state'] = 'sent'
        state, result = advance(state, 2100, True, receipt)
        self.assertEqual(result['newEvent']['kind'], 'actionable_recovery')
        state, result = advance(state, 2200, True, receipt)
        self.assertIsNone(result['newEvent'])
        self.assertEqual(len(state['events']), 2)
        state, _ = advance(state, 2300)
        self.assertEqual(state['incident']['id'], 'site-review:2')

    def test_new_outage_gets_new_generation_even_when_old_opening_was_never_sent(self):
        state = self.open_incident()
        state, result = advance(state, 2000, True)
        self.assertEqual(result['state'], 'recovery_pending_receipt')
        state, result = advance(state, 2100)
        self.assertEqual(state['incident']['id'], 'site-review:2')
        self.assertEqual(state['incident']['failures'], 1)
        self.assertEqual(result['state'], 'observing')

    def test_wrong_incident_and_no_notification_for_short_outage(self):
        state, _ = advance(None, 1000)
        state, result = advance(state, 1100, True)
        self.assertEqual(result['state'], 'healthy')
        self.assertEqual(state['events'], [])
        state = self.open_incident()
        for key, value in (('messageId', True), ('origin', 'https://evil.test'), ('incidentId', 'site-review:0')):
            receipt = {'version': 1, 'origin': m.ORIGIN, 'incidentId': 'site-review:1', 'eventId': 'site-review:1:open', 'state': 'sent', 'messageId': 8, key: value}
            with self.assertRaises(m.ProbeError):
                advance(state, 2000, True, receipt)

    def test_history_and_events_are_bounded(self):
        state = None
        for i in range(400):
            state, _ = advance(state, 1000 + i * 300, True)
        self.assertEqual(len(state['history']), 288)


class ProbeTests(unittest.TestCase):
    def transport(self, path, token):
        if path == '/api/health':
            return 200, {}, json.dumps({'status': 'ready', 'mode': 'review', 'contentRelease': RELEASE, 'pages': 37}).encode()
        if path == m.ASSET:
            return 200, {}, b'asset'
        return 200, {'x-robots-tag': 'noindex, nofollow'}, b'<meta content="noindex,nofollow" name="robots">'

    def observe(self, transport):
        with patch.object(m, 'ASSET_SHA', m.hashlib.sha256(b'asset').hexdigest()):
            return m.observe(RELEASE, SECRET, transport=transport, clock=lambda: 1000, monotonic=lambda: 10)

    def test_success_and_no_credentials_in_output(self):
        result = self.observe(self.transport)
        self.assertTrue(result['ok'])
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertEqual(len(result['probes']), 4)

    def test_current_source_inventory_is_pinned_and_not_learned_from_health(self):
        def transport(path, token):
            status, headers, body = self.transport(path, token)
            if path == '/api/health':
                value = json.loads(body); value['pages'] = 51; body = json.dumps(value).encode()
            return status, headers, body
        with patch.object(m, 'ASSET_SHA', m.hashlib.sha256(b'asset').hexdigest()):
            self.assertTrue(m.observe(RELEASE, SECRET, expected_pages=51, transport=transport)['ok'])
            self.assertFalse(m.observe(RELEASE, SECRET, expected_pages=37, transport=transport)['ok'])
            for invalid in (True, '51', None, 0, 52):
                with self.assertRaisesRegex(m.ProbeError, 'expected_release_invalid'):
                    m.observe(RELEASE, SECRET, expected_pages=invalid, transport=transport)

    def test_health_release_mode_and_ready_are_enforced(self):
        for changed in ({'contentRelease': 'b' * 64}, {'mode': 'production'}, {'status': 'starting'}, {'pages': 36}):
            def transport(path, token):
                status, headers, body = self.transport(path, token)
                if path == '/api/health':
                    value = json.loads(body); value.update(changed); body = json.dumps(value).encode()
                return status, headers, body
            result = self.observe(transport)
            self.assertEqual(result['probes'][0]['code'], 'health_mismatch')

    def test_noindex_requires_both_header_and_meta_asset_bytes_exact(self):
        for missing in ('header', 'meta', 'asset'):
            def transport(path, token):
                status, headers, body = self.transport(path, token)
                if path == '/':
                    if missing == 'header': headers = {}
                    if missing == 'meta': body = b'<h1>public</h1>'
                if path == m.ASSET and missing == 'asset': body = b'bad'
                return status, headers, body
            self.assertFalse(self.observe(transport)['ok'])

    def test_network_failure_does_not_leak_provider_or_token(self):
        def transport(path, token):
            raise OSError('provider says ' + token)
        result = self.observe(transport)
        self.assertFalse(result['ok'])
        self.assertTrue(all(x['code'] == 'transport_failed' for x in result['probes']))
        self.assertNotIn(SECRET, json.dumps(result))

    def test_redirects_and_arbitrary_targets_are_rejected(self):
        with self.assertRaisesRegex(m.ProbeError, 'redirect_rejected'):
            m.NoRedirect().redirect_request(None, None, 302, 'Moved', {}, 'https://evil.test/')
        with patch.object(m.urllib.request, 'build_opener') as opener:
            for path in ('https://evil.test/', '//evil.test/', '/api/execution'):
                with self.assertRaises(m.ProbeError): m.request(path, SECRET)
            opener.assert_not_called()

    def test_transport_is_exact_get_and_limits_body(self):
        class Response:
            status = 200; headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return m.ORIGIN + '/api/health'
            def read(self, limit):
                self.limit = limit; return b'{}'
        response = Response()
        with patch.object(m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            m.request('/api/health', SECRET)
            req = opener.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url, m.ORIGIN + '/api/health')
            self.assertEqual(req.method, 'GET'); self.assertIsNone(req.data)
            self.assertEqual(req.get_header('Oai-sites-authorization'), 'Bearer ' + SECRET)
            self.assertEqual(response.limit, m.MAX_BODY + 1)


class FileTests(unittest.TestCase):
    def test_secure_service_configuration_and_atomic_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'config.json'
            value = {'version': 1, 'origin': m.ORIGIN, 'enabled': True, 'serviceToken': SECRET, 'secret': 'must-not-be-consumed'}
            path.write_text(json.dumps(value)); path.chmod(0o600)
            self.assertEqual(m.service_token(path, owner_uid=os.getuid()), SECRET)
            path.chmod(0o644)
            with self.assertRaisesRegex(m.ProbeError, 'private_file_invalid'):
                m.service_token(path, owner_uid=os.getuid())
            path.chmod(0o600); link = path.with_name('link'); link.symlink_to(path)
            with self.assertRaises(m.ProbeError): m.service_token(link, owner_uid=os.getuid())
            state = path.with_name('state.json'); m.atomic_json(state, {'ok': True})
            self.assertEqual(state.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(state.read_text()), {'ok': True})

    def test_cli_redacts_unexpected_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = io.StringIO()
            release = Path(temporary)/'release.json'; release.write_text(json.dumps({'contentRelease':RELEASE}))
            with patch.object(m, 'service_token', side_effect=RuntimeError(SECRET)), contextlib.redirect_stdout(output):
                status = m.main(['--state', temporary + '/state.json','--release-file',str(release)])
            self.assertEqual(status, 2)
            self.assertNotIn(SECRET, output.getvalue())
            self.assertEqual(json.loads(output.getvalue())['code'], 'monitor_unavailable')

if __name__ == '__main__':
    unittest.main()
