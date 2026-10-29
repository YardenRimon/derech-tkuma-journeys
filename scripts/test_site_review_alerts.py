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
# Portable dependency contract fixture. Actual deployed helper integration is
# verified by the private scoped live readback, not asserted by this CI suite.
spec = importlib.util.spec_from_file_location('site_review_alerts', HERE / 'site-review-alerts.py')
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def snapshot(code='noindex_missing', *, span=900, count=4, good=False):
    now = NOW.timestamp()
    history = []
    for i in range(count):
        at = now - span + span*i/(count-1)
        probes = [{'probe': name, 'code': 'ok', 'status': 200, 'seconds': .2} for name in a.PROBES]
        if not good:
            index = 0 if code == 'health_mismatch' else 3 if code == 'asset_mismatch' else 1
            probes[index]['code'] = code
            if code == 'transport_failed': probes[index]['status'] = None
            if code == 'http_status': probes[index]['status'] = 403
        history.append({'startedAt': at-1, 'observedAt': at, 'ok': good, 'probes': probes})
    return {'version': 1, 'origin': a.ORIGIN, 'generation': 1, 'lastObservedAt': now, 'history': history,
            'incident': {'id': 'site-review:1', 'firstSeen': now-span, 'lastSeen': now, 'failures': count, 'openCandidate': span >= 900, 'openingSent': False, 'recoveryCandidate': False}}


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name).resolve(); self.database = self.path/'bridge.sqlite3'; self.config = self.path/'runtime.json'
        self.tenant = replace(weekly.TENANTS['derech'], uid=os.getuid(), gid=os.getgid())
        self.config.write_text(json.dumps({'owner_id': a.OWNER, 'chat_id': a.CHAT, 'bot_id': a.BOT, 'owner_status': 'creator', 'bot_status': 'member', 'operator_ids': [8940420713], 'viewer_ids': []}))
        self.config.chmod(0o600)
        with sqlite3.connect(self.database) as db:
            db.executescript('''CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE outbox(id INTEGER PRIMARY KEY,idempotency_key TEXT UNIQUE,chat_id INTEGER,text TEXT,kind TEXT,state TEXT,telegram_message_id INTEGER,created_at TEXT,updated_at TEXT,error TEXT,entities_json TEXT DEFAULT '[]',reply_markup TEXT);
            CREATE TABLE scoped_owner_dm(owner_id INTEGER PRIMARY KEY,tenant_slug TEXT,bot_id INTEGER,chat_id INTEGER,update_id INTEGER,message_id INTEGER);''')
            db.execute('INSERT INTO scoped_owner_dm VALUES(?,?,?,?,?,?)', (a.OWNER, 'derech', a.BOT, a.OWNER, 100, 9))
        self.database.chmod(0o600)

    def run_adapter(self, value=None, *, gate=lambda now: True):
        return a.process_snapshot(value or snapshot(), self.database, self.config, now=NOW, gate=gate, weekly=weekly, owner_dm=owner_dm, tenant=self.tenant)

    def rows(self):
        with sqlite3.connect(self.database) as db:
            db.row_factory = sqlite3.Row
            return [dict(r) for r in db.execute('SELECT * FROM outbox ORDER BY id')]

    def delivery(self, state, message=None):
        with sqlite3.connect(self.database) as db:
            db.execute('UPDATE outbox SET state=?,telegram_message_id=?', (state, message))

    def test_one_owner_private_open_duplicate_and_readback(self):
        result = self.run_adapter(); self.assertEqual(result['notices'][0]['state'], 'queued')
        result = self.run_adapter(); self.assertEqual(result['notices'][0]['state'], 'duplicate')
        rows = self.rows(); self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['chat_id'], a.OWNER)
        self.assertNotEqual(rows[0]['chat_id'], a.CHAT); self.assertNotEqual(rows[0]['chat_id'], 8940420713)
        self.assertIn('noindex', rows[0]['text']); self.assertEqual(rows[0]['entities_json'], '[]'); self.assertIsNone(rows[0]['reply_markup'])
        self.delivery('sent', 44)
        readback = a.readback(self.database, self.config, weekly=weekly, tenant=self.tenant)
        self.assertTrue(readback['notices'][0]['deliveryVerified'])
        self.assertEqual(readback['notices'][0]['messageId'], 44)

    def test_persistence_count_and_distinct_evidence(self):
        self.assertEqual(self.run_adapter(snapshot(span=899))['state'], 'observing')
        self.assertEqual(self.run_adapter(snapshot(span=900,count=2))['state'], 'observing')
        value = snapshot(); value['history'][1] = value['history'][0]
        with self.assertRaisesRegex(a.AlertError, 'not_distinct'): self.run_adapter(value)
        self.assertEqual(self.rows(), [])

    def test_unrelated_failure_cannot_age_new_action(self):
        value = snapshot()
        for item in value['history'][:-1]:
            item['probes'][1]['code'] = 'transport_failed'; item['probes'][1]['status'] = None
        self.assertEqual(self.run_adapter(value)['state'], 'observing')
        self.assertEqual(self.rows(), [])

    def test_sampling_gap_resets_action_persistence(self):
        value = snapshot(span=1800, count=3)
        self.assertEqual(self.run_adapter(value)['state'], 'observing'); self.assertEqual(self.rows(), [])

    def test_persistent_availability_uses_one_private_notice_without_provider_details(self):
        for code in ('http_status', 'transport_failed', 'probe_failed', 'redirect_rejected', 'response_origin_mismatch'):
            result = self.run_adapter(snapshot(code))
            self.assertEqual(len(result['notices']), 1)
        rows = self.rows(); self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['chat_id'], a.OWNER)
        self.assertIn('אינו זמין', rows[0]['text'])
        self.assertNotIn('403', rows[0]['text'])

    def test_transient_availability_and_configuration_rejections_do_not_notify(self):
        self.assertEqual(self.run_adapter(snapshot('transport_failed', span=899))['state'], 'observing')
        for code in ('probe_target_rejected', 'response_too_large'):
            self.assertEqual(self.run_adapter(snapshot(code))['state'], 'internal_only')
        self.assertEqual(self.rows(), [])

    def test_health_and_asset_have_precise_owner_steps(self):
        self.run_adapter(snapshot('health_mismatch'))
        self.run_adapter(snapshot('asset_mismatch'))
        self.assertEqual(len(self.rows()), 2)
        self.assertTrue(all(row['chat_id'] == a.OWNER for row in self.rows()))

    def test_owner_dm_must_be_verified_never_group_fallback(self):
        with sqlite3.connect(self.database) as db: db.execute('DELETE FROM scoped_owner_dm')
        self.assertEqual(self.run_adapter()['state'], 'pending_owner_start'); self.assertEqual(self.rows(), [])

    def test_queued_opening_cancels_without_recovery(self):
        self.run_adapter()
        result = self.run_adapter(snapshot(good=True))
        self.assertEqual(result['notices'][0]['state'], 'resolved_before_delivery')
        self.assertEqual(len(self.rows()), 1); self.assertEqual(self.rows()[0]['state'], 'failed')
        self.assertEqual(self.rows()[0]['error'], 'resolved_before_delivery')

    def test_sent_opening_creates_one_recovery_and_readback(self):
        self.run_adapter(); self.delivery('sent', 44)
        result = self.run_adapter(snapshot(good=True))
        self.assertEqual(result['notices'][0]['state'], 'queued')
        self.run_adapter(snapshot(good=True)); self.assertEqual(len(self.rows()), 2)
        self.assertEqual(self.rows()[1]['chat_id'], a.OWNER)
        readback = a.readback(self.database, self.config, weekly=weekly, tenant=self.tenant)
        self.assertEqual([r['deliveryVerified'] for r in readback['notices']], [True, False])

    def test_uncertain_or_invalid_sent_receipt_defers_recovery(self):
        self.run_adapter()
        for state, message in (('sending',None), ('unknown',None), ('sent',None), ('sent',0)):
            self.delivery(state, message)
            result = self.run_adapter(snapshot(good=True))
            self.assertEqual(result['notices'][0]['state'], 'recovery_deferred'); self.assertEqual(len(self.rows()), 1)
        self.delivery('sent', 55); self.run_adapter(snapshot(good=True)); self.assertEqual(len(self.rows()), 2)

    def test_failed_opening_does_not_retry_or_recover(self):
        self.run_adapter(); self.delivery('failed')
        result = self.run_adapter(snapshot(good=True))
        self.assertEqual(result['notices'][0]['state'], 'resolved_without_notification'); self.assertEqual(len(self.rows()), 1)

    def test_sacred_time_fail_closed_before_any_schema_write(self):
        with self.assertRaisesRegex(a.AlertError, 'sacred_time_closed'):
            self.run_adapter(gate=lambda now: False)
        with sqlite3.connect(self.database) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='site_review_notices'").fetchone())
        calls = iter((True, True, False))
        with self.assertRaisesRegex(a.AlertError, 'sacred_time_closed'):
            self.run_adapter(gate=lambda now: next(calls))
        self.assertEqual(self.rows(), [])

    def test_outbox_destination_payload_conflict_rolls_back(self):
        self.run_adapter()
        for field, value in (('chat_id', a.CHAT), ('text', 'tampered')):
            with sqlite3.connect(self.database) as db: db.execute('UPDATE outbox SET '+field+'=?',(value,))
            with self.assertRaisesRegex((a.AlertError, weekly.WeeklyError), 'conflict'):
                self.run_adapter()
            if field == 'chat_id':
                with sqlite3.connect(self.database) as db: db.execute('UPDATE outbox SET chat_id=?',(a.OWNER,))

    def test_wrong_tenant_origin_future_stale_and_malformed_probe(self):
        values = []
        value = snapshot(); value['origin'] = 'https://evil.test'; values.append(value)
        value = snapshot(); value['history'][-1]['observedAt'] += 1; values.append(value)
        value = snapshot(); value['lastObservedAt'] -= 100; values.append(value)
        value = snapshot(); value['history'][-1]['probes'][0]['probe'] = 'admin'; values.append(value)
        value = snapshot(); value['history'][-1]['ok'] = True; values.append(value)
        for value in values:
            with self.assertRaises(a.AlertError): self.run_adapter(value)
        self.assertEqual(self.rows(), [])
        with self.assertRaisesRegex(a.AlertError,'tenant_scope_invalid'):
            a.process_snapshot(snapshot(), self.database, self.config, now=NOW, gate=lambda now: True, weekly=weekly, owner_dm=owner_dm, tenant=replace(self.tenant, bot_id=1))

    def test_config_and_file_permissions_are_authoritative(self):
        self.config.chmod(0o644)
        with self.assertRaises(weekly.WeeklyError): self.run_adapter()
        self.config.chmod(0o600)
        config = json.loads(self.config.read_text()); config['owner_id'] = 123; self.config.write_text(json.dumps(config))
        with self.assertRaises(weekly.WeeklyError): self.run_adapter()

    def test_explicit_labelled_acceptance_only_owner_once_and_recovery_after_sent(self):
        options = dict(now=NOW, gate=lambda now: True, weekly=weekly, owner_dm=owner_dm, tenant=self.tenant)
        run_id = NOW.strftime('%Y%m%dT%H%M%SZ')
        result = a.acceptance('open', run_id, self.database, self.config, **options)
        self.assertEqual(result['state'], 'queued'); self.assertTrue(result['fixture'])
        self.assertEqual(a.acceptance('open', run_id, self.database, self.config, **options)['state'], 'duplicate')
        self.assertEqual(a.acceptance('recovery', run_id, self.database, self.config, **options)['state'], 'recovery_deferred')
        self.assertEqual(len(self.rows()), 1); self.assertEqual(self.rows()[0]['chat_id'], a.OWNER)
        self.assertIn('בדיקת ניטור מבוקרת', self.rows()[0]['text'])
        self.delivery('sent', 88)
        self.assertEqual(a.acceptance('recovery', run_id, self.database, self.config, **options)['state'], 'queued')
        self.assertEqual(a.acceptance('recovery', run_id, self.database, self.config, **options)['state'], 'duplicate')
        self.assertEqual(len(self.rows()), 2)
        receipts = a.readback(self.database, self.config, weekly=weekly, tenant=self.tenant)['notices']
        self.assertEqual(len(receipts), 2); self.assertTrue(all(r['fixture'] for r in receipts))
        self.assertEqual(sum(r['deliveryVerified'] for r in receipts), 1)

    def test_acceptance_requires_explicit_fresh_run_owner_and_time_policy(self):
        options = dict(now=NOW, gate=lambda now: True, weekly=weekly, owner_dm=owner_dm, tenant=self.tenant)
        for run_id in ('20261019T120000Z', '20261021T120000Z', 'not-a-run'):
            with self.assertRaises(a.AlertError): a.acceptance('open', run_id, self.database, self.config, **options)
        with self.assertRaisesRegex(a.AlertError, 'sacred_time_closed'):
            a.acceptance('open', NOW.strftime('%Y%m%dT%H%M%SZ'), self.database, self.config, **dict(options, gate=lambda now: False))
        with sqlite3.connect(self.database) as db: db.execute('DELETE FROM scoped_owner_dm')
        with self.assertRaisesRegex(a.AlertError, 'owner_unverified'):
            a.acceptance('open', NOW.strftime('%Y%m%dT%H%M%SZ'), self.database, self.config, **options)
        self.assertEqual(self.rows(), [])

    def test_host_dispatch_only_stages_private_code_and_targets_sole_container(self):
        calls = []
        def invoke(code, raw):
            compile(code, '<child>', 'exec'); calls.append((a.CONTAINER, code, raw))
            return b'{"state":"readback","tenant_slug":"derech","notices":[]}' if 'print(json.dumps' in code else b''
        with tempfile.TemporaryDirectory() as directory:
            for name in ('organic_import.py','tenant_holds.py','weekly_telegram.py','client_notifications.py'):
                (Path(directory)/name).write_text('# isolated transport fixture module; not canonical server code\n')
            with patch.object(a, 'invoke_container', side_effect=invoke):
                result = a.host_dispatch(None, Path(directory), readonly=True)
        self.assertEqual(result['state'], 'readback'); self.assertEqual(len(calls), 6)
        self.assertTrue(all(service == a.CONTAINER for service, _, _ in calls))
        self.assertTrue(all('/tmp/derech-site-review-alerts' in code for _, code, _ in calls))
        self.assertIn("'/data/bridge.sqlite3'", calls[-1][1]); self.assertEqual(calls[-1][2], b'')
        self.assertTrue(all('flush_outbox' not in code and 'sendMessage' not in code and 'getUpdates' not in code for _, code, _ in calls))

    def test_direct_container_transport_avoids_compose_home_and_redacts_errors(self):
        with patch.object(a.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'{}', stderr=b'ignored')) as run:
            self.assertEqual(a.invoke_container('print(1)', b'{}'), b'{}')
            command = run.call_args.args[0]
            self.assertEqual(command[:6], ['docker','--config',str(a.DOCKER_CONFIG),'exec','-i',a.CONTAINER])
            self.assertNotIn('compose',command); self.assertNotIn('/root',str(command))
        with patch.object(a.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=b'', stderr=b'SECRET_SENTINEL')):
            with self.assertRaisesRegex(a.AlertError, '^container_process_failed$'):
                a.invoke_container('print(1)', b'{}')

    def test_cli_redacts_unexpected_secrets_and_does_not_call_telegram(self):
        output = io.StringIO()
        with patch.object(a.os, 'geteuid', return_value=0), patch.object(a, 'host_dispatch', side_effect=ValueError('SECRET_SENTINEL')), contextlib.redirect_stdout(output):
            result = a.main(['--readback'])
        self.assertEqual(result, 2); self.assertNotIn('SECRET_SENTINEL', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['code'], 'site_alert_adapter_blocked')

if __name__ == '__main__': unittest.main()
