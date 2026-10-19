"""Fixed-repository review deployment control; never prints credentials or logs."""
from pathlib import Path
import argparse,base64,datetime,json,subprocess,urllib.error,urllib.request

ROOT=Path(__file__).resolve().parents[1]
REPO='YardenRimon/derech-tkuma-journeys'
ENV='derech-cloudflare-review'
BRANCH='production-foundation-20261019'
WORKFLOW='site-cloudflare.yml'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['configure','bootstrap','dispatch','status']);args=parser.parse_args()
    result=subprocess.run(['git','credential','fill'],cwd=ROOT/'sites/derech-github-foundation',input='protocol=https\nhost=github.com\npath='+REPO+'.git\n\n',capture_output=True,text=True,timeout=20)
    if result.returncode:raise RuntimeError('Existing repository credential unavailable')
    token=dict(x.split('=',1)for x in result.stdout.splitlines()if '='in x)['password']
    def api(method,path,payload=None,missing=False):
        request=urllib.request.Request('https://api.github.com/repos/'+REPO+path,data=json.dumps(payload).encode()if payload is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json','User-Agent':'DerechReviewActions/1.0'})
        try:
            with urllib.request.urlopen(request,timeout=35)as response:return json.load(response)if response.status!=204 else None
        except urllib.error.HTTPError as error:
            if missing and error.code==404:return None
            raise RuntimeError('GitHub HTTP '+str(error.code))from None
    stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
    if args.action=='configure':
        config=json.loads((ROOT/'var/hetzner/cloudflare/review.json').read_text())
        config['d1_databases'][0]['migrations_dir']='./drizzle'
        values={'CLOUDFLARE_ACCOUNT_ID':config['account_id'],'DERECH_CF_CONFIG_JSON':json.dumps(config,separators=(',',':')),'DERECH_MEDIA_ARCHIVE_URL':'https://github.com/'+REPO+'/releases/download/review-static-media-20261019/derech-public-media-20261019-c493846b.tar.gz','DERECH_MEDIA_ARCHIVE_SHA256':'c493846b98ca5a39a7da3a194c29c78ff3807ddcfe32ffea00b1b84f58c75cc2','DERECH_CF_AUTO_DEPLOY_ENABLED':'false'}
        existing={x['name']:x['value']for x in api('GET','/environments/'+ENV+'/variables')['variables']}
        for name,value in values.items():
            if existing.get(name)==value:continue
            api('PATCH'if name in existing else 'POST','/environments/'+ENV+'/variables'+('/'+name if name in existing else ''),{'name':name,'value':value})
        actual={x['name']:x['value']for x in api('GET','/environments/'+ENV+'/variables')['variables']}
        assert all(actual.get(name)==value for name,value in values.items())
        output={'verifiedAt':stamp,'environment':ENV,'variables':sorted(values),'exactReadback':True,'automaticDeploymentEnabled':False}
        (ROOT/'audit/github-cloudflare-configuration-2026-10-20.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output))
    elif args.action=='bootstrap':
        data=(ROOT/'production/github-workflows'/WORKFLOW).read_bytes()
        path='/contents/.github/workflows/'+WORKFLOW
        old=api('GET',path+'?ref=main',missing=True)
        if old:
            if base64.b64decode(old['content'])!=data:raise RuntimeError('Existing default-branch workflow differs; review before changing')
            print(json.dumps({'alreadyPresent':True,'path':path,'defaultBranchApplicationMerged':False}));return
        saved=api('PUT',path,{'message':'Bootstrap manual owner-controlled Cloudflare review deployment','branch':'main','content':base64.b64encode(data).decode()})
        print(json.dumps({'workflowBootstrapCommit':saved['commit']['sha'],'defaultBranchApplicationMerged':False}))
    elif args.action=='dispatch':
        sha=api('GET','/git/ref/heads/'+BRANCH)['object']['sha']
        api('POST','/actions/workflows/'+WORKFLOW+'/dispatches',{'ref':BRANCH})
        output={'requestedAt':stamp,'sourceCommit':sha,'branch':BRANCH,'workflow':WORKFLOW,'dispatchAccepted':True}
        (ROOT/'audit/github-cloudflare-dispatch-2026-10-20.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output))
    else:
        for workflow in [WORKFLOW,'site-ci.yml']:
            data=api('GET','/actions/workflows/'+workflow+'/runs?per_page=6',missing=True)
            print(json.dumps({'workflow':workflow,'runs':[{key:r.get(key)for key in ['id','head_sha','head_branch','status','conclusion','html_url','created_at']}for r in (data or {}).get('workflow_runs',[])]}))

if __name__=='__main__':main()
