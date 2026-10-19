"""Upload one already encrypted CMS DER archive. No Cloudflare admin/S3 keys."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

PROTOCOL = 'cms-ciphertext-upload-v1'
RECEIPT_PURPOSE = 'cms-ciphertext-receipt-v1'
PATH = '/v1/backups/derech/derech-main'
MAX_BYTES = 16 * 1024 * 1024
CONFIG = Path('/etc/yarden-cms-backup-upload.json')
SCOPE = {'tenantId': 'derech', 'siteId': 'derech-main'}

class UploadError(ValueError):
    """Fixed public code only; never provider error/credential data."""


def require(value, code):
    if not value:
        raise UploadError(code)


def allowed():
    try:
        sys.path.insert(0, '/opt/yarden-time-policy')
        from time_policy import evaluate
        return evaluate().get('allowed') is True
    except Exception:
        return False


def private_bytes(path, maximum, *, owner_uid=0):
    path = Path(path)
    for ancestor in (*path.parents, path):
        require(not ancestor.is_symlink(), 'private_file_rejected')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == owner_uid and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= maximum, 'private_file_rejected')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            data = stream.read(maximum + 1)
        require(len(data) == info.st_size and len(data) <= maximum and path.stat().st_ino == info.st_ino, 'private_file_changed')
        return data
    finally:
        os.close(descriptor)


def load_config(path=CONFIG, *, owner_uid=0):
    try:
        value = json.loads(private_bytes(path, 8192, owner_uid=owner_uid))
    except UploadError:
        raise
    except Exception:
        raise UploadError('configuration_unavailable') from None
    require(isinstance(value, dict) and set(value) == {'version', 'origin', 'secret'} and value['version'] == 1, 'configuration_invalid')
    require(isinstance(value['origin'], str) and re.fullmatch(r'https://derech-cms-backup-receiver\.[a-z0-9-]+\.workers\.dev', value['origin']), 'origin_rejected')
    require(isinstance(value['secret'], str) and re.fullmatch(r'[a-f0-9]{64}', value['secret']), 'credential_unavailable')
    return value


def object_key(created, sha):
    return f'derech/derech-main/{created[:4]}/{created[4:6]}/{created[6:8]}/{created}-{sha}.cms'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise UploadError('redirect_rejected')


def transport(request):
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            require(response.geturl() == request.full_url, 'response_origin_rejected')
            body = response.read(16385)
            require(len(body) <= 16384, 'receipt_rejected')
            return response.status, {k.lower(): v for k, v in response.headers.items()}, body
    except UploadError:
        raise
    except Exception:
        raise UploadError('upload_transport_failed') from None


def openssl_check(path):
    try:
        result = subprocess.run(['openssl', 'cms', '-cmsout', '-inform', 'DER', '-in', str(path), '-noout'], capture_output=True, timeout=15)
        require(result.returncode == 0, 'encrypted_der_required')
    except UploadError:
        raise
    except Exception:
        raise UploadError('encrypted_der_required') from None


def upload_cipher(config_path, archive, created, *, expected_sha, expected_size, send=transport, clock=time.time, gate=allowed, owner_uid=0, check=openssl_check):
    require(gate() is True, 'sacred_time_closed')
    config = load_config(config_path, owner_uid=owner_uid)
    require(Path(archive).suffix == '.cms', 'encrypted_der_required')
    try:
        stamp = datetime.strptime(created, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        raise UploadError('capture_time_rejected') from None
    now = int(clock()); require(-120 <= now - stamp.timestamp() <= 7*86400, 'capture_time_rejected')
    data = private_bytes(archive, MAX_BYTES, owner_uid=owner_uid)
    sha = hashlib.sha256(data).hexdigest()
    require(type(expected_size) is int and len(data) == expected_size and sha == expected_sha, 'archive_identity_rejected')
    check(archive)
    message = '\n'.join([PROTOCOL, 'POST', config['origin'], PATH, str(now), created, str(len(data)), sha])
    signature = hmac.new(bytes.fromhex(config['secret']), message.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(config['origin']+PATH, data=data, method='POST', headers={
        'User-Agent':'YardenCMS-EncryptedBackup/1.0',
        'Content-Type':'application/pkcs7-mime','x-backup-time':str(now),'x-backup-created-at':created,
        'x-backup-size':str(len(data)),'x-backup-sha256':sha,'x-backup-signature':signature})
    require(gate() is True, 'sacred_time_closed')
    try:
        status, headers, raw = send(request)
    except UploadError:
        raise
    except Exception:
        raise UploadError('upload_transport_failed') from None
    require(status in (200, 201) and len(raw) <= 16384, 'receipt_rejected')
    receipt_signature = headers.get('x-backup-receipt-signature', '')
    expected_signature = hmac.new(bytes.fromhex(config['secret']), RECEIPT_PURPOSE.encode()+b'\n'+raw, hashlib.sha256).hexdigest()
    require(isinstance(receipt_signature, str) and re.fullmatch(r'[a-f0-9]{64}', receipt_signature) and hmac.compare_digest(receipt_signature, expected_signature), 'receipt_signature_rejected')
    try:
        receipt = json.loads(raw)
    except Exception:
        raise UploadError('receipt_rejected') from None
    require(isinstance(receipt, dict) and set(receipt) == {'protocol','scope','key','createdAt','ciphertextBytes','ciphertextSha256','objectEtag','objectVersion','verified','duplicate'}, 'receipt_rejected')
    require(receipt['protocol'] == PROTOCOL and receipt['scope'] == SCOPE and receipt['key'] == object_key(created, sha) and receipt['createdAt'] == created and type(receipt['ciphertextBytes']) is int and receipt['ciphertextBytes'] == len(data) and receipt['ciphertextSha256'] == sha and receipt['verified'] is True and type(receipt['duplicate']) is bool, 'receipt_identity_rejected')
    require(all(isinstance(receipt[k], str) and 1 <= len(receipt[k]) <= 256 and all(32 <= ord(c) <= 126 for c in receipt[k]) for k in ('objectEtag','objectVersion')), 'receipt_rejected')
    return receipt


def atomic_json(path, value):
    path = Path(path); require(not path.is_symlink(), 'private_file_rejected')
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.'+path.name)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600); json.dump(value, stream, separators=(',', ':'), allow_nan=False); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def finalize_backup(report, base, *, config_path=CONFIG, uploader=upload_cipher):
    """Proposed runner hook: latest success changes only after verified copy."""
    base=Path(base);archive=Path(report['archive'])
    require(archive.parent.resolve() == base.resolve() and report.get('state') == 'encrypted_verified' and report.get('offServerCopyVerified') is False, 'report_rejected')
    try:
        receipt = uploader(config_path, archive, report['createdAt'], expected_sha=report['ciphertextSha256'], expected_size=report['ciphertextBytes'])
        require(isinstance(receipt, dict) and receipt.get('verified') is True and receipt.get('scope') == SCOPE and receipt.get('ciphertextSha256') == report['ciphertextSha256'] and receipt.get('ciphertextBytes') == report['ciphertextBytes'] and receipt.get('key') == object_key(report['createdAt'],report['ciphertextSha256']), 'receipt_identity_rejected')
    except Exception:
        failed={**report,'state':'encrypted_local_upload_failed','complete':False,'offServerCopyVerified':False,'failureCode':'offserver_copy_unverified'}
        atomic_json(archive.with_suffix('.json'),failed);atomic_json(base/'last-attempt.json',failed)
        raise UploadError('offserver_copy_unverified') from None
    success={**report,'state':'offserver_copy_verified','complete':True,'offServerCopyVerified':True,'offServerReceipt':receipt}
    atomic_json(archive.with_suffix('.json'),success);atomic_json(base/'last-attempt.json',success)
    latest=base/'latest.json'
    previous=json.loads(latest.read_text()) if latest.exists() else None
    if not previous or not isinstance(previous.get('createdAt'),str) or previous['createdAt']<=report['createdAt']:
        atomic_json(latest,success)
    return success
