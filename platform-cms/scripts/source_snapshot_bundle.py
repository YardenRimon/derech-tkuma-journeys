"""Pinned public source bundle metadata only; no application/source execution."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

MAX_FILES=2048
MAX_FILE_BYTES=16*1024*1024
MAX_TOTAL_BYTES=128*1024*1024
MAX_ARCHIVE_BYTES=128*1024*1024
EXTENSIONS={'.css','.js','.jpg','.jpeg','.png','.webp','.svg','.gif','.ico','.woff','.woff2','.ttf','.eot','.avif','.mp4','.pdf'}
HASH=re.compile('[a-f0-9]{64}')

def digest(data):return hashlib.sha256(data).hexdigest()
def read_json(path,maximum=8*1024*1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>maximum:raise ValueError('Unsafe or oversized source metadata')
    raw=path.read_bytes()
    return json.loads(raw),raw

def safe_path(path):
    return isinstance(path,str) and bool(path) and not path.startswith('/') and '\\' not in path and not re.search(r'[\x00-\x1f\x7f?#]',path) and not re.search(r'%[a-f0-9]{2}',path,re.I) and all(part not in ('','.','..') for part in path.split('/'))

def load_source_bundle(root):
    root=Path(root)
    provenance,_=read_json(root/'source-pages/provenance.json',64*1024*1024)
    if 'assetMap' not in provenance:return None
    pin=provenance['assetMap'];sid=provenance.get('snapshotId')
    if not isinstance(sid,str) or not re.fullmatch('[a-z0-9][a-z0-9-]{0,79}',sid) or not isinstance(pin,dict) or set(pin)!={'file','sha256','snapshotId'} or pin['file']!='asset-map.json' or pin['snapshotId']!=sid or not HASH.fullmatch(str(pin['sha256'])):raise ValueError('Invalid source map provenance pin')
    asset_map,map_raw=read_json(root/'source-pages/asset-map.json')
    if digest(map_raw)!=pin['sha256'] or not isinstance(asset_map,dict) or set(asset_map)!={'version','snapshotId','namespace','paths','excludedPaths','manifestSha256'} or asset_map['version']!=1 or asset_map['snapshotId']!=sid:raise ValueError('Source map pin mismatch')
    namespace='__source_assets__/'+sid+'/'
    if asset_map['namespace'].strip('/')!=namespace.rstrip('/') or not HASH.fullmatch(str(asset_map['manifestSha256'])):raise ValueError('Invalid source namespace or manifest pin')
    manifest,manifest_raw=read_json(root/'source-snapshot-assets-manifest.json')
    if digest(manifest_raw)!=asset_map['manifestSha256'] or not isinstance(manifest,dict) or manifest.get('version')!=1 or manifest.get('snapshotId')!=sid or str(manifest.get('namespace')).strip('/')!=namespace.rstrip('/') or not isinstance(manifest.get('files'),list):raise ValueError('Source supplement manifest pin mismatch')
    files=manifest['files']
    if not 1<=len(files)<=MAX_FILES:raise ValueError('Source manifest file cap exceeded')
    normalized=[];paths=set();total=0
    for entry in files:
        if not isinstance(entry,dict) or not {'path','bytes','transformedSha256'}<=set(entry) or not set(entry)<={'path','sourcePath','originalSha256','transformedSha256','bytes','disposition','provenanceHash'}:raise ValueError('Invalid source asset entry')
        path=entry['path'];size=entry['bytes'];sha=entry['transformedSha256']
        if not safe_path(path) or not path.startswith(namespace) or path in paths or PurePosixPath(path).suffix.lower() not in EXTENSIONS or type(size) is not int or not 0<=size<=MAX_FILE_BYTES or not isinstance(sha,str) or not HASH.fullmatch(sha):raise ValueError('Unsafe, duplicate or oversized source asset')
        paths.add(path);total+=size
        if total>MAX_TOTAL_BYTES:raise ValueError('Source asset total cap exceeded')
        normalized.append({'path':path,'bytes':size,'sha256':sha})
    if not isinstance(asset_map['paths'],dict) or not isinstance(asset_map['excludedPaths'],list) or any(not isinstance(path,str) for path in asset_map['excludedPaths']) or len(set(asset_map['excludedPaths']))!=len(asset_map['excludedPaths']):raise ValueError('Invalid source map entries')
    for path,target in asset_map['paths'].items():
        if not safe_path(path) or path in asset_map['excludedPaths'] or not isinstance(target,str) or not target.startswith('/') or target[1:] not in paths:raise ValueError('Source alias outside pinned manifest')
    for path in asset_map['excludedPaths']:
        if not safe_path(path):raise ValueError('Unsafe source exclusion')
    config,_=read_json(root/'source-pages/asset-bundle.json',65536)
    names={'version','snapshotId','archiveUrl','archiveSha256','manifestSha256','files','bytes'}
    if not isinstance(config,dict) or set(config)!=names or type(config['version']) is not int or config['version']!=1 or config['snapshotId']!=sid:raise ValueError('Invalid source bundle config')
    expected='https://github.com/YardenRimon/derech-tkuma-journeys/releases/download/'+sid+'-assets-v1/source-media-'+sid+'.tgz'
    if config['archiveUrl']!=expected or not isinstance(config['archiveSha256'],str) or not HASH.fullmatch(config['archiveSha256']) or config['manifestSha256']!=digest(manifest_raw) or type(config['files']) is not int or config['files']!=len(files) or type(config['bytes']) is not int or config['bytes']!=total:raise ValueError('Source bundle release or manifest pin mismatch')
    return {'config':config,'files':normalized,'namespace':namespace,'snapshotId':sid,'manifestSha256':digest(manifest_raw),'mapSha256':digest(map_raw)}
