"""Execute the existing runner's resume path with local state and no network."""
from contextlib import redirect_stdout
from datetime import datetime,timedelta,timezone
import hashlib,importlib.util,io,json,os,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('runner_upload',Path(__file__).with_name('upload.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
class RunnerTests(unittest.TestCase):
 def test_resumed_original_capture_is_not_a_fresh_capture(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp).resolve();archive=base/'old.cms';archive.write_bytes(b'synthetic ciphertext');archive.chmod(0o600);created=(datetime.now(timezone.utc)-timedelta(days=1)).strftime('%Y%m%dT%H%M%SZ');sha=hashlib.sha256(archive.read_bytes()).hexdigest()
   report={'state':'encrypted_upload_held','createdAt':created,'archive':str(archive),'ciphertextBytes':archive.stat().st_size,'ciphertextSha256':sha,'offServerCopyVerified':False};u.atomic_json(base/'last-attempt.json',report)
   receipt={'verified':True,'scope':u.SCOPE,'ciphertextSha256':sha,'ciphertextBytes':archive.stat().st_size,'key':u.object_key(created,sha)}
   module=types.ModuleType('backup_upload');module.finalize_backup=lambda *a,**k:self.fail('must resume before new capture');module.UploadError=u.UploadError;module.atomic_json=u.atomic_json;module.stream_sha256=u.stream_sha256;module.resume_pending=lambda b:u.resume_pending(b,gate=lambda:True,uploader=lambda *a,**k:receipt)
   calls=[]
   def policy_only(command,**kw):
    calls.append(command);self.assertEqual(command,['/usr/bin/python3','/opt/yarden-time-policy/time_policy.py']);return types.SimpleNamespace(returncode=0,stdout='{"allowed":true}')
   source=Path(__file__).with_name('run.py').read_text().replace('/var/lib/yarden-cms-backup',str(base));output=io.StringIO()
   namespace={'__name__':'__main__'};prior_umask=os.umask(0o077)
   try:
    with patch.dict(sys.modules,{'backup_upload':module}),patch('subprocess.run',side_effect=policy_only),redirect_stdout(output):
     with self.assertRaises(SystemExit) as stopped:exec(compile(source,'local-existing-backup-runner','exec'),namespace)
   finally:
    if 'lock' in namespace:namespace['lock'].close()
    os.umask(prior_umask)
   self.assertEqual(stopped.exception.code,0);result=json.loads(output.getvalue());self.assertEqual(result['createdAt'],created);self.assertTrue(result['resumed']);self.assertTrue(result['offServerCopyVerified']);self.assertEqual(len(calls),1);self.assertEqual(json.loads((base/'latest.json').read_text())['createdAt'],created);self.assertFalse(any(p.name.startswith('.working-') for p in base.iterdir()))
 def test_closed_policy_prevents_even_resume(self):
  module=types.ModuleType('backup_upload')
  for name in ('finalize_backup','atomic_json','resume_pending','stream_sha256'):setattr(module,name,lambda *a,**k:self.fail('closed calendar must stop before all backup work'))
  module.UploadError=u.UploadError;output=io.StringIO()
  prior_umask=os.umask(0o077)
  try:
   with patch.dict(sys.modules,{'backup_upload':module}),patch('subprocess.run',return_value=types.SimpleNamespace(returncode=0,stdout='{"allowed":false}')),redirect_stdout(output):
    with self.assertRaises(SystemExit) as stopped:exec(compile(Path(__file__).with_name('run.py').read_text(),'local-closed-backup-runner','exec'),{'__name__':'__main__'})
  finally:os.umask(prior_umask)
  self.assertEqual(stopped.exception.code,0);self.assertEqual(json.loads(output.getvalue()),{'state':'time_policy_closed'})
if __name__=='__main__':unittest.main()
