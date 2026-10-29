import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery_bundle', Path(__file__).with_name('recovery-bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class RecoveryParts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.cert, cls.key = cls.root / 'cert.pem', cls.root / 'key.pem'
        cls.passphrase = cls.root / 'passphrase'
        cls.passphrase.write_text('synthetic-recovery-test-only')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-days', '1',
            '-subj', '/CN=isolated-synthetic-recovery', '-passout', 'file:' + str(cls.passphrase),
            '-keyout', str(cls.key), '-out', str(cls.cert)], check=True, capture_output=True)
        cls.source = cls.root / 'opaque.zip'
        # More than two bounded parts, opaque bytes: never ZIP-extracted.
        with cls.source.open('wb') as handle:
            for index in range(17):
                handle.write(bytes([index]) * (1024 * 1024))
        cls.source.chmod(0o600)
        cls.sha = bundle.digest(cls.source)
        cls.stamp = '20261028T150947Z'
        cls.parts = cls.root / 'parts'
        cls.manifest = bundle.prepare(cls.source, cls.parts, cls.cert, cls.stamp, cls.sha, cls.source.stat().st_size)
        cls.receipt = json.loads((cls.parts / 'bundle-receipt.private.json').read_text())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_full_independent_openssl_decrypt_and_whole_reassembly(self):
        with tempfile.TemporaryDirectory(dir=self.root) as dest:
            output = Path(dest) / 'restored.zip'
            report = bundle.restore(self.parts / self.receipt['file'], self.parts, output,
                self.cert, self.key, self.passphrase, self.receipt['sha256'])
            self.assertEqual(report, {'restored': True, 'sourceBytes': 17 * 1024 * 1024,
                'sourceSha256': self.sha, 'createdAt': self.stamp, 'parts': 3, 'sourceExecuted': False})
            self.assertEqual(bundle.digest(output), self.sha)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(bundle.BundleError):
                bundle.restore(self.parts / self.receipt['file'], self.parts, output,
                    self.cert, self.key, self.passphrase, self.receipt['sha256'])

    def test_resume_is_byte_identical_and_preserves_original_capture(self):
        before = {p.name: bundle.digest(p) for p in self.parts.iterdir()}
        repeated = bundle.prepare(self.source, self.parts, self.cert, self.stamp, self.sha, self.source.stat().st_size)
        self.assertEqual(repeated, self.manifest)
        self.assertEqual({p.name: bundle.digest(p) for p in self.parts.iterdir()}, before)
        self.assertFalse((self.parts / 'latest.json').exists())
        self.assertFalse((self.parts / 'last-attempt.json').exists())
        for path in self.parts.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_reordered_duplicate_traversal_and_wrong_size_are_rejected(self):
        for change in ['reorder', 'duplicate', 'traversal', 'size', 'extra', 'boolean']:
            value = copy.deepcopy(self.manifest)
            if change == 'reorder':
                value['parts'].reverse()
            elif change == 'duplicate':
                value['parts'][1] = value['parts'][0]
            elif change == 'traversal':
                value['parts'][0]['file'] = '../opaque.zip'
            elif change == 'size':
                value['parts'][0]['plainBytes'] -= 1
            elif change == 'extra':
                value['parts'][0]['url'] = 'https://foreign.invalid/forbidden'
            else:
                value['sourceBytes'] = True
            with self.subTest(change=change), self.assertRaises(bundle.BundleError):
                bundle.validate_manifest(value)

    def test_ciphertext_tamper_and_unknown_manifest_hash_never_publish_output(self):
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            directory = Path(directory)
            for path in self.parts.iterdir():
                (directory / path.name).write_bytes(path.read_bytes())
                (directory / path.name).chmod(0o600)
            bad = directory / self.manifest['parts'][0]['file']
            with bad.open('r+b') as handle:
                handle.seek(500)
                handle.write(b'BAD')
            target = directory / 'restored.zip'
            with self.assertRaises(bundle.BundleError):
                bundle.restore(directory / self.receipt['file'], directory, target,
                    self.cert, self.key, self.passphrase, self.receipt['sha256'])
            self.assertFalse(target.exists())
            with self.assertRaises(bundle.BundleError):
                bundle.restore(self.parts / self.receipt['file'], self.parts, target,
                    self.cert, self.key, self.passphrase, '0' * 64)
            self.assertFalse(target.exists())

    def test_manifest_cipher_tamper_cannot_be_resumed_as_prepared(self):
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            directory = Path(directory)
            for path in self.parts.iterdir():
                (directory / path.name).write_bytes(path.read_bytes())
                (directory / path.name).chmod(0o600)
            cipher = directory / self.receipt['file']
            with cipher.open('r+b') as handle:
                handle.seek(100)
                handle.write(b'BAD')
            with self.assertRaises(bundle.BundleError):
                bundle.prepare(self.source, directory, self.cert, self.stamp, self.sha, self.source.stat().st_size)

    def test_wrong_whole_manifest_binding_fails_after_decrypt(self):
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            directory = Path(directory)
            value = copy.deepcopy(self.manifest)
            value['sourceSha256'] = '0' * 64
            plain, cipher = directory / 'wrong.json', directory / 'wrong.cms'
            plain.write_text(json.dumps(value))
            bundle.encrypt(plain, cipher, self.cert)
            output = directory / 'restored.zip'
            with self.assertRaises(bundle.BundleError):
                bundle.restore(cipher, self.parts, output, self.cert, self.key,
                    self.passphrase, bundle.digest(cipher))
            self.assertFalse(output.exists())

    def test_source_contract_symlinks_permissions_and_incomplete_state(self):
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            directory = Path(directory)
            link = directory / 'linked.zip'
            link.symlink_to(self.source)
            for source, sha, size in [(link, self.sha, self.source.stat().st_size),
                    (self.source, '0' * 64, self.source.stat().st_size),
                    (self.source, self.sha, bundle.LIMIT + 1)]:
                with self.assertRaises(bundle.BundleError):
                    bundle.prepare(source, directory / 'new', self.cert, self.stamp, sha, size)
            incomplete = directory / 'incomplete'
            incomplete.mkdir(mode=0o700)
            (incomplete / 'retained.cms').write_bytes(b'keep')
            with self.assertRaises(bundle.BundleError):
                bundle.prepare(self.source, incomplete, self.cert, self.stamp, self.sha, self.source.stat().st_size)
            self.assertEqual((incomplete / 'retained.cms').read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
