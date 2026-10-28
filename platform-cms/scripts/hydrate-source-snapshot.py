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
from urllib.error import HTTPError, URLError
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

class SourceDownloadError(ValueError):
    def __init__(self,reason):
        self.reason=reason
        super().__init__('Source asset download failed: '+reason)

def download_archive(url,target,*,opener=None,clock=time.monotonic,sleep=time.sleep):
    # All retries preserve the exact committed URL, redirect policy and hashes.
    if not isinstance(url,str) or not re.fullmatch(r'https://github\.com/YardenRimon/derech-tkuma-journeys/releases/download/(?P<sid>[a-z0-9][a-z0-9-]{0,79})-assets-v1/source-media-(?P=sid)\.tgz',url):raise ValueError('Unpinned source archive URL refused')
    start=clock()
    for attempt in range(3):
        count=0
        transport=opener or build_opener(ProxyHandler({}),HTTPSHandler(context=ssl.create_default_context()),PinnedRedirect())
        try:
            with transport.open(Request(url,headers={'User-Agent':'derech-pinned-source-assets/1','Accept':'application/octet-stream','Cache-Control':'no-cache'}),timeout=15) as response,target.open('wb') as output:
                if response.status!=200:raise HTTPError(url,response.status,'',response.headers,None)
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
            return
        except Exception as error:
            target.unlink(missing_ok=True)
            if isinstance(error,HTTPError):
                reason='http_'+str(error.code)
                # 618 is GitHub CDN expired signed-response status; no auth is sent.
                retry=error.code in (408,429,500,502,503,504,618)
            elif isinstance(error,ssl.SSLError) or isinstance(error,URLError) and isinstance(error.reason,ssl.SSLError):reason='tls_error';retry=False
            elif isinstance(error,(URLError,TimeoutError,ConnectionError)):reason='network_error';retry=True
            else:reason='response_rejected';retry=False
            if not retry or attempt==2 or clock()-start>115:raise SourceDownloadError(reason) from None
            sleep((1,3)[attempt])

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
    except Exception as error:
        reason=error.reason if isinstance(error,SourceDownloadError) else 'verification_rejected'
        print('source_asset_hydration_failed:'+reason,file=sys.stderr);sys.exit(1)
