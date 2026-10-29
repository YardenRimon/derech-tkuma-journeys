import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('snapshot_assets', Path(__file__).with_name('source-snapshot-assets.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class StaticSnapshotAssets(unittest.TestCase):
    def setUp(self):
        self.ns = '/__source_assets__/wordpress-public-20261028/'
        self.paths = {
            'wp-content/plugins/test/img/a.png': self.ns + 'wp-content/plugins/test/img/a.png',
            'wp-content/fonts/main.css': self.ns + 'wp-content/fonts/main.css',
            'wp-includes/fonts/שלום עולם.woff2': self.ns + 'wp-includes/fonts/שלום עולם.woff2',
            'wp-content/uploads/תמונה אחת.png': self.ns + 'wp-content/uploads/תמונה אחת.png',
            '_external/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/webfonts/fa-solid-900.woff2': self.ns + '_external/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/webfonts/fa-solid-900.woff2',
        }

    def test_original_css_context_not_stale_cache_context(self):
        body = b'a{background:url(../img/a.png?ver=42#mask)}'
        changed, ledger, _ = m.rewrite_css(body, 'wp-content/plugins/test/css/style.css', self.paths)
        self.assertEqual(changed, ('a{background:url(' + self.ns + 'wp-content/plugins/test/img/a.png?ver=42#mask)}').encode())
        self.assertEqual(len(ledger), 1)
        with self.assertRaisesRegex(ValueError, 'unmapped_local'):
            m.rewrite_css(body, 'wp-content/cache/min/1/wp-content/plugins/test/css/style.css', self.paths)

    def test_import_root_absolute_protocol_relative_and_unicode(self):
        css = '@import "/wp-content/fonts/main.css?v=1&mode=rtl#top";a{src:url("https://derech-tkuma.com/wp-includes/fonts/שלום עולם.woff2?ver=2")}b{background:url(//www.derech-tkuma.com/wp-content/uploads/%D7%AA%D7%9E%D7%95%D7%A0%D7%94%20%D7%90%D7%97%D7%AA.png)}'
        result, patches, _ = m.rewrite_css(css.encode(), 'wp-content/test.css', self.paths)
        self.assertEqual(len(patches), 3)
        self.assertIn(b'main.css?v=1&mode=rtl#top', result)
        self.assertIn(b'%D7%A9%D7%9C%D7%95%D7%9D%20%D7%A2%D7%95%D7%9C%D7%9D.woff2?ver=2', result)
        self.assertNotIn(b'//www.', result)

    def test_css_escape_hex_space(self):
        body = b'a{src:url(/wp-includes/fonts/\\5e9 \\5dc \\5d5 \\5dd \\20 \\5e2 \\5d5 \\5dc \\5dd .woff2)}'
        result, _, _ = m.rewrite_css(body, 'wp-content/a.css', self.paths)
        self.assertIn(b'%D7%A9%D7%9C%D7%95%D7%9D%20%D7%A2%D7%95%D7%9C%D7%9D.woff2', result)

    def test_embedded_external_and_fragment_preserved_exactly(self):
        body = b'/* url(no.png) */a{content:"url(fake.png)";background:url(data:image/svg+xml;base64,AAAA);filter:url(#shadow);src:url(https://cdn.trustindex.io/font.woff2?ver=1)}'
        result, patches, preserved = m.rewrite_css(body, 'wp-content/a.css', self.paths)
        self.assertEqual(result, body)
        self.assertEqual(patches, [])
        self.assertEqual(preserved['embedded_or_fragment'], 2)
        self.assertEqual(preserved['blocked_external_or_scheme_preserved'], 1)

    def test_vendor_exception_only_exact_eight_paths(self):
        path = '_external/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/webfonts/fa-solid-900.woff2'
        self.assertFalse(m.permitted(path))
        self.assertTrue(m.permitted(path, {path}))
        self.assertFalse(m.permitted(path.replace('900', '901'), {path}))
        css, _, _ = m.rewrite_css(('a{src:url(/' + path + ')}').encode(), 'wp-content/vendor.css', self.paths)
        self.assertIn(self.ns.encode(), css)

    def test_exact_reviewed_trustindex_urls_map_locally(self):
        aliases = {url: '_external/' + m.U.urlsplit(url).netloc + m.U.urlsplit(url).path
                   for url in m.TRUSTINDEX_SOURCE_URLS}
        mapping = {path: self.ns + path for path in aliases.values()}
        for url, path in aliases.items():
            self.assertFalse(m.permitted(path))
            self.assertTrue(m.permitted(path, historic_external_paths=set(aliases.values())))
            css, patches, _ = m.rewrite_css(('a{src:url("' + url + '")}').encode(),
                'wp-content/uploads/trustindex-google-widget.css', mapping, aliases)
            self.assertEqual(css, ('a{src:url("' + self.ns + path + '")}').encode())
            self.assertEqual(len(patches), 1)
        url = sorted(aliases)[0]
        for changed in (url + '?v=2', url + '#x', url.replace('https:', 'http:'),
                        url.replace('https:', ''), url.replace('.woff2', '-new.woff2')):
            result, patches, _ = m.rewrite_css(('a{src:url("' + changed + '")}').encode(),
                'wp-content/uploads/trustindex-google-widget.css', mapping, aliases)
            self.assertIn(changed.encode(), result)
            self.assertEqual(patches, [])
        with self.assertRaisesRegex(ValueError, 'unreviewed_external_alias'):
            m.resolve_url('wp-content/other.css', url, mapping, aliases)
        bad = dict(aliases)
        bad[url] = sorted(aliases.values())[-1]
        with self.assertRaisesRegex(ValueError, 'unreviewed_external_alias'):
            m.resolve_url('wp-content/uploads/trustindex-google-widget.css', url, mapping, bad)

    def test_historic_reuse_requires_exact_observed_and_recorded_url_authority(self):
        urls = sorted(m.TRUSTINDEX_SOURCE_URLS)
        recorded = {url: '/_external/' + m.U.urlsplit(url).netloc + m.U.urlsplit(url).path
                    for url in urls}
        frozen = {path.lstrip('/'): {} for path in recorded.values()}
        refs = [{'scheme': 'https', 'host': 'cdn.trustindex.io', 'path': m.U.urlsplit(url).path,
                 'source_css': 'wp-content/uploads/trustindex-google-widget.css',
                 'source_provenance': 'fresh_archive', 'syntax': 'url', 'query_keys': [],
                 'fragment_present': False, 'value_sha256': m.sha(url.encode())}
                for url in urls + urls[:9]]
        self.assertEqual(len(m.reviewed_external_reuse({'externalReferences': refs}, frozen, recorded)), 21)
        bad_recorded = dict(recorded)
        bad_recorded[urls[0]] = '/_external/cdn.trustindex.io/unreviewed.woff2'
        with self.assertRaisesRegex(ValueError, 'url_authority_missing'):
            m.reviewed_external_reuse({'externalReferences': refs}, frozen, bad_recorded)
        with self.assertRaisesRegex(ValueError, 'url_authority_missing'):
            m.reviewed_external_reuse({'externalReferences': refs}, {}, recorded)
        bad_refs = [dict(row) for row in refs]
        bad_refs[0]['value_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'unreviewed_historic'):
            m.reviewed_external_reuse({'externalReferences': bad_refs}, frozen, recorded)
        with self.assertRaisesRegex(ValueError, 'reference_count_changed'):
            m.reviewed_external_reuse({'externalReferences': refs[:-1]}, frozen, recorded)

    def test_excluded_tracking_and_private_executables(self):
        for path in ('wp-content/plugins/google-analytics-for-wordpress/frontend.js',
                     'wp-content/plugins/woocommerce/assets/js/sourcebuster/sourcebuster.min.js',
                     'wp-content/plugins/woocommerce/assets/js/frontend/order-attribution.min.js',
                     'wp-content/uploads/elementor/forms/signature.png',
                     'wp-content/uploads/export/customer.json',
                     'wp-content/plugins/demo/run.php'):
            self.assertFalse(m.permitted(path), path)

    def test_traversal_encoding_and_scheme_safety(self):
        for path in ('../wp-content/a.css', '/wp-content/a.css', 'wp-content/a/../b.css',
                     'wp-content//b.css', 'wp-content/a\\b.css', 'wp-content/%2e%2e/a.css',
                     'C:/wp-content/a.css', 'wp-content/a\x00.css'):
            with self.assertRaises(ValueError, msg=path):
                m.canonical(path)
        with self.assertRaises(ValueError):
            m.resolve_url('wp-content/a.css', '/wp-content/%2e%2e/secret.css', self.paths)
        self.assertEqual(m.resolve_url('wp-content/a.css', 'javascript:alert(1)', self.paths)[1], 'blocked_external_or_scheme_preserved')

    def test_no_patch_retains_utf8_bom_and_bytes(self):
        body = b'\xef\xbb\xbf/* harmless */a{color:red}'
        result, patches, _ = m.rewrite_css(body, 'wp-content/a.css', self.paths)
        self.assertEqual(result, body)
        self.assertEqual(patches, [])

    def test_unknown_local_and_malformed_css_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'unmapped_local'):
            m.rewrite_css(b'a{background:url(/wp-content/missing.png)}', 'wp-content/a.css', self.paths)
        for css in ('a{src:url("unterminated)}', '/* never closes', 'a{src:u\\72l(x.png)}'):
            with self.assertRaises(ValueError):
                m.rewrite_css(css.encode(), 'wp-content/a.css', self.paths)


if __name__ == '__main__':
    unittest.main()
