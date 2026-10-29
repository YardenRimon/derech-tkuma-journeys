"""Synthetic8..16MiB legacy lookup -> multipart; no provider/local secrets."""
from datetime import datetime,timezone
import hashlib,hmac,importlib.util,json,os,io
from pathlib import Path
import tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('legacy_fallback_upload',Path(__file__).with_name('upload.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
CREATED='20261028T100000Z';NOW=datetime(2026,10,28,10,0,10,tzinfo=timezone.utc).timestamp();SECRET='a'*64
class LegacyFallbackTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name).resolve();self.archive=self.base/'cipher.cms';self.archive.write_bytes(b'C'*(u.V1_WRITE_MAX+128));self.archive.chmod(0o600);self.size=self.archive.stat().st_size;self.sha=u.stream_sha256(self.archive);self.config=self.base/'config.json';self.config.write_text(json.dumps({'version':1,'origin':'https://derech-cms-backup-receiver.example.workers.dev','secret':SECRET}));self.config.chmod(0o600);self.calls=[];self.parts={};self.legacy=False;self.complete=False;self.stop=None
 def signed(self,purpose,value,body=None):
  raw=json.dumps(value,separators=(',',':')).encode();headers={'x-backup-receipt-signature':hmac.new(bytes.fromhex(SECRET),(purpose+'\n').encode()+raw,hashlib.sha256).hexdigest()}
  if body is not None:headers['x-backup-readback-receipt']=raw.decode()
  return 200,headers,raw if body is None else body
 def receipt(self):return{'protocol':u.PROTOCOL,'scope':u.SCOPE,'key':u.object_key(CREATED,self.sha),'createdAt':CREATED,'ciphertextBytes':self.size,'ciphertextSha256':self.sha,'objectEtag':'legacy-etag','objectVersion':'legacy-version','verified':True,'duplicate':True}
 def send(self,r):
  h={k.lower():v for k,v in r.header_items()};action=r.full_url.rsplit('/',1)[1];self.calls.append(action)
  if action=='verify-existing':
   self.assertEqual(r.data,b'{}');self.assertEqual(h['content-type'],'application/json');message='\n'.join([u.VERIFY_PURPOSE,'POST','https://derech-cms-backup-receiver.example.workers.dev',u.VERIFY_PATH,h['x-backup-time'],CREATED,str(self.size),self.sha]);self.assertEqual(h['x-backup-signature'],hmac.new(bytes.fromhex(SECRET),message.encode(),hashlib.sha256).hexdigest())
   return self.signed(u.RECEIPT_PURPOSE,self.receipt()) if self.legacy else (404,{},b'{"ok":false,"code":"existing_v1_not_found"}')
  self.assertNotEqual(r.full_url,'https://derech-cms-backup-receiver.example.workers.dev'+u.PATH,'new large ciphertext must never use v1 PUT');part=int(h['x-backup-part']);data=r.data;session=h['x-backup-session'];self.assertLessEqual(len(data),u.PART_BYTES)
  if action=='create':
   m=json.loads(data);self.assertEqual(m['partBytes'],8388608);self.assertEqual(len(m['parts']),2);self.identity={'protocol':u.MULTIPART_PROTOCOL,'scope':u.SCOPE,'sessionId':session,'manifestSha256':hashlib.sha256(data).hexdigest(),'key':u.object_key(CREATED,self.sha),'createdAt':CREATED,'ciphertextBytes':self.size,'ciphertextSha256':self.sha};value={**self.identity,'uploadedParts':sorted(self.parts),'storedComplete':self.complete}
  elif action=='part':self.parts[part]=data;value={'sessionId':session,'partNumber':part,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'etag':'part-'+str(part)}
  elif action=='complete':self.assertEqual(len(self.parts),2);self.complete=True;value={**self.identity,'objectEtag':'v2-etag','objectVersion':'v2-version','verified':False,'globalReadbackRequired':True}
  elif action=='readback':
   body=self.parts[part];return self.signed('cms-ciphertext-readback-receipt-v2',{'sessionId':session,'partNumber':part,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'objectEtag':'v2-etag','objectVersion':'v2-version'},body)
  else:self.fail('unexpected operation')
  return self.signed('cms-ciphertext-'+action+'-receipt-v2',value)
 def upload(self,**kwargs):
  opts=dict(expected_sha=self.sha,expected_size=self.size,send=self.send,clock=lambda:NOW,gate=lambda:self.stop is None or len(self.calls)<self.stop,owner_uid=os.getuid(),check=lambda p:None);opts.update(kwargs);return u.upload_cipher(self.config,self.archive,CREATED,**opts)
 def test_legacy_lookup_has_no_cipher_body_and_returns_strict_old_receipt(self):
  self.legacy=True;r=self.upload();self.assertEqual(r,self.receipt());self.assertEqual(self.calls,['verify-existing'])
 def test_missing_routes_two_parts_and_full_independent_host_proof(self):
  r=self.upload();self.assertEqual(self.calls,['verify-existing','create','part','part','complete','readback','readback']);self.assertTrue(r['independentReadbackVerified']);self.assertEqual(r['readbackSha256'],self.sha);self.assertEqual(r['readbackBytes'],self.size)
 def test_known_v2_replay_keeps_exact_session_without_part_overwrite(self):
  first=self.upload();self.calls=[];second=self.upload();self.assertNotIn('part',self.calls);self.assertEqual(second['sessionId'],first['sessionId']);self.assertEqual(second['createdAt'],CREATED)
 def test_only_typed_404_falls_back_and_signed_lookup_must_be_duplicate(self):
  for result in [(404,{},b'{"ok":false,"code":"not_found"}'),(409,{},b'{}'),(500,{},b'{}')]:
   seen=[]
   def denied(r):seen.append(r.full_url);return result
   with self.assertRaises(u.UploadError):self.upload(send=denied)
   self.assertEqual(seen,['https://derech-cms-backup-receiver.example.workers.dev'+u.VERIFY_PATH])
  receipt=self.receipt();receipt['duplicate']=False
  with self.assertRaisesRegex(u.UploadError,'receipt_identity_rejected'):self.upload(send=lambda r:self.signed(u.RECEIPT_PURPOSE,receipt))
 def test_policy_held_after_lookup_sends_no_multipart_or_cancel(self):
  self.stop=1
  with self.assertRaisesRegex(u.UploadError,'sacred_time_closed'):self.upload()
  self.assertEqual(self.calls,['verify-existing']);self.assertTrue(self.archive.exists())
 def test_identity_or_local_der_failure_prevents_metadata_lookup(self):
  for opts in ({'expected_sha':'0'*64},{'expected_size':self.size-1},{'check':lambda p:(_ for _ in()).throw(u.UploadError('encrypted_der_required'))}):
   with self.assertRaises(u.UploadError):self.upload(**opts)
  self.assertEqual(self.calls,[])
 def test_default_transport_returns_only_bounded_exact_endpoint_404(self):
  class Opener:
   def __init__(self,code=404,body=b'{"ok":false,"code":"existing_v1_not_found"}'):self.code=code;self.body=body
   def open(self,request,timeout):raise u.urllib.error.HTTPError(request.full_url,self.code,'synthetic HTTP failure',{},io.BytesIO(self.body))
  verify=u.urllib.request.Request('https://derech-cms-backup-receiver.example.workers.dev'+u.VERIFY_PATH,data=b'{}',method='POST')
  with patch.object(u.urllib.request,'build_opener',lambda *a:Opener()):self.assertEqual(u.transport(verify)[0],404)
  normal=u.urllib.request.Request('https://derech-cms-backup-receiver.example.workers.dev'+u.PATH,data=b'cipher',method='POST')
  with patch.object(u.urllib.request,'build_opener',lambda *a:Opener()):
   with self.assertRaisesRegex(u.UploadError,'upload_transport_failed'):u.transport(normal)
  with patch.object(u.urllib.request,'build_opener',lambda *a:Opener(503)):
   with self.assertRaisesRegex(u.UploadError,'upload_transport_failed'):u.transport(verify)
  with patch.object(u.urllib.request,'build_opener',lambda *a:Opener(body=b'x'*16385)):
   with self.assertRaisesRegex(u.UploadError,'receipt_rejected'):u.transport(verify)
 def test_any_v2_receipt_requires_global_proof_at_finalize_and_operator(self):
  receipt={**self.receipt(),'protocol':u.MULTIPART_PROTOCOL};report={'state':'encrypted_verified','offServerCopyVerified':False,'archive':str(self.archive),'createdAt':CREATED,'ciphertextBytes':self.size,'ciphertextSha256':self.sha}
  with self.assertRaises(u.UploadError):u.finalize_backup(report,self.base,uploader=lambda *a,**k:receipt)
  self.assertFalse((self.base/'latest.json').exists())
  with patch.object(u,'streaming_der_check',lambda p:None):
   with self.assertRaises(u.UploadError):u.operator_recovery_copy(self.archive,CREATED,expected_sha=self.sha,expected_size=self.size,base=self.base,uploader=lambda *a,**k:receipt,gate=lambda:True,owner_uid=os.getuid())
  self.assertFalse((self.base/'latest.json').exists())
if __name__=='__main__':unittest.main()
