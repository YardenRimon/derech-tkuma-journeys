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
import urllib.error

PROTOCOL = 'cms-ciphertext-upload-v1'
RECEIPT_PURPOSE = 'cms-ciphertext-receipt-v1'
PATH = '/v1/backups/derech/derech-main'
MAX_BYTES = 16 * 1024 * 1024  # legacy v1 verification bound
V1_WRITE_MAX = 8 * 1024 * 1024
VERIFY_PATH = PATH + '/verify-existing'
VERIFY_PURPOSE = 'cms-ciphertext-verify-existing-v1'
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
            maximum = PART_BYTES if request.full_url.endswith(MULTIPART_PATH+'/readback') else 16384
            body = response.read(maximum+1)
            require(len(body) <= maximum, 'receipt_rejected')
            return response.status, {k.lower(): v for k, v in response.headers.items()}, body
    except UploadError:
        raise
    except urllib.error.HTTPError as error:
        # Only this exact authenticated metadata lookup has a typed miss.
        # All other HTTP failures remain fail-closed transport failures.
        if error.code == 404 and request.full_url.endswith(VERIFY_PATH):
            with error:
                require(error.geturl() == request.full_url, 'response_origin_rejected')
                body = error.read(16385)
                require(len(body) <= 16384, 'receipt_rejected')
                return 404, {k.lower():v for k,v in error.headers.items()}, body
        error.close()
        raise UploadError('upload_transport_failed') from None
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
    if type(expected_size) is int and expected_size > V1_WRITE_MAX:
        if expected_size <= MAX_BYTES:
            receipt = verify_legacy_existing(config, archive, created, expected_sha, expected_size, send=send, clock=clock, gate=gate, owner_uid=owner_uid, check=check)
            if receipt is not None:
                return receipt
        return upload_multipart(config_path, archive, created, expected_sha=expected_sha, expected_size=expected_size, send=send, clock=clock, gate=gate, owner_uid=owner_uid, check=check)
    data = private_bytes(archive, V1_WRITE_MAX, owner_uid=owner_uid)
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
    return v1_receipt(config, status, headers, raw, created, len(data), sha)


def v1_receipt(config, status, headers, raw, created, size, sha, *, duplicate_only=False):
    require(status in (200, 201) and len(raw) <= 16384, 'receipt_rejected')
    receipt_signature = headers.get('x-backup-receipt-signature', '')
    expected_signature = hmac.new(bytes.fromhex(config['secret']), RECEIPT_PURPOSE.encode()+b'\n'+raw, hashlib.sha256).hexdigest()
    require(isinstance(receipt_signature, str) and re.fullmatch(r'[a-f0-9]{64}', receipt_signature) and hmac.compare_digest(receipt_signature, expected_signature), 'receipt_signature_rejected')
    try:
        receipt = json.loads(raw)
    except Exception:
        raise UploadError('receipt_rejected') from None
    require(isinstance(receipt, dict) and set(receipt) == {'protocol','scope','key','createdAt','ciphertextBytes','ciphertextSha256','objectEtag','objectVersion','verified','duplicate'}, 'receipt_rejected')
    require(receipt['protocol'] == PROTOCOL and receipt['scope'] == SCOPE and receipt['key'] == object_key(created, sha) and receipt['createdAt'] == created and type(receipt['ciphertextBytes']) is int and receipt['ciphertextBytes'] == size and receipt['ciphertextSha256'] == sha and receipt['verified'] is True and type(receipt['duplicate']) is bool, 'receipt_identity_rejected')
    require(all(isinstance(receipt[k], str) and 1 <= len(receipt[k]) <= 256 and all(32 <= ord(c) <= 126 for c in receipt[k]) for k in ('objectEtag','objectVersion')), 'receipt_rejected')
    require(not duplicate_only or status == 200 and receipt['duplicate'] is True, 'receipt_identity_rejected')
    return receipt


