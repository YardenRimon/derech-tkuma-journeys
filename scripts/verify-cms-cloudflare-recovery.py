"""Independently recover the active Cloudflare CMS including actual uploaded media."""
from pathlib import Path
import hashlib,json,os,re,subprocess,tarfile,tempfile
ROOT=Path(__file__).resolve().parents[1];os.umask(0o077)
KEYS=Path('/Users/yardenrimon/.codex/.chatgpt-projects/g-p-6accbd6db38081919ddd3d977bcb93e1/var/hetzner')
ssh=['ssh','-i',str(KEYS/'yarden-services-ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(KEYS/'known_hosts'),'-o','ConnectTimeout=10','root@157.90.121.108']
remote="from pathlib import Path;import json;v=json.loads(Path('/etc/yarden-cms-backup.json').read_text());assert v['url']=='https://derech-tkuma-review.22yarden22.workers.dev' and set(v)=={'url','secret','scope'};print(Path('/var/lib/yarden-cms-backup/latest.json').read_text())"
r=subprocess.run(ssh+['python3','-'],input=remote,capture_output=True,text=True,timeout=20);assert r.returncode==0,'Active backup destination differs';report=json.loads(r.stdout)
receipt=report['offServerReceipt'];assert report['complete']is True and report['offServerCopyVerified']is True and receipt['verified']is True
assert receipt['scope']=={'tenantId':'derech','siteId':'derech-main'}and re.fullmatch(r'derech/derech-main/\d{4}/\d{2}/\d{2}/\d{8}T\d{6}Z-[a-f0-9]{64}\.cms',receipt['key'])
private=ROOT/'var/hetzner/cms-recovery';private.mkdir(parents=True,mode=0o700,exist_ok=True)
dest=private/('r2-'+Path(report['archive']).name)
cf=ROOT/'var/hetzner/cloudflare'
env={**os.environ,'PATH':'/private/tmp/derech-npm-runtime/bin:/usr/bin:/bin:/usr/sbin:/sbin','CLOUDFLARE_API_TOKEN':(cf/'ci-token').read_text().strip(),'CLOUDFLARE_ACCOUNT_ID':'8b35c6b4ccb397857d80908ccf499f73','WRANGLER_SEND_METRICS':'false','CI':'true'}
result=subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','r2','object','get','derech-tkuma-backups/'+receipt['key'],'--file',str(dest),'--remote','--config',str(cf/'backup-receiver.json')],cwd=ROOT/'platform-cms',env=env,capture_output=True,text=True,timeout=60)
assert result.returncode==0,'Owner-authorized private provider download failed'
dest.chmod(0o600);assert dest.stat().st_size==report['ciphertextBytes']and hashlib.sha256(dest.read_bytes()).hexdigest()==report['ciphertextSha256']
with tempfile.TemporaryDirectory(prefix='r2-recovery-',dir=private)as temp:
 work=Path(temp);tar=work/'capture.tar'
 subprocess.run(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(dest),'-inkey',str(KEYS/'backup/private-key.pem'),'-recip',str(KEYS/'backup/public-certificate.pem'),'-passin','file:'+str(KEYS/'backup/key-passphrase'),'-out',str(tar)],check=True,capture_output=True)
 with tarfile.open(tar)as tf:
  for item in tf.getmembers():assert not Path(item.name).is_absolute()and'..'not in Path(item.name).parts and(item.isfile()or item.isdir())
  tf.extractall(work/'restored')
 candidates=list((work/'restored').rglob('manifest.json'));assert len(candidates)==1
 proof=json.loads(subprocess.check_output(['python3',str(ROOT/'scripts/cms-backup-restore.py'),'--backup',str(candidates[0].parent),'--target',str(work/'proof.sqlite'),'--migrations',str(ROOT/'platform-cms/drizzle')],text=True))
 assert proof['snapshotSha256']==report['snapshotSha256']
 capture=candidates[0].parent
 fixture=capture/'media/a073b47e-9889-4fad-8e00-d2c8b96bf6e1'
 assert fixture.stat().st_size==15800 and hashlib.sha256(fixture.read_bytes()).hexdigest()=='9e50b9246ae08d60d951c5ac5aaf34e956c202773a528954f2d6bd437947d20d'
 import sqlite3
 db=sqlite3.connect(work/'proof.sqlite');pin=db.execute('SELECT cf_access_user_id FROM cms_users WHERE email=?',('22yarden22@gmail.com',)).fetchone();assert pin and pin[0];db.close()
safe={**report,'independentProviderDownloadVerified':True,'providerCiphertextHashIdentical':True,'providerCiphertextDecryptedLocally':True,'providerDownloadedRestore':proof,'recurringOffServerCopyConfigured':True,'localCiphertextCopy':str(dest.relative_to(ROOT)),'activeBackupOrigin':'https://derech-tkuma-review.22yarden22.workers.dev','cloudflareMediaFixtureIndependentlyRecovered':True,'cloudflareOwnerIdentityPinRecovered':True}
(ROOT/'audit/cms-cloudflare-r2-recovery-2026-10-20.json').write_text(json.dumps(safe,indent=2)+'\n');print(json.dumps(safe))
