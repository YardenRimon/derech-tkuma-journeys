/** Pure guest-cart rules. Catalog, stock/holds, policy and reviewed quote are
 * server-owned inputs; this module performs no provider, clock or storage I/O.
 * A persistence adapter must authenticate the guest cart and reserve with CAS
 * against every catalog/price/inventory revision in the quote before charging.
 */
export class CartError extends Error {
 status:number;code:string;
 constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
}
export type Wallet='credit'|'bit'|'apple'|'google'|'paybox';
export type CartLine=Readonly<{productId:string;quantity:number}>;
export type GuestCart=Readonly<{schema:1;revision:number;createdAt:number;updatedAt:number;expiresAt:number;lines:readonly CartLine[]}>;
export type Product=Readonly<{
 id:string;kind:'event'|'physical';title:string;status:'published'|'archived';purchasable:boolean;
 currency:'ILS';unitPriceMinor:number;revision:number;priceRevision:number;sourceHash:string;
 /** A label/date is display metadata, never an invented booking-time gate. */
 eventDate?:string;
 inventory:Readonly<{revision:number;manageStock:boolean;stockQuantity:number|null;reservedQuantity:number;backorders:'yes'|'no';soldIndividually:boolean}>;
}>;
export type Catalog=Readonly<{revision:number;products:readonly Product[]}>;
export type CartPolicy=Readonly<{
 sourcePolicyHash:string;legalHash:string;currency:'ILS';taxesEnabled:false;shippingEnabled:false;couponsEnabled:false;
 walletCapabilities:readonly Wallet[];
}>;
export type QuoteLine=Readonly<{
 productId:string;kind:Product['kind'];title:string;quantity:number;unitPriceMinor:number;lineTotalMinor:number;
 productRevision:number;priceRevision:number;sourceHash:string;inventoryRevision:number;
 manageStock:boolean;backorders:'yes'|'no';soldIndividually:boolean;availableStock:number|null;
}>;
export type CartQuote=Readonly<{
 schema:1;cartRevision:number;cartExpiresAt:number;catalogRevision:number;sourcePolicyHash:string;legalHash:string;
 currency:'ILS';lineItems:readonly QuoteLine[];subtotalMinor:number;taxMinor:0;shippingMinor:0;discountMinor:0;totalMinor:number;
 walletCapabilities:readonly Wallet[];
}>;
export type Buyer=Readonly<{firstName:string;lastName:string;email:string;phone:string}>;
export type CartChange=
 |{operation:'add'|'set';productId:string;quantity:number;expectedRevision:number}
 |{operation:'remove';productId:string;expectedRevision:number}
 |{operation:'clear';expectedRevision:number};