def verify_legacy_existing(config, archive, created, sha, size, *, send, clock, gate, owner_uid, check):
    require(type(size) is int and V1_WRITE_MAX < size <= MAX_BYTES and isinstance(sha,str) and re.fullmatch(r'[a-f0-9]{64}',sha), 'archive_identity_rejected')
    stream, info = private_stream(archive, maximum=MAX_BYTES, owner_uid=owner_uid)
    with stream:
        manifest = stream_manifest(stream, created)
        require(manifest['ciphertextBytes']==size and manifest['ciphertextSha256']==sha, 'archive_identity_rejected')
        (streaming_der_check if check is openssl_check else check)(archive)
        require(file_identity(info)==file_identity(os.fstat(stream.fileno()))==file_identity(Path(archive).stat()), 'private_file_changed')
        now = str(int(clock()))
        message = '\n'.join([VERIFY_PURPOSE,'POST',config['origin'],VERIFY_PATH,now,created,str(size),sha])
        signature = hmac.new(bytes.fromhex(config['secret']),message.encode(),hashlib.sha256).hexdigest()
        request = urllib.request.Request(config['origin']+VERIFY_PATH,data=b'{}',method='POST',headers={'User-Agent':'YardenCMS-EncryptedBackup/1.0','Content-Type':'application/json','x-backup-time':now,'x-backup-created-at':created,'x-backup-size':str(size),'x-backup-sha256':sha,'x-backup-signature':signature})
        require(gate() is True, 'sacred_time_closed')
        try:
            status, headers, raw = send(request)
        except UploadError:
            raise
        except Exception:
            raise UploadError('upload_transport_failed') from None
        require(file_identity(info)==file_identity(os.fstat(stream.fileno()))==file_identity(Path(archive).stat()), 'private_file_changed')
        if status == 404:
            require(len(raw)<=16384, 'receipt_rejected')
            try:
                value=json.loads(raw)
            except Exception:
                raise UploadError('receipt_rejected') from None
            require(type(value) is dict and set(value)=={'ok','code'} and value['ok'] is False and value['code']=='existing_v1_not_found', 'receipt_rejected')
            return None
        return v1_receipt(config,status,headers,raw,created,size,sha,duplicate_only=True)


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
    report={k:v for k,v in report.items() if k not in ('failureCode','offServerReceipt')}
    base=Path(base);archive=Path(report['archive'])
    require(archive.parent.resolve() == base.resolve() and report.get('state') == 'encrypted_verified' and report.get('offServerCopyVerified') is False, 'report_rejected')
    atomic_json(archive.with_suffix('.json'),report);atomic_json(base/'last-attempt.json',report)
    try:
        receipt = uploader(config_path, archive, report['createdAt'], expected_sha=report['ciphertextSha256'], expected_size=report['ciphertextBytes'])
        require(isinstance(receipt, dict) and receipt.get('verified') is True and receipt.get('scope') == SCOPE and receipt.get('ciphertextSha256') == report['ciphertextSha256'] and receipt.get('ciphertextBytes') == report['ciphertextBytes'] and receipt.get('key') == object_key(report['createdAt'],report['ciphertextSha256']), 'receipt_identity_rejected')
        if receipt.get('protocol')==MULTIPART_PROTOCOL or report['ciphertextBytes']>MAX_BYTES:
            require(receipt.get('protocol')==MULTIPART_PROTOCOL and receipt.get('independentReadbackVerified') is True and receipt.get('readbackBytes')==report['ciphertextBytes'] and receipt.get('readbackSha256')==report['ciphertextSha256'], 'stored_copy_unverified')
    except Exception as error:
        held=isinstance(error,UploadError) and str(error)=='sacred_time_closed'
        failed={**report,'state':'encrypted_upload_held' if held else 'encrypted_local_upload_failed','complete':False,'offServerCopyVerified':False,'failureCode':'offserver_copy_unverified'}
        atomic_json(archive.with_suffix('.json'),failed);atomic_json(base/'last-attempt.json',failed)
        raise UploadError('offserver_copy_unverified') from None
    success={**report,'state':'offserver_copy_verified','complete':True,'offServerCopyVerified':True,'offServerReceipt':receipt}
    atomic_json(archive.with_suffix('.json'),success);atomic_json(base/'last-attempt.json',success)
    latest=base/'latest.json'
    previous=json.loads(latest.read_text()) if latest.exists() else None
    if not previous or not isinstance(previous.get('createdAt'),str) or previous['createdAt']<=report['createdAt']:
        atomic_json(latest,success)
    return success

# v2 is deliberately selected only above the unchanged v1 archive bound.
MULTIPART_PROTOCOL = 'cms-ciphertext-multipart-v2'
MULTIPART_PATH = '/v2/backups/derech/derech-main'
PART_BYTES = 8 * 1024 * 1024
TOTAL_BYTES = 4 * 1024 * 1024 * 1024


