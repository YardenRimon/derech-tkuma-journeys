"""Install additive auth schema recovery support without changing backup targets."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[1]
KEYS=Path('/Users/yardenrimon/.codex/.chatgpt-projects/g-p-6accbd6db38081919ddd3d977bcb93e1/var/hetzner')
old=subprocess.check_output(['git','show','8e4a060188ab3d6cb80816ec311e2c18ca96a572:scripts/cms-backup-restore.py'],cwd=ROOT/'sites/derech-github-foundation')
restore=(ROOT/'scripts/cms-backup-restore.py').read_text()
migrations={p.name:p.read_text() for p in sorted((ROOT/'platform-cms/drizzle').glob('*.sql'))}
assert len(migrations)==7 and '0006_platform_auth.sql' in migrations
payload={'oldRestoreSha':hashlib.sha256(old).hexdigest(),'restore':restore,'migrations':migrations}
remote='''from pathlib import Path
import datetime,fcntl,hashlib,json,os,subprocess,tempfile
v=json.loads(INPUT)
policy=subprocess.run(['python3','/opt/yarden-time-policy/time_policy.py'],capture_output=True,text=True)
assert policy.returncode==0 and json.loads(policy.stdout).get('allowed') is True
config=json.loads(Path('/etc/yarden-cms-backup.json').read_text())
assert config['url']=='https://derech-tkuma-review.22yarden22.workers.dev' and set(config)=={'url','secret','scope'}
state=Path('/var/lib/yarden-cms-backup');lock=(state/'backup.lock').open('a+');fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
base=Path('/opt/yarden-cms-backup');dest=base/'cms-backup-restore.py'
digest=lambda value:hashlib.sha256(value).hexdigest()
new=digest(v['restore'].encode());assert digest(dest.read_bytes()) in {v['oldRestoreSha'],new},'Installed restore helper changed concurrently'
existing=sorted(p.name for p in (base/'drizzle').glob('*.sql'))
assert existing in [list(v['migrations'])[:6],list(v['migrations'])]
for name in existing:assert (base/'drizzle'/name).read_text()==v['migrations'][name]
backup=state/('auth-schema-source-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(mode=0o700);(backup/'cms-backup-restore.py').write_bytes(dest.read_bytes());(backup/'cms-backup-restore.py').chmod(0o600)
def atomic(path,content):
 assert not path.is_symlink();fd,temp=tempfile.mkstemp(prefix='.auth-schema-',dir=path.parent)
 with os.fdopen(fd,'w') as file:os.fchmod(file.fileno(),0o644);file.write(content);file.flush();os.fsync(file.fileno())
 os.replace(temp,path)
atomic(dest,v['restore']);atomic(base/'drizzle/0006_platform_auth.sql',v['migrations']['0006_platform_auth.sql'])
assert digest(dest.read_bytes())==new
for name,content in v['migrations'].items():assert (base/'drizzle'/name).read_text()==content
print(json.dumps({'installed':True,'restoreSha256':new,'migrations':len(v['migrations']),'oldSnapshotPrefixSupported':True,'backupTargetChanged':False,'timerChanged':False,'credentialsChanged':False,'timePolicyRetained':True}))
'''.replace('INPUT',repr(json.dumps(payload)))
ssh=['ssh','-i',str(KEYS/'yarden-services-ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(KEYS/'known_hosts'),'-o','ConnectTimeout=10','root@157.90.121.108','python3','-']
result=subprocess.run(ssh,input=remote,capture_output=True,text=True,timeout=40)
if result.returncode:raise RuntimeError('Backup schema upgrade refused; private output withheld')
proof=json.loads(result.stdout);(ROOT/'audit/auth-backup-schema-upgrade-2026-10-20.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
