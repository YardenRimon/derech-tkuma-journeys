#!/usr/bin/env python3
"""Hydrate only manifest-verified public files from a pinned archive; no tar extraction."""
import argparse,hashlib,json,pathlib,tarfile

def hydrate(archive,expected,root):
 archive=pathlib.Path(archive);root=pathlib.Path(root);manifest=json.loads((root/'public-assets-manifest.json').read_text());files={x['path']:x for x in manifest['files']}
 def digest(data):return hashlib.sha256(data).hexdigest()
 if len(expected)!=64 or digest(archive.read_bytes())!=expected:raise ValueError('Archive SHA256 mismatch')
 seen=set();copied=0
 with tarfile.open(archive,'r:gz')as bundle:
  for item in bundle:
   name=item.name.removeprefix('./');path=pathlib.PurePosixPath(name)
   if path.is_absolute()or'..'in path.parts or not path.parts or path.parts[0]!='public':raise ValueError('Unsafe archive path')
   if item.isdir():continue
   key=str(pathlib.PurePosixPath(*path.parts[1:]));entry=files.get(key)
   if not item.isfile()or not entry or key in seen or item.size!=entry['bytes']:raise ValueError('Unexpected/duplicate/media member')
   seen.add(key);source=bundle.extractfile(item);data=source.read(entry['bytes']+1)
   if len(data)!=entry['bytes']or digest(data)!=entry['sha256']:raise ValueError('Media hash mismatch')
   target=root/'public'/key
   for parent in [target,*target.parents]:
    if parent==root:break
    if parent.is_symlink():raise ValueError('Symlink public path refused')
   if target.exists():
    if digest(target.read_bytes())!=entry['sha256']:raise ValueError('Tracked source differs; archive will not overwrite')
   else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);copied+=1
 if not seen:raise ValueError('Empty media archive')
 for key,entry in files.items():
  target=root/'public'/key
  if not target.is_file()or target.is_symlink()or target.stat().st_size!=entry['bytes']or digest(target.read_bytes())!=entry['sha256']:raise ValueError('Incomplete hydrated manifest: '+key)
 print(json.dumps({'hydrated':copied,'verifiedAssets':len(files),'archiveSha256':expected}))

def hydrate_verified_manifest(archive,expected,root,files,namespace,*,max_archive_bytes=128*1024*1024,max_file_bytes=16*1024*1024,max_total_bytes=128*1024*1024,max_members=8192):
 """Strict supplement mode; legacy hydrate() and its archive stay unchanged.

 Every member is staged and verified before public writes. No tar extraction,
 metadata application, link following, fallback source or mismatching overwrite.
 """
 import gzip,tempfile,os,re
 archive=pathlib.Path(archive);root=pathlib.Path(root)
 if archive.is_symlink() or not archive.is_file() or archive.stat().st_size>max_archive_bytes:raise ValueError('Source archive size/type refused')
 h=hashlib.sha256()
 with archive.open('rb') as source:
  for chunk in iter(lambda:source.read(65536),b''):h.update(chunk)
 if not re.fullmatch('[a-f0-9]{64}',expected) or h.hexdigest()!=expected:raise ValueError('Source archive SHA256 mismatch')
 entries={entry['path']:entry for entry in files}
 if len(entries)!=len(files) or not entries or sum(entry['bytes'] for entry in files)>max_total_bytes:raise ValueError('Invalid source manifest bounds')
 def checked_target(key):
  target=root/'public'/key
  for parent in [target,*target.parents]:
   if parent==root:break
   if parent.is_symlink():raise ValueError('Symlink source public path refused')
  return target
 def same(target,entry):
  return target.is_file() and target.stat().st_size==entry['bytes'] and hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256']
 class Bounded:
  def __init__(self,source):self.source=source;self.remaining=max_total_bytes+16*1024*1024
  def read(self,size=-1):
   data=self.source.read(min(size if size>=0 else self.remaining+1,self.remaining+1));self.remaining-=len(data)
   if self.remaining<0:raise ValueError('Source tar expansion cap exceeded')
   return data
 with tempfile.TemporaryDirectory(prefix='verified-source-media-') as temporary:
  staging=pathlib.Path(temporary);seen=set();members=0
  with gzip.open(archive,'rb') as decompressed,tarfile.open(fileobj=Bounded(decompressed),mode='r|',ignore_zeros=True) as bundle:
   for item in bundle:
    members+=1
    if members>max_members:raise ValueError('Source archive member cap exceeded')
    name=item.name.removeprefix('./').rstrip('/');path=pathlib.PurePosixPath(name)
    if not name or name!=str(path) or path.is_absolute() or '..' in path.parts or '\\' in name or not path.parts or path.parts[0]!='public':raise ValueError('Unsafe source archive path')
    key='/'.join(path.parts[1:])
    if item.isdir():
     if key and not (key.startswith(namespace) or namespace.startswith(key+'/')):raise ValueError('Unexpected source archive directory')
     continue
    entry=entries.get(key)
    if not item.isfile() or entry is None or key in seen or not key.startswith(namespace) or not 0<=item.size<=max_file_bytes or item.size!=entry['bytes']:raise ValueError('Unexpected, duplicate or oversized source member')
    seen.add(key);source=bundle.extractfile(item);data=source.read(entry['bytes']+1)
    if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Source media hash mismatch')
    target=staging/key;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
  if seen!=set(entries):raise ValueError('Incomplete source archive manifest')
  namespace_root=checked_target(namespace.rstrip('/'))
  if namespace_root.exists():
   for path in namespace_root.rglob('*'):
    if path.is_symlink() or path.is_file() and path.relative_to(root/'public').as_posix() not in entries:raise ValueError('Unexpected existing source namespace file')
  for key,entry in entries.items():
   target=checked_target(key)
   if target.exists() and not same(target,entry):raise ValueError('Existing source differs; archive will not overwrite')
  copied=0
  for key,entry in entries.items():
   target=checked_target(key)
   if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);os.replace(staging/key,target);copied+=1
   if not same(target,entry):raise ValueError('Hydrated source manifest mismatch')
 result={'hydrated':copied,'verifiedSourceAssets':len(entries),'bytes':sum(entry['bytes'] for entry in files),'archiveSha256':expected}
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--sha256',required=True);p.add_argument('--root',default='.');a=p.parse_args();hydrate(a.archive,a.sha256,pathlib.Path(a.root).resolve())
