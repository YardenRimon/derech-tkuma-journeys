#!/usr/bin/env python3
"""Hydrate one committed public source release; no settings/secrets or URL override."""
import argparse
import json
import re
from pathlib import Path
import runpy
import ssl
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener
from source_snapshot_bundle import load_source_bundle, MAX_ARCHIVE_BYTES, MAX_FILE_BYTES, MAX_TOTAL_BYTES

ALLOWED_REDIRECT_HOSTS={'github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'}
class PinnedRedirect(HTTPRedirectHandler):
    max_redirections=2
    def __init__(self):super().__init__();self.redirects=0
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        self.redirects+=1;target=urlsplit(newurl)
        if self.redirects>2 or target.scheme!='https' or target.hostname not in ALLOWED_REDIRECT_HOSTS or target.username or target.password or target.port not in (None,443) or target.fragment:raise ValueError('Source archive redirect refused')
        return super().redirect_request(request,fp,code,msg,headers,newurl)

def download_archive(url,target,*,opener=None,clock=time.monotonic):
    # Initial URL is already exact-config validated; redirects admit only the
    # bounded HTTPS GitHub release CDN chain and carry no authorization header.
    if not isinstance(url,str) or not re.fullmatch(r'https://github\.com/YardenRimon/derech-tkuma-journeys/releases/download/(?P<sid>[a-z0-9][a-z0-9-]{0,79})-assets-v1/source-media-(?P=sid)\.tgz',url):raise ValueError('Unpinned source archive URL refused')
    opener=opener or build_opener(ProxyHandler({}),HTTPSHandler(context=ssl.create_default_context()),PinnedRedirect())
    start=clock();count=0
    try:
        with opener.open(Request(url,headers={'User-Agent':'derech-pinned-source-assets/1','Accept':'application/octet-stream'}),timeout=15) as response,target.open('wb') as output:
            if response.status!=200:raise ValueError('Source archive response refused')
            length=response.headers.get('content-length')
            if length is not None and (not length.isdigit() or int(length)>MAX_ARCHIVE_BYTES):raise ValueError('Source archive length cap exceeded')
            while True:
                if clock()-start>120:raise ValueError('Source archive deadline exceeded')
                chunk=response.read(65536)
                if not chunk:break
                count+=len(chunk)
                if count>MAX_ARCHIVE_BYTES:raise ValueError('Source archive size cap exceeded')
                output.write(chunk)
            if not count or length is not None and count!=int(length):raise ValueError('Source archive response incomplete')
    except Exception:
        target.unlink(missing_ok=True)
        raise ValueError('Source asset download failed') from None

def hydrate_source(root,archive=None):
    root=Path(root).resolve();bundle=load_source_bundle(root)
    if bundle is None:return {'sourceAssetHydration':'legacy_bootstrap','networkRequests':0}
    hydrator=runpy.run_path(str(Path(__file__).with_name('hydrate-cloudflare-media.py')))['hydrate_verified_manifest']
    def apply(path):
        result=hydrator(path,bundle['config']['archiveSha256'],root,bundle['files'],bundle['namespace'],max_archive_bytes=MAX_ARCHIVE_BYTES,max_file_bytes=MAX_FILE_BYTES,max_total_bytes=MAX_TOTAL_BYTES)
        return {**result,'snapshotId':bundle['snapshotId'],'manifestSha256':bundle['manifestSha256'],'networkRequests':0 if archive is not None else 1}
    if archive is not None:return apply(Path(archive))
    with tempfile.TemporaryDirectory(prefix='derech-source-release-') as temporary:
        path=Path(temporary)/'source-assets.tgz';download_archive(bundle['config']['archiveUrl'],path);return apply(path)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',default=str(Path(__file__).resolve().parents[1]));parser.add_argument('--archive');args=parser.parse_args()
    try:print(json.dumps(hydrate_source(args.root,args.archive)))
    except Exception:
        print('source_asset_hydration_failed',file=sys.stderr);sys.exit(1)
