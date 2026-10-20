/** Hook for the already signed/scoped execution gateway. No new endpoint,
 * credential, scheduling mechanism, provider delivery or customer message. */
import {Contacts,contactScope,type ContactScope} from './contact-core';
import {D1Contacts} from './contact-d1';
import {R2ContactPrivacy} from './contact-privacy';
import {contactRetentionDays} from './contact-controls';
export async function maintainContacts(db:D1Database,bucket:R2Bucket|undefined,scope:ContactScope,config:{CONTACT_RETENTION_DAYS?:string;CONTACT_PRIVACY_AUTHORITY_ID?:string},now=new Date()){
 if(config.CONTACT_RETENTION_DAYS===undefined)return{state:'disabled' as const};
 contactScope(scope);const service=new Contacts(new D1Contacts(db),contactRetentionDays(config),new R2ContactPrivacy(bucket,config.CONTACT_PRIVACY_AUTHORITY_ID));
 const key=`contact-maintenance:v1:${scope.tenantId}:${scope.siteId}`;
 const row=await db.prepare('SELECT value FROM cms_settings WHERE key=?').bind(key).first<{value:string}>();
 const cursor=row?JSON.parse(row.value) as {after:string|null}:null;
 const reconciled=await service.reconcile(scope,2,cursor?.after??null,now);
 const expired=await service.expire(scope,2,now);
 await db.prepare('INSERT INTO cms_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  .bind(key,JSON.stringify({after:reconciled.nextCursor,at:now.toISOString()})).run();
 return{state:'complete' as const,reconciled,expired};
}

/** Explicit restore gate. Start with after=null, then repeat the returned
 * cursor until ready before enabling any restored contact intake/delivery. */
export async function reconcileContactRestore(db:D1Database,bucket:R2Bucket|undefined,scope:ContactScope,config:{CONTACT_RETENTION_DAYS?:string;CONTACT_PRIVACY_AUTHORITY_ID?:string},after:string|null=null,now=new Date()){
 const service=new Contacts(new D1Contacts(db),contactRetentionDays(config),new R2ContactPrivacy(bucket,config.CONTACT_PRIVACY_AUTHORITY_ID));
 const result=await service.reconcile(scope,2,after,now);
 return{state:result.nextCursor===null?'ready' as const:'pending' as const,...result};
}
