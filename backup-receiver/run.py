import subprocess,json,os,sys,tempfile,tarfile,pathlib,datetime,hashlib,fcntl,shutil,atexit
from backup_upload import finalize_backup,UploadError,atomic_json,resume_pending,stream_sha256
os.umask(0o077)
p=subprocess.run(['/usr/bin/python3','/opt/yarden-time-policy/time_policy.py'],capture_output=True,text=True)
try:allowed=p.returncode==0 and json.loads(p.stdout).get('allowed')is True
except Exception:allowed=False
if not allowed:print('{"state":"time_policy_closed"}');sys.exit(0)
base=pathlib.Path('/var/lib/yarden-cms-backup');base.mkdir(mode=0o700,exist_ok=True)
lock=(base/'backup.lock').open('a+');fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
try:resumed=resume_pending(base)
except UploadError:
 print('{"state":"offserver_copy_unverified","complete":false}');sys.exit(2)
if resumed is not None:
 print(json.dumps({**resumed,'resumed':True}));sys.exit(0)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');work=pathlib.Path(tempfile.mkdtemp(prefix='.working-',dir=base));backup=work/'capture'
atexit.register(shutil.rmtree,work,ignore_errors=True)
atomic_json(base/'last-attempt.json',{'createdAt':stamp,'state':'capture_started','complete':False,'invocationId':os.environ.get('INVOCATION_ID')})
r=subprocess.run(['/usr/bin/python3','/opt/yarden-cms-backup/cms-backup-download.py','--config','/etc/yarden-cms-backup.json','--output',str(backup)],capture_output=True,text=True)
if r.returncode:print('{"state":"backup_capture_failed","complete":false}');sys.exit(2)
manifest=json.loads((backup/'manifest.json').read_text())
r=subprocess.run(['/usr/bin/python3','/opt/yarden-cms-backup/cms-backup-restore.py','--backup',str(backup),'--target',str(work/'proof.sqlite'),'--migrations','/opt/yarden-cms-backup/drizzle'],capture_output=True,text=True)
if r.returncode:print('{"state":"isolated_restore_failed","complete":false}');sys.exit(2)
proof=json.loads(r.stdout)
plain=work/'capture.tar'
with tarfile.open(plain,'w')as t:t.add(backup,arcname='capture')
cipher=base/('derech-cms-'+stamp+'.cms');partial=base/('.derech-cms-'+stamp+'.partial')
subprocess.run(['openssl','cms','-encrypt','-binary','-aes256','-outform','DER','-in',str(plain),'-out',str(partial),'/etc/yarden-platform-backup/public-certificate.pem'],check=True,capture_output=True)
os.chmod(partial,0o600);os.replace(partial,cipher)
report={'version':1,'state':'encrypted_verified','createdAt':stamp,'invocationId':os.environ.get('INVOCATION_ID'),'archive':str(cipher),'ciphertextBytes':cipher.stat().st_size,'ciphertextSha256':stream_sha256(cipher),'snapshotSha256':manifest['snapshotSha256'],'proof':proof,'offServerCopyVerified':False}
try:report=finalize_backup(report,base)
except UploadError:
 print('{"state":"offserver_copy_unverified","complete":false}');sys.exit(2)
# Remove only this run's disposable plaintext working directory after encryption+restore proof.
shutil.rmtree(work)
print(json.dumps(report))
