import hashlib
import tempfile
import unittest
from pathlib import Path
from verify import verify

class ExportBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = b'<meta name="robots" content="noindex,nofollow">'
        (self.root / 'index.html').write_bytes(self.data)
        self.manifest = {'files': [{'path': 'index.html', 'bytes': len(self.data),
                                   'sha256': hashlib.sha256(self.data).hexdigest()}]}
    def test_frozen_export(self):
        self.assertEqual(verify(self.root, self.manifest)['html_pages'], 1)
    def test_changed_bytes_rejected(self):
        (self.root / 'index.html').write_bytes(self.data + b'x')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            verify(self.root, self.manifest)
    def test_unlisted_secret_rejected(self):
        (self.root / '.env').write_text('private')
        with self.assertRaisesRegex(ValueError, 'Unlisted'):
            verify(self.root, self.manifest)
    def test_traversal_rejected(self):
        self.manifest['files'][0]['path'] = '../index.html'
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            verify(self.root, self.manifest)
    def test_symlink_rejected(self):
        (self.root / 'another.html').symlink_to(self.root / 'index.html')
        self.manifest['files'][0]['path'] = 'another.html'
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            verify(self.root, self.manifest)
    def test_indexable_staging_rejected(self):
        data = b'<meta name="robots" content="index,follow">'
        (self.root / 'index.html').write_bytes(data)
        self.manifest['files'][0].update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        with self.assertRaisesRegex(ValueError, 'indexing'):
            verify(self.root, self.manifest)

if __name__ == '__main__':
    unittest.main()
