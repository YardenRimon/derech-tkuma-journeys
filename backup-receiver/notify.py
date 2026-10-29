"""Owner-only backup run notices via the existing sole outbox. No sender/API."""
from datetime import datetime, timezone
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from urllib.parse import quote

UNIT='yarden-cms-backup.service'
ATTEMPT=Path('/var/lib/yarden-cms-backup/last-attempt.json')
HELPER=Path('/opt/yarden-site-monitor/site-review-alerts.py')
OPS=Path('/opt/yarden-site-monitor/ops')
KNOWN={'capture_started','backup_capture_failed','isolated_restore_failed','encryption_failed','encrypted_local_upload_failed','offserver_copy_verified'}
FAILURE='⚠️ דרך התקומה — הגיבוי לא הושלם\n\nריצת הגיבוי הסתיימה בכשל. נדרש ממך לבדוק את יומן הריצה ואת אימות העותק המוצפן מחוץ לשרת.'
RECOVERY='✅ דרך התקומה — הגיבוי חזר לפעול\n\nריצת גיבוי חדשה הסתיימה בהצלחה ואומתה שמירת העותק המוצפן מחוץ לשרת.'

class NoticeError(ValueError):pass

def require(value,code):
 if not value:raise NoticeError(code)

def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def validate(event,now):
 require(isinstance(event,dict)and set(event)=={'kind','invocationId','createdAt','sourceAt','startAt','exitAt','result','exitStatus','state','offServerVerified'},'evidence_shape')
 require(event['kind'] in ('failure','success')and re.fullmatch(r'[a-f0-9]{32}',event['invocationId'] or ''),'invocation_rejected')
 require(type(event['exitStatus'])is int and event['state']in KNOWN and type(event['offServerVerified'])is bool,'service_result_rejected')
 for key in ('sourceAt','startAt','exitAt'):require(type(event[key])in(int,float),'clock_rejected')
 require(0<=now.timestamp()-event['sourceAt']<=90 and 0<=now.timestamp()-event['exitAt']<=1800 and event['startAt']<=event['exitAt']<=event['sourceAt'] and event['exitAt']-event['startAt']<=1200,'clock_rejected')
 try:created=datetime.strptime(event['createdAt'],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
 except Exception:raise NoticeError('capture_time_rejected')from None
 require(-5<=created-event['startAt']<=60 and created<=event['exitAt']+5,'capture_time_rejected')
 if event['kind']=='failure':require(event['result']in('exit-code','timeout','signal','core-dump','resources','watchdog','oom-kill','start-limit-hit')and(event['exitStatus']!=0 or event['result']!='exit-code'),'service_result_rejected')
 else:require(event['result']=='success'and event['exitStatus']==0 and event['state']=='offserver_copy_verified'and event['offServerVerified']is True,'success_unverified')
 return hashlib.sha256(('cms-backup-notice-v1\n'+event['invocationId']+'\n'+event['createdAt']).encode()).hexdigest()[:24]

def process(event,db_path,config_path,*,helper,weekly,owner_dm,now=None,gate=None,tenant=None):
 now=now or datetime.now(timezone.utc);gate=gate or helper.sacred_allowed
 require(gate(now)is True,'sacred_time_closed');ident=validate(event,now)
 tenant=tenant or weekly.TENANTS['derech'];require((tenant.slug,tenant.owner_id,tenant.chat_id,tenant.bot_id)==('derech',885011787,-5379385865,8905221076),'tenant_rejected')
 path=Path(db_path);original=weekly.protected_file(path,tenant.uid,tenant.gid,weekly.MAX_DB);config,_=weekly.read_json(Path(config_path),tenant.uid,tenant.gid)
 for suffix in('-wal','-shm','-journal'):
  side=Path(str(path)+suffix)
  if side.exists()or side.is_symlink():weekly.protected_file(side,tenant.uid,tenant.gid,weekly.MAX_DB)
 output={'state':'processed','kind':event['kind'],'notices':[],'deliveryVerified':False}
 with sqlite3.connect('file:'+quote(str(path),safe='/')+'?mode=rw',uri=True,timeout=10)as db:
  db.row_factory=sqlite3.Row;db.execute('BEGIN IMMEDIATE');require(path.lstat().st_ino==original.st_ino,'database_changed');weekly._identity(db,tenant,config)
  require(gate(now)is True,'sacred_time_closed')
  db.execute('''CREATE TABLE IF NOT EXISTS cms_backup_notices(incident_id TEXT PRIMARY KEY,invocation_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,failure_key TEXT NOT NULL UNIQUE,failure_sha256 TEXT NOT NULL,recovery_key TEXT,recovery_sha256 TEXT,resolved_at TEXT,updated_at TEXT NOT NULL)''')
  if event['kind']=='failure':
   key='cms-backup-failure:derech:'+ident;text_hash=helper.digest(FAILURE.encode());previous=db.execute('SELECT * FROM cms_backup_notices WHERE incident_id=?',(ident,)).fetchone()
   if previous:
    require(previous['failure_key']==key and previous['failure_sha256']==text_hash and previous['invocation_id']==event['invocationId'],'ledger_conflict');row=helper.outbox(db,key,text_hash);output['notices'].append({'state':'duplicate','key':key,'outboxState':row['state'],'messageId':row['telegram_message_id']})
   elif not owner_dm(db,tenant):output['state']='pending_owner_start'
   else:
    helper.enqueue(db,key,FAILURE,now,gate);db.execute('INSERT INTO cms_backup_notices VALUES(?,?,?,?,?,?,?,?,?)',(ident,event['invocationId'],event['createdAt'],key,text_hash,None,None,None,now.isoformat()));output['notices'].append({'state':'queued','key':key,'outboxState':'queued','messageId':None})
  else:
   for previous in db.execute('SELECT * FROM cms_backup_notices WHERE resolved_at IS NULL').fetchall():
    row=helper.outbox(db,previous['failure_key'],previous['failure_sha256'])
    # An older success cannot resolve a later failed run, including replay.
    require(previous['created_at']<event['createdAt'],'recovery_order_rejected')
    if row['state']=='queued':
     require(gate(now)is True,'sacred_time_closed');db.execute("UPDATE outbox SET state='failed',error='backup_recovered_before_delivery',updated_at=? WHERE idempotency_key=? AND state='queued'",(now.isoformat(),previous['failure_key']));status='resolved_before_delivery'
    elif row['state']in('sending','unknown')or row['state']=='sent'and(type(row['telegram_message_id'])is not int or row['telegram_message_id']<=0):output['notices'].append({'state':'recovery_deferred','key':previous['failure_key']});continue
    elif row['state']=='failed':status='resolved_without_notification'
    elif not owner_dm(db,tenant):output['notices'].append({'state':'pending_owner_start','key':previous['failure_key']});continue
    else:
     key='cms-backup-recovery:derech:'+previous['incident_id'];text_hash=helper.digest(RECOVERY.encode())
     if previous['recovery_key']:
      require(previous['recovery_key']==key and previous['recovery_sha256']==text_hash,'ledger_conflict');recovery=helper.outbox(db,key,text_hash);output['notices'].append({'state':'duplicate','key':key,'outboxState':recovery['state'],'messageId':recovery['telegram_message_id']})
     else:
      helper.enqueue(db,key,RECOVERY,now,gate);db.execute('UPDATE cms_backup_notices SET recovery_key=?,recovery_sha256=? WHERE incident_id=?',(key,text_hash,previous['incident_id']));output['notices'].append({'state':'queued','key':key,'outboxState':'queued','messageId':None})
     status='resolved'
    db.execute('UPDATE cms_backup_notices SET resolved_at=?,updated_at=? WHERE incident_id=?',(now.isoformat(),now.isoformat(),previous['incident_id']))
    if status!='resolved':output['notices'].append({'state':status,'key':previous['failure_key']})
 return output


def readback(db_path,config_path,*,helper,weekly,tenant=None):
 tenant=tenant or weekly.TENANTS['derech'];require((tenant.slug,tenant.owner_id,tenant.chat_id,tenant.bot_id)==('derech',885011787,-5379385865,8905221076),'tenant_rejected')
 path=Path(db_path);weekly.protected_file(path,tenant.uid,tenant.gid,weekly.MAX_DB);config,_=weekly.read_json(Path(config_path),tenant.uid,tenant.gid)
 with sqlite3.connect('file:'+quote(str(path),safe='/')+'?mode=ro',uri=True,timeout=10)as db:
  db.row_factory=sqlite3.Row;weekly._identity(db,tenant,config);result=[]
  if db.execute("SELECT 1 FROM sqlite_master WHERE type='table'AND name='cms_backup_notices'").fetchone():
   for entry in db.execute('SELECT * FROM cms_backup_notices ORDER BY updated_at DESC LIMIT 10'):
    for kind in('failure','recovery'):
     if not entry[kind+'_key']:continue
     row=helper.outbox(db,entry[kind+'_key'],entry[kind+'_sha256']);result.append({'kind':kind,'key':row['idempotency_key'],'outboxState':row['state'],'messageId':row['telegram_message_id'],'deliveryVerified':row['state']=='sent'and type(row['telegram_message_id'])is int and row['telegram_message_id']>0})
 return{'state':'readback','notices':result}


def properties():
 result=subprocess.run(['systemctl','show',UNIT,'--property=Result,ExecMainStatus,InvocationID,ExecMainStartTimestamp,ExecMainExitTimestamp'],capture_output=True,text=True,timeout=10,env={**os.environ,'LC_ALL':'C','TZ':'UTC'});require(result.returncode==0,'service_read_failed')
 return dict(line.split('=',1)for line in result.stdout.splitlines()if'='in line)

def timestamp(value):
 try:return datetime.strptime(value,'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=timezone.utc).timestamp()
 except Exception:raise NoticeError('service_clock_unavailable')from None


def verified_copy(raw):
 receipt=raw.get('offServerReceipt',{});sha=raw.get('ciphertextSha256');size=raw.get('ciphertextBytes');created=raw.get('createdAt','')
 if not isinstance(receipt,dict)or not isinstance(sha,str)or not re.fullmatch(r'[a-f0-9]{64}',sha)or type(size)is not int or size<=0 or not isinstance(created,str):return False
 key=f'derech/derech-main/{created[:4]}/{created[4:6]}/{created[6:8]}/{created}-{sha}.cms'
 return raw.get('complete')is True and raw.get('offServerCopyVerified')is True and receipt.get('protocol')=='cms-ciphertext-upload-v1'and receipt.get('verified')is True and receipt.get('scope')=={'tenantId':'derech','siteId':'derech-main'}and receipt.get('ciphertextSha256')==sha and receipt.get('ciphertextBytes')==size and receipt.get('createdAt')==created and receipt.get('key')==key


def collect(kind,*,helper):
 first=properties();now=datetime.now(timezone.utc)
 # Root-owned non-secret report only; no export/upload/provider key files read.
 require(not ATTEMPT.is_symlink()and ATTEMPT.is_file(),'attempt_unavailable')
 info=ATTEMPT.stat();require(info.st_uid==0 and info.st_mode&0o777==0o600 and info.st_size<1024*1024,'attempt_untrusted')
 raw=json.loads(ATTEMPT.read_bytes());second=properties();require(first==second,'service_changed')
 start,exit_at=timestamp(first['ExecMainStartTimestamp']),timestamp(first['ExecMainExitTimestamp'])
 invocation=first.get('InvocationID')
 if not invocation:
  # Inactive oneshot units can clear InvocationID. Read journal metadata only,
  # never MESSAGE or client text, scoped to this unit and exact run interval.
  r=subprocess.run(['journalctl','--unit',UNIT,'--since','@'+str(int(start)),'--until','@'+str(int(exit_at)+1),'--output=json','--output-fields=_SYSTEMD_INVOCATION_ID','--no-pager'],capture_output=True,text=True,timeout=10)
  require(r.returncode==0 and len(r.stdout)<=65536,'invocation_unavailable');ids={json.loads(line).get('_SYSTEMD_INVOCATION_ID')for line in r.stdout.splitlines()if line.startswith('{')};ids.discard(None);require(len(ids)==1,'invocation_unavailable');invocation=ids.pop()
 require(raw.get('invocationId')==invocation,'attempt_invocation_mismatch')
 verified=verified_copy(raw)
 event={'kind':kind,'invocationId':invocation,'createdAt':raw.get('createdAt'),'sourceAt':now.timestamp(),'startAt':start,'exitAt':exit_at,'result':first['Result'],'exitStatus':int(first['ExecMainStatus']),'state':raw.get('state'),'offServerVerified':bool(verified)}
 validate(event,now);return event

def dispatch(event,helper,readonly=False):
 directory='/tmp/derech-cms-backup-notify'
 def stage(name,raw):
  code="import os,sys,stat;from pathlib import Path;p=Path("+repr(directory)+");p.mkdir(mode=0o700,exist_ok=True);s=p.lstat();assert stat.S_ISDIR(s.st_mode)and s.st_uid==os.geteuid()and stat.S_IMODE(s.st_mode)==0o700;f=p/"+repr(name)+";t=p/('.'+f.name+'.'+str(os.getpid()));d=os.open(t,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);o=os.fdopen(d,'wb');o.write(sys.stdin.buffer.read());o.close();os.replace(t,f)"
  helper.invoke_container(code,raw)
 for name in('organic_import.py','tenant_holds.py','weekly_telegram.py','client_notifications.py'):stage(name,(OPS/name).read_bytes())
 stage('site_review_alerts.py',HELPER.read_bytes());stage('backup_notify.py',Path(__file__).read_bytes())
 code="import sys,json;sys.path.insert(0,"+repr(directory)+");import site_review_alerts as a;import backup_notify as n;w,o=a.dependencies("+repr(directory)+");"
 if readonly:code+="print(json.dumps(n.readback('/data/bridge.sqlite3','/data/runtime.json',helper=a,weekly=w)))"
 else:code+="print(json.dumps(n.process(json.loads(sys.stdin.read()),'/data/bridge.sqlite3','/data/runtime.json',helper=a,weekly=w,owner_dm=o)))"
 return json.loads(helper.invoke_container(code,b''if readonly else json.dumps(event).encode()))

def main(argv=None):
 parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group(required=True);group.add_argument('--failure',dest='event',action='store_const',const='failure');group.add_argument('--success',dest='event',action='store_const',const='success');group.add_argument('--event',choices=('failure','success'));group.add_argument('--readback',dest='event',action='store_const',const='readback');args=parser.parse_args(argv)
 try:
  require(os.geteuid()==0,'deployment_owner_required');helper=load(HELPER,'site_review_alerts')
  if args.event=='readback':result=dispatch(None,helper,readonly=True)
  else:
   require(helper.sacred_allowed(datetime.now(timezone.utc))is True,'sacred_time_closed');event=collect(args.event,helper=helper);result=dispatch(event,helper)
  print(json.dumps(result));return 0
 except Exception as error:
  codes={'sacred_time_closed','deployment_owner_required','attempt_unavailable','attempt_untrusted','attempt_invocation_mismatch','invocation_unavailable','service_changed','evidence_shape','service_result_rejected','success_unverified','clock_rejected','capture_time_rejected'};code=str(error)if isinstance(error,NoticeError)and str(error)in codes else'backup_notice_blocked';print(json.dumps({'state':'deferred'if code=='sacred_time_closed'else'blocked','code':code,'deliveryVerified':False}));return 0 if code=='sacred_time_closed'else 2

if __name__=='__main__':raise SystemExit(main())
