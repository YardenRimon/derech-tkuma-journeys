/** Isolated order/effect persistence in existing settings; no source writes or schema migration. */
import {D1Collections} from './collection-d1';
import {paymentScope,paymentRequire,paymentCanonical,type Order,type PaymentEffect,type PaymentStore} from './payment-core';
import type {Scope} from './collection-core';
const orderKey=(scope:Scope,id:string)=>{paymentRequire(/^[a-f0-9]{64}$/.test(id),'payment_order_id_invalid');return'payment_order:'+paymentScope(scope)+id;};
export class D1Payments implements PaymentStore{
 readonly collections:D1Collections;constructor(readonly db:D1Database){this.collections=new D1Collections(db);}
 source(scope:Scope,kind:'tour'|'occurrence',id:string){paymentScope(scope);return this.collections.get(scope,kind,id);}
 async get(scope:Scope,id:string){const row=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(orderKey(scope,id)).first<{value:string}>();if(!row)return null;const value=JSON.parse(row.value) as Order;paymentRequire(value.tenantId===scope.tenantId&&value.siteId===scope.siteId&&value.id===id&&value.schema===1,'payment_stored_scope_conflict',409);return value;}
 async commit(previous:Order|null,next:Order,effect?:PaymentEffect){
  paymentRequire(next.revision===(previous?.revision??0)+1&&(!previous||previous.id===next.id&&previous.tenantId===next.tenantId&&previous.siteId===next.siteId),'payment_revision_invalid',409);
  paymentRequire((next.state==='paid_verified'&&previous?.state!=='paid_verified')===Boolean(effect),'payment_effect_required',409);
  if(previous?.state==='paid_verified')paymentRequire(next.state==='paid_verified'&&paymentCanonical(next.transaction)===paymentCanonical(previous.transaction),'payment_verified_transaction_immutable',409);
  if(previous)paymentRequire(paymentCanonical({requestHash:previous.requestHash,buyerHash:previous.buyerHash,quote:previous.quote,configHash:previous.configHash,environment:previous.environment,createdAt:previous.createdAt})===paymentCanonical({requestHash:next.requestHash,buyerHash:next.buyerHash,quote:next.quote,configHash:next.configHash,environment:next.environment,createdAt:next.createdAt}),'payment_order_snapshot_immutable',409);
  const key=orderKey(next,next.id),value=JSON.stringify(next),transactionKey=effect?'payment_transaction:'+paymentScope(next)+next.environment+':'+effect.transactionId:null;
  if(effect)paymentRequire(next.state==='paid_verified'&&next.transaction?.transactionId===effect.transactionId&&effect.orderId===next.id&&effect.tenantId===next.tenantId&&effect.siteId===next.siteId&&effect.amountMinor===next.quote.amountMinor&&effect.currency===next.quote.currency&&effect.noFulfillment===true,'payment_effect_conflict',409);
  const sourceGuard=next.state==='creating'?" AND EXISTS (SELECT 1 FROM cms_records WHERE tenant_id=? AND site_id=? AND kind='tour' AND id=? AND revision=? AND published_version=? AND published_json IS NOT NULL) AND EXISTS (SELECT 1 FROM cms_records WHERE tenant_id=? AND site_id=? AND kind='occurrence' AND id=? AND revision=? AND published_version=? AND published_json IS NOT NULL)":'';
  const sourceArgs=next.state==='creating'?[next.tenantId,next.siteId,next.quote.tourId,next.quote.tourRevision,next.quote.tourVersion,next.tenantId,next.siteId,next.quote.occurrenceId,next.quote.occurrenceRevision,next.quote.occurrenceVersion]:[];
  const orderPrefix='payment_order:'+paymentScope(next),capacityGuard=next.state==='creating'?" AND (SELECT COALESCE(SUM(CAST(json_extract(value,'$.quote.quantity') AS INTEGER)),0) FROM cms_settings WHERE key>=? AND key<? AND json_extract(value,'$.quote.occurrenceId')=? AND json_extract(value,'$.state') IN ('creating','checkout_ready','uncertain','paid_verified'))+?<=?":'',capacityArgs=next.state==='creating'?[orderPrefix,orderPrefix+'\uffff',next.quote.occurrenceId,next.quote.quantity,next.quote.capacity]:[];
  const transactionGuard=(transactionKey?' AND NOT EXISTS (SELECT 1 FROM cms_settings WHERE key=?)':'')+sourceGuard+capacityGuard,args=transactionKey?[transactionKey,...sourceArgs,...capacityArgs]:[...sourceArgs,...capacityArgs];
  const write=previous?this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=?'+transactionGuard).bind(value,key,JSON.stringify(previous),...args):this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) VALUES(?,?)').bind(key,value),statements=[write];
  if(effect){const guard='EXISTS (SELECT 1 FROM cms_settings WHERE key=? AND value=?)';statements.push(this.db.prepare('INSERT INTO cms_settings(key,value) SELECT ?,? WHERE '+guard).bind(transactionKey,next.id,key,value),this.db.prepare('INSERT INTO cms_settings(key,value) SELECT ?,? WHERE '+guard).bind('payment_effect:'+paymentScope(next)+effect.key,JSON.stringify(effect),key,value));}
  const result=await this.db.batch(statements);paymentRequire(result[0].meta.changes===1,'payment_concurrent_or_transaction_conflict',409);
 }
}
