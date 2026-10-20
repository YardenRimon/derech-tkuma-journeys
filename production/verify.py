"""Verify a frozen, public-only site export before staging deployment."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from html.parser import HTMLParser

class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.robots = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'meta' and values.get('name', '').lower() in ('robots', 'googlebot'):
            self.robots.append(values.get('content', '').lower())

def verify(root, manifest):
    root = Path(root).resolve()
    paths = set()
    count = 0
    for row in manifest['files']:
        name = PurePosixPath(row['path'])
        if name.is_absolute() or '..' in name.parts or any(p.startswith('.') for p in name.parts):
            raise ValueError('Unsafe export path')
        if str(name) in paths:
            raise ValueError('Duplicate export path')
        paths.add(str(name))
        path = root.joinpath(*name.parts)
        if not path.is_file() or path.is_symlink() or root not in path.resolve().parents:
            raise ValueError('Missing or unsafe file: ' + str(name))
        if path.suffix.lower() in ('.php', '.sql', '.sqlite', '.env', '.zip'):
            raise ValueError('Private or executable file in public export')
        data = path.read_bytes()
        if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError('Export integrity mismatch: ' + str(name))
        if path.suffix.lower() == '.html':
            parser = Metadata()
            parser.feed(data.decode('utf-8'))
            if not parser.robots or any('noindex' not in x for x in parser.robots):
                raise ValueError('Staging indexing policy missing: ' + str(name))
            count += 1
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    if actual != paths:
        raise ValueError('Unlisted files in public export')
    if not count:
        raise ValueError('No HTML pages')
    return {'status': 'ok', 'files': len(paths), 'html_pages': count,
            'manifest_sha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--site', required=True)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.site, json.loads(Path(args.manifest).read_text()))))
