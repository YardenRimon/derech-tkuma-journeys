#!/usr/bin/env python3
"""Prepared VPS-only backup handoff; no action without --execute.

Stage this script and the reviewed downloader on the existing VPS. Supply a
root0600 JSON media fixture {key,size,sha256} and the reviewed downloader SHA256.
Example (root, on the existing VPS, after CF backup/data acceptance):
  python3 handoff-cms-cloudflare-backup.py --downloader ./cms-backup-download.py \
    --downloader-sha256 REVIEWED_SHA --media-fixture /root/private-fixture.json
The first command is read-only precondition validation. Add --execute only after
review; it briefly stops/restarts the existing timer, never enables a new timer.

Preflight must pass BOTH the reviewed downloader and installed isolated restore.
An exact fixture preflight is distinct from independently decrypting/restoring
the service's resulting R2 archive, which remains a separate root acceptance.
No source/config rollback deletes archives, latest.json, reports or outbox rows.
"""
from __future__ import annotations
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tempfile

OLD = 'https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site'
NEW = 'https://derech-tkuma-review.22yarden22.workers.dev'
SCOPE = {'tenantId': 'derech', 'siteId': 'derech-main'}
BASE = Path('/var/lib/yarden-cms-backup')
CONFIG = Path('/etc/yarden-cms-backup.json')
DOWNLOADER = Path('/opt/yarden-cms-backup/cms-backup-download.py')
UNIT, TIMER = 'yarden-cms-backup.service', 'yarden-cms-backup.timer'
PINS = {
 str(DOWNLOADER): '0cec9fc7087182fd179c4012a54d36380009f7a34135c4dd4ac79c52ce83765c',
 '/opt/yarden-cms-backup/cms-backup-restore.py': 'c9b71c3d1e6fc5151ec3787cbe7d8a24043437d6e56a3461738ec6311af97fc8',
 '/opt/yarden-cms-backup/run.py': '7bda2538caab4a48acdeedea3c4225cdee42f3f5ed8025f44ce1465879a3b6b8',
 '/opt/yarden-cms-backup/backup_upload.py': '092d5e2ebb4157d873ea6aa77c4b7e43b3ae9b540a5dd1f101a51a5db4933594',
 '/opt/yarden-cms-backup/notify.py': 'f3086c68352d6bc7d6c7f66c1adc0c818442a5cfffe25339480186bb50f8483e',
 '/etc/systemd/system/yarden-cms-backup.service': '57ef279aab1ba1481315bf4646c23382d9bc9e366cedc6e9fb6ab79bf09450d2',
 '/etc/systemd/system/yarden-cms-backup.timer': '6a4f0878ebac3db0232ec0afd87a563c1688668b254103c4740622233d2d9dfe',
}

class HandoffError(ValueError): pass
def require(value, code):
    if not value: raise HandoffError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def stamp(): return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')

def private_read(path, *, mode=0o600, maximum=2_000_000):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'unsafe_path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == mode and info.st_size <= maximum, 'unsafe_file')
        raw = os.read(fd, maximum + 1); require(len(raw) <= maximum, 'file_bound')
        return raw
    finally: os.close(fd)

def atomic(path, raw, mode, gate):
    gate(); path = Path(path)
    require(not path.is_symlink(), 'unsafe_path')
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def migrate_config(value):
    require(isinstance(value, dict) and set(value) == {'url', 'secret', 'scope', 'siteAccessToken'}, 'old_config_shape')
    require(value['url'] in (OLD, OLD + '/') and value['scope'] == SCOPE, 'old_config_scope')
    require(isinstance(value['secret'], str) and len(value['secret']) >= 40 and isinstance(value['siteAccessToken'], str) and value['siteAccessToken'], 'old_config_credential')
    return {'url': NEW, 'secret': value['secret'], 'scope': value['scope']}

