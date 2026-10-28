/** Pure source quote arithmetic; no database, HTTP server or provider. */
import assert from 'node:assert/strict';
import {QUOTE_CATALOG_VERSION,QUOTE_CATALOG,QUOTE_SOURCE_RULES,QuoteError,defaultQuoteSelection,validateQuoteSelection,calculateQuote} from '../lib/quote-core.ts';
const selection=(ids,pax=40)=>({catalogVersion:QUOTE_CATALOG_VERSION,selectedServiceIds:ids,participantCount:pax});
const invalid=value=>assert.throws(()=>calculateQuote(value),error=>error instanceof QuoteError&&error.status===400);
// Independent expected source ID/rate table catches dropped/repriced services.
const expected=[[1,190000,'fixed'],[13,230000,'fixed'],[14,240000,'fixed'],[2,160000,'fixed'],[3,420000,'fixed'],[4,490000,'fixed'],[5,140000,'fixed'],[6,600000,'fixed'],[7,2600,'pax'],[8,6500,'pax'],[9,9500,'pax'],[10,11000,'pax'],[11,11500,'pax'],[15,5300,'pax'],[16,2900,'pax'],[12,10000,'fixed']];
assert.deepEqual(QUOTE_CATALOG.map(service=>[service.id,service.unitPriceMinor,service.priceKind]),expected);
assert.equal(QUOTE_CATALOG.length,16);assert.equal(new Set(QUOTE_CATALOG.map(service=>service.id)).size,16);
assert.ok(Object.isFrozen(QUOTE_CATALOG));assert.ok(QUOTE_CATALOG.every(Object.isFrozen));
const initial=calculateQuote();assert.equal(initial.participantCount,40);assert.deepEqual(initial.selectedServiceIds,[1]);assert.equal(initial.currency,'ILS');assert.equal(initial.totalMinor,190000);assert.equal(initial.displayTotalIls,1900);assert.equal(initial.displayPerParticipantIls,48);assert.equal(initial.selectedServiceCount,1);assert.match(initial.orderSummary,/סיכום הזמנה \(40 משתתפים\):/);assert.match(initial.orderSummary,/הדרכת סיור עומק עד 40 משתתפים/);
const defaults=defaultQuoteSelection();defaults.selectedServiceIds.push(13);assert.deepEqual(defaultQuoteSelection().selectedServiceIds,[1],'defaults are not shared mutable state');
for(const [id,price,kind] of expected)for(const pax of [1,40,61]){
 const result=calculateQuote(selection([id],pax));assert.equal(result.totalMinor,price*(kind==='pax'?pax:1));assert.equal(result.lines[0].quantity,kind==='pax'?pax:1);assert.equal(result.lines[0].unitPriceMinor,price);
}
const bases=calculateQuote(selection([14,1,13],75));assert.equal(bases.totalMinor,660000,'multiple base checkboxes are independent, including above advertised capacities');assert.deepEqual(bases.selectedServiceIds,[1,13,14]);assert.deepEqual(bases,calculateQuote(selection([1,13,14],75)),'request order cannot change canonical quote identity');
assert.equal(calculateQuote(selection([16],1)).totalMinor,2900,'source falafel minimum20 is a label, not an enforced rule');
const empty=calculateQuote(selection([],1));assert.equal(empty.totalMinor,0);assert.equal(empty.displayPerParticipantIls,0);assert.deepEqual(empty.lines,[]);assert.deepEqual(empty.categorySubtotals,[]);
const meal=calculateQuote(selection([1,7]));assert.equal(meal.totalMinor,294000);assert.equal(meal.displayPerParticipantIls,74,'positive half rounds up like source Math.round');assert.deepEqual(meal.categorySubtotals,[{category:'בסיס',totalMinor:190000},{category:'אירוח',totalMinor:104000}]);
const all=calculateQuote(selection(expected.map(([id])=>id)));assert.equal(all.totalMinor,4452000);assert.equal(all.selectedServiceCount,16);assert.equal(all.categorySubtotals.reduce((sum,row)=>sum+row.totalMinor,0),all.totalMinor);
for(const value of [0,-1,-0,1.5,'40',NaN,Infinity,null,true,Number.MAX_SAFE_INTEGER+1,40n])invalid(selection([1],value));
for(const ids of [[0],[17],[-1],['1'],[1.5],[1,1],null,{},Array(17).fill(1)])invalid(selection(ids));
for(const value of [null,[],{},{...selection([1]),catalogVersion:'outdated'}])invalid(value);
for(const [key,value] of Object.entries({totalMinor:1,total_price:1,order_summary:'forged',currency:'USD',unitPrices:{1:1},postId:'5982'}))invalid({...selection([1]),[key]:value});
assert.throws(()=>validateQuoteSelection({...selection([1]),catalogVersion:'old'}),error=>error.code==='quote_catalog_mismatch');
const max=Number.MAX_SAFE_INTEGER,quantity=Math.floor(max/2600);assert.equal(calculateQuote(selection([7],quantity)).totalMinor,Number(BigInt(quantity)*2600n));
assert.throws(()=>calculateQuote(selection([7],quantity+1)),error=>error.code==='quote_total_overflow');
const combined=Math.floor(max/5500)+1;assert.throws(()=>calculateQuote(selection([7,16],combined)),error=>error.code==='quote_total_overflow','safe individual lines can still overflow aggregate');
assert.equal(calculateQuote(selection([1],max)).totalMinor,190000,'safe participant integers have no invented business maximum for fixed services');
assert.equal(QUOTE_SOURCE_RULES.signatureRequired,false);assert.equal(QUOTE_SOURCE_RULES.pdfActive,false);assert.equal(QUOTE_SOURCE_RULES.taxStatusIndependentlyVerified,false);
console.log('PASS pure quote source catalogue16/default40+service1/190000minor, fixed+pax/category arithmetic, independent bases/empty selection/label-only limits, half rounding, strict browser input/price rejection, integer and aggregate overflow, immutable catalogue; no storage/network/provider activation.');
