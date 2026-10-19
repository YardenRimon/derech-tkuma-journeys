import type {ContactStore,ContactRecord,ContactScope} from './contact-core';
/** One atomic settings value contains both the lead and its outbox state.
 * No new tables/migrations; included in the existing complete settings backup. */
export class D1Contacts implements ContactStore{
 db:D1Database;
 constructor(db:D1Database){this.db=db;}
 private key(scope:ContactScope,key:string){if(![scope.tenantId,scope.siteId].every(x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(x)))throw new Error('invalid_contact_scope');if(!/^[a-f0-9-]{36}$/.test(key))throw new Error('invalid_contact_key');return `contact:v1:${scope.tenantId}:${scope.siteId}:${key}`;}
 async get(scope:ContactScope,key:string){const row=await this.db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(this.key(scope,key)).first<{value:string}>();if(!row)return null;const record=JSON.parse(row.value) as ContactRecord;if(record.schema!==1||record.key!==key||record.scope?.tenantId!==scope.tenantId||record.scope?.siteId!==scope.siteId)throw new Error('contact_record_scope');return record;}
 async insert(record:ContactRecord){const result=await this.db.prepare('INSERT OR IGNORE INTO cms_settings(key,value) VALUES(?,?)').bind(this.key(record.scope,record.key),JSON.stringify(record)).run();return result.meta.changes===1;}
 async cas(previous:ContactRecord,next:ContactRecord){if(previous.key!==next.key||previous.scope.tenantId!==next.scope.tenantId||previous.scope.siteId!==next.scope.siteId||next.revision!==previous.revision+1)throw new Error('contact_cas_scope');const result=await this.db.prepare('UPDATE cms_settings SET value=? WHERE key=? AND value=?').bind(JSON.stringify(next),this.key(previous.scope,previous.key),JSON.stringify(previous)).run();return result.meta.changes===1;}
}
