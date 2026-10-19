from datetime import datetime,timezone,timedelta
from dataclasses import replace
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from site_review_alerts_test_fixture import FixtureWeekly as weekly,fixture_owner_dm as owner_dm

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
n=load('backup_notify',Path(__file__).with_name('notify.py'));a=load('site_review_alerts',ROOT/'scripts/site-review-alerts.py')
NOW=datetime(2026,10,20,12,0,tzinfo=timezone.utc)

def event(kind='failure',now=NOW,invocation='a'*32):
 return{'kind':kind,'invocationId':invocation,'createdAt':(now-timedelta(seconds=60)).strftime('%Y%m%dT%H%M%SZ'),'sourceAt':now.timestamp(),'startAt':now.timestamp()-61,'exitAt':now.timestamp()-5,'result':'exit-code'if kind=='failure'else'success','exitStatus':2 if kind=='failure'else 0,'state':'encrypted_local_upload_failed'if kind=='failure'else'offserver_copy_verified','offServerVerified':kind=='success'}

class NoticeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name).resolve();self.db=self.root/'bridge.sqlite3';self.config=self.root/'runtime.json';self.tenant=replace(weekly.TENANTS['derech'],uid=os.getuid(),gid=os.getgid())
  self.config.write_text(json.dumps({'owner_id':a.OWNER,'chat_id':a.CHAT,'bot_id':a.BOT,'owner_status':'creator','bot_status':'member','operator_ids':[8940420713],'viewer_ids':[]}));self.config.chmod(0o600)
  with sqlite3.connect(self.db)as db:
   db.executescript("CREATE TABLE outbox(id INTEGER PRIMARY KEY,idempotency_key TEXT UNIQUE,chat_id INTEGER,text TEXT,kind TEXT,state TEXT,telegram_message_id INTEGER,created_at TEXT,updated_at TEXT,error TEXT,entities_json TEXT DEFAULT '[]',reply_markup TEXT);CREATE TABLE scoped_owner_dm(owner_id INTEGER PRIMARY KEY,tenant_slug TEXT,bot_id INTEGER,chat_id INTEGER,update_id INTEGER,message_id INTEGER);")
   db.execute('INSERT INTO scoped_owner_dm VALUES(?,?,?,?,?,?)',(a.OWNER,'derech',a.BOT,a.OWNER,10,9))
  self.db.chmod(0o600)
 def process(self,value=None,now=NOW,gate=lambda now:True):return n.process(value or event(),self.db,self.config,helper=a,weekly=weekly,owner_dm=owner_dm,now=now,gate=gate,tenant=self.tenant)
 def rows(self):
  with sqlite3.connect(self.db)as db:db.row_factory=sqlite3.Row;return[dict(x)for x in db.execute('SELECT * FROM outbox ORDER BY id')]
 def delivery(self,state,message=None):
  with sqlite3.connect(self.db)as db:db.execute('UPDATE outbox SET state=?,telegram_message_id=?',(state,message))
 def success(self):
  now=NOW+timedelta(minutes=10);return self.process(event('success',now,'b'*32),now)
 def test_one_actual_failed_run_one_owner_notice_and_replay(self):
  self.assertEqual(self.process()['notices'][0]['state'],'queued');self.assertEqual(self.process()['notices'][0]['state'],'duplicate');rows=self.rows();self.assertEqual(len(rows),1);self.assertEqual(rows[0]['chat_id'],a.OWNER);self.assertNotIn('SECRET',rows[0]['text']);self.assertNotEqual(rows[0]['chat_id'],8940420713)
 def test_success_without_failed_history_is_quiet(self):self.assertEqual(self.success()['notices'],[]);self.assertEqual(self.rows(),[])
 def test_queued_opening_cancelled_without_recovery(self):
  self.process();self.assertEqual(self.success()['notices'][0]['state'],'resolved_before_delivery');self.assertEqual(len(self.rows()),1);self.assertEqual(self.rows()[0]['state'],'failed')
 def test_sent_opening_positive_id_one_recovery(self):
  self.process();self.delivery('sent',100);self.assertEqual(self.success()['notices'][0]['state'],'queued');self.assertEqual(self.success()['notices'],[]);self.assertEqual(len(self.rows()),2);self.assertEqual(self.rows()[1]['chat_id'],a.OWNER)
 def test_unknown_sending_missing_message_id_defer(self):
  self.process()
  for state,message in [('unknown',None),('sending',None),('sent',None),('sent',0)]:
   self.delivery(state,message);self.assertEqual(self.success()['notices'][0]['state'],'recovery_deferred');self.assertEqual(len(self.rows()),1)
 def test_failed_delivery_never_retries(self):
  self.process();self.delivery('failed');self.assertEqual(self.success()['notices'][0]['state'],'resolved_without_notification');self.assertEqual(len(self.rows()),1)
 def test_stale_future_wrong_service_result_and_unverified_success_rejected(self):
  cases=[]
  for key,value in [('sourceAt',NOW.timestamp()+1),('exitAt',NOW.timestamp()-3600),('invocationId','bad'),('result','success'),('exitStatus',0),('createdAt','20261019T115900Z')]:x=event();x[key]=value;cases.append(x)
  x=event('success');x['offServerVerified']=False;cases.append(x)
  for x in cases:
   with self.assertRaises(n.NoticeError):self.process(x)
  self.assertEqual(self.rows(),[])
 def test_sacred_time_closed_before_any_table_write(self):
  with self.assertRaisesRegex(n.NoticeError,'sacred_time_closed'):self.process(gate=lambda now:False)
  with sqlite3.connect(self.db)as db:self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='cms_backup_notices'").fetchone())
 def test_owner_unverified_no_group_fallback(self):
  with sqlite3.connect(self.db)as db:db.execute('DELETE FROM scoped_owner_dm')
  self.assertEqual(self.process()['state'],'pending_owner_start');self.assertEqual(self.rows(),[])
 def test_conflicting_receipt_destination_rejected(self):
  self.process()
  with sqlite3.connect(self.db)as db:db.execute('UPDATE outbox SET chat_id=?',(a.CHAT,))
  with self.assertRaisesRegex(a.AlertError,'outbox_receipt_conflict'):self.process()
 def test_old_success_cannot_resolve_later_failure(self):
  self.process();self.delivery('sent',100)
  with self.assertRaisesRegex(n.NoticeError,'recovery_order_rejected'):self.process(event('success',NOW,'b'*32))
 def test_readback_reports_actual_outbox_state_not_queued_as_delivered(self):
  self.process();self.delivery('sent',100);self.success();result=n.readback(self.db,self.config,helper=a,weekly=weekly,tenant=self.tenant)
  self.assertEqual([r['deliveryVerified']for r in result['notices']],[True,False]);self.assertEqual(result['notices'][0]['messageId'],100)
 def test_copy_requires_full_pinned_receipt_not_missing_equals_missing(self):
  self.assertFalse(n.verified_copy({'offServerCopyVerified':True,'offServerReceipt':{'verified':True,'scope':{'tenantId':'derech','siteId':'derech-main'}}}))
  sha='a'*64;created='20261020T115900Z';raw={'complete':True,'createdAt':created,'ciphertextSha256':sha,'ciphertextBytes':123,'offServerCopyVerified':True,'offServerReceipt':{'protocol':'cms-ciphertext-upload-v1','verified':True,'scope':{'tenantId':'derech','siteId':'derech-main'},'createdAt':created,'ciphertextSha256':sha,'ciphertextBytes':123,'key':f'derech/derech-main/2026/10/20/{created}-{sha}.cms'}}
  self.assertTrue(n.verified_copy(raw));raw['offServerReceipt']['scope']['tenantId']='other';self.assertFalse(n.verified_copy(raw))

if __name__=='__main__':unittest.main()
