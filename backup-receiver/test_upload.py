from datetime import datetime, timezone
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('backup_upload',Path(__file__).with_name('upload.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
NOW=datetime(2026,10,19,21,0,10,tzinfo=timezone.utc).timestamp();CREATED='20261019T210000Z';SECRET='a'*64

class UploadTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.base=Path(self.temp.name).resolve();self.config=self.base/'config.json';self.archive=self.base/'fixture.cms';self.data=b'cipher fixture; real OpenSSL format tested separately';self.sha=hashlib.sha256(self.data).hexdigest()
  self.config.write_text(json.dumps({'version':1,'origin':'https://derech-cms-backup-receiver.example.workers.dev','secret':SECRET}));self.config.chmod(0o600);self.archive.write_bytes(self.data);self.archive.chmod(0o600);self.sent=[]
 def send(self,request):
  self.sent.append(request);headers={k.lower():v for k,v in request.header_items()};message='\n'.join([u.PROTOCOL,'POST','https://derech-cms-backup-receiver.example.workers.dev',u.PATH,headers['x-backup-time'],CREATED,str(len(self.data)),self.sha]);self.assertEqual(headers['x-backup-signature'],hmac.new(bytes.fromhex(SECRET),message.encode(),hashlib.sha256).hexdigest());self.assertEqual(request.data,self.data)
  receipt={'protocol':u.PROTOCOL,'scope':u.SCOPE,'key':u.object_key(CREATED,self.sha),'createdAt':CREATED,'ciphertextBytes':len(self.data),'ciphertextSha256':self.sha,'objectEtag':'etag-1','objectVersion':'version-1','verified':True,'duplicate':False};return self.response(receipt)
 def response(self,receipt):
  raw=json.dumps(receipt,separators=(',',':')).encode();signature=hmac.new(bytes.fromhex(SECRET),u.RECEIPT_PURPOSE.encode()+b'\n'+raw,hashlib.sha256).hexdigest();return 201,{'x-backup-receipt-signature':signature},raw
 def upload(self,**changes):
  options=dict(expected_sha=self.sha,expected_size=len(self.data),send=self.send,clock=lambda:NOW,gate=lambda:True,owner_uid=os.getuid(),check=lambda path:None);options.update(changes)
  return u.upload_cipher(self.config,self.archive,CREATED,**options)
 def report(self):return{'state':'encrypted_verified','offServerCopyVerified':False,'archive':str(self.archive),'createdAt':CREATED,'ciphertextBytes':len(self.data),'ciphertextSha256':self.sha}
 def test_signed_upload_and_signed_receipt_no_admin_credential(self):
  receipt=self.upload();self.assertTrue(receipt['verified']);self.assertEqual(len(self.sent),1);self.assertNotIn(SECRET,json.dumps(receipt));self.assertEqual(self.sent[0].method,'POST')
 def test_calendar_closed_prevents_send_and_parse(self):
  with self.assertRaisesRegex(u.UploadError,'sacred_time_closed'):self.upload(gate=lambda:False)
  self.assertEqual(self.sent,[])
  calls=iter((True,False))
  with self.assertRaisesRegex(u.UploadError,'sacred_time_closed'):self.upload(gate=lambda:next(calls))
  self.assertEqual(self.sent,[])
 def test_config_scope_permissions_symlink_and_plaintext_rejected(self):
  self.config.chmod(0o644)
  with self.assertRaisesRegex(u.UploadError,'private_file'):self.upload()
  self.config.chmod(0o600)
  config=json.loads(self.config.read_text());config['origin']='https://evil.test';self.config.write_text(json.dumps(config))
  with self.assertRaisesRegex(u.UploadError,'origin_rejected'):self.upload()
  config['origin']='https://derech-cms-backup-receiver.example.workers.dev';self.config.write_text(json.dumps(config))
  with self.assertRaisesRegex(u.UploadError,'encrypted_der_required'):self.upload(check=u.openssl_check)
  self.assertEqual(self.sent,[])
 def test_archive_identity_and_time_rejected_before_network(self):
  for changes in ({'expected_sha':'b'*64},{'expected_size':1},{'clock':lambda:NOW-200},{'clock':lambda:NOW+8*86400}):
   with self.assertRaises(u.UploadError):self.upload(**changes)
  self.assertEqual(self.sent,[])
 def test_unsigned_changed_or_wrong_scope_receipt_rejected(self):
  with self.assertRaisesRegex(u.UploadError,'receipt_signature_rejected'):self.upload(send=lambda req:(201,{},b'{}'))
  def wrong(req):
   _,_,raw=self.send(req);receipt=json.loads(raw);receipt['scope']={'tenantId':'other','siteId':'other'};return self.response(receipt)
  with self.assertRaisesRegex(u.UploadError,'receipt_identity_rejected'):self.upload(send=wrong)
 def test_redirect_provider_failure_and_secrets_redacted(self):
  with self.assertRaisesRegex(u.UploadError,'redirect_rejected'):u.NoRedirect().redirect_request(None,None,302,'Moved',{},'https://evil.test')
  def fail(request):raise RuntimeError('PRIVATE_SECRET_SENTINEL')
  with self.assertRaisesRegex(u.UploadError,'^upload_transport_failed$'):self.upload(send=fail)
 def test_failed_or_unverified_copy_preserves_old_latest(self):
  prior={'state':'prior_verified','id':'old'};u.atomic_json(self.base/'latest.json',prior)
  for uploader in (lambda *args,**kwargs:(_ for _ in()).throw(RuntimeError('SECRET')),lambda *args,**kwargs:{'verified':False}):
   with self.assertRaisesRegex(u.UploadError,'^offserver_copy_unverified$'):u.finalize_backup(self.report(),self.base,uploader=uploader)
   self.assertEqual(json.loads((self.base/'latest.json').read_text()),prior)
   attempt=json.loads((self.base/'last-attempt.json').read_text());self.assertFalse(attempt['offServerCopyVerified']);self.assertNotIn('SECRET',json.dumps(attempt));self.assertEqual((self.base/'last-attempt.json').stat().st_mode&0o777,0o600)
 def test_verified_old_retry_does_not_replace_newer_latest(self):
  receipt=self.upload();prior={'state':'offserver_copy_verified','createdAt':'20261020T210000Z','offServerCopyVerified':True};u.atomic_json(self.base/'latest.json',prior)
  result=u.finalize_backup(self.report(),self.base,uploader=lambda *args,**kwargs:receipt)
  self.assertTrue(result['offServerCopyVerified']);self.assertEqual(json.loads((self.base/'latest.json').read_text()),prior)
 def test_verified_copy_updates_latest_only_after_ack(self):
  receipt=self.upload();result=u.finalize_backup(self.report(),self.base,uploader=lambda *args,**kwargs:receipt)
  self.assertEqual(result['state'],'offserver_copy_verified');self.assertTrue(json.loads((self.base/'latest.json').read_text())['offServerCopyVerified'])

if __name__=='__main__':unittest.main()
