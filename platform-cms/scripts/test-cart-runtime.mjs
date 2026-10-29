import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
const compiled=await build({stdin:{contents:"export {cartRuntimeRequest} from './lib/cart-runtime';export {D1GuestCarts} from './lib/cart-d1';export {cartIngress} from './lib/cart-controls';export {publicCartConfiguration,prepareCommercePage,checkoutPageResponse} from './lib/commerce-page';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'synthetic-fixed-scope',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'fixed-env',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const env={CMS_ADAPTER_MODE:'isolated-d1',CMS_TENANT_ID:'derech',CMS_SITE_ID:'derech-main'}",loader:'js'}));}}]});
const {cartRuntimeRequest,D1GuestCarts,cartIngress,publicCartConfiguration,prepareCommercePage,checkoutPageResponse}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const db={prepare(text){const statement=sql.prepare(text);return{args:[],bind(...args){this.args=args;return this;},async first(){return statement.get(...this.args)??null;},async all(){return{success:true,results:statement.all(...this.args)};},async run(){if(statement.columns().length)return{success:true,results:statement.all(...this.args),meta:{changes:0}};const result=statement.run(...this.args);return{success:true,results:[],meta:{changes:Number(result.changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const scope={tenantId:'derech',siteId:'derech-main'},origin='https://derech-tkuma-review.22yarden22.workers.dev',url=origin+'/api/cart/',bindings={DB:db,CMS_ADAPTER_MODE:'isolated-d1',CART_MODE:'review'};
const headers={'origin':origin,'sec-fetch-site':'same-origin','x-derech-cart':'1','content-type':'application/json','cf-connecting-ip':'203.0.113.11'};
const post=(body,cookie='')=>new Request(url,{method:'POST',headers:{...headers,cookie},body:JSON.stringify(body)});
const originalNow=Date.now;Date.now=()=>1800000000000;
try{
 let response=await cartRuntimeRequest(new Request(url),{...bindings,CART_MODE:undefined},scope);assert.equal(response.status,503);assert.equal(sql.prepare('SELECT count(*) AS n FROM cms_settings').get().n,0,'disabled mode performs no cart write');
 sql.prepare('INSERT INTO cms_deployment_scope VALUES(1,?,?)').run(scope.tenantId,scope.siteId);
 response=await cartRuntimeRequest(new Request(url,{headers:{'cf-connecting-ip':'203.0.113.11'}}),bindings,scope);assert.equal(response.status,200);assert.equal((await response.json()).cart,null);
 response=await cartRuntimeRequest(post({operation:'create'}),bindings,scope);assert.equal(response.status,503,'catalog must exist before persistent carts are created');
 const store=new D1GuestCarts(db,scope,{cartTtlMs:172800000,holdTtlMs:3600000,authorizeCatalogWrite:async()=>{}});
 await store.setPrivateCatalog({schema:1,sourceCapture:{id:'synthetic-fixture',sha256:'a'.repeat(64)},legalHash:'b'.repeat(64),walletCapabilities:['credit'],products:[{id:'source-product-9001',kind:'physical',title:'Synthetic product',unitPriceMinor:1234,currency:'ILS',status:'published',purchasable:true,sourceHash:'c'.repeat(64),inventory:{manageStock:false,stockQuantity:null,backorders:'no',soldIndividually:false}}]},0);
 response=await cartRuntimeRequest(post({operation:'create'}),bindings,scope);assert.equal(response.status,201);const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^__Host-derech-cart=[a-f0-9-]+\.[a-f0-9-]+$/);const created=await response.json();assert.equal(created.cart.revision,0);
 response=await cartRuntimeRequest(post({operation:'change',change:{operation:'add',productId:'source-product-9001',quantity:3,expectedRevision:0}},cookie),bindings,scope);assert.equal(response.status,200);
 response=await cartRuntimeRequest(post({operation:'review'},cookie),bindings,scope);assert.equal(response.status,200);const reviewed=await response.json();assert.equal(reviewed.quote.totalMinor,3702);assert.equal(reviewed.quote.lineItems[0].unitPriceMinor,1234);assert.match(reviewed.quoteId,/^[a-f0-9-]{36}$/);for(const forbidden of ['stockQuantity','reservedQuantity','sourceHash','catalogRevision','ownerId'])assert.ok(!JSON.stringify(reviewed).includes(forbidden));
 response=await cartRuntimeRequest(post({operation:'change',change:{operation:'set',productId:'source-product-9001',quantity:1,expectedRevision:1,priceMinor:1}},cookie),bindings,scope);assert.equal(response.status,400);
 const different=cookie.slice(0,cookie.indexOf('.')+1)+'10000000-0000-4000-8000-000000000001';response=await cartRuntimeRequest(new Request(url,{headers:{cookie:different,'cf-connecting-ip':'203.0.113.12'}}),bindings,scope);assert.equal(response.status,404);
 response=await cartRuntimeRequest(new Request('https://derech-tkuma.com/api/cart/'),{...bindings,CART_MODE:'production'},scope);assert.equal(response.status,503,'unapproved production cannot enable carts');
 response=await cartRuntimeRequest(post({operation:'create'}),bindings,{tenantId:'foreign',siteId:'derech-main'});assert.equal(response.status,503);
 const before=sql.prepare('SELECT count(*) AS n FROM contact_rate_limits').get().n;
 await assert.rejects(cartIngress(db,scope,new Request(url,{headers:{'cf-connecting-ip':'999.0.0.1'}}),'read'),error=>error.code==='cart_ingress_unavailable');assert.equal(sql.prepare('SELECT count(*) AS n FROM contact_rate_limits').get().n,before);

 // Real CMS/source cart shell integration is disabled unless deployment-owned
 // config enables it; checkout dispatch precedes the captured empty302.
 const page=JSON.parse(readFileSync(new URL('../lib/generated-pages.json',import.meta.url)))['/cart/'],shell=page.shellPrefix+page.sections.map(section=>section.html).join('')+page.shellSuffix;
 let pageLoads=0;const loadPage=async path=>{assert.equal(path,'/cart/');pageLoads++;return shell;},checkoutUrl=origin+'/checkout/';
 assert.deepEqual(publicCartConfiguration(new URL(origin+'/cart/'),{...bindings,CART_MODE:undefined}),{});
 assert.equal(prepareCommercePage(shell,new URL(origin+'/cart/'),{...bindings,CART_MODE:undefined}),shell);
 assert.equal(await checkoutPageResponse(new Request(checkoutUrl),{...bindings,CART_MODE:undefined},scope,loadPage),null);assert.equal(pageLoads,0);
 assert.deepEqual(publicCartConfiguration(new URL('https://foreign.invalid/cart/'),bindings),{});
 assert.deepEqual(publicCartConfiguration(new URL('https://derech-tkuma.com/cart/'),{...bindings,CART_MODE:'production'}),{});
 const cartHtml=prepareCommercePage(shell,new URL(origin+'/cart/'),bindings);assert.ok(cartHtml.includes('data-native-cart="source-cart-v1"'));assert.ok(cartHtml.indexOf('data-native-cart=')<cartHtml.indexOf('src="/__pilot__/guard.js"'));
 response=await checkoutPageResponse(new Request(checkoutUrl,{headers:{'cf-connecting-ip':'203.0.113.14'}}),bindings,scope,loadPage);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/cart/');assert.equal(pageLoads,0);
 response=await checkoutPageResponse(new Request(checkoutUrl,{headers:{cookie,'cf-connecting-ip':'203.0.113.15'}}),bindings,scope,loadPage);assert.equal(response.status,200);assert.equal(pageLoads,1);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.match(response.headers.get('x-robots-tag'),/noindex/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('referrer-policy'),'no-referrer');const checkoutHtml=await response.text();assert.ok(checkoutHtml.includes('data-native-checkout="source-checkout-v1"'));assert.ok(checkoutHtml.includes('<title>פרטי הרשמה | דרך התקומה</title>'));assert.ok(checkoutHtml.includes('content="noindex,nofollow,noarchive"'));assert.ok(!checkoutHtml.includes('data-native-cart='),'checkout cannot mount duplicate cart owner');
 for(const tag of ['header','footer']){const pattern=new RegExp('<'+tag+'\\b[\\s\\S]*?</'+tag+'>','gi');assert.deepEqual(checkoutHtml.match(pattern),shell.match(pattern),'source '+tag+' retained exactly');}
 for(const suffix of ['?enable=true','#fake'])assert.equal(await checkoutPageResponse(new Request(checkoutUrl+suffix),bindings,scope,loadPage),null);
 assert.equal(await checkoutPageResponse(new Request(checkoutUrl,{method:'POST'}),bindings,scope,loadPage),null);
 assert.equal(sql.prepare("SELECT count(*) AS n FROM cms_settings WHERE key LIKE 'cart_payment:%'").get().n,0,'public shell reads do not create payment orders');

 // Existing failed catalog creation consumed one new-cart slot; only three more can be created.
 for(let i=0;i<3;i++){response=await cartRuntimeRequest(post({operation:'create'}),bindings,scope);assert.equal(response.status,201);}
 response=await cartRuntimeRequest(post({operation:'create'}),bindings,scope);assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');
 for(const row of sql.prepare('SELECT bucket_key FROM contact_rate_limits').all())assert.match(row.bucket_key,/^[a-f0-9]{64}$/,'technical counters contain hashes only');
 console.log('PASS actual SQLite cart HTTP/runtime: disabled/production/scope gates, private server catalog, secure guest ownership, exact price authority, bounded session quota and hashed transient counters; zero provider I/O');
}finally{Date.now=originalNow;sql.close();}
