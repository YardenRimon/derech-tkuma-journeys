import assert from 'node:assert/strict';
import {NextRequest} from '../node_modules/vinext/dist/shims/server.js';
import {createHmac,createHash,webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {verifyCorecoBridge,consumeCorecoNonce} from '../lib/coreco-bridge.ts';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const key='synthetic-key-for-local-bridge-tests-only-123456',path='/api/machine/coreco/content/',body=JSON.stringify({operation:'list',kind:'tour'}),config={key,tenant:'derech',site:'derech-main'};
const claims={v:1,ts:1000,nonce:'syntheticnonceabcdefghijklmno',tenant:'derech',site:'derech-main',actor:'12345678-1234-1234-1234-123456789012',role:'admin',method:'POST',path,body:createHash('sha256').update(body).digest('hex')};
function req(value=claims,secret=key,url=path){const data=Buffer.from(JSON.stringify(value)).toString('base64url');return new Request('https://cms.example.test'+url,{method:'POST',headers:{'x-coreco-bridge':data+'.'+createHmac('sha256',secret).update(data).digest('hex')}});}
const seen=new Set();const consume=async(n)=>{if(seen.has(n))return false;seen.add(n);return true;};
assert.equal((await verifyCorecoBridge(req(),body,config,consume,1000)).actor,claims.actor);
await assert.rejects(verifyCorecoBridge(req(),body,config,consume,1000),e=>e.status===403);
for(const [request,text,settings,now] of [[req(),body,config,1021],[req({...claims,tenant:'other'}),body,config,1000],[req({...claims,site:'other'}),body,config,1000],[req({...claims,role:'viewer'}),body,config,1000],[req(),body+' ',config,1000],[req(claims,'another-secret'),body,config,1000],[req(claims,key,path+'?bad=1'),body,config,1000],[req(),body,{...config,key:''},1000]])await assert.rejects(verifyCorecoBridge(request,text,settings,async()=>true,now));
console.log('Coreco bridge signature/scope/body/time/role/replay tests passed');

const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE platform_auth_rate_limits(bucket_key TEXT PRIMARY KEY,window_start INTEGER,attempts INTEGER,expires_at INTEGER)');
const adapter={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};
sqlite.prepare('INSERT INTO platform_auth_rate_limits VALUES(?,?,?,?)').run('a'.repeat(64),1000,4,1060);
assert.equal(await consumeCorecoNonce(adapter,'test-replay',1021,1000),true);assert.equal(await consumeCorecoNonce(adapter,'test-replay',1021,1000),false);
assert.equal(sqlite.prepare('SELECT attempts FROM platform_auth_rate_limits WHERE bucket_key=?').get('a'.repeat(64)).attempts,4);
assert.equal(await consumeCorecoNonce(adapter,'fresh-replay',1050,1022),true);assert.equal(sqlite.prepare("SELECT count(*) n FROM platform_auth_rate_limits WHERE bucket_key='coreco-replay:test-replay'").get().n,0);
sqlite.close();console.log('Coreco actual SQLite replay insertion/expiry and auth-counter namespace isolation passed');

// Actual Vinext NextRequest normalizes request.url under this project's trailingSlash config.
const normalized=new NextRequest(req(claims,key,path.slice(0,-1)),{nextConfig:{trailingSlash:true}});
assert.equal(new URL(normalized.url).pathname,path);
assert.equal((await verifyCorecoBridge(normalized,body,config,async()=>true,1000)).actor,claims.actor);
console.log('Actual Vinext NextRequest canonical trailing-slash signature binding passed');
