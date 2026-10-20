"""Copy existing project HMACs in memory into the exact review Worker's secret store.

No credential rotation, bridge repointing, secret output or local secret copy.
"""
from pathlib import Path
import datetime,json,subprocess,urllib.request,urllib.error

ROOT=Path(__file__).resolve().parents[1]
ACCOUNT='8b35c6b4ccb397857d80908ccf499f73'
WORKER='derech-tkuma-review'
token=(ROOT/'var/hetzner/cloudflare/ci-token').read_text().strip()
base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER
def api(method,path,payload=None):
    request=urllib.request.Request(base+path,method=method,data=json.dumps(payload).encode()if payload is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'DerechScopedRuntimeSetup/1.0'})
    try:
        with urllib.request.urlopen(request,timeout=35)as response:data=json.load(response)
    except urllib.error.HTTPError as error:raise RuntimeError('Cloudflare HTTP '+str(error.code))from None
    if not data.get('success'):raise RuntimeError('Cloudflare rejected scoped setup')
    return data['result']
settings=api('GET','/settings');bindings={b['name']:b for b in settings['bindings']}
assert bindings['DB']['database_id']=='53051708-5e0b-499e-a986-7c03c3c32097'
assert bindings['BUCKET']['bucket_name']=='derech-tkuma-media-review'
assert bindings['PLATFORM_RELEASE_STAGE']['text']=='review'
assert bindings['PLATFORM_PUBLIC_ORIGIN']['text']=='https://derech-tkuma-review.22yarden22.workers.dev'
sshbase=Path('/Users/yardenrimon/.codex/.chatgpt-projects/g-p-6accbd6db38081919ddd3d977bcb93e1/var/hetzner')
remote='''from pathlib import Path
import json,stat,subprocess
p=subprocess.run(['/usr/bin/python3','/opt/yarden-time-policy/time_policy.py'],capture_output=True,text=True)
assert p.returncode==0 and json.loads(p.stdout)['allowed'] is True
def read(path,mode):
 p=Path(path);s=p.stat();assert not p.is_symlink()and s.st_uid==0 and stat.S_IMODE(s.st_mode)==mode
 return json.loads(p.read_text())
# Existing bridge config is root-owned 0640 so its service group can read it;
# the backup config is root-only. Preserve both installed permission boundaries.
execution=read('/etc/yarden-answer-cms.json',0o640);backup=read('/etc/yarden-cms-backup.json',0o600)
origin='https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site'
assert execution['origin']==origin and execution['version']==1 and isinstance(execution['enabled'],bool)
assert backup['url']==origin and backup['scope']=={'tenantId':'derech','siteId':'derech-main'}
assert execution['secret']!=backup['secret']
print(json.dumps({'CMS_EXECUTION_SECRET':execution['secret'],'CMS_BACKUP_SECRET':backup['secret']}))
'''
command=['ssh','-i',str(sshbase/'yarden-services-ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(sshbase/'known_hosts'),'-o','ConnectTimeout=10','root@157.90.121.108','python3','-']
result=subprocess.run(command,input=remote,text=True,capture_output=True,timeout=40)
if result.returncode:raise RuntimeError('Scoped source credential check failed; values withheld')
secrets=json.loads(result.stdout)
assert set(secrets)=={'CMS_EXECUTION_SECRET','CMS_BACKUP_SECRET'}
for name,value in secrets.items():
    assert isinstance(value,str)and 40<=len(value)<=256
    api('PUT','/secrets',{'name':name,'text':value,'type':'secret_text'})
names={x['name']for x in api('GET','/secrets')};assert set(secrets)<=names
report={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'worker':WORKER,'accountId':ACCOUNT,'secretNames':sorted(secrets),'secretStoreReadback':True,'existingKeysPreserved':True,'separatePurposeKeys':True,'plaintextPrintedOrPersisted':False,'bridgeOriginChanged':False,'sourceBackupOriginChanged':False}
(ROOT/'audit/cloudflare-cms-runtime-secrets-2026-10-20.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
