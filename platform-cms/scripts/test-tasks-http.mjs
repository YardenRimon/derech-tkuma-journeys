import assert from 'node:assert/strict';
const origin='http://127.0.0.1:5174';
async function login(handle=''){const r=await fetch(origin+'/signin-with-chatgpt?return_to=%2Fadmin'+(handle?'&test_user='+handle:''),{redirect:'manual'});assert.equal(r.status,302);return r.headers.get('set-cookie').split(';')[0];}
async function request(cookie,path='',body,expected=200,headers={}){const response=await fetch(origin+'/api/tasks'+path,{headers:{...(cookie?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{}),...headers},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const raw=await response.text();assert.equal(response.status,expected,`${body?.operation??'GET'} ${path}: ${raw.slice(0,300)}`);if(expected===403&&raw==='Forbidden')return{};const data=JSON.parse(raw);assert.equal(response.headers.get('cache-control'),'no-store');return data;}
await request('', '',undefined,401);
const spoof=await fetch(origin+'/api/tasks',{headers:{'oai-authenticated-user-id':'local_seedy','oai-authenticated-user-email':'seedy@sites.test'}});assert.ok([401,403].includes(spoof.status),'spoofed identity must be denied, including by the hosting ingress');
const owner=await login(),editor=await login('editor'),outsider=await login('outsider');
assert.equal((await fetch(origin+'/admin/tasks',{headers:{cookie:owner}})).status,200);
await request(outsider,'',undefined,403);await request(editor,'?gateway=1',undefined,403);
const id=String(Date.now()),otherId=String(Date.now()+1),snapshot={externalId:id,externalVersion:'http-test-v1',title:'בדיקת משימה מקומית',category:'content_review',sourceUrl:'https://example.com/source/',sourceHash:'',linkedTarget:'עמוד בדיקה · מחיר',quotedContent:'  תוכן מקור\n<script>untouched()</script>  ',question:'מה התשובה?',assigneeEmail:'editor@sites.test',assigneeLabel:'עורך בדיקה',status:'waiting_info',answer:''};
const payload={operation:'import',expectedRevision:0,snapshot};
await request(editor,'',payload,403);await request(owner,'',payload,403,{origin:'https://outside.invalid'});
await request(owner,'',{...payload,tenantId:'other-tenant'},400);
let {record}=await request(owner,'',payload);assert.equal(record.revision,1);assert.equal(record.snapshot.quotedContent,snapshot.quotedContent);
await request(owner,'',{...payload,snapshot:{...snapshot,externalId:otherId,assigneeEmail:'seedy@sites.test',assigneeLabel:'מנהל'}});
const ownList=await request(editor);assert.ok(ownList.records.some(x=>x.snapshot.externalId===id));assert.ok(!ownList.records.some(x=>x.snapshot.externalId===otherId));
await request(editor,'?id='+otherId,undefined,404);
const input={operation:'request',id,key:'http-request-'+crypto.randomUUID(),expectedRevision:1,answer:'תשובת בדיקה מקומית',requestedStatus:'done'};
let saved=await request(editor,'',input,202);assert.equal(saved.command.state,'pending');
assert.deepEqual((await request(editor,'',input,202)).command,saved.command);
await request(editor,'',{...input,answer:'different'},409);
const detail=await request(editor,'?id='+id);assert.equal(detail.record.snapshot.status,'waiting_info');assert.equal(detail.record.snapshot.answer,'');assert.equal(detail.commands[0].state,'pending');
assert.ok((await request(owner,'?gateway=1')).commands.some(x=>x.key===input.key));
await request(owner,'',{operation:'import',expectedRevision:2,snapshot:{...snapshot,externalVersion:'http-test-v2',status:'done',answer:input.answer},receipts:[{key:input.key,state:'accepted',note:'בדיקת שער מקומית בלבד'}]});
const confirmed=await request(editor,'?id='+id);assert.equal(confirmed.record.snapshot.status,'done');assert.equal(confirmed.commands[0].state,'accepted');assert.equal(confirmed.history.length,3);
console.log('PASS local tasks HTTP: auth/spoof/role/CSRF rejection, assigned-only reads, admin import, immutable quote, server-owned scope, pending202/idempotency/conflicts, gateway receipts and audit. Synthetic local fixtures retained.');