def fixture(value):
    require(isinstance(value, dict) and set(value) == {'key', 'size', 'sha256'}, 'fixture_shape')
    require(isinstance(value['key'], str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', value['key']), 'fixture_identity')
    require(type(value['size']) is int and 0 < value['size'] <= 5*1024*1024 and isinstance(value['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', value['sha256']), 'fixture_identity')
    return value

def fixture_proof(manifest, expected):
    require(manifest.get('format') == 'cms-backup-complete-v1' and manifest.get('scope') == SCOPE and isinstance(manifest.get('media'), list), 'preflight_scope')
    matched = [item for item in manifest['media'] if item.get('key') == expected['key']]
    require(len(matched) == 1 and matched[0] == expected, 'fixture_not_verified')

def result_proof(report, preflight, event, previous_created, started):
    require(event.get('kind') == 'success' and event.get('result') == 'success' and event.get('exitStatus') == 0 and event.get('offServerVerified') is True, 'service_not_verified')
    require(report.get('invocationId') == event.get('invocationId') and report.get('createdAt') == event.get('createdAt') and report['createdAt'] >= started and report['createdAt'] > previous_created, 'stale_service_capture')
    require(report.get('state') == 'offserver_copy_verified' and report.get('complete') is True and report.get('offServerCopyVerified') is True, 'copy_not_verified')
    proof = report.get('proof', {})
    require(proof.get('restored') is True and proof.get('isolated') is True and proof.get('scope') == SCOPE and proof.get('integrity') == 'ok' and proof.get('foreignKeys') == 'ok', 'restore_not_verified')
    require(len(proof.get('tableCounts', {})) == 11 and all(proof.get(key) == preflight.get(key) for key in ('tableCounts', 'rows', 'mediaObjects', 'mediaBytes')) and proof['mediaObjects'] >= 1, 'service_inventory_changed')
    # Snapshot SHA includes createdAt. Do not falsely compare separate exports or
    # claim that count equality proves decrypted archive fixture-byte parity.
    return {'origin': NEW, 'scope': SCOPE, 'createdAt': report['createdAt'], 'invocationId': report['invocationId'], 'rows': proof['rows'], 'mediaObjects': proof['mediaObjects'], 'mediaBytes': proof['mediaBytes'], 'offServerCopyVerified': True, 'mediaFixturePreflightVerified': True, 'serviceArchiveFixtureBytesIndependentlyRestored': False}

def command(args, *, timeout=20, failure='command_failed'):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    require(result.returncode == 0, failure)
    return result.stdout

def calendar():
    try:
        require(json.loads(command(['/usr/bin/python3', '/opt/yarden-time-policy/time_policy.py'])).get('allowed') is True, 'sacred_time_closed')
    except HandoffError: raise
    except Exception: raise HandoffError('sacred_time_closed') from None

def properties(unit):
    raw = command(['systemctl', 'show', unit, '--property=ActiveState,SubState,UnitFileState,DropInPaths,TimersCalendar'])
    return dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)

def inactive():
    value = properties(UNIT)
    require((value.get('ActiveState'), value.get('SubState')) in {('inactive', 'dead'), ('failed', 'failed')} and not value.get('DropInPaths'), 'backup_service_not_idle')

def calendar_spec(value):
    return value.split('; next_elapse=', 1)[0].strip()

def pinned(downloader_sha=None):
    for path, expected in PINS.items():
        if path == str(DOWNLOADER) and downloader_sha: expected = downloader_sha
        require(sha(private_read(path, mode=0o644)) == expected, 'installed_helper_changed')

@contextlib.contextmanager
def exclusive(path):
    require(not path.is_symlink(), 'unsafe_path')
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(info.st_uid == 0 and stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600, 'unsafe_lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally: os.close(fd)

def restore_files(config_raw, downloader_raw, *, gate=calendar, config=CONFIG, downloader=DOWNLOADER):
    # Explicit two-file rollback only. No archive/latest/report/outbox operations.
    atomic(config, config_raw, 0o600, gate)
    atomic(downloader, downloader_raw, 0o644, gate)

def execute(args):
    require(os.geteuid() == 0, 'deployment_owner_required')
    calendar(); pinned(); inactive()
    source = private_read(args.downloader, mode=0o644)
    require(re.fullmatch(r'[a-f0-9]{64}', args.downloader_sha256 or '') and sha(source) == args.downloader_sha256, 'new_downloader_identity')
    expected = fixture(json.loads(private_read(args.media_fixture)))
    old_raw = private_read(CONFIG); new_config = migrate_config(json.loads(old_raw))
    timer = properties(TIMER)
    require(timer.get('ActiveState') == 'active' and timer.get('SubState') == 'waiting' and timer.get('UnitFileState') == 'enabled' and not timer.get('DropInPaths') and '03:10:00 Asia/Jerusalem' in timer.get('TimersCalendar', ''), 'daily_timer_precondition')
    if not args.execute:
        return {'state': 'preconditions_verified_only', 'originFrom': OLD, 'originTo': NEW, 'mutated': False, 'fixtureIdentityValidated': True}
    require(BASE.is_dir() and not BASE.is_symlink() and BASE.stat().st_uid == 0 and stat.S_IMODE(BASE.stat().st_mode) == 0o700, 'private_state_directory')
    with exclusive(BASE / 'handoff.lock'):
        paused = False; changed = False; prior = None; work = None; outcome = None
        try:
            calendar(); command(['systemctl', 'stop', TIMER]); paused = True; inactive()
            require(properties(TIMER).get('ActiveState') == 'inactive', 'timer_pause_failed')
            calendar(); prior = Path(tempfile.mkdtemp(prefix='handoff-' + stamp() + '-', dir=BASE)); prior.chmod(0o700)
            atomic(prior / 'prior-config.json', old_raw, 0o600, calendar)
            old_source = private_read(DOWNLOADER, mode=0o644)
            atomic(prior / 'prior-downloader.py', old_source, 0o600, calendar)
            calendar(); work = Path(tempfile.mkdtemp(prefix='.handoff-work-', dir=BASE)); work.chmod(0o700)
            atomic(work / 'cloudflare-config.json', json.dumps(new_config, sort_keys=True).encode(), 0o600, calendar)
            previous = json.loads(private_read(BASE / 'latest.json'))
            with exclusive(BASE / 'backup.lock'):
                inactive(); calendar()
                command(['/usr/bin/python3', str(args.downloader), '--config', str(work / 'cloudflare-config.json'), '--output', str(work / 'capture')], timeout=600, failure='preflight_capture_failed')
                manifest = json.loads(private_read(work / 'capture/manifest.json'))
                fixture_proof(manifest, expected)
                require(sha(private_read(work / 'capture/media' / expected['key'], maximum=5*1024*1024)) == expected['sha256'], 'fixture_not_verified')
                calendar()
                preflight = json.loads(command(['/usr/bin/python3', '/opt/yarden-cms-backup/cms-backup-restore.py', '--backup', str(work / 'capture'), '--target', str(work / 'proof.sqlite'), '--migrations', '/opt/yarden-cms-backup/drizzle'], timeout=120, failure='preflight_restore_failed'))
                require(preflight.get('restored') is True and preflight.get('isolated') is True and preflight.get('scope') == SCOPE and preflight.get('integrity') == 'ok' and preflight.get('foreignKeys') == 'ok', 'preflight_restore_failed')
                pinned(); inactive(); require(private_read(CONFIG) == old_raw, 'config_changed')
                atomic(DOWNLOADER, source, 0o644, calendar); changed = True
                atomic(CONFIG, json.dumps(new_config, sort_keys=True).encode(), 0o600, calendar)
            # Existing service must acquire its own existing backup.lock.
            calendar(); inactive(); started = stamp()
            command(['systemctl', 'start', UNIT], timeout=660, failure='fresh_backup_service_failed')
            inactive(); pinned(args.downloader_sha256)
            require(json.loads(private_read(CONFIG)) == new_config, 'config_readback_changed')
            spec = importlib.util.spec_from_file_location('trusted_backup_notice_evidence', '/opt/yarden-cms-backup/notify.py')
            notice = importlib.util.module_from_spec(spec); spec.loader.exec_module(notice)
            event = notice.collect('success', helper=None)  # Evidence read only; no dispatch/sender call.
            report = json.loads(private_read(BASE / 'latest.json'))
            require(report == json.loads(private_read(BASE / 'last-attempt.json')) and notice.verified_copy(report), 'latest_attempt_mismatch')
            require(report.get('archive') == str(BASE / ('derech-cms-' + report.get('createdAt', '') + '.cms')), 'archive_scope')
            cipher = private_read(report['archive'], maximum=16*1024*1024)
            require(len(cipher) == report.get('ciphertextBytes') and sha(cipher) == report.get('ciphertextSha256'), 'ciphertext_readback_failed')
            evidence = result_proof(report, preflight, event, previous.get('createdAt', ''), started)
            atomic(prior / 'handoff-result.json', json.dumps(evidence, sort_keys=True).encode(), 0o600, calendar)
            outcome = {'state': 'cloudflare_backup_handoff_verified', **evidence, 'privatePrior': str(prior)}
            return outcome
        except BaseException:
            if changed:
                inactive()
                restore_files(old_raw, old_source)
            raise
        finally:
            if work is not None: shutil.rmtree(work, ignore_errors=True)
            if paused:
                # Never weaken sacred-time policy to repair a cutover. If closed
                # or service still active, leave paused and require root recovery.
                calendar(); inactive(); command(['systemctl', 'start', TIMER])
                value = properties(TIMER)
                require(value.get('ActiveState') == 'active' and value.get('UnitFileState') == timer['UnitFileState'] and calendar_spec(value.get('TimersCalendar', '')) == calendar_spec(timer.get('TimersCalendar', '')), 'daily_timer_restore_failed')
                if outcome is not None:
                    outcome.update(dailyTimerRestored=True, dailyTimerCalendar='03:10 Asia/Jerusalem')

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--downloader', type=Path, required=True)
    parser.add_argument('--downloader-sha256', required=True)
    parser.add_argument('--media-fixture', type=Path, required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv); os.umask(0o077)
    def interrupted(*_): raise HandoffError('handoff_interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        print(json.dumps(execute(args), sort_keys=True)); return 0
    except BaseException as error:
        code = str(error) if isinstance(error, HandoffError) else 'handoff_failed'
        print(json.dumps({'state': 'handoff_blocked_or_failed', 'code': code, 'manualTimerRecoveryMayBeRequired': True, 'businessArchivesAndLatestNeverDeletedOrRewound': True})); return 2

if __name__ == '__main__': raise SystemExit(main())
