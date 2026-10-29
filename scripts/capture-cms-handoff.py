"""Fresh encrypted captures of both fixed CMS destinations during transport pause.

Runs the reviewed downloader in memory on the existing backup host. Only
ciphertext and non-content proofs leave the host; no target/config is changed.
"""
from pathlib import Path
import datetime, hashlib, json, os, re, subprocess

ROOT = Path(__file__).resolve().parents[1]
SSHBASE = Path('/Users/yardenrimon/.codex/.chatgpt-projects/g-p-6accbd6db38081919ddd3d977bcb93e1/var/hetzner')
SSH = ['ssh', '-i', str(SSHBASE/'yarden-services-ed25519'), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile='+str(SSHBASE/'known_hosts'), '-o', 'ConnectTimeout=10', 'root@157.90.121.108']
os.umask(0o077)
remote = '''from pathlib import Path
import atexit,contextlib,datetime,hashlib,io,json,os,shutil,stat,subprocess,sys,tarfile,tempfile,types
os.umask(0o077)
p=subprocess.run(['/usr/bin/python3','/opt/yarden-time-policy/time_policy.py'],capture_output=True,text=True)
assert p.returncode==0 and json.loads(p.stdout)['allowed'] is True
bridge=json.loads(Path('/etc/yarden-answer-cms.json').read_text())
assert bridge['enabled'] is False and bridge['origin']=='https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site','CMS transport must remain paused'
cfgpath=Path('/etc/yarden-cms-backup.json');assert stat.S_IMODE(cfgpath.stat().st_mode)==0o600 and cfgpath.stat().st_uid==0
cfg=json.loads(cfgpath.read_text());assert cfg['url']=='https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site' and cfg['scope']=={'tenantId':'derech','siteId':'derech-main'}
state=Path('/var/lib/yarden-cms-backup/handoff-captures');state.mkdir(mode=0o700,exist_ok=True);assert not state.is_symlink()
work=Path(tempfile.mkdtemp(prefix='.capture-',dir=state));atexit.register(shutil.rmtree,work,ignore_errors=True)
module=types.ModuleType('reviewed_capture');exec(DOWNLOADER,module.__dict__)
cfconfig=work/'cloudflare.private.json';cfconfig.write_text(json.dumps({'url':'https://derech-tkuma-review.22yarden22.workers.dev','secret':cfg['secret'],'scope':cfg['scope']}));cfconfig.chmod(0o600)
reports={}
for label,config in [('native',cfgpath),('cloudflare',cfconfig)]:
 capture=work/label
 print('CAPTURE_STAGE='+label+'_download',file=sys.stderr)
 with contextlib.redirect_stdout(io.StringIO()):manifest=module.download(config,capture)
 print('CAPTURE_STAGE='+label+'_restore',file=sys.stderr)
 proof=json.loads(subprocess.check_output(['/usr/bin/python3','/opt/yarden-cms-backup/cms-backup-restore.py','--backup',str(capture),'--target',str(work/(label+'.sqlite')),'--migrations','/opt/yarden-cms-backup/drizzle'],text=True))
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 plain=work/(label+'.tar');cipher=state/(label+'-'+stamp+'.cms')
 with tarfile.open(plain,'w')as tf:tf.add(capture,arcname='capture')
 subprocess.run(['openssl','cms','-encrypt','-binary','-aes256','-outform','DER','-in',str(plain),'-out',str(cipher),'/etc/yarden-platform-backup/public-certificate.pem'],check=True,capture_output=True)
 cipher.chmod(0o600)
 reports[label]={'capturedAt':stamp,'archive':str(cipher),'ciphertextBytes':cipher.stat().st_size,'ciphertextSha256':hashlib.sha256(cipher.read_bytes()).hexdigest(),'snapshotSha256':manifest['snapshotSha256'],'proof':proof}
assert json.loads(Path('/etc/yarden-answer-cms.json').read_text())['enabled'] is False
shutil.rmtree(work)
print(json.dumps(reports))
'''.replace('DOWNLOADER', repr((ROOT/'scripts/cms-backup-download.py').read_text()))
result = subprocess.run(SSH+['python3', '-'], input=remote, text=True, capture_output=True, timeout=180)
if result.returncode:
    # Remote traceback may contain only code, but keep all diagnostic bodies private.
    kind=re.findall(r'^([A-Za-z][A-Za-z0-9_]*(?:Error|Exception)):',result.stderr,re.M)
    status=re.findall(r'HTTP Error (\d{3})',result.stderr)
    stage=re.findall(r'CAPTURE_STAGE=([a-z_]+)',result.stderr)
    known=[code for code in ['Snapshot digest or scope mismatch','Media identity/byte/hash mismatch','Backup config contains unsupported or cross-provider credentials','Backup output must be a new directory'] if code in result.stderr]
    raise RuntimeError('Fresh encrypted capture failed: '+str(kind[-1:] or ['remote_check'])+' HTTP '+str(status[-1:])+' stage '+str(stage[-1:])+' reason '+str(known)+'; diagnostic bodies withheld')
reports = json.loads(result.stdout)
private = ROOT/'var/hetzner/cms-recovery/handoff'; private.mkdir(parents=True, mode=0o700, exist_ok=True)
for label, report in reports.items():
    archive = report['archive']; name = Path(archive).name
    assert archive == '/var/lib/yarden-cms-backup/handoff-captures/'+name
    assert name.startswith(label+'-') and name.endswith('.cms') and name.replace('-', '').replace('.', '').isalnum()
    dest = private/name
    with dest.open('xb') as output:
        subprocess.run(SSH+['cat '+archive], stdout=output, check=True, timeout=40)
    assert dest.stat().st_size == report['ciphertextBytes']
    assert hashlib.sha256(dest.read_bytes()).hexdigest() == report['ciphertextSha256']
    report['localCiphertextCopy'] = str(dest.relative_to(ROOT))
proof = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'transportPaused': True, 'destinationsChanged': False, 'encryptedCopiesVerified': True, 'captures': reports}
(ROOT/'audit/cms-cloudflare-final-captures-2026-10-20.json').write_text(json.dumps(proof, indent=2)+'\n')
print(json.dumps(proof))
