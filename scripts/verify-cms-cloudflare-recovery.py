"""Independently recover the active Cloudflare CMS including actual uploaded media."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,tarfile,tempfile
def recovered_media_fixture(capture):
 wrapper=json.loads((capture/'snapshot.json').read_text());manifest=json.loads((capture/'manifest.json').read_text())
 rows=wrapper['snapshot']['media'];by_key={row['key']:row for row in manifest['media']}
 assert len(by_key)==len(rows) and set(by_key)=={row['key']for row in rows},'Media inventory mismatch'
 result=[]
 for row in rows:
  assert re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',row['key'])
  assert isinstance(row.get('httpMetadata'),dict) and isinstance(row.get('customMetadata'),dict),'Original media metadata is required'
  path=capture/'media'/row['key'];assert not path.is_symlink() and path.is_file()
  body=path.read_bytes();assert len(body)==row['size']==by_key[row['key']]['size'] and hashlib.sha256(body).hexdigest()==by_key[row['key']]['sha256']
  result.append({**row,'sha256':by_key[row['key']]['sha256']})
 assert {path.name for path in(capture/'media').iterdir()}==set(by_key),'Unexpected media files'
 return result

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--require-auth-schema',action='store_true');parser.add_argument('--require-platform-pin',action='store_true');parser.add_argument('--require-contact-schema',action='store_true');parser.add_argument('--require-seo-drafts',action='store_true');parser.add_argument('--output',default='audit/cms-cloudflare-r2-recovery-2026-10-21.json');parser.add_argument('--rehearsal-fixture');parser.add_argument('--rehearsal-current-source');parser.add_argument('--rehearsal-previous-source',default='d399f1e13f56edf59557fcee6c2686cbc9ea96c3');args=parser.parse_args()
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
  media_objects=recovered_media_fixture(capture)
  fixture=capture/'media/a073b47e-9889-4fad-8e00-d2c8b96bf6e1'
  assert fixture.stat().st_size==15800 and hashlib.sha256(fixture.read_bytes()).hexdigest()=='9e50b9246ae08d60d951c5ac5aaf34e956c202773a528954f2d6bd437947d20d'
  import sqlite3
  db=sqlite3.connect(work/'proof.sqlite');pin=db.execute('SELECT cf_access_user_id FROM cms_users WHERE email=?',('22yarden22@gmail.com',)).fetchone();assert pin and pin[0]
  columns={row[1]for row in db.execute('PRAGMA table_info(cms_users)')};auth_schema='platform_auth_user_id'in columns;platform_pin=False
  if args.require_auth_schema or args.require_platform_pin:assert auth_schema,'Recovery archive predates shared identity migration'
  if auth_schema:
   snapshot=json.loads((capture/'snapshot.json').read_text())['snapshot'];assert len(snapshot['migrations']) in (7,8) and snapshot['migrations'][6]['name']=='0006_platform_auth.sql'
   if len(snapshot['migrations'])==8:assert snapshot['migrations'][7]['name']=='0008_contact_controls.sql' and db.execute('SELECT count(*) FROM contact_rate_limits').fetchone()[0]==0
   assert db.execute('SELECT COUNT(*) FROM platform_auth_rate_limits').fetchone()[0]==0,'Transient rate counters must restore empty'
   managed=db.execute('SELECT platform_auth_user_id FROM cms_users WHERE email=?',('22yarden22@gmail.com',)).fetchone();platform_pin=bool(managed and managed[0])
  if args.require_platform_pin:assert platform_pin,'Approved managed identity has not been linked in this recovery set'
  contact_schema=bool(db.execute("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='contact_rate_limits'").fetchone()[0])
  if args.require_contact_schema:assert contact_schema,'Recovery archive predates contact controls'
  seo_drafts=[json.loads(row[0]) for row in db.execute("SELECT value FROM cms_settings WHERE key LIKE 'cms_seo_draft:derech:derech-main:%'")]
  if args.require_seo_drafts:assert len(seo_drafts)==4 and all(row.get('state')=='proposed' and row.get('publicationAllowed') is False for row in seo_drafts),'Four private current SEO drafts are not recovered'
  if args.rehearsal_fixture:
   import shutil,stat
   target=Path(args.rehearsal_fixture)
   assert str(target).startswith('/private/tmp/derech-full-rollback-') and target.is_dir() and not target.is_symlink() and stat.S_IMODE(target.stat().st_mode)==0o700
   assert not (target/'fixture.json').exists() and not (target/'fixture-media').exists()
   if args.rehearsal_current_source:source={'source':args.rehearsal_current_source}
   else:source=json.loads((ROOT/'audit/site-integrated-build-2026-10-21.json').read_text());assert source['passed'] is True
   assert re.fullmatch(r'[a-f0-9]{40}',source['source']) and re.fullmatch(r'[a-f0-9]{40}',args.rehearsal_previous_source),'Exact rehearsal source revisions are required'
   db.row_factory=sqlite3.Row
   tables={name:[dict(row)for row in db.execute('SELECT * FROM '+name+' ORDER BY rowid')]for name in [*proof['tableCounts'],'platform_auth_rate_limits',*(['contact_rate_limits']if contact_schema else[])]}
   owner=next(row for row in tables['cms_users']if row['email']=='22yarden22@gmail.com');assert owner['platform_auth_user_id']
   private_fixture={'schema':[dict(row)for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name")],
    'tables':tables,'sequence':[dict(row)for row in db.execute('SELECT * FROM sqlite_sequence ORDER BY name')],
    'owner':owner,'snapshotSha256':proof['snapshotSha256'],'mediaDirectory':str(target/'fixture-media'),
    'mediaObjects':media_objects,
    'sources':{'current':source['source'],'previous':args.rehearsal_previous_source},
    'expectedCmsRows':sum(len(rows)for name,rows in tables.items()if name.startswith('cms_'))}
   shutil.copytree(capture/'media',target/'fixture-media');(target/'fixture-media').chmod(0o700)
   for media_file in (target/'fixture-media').iterdir():media_file.chmod(0o600)
   (target/'fixture.json').write_text(json.dumps(private_fixture));(target/'fixture.json').chmod(0o600)
  db.close()
 safe={**report,'independentProviderDownloadVerified':True,'providerCiphertextHashIdentical':True,'providerCiphertextDecryptedLocally':True,'providerDownloadedRestore':proof,'recurringOffServerCopyConfigured':True,'localCiphertextCopy':str(dest.relative_to(ROOT)),'activeBackupOrigin':'https://derech-tkuma-review.22yarden22.workers.dev','cloudflareMediaFixtureIndependentlyRecovered':True,'cloudflareOwnerIdentityPinRecovered':True}
 safe.update(mediaHttpAndCustomMetadataRecovered=True,mediaObjectsWithOriginalMetadata=len(media_objects),contactSchemaRecovered=contact_schema,privateSeoDraftsRecovered=len(seo_drafts),sharedAuthSchemaRecovered=auth_schema,sharedOwnerIdentityPinRecovered=platform_pin,transientRateCountersRestoredEmpty=auth_schema,managedProviderCredentialsIncluded=False)
 (ROOT/args.output).write_text(json.dumps(safe,indent=2)+'\n');print(json.dumps(safe))

if __name__=='__main__':main()
