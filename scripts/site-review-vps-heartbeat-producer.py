#!/usr/bin/env python3
"""One bounded heartbeat from the existing monitor runner. Never sends notices."""
import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import urllib.error
import urllib.request

ORIGIN = 'https://derech-vps-heartbeat.22yarden22.workers.dev'
ENDPOINT = ORIGIN + '/heartbeat'
CONFIG = Path('/etc/yarden-vps-heartbeat.json')
POLICY = '/opt/yarden-time-policy/time_policy.py'
UNITS = ('yarden-answer-broker.service', 'yarden-answer-worker.service')
HEALTH = (
    (Path('/var/lib/yarden-answer-broker/broker-health.json'), 'broker', 10001),
    (Path('/var/lib/yarden-answer-worker/worker-health.json'), 'worker', 990),
)
CONTAINER = 'yarden-shared-platform-derech-legacy-1'
MAX_BYTES = 32768


class HeartbeatError(Exception):
    """Only fixed internal codes; never interpolate a value or exception."""


def require(condition, code):
    if not condition: raise HeartbeatError(code)


def protected_json(path, *, uid, secret=False):
    path = Path(path)
    try:
        for parent in (path.parent, *path.parent.parents):
            info = parent.lstat()
            require(not stat.S_ISLNK(info.st_mode) and stat.S_ISDIR(info.st_mode)
                    and info.st_uid in (0, uid) and info.st_mode & 0o022 == 0, 'file_protection_invalid')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    except HeartbeatError:
        raise
    except Exception:
        raise HeartbeatError('file_unavailable') from None
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == uid
                and info.st_mode & 0o027 == 0 and info.st_size <= MAX_BYTES, 'file_protection_invalid')
        if secret:
            require(stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, 'file_protection_invalid')
        raw = os.read(fd, MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, 'file_protection_invalid')
        return json.loads(raw)
    except HeartbeatError:
        raise
    except Exception:
        raise HeartbeatError('file_unavailable') from None
    finally:
        os.close(fd)


def configuration(path=CONFIG, *, uid=0):
    value = protected_json(path, uid=uid, secret=True)
    require(isinstance(value, dict) and set(value) == {'version', 'enabled', 'origin', 'writeHmac'}
            and type(value['version']) is int and value['version'] == 1 and value['enabled'] is True
            and value['origin'] == ORIGIN and isinstance(value['writeHmac'], str)
            and re.fullmatch(r'[a-f0-9]{64}', value['writeHmac']) is not None, 'configuration_invalid')
    return value['writeHmac']


def allowed(*, execute=subprocess.run):
    try:
        result = execute(['/usr/bin/python3', POLICY], capture_output=True, text=True, timeout=3)
        value = json.loads(result.stdout)
        return (result.returncode == 0 and value.get('schema') == 'automation-time-policy/v1'
                and value.get('timezone') == 'Asia/Jerusalem' and value.get('allowed') is True)
    except Exception:
        return False


def file_ready(value, *, mode, now):
    try:
        require(isinstance(value, dict) and value.get('mode') == mode and value.get('state') == 'ready', 'health_invalid')
        at = datetime.fromisoformat(value['at'].replace('Z', '+00:00'))
        require(at.tzinfo is not None and at.utcoffset().total_seconds() == 0
                and 0 <= now-at.timestamp() <= 90, 'health_stale')
        return True
    except Exception:
        return False


def readiness(*, now, execute=subprocess.run, read=protected_json):
    """Fresh completed runtime cycles plus real existing container health.

    This establishes bounded VPS/runtime liveness, not CMS task completion,
    Telegram delivery, backup restoration or business integration acceptance.
    """
    try:
        result = execute(['/usr/bin/systemctl', 'show', *UNITS,
                          '--property=Id,ActiveState,SubState', '--no-pager'],
                         capture_output=True, text=True, timeout=4)
        require(result.returncode == 0 and len(result.stdout) <= 4096, 'unit_unavailable')
        units = {}
        for block in result.stdout.strip().split('\n\n'):
            fields = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
            require(fields.get('Id') in UNITS and fields['Id'] not in units, 'unit_scope_invalid')
            units[fields['Id']] = fields
        require(set(units) == set(UNITS) and all(
            fields.get('ActiveState') == 'active' and fields.get('SubState') == 'running'
            for fields in units.values()), 'unit_not_running')
        require(all(file_ready(read(path, uid=uid), mode=mode, now=now)
                    for path, mode, uid in HEALTH), 'runtime_not_ready')
        fmt = '{"running":{{json .State.Running}},"restarting":{{json .State.Restarting}},"health":{{json .State.Health.Status}},"failingStreak":{{json .State.Health.FailingStreak}}}'
        result = execute(['/usr/bin/docker', '--config', '/opt/yarden-site-monitor/docker-config',
                          'inspect', '--type', 'container', '--format', fmt, CONTAINER],
                         capture_output=True, text=True, timeout=4)
        require(result.returncode == 0 and len(result.stdout) <= 1024, 'container_unavailable')
        value = json.loads(result.stdout)
        return (isinstance(value, dict) and set(value) == {'running', 'restarting', 'health', 'failingStreak'}
                and value['running'] is True and value['restarting'] is False
                and value['health'] == 'healthy' and type(value['failingStreak']) is int
                and value['failingStreak'] == 0)
    except Exception:
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise HeartbeatError('redirect_rejected')


