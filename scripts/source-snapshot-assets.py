#!/usr/bin/env python3
"""Build a private, versioned static asset proposal from pinned offline evidence.

Never writes the canonical public tree, fetches URLs or executes source code.
The public map's Unicode path values are URI-encoded only at HTML/CSS emission.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import urllib.parse as U

EXTENSIONS = {'.css', '.js', '.svg', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico',
              '.avif', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm', '.mp3', '.ogg'}
TRACKING = re.compile(r'googletagmanager|google-analytics|monsterinsights|frontend-gtag|fbevents|hotjar|clarity|maspik-signals|sourcebuster|order-attribution', re.I)
PRIVATE = re.compile(r'(^|/)(?:dup-installer|backups?|wc-logs|woocommerce_uploads|private|exports?)(?:/|$)|uploads/elementor/forms/', re.I)
ORIGINS = ('derech-tkuma.com', 'www.derech-tkuma.com')
MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILES = 5000

# Exact source-CSS URLs reviewed for frozen historic reuse; no provider-wide rule.
TRUSTINDEX_SOURCE_URLS = frozenset((
    'https://cdn.trustindex.io/assets/fonts/poppins/devanagari-600.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/devanagari-italic-600.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/devanagari-italic.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/devanagari.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-600.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-ext-600.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-ext-italic-600.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-ext-italic.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-ext.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-italic-600.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin-italic.woff2',
    'https://cdn.trustindex.io/assets/fonts/poppins/latin.woff2',
    'https://cdn.trustindex.io/assets/icon/ti-info-light.svg',
    'https://cdn.trustindex.io/assets/icon/ti-info-regular.svg',
    'https://cdn.trustindex.io/assets/icon/ti-quote.svg',
    'https://cdn.trustindex.io/assets/icon/ti-verified-black.svg',
    'https://cdn.trustindex.io/assets/icon/ti-verified-green.svg',
    'https://cdn.trustindex.io/assets/icon/ti-verified.svg',
    'https://cdn.trustindex.io/assets/img/loading_dots.gif',
    'https://cdn.trustindex.io/assets/platform/Trustindex/icon.svg',
    'https://cdn.trustindex.io/assets/platform/Trustindex/star/s.svg',
))


def need(value, code):
    if not value:
        raise ValueError(code)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def canonical(path):
    need(isinstance(path, str) and path and not path.startswith('/'), 'path_must_be_relative')
    need('\\' not in path and ':' not in path and not any(ord(c) < 32 or ord(c) == 127 for c in path), 'unsafe_path')
    need(all(p and p not in ('.', '..') for p in path.split('/')), 'path_traversal')
    need(not re.search(r'%(?:2e|2f|5c|00)', path, re.I), 'residual_encoded_path')
    return path


def permitted(path, vendor_paths=(), historic_external_paths=()):
    path = canonical(path)
    if path in historic_external_paths:
        return Path(path).suffix.lower() in {'.woff2', '.svg', '.gif'}
    if path in vendor_paths:
        return Path(path).suffix.lower() in {'.ttf', '.woff2'}
    return (path.startswith(('wp-content/', 'wp-includes/')) and
            Path(path).suffix.lower() in EXTENSIONS and not PRIVATE.search(path) and
            not (Path(path).suffix.lower() in {'.css', '.js'} and TRACKING.search(path)))


def no_symlinks(path):
    path = Path(os.path.abspath(path))
    need(not any(p.is_symlink() for p in (path, *path.parents)), 'filesystem_symlink')
    return path


def file_hash(path):
    path = no_symlinks(path)
    need(path.is_file() and path.stat().st_size <= MAX_FILE, 'source_file_type_or_size')
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return {'bytes': path.stat().st_size, 'sha256': h.hexdigest()}


def css_unescape(value):
    def sub(m):
        raw = m[1]
        if re.fullmatch(r'[0-9a-fA-F]{1,6}[ \t\r\n\f]?', raw):
            n = int(raw.strip(), 16)
            return chr(n) if 0 < n <= 0x10FFFF else '\ufffd'
        return '' if raw in ('\n', '\r', '\r\n', '\f') else raw
    return re.sub(r'\\([0-9a-fA-F]{1,6}[ \t\r\n\f]?|\r\n|[\s\S])', sub, value)


def css_tokens(text):
    """Return URL content spans; untouched comments/strings are never rewritten."""
    n = len(text)
    tokens = []

    def ws(i):
        while i < n:
            if text[i].isspace():
                i += 1
            elif text.startswith('/*', i):
                end = text.find('*/', i + 2)
                need(end >= 0, 'unterminated_css_comment')
                i = end + 2
            else:
                break
        return i

    def quoted(i):
        quote = text[i]
        start = i + 1
        i += 1
        while i < n:
            if text[i] == '\\':
                i += 2
            elif text[i] == quote:
                return start, i, i + 1, quote
            else:
                i += 1
        raise ValueError('unterminated_css_string')

    i = 0
    while i < n:
        if text.startswith('/*', i):
            i = ws(i)
            continue
        if text[i] in ('"', "'"):
            _, _, i, _ = quoted(i)
            continue
        if text[i:i + 7].lower() == '@import' and (i + 7 == n or not re.match(r'[\w-]', text[i + 7])):
            j = ws(i + 7)
            if j < n and text[j] in ('"', "'"):
                start, end, i, quote = quoted(j)
                tokens.append((start, end, quote, 'import'))
                continue
        ident = re.match(r'[a-zA-Z_-][a-zA-Z0-9_-]*', text[i:])
        if ident:
            end_ident = i + ident.end()
            j = ws(end_ident)
            if ident[0].lower() == 'url' and j < n and text[j] == '(':
                j = ws(j + 1)
                if j < n and text[j] in ('"', "'"):
                    start, end, j, quote = quoted(j)
                    j = ws(j)
                else:
                    start = j
                    quote = None
                    while j < n and text[j] != ')':
                        j += 2 if text[j] == '\\' else 1
                    end = j
                    while end > start and text[end - 1].isspace():
                        end -= 1
                need(j < n and text[j] == ')', 'malformed_css_url')
                tokens.append((start, end, quote, 'url'))
                i = j + 1
                continue
            i = end_ident
            continue
        need(text[i] != '\\', 'escaped_css_identifier_requires_review')
        i += 1
    return tokens


def css_escape(value, quote):
    if quote:
        return value.replace('\\', '\\\\').replace(quote, '\\' + quote).replace('\n', '\\a ')
    return re.sub(r'([\s()\x22\x27\\])', lambda m: '\\' + m[1], value)


def reviewed_external_reuse(closure, frozen, recorded_urls):
    """Require exact observed URLs, their old URL authority, and pinned bytes."""
    refs = closure['externalReferences']
    need(len(refs) == 30, 'historic_external_reference_count_changed')
    aliases = {}
    for ref in refs:
        url = ref['scheme'] + '://' + ref['host'] + ref['path']
        need(url in TRUSTINDEX_SOURCE_URLS and
             ref['source_css'] == 'wp-content/uploads/trustindex-google-widget.css' and
             ref['source_provenance'] == 'fresh_archive' and ref['syntax'] == 'url' and
             not ref['query_keys'] and not ref['fragment_present'] and
             ref['value_sha256'] == sha(url.encode()), 'unreviewed_historic_external_reference')
        path = canonical('_external/' + ref['host'] + ref['path'])
        need(recorded_urls.get(url) == '/' + path and path in frozen,
             'historic_external_url_authority_missing')
        aliases[url] = path
    need(set(aliases) == TRUSTINDEX_SOURCE_URLS, 'historic_external_scope_changed')
    return aliases


def resolve_url(original_path, value, mapping, external_aliases=None):
    if not value or value.startswith('#') or value.lower().startswith('data:'):
        return None, 'embedded_or_fragment'
    if external_aliases and value in external_aliases:
        path = canonical(external_aliases[value])
        need(original_path == 'wp-content/uploads/trustindex-google-widget.css' and
             value in TRUSTINDEX_SOURCE_URLS and path == '_external/' + U.urlsplit(value).netloc + U.urlsplit(value).path,
             'unreviewed_external_alias')
        need(path in mapping, 'unmapped_historic_external_dependency')
        return U.quote(mapping[path], safe='/-._~'), 'historic_external_mapped'
    parsed = U.urlsplit(value)
    if parsed.scheme and parsed.scheme not in ('http', 'https'):
        return None, 'blocked_external_or_scheme_preserved'
    url = U.urlsplit(U.urljoin('https://derech-tkuma.com/' + canonical(original_path), value))
    if url.hostname not in ORIGINS or url.username or url.password or url.port not in (None, 80, 443):
        return None, 'blocked_external_or_scheme_preserved'
    path = canonical(U.unquote(url.path).lstrip('/'))
    need(path in mapping, 'unmapped_local_css_dependency')
    target = U.quote(mapping[path], safe='/-._~')
    if url.query:
        target += '?' + url.query
    if url.fragment:
        target += '#' + url.fragment
    return target, 'local_mapped'


def rewrite_css(body, original_path, mapping, external_aliases=None):
    text = body.decode('utf-8-sig')
    patches = []
    preserved = collections.Counter()
    for start, end, quote, kind in css_tokens(text):
        literal = text[start:end]
        target, disposition = resolve_url(original_path, css_unescape(literal), mapping, external_aliases)
        if target is None:
            preserved[disposition] += 1
            continue
        replacement = css_escape(target, quote)
        if literal != replacement:
            patches.append({'start': start, 'end': end, 'before': literal, 'after': replacement, 'kind': kind})
    transformed = text
    for patch in reversed(patches):
        transformed = transformed[:patch['start']] + patch['after'] + transformed[patch['end']:]
    # Reverse every patch at its transformed offset to prove untouched text bytes.
    cursor = 0
    rebuilt = []
    for patch in patches:
        rebuilt.extend((text[cursor:patch['start']], patch['after']))
        cursor = patch['end']
    rebuilt.append(text[cursor:])
    need(''.join(rebuilt) == transformed, 'css_patch_ledger_mismatch')
    result = transformed.encode('utf-8')
    if body.startswith(b'\xef\xbb\xbf'):
        result = b'\xef\xbb\xbf' + result
    if not patches:
        need(result == body, 'unchanged_css_encoding_drift')
    return result, patches, dict(preserved)


def build(operational_root, canonical_root):
    ops = no_symlinks(operational_root)
    repo = no_symlinks(canonical_root)
    base = ops / 'migration/private-source-export-2026-10-28'
    archive = ops / 'var/wordpress-backup/zip-complete-2026-10-28'
    public = repo / 'platform-cms/public'
    closure_file = base / 'public-asset-dependency-closure.after-public-get.private.json'
    repairs_file = base / 'public-css-semantic-repairs.private.json'
    closure = json.loads(closure_file.read_text())
    repairs = json.loads(repairs_file.read_text())
    closure_sha, repair_sha = sha(closure_file.read_bytes()), sha(repairs_file.read_bytes())
    need(repairs['sourceClosureSha256'] == closure_sha, 'closure_repair_pin_mismatch')
    frozen_file = repo / 'platform-cms/public-assets-manifest.json'
    frozen_body = frozen_file.read_bytes()
    frozen_sha = sha(frozen_body)
    need(frozen_sha == closure['frozenManifestSha256'] == repairs['frozenManifestSha256'], 'frozen_manifest_pin_mismatch')
    frozen = {r['path']: r for r in json.loads(frozen_body)['files']}
    need(len(frozen) == 982, 'frozen_count_changed')
    for path, row in frozen.items():
        canonical(path)
        need(file_hash(public / path) == {k: row[k] for k in ('bytes', 'sha256')}, 'frozen_source_hash_mismatch')
    snapshot, namespace = closure['snapshotId'], closure['namespaceProposal']['prefix']
    need(re.fullmatch(r'[a-z0-9-]+', snapshot) and namespace == '/__source_assets__/' + snapshot + '/', 'invalid_namespace')
    vendor = repairs['vendorPinnedHistoricReuse']
    need(vendor['strategyReviewedConditionalEvidenceSatisfied'] and vendor['version'] == '6.0.0', 'vendor_strategy_not_reviewed')
    vendor_paths = {r['path'] for r in vendor['fonts']}
    need(len(vendor_paths) == 8, 'vendor_font_count_changed')
    repair_map = {r['observedPath']: r['replacementPath'] for r in repairs['repairs']}
    need(len(repair_map) == 33 and repairs['summary']['archiveDependencyMissing'] == 0 and not repairs['parserIssues'], 'repair_scope_or_closure_changed')
    recorded_urls_file = repo / 'platform-cms/lib/visual-resource-map.json'
    recorded_urls_body = recorded_urls_file.read_bytes()
    external_aliases = reviewed_external_reuse(closure, frozen, json.loads(recorded_urls_body))
    external_paths = set(external_aliases.values())
    historic_provenance = sha(json.dumps({'closureSha256': closure_sha,
        'frozenManifestSha256': frozen_sha, 'recordedUrlMapSha256': sha(recorded_urls_body),
        'exactSourceUrls': sorted(external_aliases)}, sort_keys=True).encode())
    source_rows = {}
    aliases = {}
    excluded = set()

    def add(path, source, expected, disposition, provenance):
        canonical(path)
        need(permitted(path, vendor_paths, external_paths), 'unapproved_source_path')
        need(file_hash(source) == expected, 'source_bytes_changed')
        row = {'path': path, 'source': str(source), 'originalSha256': expected['sha256'],
               'originalBytes': expected['bytes'], 'disposition': disposition,
               'provenanceHash': provenance}
        if path in source_rows:
            need(source_rows[path]['originalSha256'] == row['originalSha256'], 'source_path_collision')
        else:
            source_rows[path] = row
        aliases[path] = path

    recovery_root = base / 'public-asset-recovery'
    recovery = {r['path']: r for r in json.loads((recovery_root / 'receipts.private.json').read_text()) if r['state'] == 'captured'}
    for node in closure['nodes']:
        path = canonical(node['path'])
        if path in repair_map or path == vendor['observedCacheCssPath']:
            continue
        if node.get('disposition') == 'excluded':
            if path not in vendor_paths:
                excluded.add(path)
            continue
        if node.get('fresh_archive'):
            add(path, archive / path, node['fresh_archive'], 'fresh_archive', closure_sha)
        elif node.get('fresh_public_get'):
            receipt = recovery[path]
            name = receipt['bodyFile']
            need(Path(name).name == name and receipt['status'] == 200, 'unsafe_recovery_receipt')
            add(path, recovery_root / name, node['fresh_public_get'], 'exact_observed_public_get', sha(json.dumps(receipt, sort_keys=True).encode()))
        else:
            raise ValueError('unresolved_source_asset')
    repaired_originals = set(repair_map.values())
    for node in repairs['dependencyNodes']:
        path = canonical(node['path'])
        need(node['disposition'] == 'available' and node['archiveBytes'], 'unresolved_repair_dependency')
        add(path, archive / path, node['archiveBytes'],
            'semantic_original_css_repair' if path in repaired_originals else 'fresh_archive_css_dependency', repair_sha)
        if path in repaired_originals:
            source_rows[path]['disposition'] = 'semantic_original_css_repair'
            source_rows[path]['provenanceHash'] = repair_sha
    for broken, target in repair_map.items():
        canonical(broken)
        need(target in source_rows, 'repair_target_missing')
        aliases[broken] = target
    css_old = vendor['cssFrozenSource']
    need(b'Font Awesome Free 6.0.0 by @fontawesome' in (public / css_old['path']).read_bytes()[:500], 'vendor_version_metadata_changed')
    add(css_old['path'], public / css_old['path'], {k: css_old[k] for k in ('bytes', 'sha256')}, 'vendor_pinned_historic_reuse_NO_fresh_verification', repair_sha)
    # Fresh sourceHTML also references this exact reviewed CDNstylesheet. It
    # aliases the same pinned6.0.0 localCSS file; no extra provider fetch/copy.
    aliases['_external/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'] = css_old['path']
    for font in vendor['fonts']:
        add(font['path'], public / font['path'], {k: font[k] for k in ('bytes', 'sha256')}, 'vendor_pinned_historic_reuse_NO_fresh_verification', repair_sha)
    for url, path in sorted(external_aliases.items()):
        add(path, public / path, {k: frozen[path][k] for k in ('bytes', 'sha256')},
            'trustindex_pinned_historic_reuse_NO_fresh_verification', historic_provenance)
    need(len(source_rows) <= MAX_FILES and sum(r['originalBytes'] for r in source_rows.values()) <= MAX_TOTAL, 'bundle_caps_exceeded')
    # Default macOS filesystems normalize Unicode and case; fail collisions.
    import unicodedata
    identities = [unicodedata.normalize('NFC', p).casefold() for p in source_rows]
    need(len(identities) == len(set(identities)), 'filesystem_path_collision')
    mapping = {path: namespace + target for path, target in sorted(aliases.items())}
    transformed_css = {}
    private_patches = {}
    for path, row in source_rows.items():
        if path.endswith('.css'):
            body = Path(row['source']).read_bytes()
            need(len(body) <= 8 * 1024 * 1024, 'stylesheet_cap_exceeded')
            updated, patches, preserved = rewrite_css(body, path, mapping, external_aliases)
            transformed_css[path] = updated
            private_patches[path] = {'patches': patches, 'preserved': preserved}
    transformed_total = sum(len(transformed_css[p]) if p in transformed_css else r['originalBytes']
                            for p, r in source_rows.items())
    need(transformed_total <= MAX_TOTAL and all(len(b) <= MAX_FILE for b in transformed_css.values()),
         'transformed_bundle_caps_exceeded')
    output = base / 'prepared-public-assets'
    need(not output.exists(), 'prepared_destination_already_exists')
    receipt_path = base / 'prepared-public-assets-receipt.private.json'
    need(not receipt_path.exists(), 'private_receipt_already_exists')
    output.mkdir(mode=0o700)
    manifest_rows = []
    for path, row in sorted(source_rows.items()):
        target_relative = namespace.lstrip('/') + path
        target = output / target_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        need(not target.exists(), 'output_overwrite_refused')
        if path in transformed_css:
            body = transformed_css[path]
            target.write_bytes(body)
        else:
            shutil.copyfile(row['source'], target)
        actual = file_hash(target)
        if path not in transformed_css:
            need(actual['sha256'] == row['originalSha256'], 'copy_source_changed')
        manifest_rows.append({'path': target_relative, 'sourcePath': path,
                              'originalSha256': row['originalSha256'],
                              'transformedSha256': actual['sha256'], 'bytes': actual['bytes'],
                              'disposition': row['disposition'], 'provenanceHash': row['provenanceHash']})
    manifest = {'version': 1, 'snapshotId': snapshot, 'namespace': namespace,
                'files': manifest_rows, 'frozen982Retained': True,
                'sourceCodeExecuted': False, 'networkRequests': 0,
                'vendorReuseFreshVerification': False,
                'sourceOrigins': ['http://derech-tkuma.com', 'https://derech-tkuma.com', 'http://www.derech-tkuma.com', 'https://www.derech-tkuma.com'],
                'pathEncoding': 'UTF8decodedcanonicalkeyswithoutleadingslash; Unicodevalues; URIencodepathnameonlywhenemittingHTMLorCSS; preserveoriginalqueryandfragment.',
                'cssRepairCount': len(repair_map), 'vendorPinnedReuseFiles': 9,
                'trustindexPinnedHistoricReuseFiles': len(external_paths),
                'trustindexReuseFreshVerification': False}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    (output / 'source-snapshot-assets-manifest.json').write_bytes(manifest_bytes)
    public_map = {'version': 1, 'snapshotId': snapshot, 'namespace': namespace,
                  'paths': mapping, 'excludedPaths': sorted(excluded),
                  'manifestSha256': sha(manifest_bytes)}
    (output / 'source-snapshot-asset-map.json').write_text(json.dumps(public_map, ensure_ascii=False, indent=2) + '\n')
    need(sha(frozen_file.read_bytes()) == frozen_sha, 'frozen_manifest_changed_during_build')
    for path, row in frozen.items():
        need(file_hash(public / path) == {k: row[k] for k in ('bytes', 'sha256')}, 'frozen_bytes_changed_during_build')
    private_receipt = {'version': 1, 'snapshotId': snapshot, 'acceptedAsPreparedBundle': True,
                       'sourceRows': list(source_rows.values()), 'cssPatchLedger': private_patches,
                       'aliasTargets': aliases, 'manifestSha256': sha(manifest_bytes),
                       'mapSha256': sha((output / 'source-snapshot-asset-map.json').read_bytes()),
                       'closureSha256': closure_sha, 'repairManifestSha256': repair_sha,
                       'historicExternalReuse': {'strategy': 'exact_source_urls_and_recorded_old_url_authority',
                           'disposition': 'historic_reuse_NO_fresh_verification',
                           'frozenManifestSha256': frozen_sha, 'recordedUrlMapSha256': sha(recorded_urls_body),
                           'exactSourceUrls': external_aliases, 'files': len(external_paths)},
                       'files': len(manifest_rows), 'bytes': sum(r['bytes'] for r in manifest_rows),
                       'caps': {'maxFiles': MAX_FILES, 'maxFileBytes': MAX_FILE, 'maxTotalBytes': MAX_TOTAL},
                       'frozen982BeforeAndAfterVerified': True, 'canonicalPublicWrites': False,
                       'canonicalSourceFixtureWrites': False, 'networkRequests': 0,
                       'visualOrRuntimeAcceptance': False, 'published': False}
    fd = os.open(receipt_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(private_receipt, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return {'preparedBundle': str(output), 'publicMap': str(output / 'source-snapshot-asset-map.json'),
            'privateReceipt': str(receipt_path), 'files': len(manifest_rows),
            'aliasPaths': len(mapping), 'excludedPaths': len(excluded),
            'bytes': private_receipt['bytes'], 'manifestSha256': sha(manifest_bytes),
            'mapSha256': private_receipt['mapSha256'],
            'trustindexPinnedHistoricReuseFiles': len(external_paths),
            'cssFilesRewritten': sum(bool(x['patches']) for x in private_patches.values()),
            'frozen982Verified': True, 'publicTreeWrites': False, 'networkRequests': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operational-root', type=Path, required=True)
    parser.add_argument('--canonical-root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(json.dumps(build(args.operational_root, args.canonical_root), ensure_ascii=False))
