#!/usr/bin/env python3
"""Download a purpose-authenticated CMS snapshot; credentials stay in a private config."""
import argparse, hashlib, hmac, json, os, pathlib, re, time, urllib.request, urllib.parse

def canonical(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(data): return hashlib.sha256(data).hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): raise RuntimeError('Backup redirects are refused')

def download(config_path,output,allow_local=False):
 config_path=pathlib.Path(config_path)
 if config_path.stat().st_mode&0o027: raise ValueError('Credential config must not be group-writable or world-accessible')
 config=json.loads(config_path.read_text());base=urllib.parse.urlsplit(config['url'])
 if base.query or base.fragment or base.username or base.password or (base.scheme!='https' and not(allow_local and base.scheme=='http' and base.hostname in ('127.0.0.1','localhost'))):raise ValueError('Use a fixed HTTPS Site URL')
 if base.path not in ('','/'):raise ValueError('Config URL must identify the Site origin')
 secret=config['secret'];scope=config['scope'];target=urllib.parse.urlunsplit((base.scheme,base.netloc,'/api/backup/','',''))
 if len(secret)<40:raise ValueError('Backup credential is invalid')
 output=pathlib.Path(output)
 if output.exists():raise ValueError('Backup output must be a new directory')
 output.mkdir(mode=0o700,parents=False);(output/'media').mkdir(mode=0o700);os.chmod(output,0o700)
 opener=urllib.request.build_opener(NoRedirect())
 def call(operation,extra=None,maximum=22*1024*1024):
  body={'purpose':'cms-backup-v1','operation':operation,'tenantId':scope['tenantId'],'siteId':scope['siteId'],**(extra or {})};raw=canonical(body).encode();stamp=str(int(time.time()));message=f'cms-backup-v1\nPOST\n/api/backup/\n{stamp}\n'.encode()+raw
  headers={'content-type':'application/json','x-backup-time':stamp,'x-backup-signature':hmac.new(secret.encode(),message,hashlib.sha256).hexdigest()}
  if config.get('siteAccessToken'):headers['OAI-Sites-Authorization']='Bearer '+config['siteAccessToken']
  with opener.open(urllib.request.Request(target,data=raw,headers=headers,method='POST'),timeout=120) as response:
   data=response.read(maximum+1)
   if len(data)>maximum:raise ValueError('Backup response exceeds supported bound')
   return data,response.headers
 raw,_=call('snapshot');wrapper=json.loads(raw);snapshot=wrapper['snapshot']
 if wrapper['sha256']!=digest(canonical(snapshot).encode()) or snapshot['format']!='cms-backup-v1' or snapshot['scope']!=scope:raise ValueError('Snapshot digest or scope mismatch')
 (output/'snapshot.json').write_text(canonical(wrapper));os.chmod(output/'snapshot.json',0o600)
 media=[]
 for item in snapshot['media']:
  key=item['key']
  if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',key):raise ValueError('Invalid media identity')
  data,headers=call('object',{'key':key,'etag':item['etag']},5*1024*1024);sha=digest(data)
  if len(data)!=item['size'] or headers.get('x-content-sha256')!=sha or headers.get('x-backup-etag')!=item['etag']:raise ValueError('Media identity/byte/hash mismatch')
  path=output/'media'/key;path.write_bytes(data);os.chmod(path,0o600);media.append({'key':key,'size':len(data),'sha256':sha})
 manifest={'format':'cms-backup-complete-v1','snapshotSha256':wrapper['sha256'],'scope':scope,'media':media,'mediaTotalBytes':sum(i['size']for i in media),'completedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'encryption':'required by outer existing backup transport; this private working directory is plaintext'}
 (output/'manifest.json').write_text(canonical(manifest));os.chmod(output/'manifest.json',0o600)
 print(json.dumps({'completed':True,'tables':len(snapshot['tables']),'rows':sum(t['count']for t in snapshot['tables']),'mediaObjects':len(media),'mediaBytes':manifest['mediaTotalBytes'],'snapshotSha256':wrapper['sha256']}))
 return manifest
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--output',required=True);parser.add_argument('--allow-local',action='store_true');args=parser.parse_args();download(args.config,args.output,args.allow_local)
