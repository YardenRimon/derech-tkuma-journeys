/** Actual edge fetch semantics with fixed synthetic endpoints; no external I/O. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel} from 'miniflare';
const root=new URL('../',import.meta.url).pathname;
const source=`import {deliverContact} from './lib/contact-delivery';import {GrowGateway} from './lib/payment-grow';
const scope={tenantId:'derech',siteId:'derech-main'};
const contract={schema:1,kind:'make',verified:true,scope,formIds:['0899899'],endpoint:'https://hook.eu2.make.com/synthetic_transport_fixture',fields:{name:'fullName',phone:'phone',email:'email',form:'formId',post:'postId',consent_at:'consentAt',receipt:'receipt'},idempotency:{header:'x-contact-idempotency',verified:true},acknowledgement:{status:202,field:'state',value:'queued',receiptField:'id'},timeoutMs:1000};
const config={schema:1,enabled:true,provider:'grow',...scope,environment:'sandbox',pageCode:'FixturePageCode123',userId:'FixtureMerchant123',currency:'ILS',currencyEvidenceHash:'a'.repeat(64),acceptanceHash:'b'.repeat(64),callbackVerification:'stored-process-token-and-approved-readback/v1',creditOnlyVerified:true,walletPageVerified:true,merchantVerified:true,callbackReadbackApproved:true,acknowledgmentContract:'full-documented-form/v1',acknowledgmentEvidenceHash:'c'.repeat(64),termsHash:'d'.repeat(64),finalReleaseHash:null,productionApprovalHash:null};
export default{async fetch(request){try{
 if(new URL(request.url).pathname==='/make'){
  const record={source:{formId:'0899899',postId:'13'},fields:{fullName:'Synthetic Fixture',phone:'0501234567',email:'fixture@example.invalid'},consent:{receivedAt:'2026-10-28T00:00:00Z'},receipt:'10000000-0000-4000-8000-000000000001',outbox:{attemptToken:'synthetic-only'}};
  const service={claim:async()=>record,settle:async(_scope,_key,_token,outcome)=>({...record,outbox:{state:outcome}})};
  return Response.json(await deliverContact(service,scope,'fixture-key',1,contract));
 }
 const gateway=await GrowGateway.accepted(config,(input,init)=>fetch(input,init));
 const order={id:'a'.repeat(64),configHash:gateway.configHash,environment:'sandbox',state:'creating',quote:{currency:'ILS',amountMinor:1234,title:'Synthetic order'}};
 const result=await gateway.create(order,{fullName:'Synthetic Buyer',phone:'0501234567',email:'fixture@example.invalid'});
 return Response.json({created:!!result.processId});
 }catch(error){return Response.json({code:error.code||'fixture_error'},{status:503});}}};`;
const bundle=await build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',external:['node:crypto'],logLevel:'silent'});
let mode='success',requests=[];
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),outboundService:async request=>{
 requests.push(request.url);assert.equal(request.method,'POST');assert.ok(['https://hook.eu2.make.com/synthetic_transport_fixture','https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess'].includes(request.url),'unknown endpoint must never receive a request');
 if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.invalid/never-follow'}});
 return request.url.includes('hook.eu2.make.com')?Response.json({state:'queued',id:'fixture-accepted'},{status:202}):Response.json({status:1,err:'',data:{processId:'12345',processToken:'P'.repeat(32),authCode:'A'.repeat(32)}});
}});
try{
 for(const path of ['/make','/grow']){
  mode='success';let before=requests.length;let response=await mf.dispatchFetch('https://fixture.invalid'+path);let body=await response.json();assert.equal(response.status,200);assert.equal(requests.length,before+1);if(path==='/make')assert.equal(body.state,'provider_accepted');else assert.equal(body.created,true);
  mode='redirect';before=requests.length;response=await mf.dispatchFetch('https://fixture.invalid'+path);body=await response.json();assert.equal(requests.length,before+1,'manual redirect cannot reach foreign endpoint');if(path==='/make')assert.equal(body.state,'unknown');else{assert.equal(response.status,503);assert.equal(body.code,'payment_provider_transport_uncertain');}
 }
 console.log('PASS actual Workerd Make/Grow native fetch reaches one fixed synthetic endpoint; valid receipts accepted,302 never followed and uncertain states retained; zero external requests');
}finally{await mf.dispose();}
