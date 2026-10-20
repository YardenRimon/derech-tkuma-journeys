"""Review/apply one fixed-destination, optimistic guarded D1 delta transaction.

Default is dry run. Uses only encrypted captured backups; plaintext is transient
in a private directory. No secrets, row values, SQL or content are printed.
"""
from pathlib import Path
import argparse,contextlib,datetime,hashlib,importlib.util,io,json,os,subprocess,tarfile,tempfile,urllib.request,urllib.error

ROOT=Path(__file__).resolve().parents[1]
os.umask(0o077)
spec=importlib.util.spec_from_file_location('delta_plan',ROOT/'scripts/reconcile-cms-cloudflare-review.py');planner=importlib.util.module_from_spec(spec);spec.loader.exec_module(planner)
keys=Path('/Users/yardenrimon/.codex/.chatgpt-projects/g-p-6accbd6db38081919ddd3d977bcb93e1/var/hetzner/backup')

def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
 freeze=json.loads((ROOT/'audit/cms-sites-write-freeze-2026-10-20.json').read_text());assert freeze['browserAndMachineWritesBlocked'] is True
 capture=json.loads((ROOT/'audit/cms-cloudflare-final-captures-2026-10-20.json').read_text());assert capture['transportPaused'] and capture['encryptedCopiesVerified']
 baseline=json.loads((ROOT/'audit/cms-encrypted-offserver-recovery-2026-10-19.json').read_text())
 raw_proof=json.loads((ROOT/'audit/cms-d1-rest-batch-atomicity-2026-10-20.json').read_text())
 private=ROOT/'var/hetzner/cms-recovery/handoff'
 with tempfile.TemporaryDirectory(prefix='.delta-',dir=private) as directory:
  work=Path(directory);wrappers=[]
  for label,report,field in [('baseline',baseline,'ciphertextCopy'),('native',capture['captures']['native'],'localCiphertextCopy'),('cloudflare',capture['captures']['cloudflare'],'localCiphertextCopy')]:
   archive=ROOT/report[field];assert hashlib.sha256(archive.read_bytes()).hexdigest()==report['ciphertextSha256']
   plain=work/(label+'.tar');dest=work/label;dest.mkdir(mode=0o700)
   subprocess.run(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(archive),'-inkey',str(keys/'private-key.pem'),'-recip',str(keys/'public-certificate.pem'),'-passin','file:'+str(keys/'key-passphrase'),'-out',str(plain)],check=True,capture_output=True)
   with tarfile.open(plain)as tf:
    for entry in tf.getmembers():assert not Path(entry.name).is_absolute() and '..' not in Path(entry.name).parts and (entry.isfile() or entry.isdir())
    tf.extractall(dest)
   candidates=list(dest.rglob('manifest.json'));assert len(candidates)==1;data=candidates[0].parent
   with contextlib.redirect_stdout(io.StringIO()):planner.restore.restore(data,work/(label+'.sqlite'),ROOT/'platform-cms/drizzle')
   wrappers.append(json.loads((data/'snapshot.json').read_text()))
  plan=planner.plan_merge(*wrappers,baseline_sha=planner.BASELINE_SHA,rest_atomicity_proof=raw_proof)
  assert plan['accountId']==planner.ACCOUNT_ID and plan['databaseId']==planner.DATABASE_ID and plan['scope']==planner.SCOPE
  report={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'executed':args.execute,'planSha256':planner.digest(plan),'baselineSha256':plan['baselineSha256'],'sourceSha256':plan['sourceSha256'],'targetSha256':plan['targetSha256'],'restAtomicityProofSha256':plan['restAtomicityProofSha256'],**plan['summary']}
  if args.execute:
   token=(ROOT/'var/hetzner/cloudflare/ci-token').read_text().strip()
   base='https://api.cloudflare.com/client/v4/accounts/'+planner.ACCOUNT_ID+'/d1/database/'+planner.DATABASE_ID
   def api(path,payload=None):
    req=urllib.request.Request(base+path,data=json.dumps(payload).encode()if payload is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'DerechGuardedDelta/1.0'})
    try:
     with urllib.request.urlopen(req,timeout=55)as r:result=json.load(r)
    except urllib.error.HTTPError as e:raise RuntimeError('D1 guarded delta HTTP '+str(e.code)+'; response withheld')from None
    assert result['success'],'Guarded D1 request rejected; do not retry blindly'
    return result['result']
   assert api('')['name']==planner.DATABASE_NAME
   # Exactly ONE REST request; atomic rollback was independently measured on
   # this account. All current-target and final-state guards are inside it.
   result=api('/query',{'batch':plan['batch']});assert len(result)==len(plan['batch']) and all(r.get('success') for r in result)
   result=api('/query',{'batch':[{'sql':'SELECT * FROM '+name+' ORDER BY '+planner.restore.ORDER[name]}for name in planner.ORDER]})
   for name,table in zip(planner.ORDER,result):assert planner.digest(table['results'])==plan['expectedRowsSha256'][name],'Post-transaction rows changed; investigate without overwrite'
   report.update(singleAtomicRequest=True,fullReadbackVerified=True,allHistoricalRowsPreserved=True,cloudflareOwnerPinPreserved=True)
  (ROOT/('audit/cms-cloudflare-final-delta-2026-10-20.json'if args.execute else 'audit/cms-cloudflare-final-delta-prepared-2026-10-20.json')).write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps(report))

if __name__=='__main__':main()