const wallets:readonly Wallet[]=['credit','bit','apple','google','paybox'];
function requireCart(condition:unknown,code:string,status=400):asserts condition{if(!condition)throw new CartError(status,code);}
const object=(value:unknown):{[key:string]:unknown}=>{requireCart(value&&typeof value==='object'&&!Array.isArray(value),'invalid_object');return value as {[key:string]:unknown};};
const exact=(value:unknown,keys:readonly string[])=>{const row=object(value);requireCart(Object.keys(row).sort().join(',')===[...keys].sort().join(','),'unexpected_fields');return row;};
const integer=(value:unknown,min=0):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!!value.trim()&&!/[\u0000-\u001f\u007f<>]/.test(value);
const safeMoney=(value:bigint)=>{requireCart(value>=BigInt(0)&&value<=BigInt(Number.MAX_SAFE_INTEGER),'money_overflow',409);return Number(value);};
function validatePolicy(policy:CartPolicy){
 requireCart(hash(policy.sourcePolicyHash)&&hash(policy.legalHash)&&policy.currency==='ILS'&&policy.taxesEnabled===false&&policy.shippingEnabled===false&&policy.couponsEnabled===false,'invalid_source_policy',503);
 requireCart(Array.isArray(policy.walletCapabilities)&&new Set(policy.walletCapabilities).size===policy.walletCapabilities.length&&policy.walletCapabilities.every(wallet=>wallets.includes(wallet)),'invalid_wallet_capabilities',503);
}
function validateCart(cart:GuestCart,now:number){
 requireCart(integer(now)&&cart?.schema===1&&integer(cart.revision)&&integer(cart.createdAt)&&integer(cart.updatedAt)&&integer(cart.expiresAt)&&cart.createdAt<=cart.updatedAt&&cart.updatedAt<=now&&cart.expiresAt>cart.createdAt,'invalid_cart_state',409);
 requireCart(now<cart.expiresAt,'cart_expired',409);
 requireCart(Array.isArray(cart.lines)&&new Set(cart.lines.map(line=>line.productId)).size===cart.lines.length&&cart.lines.every(line=>identifier(line.productId)&&integer(line.quantity,1)),'invalid_cart_state',409);
}
function productMap(catalog:Catalog){
 requireCart(integer(catalog.revision)&&Array.isArray(catalog.products),'invalid_catalog',503);
 const result=new Map<string,Product>();
 for(const product of catalog.products){
  requireCart(identifier(product.id)&&!result.has(product.id)&&['event','physical'].includes(product.kind)&&plain(product.title,500)&&['published','archived'].includes(product.status)&&typeof product.purchasable==='boolean'&&product.currency==='ILS'&&integer(product.unitPriceMinor)&&integer(product.revision,1)&&integer(product.priceRevision,1)&&hash(product.sourceHash),'invalid_catalog_product',503);
  const stock=product.inventory;
  requireCart(stock&&integer(stock.revision)&&typeof stock.manageStock==='boolean'&&typeof stock.soldIndividually==='boolean'&&['yes','no'].includes(stock.backorders)&&integer(stock.reservedQuantity)&&(stock.stockQuantity===null||(typeof stock.stockQuantity==='number'&&Number.isSafeInteger(stock.stockQuantity)))&&(!stock.manageStock||stock.stockQuantity!==null),'invalid_catalog_inventory',503);
  result.set(product.id,product);
 }
 return result;
}
function resolveLine(line:CartLine,products:Map<string,Product>):QuoteLine{
 const product=products.get(line.productId);
 requireCart(product&&product.status==='published'&&product.purchasable,'product_unavailable',409);
 const stock=product.inventory;
 requireCart(!stock.soldIndividually||line.quantity===1,'sold_individually',409);
 const stockLimited=stock.manageStock&&stock.backorders==='no';
 // reservedQuantity must exclude any reservation belonging to this same cart.
 const availableStock=stockLimited?Math.max(0,stock.stockQuantity!-stock.reservedQuantity):null;
 requireCart(availableStock===null||line.quantity<=availableStock,'stock_unavailable',409);
 return {productId:product.id,kind:product.kind,title:product.title,quantity:line.quantity,unitPriceMinor:product.unitPriceMinor,lineTotalMinor:safeMoney(BigInt(product.unitPriceMinor)*BigInt(line.quantity)),productRevision:product.revision,priceRevision:product.priceRevision,sourceHash:product.sourceHash,inventoryRevision:stock.revision,manageStock:stock.manageStock,backorders:stock.backorders,soldIndividually:stock.soldIndividually,availableStock};
}
/** Expiry is explicitly supplied by the server. No implicit/sliding TTL is
 * invented here. Source Woo11.2.1 defaults guest expiration to 2 days; its
 * filters/session renewal are the later persistence adapter's responsibility. */
export function createGuestCart(now:number,ttlMs:number):GuestCart{
 requireCart(integer(now)&&integer(ttlMs,1)&&integer(now+ttlMs),'invalid_cart_expiry',503);
 return {schema:1,revision:0,createdAt:now,updatedAt:now,expiresAt:now+ttlMs,lines:[]};
}
export function parseCartChange(input:unknown):CartChange{
 const row=object(input);
 requireCart(['add','set','remove','clear'].includes(row.operation as string),'invalid_cart_operation');
 const keys=row.operation==='clear'?['operation','expectedRevision']:row.operation==='remove'?['operation','expectedRevision','productId']:['operation','expectedRevision','productId','quantity'];
 exact(input,keys);requireCart(integer(row.expectedRevision),'invalid_revision');
 if(row.operation!=='clear')requireCart(identifier(row.productId),'invalid_product_id');
 if(row.operation==='add'||row.operation==='set')requireCart(integer(row.quantity,1),'invalid_quantity');
 return row as CartChange;
}
export function changeGuestCart(cart:GuestCart,input:unknown,catalog:Catalog,now:number):GuestCart{
 validateCart(cart,now);const change=parseCartChange(input);
 requireCart(change.expectedRevision===cart.revision,'stale_cart_revision',409);
 const lines=cart.lines.map(line=>({...line}));
 if(change.operation==='clear')lines.splice(0);
 else{
  const index=lines.findIndex(line=>line.productId===change.productId);
  if(change.operation==='remove'){
   // Unknown product IDs are not a way to probe or silently accept catalog drift.
   requireCart(index>=0,'cart_line_unavailable',409);lines.splice(index,1);
  }else{
   const quantity=change.operation==='add'&&index>=0?lines[index].quantity+change.quantity:change.quantity;
   requireCart(integer(quantity,1),'quantity_overflow',409);
   if(index<0)lines.push({productId:change.productId,quantity});else lines[index]={productId:change.productId,quantity};
  }
 }
 lines.sort((a,b)=>a.productId<b.productId?-1:a.productId>b.productId?1:0);
 const products=productMap(catalog);let subtotal=BigInt(0);
 for(const line of lines)subtotal+=BigInt(resolveLine(line,products).lineTotalMinor);
 safeMoney(subtotal);
 if(canonicalCartValue(lines)===canonicalCartValue(cart.lines))return structuredClone(cart);
 requireCart(integer(cart.revision+1),'revision_overflow',409);
 return {...cart,revision:cart.revision+1,updatedAt:now,lines};
}
/** Deterministic, exact server quote. No visitor-supplied money, currency,
 * inventory, scope, booking date or capacity participates in this calculation. */
