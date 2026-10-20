import contextlib
from dataclasses import replace
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from site_review_alerts_test_fixture import FixtureWeekly as weekly, fixture_owner_dm as owner_dm

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

NOW = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
CF = 'https://derech-tkuma-review.22yarden22.workers.dev'
NATIVE = 'https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site'

def snapshot(origin, *, good=False, code='noindex_missing', span=900):
    end = NOW.timestamp(); history = []
    for offset in (0, span / 3, span * 2 / 3, span):
        at = end - span + offset
        probes = [{'probe': name, 'code': 'ok', 'status': 200, 'seconds': .1} for name in ('health', 'home', 'interior', 'asset')]
        if not good:
            probes[1].update(code=code, status=None if code == 'transport_failed' else 200)
        history.append({'observedAt': at, 'startedAt': at - 1, 'ok': good, 'probes': probes})
    return {'version': 1, 'origin': origin, 'lastObservedAt': end, 'generation': 1, 'history': history, 'incident': {'id': 'site-review:1', 'firstSeen': end-span, 'lastSeen': end}}

class CloudflareMonitorTests(unittest.TestCase):
    def setUp(self):
        self.m = load('cf_monitor', 'site-review-monitor.py'); self.m.select_target('cloudflare')

    def test_fixed_scope_cannot_switch_and_never_reads_or_accepts_credentials(self):
        self.assertEqual(self.m.ORIGIN, CF)
        with patch.object(self.m, 'protected_json') as read:
            with self.assertRaisesRegex(self.m.ProbeError, 'credential_rejected'): self.m.service_token()
            read.assert_not_called()
        for operation in (lambda: self.m.request('/', 'private-canary'), lambda: self.m.observe('a'*64, 'private-canary')):
            with self.assertRaisesRegex(self.m.ProbeError, 'credential_rejected'): operation()
        with self.assertRaises(self.m.ProbeError): self.m.select_target('sites')
        with self.assertRaises(self.m.ProbeError): self.m.select_target('https://other.invalid')

    def test_exact_public_get_without_auth_headers_and_foreign_state_rejected(self):
        class Response:
            status = 200; headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return CF + '/api/health'
            def read(self, limit): return b'{}'
        with patch.object(self.m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = Response()
            self.m.request('/api/health', None)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, CF + '/api/health')
            self.assertEqual(request.method, 'GET'); self.assertIsNone(request.data)
            self.assertEqual({name.lower() for name, _ in request.header_items()}, {'user-agent', 'cache-control'})
        with self.assertRaisesRegex(self.m.ProbeError, 'state_scope_invalid'):
            self.m.transition({'version': 1, 'origin': NATIVE}, {'observedAt': 1000, 'startedAt': 999, 'ok': True}, now=1000)

    def test_public_cli_bypasses_service_config_and_persists_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory); directory.chmod(0o700)
            state = directory / 'cloudflare-state.json'; release = directory / 'release.json'
            release.write_text(json.dumps({'contentRelease': 'a'*64}))
            observation = {'observedAt': 1000, 'startedAt': 999, 'ok': True, 'probes': []}
            with patch.object(self.m, 'service_token', side_effect=AssertionError('must not read a key')), patch.object(self.m, 'observe', return_value=observation) as observe, patch.object(self.m.time, 'time', return_value=1000), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(self.m.main(['--target', 'cloudflare', '--state', str(state), '--release-file', str(release)]), 0)
            observe.assert_called_once_with('a'*64, None)
            self.assertEqual(json.loads(state.read_text())['origin'], CF)

    def test_all_four_public_probe_contracts_use_no_credential(self):
        paths = []
        def transport(path, token):
            paths.append(path); self.assertIsNone(token)
            if path == '/api/health': return 200, {}, json.dumps({'status': 'ready', 'mode': 'review', 'contentRelease': 'a'*64, 'pages': 37}).encode()
            if path == self.m.ASSET: return 200, {}, b'fixture-asset'
            return 200, {'x-robots-tag': 'noindex, nofollow'}, b'<meta name="robots" content="noindex,nofollow">'
        with patch.object(self.m, 'ASSET_SHA', self.m.hashlib.sha256(b'fixture-asset').hexdigest()):
            result = self.m.observe('a'*64, transport=transport, clock=lambda: 1000, monotonic=lambda: 1)
        self.assertTrue(result['ok'])
        self.assertEqual(paths, ['/api/health', '/', '/התצפיות/', self.m.ASSET])