def private_stream(path, maximum=TOTAL_BYTES, *, owner_uid=0, allow_empty=False):
    path = Path(path)
    for ancestor in (*path.parents, path):
        require(not ancestor.is_symlink(), 'private_file_rejected')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == owner_uid and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600 and (0 if allow_empty else 1) <= info.st_size <= maximum, 'private_file_rejected')
        return os.fdopen(fd, 'rb'), info
    except BaseException:
        os.close(fd)
        raise


def file_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def stream_manifest(stream, created):
    stream.seek(0)
    digest = hashlib.sha256()
    parts = []
    size = 0
    while True:
        chunk = stream.read(PART_BYTES)
        if not chunk:
            break
        digest.update(chunk)
        size += len(chunk)
        require(size <= TOTAL_BYTES and len(parts) < 512, 'archive_limit')
        parts.append({'partNumber':len(parts)+1, 'bytes':len(chunk), 'sha256':hashlib.sha256(chunk).hexdigest()})
    return {'protocol':MULTIPART_PROTOCOL, 'scope':SCOPE, 'createdAt':created, 'ciphertextBytes':size, 'ciphertextSha256':digest.hexdigest(), 'partBytes':PART_BYTES, 'parts':parts}


def stream_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda:stream.read(PART_BYTES), b''):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_manifest(manifest):
    return json.dumps(manifest, separators=(',', ':'), ensure_ascii=True).encode()


