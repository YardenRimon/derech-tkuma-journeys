import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('source_indexing', Path(__file__).with_name('source-indexing.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SourceIndexing(unittest.TestCase):
    def test_raw_head_only_robots_case_entities_and_none(self):
        tags, denied = m.raw_robots('<html><head><script>"<meta name=robots content=noindex>"</script><meta CONTENT="INDEX,follow" NAME="RoBoTs"><meta name="GoogleBot" content="no&#105;ndex"></head><body><meta name=robots content=index></body></html>')
        self.assertEqual(len(tags), 2)
        self.assertTrue(denied)
        self.assertTrue(m.raw_robots('<head><meta name=bingbot content="none"></head>')[1])
        self.assertFalse(m.raw_robots('<head><meta name=robots content="max-snippet:-1,index"></head>')[1])
        self.assertFalse(m.raw_robots('<head></head><body><meta name=robots content=noindex></body>')[1])

    def test_duplicate_meta_and_unsafe_routes_fail(self):
        with self.assertRaises(ValueError):
            m.raw_robots('<head><meta name=robots name=googlebot content=noindex></head>')
        for route in ('//evil/', '/a/../b/', '/a//b/', '/a/?x=1', '/%2e%2e/', '/api/private/', '/a\\b/', '/missing-slash'):
            with self.assertRaises(ValueError, msg=route):
                m.safe_route(route)

    def fixture(self, root):
        (root / 'source-pages').mkdir()
        provenance = {'version': 1, 'origin': m.ORIGIN, 'capturedAt': '2026-10-19T00:00:00Z', 'logicalPageCount': 37, 'pages': {}}
        manifest = {}
        for i in range(37):
            route = '/' if i == 0 else '/route-' + str(i) + '/'
            html = '<html><head>' + ('<meta name=robots content=noindex>' if i >= 33 else '<meta name=robots content=index>') + '</head><body></body></html>'
            name = 'current-' + format(i, '020x') + '.html.gz'
            raw = html.encode()
            (root / 'source-pages' / name).write_bytes(gzip.compress(raw))
            row = {'fixture': name, 'sourceSha256': hashlib.sha256(raw).hexdigest(), 'sourceUrl': m.ORIGIN + route}
            provenance['pages'][route] = row
            manifest[route] = {**row, 'canonical': m.ORIGIN + ('/' if i == 1 else route)}
        (root / 'source-pages/provenance.json').write_text(json.dumps(provenance))
        (root / 'source-manifest.json').write_text(json.dumps(manifest))
        return provenance, manifest

    def test_full_policy_pins_raw_sources_and_deduplicated_sitemap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            result = m.generate(root)
            self.assertEqual((result['routeCount'], len(result['noindexPaths']), result['expectedSitemapCount']), (37, 4, 32))
            pin = result.pop('policySha256')
            self.assertEqual(pin, m.sha(m.canonical_json(result).encode()))
            first = next(iter(result['pages'].values()))
            (root / 'source-pages' / first['fixture']).write_bytes(gzip.compress(b'<html>changed</html>'))
            with self.assertRaisesRegex(ValueError, 'hash_mismatch'):
                m.generate(root)

    def test_missing_extra_and_indexing_drift_refused(self):
        for variant in ('missing', 'extra', 'noindex'):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                provenance, manifest = self.fixture(root)
                if variant == 'missing':
                    manifest.pop('/route-2/')
                elif variant == 'extra':
                    manifest['/unexpected/'] = manifest['/']
                else:
                    name = provenance['pages']['/']['fixture']
                    raw = b'<head><meta name=robots content=noindex></head>'
                    (root / 'source-pages' / name).write_bytes(gzip.compress(raw))
                    provenance['pages']['/']['sourceSha256'] = manifest['/']['sourceSha256'] = m.sha(raw)
                (root / 'source-pages/provenance.json').write_text(json.dumps(provenance))
                (root / 'source-manifest.json').write_text(json.dumps(manifest))
                with self.assertRaises(ValueError):
                    m.generate(root)


if __name__ == '__main__':
    unittest.main()
