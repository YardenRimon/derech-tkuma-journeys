"""Synthetic offline bundle fixtures; no repository/public asset writes or network."""
import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import runpy
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import Request
sys.path.insert(0,str(Path(__file__).resolve().parent))
from source_snapshot_bundle import load_source_bundle, MAX_FILE_BYTES
HYDRATE=runpy.run_path(str(Path(__file__).with_name('hydrate-cloudflare-media.py')))['hydrate_verified_manifest']
CLI=runpy.run_path(str(Path(__file__).with_name('hydrate-source-snapshot.py')))
SID='fixture-20261028';NS='__source_assets__/'+SID+'/'
def sha(data):return hashlib.sha256(data).hexdigest()
class BundleTests(unittest.TestCase):
 def setUp(self):
  self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name);(self.root/'source-pages').mkdir();(self.root/'public').mkdir()
  self.content={NS+'wp-content/a.css':b'body{color:red}',NS+'wp-content/a.woff2':b'synthetic font'}
  self.manifest={'version':1,'snapshotId':SID,'namespace':'/'+NS,'files':[{'path':name,'bytes':len(data),'transformedSha256':sha(data)} for name,data in self.content.items()]}
  self.map={'version':1,'snapshotId':SID,'namespace':'/'+NS,'paths':{name.removeprefix(NS):'/'+name for name in self.content},'excludedPaths':[],'manifestSha256':''}
  self.config={'version':1,'snapshotId':SID,'archiveUrl':'https://github.com/YardenRimon/derech-tkuma-journeys/releases/download/'+SID+'-assets-v1/source-media-'+SID+'.tgz','archiveSha256':'0'*64,'manifestSha256':'','files':2,'bytes':sum(map(len,self.content.values()))}
  self.repin();self.archive=self.make_archive()
 def tearDown(self):self.temporary.cleanup()
 def repin(self):
  raw=(json.dumps(self.manifest)+'\n').encode();(self.root/'source-snapshot-assets-manifest.json').write_bytes(raw);self.map['manifestSha256']=sha(raw);self.config['manifestSha256']=sha(raw)
  raw=(json.dumps(self.map)+'\n').encode();(self.root/'source-pages/asset-map.json').write_bytes(raw)
  (self.root/'source-pages/provenance.json').write_text(json.dumps({'snapshotId':SID,'assetMap':{'file':'asset-map.json','snapshotId':SID,'sha256':sha(raw)}}));self.write_config()
 def write_config(self): (self.root/'source-pages/asset-bundle.json').write_text(json.dumps(self.config))
 def make_archive(self,members=None):
  archive=self.root/'source.tgz'
  with tarfile.open(archive,'w:gz') as tar:
   for name,data,kind in members or [('public/'+key,value,'file') for key,value in self.content.items()]:
    info=tarfile.TarInfo(name)
    if kind=='file':info.size=len(data);tar.addfile(info,io.BytesIO(data))
    else:info.type=tarfile.SYMTYPE if kind=='symlink' else tarfile.LNKTYPE;info.linkname='untrusted';tar.addfile(info)
  self.config['archiveSha256']=sha(archive.read_bytes());self.write_config();return archive
 def apply(self,**kwargs):
  bundle=load_source_bundle(self.root)
  return HYDRATE(self.archive,self.config['archiveSha256'],self.root,bundle['files'],bundle['namespace'],**kwargs)
 def assert_no_public_files(self):self.assertFalse(any(path.is_file() for path in (self.root/'public').rglob('*')))
 def test_complete_hydration_and_same_byte_idempotence(self):
  result=self.apply();self.assertEqual(result['hydrated'],2);self.assertEqual(self.apply()['hydrated'],0)
  for key,data in self.content.items():self.assertEqual((self.root/'public'/key).read_bytes(),data)
  result=CLI['hydrate_source'](self.root,self.archive);self.assertEqual(result['networkRequests'],0)
 def test_archive_tampering_wrong_hash_and_member_hash_reject_before_public_write(self):
  self.config['archiveSha256']='a'*64;self.write_config()
  with self.assertRaisesRegex(ValueError,'SHA256'):self.apply()
  members=[('public/'+key,b'wrong same size' if key.endswith('.css') else data,'file') for key,data in self.content.items()];self.make_archive(members)
  with self.assertRaises(ValueError):self.apply()
  self.assert_no_public_files()
 def test_incomplete_duplicate_extra_traversal_links_and_php_are_rejected(self):
  members=[('public/'+key,value,'file') for key,value in self.content.items()]
  cases=[members[:1],members+[members[0]],members+[('public/'+NS+'extra.js',b'extra','file')],[('../escape',b'x','file')],[('public/'+next(iter(self.content)),b'','symlink')],[('public/'+next(iter(self.content)),b'','hardlink')]]
  for candidate in cases:
   with self.subTest(candidate=candidate):
    self.make_archive(candidate)
    with self.assertRaises(ValueError):self.apply()
    self.assert_no_public_files()
  self.manifest['files'][0]['path']=NS+'wp-content/execute.php';self.repin()
  with self.assertRaises(ValueError):load_source_bundle(self.root)
 def test_appended_second_tar_member_cannot_hide_after_tar_end_markers(self):
  extra=io.BytesIO()
  with tarfile.open(fileobj=extra,mode='w') as tar:
   item=tarfile.TarInfo('public/'+NS+'hidden.js');item.size=6;tar.addfile(item,io.BytesIO(b'hidden'))
  self.archive.write_bytes(self.archive.read_bytes()+gzip.compress(extra.getvalue()));self.config['archiveSha256']=sha(self.archive.read_bytes());self.write_config()
  with self.assertRaises(ValueError):self.apply()
  self.assert_no_public_files()
 def test_oversize_archive_member_and_total_caps_reject_without_writes(self):
  with self.assertRaises(ValueError):self.apply(max_archive_bytes=1)
  with self.assertRaises(ValueError):self.apply(max_members=1)
  with self.assertRaises(ValueError):self.apply(max_total_bytes=1)
  info=tarfile.TarInfo('public/'+next(iter(self.content)));info.size=MAX_FILE_BYTES+1
  self.archive.write_bytes(gzip.compress(info.tobuf(format=tarfile.USTAR_FORMAT)+b'\0'*1024));self.config['archiveSha256']=sha(self.archive.read_bytes());self.write_config()
  with self.assertRaises(ValueError):self.apply()
  self.assert_no_public_files()
 def test_metadata_hash_alias_scope_count_and_release_url_fail_closed(self):
  for url in ['http://github.com/unsafe','https://outside.invalid/archive','https://github.com/foreign/repo/releases/download/x/x.tgz',self.config['archiveUrl']+'?token=not-allowed']:
   self.config['archiveUrl']=url;self.write_config()
   with self.assertRaises(ValueError):load_source_bundle(self.root)
  self.config['archiveUrl']='https://github.com/YardenRimon/derech-tkuma-journeys/releases/download/'+SID+'-assets-v1/source-media-'+SID+'.tgz';self.config['files']=3;self.write_config()
  with self.assertRaises(ValueError):load_source_bundle(self.root)
  self.config['files']=2;self.write_config();self.map['paths']['wp-content/escape.css']='/other/file.css';self.repin()
  with self.assertRaises(ValueError):load_source_bundle(self.root)
  self.map['paths'].pop('wp-content/escape.css');self.repin();path=self.root/'source-pages/asset-map.json';path.write_bytes(path.read_bytes()+b' ')
  with self.assertRaises(ValueError):load_source_bundle(self.root)
 def test_manifest_duplicate_traversal_and_unsafe_quantity_reject_even_with_repinned_hash(self):
  original=json.loads(json.dumps(self.manifest))
  for change in ['duplicate','traversal','oversize','unsafe-bytes']:
   self.manifest=json.loads(json.dumps(original))
   if change=='duplicate':self.manifest['files'].append(dict(self.manifest['files'][0]))
   elif change=='traversal':self.manifest['files'][0]['path']=NS+'../escape.css'
   elif change=='oversize':self.manifest['files'][0]['bytes']=MAX_FILE_BYTES+1
   else:self.manifest['files'][0]['bytes']=True
   self.repin()
   with self.assertRaises(ValueError):load_source_bundle(self.root)
 def test_existing_mismatch_extra_file_and_symlink_refuse_without_overwrite(self):
  key=next(iter(self.content));target=self.root/'public'/key;target.parent.mkdir(parents=True);target.write_bytes(b'preserve existing')
  with self.assertRaises(ValueError):self.apply()
  self.assertEqual(target.read_bytes(),b'preserve existing');target.unlink()
  extra=target.parent/'extra.js';extra.write_bytes(b'extra')
  with self.assertRaises(ValueError):self.apply()
  extra.unlink();foreign=self.root/'foreign';foreign.write_bytes(b'private synthetic');target.symlink_to(foreign)
  with self.assertRaises(ValueError):self.apply()
  self.assertEqual(foreign.read_bytes(),b'private synthetic')
 def test_legacy_without_asset_map_needs_no_source_bundle_or_network(self):
  (self.root/'source-pages/provenance.json').write_text('{}');(self.root/'source-pages/asset-bundle.json').unlink()
  globals_=CLI['hydrate_source'].__globals__
  with patch.dict(globals_,{'download_archive':lambda *args: self.fail('must not download legacy bootstrap')}):
   self.assertEqual(CLI['hydrate_source'](self.root),{'sourceAssetHydration':'legacy_bootstrap','networkRequests':0})
 def test_redirect_and_download_bounds_use_no_actual_network(self):
  handler=CLI['PinnedRedirect']();request=Request(self.config['archiveUrl'])
  for destination in ['http://github.com/file','https://outside.invalid/file','https://user:pass@github.com/file']:
   with self.assertRaises(ValueError):handler.redirect_request(request,None,302,'',{},destination)
  class Response(io.BytesIO):
   status=200
   def __init__(self,data,length=None):super().__init__(data);self.headers={} if length is None else {'content-length':str(length)}
  class Opener:
   calls=0
   def open(self,*args,**kwargs):self.calls+=1;return Response(b'abcdef',6)
  opener=Opener();target=self.root/'download.tgz';fn=CLI['download_archive'];globals_=fn.__globals__
  with self.assertRaises(ValueError):fn('https://outside.invalid/file',target,opener=opener)
  self.assertEqual(opener.calls,0)
  with patch.dict(globals_,{'MAX_ARCHIVE_BYTES':5}),self.assertRaises(ValueError):fn(self.config['archiveUrl'],target,opener=opener)
  self.assertFalse(target.exists())
  times=iter([0,130])
  with self.assertRaises(ValueError):fn(self.config['archiveUrl'],target,opener=opener,clock=lambda:next(times))
  self.assertFalse(target.exists())

if __name__=='__main__':unittest.main()
