import assert from'node:assert/strict';import{createHmac}from'node:crypto';
const origin=process.env.MACHINE_EXECUTION_TEST_ORIGIN??'http://127.0.0.1:5174',url=new URL(origin);
assert(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/','This denial suite is localhost-only and must never POST to a live CMS');
const endpoint=origin.replace(/\/$/,'')+'/api/machine/execution/';
async function denied(body,expected,headers={}){const response=await fetch(endpoint,{method:'POST',body,headers:{'content-type':'application/json',...headers},redirect:'manual'});assert(expected.includes(response.status),response.status+': '+(await response.text()).slice(0,120));}
assert.equal((await fetch(endpoint,{redirect:'manual'})).status,405);
await denied('{}',[401,503]);
await denied('{',[401,503]);
await denied(JSON.stringify({operation:'rollback',effectKey:'e'.repeat(64),expectedRevision:1}),[401,503],{'oai-authenticated-user-email':'seedy@sites.test','oai-authenticated-user-id':'local_seedy','cf-access-jwt-assertion':'spoofed'});
await denied('x'.repeat(500001),[413]);
const raw=JSON.stringify({operation:'rollback'}),stamp=String(Math.floor(Date.now()/1000)),fixture='local-fixture-only-'+'x'.repeat(48);
await denied(raw,[401,403,503],{'x-bridge-time':stamp,'x-bridge-signature':createHmac('sha256',fixture).update(stamp+'\n'+raw).digest('hex')});
console.log('PASS localhost machine alias HTTP denials: GET405, unsigned/malformed/spoofed requests failclosed, oversizedbody413, signed fixture rollback denied; no accepted packet/data mutation');
