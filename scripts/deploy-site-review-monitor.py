"""Install the approved fixed-origin read-only Site monitor; no notification sender."""
from pathlib import Path
import json,subprocess
root=Path(__file__).resolve().parents[1]
files={'site-review-monitor.py':(root/'scripts/site-review-monitor.py').read_text(),'site-release.json':(root/'platform-cms/lib/site-release.json').read_text()}
runner='''import json,subprocess,sys
p=subprocess.run(['/usr/bin/python3','/opt/yarden-time-policy/time_policy.py'],capture_output=True,text=True)
try: allowed=p.returncode==0 and json.loads(p.stdout).get('allowed') is True
except Exception: allowed=False
if not allowed:
 print('{"state":"time_policy_closed","deliveryIntegrated":false}');sys.exit(0)
sys.exit(subprocess.call(['/usr/bin/python3','/opt/yarden-site-monitor/site-review-monitor.py','--service-config','/etc/yarden-site-monitor.json','--state','/var/lib/yarden-site-monitor/state.json','--release-file','/opt/yarden-site-monitor/site-release.json']))
'''
service='''[Unit]
Description=Read-only Derech review website monitor
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
ExecStart=/usr/bin/python3 /opt/yarden-site-monitor/run.py
SuccessExitStatus=1
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
InaccessiblePaths=/etc/yarden-answer-cms.json
ReadOnlyPaths=/etc/yarden-site-monitor.json
ReadWritePaths=/var/lib/yarden-site-monitor
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
TimeoutStartSec=50
'''
timer='''[Unit]
Description=Check Derech review website every five minutes
[Timer]
OnBootSec=2m
OnUnitActiveSec=5m
RandomizedDelaySec=15s
Unit=yarden-site-review-monitor.service
[Install]
WantedBy=timers.target
'''
remote='''from pathlib import Path
import json,subprocess,os,tempfile
p=subprocess.run(['python3','/opt/yarden-time-policy/time_policy.py'],capture_output=True,text=True)
assert p.returncode==0 and json.loads(p.stdout).get('allowed') is True,'time policy closed'
config=Path('/etc/yarden-answer-cms.json')
assert not config.is_symlink() and config.stat().st_uid==0
value=json.loads(config.read_text())
assert value['version']==1 and value['enabled'] is True and value['origin']==ORIGIN
scoped={k:value[k] for k in ['version','enabled','origin','serviceToken']}
def write(path,text,mode):
 path=Path(path);assert not path.is_symlink()
 fd,tmp=tempfile.mkstemp(prefix='.'+path.name,dir=path.parent)
 with os.fdopen(fd,'w') as f: os.fchmod(f.fileno(),mode);f.write(text);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
for name,mode in [('/opt/yarden-site-monitor',0o755),('/var/lib/yarden-site-monitor',0o700)]:
 path=Path(name);assert not path.is_symlink();path.mkdir(mode=mode,exist_ok=True);assert path.stat().st_uid==0;path.chmod(mode)
write('/etc/yarden-site-monitor.json',json.dumps(scoped),0o600)
for name,text in FILES.items():write('/opt/yarden-site-monitor/'+name,text,0o644)
write('/opt/yarden-site-monitor/run.py',RUNNER,0o644)
write('/etc/systemd/system/yarden-site-review-monitor.service',SERVICE,0o644)
write('/etc/systemd/system/yarden-site-review-monitor.timer',TIMER,0o644)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','start','yarden-site-review-monitor.service'],check=True)
state=json.loads(Path('/var/lib/yarden-site-monitor/state.json').read_text())
last=state['history'][-1]
print(json.dumps({'supervised':last,'deliveryIntegrated':False,'credentialScope':'serviceToken-only','sacredTimeGate':True}))
assert last['ok'] is True,'supervised probe failed; timer not enabled'
subprocess.run(['systemctl','enable','--now','yarden-site-review-monitor.timer'],check=True)
subprocess.run(['systemctl','show','yarden-site-review-monitor.timer','--property=ActiveState,Unit,NextElapseUSecMonotonic'],check=True)
'''.replace('ORIGIN',repr('https://derech-tkuma-demo-20261016.daring-elf-3029.chatgpt.site')).replace('FILES',repr(files)).replace('RUNNER',repr(runner)).replace('SERVICE',repr(service)).replace('TIMER',repr(timer))
base='/Users/yardenrimon/.codex/.chatgpt-projects/g-p-6accbd6db38081919ddd3d977bcb93e1/var/hetzner/'
args=['ssh','-i',base+'yarden-services-ed25519','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+base+'known_hosts','-o','ConnectTimeout=10','root@157.90.121.108','python3','-']
r=subprocess.run(args,input=remote,text=True,capture_output=True,timeout=90)
print(r.stdout,end='')
if r.returncode:print(r.stderr[-1500:]);raise SystemExit(r.returncode)