def multipart_request(config, action, session, part, data, *, send, clock, gate):
    require(action in ('create','part','complete','readback','cancel'), 'operation_rejected')
    size, digest, now = str(len(data)), hashlib.sha256(data).hexdigest(), str(int(clock()))
    path = MULTIPART_PATH + '/' + action
    message = '\n'.join(['cms-ciphertext-'+action+'-v2', 'POST', config['origin'], path, now, session, str(part), size, digest])
    signature = hmac.new(bytes.fromhex(config['secret']), message.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(config['origin']+path, data=data, method='POST', headers={
        'User-Agent':'YardenCMS-EncryptedBackup/2.0', 'Content-Type':'application/pkcs7-mime' if action=='part' else 'application/json',
        'x-backup-time':now, 'x-backup-session':session, 'x-backup-part':str(part), 'x-backup-size':size,
        'x-backup-sha256':digest, 'x-backup-signature':signature})
    require(gate() is True, 'sacred_time_closed')
    try:
        status, headers, raw = send(request)
    except UploadError:
        raise
    except Exception:
        raise UploadError('upload_transport_failed') from None
    require(status in (200,201) and len(raw) <= (PART_BYTES if action=='readback' else 16384), 'receipt_rejected')
    signed = headers.get('x-backup-readback-receipt', '').encode() if action=='readback' else raw
    require(0 < len(signed) <= 16384, 'receipt_rejected')
    expected = hmac.new(bytes.fromhex(config['secret']), ('cms-ciphertext-'+action+'-receipt-v2\n').encode()+signed, hashlib.sha256).hexdigest()
    received = headers.get('x-backup-receipt-signature', '')
    require(isinstance(received,str) and re.fullmatch(r'[a-f0-9]{64}',received) and hmac.compare_digest(received, expected), 'receipt_signature_rejected')
    try:
        receipt = json.loads(signed)
    except Exception:
        raise UploadError('receipt_rejected') from None
    require(isinstance(receipt,dict) and receipt.get('sessionId') == session, 'receipt_identity_rejected')
    return receipt, raw


def streaming_der_check(path):
    """Bounded public DER shape check; never decode a multi-GiB CMS in RAM.

    The existing trusted runner creates AES256 CMS after isolated plaintext
    restore proof. Neither this check nor the receiver can decrypt content.
    """
    with open(path,'rb') as source:
        data=source.read(65536)
        size=os.fstat(source.fileno()).st_size
    def item(at,tag):
        require(at+2<=len(data) and data[at]==tag, 'encrypted_der_required')
        length=data[at+1];start=at+2
        if length&128:
            count=length&127
            require(1<=count<=4 and start+count<=len(data) and data[start]!=0, 'encrypted_der_required')
            length=int.from_bytes(data[start:start+count],'big');start+=count
            require(length>=128,'encrypted_der_required')
        return start,start+length
    top,end=item(0,0x30);require(end==size,'encrypted_der_required')
    oid,oid_end=item(top,6);require(data[oid:oid_end]==bytes.fromhex('2a864886f70d010703'),'encrypted_der_required')
    explicit,explicit_end=item(oid_end,0xa0);envelope,envelope_end=item(explicit,0x30)
    require(explicit_end==size and envelope_end==size and bytes.fromhex('060960864801650304012a') in data[envelope:],'encrypted_der_required')


def upload_multipart(config_path, archive, created, *, expected_sha, expected_size, send=transport, clock=time.time, gate=allowed, owner_uid=0, check=openssl_check):
    require(gate() is True, 'sacred_time_closed')
    config = load_config(config_path, owner_uid=owner_uid)
    require(Path(archive).suffix == '.cms', 'encrypted_der_required')
    try:
        stamp = datetime.strptime(created, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    except (TypeError,ValueError):
        raise UploadError('capture_time_rejected') from None
    require(-120 <= clock()-stamp.timestamp() <= 7*86400, 'capture_time_rejected')
    require(type(expected_size) is int and V1_WRITE_MAX < expected_size <= TOTAL_BYTES and isinstance(expected_sha,str) and re.fullmatch(r'[a-f0-9]{64}',expected_sha), 'archive_identity_rejected')
    stream, info = private_stream(archive, owner_uid=owner_uid)
    with stream:
        manifest = stream_manifest(stream, created)
        require(manifest['ciphertextBytes']==expected_size and manifest['ciphertextSha256']==expected_sha, 'archive_identity_rejected')
        (streaming_der_check if check is openssl_check else check)(archive)
        require(file_identity(info)==file_identity(os.fstat(stream.fileno()))==file_identity(Path(archive).stat()), 'private_file_changed')
        raw_manifest = canonical_manifest(manifest)
        manifest_sha = hashlib.sha256(raw_manifest).hexdigest()
        session = hashlib.sha256((created+'\n'+expected_sha).encode()).hexdigest()
        identity = {'protocol':MULTIPART_PROTOCOL,'scope':SCOPE,'sessionId':session,'manifestSha256':manifest_sha,'key':object_key(created,expected_sha),'createdAt':created,'ciphertextBytes':expected_size,'ciphertextSha256':expected_sha}
        def call(action, part=0, data=b'{}'):
            return multipart_request(config, action, session, part, data, send=send, clock=clock, gate=gate)
        opened,_ = call('create',data=raw_manifest)
        require(set(opened)==set(identity)|{'uploadedParts','storedComplete'} and all(opened.get(k)==v for k,v in identity.items()) and type(opened['storedComplete']) is bool and isinstance(opened['uploadedParts'],list), 'receipt_identity_rejected')
        uploaded=opened['uploadedParts']
        require(all(type(n) is int and 1<=n<=len(manifest['parts']) for n in uploaded) and len(set(uploaded))==len(uploaded), 'receipt_identity_rejected')
        # Resume asks the same immutable session for each part. Existing matching
        # part receipts return idempotently without overwriting stored parts.
        stream.seek(0)
        for part in manifest['parts']:
            if part['partNumber'] in uploaded:
                stream.seek(part['bytes'],1)
                continue
            chunk = stream.read(part['bytes'])
            require(len(chunk)==part['bytes'] and hashlib.sha256(chunk).hexdigest()==part['sha256'], 'private_file_changed')
            receipt,_ = call('part',part['partNumber'],chunk)
            require(set(receipt)=={'sessionId','partNumber','bytes','sha256','etag'} and all(receipt.get(k)==part[k] for k in ('partNumber','bytes','sha256')) and isinstance(receipt['etag'],str) and 0<len(receipt['etag'])<=256, 'part_receipt_rejected')
        # Independent second complete-source pass before publication catches any
        # in-place/path changes, including bytes already uploaded earlier.
        require(stream_manifest(stream,created)==manifest and file_identity(info)==file_identity(os.fstat(stream.fileno()))==file_identity(Path(archive).stat()), 'private_file_changed')
        completed,_ = call('complete')
        require(set(completed)==set(identity)|{'objectEtag','objectVersion','verified','globalReadbackRequired'} and all(completed.get(k)==v for k,v in identity.items()) and completed['verified'] is False and completed['globalReadbackRequired'] is True, 'receipt_identity_rejected')
        require(all(isinstance(completed[k],str) and 0<len(completed[k])<=256 and all(32<=ord(c)<=126 for c in completed[k]) for k in ('objectEtag','objectVersion')), 'receipt_rejected')
        # Persist only independently read encrypted bytes. On a later normal
        # invocation, rehash every cached byte, bind every chunk to the exact
        # immutable manifest, and continue the remaining remote ranges. This
        # bounds network work across the existing ten-minute service limit.
        cache = Path(archive).with_suffix('.readback.partial')
        if not cache.exists():
            fd=os.open(cache,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
            os.close(fd)
        cached, cached_info = private_stream(cache, owner_uid=owner_uid, allow_empty=True)
        digest, count, received_parts = hashlib.sha256(), 0, 0
        with cached:
            for part in manifest['parts']:
                chunk=cached.read(part['bytes'])
                if not chunk:
                    break
                if len(chunk)!=part['bytes']:
                    # A process may have been terminated during append. Only
                    # the previous complete verified boundary is reusable.
                    break
                require(hashlib.sha256(chunk).hexdigest()==part['sha256'], 'readback_cache_rejected')
                digest.update(chunk);count+=len(chunk);received_parts+=1
        require(cache.stat().st_size<=expected_size, 'readback_cache_rejected')
        space=os.statvfs(cache.parent)
        require(space.f_bavail*space.f_frsize >= expected_size-count+PART_BYTES, 'readback_space_unavailable')
        fd=os.open(cache,os.O_RDWR|os.O_NOFOLLOW)
        with os.fdopen(fd,'r+b') as output:
            require(file_identity(cached_info)==file_identity(os.fstat(output.fileno()))==file_identity(cache.stat()), 'private_file_changed')
            output.truncate(count);output.seek(count)
            for part in manifest['parts'][received_parts:]:
                receipt, chunk = call('readback',part['partNumber'])
                require(set(receipt)=={'sessionId','partNumber','bytes','sha256','objectEtag','objectVersion'} and all(receipt.get(k)==part[k] for k in ('partNumber','bytes','sha256')) and all(receipt.get(k)==completed[k] for k in ('objectEtag','objectVersion')), 'readback_receipt_rejected')
                require(len(chunk)==part['bytes'] and hashlib.sha256(chunk).hexdigest()==part['sha256'], 'stored_copy_unverified')
                output.write(chunk);output.flush();os.fsync(output.fileno())
                digest.update(chunk);count+=len(chunk)
        require(count==expected_size and digest.hexdigest()==expected_sha, 'stored_copy_unverified')
        cache.unlink()
        return {**completed,'verified':True,'globalReadbackRequired':False,'independentReadbackVerified':True,'readbackBytes':count,'readbackSha256':digest.hexdigest(),'duplicate':opened['storedComplete']}



def resume_pending(base, *, config_path=CONFIG, uploader=upload_cipher, gate=allowed, clock=time.time):
    """One pending marker in the existing directory, never a multi-job queue.

    Reuses the original capture timestamp. An older resumed success must not
    masquerade as a new capture or advance today's fresh-capture health.
    """
    require(gate() is True, 'sacred_time_closed')
    base = Path(base)
    marker = base/'last-attempt.json'
    if not marker.exists():
        return None
    try:
        report = json.loads(private_bytes(marker, 128*1024, owner_uid=os.getuid()))
        age = clock()-datetime.strptime(report.get('createdAt',''),'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        raise UploadError('pending_report_rejected') from None
    if report.get('state') not in ('encrypted_verified','encrypted_local_upload_failed','encrypted_upload_held') or report.get('offServerCopyVerified') is not False or not 0<=age<=7*86400:
        return None
    require(Path(report.get('archive','')).parent.resolve()==base.resolve(), 'pending_report_rejected')
    return finalize_backup({**report,'state':'encrypted_verified','offServerCopyVerified':False},base,config_path=config_path,uploader=uploader)


def operator_recovery_copy(archive, created, *, expected_sha, expected_size, base=Path('/var/lib/yarden-cms-backup'), config_path=CONFIG, uploader=upload_cipher, gate=allowed, owner_uid=0):
    """Manual recovery-artifact upload through the existing transport/lock.

    This is intentionally outside native CMS latest/last-attempt freshness.
    A repeat of the same explicit command resumes this same opaque artifact;
    no service, timer, queue or additional sender is introduced.
    """
    import fcntl
    require(gate() is True, 'sacred_time_closed')
    base=Path(base);archive=Path(archive)
    require(isinstance(created,str) and re.fullmatch(r'\d{8}T\d{6}Z',created), 'capture_time_rejected')
    require(archive.parent.resolve()==base.resolve() and re.fullmatch(r'derech-recovery-[a-z0-9-]{1,48}-'+re.escape(created)+r'\.cms',archive.name), 'recovery_artifact_path_rejected')
    require(type(expected_size) is int and 0<expected_size<=TOTAL_BYTES and isinstance(expected_sha,str) and re.fullmatch(r'[a-f0-9]{64}',expected_sha), 'archive_identity_rejected')
    for ancestor in (*base.parents,base):
        require(not ancestor.is_symlink(), 'private_file_rejected')
    fd=os.open(base/'backup.lock',os.O_RDWR|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a+') as lock:
        info=os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==owner_uid and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600, 'private_file_rejected')
        try:
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise UploadError('backup_invocation_active') from None
        report={'version':1,'artifactKind':'operator_recovery_artifact','state':'encrypted_verified','createdAt':created,'archive':str(archive),'ciphertextBytes':expected_size,'ciphertextSha256':expected_sha,'complete':False,'offServerCopyVerified':False}
        report_path=archive.with_suffix('.recovery-copy.json')
        atomic_json(report_path,report)
        try:
            receipt=uploader(config_path,archive,created,expected_sha=expected_sha,expected_size=expected_size)
            require(isinstance(receipt,dict) and receipt.get('verified') is True and receipt.get('scope')==SCOPE and receipt.get('key')==object_key(created,expected_sha) and receipt.get('ciphertextBytes')==expected_size and receipt.get('ciphertextSha256')==expected_sha, 'receipt_identity_rejected')
            if receipt.get('protocol')==MULTIPART_PROTOCOL or expected_size>MAX_BYTES:
                require(receipt.get('protocol')==MULTIPART_PROTOCOL and receipt.get('independentReadbackVerified') is True and receipt.get('readbackBytes')==expected_size and receipt.get('readbackSha256')==expected_sha, 'stored_copy_unverified')
        except Exception as error:
            held=isinstance(error,UploadError) and str(error)=='sacred_time_closed'
            atomic_json(report_path,{**report,'state':'encrypted_upload_held' if held else 'encrypted_local_upload_failed','failureCode':'offserver_copy_unverified'})
            raise UploadError('sacred_time_closed' if held else 'offserver_copy_unverified') from None
        result={**report,'state':'offserver_copy_verified','complete':True,'offServerCopyVerified':True,'offServerReceipt':receipt}
        atomic_json(report_path,result)
        return result


def main(argv=None):
    import argparse
    parser=argparse.ArgumentParser(description='Manual opaque recovery-artifact copy using the existing receiver and backup lock; does not advance native CMS freshness.')
    parser.add_argument('--operator-recovery',action='store_true',required=True)
    parser.add_argument('--archive',required=True,type=Path)
    parser.add_argument('--created-at',required=True,help='Original source capture timestamp, YYYYMMDDTHHMMSSZ; never the new encryption/upload time.')
    parser.add_argument('--expected-sha256',required=True)
    parser.add_argument('--expected-size',required=True,type=int)
    args=parser.parse_args(argv)
    try:
        result=operator_recovery_copy(args.archive,args.created_at,expected_sha=args.expected_sha256,expected_size=args.expected_size)
        print(json.dumps(result,separators=(',',':')))
        return 0
    except UploadError as error:
        held=str(error)=='sacred_time_closed'
        print(json.dumps({'state':'encrypted_upload_held' if held else 'offserver_copy_unverified','complete':False,'offServerCopyVerified':False,'code':str(error)}))
        return 75 if held else 2
    except Exception:
        print('{"state":"offserver_copy_unverified","complete":false,"offServerCopyVerified":false,"code":"operator_copy_failed"}')
        return 2


if __name__=='__main__':
    raise SystemExit(main())
