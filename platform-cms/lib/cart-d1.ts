import {CartError,createGuestCart,changeGuestCart,quoteGuestCart,assertCartQuoteCurrent,prepareGuestCheckout,canonicalCartValue,type GuestCart,type CartQuote,type CartPolicy,type Catalog,type Product,type Wallet} from './cart-core';

/** Internal server adapter. Never deserialize a catalog, owner, scope or approval
 * from a visitor body. HTTP must derive scope from bindings and guestOwner from
 * a secure opaque cookie; redact internal quotes/catalog before public output.
 */
export type CartScope=Readonly<{tenantId:string;siteId:string}>;
type Stock=Readonly<{manageStock:boolean;stockQuantity:number|null;backorders:'yes'|'no';soldIndividually:boolean}>;
type CommonProduct=Readonly<{id:string;status:'published'|'archived';purchasable:boolean;sourceHash:string;inventory:Stock}>;
export type PrivateProduct=CommonProduct & (
 |Readonly<{kind:'event';occurrenceId:string}>
 |Readonly<{kind:'physical';title:string;unitPriceMinor:number;currency:'ILS'}>
);
export type PrivateCatalog=Readonly<{schema:1;sourceCapture:Readonly<{id:string;sha256:string}>;legalHash:string;walletCapabilities:readonly Wallet[];products:readonly PrivateProduct[]}>;
type PolicyDocument={schema:1;scope:CartScope;revision:number;definition:PrivateCatalog;updatedAt:number;attemptNonce:string};
type Reservation={id:string;orderNonce:string;quoteId:string;quoteHash:string;checkoutHash:string;quote:CartQuote;expiresAt:number;state:'held'|'released'|'settled';releasedAt?:number;paymentOrderId?:string};
type StoredCart={schema:1;scope:CartScope;id:string;ownerId:string;storageRevision:number;cart:GuestCart;attemptNonce:string;review?:{id:string;quote:CartQuote};reservation?:Reservation;paymentLatch?:{orderId:string;state:'creating'|'uncertain'|'checkout_ready'|'paid_verified'}};
type Hold={ownerId:string;reservationId:string;orderNonce:string;expiresAt:number;quantities:{[productId:string]:number};latched?:true;paymentOrderId?:string};
type Ledger={schema:1;scope:CartScope;revision:number;holds:{[cartId:string]:Hold}};
type SourceRow={kind:string;id:string;published_json:string|null;published_version:number;revision:number};
type Snapshot={policy:PolicyDocument;policyRaw:string;ledger:Ledger;ledgerRaw:string;stored:StoredCart|null;cartRaw:string|null;sources:SourceRow[]};
type Options={cartTtlMs:number;holdTtlMs:number;clock?:()=>number;uuid?:()=>string;/** Server-installed authorization closure, e.g. authorizeCmsUser('users'). Default is deny; never an HTTP role flag. */authorizeCatalogWrite?:()=>Promise<void>};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const hashPattern=/^[a-f0-9]{64}$/;
function need(value:unknown,code:string,status=400):asserts value{if(!value)throw new CartError(status,code);}
const integer=(value:unknown,min=0):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
const exact=(value:unknown,keys:string[])=>{need(value&&typeof value==='object'&&!Array.isArray(value),'invalid_fields');const row=value as {[key:string]:unknown};need(Object.keys(row).sort().join(',')===[...keys].sort().join(','),'unexpected_fields');return row;};
const sameScope=(a:CartScope,b:CartScope)=>a?.tenantId===b.tenantId&&a?.siteId===b.siteId;
const digest=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalCartValue(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function privateDefinition(input:unknown):PrivateCatalog{
 const row=exact(input,['schema','sourceCapture','legalHash','walletCapabilities','products']),capture=exact(row.sourceCapture,['id','sha256']);
 need(row.schema===1&&typeof capture.id==='string'&&capture.id.length>0&&capture.id.length<=160&&hashPattern.test(String(capture.sha256))&&hashPattern.test(String(row.legalHash)),'invalid_private_catalog');
 const allowed:Wallet[]=['credit','bit','apple','google','paybox'];
 need(Array.isArray(row.walletCapabilities)&&new Set(row.walletCapabilities).size===row.walletCapabilities.length&&row.walletCapabilities.every(wallet=>allowed.includes(wallet as Wallet))&&Array.isArray(row.products),'invalid_private_catalog');
 const ids=new Set<string>();for(const raw of row.products){const product=raw as PrivateProduct;exact(raw,['id','kind','status','purchasable','sourceHash','inventory',...(product.kind==='event'?['occurrenceId']:['title','unitPriceMinor','currency'])]);
  need(idPattern.test(product.id)&&!ids.has(product.id)&&['event','physical'].includes(product.kind)&&['published','archived'].includes(product.status)&&typeof product.purchasable==='boolean'&&hashPattern.test(product.sourceHash),'invalid_private_product');ids.add(product.id);
  const stock=exact(product.inventory,['manageStock','stockQuantity','backorders','soldIndividually']);need(typeof stock.manageStock==='boolean'&&typeof stock.soldIndividually==='boolean'&&['yes','no'].includes(String(stock.backorders))&&(stock.stockQuantity===null||(typeof stock.stockQuantity==='number'&&Number.isSafeInteger(stock.stockQuantity)))&&(!stock.manageStock||stock.stockQuantity!==null),'invalid_private_inventory');
  if(product.kind==='event')need(idPattern.test(product.occurrenceId),'invalid_occurrence_authority');else need(typeof product.title==='string'&&!!product.title.trim()&&product.title.length<=500&&integer(product.unitPriceMinor)&&product.currency==='ILS','invalid_physical_price');
 }
 return structuredClone(input) as PrivateCatalog;
}
export class D1GuestCarts{
 readonly db:D1Database;readonly scope:CartScope;readonly options:Options;readonly clock:()=>number;readonly random:()=>string;
 constructor(db:D1Database,scope:CartScope,options:Options){need(idPattern.test(scope.tenantId)&&idPattern.test(scope.siteId),'invalid_cart_scope',503);need(integer(options.cartTtlMs,1)&&integer(options.holdTtlMs,1),'invalid_cart_ttl',503);this.db=db;this.scope=Object.freeze({...scope});this.options=options;this.clock=options.clock??Date.now;this.random=options.uuid??(()=>crypto.randomUUID());}
 private now(){const now=this.clock();need(integer(now),'invalid_clock',503);return now;}
 private nonce(){const value=this.random();need(uuidPattern.test(value),'invalid_server_nonce',503);return value;}
 private prefix(){return 'guest_cart:v1:'+this.scope.tenantId+':'+this.scope.siteId;}
 private policyKey(){return this.prefix()+':catalog';}
 private ledgerKey(){return this.prefix()+':holds';}
 private cartKey(id:string){need(uuidPattern.test(id),'invalid_cart_id');return this.prefix()+':cart:'+id;}
 private async isolated(){const row=await this.db.prepare('SELECT tenant_id,site_id FROM cms_deployment_scope WHERE singleton=1').first<{tenant_id:string;site_id:string}>();need(row&&row.tenant_id===this.scope.tenantId&&row.site_id===this.scope.siteId,'cart_scope_mismatch',403);}
 private emptyLedger():Ledger{return {schema:1,scope:this.scope,revision:0,holds:{}};}
 async setPrivateCatalog(input:unknown,expectedRevision:number){
  need(this.options.authorizeCatalogWrite,'catalog_write_not_authorized',403);await this.options.authorizeCatalogWrite();await this.isolated();need(integer(expectedRevision),'invalid_revision');const definition=privateDefinition(input);
  const row=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.policyKey()).first<{value:string}>(),previous=row?JSON.parse(row.value) as PolicyDocument:null,ledgerRow=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.ledgerKey()).first<{value:string}>();
  if(ledgerRow){const ledger=JSON.parse(ledgerRow.value) as Ledger;need(sameScope(ledger.scope,this.scope),'cart_scope_mismatch',403);for(const hold of Object.values(ledger.holds))if(hold.latched)for(const id of Object.keys(hold.quantities)){const before=previous?.definition.products.find(product=>product.id===id),after=definition.products.find(product=>product.id===id);need(before&&after&&before.kind===after.kind&&before.inventory.manageStock===after.inventory.manageStock&&before.inventory.backorders===after.inventory.backorders&&before.inventory.soldIndividually===after.inventory.soldIndividually&&(before.kind!=='event'||after.kind==='event'&&before.occurrenceId===after.occurrenceId),'latched_payment_inventory_locked',409);}}
  need((previous?.revision??0)===expectedRevision,'stale_catalog_revision',409);if(previous){need(sameScope(previous.scope,this.scope),'cart_scope_mismatch',403);need(canonicalCartValue(previous.definition.sourceCapture)===canonicalCartValue(definition.sourceCapture),'source_capture_change_requires_reviewed_import',409);if(canonicalCartValue(previous.definition)===canonicalCartValue(definition))return previous.revision;}
  const next:PolicyDocument={schema:1,scope:this.scope,revision:expectedRevision+1,definition,updatedAt:this.now(),attemptNonce:this.nonce()};need(integer(next.revision,1),'revision_overflow',409);const serialized=canonicalCartValue(next);
  const ledgerGuard=ledgerRow?' AND EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)':' AND NOT EXISTS(SELECT 1 FROM cms_settings WHERE key=?)',ledgerArgs=ledgerRow?[this.ledgerKey(),ledgerRow.value]:[this.ledgerKey()];
  const write=row?this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=?'+ledgerGuard).bind(serialized,this.policyKey(),row.value,...ledgerArgs):this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) SELECT ?,? WHERE '+(ledgerRow?'EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)':'NOT EXISTS(SELECT 1 FROM cms_settings WHERE key=?)')).bind(this.policyKey(),serialized,...ledgerArgs);
  const results=await this.db.batch([write,this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)').bind(this.ledgerKey(),canonicalCartValue(this.emptyLedger()),this.policyKey(),serialized)]);need(results[0].meta.changes===1,'stale_catalog_revision',409);return next.revision;
 }
 private async snapshot(ownerId?:string,cartId?:string):Promise<Snapshot>{
  await this.isolated();if(ownerId!==undefined)need(uuidPattern.test(ownerId),'invalid_guest_owner');
  const commands=[this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.policyKey()),this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.ledgerKey()),cartId===undefined?this.db.prepare('SELECT value FROM cms_settings WHERE 0'):this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.cartKey(cartId)),this.db.prepare("SELECT kind,id,published_json,published_version,revision FROM cms_records WHERE tenant_id=? AND site_id=? AND kind IN ('tour','occurrence')").bind(this.scope.tenantId,this.scope.siteId)];
  const results=await this.db.batch(commands);need(results.every(row=>row.success),'cart_snapshot_unavailable',503);
  const policyRaw=(results[0].results[0] as {value:string}|undefined)?.value,ledgerRaw=(results[1].results[0] as {value:string}|undefined)?.value,cartRaw=(results[2].results[0] as {value:string}|undefined)?.value??null;
  need(policyRaw&&ledgerRaw,'private_catalog_unavailable',503);const policy=JSON.parse(policyRaw) as PolicyDocument,ledger=JSON.parse(ledgerRaw) as Ledger;
  need(policy.schema===1&&integer(policy.revision,1)&&ledger.schema===1&&integer(ledger.revision)&&sameScope(policy.scope,this.scope)&&sameScope(ledger.scope,this.scope),'cart_scope_mismatch',403);privateDefinition(policy.definition);
  const stored=cartRaw?JSON.parse(cartRaw) as StoredCart:null;
  if(cartId!==undefined){need(stored&&stored.schema===1&&sameScope(stored.scope,this.scope)&&stored.id===cartId&&stored.ownerId===ownerId,'cart_not_found',404);need(stored.cart.expiresAt>this.now(),'cart_expired',410);}
  return {policy,policyRaw,ledger,ledgerRaw,stored,cartRaw,sources:results[3].results as SourceRow[]};
 }
 private async resolve(snapshot:Snapshot,cartId?:string){
  const products:Product[]=[],guards=new Map<string,SourceRow[]>(),now=this.now();
  for(const item of snapshot.policy.definition.products){
   let unitPriceMinor:number,priceRevision:number,revision:number,title:string,eventDate:string|undefined,sourceRows:SourceRow[]=[];
   if(item.kind==='event'){
    const row=snapshot.sources.find(row=>row.kind==='occurrence'&&row.id===item.occurrenceId);if(!row?.published_json)continue;const occurrence=JSON.parse(row.published_json);if(occurrence.currency!=='ILS'||!integer(occurrence.priceMinor))throw new CartError(503,'cms_price_authority_invalid');
    const tour=snapshot.sources.find(row=>row.kind==='tour'&&row.id===occurrence.tourId);if(!tour?.published_json)continue;const tourContent=JSON.parse(tour.published_json);title=occurrence.title||tourContent.title;unitPriceMinor=occurrence.priceMinor;priceRevision=row.published_version;revision=row.revision;eventDate=occurrence.date;sourceRows=[row,tour];
   }else{unitPriceMinor=item.unitPriceMinor;priceRevision=snapshot.policy.revision;revision=snapshot.policy.revision;title=item.title;}
   let reservedQuantity=0;for(const [heldCart,hold]of Object.entries(snapshot.ledger.holds))if(heldCart!==cartId&&(hold.latched===true||hold.expiresAt>now)){reservedQuantity+=hold.quantities[item.id]??0;need(integer(reservedQuantity),'hold_quantity_overflow',503);}
   products.push({id:item.id,kind:item.kind,title,status:item.status,purchasable:item.purchasable,currency:'ILS',unitPriceMinor,priceRevision,revision,sourceHash:await digest({capture:snapshot.policy.definition.sourceCapture,item,sources:sourceRows}),...(eventDate?{eventDate}:{}),inventory:{...item.inventory,revision:snapshot.ledger.revision,reservedQuantity}});guards.set(item.id,sourceRows);
  }
  const catalog:Catalog={revision:snapshot.policy.revision,products},policy:CartPolicy={sourcePolicyHash:await digest({scope:this.scope,revision:snapshot.policy.revision,definition:snapshot.policy.definition}),legalHash:snapshot.policy.definition.legalHash,currency:'ILS',taxesEnabled:false,shippingEnabled:false,couponsEnabled:false,walletCapabilities:snapshot.policy.definition.walletCapabilities};
  return {catalog,policy,guards};
 }
 /** Internal payment handoff; never expose these raw keys/documents to HTTP. */
 paymentKeys(cartId:string){return {cart:this.cartKey(cartId),catalog:this.policyKey(),holds:this.ledgerKey()};}
 async paymentSnapshot(guestOwner:string,cartId:string){
  const snapshot=await this.snapshot(guestOwner,cartId),stored=snapshot.stored!,reservation=stored.reservation,hold=snapshot.ledger.holds[cartId];
  need(!stored.paymentLatch,'cart_payment_locked',409);need(reservation?.state==='held'&&reservation.expiresAt>this.now()&&hold?.reservationId===reservation.id&&hold.ownerId===guestOwner&&hold.orderNonce===reservation.orderNonce,'accepted_cart_reservation_required',409);
  const resolved=await this.resolve(snapshot,cartId),current=quoteGuestCart(stored.cart,resolved.catalog,resolved.policy,this.now()),comparable={...current,lineItems:current.lineItems.map(line=>{const original=reservation.quote.lineItems.find(item=>item.productId===line.productId);return original?{...line,inventoryRevision:original.inventoryRevision,availableStock:original.availableStock}:line;})};assertCartQuoteCurrent(reservation.quote,comparable);
  return structuredClone(snapshot);
 }
 /** Internal server view, including private stock. HTTP must construct a redacted DTO. */
 async catalog(){const snapshot=await this.snapshot();return this.resolve(snapshot);}
 private async commit(snapshot:Snapshot,next:StoredCart,guards:SourceRow[],ledger?:Ledger){
  need(snapshot.stored&&snapshot.cartRaw,'cart_not_found',404);next.storageRevision=snapshot.stored.storageRevision+1;need(integer(next.storageRevision,1),'revision_overflow',409);next.attemptNonce=this.nonce();const value=canonicalCartValue(next),now=this.now();
  const predicates=['EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)','EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)'];const values:unknown[]=[value,this.cartKey(next.id),snapshot.cartRaw,next.ownerId,now,this.policyKey(),snapshot.policyRaw,this.ledgerKey(),snapshot.ledgerRaw];
  const unique=new Map(guards.map(row=>[row.kind+':'+row.id,row]));for(const row of unique.values()){predicates.push('EXISTS(SELECT 1 FROM cms_records WHERE tenant_id=? AND site_id=? AND kind=? AND id=? AND revision=? AND published_version=? AND published_json=?)');values.push(this.scope.tenantId,this.scope.siteId,row.kind,row.id,row.revision,row.published_version,row.published_json);}
  const commands=[this.db.prepare("UPDATE cms_settings SET value=? WHERE key=? AND value=? AND json_extract(value,'$.ownerId')=? AND json_extract(value,'$.cart.expiresAt')>? AND "+predicates.join(' AND ')).bind(...values)];
  if(ledger){need(integer(ledger.revision,1),'revision_overflow',409);commands.push(this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=? AND EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)').bind(canonicalCartValue(ledger),this.ledgerKey(),snapshot.ledgerRaw,this.cartKey(next.id),value));}
  const results=await this.db.batch(commands);need(results[0].meta.changes===1,'cart_concurrent_change',409);if(ledger)need(results[1].meta.changes===1,'hold_atomicity_failed',503);
 }
 private sourceGuards(lines:readonly {productId:string}[],guards:Map<string,SourceRow[]>){return lines.flatMap(line=>guards.get(line.productId)??[]);}
 /** Bounded opportunistic cleanup of anonymous carts with no accepted checkout.
  * Any reservation (including released/expired), unknown future payment field,
  * or ledger reference is retained. There is no timer or history deletion. */
 async cleanupExpired(limit=10){
  need(integer(limit,1)&&limit<=50,'invalid_cleanup_limit');await this.isolated();const now=this.now(),prefix=this.prefix()+':cart:';
  const ledgerRow=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.ledgerKey()).first<{value:string}>();if(!ledgerRow)return 0;
  const held=JSON.parse(ledgerRow.value) as Ledger;need(held.schema===1&&sameScope(held.scope,this.scope),'cart_scope_mismatch',403);
  const result=await this.db.prepare("SELECT carts.key,carts.value FROM cms_settings AS carts WHERE carts.key>=? AND carts.key<? AND CASE WHEN json_valid(carts.value) THEN json_extract(carts.value,'$.cart.expiresAt') ELSE NULL END<=? AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(carts.value) THEN carts.value ELSE '{}' END) AS fields WHERE fields.key NOT IN ('schema','scope','id','ownerId','storageRevision','cart','attemptNonce','review')) ORDER BY carts.key LIMIT ?").bind(prefix,prefix+'\uffff',now,limit).all<{key:string;value:string}>();
  let deleted=0;for(const candidate of result.results){
   let row:StoredCart;try{row=JSON.parse(candidate.value) as StoredCart;}catch{continue;}
   if(row.schema!==1||!sameScope(row.scope,this.scope)||!uuidPattern.test(row.id)||candidate.key!==this.cartKey(row.id)||!uuidPattern.test(row.ownerId)||!integer(row.storageRevision,1)||!integer(row.cart?.expiresAt)||row.cart.expiresAt>now||Object.hasOwn(row,'reservation')||Object.hasOwn(held.holds,row.id))continue;
   try{
    exact(row.cart,['schema','revision','createdAt','updatedAt','expiresAt','lines']);for(const line of row.cart.lines)exact(line,['productId','quantity']);
    if(row.review){exact(row.review,['id','quote']);exact(row.review.quote,['schema','cartRevision','cartExpiresAt','catalogRevision','sourcePolicyHash','legalHash','currency','lineItems','subtotalMinor','taxMinor','shippingMinor','discountMinor','totalMinor','walletCapabilities']);for(const line of row.review.quote.lineItems)exact(line,['productId','kind','title','quantity','unitPriceMinor','lineTotalMinor','productRevision','priceRevision','sourceHash','inventoryRevision','manageStock','backorders','soldIndividually','availableStock']);}
   }catch{continue;}
   const removed=await this.db.prepare("DELETE FROM cms_settings WHERE key=? AND value=? AND json_extract(value,'$.cart.expiresAt')<=? AND EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)").bind(candidate.key,candidate.value,now,this.ledgerKey(),ledgerRow.value).run();deleted+=removed.meta.changes??0;
  }
  return deleted;
 }
 async create(guestOwner:string){need(uuidPattern.test(guestOwner),'invalid_guest_owner');await this.cleanupExpired();const snapshot=await this.snapshot(),now=this.now(),id=this.nonce(),cart=createGuestCart(now,this.options.cartTtlMs);const stored:StoredCart={schema:1,scope:this.scope,id,ownerId:guestOwner,storageRevision:1,cart,attemptNonce:this.nonce()};
  const result=await this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?) AND EXISTS(SELECT 1 FROM cms_settings WHERE key=? AND value=?)').bind(this.cartKey(id),canonicalCartValue(stored),this.policyKey(),snapshot.policyRaw,this.ledgerKey(),snapshot.ledgerRaw).run();need(result.meta.changes===1,'cart_concurrent_change',409);return {cartId:id,cart};}
 async get(guestOwner:string,cartId:string){return structuredClone((await this.snapshot(guestOwner,cartId)).stored!.cart);}
 async change(guestOwner:string,cartId:string,input:unknown){const snapshot=await this.snapshot(guestOwner,cartId);need(!snapshot.stored!.paymentLatch,'cart_payment_locked',409);const resolved=await this.resolve(snapshot,cartId),cart=changeGuestCart(snapshot.stored!.cart,input,resolved.catalog,this.now());if(cart.revision===snapshot.stored!.cart.revision)return cart;
  const next=structuredClone(snapshot.stored!);next.cart=cart;if(next.reservation?.state==='held'){next.reservation.state='released';next.reservation.releasedAt=this.now();}const ledger=structuredClone(snapshot.ledger),hadHold=Object.hasOwn(ledger.holds,cartId);delete ledger.holds[cartId];if(hadHold)ledger.revision++;
  await this.commit(snapshot,next,this.sourceGuards(cart.lines,resolved.guards),hadHold?ledger:undefined);return cart;}
 async review(guestOwner:string,cartId:string){const snapshot=await this.snapshot(guestOwner,cartId);need(!snapshot.stored!.paymentLatch,'cart_payment_locked',409);const resolved=await this.resolve(snapshot,cartId),stored=snapshot.stored!,quote=quoteGuestCart(stored.cart,resolved.catalog,resolved.policy,this.now());
  if(stored.review){
   const reservation=stored.reservation,held=reservation?.state==='held'&&reservation.expiresAt>this.now()&&reservation.quoteId===stored.review.id&&snapshot.ledger.holds[cartId]?.reservationId===reservation.id;
   const comparable=held?{...quote,lineItems:quote.lineItems.map(line=>{const original=stored.review!.quote.lineItems.find(item=>item.productId===line.productId);return original?{...line,inventoryRevision:original.inventoryRevision,availableStock:original.availableStock}:line;})}:quote;
   if(canonicalCartValue(stored.review.quote)===canonicalCartValue(comparable))return {quoteId:stored.review.id,cart:structuredClone(stored.cart),quote:structuredClone(stored.review.quote)};
  }
  const next=structuredClone(stored);next.review={id:this.nonce(),quote};await this.commit(snapshot,next,this.sourceGuards(quote.lineItems,resolved.guards));return {quoteId:next.review.id,cart:structuredClone(stored.cart),quote};}
 async reserve(guestOwner:string,cartId:string,input:unknown,reserveNew?:()=>Promise<void>){
  const row=exact(input,['expectedRevision','quoteId','buyer','termsAccepted','legalHash','wallet']);need(uuidPattern.test(String(row.quoteId)),'invalid_quote_id');const snapshot=await this.snapshot(guestOwner,cartId);need(!snapshot.stored!.paymentLatch,'cart_payment_locked',409);const stored=snapshot.stored!,resolved=await this.resolve(snapshot,cartId);
  need(stored.review&&stored.review.id===row.quoteId,'quote_not_found',409);const reviewed=stored.review.quote,current=quoteGuestCart(stored.cart,resolved.catalog,resolved.policy,this.now());
  const existing=stored.reservation,active=existing?.state==='held'&&existing.expiresAt>this.now()&&snapshot.ledger.holds[cartId]?.reservationId===existing.id;
  // Own reservation changes the ledger version. For an idempotent retry keep
  // that token/availability evidence from the original already-reserved quote;
  // current stock availability is still checked by quoteGuestCart above.
  const compatible=active?{...current,lineItems:current.lineItems.map(line=>{const old=reviewed.lineItems.find(item=>item.productId===line.productId);return old?{...line,inventoryRevision:old.inventoryRevision,availableStock:old.availableStock}:line;})}:current;
  assertCartQuoteCurrent(reviewed,compatible);
  const acceptedCheckout=prepareGuestCheckout(stored.cart,{expectedRevision:row.expectedRevision,buyer:row.buyer,termsAccepted:row.termsAccepted,legalHash:row.legalHash,wallet:row.wallet},resolved.catalog,resolved.policy,current,this.now());
  const checkoutHash=await digest({buyer:acceptedCheckout.buyer,terms:acceptedCheckout.terms,wallet:acceptedCheckout.wallet,quoteId:row.quoteId}),quoteHash=await digest(reviewed);
  if(active&&existing.quoteHash===quoteHash&&existing.checkoutHash===checkoutHash)return {cart:structuredClone(stored.cart),reservation:structuredClone(existing),acceptedCheckout:{...acceptedCheckout,quote:reviewed}};
  need(!active,'active_checkout_differs',409);if(reserveNew)await reserveNew();const now=this.now(),expiresAt=Math.min(stored.cart.expiresAt,now+this.options.holdTtlMs);need(integer(expiresAt)&&expiresAt>now,'invalid_hold_expiry',503);
  const reservation:Reservation={id:this.nonce(),orderNonce:this.nonce(),quoteId:row.quoteId as string,quoteHash,checkoutHash,quote:reviewed,expiresAt,state:'held'};
  const next=structuredClone(stored);next.reservation=reservation;const ledger=structuredClone(snapshot.ledger);for(const [id,hold]of Object.entries(ledger.holds))if(hold.latched!==true&&hold.expiresAt<=now)delete ledger.holds[id];ledger.revision++;
  ledger.holds[cartId]={ownerId:guestOwner,reservationId:reservation.id,orderNonce:reservation.orderNonce,expiresAt,quantities:Object.fromEntries(current.lineItems.map(line=>[line.productId,line.quantity]))};
  await this.commit(snapshot,next,this.sourceGuards(current.lineItems,resolved.guards),ledger);return {cart:structuredClone(stored.cart),reservation,acceptedCheckout};
 }
}

// Internal DTOs for the atomic payment adapter; never visitor response types.
export type CartPaymentSnapshot=Snapshot;
export type CartPaymentStored=StoredCart;
export type CartPaymentLedger=Ledger;
export type CartPaymentPolicy=PolicyDocument;
export type CartPaymentSourceRow=SourceRow;
