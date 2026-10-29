import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:[new URL('../lib/cart-http.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {guestCartRequest,guestCartCookie}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const origin='https://derech-tkuma-review.22yarden22.workers.dev',url=origin+'/api/cart/';
const owner='10000000-0000-4000-8000-000000000001',cartId='20000000-0000-4000-8000-000000000002',quoteId='30000000-0000-4000-8000-000000000003';
const now=1700000000000,cart={schema:1,revision:3,createdAt:now-100,updatedAt:now,expiresAt:now+3600000,lines:[{productId:'synthetic-product',quantity:2}]};
let reads=0,writes=0,ingress=0,reserved=0;
const quote={schema:1,cartRevision:3,cartExpiresAt:cart.expiresAt,catalogRevision:99,sourcePolicyHash:'a'.repeat(64),legalHash:'b'.repeat(64),currency:'ILS',lineItems:[{productId:'synthetic-product',kind:'event',title:'Synthetic source event',quantity:2,unitPriceMinor:1250,lineTotalMinor:2500,productRevision:7,priceRevision:8,sourceHash:'c'.repeat(64),inventoryRevision:9,manageStock:true,backorders:'no',soldIndividually:false,availableStock:987654321}],subtotalMinor:2500,taxMinor:0,shippingMinor:0,discountMinor:0,totalMinor:2500,walletCapabilities:['credit','bit']};
const context={mode:'review',productionApproved:false,clock:()=>now,uuid:()=>owner,reserveNew:async()=>{reserved++;},ingress:async()=>{ingress++;},store:{create:async value=>{assert.equal(value,owner);writes++;return{cartId,cart};},get:async(o,c)=>{assert.equal(o,owner);assert.equal(c,cartId);reads++;return cart;},change:async(o,c,change)=>{assert.equal(o,owner);assert.equal(c,cartId);assert.deepEqual(change,{operation:'clear',expectedRevision:3});writes++;return{...cart,revision:4,lines:[]};},review:async(o,c)=>{assert.equal(o,owner);assert.equal(c,cartId);reads++;return{quoteId,cart,quote};}}};
const headers={'origin':origin,'sec-fetch-site':'same-origin','x-derech-cart':'1','content-type':'application/json'},cookie=guestCartCookie+'='+cartId+'.'+owner;
const request=(input,extra={})=>new Request(url,{method:'POST',headers:{...headers,cookie,...extra.headers},body:JSON.stringify(input),...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='headers'))});
let result=await guestCartRequest(new Request(url),context);assert.equal(result.status,200);assert.deepEqual(await result.json(),{accepted:true,cart:null});assert.equal(result.headers.get('set-cookie'),null);assert.equal(writes,0,'GET cannot create a persistent cart');
result=await guestCartRequest(new Request(url,{method:'POST',headers,body:'{"operation":"create"}'}),context);assert.equal(result.status,201);assert.match(result.headers.get('set-cookie'),/; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600$/);assert.equal(writes,1);
result=await guestCartRequest(request({operation:'create'}),context);assert.equal(result.status,200);assert.equal(writes,1,'retry uses same owned cart');
result=await guestCartRequest(request({operation:'review'}),context);assert.equal(result.status,200);const publicResult=await result.json();assert.equal(publicResult.quoteId,quoteId);assert.equal(publicResult.quote.totalMinor,2500);for(const forbidden of ['987654321','inventoryRevision','sourceHash','sourcePolicyHash','catalogRevision','ownerId','manageStock','reservedQuantity'])assert.ok(!JSON.stringify(publicResult).includes(forbidden),'private server authority leaked: '+forbidden);
result=await guestCartRequest(request({operation:'change',change:{operation:'clear',expectedRevision:3}}),context);assert.equal(result.status,200);assert.equal((await result.json()).cart.revision,4);
for(const badHeaders of [{origin:'https://foreign.invalid'},{'sec-fetch-site':'cross-site'},{'x-derech-cart':'0'}]){const before=writes;result=await guestCartRequest(request({operation:'create'},{headers:badHeaders}),context);assert.equal(result.status,403);assert.equal(writes,before);}
for(const forbidden of ['buyer','orderId','wallet','tenantId','siteId','priceMinor','totalMinor','catalog','quote']){result=await guestCartRequest(request({operation:'create',[forbidden]:'attacker'}),context);assert.equal(result.status,400);}
for(const malformed of [cookie+'; '+cookie,guestCartCookie+'=not-a-session',guestCartCookie+'='+cartId+'.'+owner+'.extra']){result=await guestCartRequest(request({operation:'review'},{headers:{cookie:malformed}}),context);assert.equal(result.status,403);}
result=await guestCartRequest(request({operation:'review'},{headers:{cookie:''}}),context);assert.equal(result.status,401);
result=await guestCartRequest(new Request(url+'?owner='+owner),context);assert.equal(result.status,403);
result=await guestCartRequest(new Request(url,{method:'PUT'}),context);assert.equal(result.status,405);
result=await guestCartRequest(request({operation:'create'},{body:'x'.repeat(8193)}),context);assert.equal(result.status,413);
result=await guestCartRequest(request({operation:'create'},{body:'{bad'}),context);assert.equal(result.status,400);
result=await guestCartRequest(request({operation:'create'},{headers:{'content-type':'application/x-www-form-urlencoded'}}),context);assert.equal(result.status,415);
result=await guestCartRequest(request({operation:'review'}),{...context,ingress:async()=>{throw new Error('PRIVATE-CANARY');}});assert.equal(result.status,503);assert.ok(!(await result.text()).includes('PRIVATE-CANARY'));
result=await guestCartRequest(new Request('https://derech-tkuma.com/api/cart/'),{...context,mode:'production',productionApproved:false});assert.equal(result.status,503);
{
 const previousWrites=writes,previousReserved=reserved;let cancelled=false;
 const stalled=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;return new Promise(()=>{});}});
 const began=Date.now();result=await guestCartRequest(new Request(url,{method:'POST',headers,body:stalled,duplex:'half'}),context);
 assert.equal(result.status,408);assert.equal((await result.json()).code,'cart_request_timeout');assert.equal(cancelled,true);assert.ok(Date.now()-began<7000,'untrusted cancel must not hold response');assert.equal(writes,previousWrites);assert.equal(reserved,previousReserved);
 const controller=new AbortController();controller.abort();result=await guestCartRequest(new Request(url,{method:'POST',headers,body:'{"operation":"create"}',signal:controller.signal}),context);assert.equal(result.status,408);assert.equal(writes,previousWrites);assert.equal(reserved,previousReserved);
}
assert.ok(ingress>0);assert.ok(reads>0);console.log('PASS guest cart HTTP: secure owned cookies, strict origin/method/body, no GET mutation, retry identity and private inventory redaction; no payments or provider I/O');
