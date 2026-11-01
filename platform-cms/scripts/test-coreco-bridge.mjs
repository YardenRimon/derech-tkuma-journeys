import assert from 'node:assert/strict';
import {createHmac,createHash,webcrypto} from 'node:crypto';
import {verifyCorecoBridge} from '../lib/coreco-bridge.ts';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const key='synthetic-key-for-local-bridge-tests-only-123456',path='/api/machine/coreco/content',body=JSON.stringify({operation:'list',kind:'tour'}),config={key,tenant:'derech',site:'derech-main'};
const claims={v:1,ts:1000,nonce:'syntheticnonceabcdefghijklmno',tenant:'derech',site:'derech-main',actor:'12345678-1234-1234-1234-123456789012',role:'admin',method:'POST',path,body:createHash('sha256').update(body).digest('hex')};
function req(value=claims,secret=key,url=path){const data=Buffer.from(JSON.stringify(value)).toString('base64url');return new Request('https://cms.example.test'+url,{method:'POST',headers:{'x-coreco-bridge':data+'.'+createHmac('sha256',secret).update(data).digest('hex')}});}
const seen=new Set();const consume=async(n)=>{if(seen.has(n))return false;seen.add(n);return true;};
assert.equal((await verifyCorecoBridge(req(),body,config,consume,1000)).actor,claims.actor);
await assert.rejects(verifyCorecoBridge(req(),body,config,consume,1000),e=>e.status===403);
for(const [request,text,settings,now] of [[req(),body,config,1021],[req({...claims,tenant:'other'}),body,config,1000],[req({...claims,site:'other'}),body,config,1000],[req({...claims,role:'viewer'}),body,config,1000],[req(),body+' ',config,1000],[req(claims,'another-secret'),body,config,1000],[req(claims,key,path+'?bad=1'),body,config,1000],[req(),body,{...config,key:''},1000]])await assert.rejects(verifyCorecoBridge(request,text,settings,async()=>true,now));
console.log('Coreco bridge signature/scope/body/time/role/replay tests passed');
