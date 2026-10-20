"""Bind the owner-approved managed identity public key to the fixed review Worker.

Secrets are read only from private files, sent only to Cloudflare, and never
printed. Does not remove Access, change DNS, or activate shared auth mode.
"""
from pathlib import Path
import datetime,json,os,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[1]
ACCOUNT='8b35c6b4ccb397857d80908ccf499f73';WORKER='derech-tkuma-review'
private=ROOT/'var/hetzner';cf=private/'cloudflare'
identity=json.loads((private/'supabase/identity-config.json').read_text())
assert identity['url']=='https://uawcxvkekfqxosfblpxr.supabase.co'
assert identity['origin']=='https://derech-tkuma-review.22yarden22.workers.dev'
assert identity['publishableKey'].startswith('sb_publishable_')
token=(cf/'ci-token').read_text().strip()
def api(method,path,value=None):
 request=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER+path,data=json.dumps(value).encode() if value is not None else None,method=method,headers={'authorization':'Bearer '+token,'content-type':'application/json','user-agent':'YardenSharedIdentitySetup/1.0'})
 try:
  with urllib.request.urlopen(request,timeout=30)as response:result=json.load(response)
 except urllib.error.HTTPError as error:raise RuntimeError('Cloudflare HTTP '+str(error.code))from None
 assert result.get('success')is True,'Cloudflare operation failed; details withheld'
 return result['result']
before={entry['name'] for entry in api('GET','/secrets')}
assert {'CMS_EXECUTION_SECRET','CMS_BACKUP_SECRET'}<=before
api('PUT','/secrets',{'name':'PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY','text':identity['publishableKey'],'type':'secret_text'})
after={entry['name'] for entry in api('GET','/secrets')}
assert before<=after and 'PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY'in after
config=json.loads((cf/'review.json').read_text());assert config['name']==WORKER and config['account_id']==ACCOUNT
config['vars'].update(PLATFORM_AUTH_MODE='cloudflare-access',PLATFORM_AUTH_SUPABASE_URL=identity['url'],PLATFORM_AUTH_ORIGIN=identity['origin'],PLATFORM_AUTH_EMAIL_OTP_READY='false')
temp=cf/'review.auth-stage.json';temp.write_text(json.dumps(config,indent=2)+'\n');temp.chmod(0o600);os.replace(temp,cf/'review.json')
safe={'configuredAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'worker':WORKER,'identityProject':'uawcxvkekfqxosfblpxr','binding':'PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY','existingSecretsRetained':True,'authMode':'cloudflare-access','accessGateChanged':False,'dnsChanged':False}
(ROOT/'audit/shared-auth-review-binding-2026-10-20.json').write_text(json.dumps(safe,indent=2)+'\n');print(json.dumps(safe))
