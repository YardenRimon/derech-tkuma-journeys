"""Bounded CMS-DER recovery parts, using the existing recovery certificate.

The opaque input is not unpacked/executed. Each <=8MiB part is independently
encrypted by OpenSSL CMS; an encrypted manifest binds order/count/whole digest.
No uploader, freshness marker, timer, key creation or network is included.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from datetime import datetime

CHUNK = 8 * 1024 * 1024
LIMIT = 8 * 1024 * 1024 * 1024
HASH = re.compile(r'[a-f0-9]{64}')
STAMP = re.compile(r'\d{8}T\d{6}Z')


class BundleError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise BundleError(code)


def digest(path):
    sha = hashlib.sha256()
    with Path(path).open('rb') as handle:
        while data := handle.read(1024 * 1024):
            sha.update(data)
    return sha.hexdigest()


def private_file(path):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_mode & 0o077 == 0, 'private_regular_file_required')
    return info


def private_dir(path, create=False):
    path = Path(path)
    if create:
        path.mkdir(mode=0o700, parents=False, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and info.st_mode & 0o077 == 0, 'private_directory_required')
    return path


def atomic_json(path, value):
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
        try:
            handle.write((json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode())
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)


def openssl(args):
    result = subprocess.run(['openssl', 'cms', *args], capture_output=True, timeout=30)
    require(result.returncode == 0, 'openssl_cms_failed')


def encrypt(plain, dest, certificate):
    require(not dest.exists() and not dest.is_symlink(), 'ciphertext_already_exists')
    with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        openssl(['-encrypt', '-binary', '-aes256', '-outform', 'DER', '-in',
                 str(plain), '-out', str(temporary), str(certificate)])
        # No -stream: each bounded part is a definite-length CMS DER object.
        openssl(['-cmsout', '-inform', 'DER', '-in', str(temporary), '-noout'])
        os.chmod(temporary, 0o600)
        os.link(temporary, dest)  # Never overwrite an existing final artifact.
    finally:
        temporary.unlink(missing_ok=True)


def part_name(index, stamp):
    return f'derech-recovery-wordpress-part{index:04d}-{stamp}.cms'


def validate_manifest(value):
    require(isinstance(value, dict) and set(value) == {'schema', 'kind', 'createdAt',
        'chunkBytes', 'sourceBytes', 'sourceSha256', 'certificateSha256', 'parts'}, 'manifest_invalid')
    require(value['schema'] == 1 and value['kind'] == 'opaque-wordpress-recovery-parts/v1'
        and isinstance(value['createdAt'], str) and STAMP.fullmatch(value['createdAt'])
        and value['chunkBytes'] == CHUNK and type(value['sourceBytes']) is int
        and 0 < value['sourceBytes'] <= LIMIT, 'manifest_invalid')
    datetime.strptime(value['createdAt'], '%Y%m%dT%H%M%SZ')
    require(all(isinstance(value[k], str) and HASH.fullmatch(value[k])
        for k in ['sourceSha256', 'certificateSha256']), 'manifest_invalid')
    require(isinstance(value['parts'], list) and len(value['parts']) ==
        (value['sourceBytes'] + CHUNK - 1) // CHUNK, 'manifest_parts_invalid')
    for index, row in enumerate(value['parts']):
        require(isinstance(row, dict) and set(row) == {'file', 'plainBytes', 'plainSha256',
            'ciphertextBytes', 'ciphertextSha256'}, 'manifest_part_invalid')
        require(row['file'] == part_name(index, value['createdAt'])
            and type(row['plainBytes']) is int and row['plainBytes'] ==
            min(CHUNK, value['sourceBytes'] - index * CHUNK)
            and type(row['ciphertextBytes']) is int
            and row['plainBytes'] < row['ciphertextBytes'] <= CHUNK + 65536
            and all(isinstance(row[k], str) and HASH.fullmatch(row[k])
                for k in ['plainSha256', 'ciphertextSha256']), 'manifest_part_invalid')
    return value


def prepare(source, output, certificate, stamp, expected_sha, expected_size):
    os.umask(0o077)
    source, certificate = Path(source), Path(certificate)
    before = private_file(source)
    require(STAMP.fullmatch(stamp) and HASH.fullmatch(expected_sha)
        and type(expected_size) is int and 0 < expected_size <= LIMIT, 'source_contract_invalid')
    datetime.strptime(stamp, '%Y%m%dT%H%M%SZ')
    require(before.st_size == expected_size and digest(source) == expected_sha, 'source_hash_mismatch')
    output = private_dir(output, create=True)
    contract = {'schema': 1, 'kind': 'opaque-wordpress-recovery-parts/v1',
        'createdAt': stamp, 'chunkBytes': CHUNK, 'sourceBytes': expected_size,
        'sourceSha256': expected_sha, 'certificateSha256': digest(certificate)}
    manifest_path = output / 'bundle-manifest.private.json'
    receipt_path = output / 'bundle-receipt.private.json'
    if manifest_path.exists():
        private_file(manifest_path)
        existing = validate_manifest(json.loads(manifest_path.read_text()))
        require({k: existing[k] for k in contract} == contract, 'bundle_contract_changed')
        for row in existing['parts']:
            path = output / row['file']
            require(private_file(path).st_size == row['ciphertextBytes']
                and digest(path) == row['ciphertextSha256'], 'existing_part_changed')
        private_file(receipt_path)
        receipt = json.loads(receipt_path.read_text())
        require(isinstance(receipt, dict) and set(receipt) == {'file', 'bytes', 'sha256', 'manifestSha256'}, 'bundle_receipt_invalid')
        require(receipt['file'] == f'derech-recovery-wordpress-manifest-{stamp}.cms'
            and receipt['manifestSha256'] == digest(manifest_path), 'bundle_receipt_invalid')
        cipher = output / receipt['file']
        require(private_file(cipher).st_size == receipt['bytes']
            and digest(cipher) == receipt['sha256'], 'manifest_ciphertext_mismatch')
        return existing
    # A failed preparation leaves no published manifest. Keep ciphertext for
    # inspection; require a new empty private directory rather than reusing it.
    require(not list(output.iterdir()), 'incomplete_bundle_requires_new_directory')
    whole = hashlib.sha256()
    rows = []
    with tempfile.TemporaryDirectory(prefix='.preparing-', dir=output) as directory:
        plain = Path(directory) / 'part.bin'
        descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as handle:
            opened = os.fstat(handle.fileno())
            require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) ==
                    (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns), 'source_changed')
            while data := handle.read(CHUNK):
                whole.update(data)
                plain.write_bytes(data)
                dest = output / part_name(len(rows), stamp)
                encrypt(plain, dest, certificate)
                rows.append({'file': dest.name, 'plainBytes': len(data),
                    'plainSha256': hashlib.sha256(data).hexdigest(),
                    'ciphertextBytes': dest.stat().st_size, 'ciphertextSha256': digest(dest)})
            after = os.fstat(handle.fileno())
        require(whole.hexdigest() == expected_sha and after.st_size == expected_size
            and after.st_mtime_ns == before.st_mtime_ns, 'source_changed')
        manifest = validate_manifest({**contract, 'parts': rows})
        plain.write_bytes((json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode())
        cipher = output / f'derech-recovery-wordpress-manifest-{stamp}.cms'
        encrypt(plain, cipher, certificate)
        atomic_json(receipt_path, {'file': cipher.name, 'bytes': cipher.stat().st_size,
            'sha256': digest(cipher), 'manifestSha256': digest(plain)})
        atomic_json(manifest_path, manifest)
    return manifest


def restore(manifest_cipher, parts_dir, output, certificate, private_key, passphrase_file,
            expected_manifest_sha):
    os.umask(0o077)
    manifest_cipher, output = Path(manifest_cipher), Path(output)
    directory = private_dir(parts_dir)
    private_dir(output.parent)
    require(HASH.fullmatch(expected_manifest_sha) and private_file(manifest_cipher).st_size < 1024 * 1024
        and digest(manifest_cipher) == expected_manifest_sha, 'manifest_ciphertext_mismatch')
    require(not output.exists() and not output.is_symlink(), 'restore_output_exists')
    def decrypt(cipher, plain):
        openssl(['-decrypt', '-binary', '-inform', 'DER', '-in', str(cipher),
            '-inkey', str(private_key), '-recip', str(certificate),
            '-passin', 'file:' + str(passphrase_file), '-out', str(plain)])
    with tempfile.TemporaryDirectory(prefix='.restoring-', dir=output.parent) as temp:
        temp = Path(temp)
        plain = temp / 'part.bin'
        decrypt(manifest_cipher, plain)
        require(plain.stat().st_size < 1024 * 1024, 'manifest_invalid')
        manifest = validate_manifest(json.loads(plain.read_text()))
        require(digest(certificate) == manifest['certificateSha256'], 'recovery_certificate_changed')
        result = temp / 'recovered.bin'
        whole, size = hashlib.sha256(), 0
        with result.open('xb') as target:
            for row in manifest['parts']:
                cipher = directory / row['file']
                require(private_file(cipher).st_size == row['ciphertextBytes']
                    and digest(cipher) == row['ciphertextSha256'], 'part_ciphertext_mismatch')
                decrypt(cipher, plain)
                require(plain.stat().st_size == row['plainBytes']
                    and digest(plain) == row['plainSha256'], 'part_plaintext_mismatch')
                with plain.open('rb') as part:
                    while data := part.read(1024 * 1024):
                        whole.update(data)
                        target.write(data)
                        size += len(data)
            target.flush()
            os.fsync(target.fileno())
        require(size == manifest['sourceBytes'] and whole.hexdigest() == manifest['sourceSha256'], 'whole_archive_mismatch')
        os.link(result, output)
    return {'restored': True, 'sourceBytes': size, 'sourceSha256': whole.hexdigest(),
        'createdAt': manifest['createdAt'], 'parts': len(manifest['parts']), 'sourceExecuted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='action', required=True)
    prepare_args = subs.add_parser('prepare')
    for name in ['source', 'output', 'certificate', 'created-at', 'expected-sha256']:
        prepare_args.add_argument('--' + name, required=True)
    prepare_args.add_argument('--expected-size', required=True, type=int)
    restore_args = subs.add_parser('restore')
    for name in ['manifest', 'parts', 'output', 'certificate', 'private-key', 'passphrase-file', 'expected-manifest-sha256']:
        restore_args.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        if args.action == 'prepare':
            value = prepare(args.source, args.output, args.certificate, args.created_at,
                args.expected_sha256, args.expected_size)
            print(json.dumps({'prepared': True, 'createdAt': value['createdAt'],
                'sourceBytes': value['sourceBytes'], 'sourceSha256': value['sourceSha256'],
                'parts': len(value['parts']), 'uploaded': False}))
        else:
            print(json.dumps(restore(args.manifest, args.parts, args.output, args.certificate,
                args.private_key, args.passphrase_file, args.expected_manifest_sha256)))
    except (BundleError, OSError, ValueError, subprocess.SubprocessError):
        parser.exit(2, 'Recovery bundle failed; no successful upload/restore is claimed.\n')


if __name__ == '__main__':
    main()
