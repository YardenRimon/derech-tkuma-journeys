#!/usr/bin/env python3
"""OFFLINE ONLY: prepare a private, atomic D1 reconciliation plan; no live executor.

Inputs are complete cms-backup-v1 snapshot wrappers. Root must pause writers,
capture fresh source/target DB + R2 inventory, review this private plan, then use
one D1 binding DB.batch(preparedStatements) on the exact fixed review database,
or one bound REST /query {batch:[...]} request ONLY with externally captured
isolated rollback/success proof (--rest-atomicity-proof). Never submit statements
individually, split batches, use exec(), or interpolate
values into SQL. D1 batch rollback contract:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

All target rows/schema/sequence are rechecked INSIDE that transaction before any
write; final state/FK assertions roll it all back on failure. No R2 operations,
DELETE, schema changes, secret handling, provider API or --apply option exist.
This does not prove migrated media bytes, live acceptance or post-switch backup.
"""
import argparse
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import time

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT_ID = '8b35c6b4ccb397857d80908ccf499f73'
DATABASE_ID = '53051708-5e0b-499e-a986-7c03c3c32097'
DATABASE_NAME = 'derech-tkuma-cms-review'
BASELINE_SHA = '6a2e6aaf9799710159a7b8ba4d9c63e2e45e4c07e4768caa14c79b1bf2a1138a'
SCOPE = {'tenantId': 'derech', 'siteId': 'derech-main'}
MAX_BYTES = 20 * 1024 * 1024
MAX_BATCH_BYTES = 1024 * 1024
MAX_MUTATIONS = 80
MAX_AGE = 900
IMMUTABLE = {'cms_permission_audit', 'cms_versions', 'cms_record_history', 'cms_task_audit'}
ORDER = ['cms_deployment_scope', 'cms_settings', 'cms_users', 'cms_permission_audit',
         'cms_pages', 'cms_versions', 'cms_records', 'cms_record_history',
         'cms_task_mirrors', 'cms_task_commands', 'cms_task_audit']
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
spec = importlib.util.spec_from_file_location('isolated_restore_contract', Path(__file__).with_name('cms-backup-restore.py'))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
canonical = restore.canonical


class ReconcileError(ValueError):
    pass


class Conflict(ReconcileError):
    def __init__(self, table, key):
        # Deliberately contains only table and primary key, never row values.
        self.table, self.key = table, list(key)
        super().__init__(canonical({'table': table, 'key': self.key}))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def q(identifier):
    if not re.fullmatch(r'[a-z_]+', identifier):
        raise ReconcileError('Unsupported schema identifier')
    return '"' + identifier + '"'


