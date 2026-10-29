import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('handoff_cms_cloudflare_backup', Path(__file__).with_name('handoff-cms-cloudflare-backup.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SECRET = 'private-hmac-canary-' * 3
TOKEN = 'private-sites-token-canary'
FIXTURE = {'key': '00112233-4455-4677-8899-aabbccddeeff', 'size': 13, 'sha256': 'a'*64}

class HandoffTests(unittest.TestCase):
    def config(self): return {'url': m.OLD, 'secret': SECRET, 'scope': dict(m.SCOPE), 'siteAccessToken': TOKEN}

    def test_only_exact_old_scope_preserves_hmac_and_strips_sites_credential(self):
        old = self.config(); new = m.migrate_config(old)
        self.assertEqual(new, {'url': m.NEW, 'secret': SECRET, 'scope': m.SCOPE})
        self.assertEqual(old['siteAccessToken'], TOKEN)
        self.assertNotIn(TOKEN, json.dumps(new))
        for patch_value in [{'url': m.NEW}, {'url': m.OLD + '?token=' + TOKEN}, {'scope': {'tenantId': 'other', 'siteId': 'derech-main'}}, {'secret': 'short'}, {'siteAccessToken': None}, {'cloudflareApiToken': TOKEN}]:
            with self.subTest(patch_value=patch_value), self.assertRaises(m.HandoffError) as error: m.migrate_config({**old, **patch_value})
            self.assertNotIn(SECRET, str(error.exception)); self.assertNotIn(TOKEN, str(error.exception))

    def test_exact_media_fixture_is_required_not_just_count(self):
        self.assertEqual(m.fixture(dict(FIXTURE)), FIXTURE)
        manifest = {'format': 'cms-backup-complete-v1', 'scope': m.SCOPE, 'media': [dict(FIXTURE)]}
        m.fixture_proof(manifest, FIXTURE)
        for change in [{'size': True}, {'size': 0}, {'size': 5*1024*1024+1}, {'key': '../secret'}, {'sha256': TOKEN}, {'extra': TOKEN}]:
            with self.assertRaises(m.HandoffError): m.fixture({**FIXTURE, **change})
        for media in [[], [FIXTURE, FIXTURE], [{**FIXTURE, 'sha256': 'b'*64}]]:
            with self.assertRaises(m.HandoffError): m.fixture_proof({**manifest, 'media': media}, FIXTURE)

    def result(self):
        proof = {'restored': True, 'isolated': True, 'scope': m.SCOPE, 'integrity': 'ok', 'foreignKeys': 'ok', 'tableCounts': {str(n): n for n in range(11)}, 'rows': 55, 'mediaObjects': 1, 'mediaBytes': 13}
        event = {'kind': 'success', 'result': 'success', 'exitStatus': 0, 'offServerVerified': True, 'invocationId': 'a'*32, 'createdAt': '20261020T100001Z'}
        report = {'invocationId': 'a'*32, 'createdAt': event['createdAt'], 'state': 'offserver_copy_verified', 'complete': True, 'offServerCopyVerified': True, 'proof': proof}
        return report, proof, event

    def test_fresh_actual_service_proof_does_not_claim_decrypted_archive_fixture(self):
        report, proof, event = self.result()
        result = m.result_proof(report, proof, event, '20261019T100000Z', '20261020T100000Z')
        self.assertEqual(result['origin'], m.NEW)
        self.assertTrue(result['mediaFixturePreflightVerified'])
        self.assertFalse(result['serviceArchiveFixtureBytesIndependentlyRestored'])
        for patch_value in [{'invocationId': 'b'*32}, {'createdAt': '20261019T100000Z'}, {'complete': False}, {'state': 'encrypted_local_upload_failed'}, {'offServerCopyVerified': False}, {'proof': {**proof, 'mediaObjects': 0}}, {'proof': {**proof, 'integrity': 'corrupt'}}, {'proof': {**proof, 'rows': 56}}]:
            with self.assertRaises(m.HandoffError): m.result_proof({**report, **patch_value}, proof, event, '20261019T100000Z', '20261020T100000Z')
        for patch_value in [{'exitStatus': 2}, {'offServerVerified': False}, {'result': 'exit-code'}]:
            with self.assertRaises(m.HandoffError): m.result_proof(report, proof, {**event, **patch_value}, '20261019T100000Z', '20261020T100000Z')

    def test_two_file_rollback_preserves_business_archives_and_latest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); config = root / 'config.json'; downloader = root / 'download.py'
            archive = root / 'backup.cms'; latest = root / 'latest.json'
            archive.write_bytes(b'encrypted business backup'); latest.write_bytes(b'latest verified copy')
            gates = []
            m.restore_files(b'prior-private-config', b'prior-source', config=config, downloader=downloader, gate=lambda: gates.append(True))
            self.assertEqual(gates, [True, True])
            self.assertEqual(config.read_bytes(), b'prior-private-config'); self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertEqual(downloader.read_bytes(), b'prior-source'); self.assertEqual(downloader.stat().st_mode & 0o777, 0o644)
            self.assertEqual(archive.read_bytes(), b'encrypted business backup'); self.assertEqual(latest.read_bytes(), b'latest verified copy')
            with self.assertRaises(m.HandoffError): m.restore_files(b'bad', b'bad', config=config, downloader=downloader, gate=lambda: m.require(False, 'sacred_time_closed'))
            self.assertEqual(config.read_bytes(), b'prior-private-config')

    def test_idle_guard_allows_finished_failed_unit_but_not_active_work(self):
        for state, substate in [('inactive', 'dead'), ('failed', 'failed')]:
            with patch.object(m, 'properties', return_value={'ActiveState': state, 'SubState': substate, 'DropInPaths': ''}): m.inactive()
        for value in [{'ActiveState': 'active', 'SubState': 'running'}, {'ActiveState': 'activating', 'SubState': 'start'}, {'ActiveState': 'inactive', 'SubState': 'dead', 'DropInPaths': '/unknown/override.conf'}]:
            with patch.object(m, 'properties', return_value=value), self.assertRaises(m.HandoffError): m.inactive()
        self.assertEqual(m.calendar_spec('{ OnCalendar=*-*-* 03:10:00 Asia/Jerusalem ; next_elapse=Wed }'), m.calendar_spec('{ OnCalendar=*-*-* 03:10:00 Asia/Jerusalem ; next_elapse=Thu }'))

if __name__ == '__main__': unittest.main()
