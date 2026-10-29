#!/usr/bin/env python3
"""Derive source indexing intent from hash-pinned raw gzipHTML, never reviewHTML."""
import argparse
import gzip
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.parse as U

ORIGIN = 'https://derech-tkuma.com'
SUPPORTED = {37: ('source-20261019', '2026-10-19', 4, 32),
             51: ('wordpress-public-20261028', '2026-10-28', 18, 32)}


def need(value, message):
    if not value:
        raise ValueError(message)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def safe_route(route):
    need(isinstance(route, str) and route.startswith('/') and (route == '/' or route.endswith('/')), 'unsafe_route')
    need('\\' not in route and not any(ord(c) < 32 or ord(c) == 127 for c in route), 'unsafe_route')
    parsed = U.urlsplit(route)
    need(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment, 'unsafe_route')
    need(U.unquote(route) == route and all(p not in ('.', '..', '') for p in route.strip('/').split('/')) if route != '/' else True, 'unsafe_route')
    need(not any(route.startswith(p) for p in ('/api/', '/admin/', '/wp-admin/', '/__source_assets__/')), 'reserved_route')
    return route


class Robots(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.head = False
        self.tags = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'head':
            self.head = True
        if tag.lower() != 'meta' or not self.head:
            return
        names = [k.lower() for k, _ in attrs]
        need(len(names) == len(set(names)), 'duplicate_meta_attribute')
        values = {k.lower(): v for k, v in attrs}
        name = (values.get('name') or '').lower()
        if name in ('robots', 'googlebot', 'bingbot'):
            self.tags.append({'name': name, 'content': values.get('content') or ''})

    def handle_endtag(self, tag):
        if tag.lower() == 'head':
            self.head = False


def raw_robots(html):
    parser = Robots()
    parser.feed(html)
    tags = parser.tags
    noindex = any(re.search(r'(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,;])', tag['content'], re.I) for tag in tags)
    return tags, noindex


def generate(root):
    root = Path(root)
    provenance_file = root / 'source-pages/provenance.json'
    manifest_file = root / 'source-manifest.json'
    provenance = json.loads(provenance_file.read_text())
    manifest = json.loads(manifest_file.read_text())
    pages = provenance['pages']
    count = len(pages)
    need(count in SUPPORTED and provenance['logicalPageCount'] == count, 'unsupported_source_snapshot')
    snapshot, date, expected_noindex, expected_sitemap = SUPPORTED[count]
    need(provenance['origin'] == ORIGIN and provenance['capturedAt'].startswith(date), 'source_snapshot_identity_mismatch')
    need(set(pages) == set(manifest), 'source_route_coverage_mismatch')
    output = {}
    noindex_paths = []
    sitemap = set()
    for route, record in sorted(pages.items()):
        safe_route(route)
        fixture = record['fixture']
        need(re.fullmatch(r'current-[a-f0-9]{20}\.html\.gz', fixture), 'unsafe_fixture_name')
        source_file = root / 'source-pages' / fixture
        need(source_file.is_file() and not source_file.is_symlink(), 'fixture_missing_or_symlink')
        raw = gzip.decompress(source_file.read_bytes())
        need(len(raw) <= 4 * 1024 * 1024 and sha(raw) == record['sourceSha256'] == manifest[route]['sourceSha256'], 'raw_source_hash_mismatch')
        need(manifest[route]['fixture'] == fixture, 'fixture_manifest_mismatch')
        source_url = U.urlsplit(record['sourceUrl'])
        need(source_url.scheme == 'https' and source_url.netloc == 'derech-tkuma.com' and not source_url.query and not source_url.fragment and U.unquote(source_url.path) == route, 'source_url_route_mismatch')
        tags, noindex = raw_robots(raw.decode('utf-8'))
        output[route] = {'fixture': fixture, 'sourceSha256': sha(raw), 'noindex': bool(noindex), 'robots': tags}
        if noindex:
            noindex_paths.append(route)
        else:
            canonical = manifest[route].get('canonical') or ORIGIN + route
            parsed = U.urlsplit(canonical)
            need(parsed.scheme == 'https' and parsed.netloc == 'derech-tkuma.com' and not parsed.query and not parsed.fragment, 'unsafe_source_canonical')
            sitemap.add(U.unquote(canonical))
    need(len(noindex_paths) == expected_noindex, 'independent_source_noindex_count_changed')
    need(len(sitemap) == expected_sitemap, 'independent_source_sitemap_count_changed')
    policy = {'version': 1, 'origin': ORIGIN, 'snapshotId': snapshot,
              'capturedAt': provenance['capturedAt'], 'routeCount': count,
              'provenanceSha256': sha(provenance_file.read_bytes()),
              'sourceManifestCanonicalSha256': sha(canonical_json(manifest).encode()),
              'expectedSitemapCount': len(sitemap), 'pages': output, 'noindexPaths': noindex_paths}
    policy['policySha256'] = sha(canonical_json(policy).encode())
    return policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    policy = generate(args.root)
    output = args.root / 'source-pages/source-indexing.json'
    if args.verify:
        need(json.loads(output.read_text()) == policy, 'source_indexing_policy_stale')
    else:
        output.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'sourceIndexingVerified': args.verify, 'generated': not args.verify,
                      'snapshotId': policy['snapshotId'], 'routes': policy['routeCount'],
                      'noindex': len(policy['noindexPaths']), 'sitemap': policy['expectedSitemapCount'],
                      'policySha256': policy['policySha256'], 'networkRequests': 0}))


if __name__ == '__main__':
    main()