def repository_schema(migrations=None):
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    paths = sorted(Path(migrations or ROOT / 'platform-cms/drizzle').glob('*.sql'))
    try:
        for file in paths:
            db.executescript(file.read_text())
        schema = [dict(row) for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name LIKE 'cms_%' ORDER BY type,name")]
        columns = {name: [dict(row) for row in db.execute('PRAGMA table_info(' + q(name) + ')')] for name in ORDER}
        return {'schema': schema, 'columns': columns, 'migrations': [{'name': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file in paths]}
    finally:
        db.close()


def shape(schema):
    return [(row['type'], row['name'], row['tbl_name'], restore.sql_shape(row['sql'])) for row in schema]


def captured(snapshot):
    try:
        value = datetime.datetime.fromisoformat(snapshot['createdAt'].replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError()
        return int(value.timestamp())
    except (AttributeError, KeyError, TypeError, ValueError):
        raise ReconcileError('Snapshot capture time is invalid') from None


def validate(wrapper, contract, expected_sha=None):
    snapshot = wrapper['snapshot']
    if wrapper.get('sha256') != digest(snapshot) or (expected_sha and wrapper['sha256'] != expected_sha):
        raise ReconcileError('Snapshot identity mismatch')
    if snapshot.get('format') != 'cms-backup-v1' or snapshot.get('schemaVersion') != 1 or snapshot.get('scope') != SCOPE:
        raise ReconcileError('Snapshot format/scope mismatch')
    if snapshot.get('migrations') != contract['migrations'] or shape(snapshot.get('schema', [])) != shape(contract['schema']):
        raise ReconcileError('Repository schema/migration mismatch')
    tables = snapshot.get('tables', [])
    if sorted(t['name'] for t in tables) != sorted(ORDER):
        raise ReconcileError('Missing/duplicate/unknown table')
    by_name = {table['name']: table for table in tables}
    for name in ORDER:
        table, columns = by_name[name], contract['columns'][name]
        fields = [column['name'] for column in columns]
        normalize = lambda items: [{**item, 'type': item['type'].upper(), 'dflt_value': str(item['dflt_value']).strip('()') if item['dflt_value'] is not None else None} for item in items]
        if normalize(table['columns']) != normalize(columns) or table['count'] != len(table['rows']) or table['sha256'] != digest(table['rows']):
            raise ReconcileError('Table schema/count/digest mismatch: ' + name)
        keys = set()
        for row in table['rows']:
            if set(row) != set(fields) or any(not (value is None or type(value) in (str, int)) for value in row.values()):
                raise ReconcileError('Unsupported row value: ' + name)
            if any(type(value) is int and abs(value) > 2**53 - 1 for value in row.values()):
                raise ReconcileError('Unsafe integer: ' + name)
            if 'tenant_id' in row and (row['tenant_id'] != SCOPE['tenantId'] or row['site_id'] != SCOPE['siteId']):
                raise ReconcileError('Cross-scope row: ' + name)
            key = row_key(row, columns)
            if key in keys:
                raise Conflict(name, key)
            keys.add(key)
        if name == 'cms_settings' and any(re.search(r'secret|password|credential|api[_-]?key|access[_-]?token', row['key'], re.I) for row in table['rows']):
            raise ReconcileError('Credential-like settings are prohibited')
    if by_name['cms_deployment_scope']['rows'] != [{'singleton': 1, 'tenant_id': SCOPE['tenantId'], 'site_id': SCOPE['siteId']}]:
        raise ReconcileError('Deployment scope mismatch')
    sequence = snapshot.get('sqliteSequence')
    if not isinstance(sequence, list) or len(sequence) > 1 or any(row.get('name') != 'cms_permission_audit' or type(row.get('seq')) is not int or not 0 <= row['seq'] <= 2**53 - 1 for row in sequence):
        raise ReconcileError('Invalid sequence')
    maximum = max((row['id'] for row in by_name['cms_permission_audit']['rows']), default=0)
    if maximum and (not sequence or sequence[0]['seq'] < maximum):
        raise ReconcileError('Sequence precedes retained audit IDs')
    media = snapshot.get('media', [])
    if len({row['key'] for row in media}) != len(media) or any(not UUID.fullmatch(row['key']) or type(row['size']) is not int or row['size'] < 0 or not isinstance(row.get('etag'), str) for row in media):
        raise ReconcileError('Invalid media inventory')
    known = {row['key'] for row in media}
    for table in tables:
        for match in re.finditer(r'/media/([0-9a-f-]{36})', canonical(table['rows']).replace('\\/', '/'), re.I):
            if match[1].lower() not in known:
                raise ReconcileError('Unbacked media reference: ' + table['name'])
    captured(snapshot)
    return snapshot


def row_key(row, columns):
    return tuple(row[column['name']] for column in sorted(columns, key=lambda column: column['pk']) if column['pk'])


def assertion(expression, params=()):
    # SQLite evaluates CASE lazily; overflow throws without leaking bound values.
    return {'sql': 'SELECT CASE WHEN (' + expression + ') THEN 1 ELSE abs(-9223372036854775808) END AS reconciliation_guard', 'params': list(params)}


def table_guard(name, columns, rows):
    fields = [column['name'] for column in columns]
    equality = ' AND '.join('t.' + q(field) + ' IS json_extract(e.value,\'$."' + field + '"\')' for field in fields)
    # Count + complete row equality catches concurrent additions, removals and edits.
    return assertion('(SELECT COUNT(*) FROM ' + q(name) + ')=? AND NOT EXISTS (SELECT 1 FROM ' + q(name) + ' t WHERE NOT EXISTS (SELECT 1 FROM json_each(?) e WHERE ' + equality + '))', [len(rows), canonical(rows)])


def sequence_guard(rows):
    return assertion("(SELECT COUNT(*) FROM sqlite_sequence WHERE name LIKE 'cms_%')=? AND NOT EXISTS (SELECT 1 FROM sqlite_sequence t WHERE name LIKE 'cms_%' AND NOT EXISTS (SELECT 1 FROM json_each(?) e WHERE t.name IS json_extract(e.value,'$.name') AND t.seq IS json_extract(e.value,'$.seq')))", [len(rows), canonical(rows)])


def login_max(rows, key):
    """Authentication telemetry only; never auto-merge access/business fields."""
    observed = []
    for row in rows:
        value = row.get('last_login_at') if row else None
        if value is None:
            continue
        try:
            parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError()
            observed.append((parsed, value))
        except (AttributeError, TypeError, ValueError):
            raise Conflict('cms_users', key) from None
    # Equal instants prefer current target representation, which is last in rows.
    return max(enumerate(observed), key=lambda item: (item[1][0], item[0]))[1][1] if observed else None


def validate_rest_proof(proof, now):
    """Proof is root's external isolated experiment, not inferred from SQL text."""
    if not isinstance(proof, dict) or proof.get('accountId') != ACCOUNT_ID or not UUID.fullmatch(proof.get('isolatedValidationDatabase', '')) or proof['isolatedValidationDatabase'] == DATABASE_ID:
        raise ReconcileError('External isolated REST atomicity proof required')
    if any(proof.get(field) is not True for field in ('boundRestBatchRollbackVerified', 'batchSuccessVerified', 'singleRequestOnly', 'temporaryValidationDatabaseRemoved')) or proof.get('productionDatabaseModified') is not False or proof.get('errorGuard') != 'integer_overflow':
        raise ReconcileError('External isolated REST atomicity proof required')
    if not -60 <= now - captured({'createdAt': proof.get('verifiedAt')}) <= 86400:
        raise ReconcileError('REST atomicity proof must be freshly reviewed')
    return digest(proof)


def plan_merge(baseline_wrapper, source_wrapper, target_wrapper, contract=None, now=None, baseline_sha=None, rest_atomicity_proof=None):
    contract = contract or repository_schema()
    now = int(time.time()) if now is None else int(now)
    rest_proof_sha = validate_rest_proof(rest_atomicity_proof, now) if rest_atomicity_proof is not None else None
    base, source, target = [validate(wrapper, contract, baseline_sha if index == 0 else None) for index, wrapper in enumerate((baseline_wrapper, source_wrapper, target_wrapper))]
    if any(not -60 <= now - captured(snapshot) <= MAX_AGE for snapshot in (source, target)):
        raise ReconcileError('Fresh source and target captures are required')
    source_media = {row['key']: row for row in source['media']}
    target_media = {row['key']: row for row in target['media']}
    # R2 is outside the DB transaction: all source objects must already have a
    # separately verified identical target object; never infer content from ETag.
    for key, row in source_media.items():
        if key not in target_media or row['size'] != target_media[key]['size'] or not re.fullmatch(r'[a-f0-9]{64}', row.get('verifiedSha256', '')) or row['verifiedSha256'] != target_media[key].get('verifiedSha256') or row.get('httpMetadata', {}).get('contentType') != target_media[key].get('httpMetadata', {}).get('contentType'):
            raise Conflict('r2_media_transfer_required', (key,))
    maps = [{table['name']: table['rows'] for table in snapshot['tables']} for snapshot in (base, source, target)]
    merged, mutations, preserved_pins = {}, [], 0
    for name in ORDER:
        columns = contract['columns'][name]
        b, s, t = [{row_key(row, columns): row for row in tables[name]} for tables in maps]
        result = {}
        for key in sorted(set(b) | set(s) | set(t)):
            old, native, current = b.get(key), s.get(key), t.get(key)
            if old is not None and (native is None or current is None):
                raise Conflict(name, key)  # physical deletion is never propagated
            native = copy.deepcopy(native)
            comparable_old, comparable_current = old, current
            if name == 'cms_users' and native and current is None and native.get('cf_access_user_id') is not None:
                raise Conflict(name, key)  # never import another provider's pin
            if name == 'cms_users' and native and current:
                # Sites identity remains pinned and consistent across origins.
                # Only target CF identity and monotonic login telemetry differ.
                if native.get('auth_user_id') != current.get('auth_user_id') or (old and old.get('auth_user_id') is not None and native.get('auth_user_id') != old.get('auth_user_id')):
                    raise Conflict(name, key)
                latest_login = login_max((old, native, current), key)
                native['last_login_at'] = latest_login
                comparable_current = {**current, 'last_login_at': latest_login}
                comparable_old = {**old, 'last_login_at': latest_login} if old else None
            if name == 'cms_users' and current:
                if native and native.get('cf_access_user_id') not in (None, current['cf_access_user_id'], (old or {}).get('cf_access_user_id')):
                    raise Conflict(name, key)
                if native:
                    native['cf_access_user_id'] = current['cf_access_user_id']
                if old:
                    comparable_old = {**comparable_old, 'cf_access_user_id': current['cf_access_user_id']}
                preserved_pins += int(bool(current.get('cf_access_user_id')))
            if native == comparable_current:
                chosen = comparable_current
            elif native == comparable_old:
                chosen = comparable_current
            elif comparable_current == comparable_old:
                chosen = native
            elif old is None and native is None:
                chosen = current
            elif old is None and current is None:
                chosen = native
            else:
                raise Conflict(name, key)
            if old is not None and name in IMMUTABLE and (chosen != old or current != old):
                raise Conflict(name, key)
            if chosen is None:
                raise Conflict(name, key)
            result[key] = chosen
            if chosen != current:
                fields = [column['name'] for column in columns]
                if current is None:
                    mutations.append({'sql': 'INSERT INTO ' + q(name) + ' (' + ','.join(map(q, fields)) + ') VALUES (' + ','.join('?' for _ in fields) + ')', 'params': [chosen[field] for field in fields]})
                else:
                    update = [column['name'] for column in columns if not column['pk']]
                    keys = [column['name'] for column in sorted(columns, key=lambda column: column['pk']) if column['pk']]
                    mutations.append({'sql': 'UPDATE ' + q(name) + ' SET ' + ','.join(q(field) + '=?' for field in update) + ' WHERE ' + ' AND '.join(q(field) + ' IS ?' for field in keys), 'params': [chosen[field] for field in update] + list(key)})
        merged[name] = list(result.values())
    if len(mutations) > MAX_MUTATIONS:
        raise ReconcileError('Atomic mutation count exceeds reviewed bound; do not split batch')
    expires = min(captured(source), captured(target)) + MAX_AGE
    guards = [assertion('unixepoch() BETWEEN ? AND ?', [now - 60, expires])]
    # Raw current schema is guarded, while all three imports were semantically
    # matched to reviewed migrations. D1 quoting normalization is not assumed.
    schema_rows = target['schema']
    equality = ' AND '.join('t.' + q(field) + ' IS json_extract(e.value,\'$."' + field + '"\')' for field in ('type', 'name', 'tbl_name', 'sql'))
    schema_where = "(name LIKE 'cms_%' OR (tbl_name LIKE 'cms_%' AND sql IS NOT NULL))"
    guards.append(assertion('(SELECT COUNT(*) FROM sqlite_schema WHERE ' + schema_where + ')=? AND NOT EXISTS (SELECT 1 FROM sqlite_schema t WHERE ' + schema_where + ' AND NOT EXISTS (SELECT 1 FROM json_each(?) e WHERE ' + equality + '))', [len(schema_rows), canonical(schema_rows)]))
    guards += [table_guard(name, contract['columns'][name], maps[2][name]) for name in ORDER]
    guards.append(sequence_guard(target['sqliteSequence']))
    maximum = max([row['seq'] for snapshot in (base, source, target) for row in snapshot['sqliteSequence']] + [row['id'] for row in merged['cms_permission_audit']] + [0])
    sequence = [{'name': 'cms_permission_audit', 'seq': maximum}] if any(snapshot['sqliteSequence'] for snapshot in (base, source, target)) else []
    if sequence != target['sqliteSequence']:
        mutations += [{'sql': 'UPDATE sqlite_sequence SET seq=? WHERE name=?', 'params': [maximum, 'cms_permission_audit']}, {'sql': 'INSERT INTO sqlite_sequence(name,seq) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)', 'params': ['cms_permission_audit', maximum, 'cms_permission_audit']}]
    final = [table_guard(name, contract['columns'][name], merged[name]) for name in ORDER] + [sequence_guard(sequence), assertion('NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check)')]
    batch = guards + mutations + final
    plan = {'format': 'cms-review-three-way-delta-v1', 'accountId': ACCOUNT_ID, 'databaseId': DATABASE_ID, 'databaseName': DATABASE_NAME, 'scope': SCOPE, 'baselineSha256': baseline_wrapper['sha256'], 'sourceSha256': source_wrapper['sha256'], 'targetSha256': target_wrapper['sha256'], 'expiresAt': expires, 'executor': 'ONE D1 binding DB.batch with bound params; never split or execute individually', 'batch': batch, 'summary': {'mutations': len(mutations), 'statements': len(batch), 'tableCounts': {name: len(rows) for name, rows in merged.items()}, 'preservedCloudflarePins': preserved_pins, 'targetMediaObjectsRetained': len(target_media), 'mediaWrites': 0, 'deletes': 0}, 'expectedRowsSha256': {name: digest(rows) for name, rows in merged.items()}}
    if rest_proof_sha:
        plan['executor'] = 'ONE bound D1 binding DB.batch OR ONE REST /query {batch:[...]} request with externally measured atomic rollback proof; never split or execute individually'
        plan['restAtomicityProofSha256'] = rest_proof_sha
    if len(batch) > 100 or len(canonical(plan).encode()) > MAX_BATCH_BYTES or any(len(item['params']) > 90 or len(item['sql'].encode()) > 90000 for item in batch):
        raise ReconcileError('Atomic batch exceeds reviewed bounds; do not split batch')
    return plan


def read_private(file):
    file = Path(file)
    if file.is_symlink() or file.stat().st_mode & 0o077 or file.stat().st_size > MAX_BYTES:
        raise ReconcileError('Input must be a bounded private regular file')
    return json.loads(file.read_text())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline', 'source', 'target', 'output'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--rest-atomicity-proof', help='Externally captured isolated bound REST batch rollback/success proof; enables single-request REST executor contract')
    args = parser.parse_args(argv)
    proof = None
    if args.rest_atomicity_proof:
        file = Path(args.rest_atomicity_proof)
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 16384:
            raise ReconcileError('Invalid external proof file')
        proof = json.loads(file.read_text())
    plan = plan_merge(read_private(args.baseline), read_private(args.source), read_private(args.target), baseline_sha=BASELINE_SHA, rest_atomicity_proof=proof)
    output = Path(args.output).absolute()
    resolved = output.parent.resolve()
    if (ROOT == resolved or ROOT in resolved.parents) and not (resolved == ROOT / 'var' or ROOT / 'var' in resolved.parents):
        raise ReconcileError('Private plans must not enter public/repository source directories')
    if resolved.stat().st_mode & 0o077:
        raise ReconcileError('Plan parent must be private')
    descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(canonical(plan) + '\n')
    print(canonical({'prepared': True, 'liveMutationPerformed': False, 'planSha256': digest(plan), **plan['summary']}))


if __name__ == '__main__':
    try:
        main()
    except Conflict as error:
        print(str(error))
        raise SystemExit(2) from None
    except Exception:
        # Never echo a raw snapshot/parser/SQL exception containing private data.
        print('{"prepared":false,"reason":"reconciliation_precondition_failed"}')
        raise SystemExit(1) from None
