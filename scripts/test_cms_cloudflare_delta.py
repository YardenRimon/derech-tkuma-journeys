"""No network: real SQLite transactions exercise the exact proposed bound batch."""
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('cms_delta', Path(__file__).with_name('reconcile-cms-cloudflare-review.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = int(time.time())
STAMP = m.datetime.datetime.fromtimestamp(NOW, m.datetime.timezone.utc).isoformat()
CONTRACT = m.repository_schema()
PRIVATE = 'PRIVATE-CONTENT-MUST-NOT-APPEAR-IN-CONFLICT'


def database():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    for file in sorted((m.ROOT / 'platform-cms/drizzle').glob('*.sql')):
        db.executescript(file.read_text())
    db.execute('PRAGMA foreign_keys=ON')
    return db


def snapshot(db, media=None):
    tables = []
    for name in m.ORDER:
        columns = CONTRACT['columns'][name]
        pk = [c['name'] for c in sorted(columns, key=lambda c: c['pk']) if c['pk']]
        rows = [dict(row) for row in db.execute('SELECT * FROM ' + m.q(name) + ' ORDER BY ' + ','.join(map(m.q, pk)))]
        tables.append({'name': name, 'columns': columns, 'rows': rows, 'count': len(rows), 'sha256': m.digest(rows)})
    value = {'format': 'cms-backup-v1', 'schemaVersion': 1, 'scope': m.SCOPE, 'createdAt': STAMP, 'schema': CONTRACT['schema'], 'migrations': CONTRACT['migrations'], 'tables': tables, 'sqliteSequence': [dict(row) for row in db.execute("SELECT name,seq FROM sqlite_sequence WHERE name LIKE 'cms_%' ORDER BY name")], 'media': media or []}
    return {'snapshot': value, 'sha256': m.digest(value)}


def insert(db, table, row):
    fields = list(row)
    db.execute('INSERT INTO ' + m.q(table) + ' (' + ','.join(map(m.q, fields)) + ') VALUES (' + ','.join('?' for _ in fields) + ')', list(row.values()))
    db.commit()


def clone(db):
    other = database()
    db.backup(other)
    return other


def atomic(db, plan):
    try:
        db.execute('BEGIN IMMEDIATE')
        for item in plan['batch']:
            db.execute(item['sql'], item['params']).fetchall()
        db.commit()
    except Exception:
        db.rollback()
        raise


def row(db, table):
    return dict(db.execute('SELECT * FROM ' + m.q(table)).fetchone())


class DeltaTests(unittest.TestCase):
    def setUp(self):
        self.base = database()
        insert(self.base, 'cms_deployment_scope', {'singleton': 1, 'tenant_id': 'derech', 'site_id': 'derech-main'})
        insert(self.base, 'cms_users', {'email': 'owner@fixture.invalid', 'auth_user_id': 'sites-owner', 'role': 'admin', 'active': 1, 'can_publish': 1, 'revision': 1, 'created_at': STAMP, 'updated_at': STAMP, 'last_login_at': None, 'cf_access_user_id': None})
        insert(self.base, 'cms_records', {'tenant_id': 'derech', 'site_id': 'derech-main', 'kind': 'tour', 'id': 'tour-1', 'record_json': '{"title":"baseline"}', 'published_json': None, 'published_version': 0, 'revision': 1, 'updated_at': STAMP, 'operation_token': 'baseline-operation'})
        insert(self.base, 'cms_record_history', {'tenant_id': 'derech', 'site_id': 'derech-main', 'kind': 'tour', 'id': 'tour-1', 'version': 1, 'snapshot_json': '{"baseline":true}'})
        insert(self.base, 'cms_task_mirrors', {'tenant_id': 'derech', 'site_id': 'derech-main', 'external_id': 'task-1', 'record_json': '{"baseline":true}', 'assignee_email': 'owner@fixture.invalid', 'revision': 1, 'synced_at': STAMP, 'operation_token': 'baseline-task'})
        self.source, self.target = clone(self.base), clone(self.base)
        self.addCleanup(self.base.close)
        self.addCleanup(self.source.close)
        self.addCleanup(self.target.close)

    def plan(self, source_media=None, target_media=None):
        return m.plan_merge(snapshot(self.base), snapshot(self.source, source_media), snapshot(self.target, target_media), now=NOW)

    def update(self, db, table, field, value):
        db.execute('UPDATE ' + m.q(table) + ' SET ' + m.q(field) + '=?', (value,))
        db.commit()

    def test_source_change_target_pin_draft_and_history_are_all_preserved(self):
        self.update(self.source, 'cms_records', 'record_json', '{"title":"' + PRIVATE + '","deleted":true}')
        self.update(self.source, 'cms_records', 'revision', 2)
        insert(self.source, 'cms_record_history', {'tenant_id': 'derech', 'site_id': 'derech-main', 'kind': 'tour', 'id': 'tour-1', 'version': 2, 'snapshot_json': '{"source":true}'})
        self.update(self.target, 'cms_users', 'cf_access_user_id', 'cloudflare-pinned-owner')
        insert(self.target, 'cms_pages', {'slug': '/new-target-draft/', 'draft_json': '{"keep":"draft"}', 'revision': 9, 'published_html': None, 'published_version': 0, 'updated_by': 'owner@fixture.invalid', 'updated_at': STAMP})
        insert(self.target, 'cms_task_audit', {'tenant_id': 'derech', 'site_id': 'derech-main', 'external_id': 'task-1', 'revision': 5, 'audit_json': '{"targetReceipt":"retained"}'})
        plan = self.plan()
        self.assertEqual(plan['accountId'], m.ACCOUNT_ID)
        self.assertEqual(plan['databaseId'], m.DATABASE_ID)
        self.assertEqual(plan['summary']['preservedCloudflarePins'], 1)
        for item in plan['batch']:
            self.assertNotIn(PRIVATE, item['sql'])
            self.assertNotIn('DELETE', item['sql'].upper())
        atomic(self.target, plan)
        self.assertEqual(row(self.target, 'cms_users')['cf_access_user_id'], 'cloudflare-pinned-owner')
        self.assertIn('deleted', row(self.target, 'cms_records')['record_json'])
        self.assertEqual(row(self.target, 'cms_pages')['revision'], 9)
        self.assertIn('targetReceipt', row(self.target, 'cms_task_audit')['audit_json'])
        self.assertEqual(self.target.execute('SELECT COUNT(*) FROM cms_record_history').fetchone()[0], 2)

    def test_source_user_update_preserves_target_pin_only(self):
        self.update(self.source, 'cms_users', 'can_publish', 0)
        self.update(self.target, 'cms_users', 'cf_access_user_id', 'cloudflare-pinned-owner')
        atomic(self.target, self.plan())
        self.assertEqual(row(self.target, 'cms_users')['can_publish'], 0)
        self.assertEqual(row(self.target, 'cms_users')['cf_access_user_id'], 'cloudflare-pinned-owner')

    def test_independent_login_times_merge_monotonically_with_provider_pins(self):
        iso = lambda seconds, zone=m.datetime.timezone.utc: m.datetime.datetime.fromtimestamp(NOW + seconds, zone).isoformat()
        self.update(self.base, 'cms_users', 'last_login_at', iso(-300))
        self.update(self.source, 'cms_users', 'last_login_at', iso(-10))
        self.update(self.target, 'cms_users', 'last_login_at', iso(-20, m.datetime.timezone(m.datetime.timedelta(hours=2))))
        self.update(self.target, 'cms_users', 'cf_access_user_id', 'cloudflare-pinned-owner')
        self.update(self.source, 'cms_users', 'can_publish', 0)
        atomic(self.target, self.plan())
        user = row(self.target, 'cms_users')
        self.assertEqual(user['last_login_at'], iso(-10), 'compare ISO instants, not lexical timestamp order')
        self.assertEqual(user['auth_user_id'], 'sites-owner')
        self.assertEqual(user['cf_access_user_id'], 'cloudflare-pinned-owner')
        self.assertEqual(user['can_publish'], 0)

    def test_newer_target_login_and_baseline_login_never_regress(self):
        iso = lambda seconds: m.datetime.datetime.fromtimestamp(NOW + seconds, m.datetime.timezone.utc).isoformat()
        for latest in ('target', 'baseline'):
            self.update(self.base, 'cms_users', 'last_login_at', iso(-5 if latest == 'baseline' else -200))
            self.update(self.source, 'cms_users', 'last_login_at', iso(-100))
            self.update(self.target, 'cms_users', 'last_login_at', iso(-5 if latest == 'target' else -150))
            atomic(self.target, self.plan())
            self.assertEqual(row(self.target, 'cms_users')['last_login_at'], iso(-5))

    def test_login_normalization_does_not_merge_conflicting_access_fields(self):
        self.update(self.source, 'cms_users', 'last_login_at', STAMP)
        self.update(self.target, 'cms_users', 'last_login_at', STAMP)
        self.update(self.source, 'cms_users', 'can_publish', 0)
        self.update(self.target, 'cms_users', 'active', 0)
        self.update(self.target, 'cms_users', 'cf_access_user_id', 'cloudflare-pinned-owner')
        with self.assertRaises(m.Conflict): self.plan()

    def test_native_identity_mismatch_and_invalid_login_fail_closed(self):
        self.update(self.source, 'cms_users', 'auth_user_id', 'changed-native-pin')
        with self.assertRaises(m.Conflict): self.plan()
        self.update(self.source, 'cms_users', 'auth_user_id', 'sites-owner')
        self.update(self.source, 'cms_users', 'last_login_at', PRIVATE)
        with self.assertRaises(m.Conflict) as error: self.plan()
        self.assertNotIn(PRIVATE, str(error.exception))

    def test_source_cannot_invent_cloudflare_identity_for_unpinned_target(self):
        self.update(self.source, 'cms_users', 'cf_access_user_id', 'unrelated-source-cf-pin')
        with self.assertRaises(m.Conflict): self.plan()

    def test_new_native_user_cannot_import_a_source_cloudflare_pin(self):
        insert(self.source, 'cms_users', {**row(self.source, 'cms_users'), 'email': 'new@fixture.invalid', 'auth_user_id': 'new-sites-user', 'cf_access_user_id': 'source-only-cf-pin'})
        with self.assertRaises(m.Conflict): self.plan()

    def test_conflicting_same_row_reports_only_table_and_key(self):
        self.update(self.source, 'cms_records', 'record_json', PRIVATE)
        self.update(self.target, 'cms_records', 'record_json', 'different-target-private-content')
        with self.assertRaises(m.Conflict) as error:
            self.plan()
        self.assertEqual(json.loads(str(error.exception)), {'table': 'cms_records', 'key': ['derech', 'derech-main', 'tour', 'tour-1']})
        self.assertNotIn(PRIVATE, str(error.exception))

    def test_concurrent_user_role_or_pin_change_is_not_silently_resolved(self):
        self.update(self.source, 'cms_users', 'can_publish', 0)
        self.update(self.target, 'cms_users', 'role', 'editor')
        self.update(self.target, 'cms_users', 'cf_access_user_id', 'cloudflare-pinned-owner')
        with self.assertRaises(m.Conflict): self.plan()

    def test_equal_concurrent_changes_converge_and_target_only_changes_stay(self):
        self.update(self.source, 'cms_records', 'record_json', '{"same":true}')
        self.update(self.target, 'cms_records', 'record_json', '{"same":true}')
        self.update(self.target, 'cms_task_mirrors', 'record_json', '{"newerTarget":true}')
        plan = self.plan()
        self.assertEqual(plan['summary']['mutations'], 0)
        atomic(self.target, plan)
        self.assertIn('newerTarget', row(self.target, 'cms_task_mirrors')['record_json'])

    def test_history_changes_and_physical_deletions_fail_closed(self):
        self.update(self.source, 'cms_record_history', 'snapshot_json', PRIVATE)
        with self.assertRaises(m.Conflict): self.plan()
        self.update(self.source, 'cms_record_history', 'snapshot_json', '{"baseline":true}')
        self.source.execute('DELETE FROM cms_record_history')
        self.source.commit()
        with self.assertRaises(m.Conflict): self.plan()

    def test_new_commands_receipts_audit_ids_and_high_sequence_are_retained(self):
        insert(self.source, 'cms_task_commands', {'tenant_id': 'derech', 'site_id': 'derech-main', 'external_id': 'task-1', 'command_key': 'source-command', 'command_json': '{"source":true}', 'state': 'accepted', 'result_note': 'source receipt', 'created_at': STAMP})
        insert(self.target, 'cms_task_commands', {'tenant_id': 'derech', 'site_id': 'derech-main', 'external_id': 'task-1', 'command_key': 'target-command', 'command_json': '{"target":true}', 'state': 'pending', 'result_note': 'target receipt', 'created_at': STAMP})
        audit = {'actor_email': 'owner@fixture.invalid', 'subject_email': 'owner@fixture.invalid', 'operation': 'fixture', 'changed_at': STAMP}
        insert(self.source, 'cms_permission_audit', {'id': 2, **audit})
        insert(self.target, 'cms_permission_audit', {'id': 3, **audit})
        self.target.execute("UPDATE sqlite_sequence SET seq=300 WHERE name='cms_permission_audit'")
        self.target.commit()
        atomic(self.target, self.plan())
        self.assertEqual([r[0] for r in self.target.execute('SELECT id FROM cms_permission_audit ORDER BY id')], [2, 3])
        self.assertEqual(self.target.execute('SELECT seq FROM sqlite_sequence').fetchone()[0], 300)
        self.assertEqual(self.target.execute('SELECT COUNT(*) FROM cms_task_commands').fetchone()[0], 2)

    def test_late_target_row_edit_insert_schema_or_sequence_aborts_without_partial_write(self):
        self.update(self.source, 'cms_records', 'record_json', '{"sourceChange":true}')
        plan = self.plan()
        for case in ('row', 'insert', 'schema', 'trigger', 'sequence'):
            target = clone(self.target)
            try:
                if case == 'row': target.execute('UPDATE cms_task_mirrors SET revision=99')
                if case == 'insert': target.execute("INSERT INTO cms_settings VALUES ('late', 'target')")
                if case == 'schema': target.execute('CREATE INDEX cms_unexpected ON cms_users(role)')
                if case == 'trigger': target.execute("CREATE TRIGGER unexpected_trigger AFTER UPDATE ON cms_records BEGIN UPDATE cms_users SET can_publish=0; END")
                if case == 'sequence': target.execute("INSERT INTO sqlite_sequence VALUES ('cms_permission_audit', 100)")
                target.commit()
                before = snapshot(target)
                with self.subTest(case=case), self.assertRaises(sqlite3.Error): atomic(target, plan)
                self.assertEqual(snapshot(target), before)
            finally: target.close()

    def test_unique_collision_in_later_statement_rolls_back_earlier_changes(self):
        insert(self.source, 'cms_settings', {'key': 'earlier_write', 'value': 'must roll back'})
        self.update(self.source, 'cms_records', 'record_json', PRIVATE)
        user = row(self.base, 'cms_users')
        insert(self.source, 'cms_users', {**user, 'email': 'source@fixture.invalid', 'auth_user_id': 'colliding-id'})
        insert(self.target, 'cms_users', {**user, 'email': 'target@fixture.invalid', 'auth_user_id': 'colliding-id'})
        plan = self.plan()
        before = snapshot(self.target)
        with self.assertRaises(sqlite3.IntegrityError): atomic(self.target, plan)
        self.assertEqual(snapshot(self.target), before)

    def test_failed_final_assertion_rolls_back_all_writes(self):
        self.update(self.source, 'cms_records', 'record_json', PRIVATE)
        plan = self.plan()
        plan['batch'].append(m.assertion('0'))
        before = snapshot(self.target)
        with self.assertRaises(sqlite3.Error): atomic(self.target, plan)
        self.assertEqual(snapshot(self.target), before)

    def test_target_only_media_retained_source_media_requires_matching_verified_hash(self):
        key = '00112233-4455-4677-8899-aabbccddeeff'
        target = [{'key': key, 'size': 15, 'etag': 'fixture', 'verifiedSha256': 'a' * 64}]
        self.assertEqual(self.plan(target_media=target)['summary']['targetMediaObjectsRetained'], 1)
        with self.assertRaises(m.Conflict): self.plan(source_media=target)
        with self.assertRaises(m.Conflict): self.plan(source_media=[{**target[0], 'verifiedSha256': 'b' * 64}], target_media=target)
        self.assertEqual(self.plan(source_media=target, target_media=target)['summary']['mediaWrites'], 0)

    def test_digest_scope_baseline_pin_freshness_and_mutation_bounds(self):
        baseline, source, target = [snapshot(db) for db in (self.base, self.source, self.target)]
        with self.assertRaises(m.ReconcileError): m.plan_merge(baseline, source, target, baseline_sha=m.BASELINE_SHA)
        for case in ('digest', 'scope', 'stale', 'future'):
            changed = copy.deepcopy(source)
            if case == 'digest': changed['sha256'] = '0' * 64
            else:
                if case == 'scope': changed['snapshot']['scope'] = {'tenantId': 'other', 'siteId': 'other'}
                if case in ('stale', 'future'): changed['snapshot']['createdAt'] = m.datetime.datetime.fromtimestamp(NOW + (-1000 if case == 'stale' else 1000), m.datetime.timezone.utc).isoformat()
                changed['sha256'] = m.digest(changed['snapshot'])
            with self.subTest(case=case), self.assertRaises(m.ReconcileError): m.plan_merge(baseline, changed, target, now=NOW)
        for index in range(81): insert(self.source, 'cms_settings', {'key': 'bounded_' + str(index), 'value': 'fixture'})
        with self.assertRaisesRegex(m.ReconcileError, 'count'): self.plan()

    def test_expired_plan_fails_inside_atomic_batch(self):
        self.update(self.source, 'cms_records', 'record_json', PRIVATE)
        plan = self.plan()
        plan['batch'][0] = m.assertion('unixepoch() BETWEEN ? AND ?', [0, NOW - 1])
        before = snapshot(self.target)
        with self.assertRaises(sqlite3.Error): atomic(self.target, plan)
        self.assertEqual(snapshot(self.target), before)

    def test_private_input_mode_is_required_and_no_live_executor_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'snapshot.json'
            file.write_text(json.dumps(snapshot(self.base)))
            file.chmod(0o644)
            with self.assertRaises(m.ReconcileError): m.read_private(file)
            file.chmod(0o600)
            self.assertEqual(m.read_private(file)['sha256'], snapshot(self.base)['sha256'])
        self.assertNotIn('urllib', Path(m.__file__).read_text())
        self.assertFalse(hasattr(m, 'apply'))

    def test_rest_executor_requires_external_isolated_rollback_and_success_proof(self):
        wrappers = [snapshot(db) for db in (self.base, self.source, self.target)]
        proof = {'verifiedAt': STAMP, 'accountId': m.ACCOUNT_ID, 'isolatedValidationDatabase': '00112233-4455-4677-8899-aabbccddeeff', 'productionDatabaseModified': False, 'boundRestBatchRollbackVerified': True, 'batchSuccessVerified': True, 'errorGuard': 'integer_overflow', 'singleRequestOnly': True, 'temporaryValidationDatabaseRemoved': True}
        without = m.plan_merge(*wrappers, now=NOW)
        self.assertNotIn('REST', without['executor'])
        permitted = m.plan_merge(*wrappers, now=NOW, rest_atomicity_proof=proof)
        self.assertIn('ONE REST /query', permitted['executor'])
        self.assertEqual(permitted['restAtomicityProofSha256'], m.digest(proof))
        for patch in ({'accountId': 'other-account'}, {'isolatedValidationDatabase': m.DATABASE_ID}, {'productionDatabaseModified': True}, {'boundRestBatchRollbackVerified': False}, {'batchSuccessVerified': False}, {'singleRequestOnly': False}, {'temporaryValidationDatabaseRemoved': False}, {'errorGuard': 'other'}, {'verifiedAt': '2000-01-01T00:00:00Z'}):
            with self.subTest(patch=patch), self.assertRaises(m.ReconcileError):
                m.plan_merge(*wrappers, now=NOW, rest_atomicity_proof={**proof, **patch})


if __name__ == '__main__': unittest.main()
