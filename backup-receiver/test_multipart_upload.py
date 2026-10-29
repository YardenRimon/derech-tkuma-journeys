"""Streaming host verification, resumable bounded transport; synthetic only."""
from datetime import datetime,timezone
import hashlib,hmac,importlib.util,json,os
from pathlib import Path
import tempfile,unittest
spec=importlib.util.spec_from_file_location('multipart_upload',Path(__file__).with_name('upload.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
CREATED='20261028T100000Z';NOW=datetime(2026,10,28,10,0,10,tzinfo=timezone.utc).timestamp();SECRET='a'*64
class MultipartTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name).resolve();self.archive=self.base/'cipher.cms';self.config=self.base/'config.json'
  # Synthetic opaque bytes; real OpenSSL DER validation is covered by workerd.
  with self.archive.open('wb') as f:
   for n in range(3):f.write(bytes([n+1])*(u.PART_BYTES if n<2 else 1024))
  self.archive.chmod(0o600);self.config.write_text(json.dumps({'version':1,'origin':'https://derech-cms-backup-receiver.example.workers.dev','secret':SECRET}));self.config.chmod(0o600)
  self.sha=u.stream_sha256(self.archive);self.manifest=None;self.stored={};self.calls=[];self.complete=False;self.tamper=False;self.hold_after=None;self.fetch_count=0
 def gate(self):return self.hold_after is None or len(self.calls)<self.hold_after
 def reply(self,action,value,raw=None):
  signed=json.dumps(value,separators=(',',':')).encode();signature=hmac.new(bytes.fromhex(SECRET),('cms-ciphertext-'+action+'-receipt-v2\n').encode()+signed,hashlib.sha256).hexdigest();headers={'x-backup-receipt-signature':signature}
  if raw is not None:headers['x-backup-readback-receipt']=signed.decode()
  return 200,headers,signed if raw is None else raw
 def send(self,r):
  h={k.lower():v for k,v in r.header_items()};action=r.full_url.rsplit('/',1)[1];part=int(h['x-backup-part']);session=h['x-backup-session'];self.calls.append((action,part));data=r.data
  self.assertLessEqual(len(data),u.PART_BYTES);self.assertEqual(hashlib.sha256(data).hexdigest(),h['x-backup-sha256'])
  message='\n'.join(['cms-ciphertext-'+action+'-v2','POST','https://derech-cms-backup-receiver.example.workers.dev',u.MULTIPART_PATH+'/'+action,h['x-backup-time'],session,str(part),str(len(data)),h['x-backup-sha256']]);self.assertEqual(h['x-backup-signature'],hmac.new(bytes.fromhex(SECRET),message.encode(),hashlib.sha256).hexdigest())
  if action=='create':
   self.manifest=json.loads(data);self.identity={'protocol':u.MULTIPART_PROTOCOL,'scope':u.SCOPE,'sessionId':session,'manifestSha256':hashlib.sha256(data).hexdigest(),'key':u.object_key(CREATED,self.sha),'createdAt':CREATED,'ciphertextBytes':self.archive.stat().st_size,'ciphertextSha256':self.sha};return self.reply(action,{**self.identity,'uploadedParts':sorted(self.stored),'storedComplete':self.complete})
  if action=='part':
   self.stored[part]=data;return self.reply(action,{'sessionId':session,'partNumber':part,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'etag':'part-'+str(part)})
  if action=='complete':
   self.assertEqual(len(self.stored),3);self.complete=True;return self.reply(action,{**self.identity,'objectEtag':'whole-etag','objectVersion':'whole-version','verified':False,'globalReadbackRequired':True})
  if action=='readback':
   self.fetch_count+=1;chunk=self.stored[part];receipt={'sessionId':session,'partNumber':part,'bytes':len(chunk),'sha256':hashlib.sha256(chunk).hexdigest(),'objectEtag':'whole-etag','objectVersion':'whole-version'}
   if self.tamper:chunk=bytes([chunk[0]^1])+chunk[1:]
   return self.reply(action,receipt,chunk)
  self.fail('unexpected operation')
 def upload(self,**kwargs):
  options=dict(expected_sha=self.sha,expected_size=self.archive.stat().st_size,send=self.send,clock=lambda:NOW,gate=self.gate,owner_uid=os.getuid(),check=lambda p:None);options.update(kwargs);return u.upload_cipher(self.config,self.archive,CREATED,**options)
 def test_full_streamed_ciphertext_and_host_only_verified_receipt(self):
  receipt=self.upload();self.assertTrue(receipt['verified']);self.assertTrue(receipt['independentReadbackVerified']);self.assertEqual(receipt['readbackSha256'],self.sha);self.assertEqual(receipt['readbackBytes'],self.archive.stat().st_size);self.assertEqual(self.fetch_count,3);self.assertFalse(self.archive.with_suffix('.readback.partial').exists())
 def test_hold_preserves_parts_then_resumes_same_session_without_resend(self):
  self.hold_after=2
  with self.assertRaisesRegex(u.UploadError,'sacred_time_closed'):self.upload()
  self.assertEqual(self.calls,[('create',0),('part',1)]);self.hold_after=None;self.calls=[];self.upload();self.assertNotIn(('part',1),self.calls);self.assertEqual(self.manifest['createdAt'],CREATED)
 def test_hold_mid_readback_resumes_remaining_independent_bytes(self):
  self.hold_after=6
  with self.assertRaisesRegex(u.UploadError,'sacred_time_closed'):self.upload()
  cache=self.archive.with_suffix('.readback.partial');self.assertEqual(cache.stat().st_size,u.PART_BYTES);self.assertEqual(cache.stat().st_mode&0o777,0o600)
  self.hold_after=None;self.calls=[];receipt=self.upload();self.assertTrue(receipt['independentReadbackVerified']);self.assertEqual([x for x in self.calls if x[0]=='readback'],[('readback',2),('readback',3)]);self.assertFalse(any(a=='part' for a,n in self.calls))
 def test_tamper_readback_never_verifies_and_retains_archive(self):
  self.tamper=True
  with self.assertRaisesRegex(u.UploadError,'stored_copy_unverified'):self.upload()
  self.assertTrue(self.archive.exists())
 def test_signed_receipt_tamper_or_cross_scope_rejected(self):
  original=self.send
  def wrong(r):
   status,h,b=original(r)
   if r.full_url.endswith('/create'):
    value=json.loads(b);value['scope']={'tenantId':'other','siteId':'other'};return self.reply('create',value)
   return status,h,b
  with self.assertRaisesRegex(u.UploadError,'receipt_identity_rejected'):self.upload(send=wrong)
 def test_corrupt_independent_cache_rejected_before_remaining_readback(self):
  self.hold_after=6
  with self.assertRaises(u.UploadError):self.upload()
  cache=self.archive.with_suffix('.readback.partial')
  with cache.open('r+b') as f:f.write(b'X')
  self.hold_after=None;self.calls=[]
  with self.assertRaisesRegex(u.UploadError,'readback_cache_rejected'):self.upload()
  self.assertFalse(any(a=='readback' for a,n in self.calls))
 def test_wrong_hash_source_size_and_expired_capture_no_requests(self):
  for changes in ({'expected_sha':'b'*64},{'expected_size':u.TOTAL_BYTES+1},{'clock':lambda:NOW+8*86400}):
   with self.assertRaises(u.UploadError):self.upload(**changes)
  self.assertEqual(self.calls,[])
 def test_held_finalize_preserves_original_stamp_and_latest(self):
  report={'state':'encrypted_verified','offServerCopyVerified':False,'archive':str(self.archive),'createdAt':CREATED,'ciphertextBytes':self.archive.stat().st_size,'ciphertextSha256':self.sha};prior={'createdAt':'20261029T100000Z','verified':True};u.atomic_json(self.base/'latest.json',prior)
  with self.assertRaises(u.UploadError):u.finalize_backup(report,self.base,uploader=lambda *a,**k:(_ for _ in()).throw(u.UploadError('sacred_time_closed')))
  attempt=json.loads((self.base/'last-attempt.json').read_text());self.assertEqual(attempt['state'],'encrypted_upload_held');self.assertEqual(attempt['createdAt'],CREATED);self.assertFalse(attempt['offServerCopyVerified']);self.assertEqual(json.loads((self.base/'latest.json').read_text()),prior)
 def test_resume_pending_retains_original_capture_age_and_one_marker(self):
  report={'state':'encrypted_upload_held','offServerCopyVerified':False,'archive':str(self.archive),'createdAt':CREATED,'ciphertextBytes':self.archive.stat().st_size,'ciphertextSha256':self.sha};u.atomic_json(self.base/'last-attempt.json',report)
  receipt={'protocol':u.MULTIPART_PROTOCOL,'verified':True,'scope':u.SCOPE,'ciphertextSha256':self.sha,'ciphertextBytes':self.archive.stat().st_size,'key':u.object_key(CREATED,self.sha),'independentReadbackVerified':True,'readbackBytes':self.archive.stat().st_size,'readbackSha256':self.sha}
  result=u.resume_pending(self.base,clock=lambda:NOW+86400,gate=lambda:True,uploader=lambda *a,**k:receipt)
  self.assertEqual(result['createdAt'],CREATED);self.assertEqual(json.loads((self.base/'latest.json').read_text())['createdAt'],CREATED)
  u.atomic_json(self.base/'last-attempt.json',report);self.assertIsNone(u.resume_pending(self.base,clock=lambda:NOW+8*86400,gate=lambda:True,uploader=lambda *a,**k:self.fail('expired marker must not upload')))
 def test_large_finalize_rejects_manifest_only_verification(self):
  report={'state':'encrypted_verified','offServerCopyVerified':False,'archive':str(self.archive),'createdAt':CREATED,'ciphertextBytes':self.archive.stat().st_size,'ciphertextSha256':self.sha}
  receipt={'protocol':u.MULTIPART_PROTOCOL,'verified':True,'scope':u.SCOPE,'ciphertextSha256':self.sha,'ciphertextBytes':self.archive.stat().st_size,'key':u.object_key(CREATED,self.sha)}
  with self.assertRaises(u.UploadError):u.finalize_backup(report,self.base,uploader=lambda *a,**k:receipt)
  self.assertFalse((self.base/'latest.json').exists())
if __name__=='__main__':unittest.main()
