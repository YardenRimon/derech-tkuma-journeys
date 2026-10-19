#!/usr/bin/env python3
"""Read protected Site observations; queue owner-only notices in the sole outbox.

No network probes, Telegram API, credentials, sender, poller or delivery retries.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from urllib.parse import quote

ORIGIN = 'https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site'
TARGET = 'sites'
TARGETS = {'sites': ORIGIN, 'cloudflare': 'https://derech-tkuma-review.22yarden22.workers.dev'}
LEDGER = 'site_review_notices'
_TARGET_SELECTED = False
OWNER, CHAT, BOT = 885011787, -5379385865, 8905221076
OPS = Path('/opt/yarden-platform/shared-ops')
MONITOR_STATE = Path('/var/lib/yarden-site-monitor/state.json')
TIME_POLICY = Path('/opt/yarden-time-policy')
CONTAINER = 'yarden-shared-platform-derech-legacy-1'
DOCKER_CONFIG = Path('/opt/yarden-site-monitor/docker-config')
PROBES = ('health', 'home', 'interior', 'asset')
CODES = {'ok', 'http_status', 'health_mismatch', 'noindex_missing', 'asset_mismatch',
         'redirect_rejected', 'response_origin_mismatch', 'response_too_large',
         'probe_target_rejected', 'probe_failed', 'transport_failed'}
STATES = {'queued', 'sending', 'sent', 'unknown', 'failed'}
ACTIONS = {
 'restore_review_noindex': ('חסימת האינדוקס חסרה באתר הבדיקה.', 'להחזיר noindex בכותרת HTTP ובתגית robots בעמודי הבדיקה ולפרוס גרסה מתוקנת.'),
 'inspect_review_release': ('בדיקת הגרסה ומוכנות המערכת של אתר הבדיקה אינה תקינה.', 'לבדוק את פריסת אתר הבדיקה מול גרסת התוכן המאושרת ואת מוכנות מסד הנתונים.'),
 'restore_review_asset': ('קובץ התצוגה שנבדק באתר הבדיקה שונה מהגרסה המאושרת.', 'להחזיר מהגרסה המאושרת את hooks.min.js ולבדוק התאמה לחתימה.'),
}

class AlertError(ValueError):
    pass

def require(condition, code):
    if not condition: raise AlertError(code)

def select_target(target):
    global TARGET, ORIGIN, LEDGER, MONITOR_STATE, RECOVERY, _TARGET_SELECTED
    require(target in TARGETS and (not _TARGET_SELECTED or target == TARGET), 'target_scope_invalid')
    TARGET, ORIGIN, _TARGET_SELECTED = target, TARGETS[target], True
    LEDGER = 'site_review_notices' if target == 'sites' else 'site_review_cf_notices'
    MONITOR_STATE = Path('/var/lib/yarden-site-monitor/' + ('state.json' if target == 'sites' else 'cloudflare-state.json'))
    RECOVERY = '✅ דרך התקומה — אתר הבדיקה\n\nבדיקות המוכנות, חסימת האינדוקס וקובץ התצוגה חזרו לתקינות.\n\n' + ORIGIN

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else encoded(value)).hexdigest()

def aware(value):
    require(isinstance(value, datetime) and value.tzinfo is not None, 'clock_invalid')
    return value.astimezone(timezone.utc)

def sacred_allowed(now):
    """Existing fail-closed authoritative calendar; no local approximation."""
    try:
        sys.path.insert(0, str(TIME_POLICY))
        from time_policy import evaluate
        value = evaluate(aware(now))
        return isinstance(value, dict) and value.get('allowed') is True
    except Exception:
        return False

def dependencies(directory=OPS):
    sys.path.insert(0, str(directory))
    import weekly_telegram as weekly
    from client_notifications import owner_dm
    return weekly, owner_dm

def evidence(snapshot, now):
    now = aware(now).timestamp()
    require(isinstance(snapshot, dict) and snapshot.get('version') == 1 and snapshot.get('origin') == ORIGIN, 'monitor_scope_invalid')
    history = snapshot.get('history')
    require(isinstance(history, list) and 1 <= len(history) <= 288, 'monitor_history_invalid')
    last = None
    for item in history:
        require(isinstance(item, dict) and type(item.get('ok')) is bool, 'monitor_observation_invalid')
        at, start = item.get('observedAt'), item.get('startedAt')
        require(type(at) in (int, float) and type(start) in (int, float) and 0 <= now-at <= 7*86400 and 0 <= at-start <= 60, 'monitor_clock_invalid')
        require(last is None or at > last, 'monitor_not_distinct'); last = at
        probes = item.get('probes')
        require(isinstance(probes, list) and len(probes) == 4 and [p.get('probe') for p in probes if isinstance(p, dict)] == list(PROBES), 'monitor_probe_shape')
        for probe in probes:
            require(probe.get('code') in CODES and (probe.get('status') is None or type(probe['status']) is int and 100 <= probe['status'] <= 599), 'monitor_probe_shape')
            require(type(probe.get('seconds')) in (int, float) and 0 <= probe['seconds'] <= 60, 'monitor_probe_shape')
            require(probe['code'] != 'ok' or probe['status'] == 200, 'monitor_probe_inconsistent')
        require(item['ok'] == all(p['code'] == 'ok' for p in probes), 'monitor_probe_inconsistent')
    require(snapshot.get('lastObservedAt') == last and now-last <= 90, 'monitor_stale')
    incident = snapshot.get('incident')
    if incident is not None:
        require(isinstance(incident, dict) and re.fullmatch(r'site-review:[1-9][0-9]*', incident.get('id', '')) and type(incident.get('firstSeen')) in (int, float) and 0 <= now-incident['firstSeen'] <= 30*86400, 'monitor_incident_invalid')
    return history, incident

def actions(item):
    codes = {p['probe']: p['code'] for p in item['probes']}
    return {action for action, present in (
        ('restore_review_noindex', codes['home'] == 'noindex_missing' or codes['interior'] == 'noindex_missing'),
        ('inspect_review_release', codes['health'] == 'health_mismatch'),
        ('restore_review_asset', codes['asset'] == 'asset_mismatch')) if present}

def qualifying(history, action):
    """Action-specific persistence: earlier unrelated failures cannot age it."""
    samples = []
    for item in reversed(history):
        if item['ok'] or action not in actions(item) or samples and samples[-1]['observedAt'] - item['observedAt'] > 720:
            break
        samples.append(item)
    return len(samples) >= 3 and samples[0]['observedAt'] - samples[-1]['observedAt'] >= 900

def open_text(action):
    body, step = ACTIONS[action]
    return '⚠️ דרך התקומה — אתר הבדיקה\n\n' + body + '\nהכשל חזר בבדיקות במשך15 דקות לפחות.\n\nפעולה שלך: ' + step + '\n\n' + ORIGIN

RECOVERY = '✅ דרך התקומה — אתר הבדיקה\n\nבדיקות המוכנות, חסימת האינדוקס וקובץ התצוגה חזרו לתקינות.\n\n' + ORIGIN

def outbox(db, key, text_hash):
    row = db.execute('SELECT * FROM outbox WHERE idempotency_key=?', (key,)).fetchone()
    require(row is not None and row['chat_id'] == OWNER and row['kind'] == 'report' and row['state'] in STATES and digest(row['text'].encode()) == text_hash and row['entities_json'] == '[]' and row['reply_markup'] is None, 'outbox_receipt_conflict')
    require(row['telegram_message_id'] is None or type(row['telegram_message_id']) is int, 'outbox_receipt_conflict')
    return row

def enqueue(db, key, text, now, gate):
    require(gate(now) is True, 'sacred_time_closed')
    require(db.execute('SELECT 1 FROM outbox WHERE idempotency_key=?', (key,)).fetchone() is None, 'untracked_outbox_conflict')
    # Same transaction and durable schema as the existing owner-alert helper and
    # Bridge.enqueue_report. No Bridge construction, initialization or sender.
    db.execute("INSERT INTO outbox(idempotency_key,chat_id,text,kind,state,created_at,updated_at,entities_json,reply_markup) VALUES(?,?,?,'report','queued',?,?,'[]',NULL)", (key, OWNER, text, now.isoformat(), now.isoformat()))

def process_snapshot(snapshot, db_path, config_path, *, now=None, gate=sacred_allowed, weekly=None, owner_dm=None, tenant=None):
    now = aware(now or datetime.now(timezone.utc)); require(gate(now) is True, 'sacred_time_closed')
    history, incident = evidence(snapshot, now)
    if weekly is None or owner_dm is None: weekly, owner_dm = dependencies()
    tenant = tenant or weekly.TENANTS['derech']
    require((tenant.slug, tenant.chat_id, tenant.owner_id, tenant.bot_id) == ('derech', CHAT, OWNER, BOT), 'tenant_scope_invalid')
    db_path = Path(db_path); original = weekly.protected_file(db_path, tenant.uid, tenant.gid, weekly.MAX_DB)
    config, _ = weekly.read_json(Path(config_path), tenant.uid, tenant.gid)
    if config.get('commercial_pending') is True or config.get('enabled') is False:
        return {'state': 'held', 'tenant_slug': 'derech', 'notices': [], 'deliveryVerified': False}
    for suffix in ('-wal', '-shm', '-journal'):
        path = Path(str(db_path) + suffix)
        if path.exists() or path.is_symlink(): weekly.protected_file(path, tenant.uid, tenant.gid, weekly.MAX_DB)
    summary = {'state': 'processed', 'tenant_slug': 'derech', 'notices': [], 'deliveryVerified': False}
    with sqlite3.connect('file:' + quote(str(db_path), safe='/') + '?mode=rw', uri=True, timeout=10) as db:
        db.row_factory = sqlite3.Row; db.execute('BEGIN IMMEDIATE')
        require(db_path.lstat().st_ino == original.st_ino, 'database_changed')
        weekly._identity(db, tenant, config)
        require({'entities_json', 'reply_markup', 'telegram_message_id', 'error'} <= {r[1] for r in db.execute('PRAGMA table_info(outbox)')}, 'outbox_schema_incompatible')
        require(gate(now) is True, 'sacred_time_closed')
        db.execute(f'''CREATE TABLE IF NOT EXISTS {LEDGER}(
            incident_id TEXT NOT NULL,action_code TEXT NOT NULL,origin TEXT NOT NULL,
            monitor_id TEXT NOT NULL,first_seen REAL NOT NULL,last_seen REAL NOT NULL,
            open_key TEXT NOT NULL UNIQUE,open_sha256 TEXT NOT NULL,
            recovery_key TEXT,recovery_sha256 TEXT,resolved_at TEXT,updated_at TEXT NOT NULL,
            PRIMARY KEY(incident_id,action_code))''')
        require(not db.execute(f'SELECT 1 FROM {LEDGER} WHERE origin<>? LIMIT 1', (ORIGIN,)).fetchone(), 'ledger_scope_conflict')
        if not history[-1]['ok']:
            require(incident is not None, 'monitor_incident_invalid')
            candidates = [action for action in ACTIONS if qualifying(history, action)]
            if not candidates:
                summary['state'] = 'internal_only' if not actions(history[-1]) else 'observing'
                return summary
            if not owner_dm(db, tenant):
                summary['state'] = 'pending_owner_start'; return summary
            ident = digest([ORIGIN, incident['id'], incident['firstSeen']])[:24]
            for action in candidates:
                key = 'site-review-open:derech:' + ident + ':' + action
                text = open_text(action); text_hash = digest(text.encode())
                prior = db.execute(f'SELECT * FROM {LEDGER} WHERE incident_id=? AND action_code=?', (ident, action)).fetchone()
                if prior:
                    require(prior['monitor_id'] == incident['id'] and prior['open_key'] == key and prior['open_sha256'] == text_hash, 'ledger_conflict')
                    row = outbox(db, key, text_hash)
                    summary['notices'].append({'state': 'duplicate', 'key': key, 'outboxState': row['state'], 'messageId': row['telegram_message_id']})
                else:
                    enqueue(db, key, text, now, gate)
                    db.execute(f'INSERT INTO {LEDGER} VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', (ident, action, ORIGIN, incident['id'], incident['firstSeen'], history[-1]['observedAt'], key, text_hash, None, None, None, now.isoformat()))
                    summary['notices'].append({'state': 'queued', 'key': key, 'outboxState': 'queued', 'messageId': None})
        else:
            for prior in db.execute(f'SELECT * FROM {LEDGER} WHERE resolved_at IS NULL').fetchall():
                require(prior['action_code'] in ACTIONS, 'ledger_action_invalid')
                opening = outbox(db, prior['open_key'], prior['open_sha256'])
                if opening['state'] == 'queued':
                    require(gate(now) is True, 'sacred_time_closed')
                    db.execute("UPDATE outbox SET state='failed',error='resolved_before_delivery',updated_at=? WHERE idempotency_key=? AND state='queued'", (now.isoformat(), prior['open_key']))
                    state = 'resolved_before_delivery'
                elif opening['state'] in ('sending', 'unknown') or opening['state'] == 'sent' and (type(opening['telegram_message_id']) is not int or opening['telegram_message_id'] <= 0):
                    summary['notices'].append({'state': 'recovery_deferred', 'key': prior['open_key'], 'outboxState': opening['state'], 'messageId': opening['telegram_message_id']}); continue
                elif opening['state'] == 'failed':
                    state = 'resolved_without_notification'
                else:
                    if not owner_dm(db, tenant):
                        summary['notices'].append({'state': 'pending_owner_start', 'key': prior['open_key']}); continue
                    key = 'site-review-recovery:derech:' + prior['incident_id'] + ':' + prior['action_code']
                    text_hash = digest(RECOVERY.encode())
                    if prior['recovery_key']:
                        require(prior['recovery_key'] == key and prior['recovery_sha256'] == text_hash, 'ledger_recovery_conflict')
                        row = outbox(db, key, text_hash); state = 'duplicate'
                    else:
                        enqueue(db, key, RECOVERY, now, gate)
                        db.execute(f'UPDATE {LEDGER} SET recovery_key=?,recovery_sha256=? WHERE incident_id=? AND action_code=?', (key, text_hash, prior['incident_id'], prior['action_code']))
                        state = 'queued'
                    summary['notices'].append({'state': state, 'key': key, 'outboxState': 'queued' if state == 'queued' else row['state'], 'messageId': None if state == 'queued' else row['telegram_message_id']})
                    state = 'resolved'
                db.execute(f'UPDATE {LEDGER} SET resolved_at=?,updated_at=? WHERE incident_id=? AND action_code=?', (now.isoformat(), now.isoformat(), prior['incident_id'], prior['action_code']))
                if state != 'resolved': summary['notices'].append({'state': state, 'key': prior['open_key']})
    return summary



def acceptance(stage, run_id, db_path, config_path, *, now=None, gate=sacred_allowed, weekly=None, owner_dm=None, tenant=None):
    """Explicitly labelled transport drill; never invents a real incident."""
    require(TARGET == 'sites', 'acceptance_scope_invalid')
    now = aware(now or datetime.now(timezone.utc)); require(gate(now) is True, 'sacred_time_closed')
    require(stage in ('open', 'recovery') and isinstance(run_id, str) and re.fullmatch(r'[0-9]{8}T[0-9]{6}Z', run_id), 'acceptance_scope_invalid')
    started = datetime.strptime(run_id, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    require(0 <= (now-started).total_seconds() <= 3600, 'acceptance_window_invalid')
    if weekly is None or owner_dm is None: weekly, owner_dm = dependencies()
    tenant = tenant or weekly.TENANTS['derech']
    require((tenant.slug, tenant.chat_id, tenant.owner_id, tenant.bot_id) == ('derech', CHAT, OWNER, BOT), 'tenant_scope_invalid')
    path = Path(db_path); original = weekly.protected_file(path, tenant.uid, tenant.gid, weekly.MAX_DB)
    config, _ = weekly.read_json(Path(config_path), tenant.uid, tenant.gid)
    for suffix in ('-wal', '-shm', '-journal'):
        side = Path(str(path)+suffix)
        if side.exists() or side.is_symlink(): weekly.protected_file(side, tenant.uid, tenant.gid, weekly.MAX_DB)
    texts = {
      'open': '🧪 בדיקת ניטור מבוקרת — דרך התקומה\n\nזהו ניסוי של מסירת הודעה פרטית דרך תור ההתראות הקיים. מצב האתר החי לא משמש כתקלה בניסוי זה. אין צורך בפעולה שלך.',
      'recovery': '🧪 בדיקת ניטור מבוקרת — דרך התקומה\n\nמסלול הודעת החזרה נבדק לאחר שקבלת Telegram אישרה את הודעת הניסוי הראשונה. זו בדיקת מסירה, ללא טענה שההודעה נקראה. אין צורך בפעולה שלך.'}
    with sqlite3.connect('file:'+quote(str(path),safe='/')+'?mode=rw', uri=True, timeout=10) as db:
        db.row_factory = sqlite3.Row; db.execute('BEGIN IMMEDIATE')
        require(path.lstat().st_ino == original.st_ino, 'database_changed'); weekly._identity(db, tenant, config)
        require(owner_dm(db, tenant), 'acceptance_owner_unverified')
        require(gate(now) is True, 'sacred_time_closed')
        db.execute('CREATE TABLE IF NOT EXISTS site_review_acceptance(run_id TEXT NOT NULL,stage TEXT NOT NULL,outbox_key TEXT NOT NULL UNIQUE,text_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(run_id,stage))')
        if stage == 'recovery':
            opening = db.execute("SELECT * FROM site_review_acceptance WHERE run_id=? AND stage='open'", (run_id,)).fetchone()
            require(opening is not None, 'acceptance_opening_missing')
            row = outbox(db, opening['outbox_key'], opening['text_sha256'])
            if row['state'] != 'sent' or type(row['telegram_message_id']) is not int or row['telegram_message_id'] <= 0:
                return {'state':'recovery_deferred','tenant_slug':'derech','outboxState':row['state'],'messageId':row['telegram_message_id'],'fixture':True}
        key = 'site-review-acceptance:derech:'+run_id+':'+stage
        text = texts[stage]; text_hash = digest(text.encode())
        previous = db.execute('SELECT * FROM site_review_acceptance WHERE run_id=? AND stage=?',(run_id,stage)).fetchone()
        if previous:
            require(previous['outbox_key'] == key and previous['text_sha256'] == text_hash, 'acceptance_ledger_conflict')
            row = outbox(db,key,text_hash)
            return {'state':'duplicate','tenant_slug':'derech','key':key,'outboxState':row['state'],'messageId':row['telegram_message_id'],'fixture':True}
        enqueue(db,key,text,now,gate)
        db.execute('INSERT INTO site_review_acceptance VALUES(?,?,?,?,?)',(run_id,stage,key,text_hash,now.isoformat()))
        return {'state':'queued','tenant_slug':'derech','key':key,'outboxState':'queued','messageId':None,'fixture':True}


def readback(db_path, config_path, *, weekly=None, tenant=None):
    if weekly is None: weekly, _ = dependencies()
    tenant = tenant or weekly.TENANTS['derech']
    require((tenant.slug, tenant.chat_id, tenant.owner_id, tenant.bot_id) == ('derech', CHAT, OWNER, BOT), 'tenant_scope_invalid')
    path = Path(db_path); weekly.protected_file(path, tenant.uid, tenant.gid, weekly.MAX_DB)
    config, _ = weekly.read_json(Path(config_path), tenant.uid, tenant.gid)
    with sqlite3.connect('file:' + quote(str(path), safe='/') + '?mode=ro', uri=True, timeout=10) as db:
        db.row_factory = sqlite3.Row; weekly._identity(db, tenant, config)
        result = []
        exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (LEDGER,)).fetchone()
        for entry in db.execute(f'SELECT * FROM {LEDGER} ORDER BY updated_at DESC LIMIT 10') if exists else []:
            require(entry['origin'] == ORIGIN, 'ledger_scope_conflict')
            for kind in ('open', 'recovery'):
                if not entry[kind + '_key']: continue
                row = outbox(db, entry[kind + '_key'], entry[kind + '_sha256'])
                result.append({'kind': kind, 'key': row['idempotency_key'], 'outboxState': row['state'], 'messageId': row['telegram_message_id'], 'deliveryVerified': row['state'] == 'sent' and type(row['telegram_message_id']) is int and row['telegram_message_id'] > 0})
        if TARGET == 'sites' and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_review_acceptance'").fetchone():
            for entry in db.execute('SELECT * FROM site_review_acceptance ORDER BY created_at DESC LIMIT 4'):
                row = outbox(db, entry['outbox_key'], entry['text_sha256'])
                result.append({'kind': 'acceptance_'+entry['stage'], 'key': row['idempotency_key'], 'outboxState': row['state'], 'messageId': row['telegram_message_id'], 'fixture': True, 'deliveryVerified': row['state'] == 'sent' and type(row['telegram_message_id']) is int and row['telegram_message_id'] > 0})
        return {'state': 'readback', 'tenant_slug': 'derech', 'notices': result}



def invoke_container(code, raw):
    """No Compose plugin/home-config discovery under ProtectHome=yes.

    The existing Docker socket reaches exactly the already-running sole tenant
    container; this never creates, starts, restarts or scales a service.
    """
    result = subprocess.run(['docker', '--config', str(DOCKER_CONFIG), 'exec', '-i', CONTAINER, 'python3', '-c', code], input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    require(result.returncode == 0 and len(result.stdout) <= 16384, 'container_process_failed')
    return result.stdout


def host_dispatch(snapshot, ops_directory=OPS, *, readonly=False, acceptance_stage=None, run_id=None):
    # Bounded in-container execution path; stage code in our own
    # owner-only temporary directory instead of replacing shared /tmp modules.
    child_directory = '/tmp/derech-site-review-alerts' + ('-cloudflare' if TARGET == 'cloudflare' else '')
    def stage(name, raw):
        code = "import os,sys,stat;from pathlib import Path;p=Path("+repr(child_directory)+");p.mkdir(mode=0o700,exist_ok=True);s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o700;f=p/"+repr(name)+";t=p/('.'+f.name+'.'+str(os.getpid()));d=os.open(t,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);o=os.fdopen(d,'wb');o.write(sys.stdin.buffer.read());o.close();os.replace(t,f)"
        invoke_container(code, raw)
    for name in ('organic_import.py', 'tenant_holds.py', 'weekly_telegram.py', 'client_notifications.py'):
        stage(name, (Path(ops_directory) / name).read_bytes())
    stage('site_review_alerts.py', Path(__file__).read_bytes())
    code = "import json,sys;sys.path.insert(0,"+repr(child_directory)+");import site_review_alerts as a;a.select_target("+repr(TARGET)+");w,o=a.dependencies("+repr(child_directory)+");"
    if readonly:
        code += "print(json.dumps(a.readback('/data/bridge.sqlite3','/data/runtime.json',weekly=w)))"
    elif acceptance_stage:
        code += "v=json.loads(sys.stdin.read());print(json.dumps(a.acceptance(v['stage'],v['runId'],'/data/bridge.sqlite3','/data/runtime.json',weekly=w,owner_dm=o)))"
    else:
        code += "print(json.dumps(a.process_snapshot(json.loads(sys.stdin.read()),'/data/bridge.sqlite3','/data/runtime.json',weekly=w,owner_dm=o)))"
    payload = {'stage':acceptance_stage,'runId':run_id} if acceptance_stage else snapshot
    return json.loads(invoke_container(code, b'' if readonly else encoded(payload)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path)
    parser.add_argument('--target', choices=tuple(TARGETS), default='sites')
    parser.add_argument('--ops-directory', type=Path, default=OPS)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--readback', action='store_true')
    mode.add_argument('--acceptance-stage', choices=('open','recovery'), help='Explicit owner-private labelled transport drill; no fake real outage')
    parser.add_argument('--run-id', help='UTC YYYYMMDDTHHMMSSZ, at most one hour old, required for explicit drill')
    args = parser.parse_args(argv)
    try:
        select_target(args.target)
        args.state = args.state or MONITOR_STATE
        require(os.geteuid() == 0, 'deployment_owner_required')
        if args.readback:
            result = host_dispatch(None, args.ops_directory, readonly=True)
        elif args.acceptance_stage:
            require(sacred_allowed(datetime.now(timezone.utc)) is True, 'sacred_time_closed')
            result = host_dispatch(None, args.ops_directory, acceptance_stage=args.acceptance_stage, run_id=args.run_id)
        else:
            require(sacred_allowed(datetime.now(timezone.utc)) is True, 'sacred_time_closed')
            spec = importlib.util.spec_from_file_location('site_review_monitor', Path(__file__).with_name('site-review-monitor.py'))
            monitor = importlib.util.module_from_spec(spec); spec.loader.exec_module(monitor)
            snapshot = monitor.protected_json(args.state)
            evidence(snapshot, datetime.now(timezone.utc))
            result = host_dispatch(snapshot, args.ops_directory)
        print(json.dumps(result, ensure_ascii=False)); return 0
    except Exception as error:
        codes = {'sacred_time_closed', 'deployment_owner_required', 'monitor_scope_invalid', 'monitor_history_invalid', 'monitor_clock_invalid', 'monitor_not_distinct', 'monitor_probe_shape', 'monitor_stale', 'monitor_incident_invalid', 'monitor_probe_inconsistent', 'outbox_receipt_conflict', 'ledger_scope_conflict', 'container_process_failed', 'target_scope_invalid'}
        code = str(error) if isinstance(error, AlertError) and str(error) in codes else 'site_alert_adapter_blocked'
        print(json.dumps({'state': 'blocked', 'code': code, 'deliveryVerified': False})); return 2

if __name__ == '__main__': raise SystemExit(main())