def upload(key, *, ready, at, open_url=None):
    require(type(at) is int and re.fullmatch(r'\d{10}', str(at)) is not None
            and type(ready) is bool and re.fullmatch(r'[a-f0-9]{64}', key) is not None, 'request_invalid')
    body = json.dumps({'schema': 'derech-vps-heartbeat/v1', 'observedAt': at, 'ready': ready},
                      sort_keys=True, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(body).hexdigest()
    signed = hmac.new(key.encode('utf-8'), f'POST\n/heartbeat\n{at}\n{digest}'.encode('utf-8'), hashlib.sha256).hexdigest()
    request = urllib.request.Request(ENDPOINT, data=body, method='POST', headers={
        'User-Agent': 'DerechVPSHeartbeat/1.0', 'Content-Type': 'application/json',
        'Cache-Control': 'no-store', 'X-Derech-Heartbeat-Time': str(at),
        'X-Derech-Heartbeat-Signature': signed,
    })
    # Ignore ambient proxy configuration: never disclose this purpose signature
    # to an unexpected proxy. TLS hostname validation retains Python defaults.
    open_url = open_url or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open
    try:
        with open_url(request, timeout=6) as response:
            require(response.status == 200 and response.geturl() == ENDPOINT, 'response_rejected')
            raw = response.read(1025)
            require(len(raw) <= 1024, 'response_rejected')
            value = json.loads(raw)
            require(isinstance(value, dict) and set(value) == {'accepted', 'observedAt', 'receivedAt'}
                    and value['accepted'] is True and type(value['observedAt']) is int
                    and value['observedAt'] == at and type(value['receivedAt']) is int
                    and abs(value['receivedAt']-at) <= 60, 'receipt_invalid')
    except HeartbeatError:
        raise
    except Exception:
        raise HeartbeatError('upload_failed') from None


def run(*, check=False, gate=allowed, load=configuration, collect=readiness, send=upload, clock=time.time):
    try:
        if gate() is not True: return {'state': 'time_policy_closed'}, 0
        key = None if check else load()
        started = clock()
        require(type(started) in (int, float) and 1_000_000_000 <= started < 10_000_000_000, 'clock_invalid')
        ready = collect(now=started)
        require(type(ready) is bool, 'health_invalid')
        if check: return {'state': 'readiness_checked', 'ready': ready}, 0 if ready else 1
        if gate() is not True: return {'state': 'time_policy_closed'}, 0
        finished = clock()
        require(type(finished) in (int, float) and 0 <= finished-started <= 25, 'clock_invalid')
        send(key, ready=ready, at=int(finished))
        return {'state': 'heartbeat_accepted', 'ready': ready}, 0
    except HeartbeatError as error:
        # Each locally raised code is fixed; do not print exception details.
        code = str(error) if str(error) in {'file_protection_invalid', 'file_unavailable',
            'configuration_invalid', 'health_invalid', 'clock_invalid', 'request_invalid',
            'redirect_rejected', 'response_rejected', 'receipt_invalid', 'upload_failed'} else 'producer_blocked'
        return {'state': 'heartbeat_blocked', 'code': code}, 2
    except Exception:
        return {'state': 'heartbeat_blocked', 'code': 'producer_blocked'}, 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Readiness only; never read the HMAC or make a network request')
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        print('{"state":"deployment_owner_required"}'); return 2
    report, code = run(check=args.check)
    print(json.dumps(report, sort_keys=True))
    return code


if __name__ == '__main__': raise SystemExit(main())
