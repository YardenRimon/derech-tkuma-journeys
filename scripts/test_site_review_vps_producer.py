import contextlib
from datetime import datetime, timezone
import hashlib
import hmac
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('vps_producer', HERE / 'site-review-vps-heartbeat-producer.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
NOW = 1792523800
KEY = 'a' * 64
SECRET = 'sensitive-canary-never-printed'


def health(mode, at=NOW, state='ready'):
    return {'at': datetime.fromtimestamp(at, timezone.utc).isoformat(), 'mode': mode, 'state': state,
            'privateExtra': SECRET}


def execute(args, **kwargs):
    if args[0] == '/usr/bin/systemctl':
        return SimpleNamespace(returncode=0, stdout='\n\n'.join('Id='+u+'\nActiveState=active\nSubState=running' for u in m.UNITS))
    return SimpleNamespace(returncode=0, stdout=json.dumps({'running': True, 'restarting': False, 'health': 'healthy', 'failingStreak': 0}))


class ProducerReadinessTests(unittest.TestCase):
    def test_actual_unit_file_cycles_and_container_health_are_all_required(self):
        read = lambda path, uid: health('broker' if 'broker' in str(path) else 'worker')
        self.assertTrue(m.readiness(now=NOW, execute=execute, read=read))
        for at, state in [(NOW-91, 'ready'), (NOW+1, 'ready'), (NOW, 'error'), (NOW, 'waiting_login')]:
            self.assertFalse(m.readiness(now=NOW, execute=execute,
                read=lambda path, uid: health('broker' if 'broker' in str(path) else 'worker', at, state)))
        self.assertFalse(m.readiness(now=NOW, execute=execute, read=lambda path, uid: health('other')))
        self.assertFalse(m.readiness(now=NOW, execute=execute, read=Mock(side_effect=OSError(SECRET))))
        for process in [SimpleNamespace(returncode=1, stdout=SECRET), SimpleNamespace(returncode=0, stdout='Id=other\nActiveState=active\nSubState=running')]:
            self.assertFalse(m.readiness(now=NOW, execute=lambda *a, **k: process, read=read))
        for update in [{'health': 'unhealthy'}, {'running': False}, {'restarting': True}, {'failingStreak': 1}, {'failingStreak': False}]:
            def fail_docker(args, **kwargs):
                if args[0] == '/usr/bin/systemctl': return execute(args, **kwargs)
                value = {'running': True, 'restarting': False, 'health': 'healthy', 'failingStreak': 0}; value.update(update)
                return SimpleNamespace(returncode=0, stdout=json.dumps(value))
            self.assertFalse(m.readiness(now=NOW, execute=fail_docker, read=read))

    def test_calendar_is_exact_fail_closed_and_checked_before_loading_or_network(self):
        good = {'schema': 'automation-time-policy/v1', 'timezone': 'Asia/Jerusalem', 'allowed': True}
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=json.dumps(good)))
        self.assertTrue(m.allowed(execute=runner))
        self.assertEqual(runner.call_args.args[0], ['/usr/bin/python3', '/opt/yarden-time-policy/time_policy.py'])
        for delta in [{'allowed': 1}, {'allowed': False}, {'timezone': 'UTC'}, {'schema': 'other'}]:
            value = dict(good); value.update(delta)
            self.assertFalse(m.allowed(execute=lambda *a, **k: SimpleNamespace(returncode=0, stdout=json.dumps(value))))
        self.assertFalse(m.allowed(execute=Mock(side_effect=TimeoutError(SECRET))))
        load, collect, send = Mock(), Mock(), Mock()
        report, code = m.run(gate=lambda: False, load=load, collect=collect, send=send)
        self.assertEqual((report['state'], code), ('time_policy_closed', 0))
        load.assert_not_called(); collect.assert_not_called(); send.assert_not_called()
        report, code = m.run(gate=Mock(side_effect=[True, False]), load=lambda: KEY,
            collect=lambda **kw: True, send=send, clock=lambda: NOW)
        self.assertEqual(report['state'], 'time_policy_closed'); send.assert_not_called()

    def test_protected_config_exact_scope_permissions_and_no_extra_secret(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            directory = Path(directory); directory.chmod(0o700)
            path = directory / 'config.json'
            value = {'version': 1, 'enabled': True, 'origin': m.ORIGIN, 'writeHmac': KEY}
            path.write_text(json.dumps(value)); path.chmod(0o600)
            self.assertEqual(m.configuration(path, uid=os.getuid()), KEY)
            path.chmod(0o640)
            with self.assertRaises(m.HeartbeatError): m.configuration(path, uid=os.getuid())
            path.chmod(0o600)
            for extra in [{'siteAccessToken': SECRET}, {'origin': 'https://foreign.invalid'}, {'enabled': 1}, {'version': True}]:
                changed = dict(value); changed.update(extra); path.write_text(json.dumps(changed))
                with self.assertRaises(m.HeartbeatError) as caught: m.configuration(path, uid=os.getuid())
                self.assertNotIn(SECRET, str(caught.exception))
            path.write_text(json.dumps(value))
            alias = directory / 'alias'; alias.symlink_to(path)
            with self.assertRaises(m.HeartbeatError): m.configuration(alias, uid=os.getuid())
            hardlink = directory / 'hardlink'; os.link(path, hardlink)
            with self.assertRaises(m.HeartbeatError): m.configuration(path, uid=os.getuid())
            hardlink.unlink()
            fifo = directory / 'fifo'; os.mkfifo(fifo, mode=0o600)
            with self.assertRaises(m.HeartbeatError): m.configuration(fifo, uid=os.getuid())


class ProducerTransportTests(unittest.TestCase):
    def test_python_signed_payload_is_accepted_by_javascript_receiver(self):
        node = shutil.which('node') or '/private/tmp/derech-npm-runtime/bin/node'
        if not Path(node).exists(): self.skipTest('Node required for cross-runtime HMAC fixture')
        script = r'''
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
globalThis.crypto ??= webcrypto;
const {handle} = await import(process.argv[1]);
const input = JSON.parse(readFileSync(0,'utf8'));
let saved;
const response = await handle(new Request(input.url,{method:'POST',headers:input.headers,body:input.body}),{
  HEARTBEAT_WRITE_HMAC:'a'.repeat(64),HEARTBEAT_READ_HMAC:'b'.repeat(64),
  HEARTBEAT_BUCKET:{get:async()=>null,put:async(k,v)=>{saved=JSON.parse(v);return{etag:'1'};}}
},input.at);
console.log(JSON.stringify({status:response.status,receipt:await response.json(),ready:saved?.ready}));
'''
        def transport(request, timeout):
            payload = {'url': request.full_url, 'headers': dict(request.header_items()),
                       'body': request.data.decode(), 'at': NOW}
            result = subprocess.run([node, '--input-type=module', '-e', script,
                (HERE / 'site-review-vps-heartbeat-worker.mjs').as_uri()], input=json.dumps(payload),
                capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            value = json.loads(result.stdout)
            self.assertEqual(value['status'], 200); self.assertIs(value['ready'], False)
            return self.response(status=value['status'], value=value['receipt'])
        m.upload(KEY, ready=False, at=NOW, open_url=transport)

    def response(self, *, at=NOW, url=m.ENDPOINT, status=200, value=None):
        value = value or {'accepted': True, 'observedAt': at, 'receivedAt': at}
        response = Mock(); response.status = status
        response.geturl.return_value = url; response.read.return_value = json.dumps(value).encode()
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        return response

    def test_fixed_origin_exact_signed_boolean_only_payload_and_bounded_receipt(self):
        transport = Mock(return_value=self.response())
        m.upload(KEY, ready=False, at=NOW, open_url=transport)
        request = transport.call_args.args[0]
        self.assertEqual(request.full_url, m.ENDPOINT); self.assertEqual(request.method, 'POST')
        value = json.loads(request.data)
        self.assertEqual(value, {'schema': 'derech-vps-heartbeat/v1', 'observedAt': NOW, 'ready': False})
        message = f'POST\n/heartbeat\n{NOW}\n{hashlib.sha256(request.data).hexdigest()}'.encode()
        headers = {a.lower(): b for a, b in request.header_items()}
        self.assertEqual(headers['x-derech-heartbeat-signature'], hmac.new(KEY.encode(), message, hashlib.sha256).hexdigest())
        self.assertNotIn(KEY, request.data.decode()); self.assertNotIn(SECRET, str(value))
        self.assertEqual(transport.call_args.kwargs['timeout'], 6)
        for response in [self.response(url='https://foreign.invalid'), self.response(status=302),
                         self.response(value={'accepted': True, 'observedAt': NOW, 'receivedAt': NOW+61}),
                         self.response(value={'accepted': 1, 'observedAt': NOW, 'receivedAt': NOW})]:
            with self.assertRaises(m.HeartbeatError): m.upload(KEY, ready=True, at=NOW, open_url=lambda *a, **k: response)
        response = self.response(); response.read.return_value = b'x'*1025
        with self.assertRaises(m.HeartbeatError): m.upload(KEY, ready=True, at=NOW, open_url=lambda *a, **k: response)
        with self.assertRaisesRegex(m.HeartbeatError, 'redirect_rejected'): m.NoRedirect().redirect_request(None)

    def test_negative_health_still_posts_false_and_check_never_loads_key(self):
        send = Mock()
        report, code = m.run(gate=lambda: True, load=lambda: KEY, collect=lambda **kw: False, send=send, clock=lambda: NOW)
        self.assertEqual((report['state'], report['ready'], code), ('heartbeat_accepted', False, 0))
        send.assert_called_once_with(KEY, ready=False, at=NOW)
        load, send = Mock(), Mock()
        report, code = m.run(check=True, gate=lambda: True, load=load, collect=lambda **kw: True, send=send, clock=lambda: NOW)
        self.assertEqual((report['state'], code), ('readiness_checked', 0))
        load.assert_not_called(); send.assert_not_called()

    def test_clock_reversal_long_collection_and_any_transport_error_never_expose_values(self):
        for end in [NOW-1, NOW+26, float('inf'), float('nan')]:
            send = Mock()
            report, code = m.run(gate=lambda: True, load=lambda: KEY, collect=lambda **kw: True,
                send=send, clock=Mock(side_effect=[NOW, end]))
            self.assertEqual(code, 2); send.assert_not_called()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            report, code = m.run(gate=lambda: True, load=lambda: KEY, collect=lambda **kw: True,
                send=Mock(side_effect=RuntimeError(SECRET)), clock=lambda: NOW)
        self.assertEqual(code, 2)
        self.assertNotIn(KEY, json.dumps(report)); self.assertNotIn(SECRET, json.dumps(report)+output.getvalue())


if __name__ == '__main__': unittest.main()
