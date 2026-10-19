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
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--sha256',required=True);p.add_argument('--root',default='.');a=p.parse_args();hydrate(a.archive,a.sha256,pathlib.Path(a.root).resolve())