class CloudflareAlertTests(unittest.TestCase):
    def setUp(self):
        self.native = load('native_alerts_private_fixture', 'site-review-alerts.py')
        self.cf = load('cf_alerts_private_fixture', 'site-review-alerts.py'); self.cf.select_target('cloudflare')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name).resolve(); self.db = self.path / 'bridge.sqlite3'; self.config = self.path / 'runtime.json'
        self.tenant = replace(weekly.TENANTS['derech'], uid=os.getuid(), gid=os.getgid())
        self.config.write_text(json.dumps({'owner_id': self.cf.OWNER, 'chat_id': self.cf.CHAT, 'bot_id': self.cf.BOT, 'owner_status': 'creator', 'bot_status': 'member', 'operator_ids': [8940420713], 'viewer_ids': []})); self.config.chmod(0o600)
        with sqlite3.connect(self.db) as db:
            db.executescript('''CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE outbox(id INTEGER PRIMARY KEY,idempotency_key TEXT UNIQUE,chat_id INTEGER,text TEXT,kind TEXT,state TEXT,telegram_message_id INTEGER,created_at TEXT,updated_at TEXT,error TEXT,entities_json TEXT DEFAULT '[]',reply_markup TEXT); CREATE TABLE scoped_owner_dm(owner_id INTEGER PRIMARY KEY,tenant_slug TEXT,bot_id INTEGER,chat_id INTEGER,update_id INTEGER,message_id INTEGER);''')
            db.execute('INSERT INTO scoped_owner_dm VALUES(?,?,?,?,?,?)', (self.cf.OWNER, 'derech', self.cf.BOT, self.cf.OWNER, 100, 9))
        self.db.chmod(0o600)

    def process(self, module, value, gate=lambda now: True):
        return module.process_snapshot(value, self.db, self.config, now=NOW, gate=gate, weekly=weekly, owner_dm=owner_dm, tenant=self.tenant)

    def test_origin_ledgers_and_recovery_receipts_are_independent(self):
        self.process(self.native, snapshot(NATIVE)); self.process(self.cf, snapshot(CF))
        with sqlite3.connect(self.db) as db:
            native = db.execute('SELECT open_key FROM site_review_notices').fetchone()[0]
            cf = db.execute('SELECT open_key FROM site_review_cf_notices').fetchone()[0]
            self.assertNotEqual(native, cf)
            db.execute("UPDATE outbox SET state='sent',telegram_message_id=55 WHERE idempotency_key=?", (cf,))
            self.assertTrue(all(row[0] == self.cf.OWNER for row in db.execute('SELECT chat_id FROM outbox')))
        self.process(self.cf, snapshot(CF, good=True)); self.process(self.cf, snapshot(CF, good=True))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0], 3)
            self.assertIsNone(db.execute('SELECT resolved_at FROM site_review_notices').fetchone()[0])
            self.assertIsNotNone(db.execute('SELECT resolved_at FROM site_review_cf_notices').fetchone()[0])
            texts = [row[0] for row in db.execute('SELECT text FROM outbox WHERE idempotency_key<>?', (native,))]
            self.assertTrue(all(CF in text and NATIVE not in text for text in texts))
        receipts = self.cf.readback(self.db, self.config, weekly=weekly, tenant=self.tenant)
        self.assertEqual(len(receipts['notices']), 2)

    def test_cf_scope_persistence_sacred_and_network_rules_unchanged(self):
        with self.assertRaisesRegex(self.cf.AlertError, 'scope_invalid'): self.process(self.cf, snapshot(NATIVE))
        with self.assertRaisesRegex(self.cf.AlertError, 'sacred_time_closed'): self.process(self.cf, snapshot(CF), gate=lambda now: False)
        self.assertEqual(self.process(self.cf, snapshot(CF, span=899))['state'], 'observing')
        self.assertEqual(self.process(self.cf, snapshot(CF, code='transport_failed'))['state'], 'internal_only')
        with sqlite3.connect(self.db) as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0], 0)

class TargetsRunnerTests(unittest.TestCase):
    def setUp(self): self.r = load('dual_target_runner', 'site-review-targets-runner.py')

    def test_fixed_commands_and_no_credentials_on_cloudflare(self):
        native = self.r.command('monitor', 'sites'); cf = self.r.command('monitor', 'cloudflare')
        self.assertIn('/etc/yarden-site-monitor.json', native)
        self.assertIn('--public-only', cf); self.assertNotIn('--service-config', cf)
        self.assertIn('/var/lib/yarden-site-monitor/cloudflare-state.json', cf)
        self.assertNotIn('/etc/yarden-answer-cms.json', native + cf)
        with self.assertRaises(ValueError): self.r.command('monitor', 'other')

    def test_each_target_runs_despite_failure_no_raw_output_and_calendar_fails_closed(self):
        calls = []
        def execute(args, **kwargs):
            calls.append(args); return SimpleNamespace(returncode=2 if len(calls) == 1 else 0, stdout='private-secret-canary', stderr='private-secret-canary')
        output = io.StringIO()
        with contextlib.redirect_stdout(output): self.assertEqual(self.r.run('monitor', gate=lambda: True, execute=execute), 1)
        self.assertEqual(len(calls), 2); self.assertNotIn('private-secret-canary', output.getvalue())
        calls.clear()
        with contextlib.redirect_stdout(io.StringIO()): self.assertEqual(self.r.run('alerts', gate=lambda: False, execute=execute), 0)
        self.assertEqual(calls, [])
        sequence = iter([True, False])
        with contextlib.redirect_stdout(io.StringIO()): self.r.run('monitor', gate=lambda: next(sequence), execute=execute)
        self.assertEqual(len(calls), 1, 'a calendar closure between targets must stop the second probe batch')

if __name__ == '__main__': unittest.main()
