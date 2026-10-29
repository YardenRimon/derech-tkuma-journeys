"""Manual recovery artifact shares transport, never native freshness markers."""
import hashlib,importlib.util,json,os,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('operator_upload',Path(__file__).with_name('upload.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
CREATED='20261028T100000Z'
class OperatorRecoveryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.base=Path(self.temp.name).resolve();self.archive=self.base/('derech-recovery-wordpress-'+CREATED+'.cms');self.archive.write_bytes(b'outer encrypted fixture');self.archive.chmod(0o600);self.sha=hashlib.sha256(self.archive.read_bytes()).hexdigest();self.size=self.archive.stat().st_size
  for name in ('latest.json','last-attempt.json'):u.atomic_json(self.base/name,{'nativeCMS':name,'createdAt':'20261029T100000Z'})
  self.prior={name:(self.base/name).read_bytes() for name in ('latest.json','last-attempt.json')}
 def copy(self,**kwargs):
  receipt={'verified':True,'scope':u.SCOPE,'key':u.object_key(CREATED,self.sha),'ciphertextSha256':self.sha,'ciphertextBytes':self.size};options=dict(expected_sha=self.sha,expected_size=self.size,base=self.base,uploader=lambda *a,**k:receipt,gate=lambda:True,owner_uid=os.getuid());options.update(kwargs);return u.operator_recovery_copy(self.archive,CREATED,**options)
 def assert_native_unchanged(self):
  for name,raw in self.prior.items():self.assertEqual((self.base/name).read_bytes(),raw)
 def test_operator_success_never_advances_native_latest_or_pending_marker(self):
  result=self.copy();self.assertTrue(result['offServerCopyVerified']);self.assertEqual(result['artifactKind'],'operator_recovery_artifact');self.assertEqual(result['createdAt'],CREATED);self.assertEqual(json.loads(self.archive.with_suffix('.recovery-copy.json').read_text())['createdAt'],CREATED);self.assert_native_unchanged()
 def test_operator_hold_preserves_original_capture_and_native_markers(self):
  def held(*args,**kwargs):raise u.UploadError('sacred_time_closed')
  with self.assertRaisesRegex(u.UploadError,'sacred_time_closed'):self.copy(uploader=held)
  report=json.loads(self.archive.with_suffix('.recovery-copy.json').read_text());self.assertEqual(report['state'],'encrypted_upload_held');self.assertEqual(report['createdAt'],CREATED);self.assertFalse(report['offServerCopyVerified']);self.assert_native_unchanged()
 def test_operator_cannot_use_native_archive_name_or_another_directory(self):
  original=self.archive;self.archive=self.base/('derech-cms-'+CREATED+'.cms')
  with self.assertRaisesRegex(u.UploadError,'recovery_artifact_path_rejected'):self.copy()
  self.archive=original
  with self.assertRaisesRegex(u.UploadError,'recovery_artifact_path_rejected'):self.copy(base=self.base/'different')
  self.assert_native_unchanged()
 def test_operator_uses_same_exclusive_native_lock(self):
  import fcntl
  with (self.base/'backup.lock').open('a+') as lock:
   os.chmod(self.base/'backup.lock',0o600);fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaisesRegex(u.UploadError,'backup_invocation_active'):self.copy()
  self.assert_native_unchanged()
if __name__=='__main__':unittest.main()