export function quoteGuestCart(cart:GuestCart,catalog:Catalog,policy:CartPolicy,now:number):CartQuote{
 validateCart(cart,now);validatePolicy(policy);const products=productMap(catalog);
 const lineItems=[...cart.lines].sort((a,b)=>a.productId<b.productId?-1:a.productId>b.productId?1:0).map(line=>resolveLine(line,products));
 const subtotalMinor=safeMoney(lineItems.reduce((total,line)=>total+BigInt(line.lineTotalMinor),BigInt(0)));
 return {schema:1,cartRevision:cart.revision,cartExpiresAt:cart.expiresAt,catalogRevision:catalog.revision,sourcePolicyHash:policy.sourcePolicyHash,legalHash:policy.legalHash,currency:'ILS',lineItems,subtotalMinor,taxMinor:0,shippingMinor:0,discountMinor:0,totalMinor:subtotalMinor,walletCapabilities:[...policy.walletCapabilities].sort()};
}
export function canonicalCartValue(value:unknown):string{
 return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}
/** reviewed must come from a server-authenticated quote/receipt, never raw
 * visitor JSON. The later adapter must repeat this check and revision CAS in
 * the same atomic reservation as stock holds; a pure quote reserves nothing. */
export function assertCartQuoteCurrent(reviewed:CartQuote,current:CartQuote){
 requireCart(canonicalCartValue(reviewed)===canonicalCartValue(current),'stale_cart_quote',409);
}
export function validateGuestBuyer(input:unknown):Buyer{
 const row=exact(input,['firstName','lastName','email','phone']);
 requireCart(plain(row.firstName,160)&&plain(row.lastName,160),'buyer_name_required');
 requireCart(typeof row.email==='string'&&row.email.trim().length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row.email.trim()),'buyer_email_required');
 // Woo WC_Validation::is_phone_format permits whitespace, #, digits, _, -, +,
 // slash, parentheses and dot. It does not impose a mobile-only prefix.
 requireCart(typeof row.phone==='string'&&!!row.phone.trim()&&row.phone.length<=100&&!/[^\s#0-9_\-+\/().]/.test(row.phone)&&!/[\u0000-\u001f\u007f]/.test(row.phone),'buyer_phone_required');
 return {firstName:(row.firstName as string).trim(),lastName:(row.lastName as string).trim(),email:(row.email as string).trim(),phone:(row.phone as string).trim()};
}
export function prepareGuestCheckout(cart:GuestCart,input:unknown,catalog:Catalog,policy:CartPolicy,reviewedQuote:CartQuote,now:number){
 const row=exact(input,['expectedRevision','buyer','termsAccepted','legalHash','wallet']);
 requireCart(integer(row.expectedRevision)&&row.expectedRevision===cart.revision,'stale_cart_revision',409);
 const quote=quoteGuestCart(cart,catalog,policy,now);requireCart(quote.lineItems.length>0,'cart_empty',409);
 assertCartQuoteCurrent(reviewedQuote,quote);
 const buyer=validateGuestBuyer(row.buyer);requireCart(row.termsAccepted===true,'terms_acceptance_required');
 requireCart(hash(row.legalHash)&&row.legalHash===policy.legalHash,'legal_text_changed',409);
 requireCart(typeof row.wallet==='string'&&wallets.includes(row.wallet as Wallet)&&policy.walletCapabilities.includes(row.wallet as Wallet),'wallet_unavailable',409);
 return {buyer,terms:{accepted:true as const,legalHash:policy.legalHash},wallet:row.wallet as Wallet,quote};
}
