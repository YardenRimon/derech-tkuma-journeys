#!/usr/bin/env python3
"""Bounded read-only Site probe. Produces incident candidates; never sends notices."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = 'https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site'
CONFIG = Path('/etc/yarden-answer-cms.json')
ASSET = '/wp-includes/js/dist/hooks.min.js'
ASSET_SHA = 'fc774906082b59dedcfc55b8ef127783b6d056578ff4586a8ebbdb81bbe286f1'
PROBES = (('health', '/api/health'), ('home', '/'), ('interior', '/התצפיות/'), ('asset', ASSET))
MAX_BODY = 2_000_000
MAX_GAP = 12 * 60
PERSISTENCE = 15 * 60

class ProbeError(Exception):
    """Contains only a fixed public error code."""

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ProbeError('redirect_rejected')

class RobotsParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.noindex = False
    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag.lower() == 'meta' and (fields.get('name') or '').lower() == 'robots':
            self.noindex |= 'noindex' in {x.strip().lower() for x in (fields.get('content') or '').split(',')}

def protected_json(path, *, owner_uid=0, limit=MAX_BODY):
    path = Path(path)
    if path.is_symlink() or path.parent.is_symlink():
        raise ProbeError('private_file_invalid')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o027 or info.st_size > limit:
            raise ProbeError('private_file_invalid')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ProbeError('private_file_invalid')
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise ProbeError('private_json_invalid') from None
    finally:
        os.close(descriptor)

def service_token(path=CONFIG, *, owner_uid=0):
    value = protected_json(path, owner_uid=owner_uid)
    if not isinstance(value, dict) or value.get('version') != 1 or value.get('origin') != ORIGIN or value.get('enabled') is not True:
        raise ProbeError('service_configuration_invalid')
    token = value.get('serviceToken')
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9._~-]{16,4095}', token):
        raise ProbeError('service_credential_unavailable')
    # Deliberately never consume the application's HMAC secret.
    return token

def request(path, token):
    if path not in {p for _, p in PROBES}:
        raise ProbeError('probe_target_rejected')
    url = ORIGIN + urllib.parse.quote(path, safe='/-._~')
    headers = {'User-Agent': 'DerechReviewMonitor/1', 'Cache-Control': 'no-cache'}
    if token:
        headers['OAI-Sites-Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, headers=headers, method='GET')
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=8) as response:
            if response.geturl() != url:
                raise ProbeError('response_origin_mismatch')
            body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise ProbeError('response_too_large')
            return response.status, {k.lower(): v for k, v in response.headers.items()}, body
    except urllib.error.HTTPError as error:
        # Do not read/log error pages, request headers, provider messages or URLs.
        return error.code, {}, b''

def observe(release, token=None, *, transport=request, clock=time.time, monotonic=time.monotonic):
    if not isinstance(release, str) or not re.fullmatch(r'[a-f0-9]{64}', release):
        raise ProbeError('expected_release_invalid')
    started = clock(); results = []
    for name, path in PROBES:
        begin = monotonic(); code = 'ok'; status = None
        try:
            status, headers, body = transport(path, token)
            if status != 200:
                code = 'http_status'
            elif name == 'health':
                try:
                    value = json.loads(body)
                except (ValueError, UnicodeError):
                    value = None
                if not isinstance(value, dict) or value.get('status') != 'ready' or value.get('mode') != 'review' or value.get('contentRelease') != release or value.get('pages') != 37:
                    code = 'health_mismatch'
            elif name in ('home', 'interior'):
                parser = RobotsParser(); parser.feed(body.decode('utf-8'))
                header_noindex = 'noindex' in {x.strip().lower() for x in headers.get('x-robots-tag', '').split(',')}
                if not header_noindex or not parser.noindex:
                    code = 'noindex_missing'
            elif hashlib.sha256(body).hexdigest() != ASSET_SHA:
                code = 'asset_mismatch'
        except ProbeError as error:
            code = str(error) if str(error) in ('redirect_rejected', 'response_origin_mismatch', 'response_too_large', 'probe_target_rejected') else 'probe_failed'
        except Exception:
            code = 'transport_failed'
        elapsed = max(0, round(monotonic() - begin, 3))
        results.append({'probe': name, 'status': status if type(status) is int else None, 'code': code, 'seconds': elapsed})
    ended = clock()
    return {'observedAt': ended, 'startedAt': started, 'ok': all(x['code'] == 'ok' for x in results), 'probes': results}

def transition(state, observation, *, now, opening_receipt=None):
    """Fresh distinct failed samples, bounded gaps; no notification without a sender."""
    state = json.loads(json.dumps(state or {'version': 1, 'origin': ORIGIN, 'generation': 0, 'history': [], 'events': []}))
    if state.get('version') != 1 or state.get('origin') != ORIGIN:
        raise ProbeError('state_scope_invalid')
    observed = observation.get('observedAt'); started = observation.get('startedAt')
    if type(observed) not in (int, float) or type(started) not in (int, float) or not 0 <= now - observed <= 90 or not 0 <= observed - started <= 60 or type(observation.get('ok')) is not bool:
        raise ProbeError('observation_clock_invalid')
    previous_at = state.get('lastObservedAt')
    if previous_at is not None and observed <= previous_at:
        raise ProbeError('observation_not_distinct')
    state['history'] = [x for x in state.get('history', []) if now - x['observedAt'] <= 7 * 86400][-287:] + [observation]
    state['lastObservedAt'] = observed
    incident = state.get('incident'); event = None
    if not observation['ok']:
        if not incident or incident.get('resolvedAt') is not None:
            state['generation'] += 1
            incident = {'id': 'site-review:' + str(state['generation']), 'firstSeen': observed, 'lastSeen': observed, 'failures': 1, 'openCandidate': False, 'openingSent': False, 'recoveryCandidate': False}
        elif observed - incident['lastSeen'] > MAX_GAP and not incident['openCandidate']:
            incident.update(firstSeen=observed, lastSeen=observed, failures=1)
        else:
            incident.update(lastSeen=observed, failures=incident['failures'] + 1)
        if not incident['openCandidate'] and incident['failures'] >= 3 and observed - incident['firstSeen'] >= PERSISTENCE:
            incident['openCandidate'] = True
            event = {'id': incident['id'] + ':open', 'kind': 'actionable_open', 'incidentId': incident['id'], 'at': observed}
        status = 'actionable_open' if incident['openCandidate'] else 'observing'
    else:
        status = 'healthy'
        if incident and incident['openCandidate']:
            # A protected receipt is an operator assertion of actual Telegram API acceptance.
            if opening_receipt is not None:
                valid = isinstance(opening_receipt, dict) and opening_receipt.get('version') == 1 and opening_receipt.get('origin') == ORIGIN and opening_receipt.get('incidentId') == incident['id'] and opening_receipt.get('eventId') == incident['id'] + ':open' and opening_receipt.get('state') == 'sent' and type(opening_receipt.get('messageId')) is int and opening_receipt['messageId'] > 0
                if not valid:
                    raise ProbeError('opening_receipt_invalid')
                incident['openingSent'] = True
            if incident['openingSent'] and not incident['recoveryCandidate']:
                incident.update(recoveryCandidate=True, resolvedAt=observed)
                event = {'id': incident['id'] + ':recovery', 'kind': 'actionable_recovery', 'incidentId': incident['id'], 'at': observed}
                status = 'actionable_recovery'
            elif not incident['openingSent']:
                status = 'recovery_pending_receipt'
        elif incident:
            incident['resolvedAt'] = observed
    if incident:
        state['incident'] = incident
    if event:
        state['events'] = (state.get('events', []) + [event])[-100:]
    return state, {'state': status, 'newEvent': event, 'ok': observation['ok'], 'observedAt': observed, 'probes': observation['probes'], 'deliveryIntegrated': False}

def atomic_json(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, separators=(',', ':'), allow_nan=False); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--release-file', type=Path, default=Path(__file__).resolve().parents[1] / 'platform-cms/lib/site-release.json')
    parser.add_argument('--service-config', type=Path, default=CONFIG)
    parser.add_argument('--opening-receipt', type=Path)
    parser.add_argument('--public-only', action='store_true', help='No service credential; origin protections may return403')
    args = parser.parse_args(argv); os.umask(0o077)
    try:
        directory = args.state.parent
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or args.state.is_symlink():
            raise ProbeError('private_state_invalid')
        lock = directory / (args.state.name + '.lock')
        with os.fdopen(os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'r+') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            previous = protected_json(args.state, owner_uid=os.geteuid()) if args.state.exists() else None
            release = json.loads(args.release_file.read_text())['contentRelease']
            token = None if args.public_only else service_token(args.service_config)
            observation = observe(release, token)
            receipt = protected_json(args.opening_receipt) if args.opening_receipt else None
            state, output = transition(previous, observation, now=time.time(), opening_receipt=receipt)
            atomic_json(args.state, state)
        print(json.dumps(output, separators=(',', ':'), allow_nan=False))
        return 0 if observation['ok'] else 1
    except Exception as error:
        allowed = {'private_file_invalid', 'private_json_invalid', 'private_state_invalid', 'service_configuration_invalid', 'service_credential_unavailable', 'expected_release_invalid', 'state_scope_invalid', 'observation_clock_invalid', 'observation_not_distinct', 'opening_receipt_invalid'}
        code = str(error) if isinstance(error, ProbeError) and str(error) in allowed else 'monitor_unavailable'
        print(json.dumps({'state': 'blocked', 'code': code, 'deliveryIntegrated': False}))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
