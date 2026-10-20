"""Offline transport boundaries for the native/Cloudflare CMS export client."""
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cms_backup_download', Path(__file__).with_name('cms-backup-download.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SECRET = 'private-backup-fixture-secret-' * 2
SCOPE = {'tenantId': 'derech', 'siteId': 'derech-main'}
KEY = '00112233-4455-4677-8899-aabbccddeeff'
MEDIA = b'unchanged source media bytes'


class Response(io.BytesIO):
    def __init__(self, data, headers=None):
        super().__init__(data)
        self.headers = headers or {}


class BackupTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.requests = []
        self.snapshot = {
            'format': 'cms-backup-v1', 'scope': SCOPE,
            'tables': [{'name': 'fixture-history', 'count': 2}],
            'media': [{'key': KEY, 'etag': 'fixture-etag', 'size': len(MEDIA)}],
        }

    def config(self, origin=m.CLOUDFLARE_ORIGIN, **extra):
        value = {'url': origin, 'secret': SECRET, 'scope': SCOPE, **extra}
        file = self.root / 'config.json'
        file.write_text(json.dumps(value))
        file.chmod(0o600)
        return file

    def transport(self, request, timeout):
        self.requests.append(request)
        self.assertEqual(timeout, 120)
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.get_header('User-agent'), m.USER_AGENT)
        self.assertEqual(request.get_header('Content-type'), 'application/json')
        self.assertEqual(request.get_header('X-backup-time'), '1760000000')
        body = json.loads(request.data)
        self.assertEqual(request.data, m.canonical(body).encode())
        self.assertEqual(body['purpose'], 'cms-backup-v1')
        self.assertEqual(body['tenantId'], SCOPE['tenantId'])
        self.assertEqual(body['siteId'], SCOPE['siteId'])
        message = b'cms-backup-v1\nPOST\n/api/backup/\n1760000000\n' + request.data
        self.assertEqual(request.get_header('X-backup-signature'), hmac.new(SECRET.encode(), message, hashlib.sha256).hexdigest())
        if body['operation'] == 'snapshot':
            value = {'snapshot': self.snapshot, 'sha256': m.digest(m.canonical(self.snapshot).encode())}
            return Response(m.canonical(value).encode())
        self.assertEqual(body['operation'], 'object')
        self.assertEqual(body['key'], KEY)
        self.assertEqual(body['etag'], 'fixture-etag')
        return Response(MEDIA, {'x-content-sha256': m.digest(MEDIA), 'x-backup-etag': 'fixture-etag'})

    def run_download(self, config, transport=None, **options):
        opener = unittest.mock.Mock()
        opener.open.side_effect = transport or self.transport
        with patch.object(m.urllib.request, 'build_opener', return_value=opener) as build, patch.object(m.time, 'time', return_value=1760000000), contextlib.redirect_stdout(io.StringIO()) as output:
            result = m.download(config, self.root / 'backup', **options)
        self.assertIsInstance(build.call_args.args[0], m.NoRedirect)
        self.assertNotIn(SECRET, output.getvalue())
        return result

    def test_cloudflare_exact_requests_hmac_and_explicit_user_agent(self):
        result = self.run_download(self.config())
        self.assertEqual(len(self.requests), 2)
        for request in self.requests:
            self.assertEqual(request.full_url, m.CLOUDFLARE_ORIGIN + '/api/backup/')
            self.assertIsNone(request.get_header('Oai-sites-authorization'))
            self.assertIsNone(request.get_header('Authorization'))
        self.assertEqual((self.root / 'backup' / 'media' / KEY).read_bytes(), MEDIA)
        self.assertEqual(result['mediaTotalBytes'], len(MEDIA))

    def test_native_sites_preserves_existing_service_token_and_hmac(self):
        token = 'sites-service-fixture'
        self.run_download(self.config(m.SITES_ORIGIN + '/', siteAccessToken=token))
        for request in self.requests:
            self.assertEqual(request.full_url, m.SITES_ORIGIN + '/api/backup/')
            self.assertEqual(request.get_header('Oai-sites-authorization'), 'Bearer ' + token)

    def test_cf_rejects_any_provider_credential_field_before_network_or_output(self):
        for key in ('siteAccessToken', 'serviceToken', 'authorization', 'headers', 'cloudflareApiToken', 'cfAccessClientSecret', 'provider'):
            for value in ('sensitive-other-provider-credential', None, ''):
                with self.subTest(key=key, value=value):
                    config = self.config(**{key: value})
                    with patch.object(m.urllib.request, 'build_opener') as build, self.assertRaisesRegex(ValueError, 'cross-provider') as error:
                        m.download(config, self.root / 'backup')
                    build.assert_not_called()
                    self.assertFalse((self.root / 'backup').exists())
                    self.assertNotIn('sensitive-other-provider-credential', str(error.exception))

    def test_only_fixed_origins_are_allowed(self):
        for url in ('https://example.org', m.CLOUDFLARE_ORIGIN + '.evil.test', m.CLOUDFLARE_ORIGIN + ':443', m.SITES_ORIGIN + '/api/backup/', m.CLOUDFLARE_ORIGIN + '?token=secret', m.CLOUDFLARE_ORIGIN + '#fragment', 'https://secret@derech-tkuma-review.22yarden22.workers.dev', 'http://127.0.0.1:5174', 'https://localhost', 'http://localhost.evil.test:5174'):
            with self.subTest(url=url), patch.object(m.urllib.request, 'build_opener') as build, self.assertRaises(ValueError):
                m.download(self.config(url), self.root / 'backup')
            build.assert_not_called()
            self.assertFalse((self.root / 'backup').exists())

    def test_local_http_requires_explicit_flag_and_preserves_fixture_token(self):
        self.run_download(self.config('http://127.0.0.1:5174', siteAccessToken='local-fixture'), allow_local=True)
        self.assertEqual(self.requests[0].full_url, 'http://127.0.0.1:5174/api/backup/')
        self.assertEqual(self.requests[0].get_header('Oai-sites-authorization'), 'Bearer local-fixture')

    def test_local_flag_does_not_allow_remote_or_non_http_targets(self):
        for url in ('http://example.org', 'http://127.0.0.1.evil.test', 'file:///tmp/snapshot', 'https://127.0.0.1:5174'):
            with self.subTest(url=url), patch.object(m.urllib.request, 'build_opener') as build, self.assertRaises(ValueError):
                m.download(self.config(url), self.root / 'backup', allow_local=True)
            build.assert_not_called()

    def test_config_permissions_and_short_secret_fail_before_network(self):
        for case in ('world-readable', 'short-secret', 'missing-scope'):
            config = self.config()
            if case == 'world-readable':
                config.chmod(0o644)
            else:
                data = json.loads(config.read_text())
                if case == 'short-secret': data['secret'] = 'short'
                else: del data['scope']
                config.write_text(json.dumps(data))
            with self.subTest(case=case), patch.object(m.urllib.request, 'build_opener') as build, self.assertRaises(ValueError):
                m.download(config, self.root / 'backup')
            build.assert_not_called()

    def test_redirect_handler_never_forwards_credentials(self):
        with self.assertRaisesRegex(RuntimeError, 'redirects are refused'):
            m.NoRedirect().redirect_request(None, None, 302, 'Found', {}, 'https://evil.test/')

    def test_snapshot_scope_or_digest_mismatch_never_completes(self):
        for case in ('scope', 'digest'):
            with self.subTest(case=case):
                self.snapshot['scope'] = {'tenantId': 'other', 'siteId': 'other'} if case == 'scope' else SCOPE
                def bad(request, timeout):
                    value = {'snapshot': self.snapshot, 'sha256': '0' * 64 if case == 'digest' else m.digest(m.canonical(self.snapshot).encode())}
                    return Response(m.canonical(value).encode())
                with self.assertRaisesRegex(ValueError, 'digest or scope'):
                    self.run_download(self.config(), bad)
                self.assertFalse((self.root / 'backup' / 'manifest.json').exists())
                import shutil
                shutil.rmtree(self.root / 'backup')

    def test_response_limit_is_enforced_before_parse(self):
        class Oversized(Response):
            def read(self, maximum):
                return b'x' * maximum
        with self.assertRaisesRegex(ValueError, 'exceeds supported bound'):
            self.run_download(self.config(), lambda request, timeout: Oversized(b''))
        self.assertFalse((self.root / 'backup' / 'snapshot.json').exists())

    def test_media_identity_and_exact_bytes_are_required(self):
        for case in ('key', 'hash', 'size', 'etag'):
            with self.subTest(case=case):
                self.snapshot['media'][0]['key'] = '../unsafe' if case == 'key' else KEY
                def bad(request, timeout):
                    response = self.transport(request, timeout)
                    if json.loads(request.data)['operation'] == 'object':
                        return Response(MEDIA[:-1] if case == 'size' else MEDIA, {'x-content-sha256': '0' * 64 if case == 'hash' else m.digest(MEDIA), 'x-backup-etag': 'wrong' if case == 'etag' else 'fixture-etag'})
                    return response
                with self.assertRaises(ValueError):
                    self.run_download(self.config(), bad)
                self.assertFalse((self.root / 'backup' / 'manifest.json').exists())
                import shutil
                shutil.rmtree(self.root / 'backup')

    def test_cli_required_args_and_allow_local_forwarding(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            m.main([])
        self.assertEqual(error.exception.code, 2)
        with patch.object(m, 'download') as download:
            m.main(['--config', 'private.json', '--output', 'new-dir', '--allow-local'])
        download.assert_called_once_with('private.json', 'new-dir', True)


if __name__ == '__main__':
    unittest.main()
