/** Pure fail-closed validation. Attestations are owner evidence, not generated
 * by this module. Review deployment validation is deliberately unchanged. */
export const productionOrigin='https://derech-tkuma.com';
export const productionAlias='https://www.derech-tkuma.com';
export const productionGates=['sourceBackupRestored','dnsAndMailAccessVerified','contentAndMobileAccepted','rollbackAccepted','identityAccepted','sourceRoutingVerified','providerConnectionsAccepted','singleWriterCutoverPrepared','ownerCutoverApproved'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(key=>Object.hasOwn(x,key));
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const fail=()=>{throw new Error('production_release_not_accepted');};
export function validateProductionProfile(value,sourceRelease,sourceCommit){
 if(!exact(value,['schema','stage','origin','aliasOrigin','sourceRelease','sourceCommit','approvalReceiptHash','gates','resources','contactReady','paymentsReady','paymentEvidence','measurement']))return fail();
 if(value.schema!==1||value.stage!=='production'||value.origin!==productionOrigin||value.aliasOrigin!==productionAlias||!hash(value.sourceRelease)||value.sourceRelease!==sourceRelease||!/^[a-f0-9]{40}$/.test(value.sourceCommit)||sourceCommit!==undefined&&value.sourceCommit!==sourceCommit||!hash(value.approvalReceiptHash)||typeof value.contactReady!=='boolean'||typeof value.paymentsReady!=='boolean')return fail();
 if(!exact(value.gates,productionGates)||productionGates.some(gate=>value.gates[gate]!==true))return fail();
 const r=value.resources;
 if(!exact(r,['accountId','databaseId','databaseName','bucketName'])||!/^[a-f0-9]{32}$/.test(r.accountId)||!uuid(r.databaseId)||!/^derech-tkuma-cms-(?:review|production)$/.test(r.databaseName)||!/^derech-tkuma-media-(?:review|production)$/.test(r.bucketName))return fail();
 const p=value.paymentEvidence;
 if(value.paymentsReady){if(!exact(p,['provider','environment','currency','acceptanceHash','currencyEvidenceHash','acknowledgmentEvidenceHash','termsHash','callbackVerification','acknowledgmentContract'])||p.provider!=='grow'||p.environment!=='production'||p.currency!=='ILS'||p.callbackVerification!=='stored-process-token-and-approved-readback/v1'||!['full-documented-form/v1','installed-wallet-23/v1'].includes(p.acknowledgmentContract)||['acceptanceHash','currencyEvidenceHash','acknowledgmentEvidenceHash','termsHash'].some(key=>!hash(p[key])))return fail();}else if(p!==null)return fail();
 const m=value.measurement;
 if(m!==null){
  if(!exact(m,['verified','strategy','revision','containerSha256','ga4Id','gtmId','metaPixelId','basicConsentOnly','purposeTagsVerified','enhancedMeasurementDisabled','noCustomHtml','sandboxAccepted','noPersonalDataVariables'])||m.verified!==true||m.strategy!=='gtm'||!hash(m.revision)||!hash(m.containerSha256)||m.ga4Id!=='G-DV3E8J77EX'||m.gtmId!=='GTM-5N7NPTL4'||m.metaPixelId!=='766863783155971'||['basicConsentOnly','purposeTagsVerified','enhancedMeasurementDisabled','noCustomHtml','sandboxAccepted','noPersonalDataVariables'].some(key=>m[key]!==true))return fail();
 }
 return Object.freeze(JSON.parse(JSON.stringify(value)));
}
export function validateProductionCloudflareConfig(config,profile){
 const v=config?.vars??{},r=profile.resources;
 if(config?.observability?.enabled!==false)throw new Error('production_observability_must_remain_disabled');
 if(config?.name!=='derech-tkuma-production'||config?.main!=='./build/production-worker.ts'||config?.account_id!==r.accountId||config.workers_dev!==false||config.preview_urls!==false||!config.compatibility_flags?.includes('nodejs_compat')||config.assets?.binding!=='ASSETS'||config.assets.run_worker_first!==true)throw new Error('production_target_not_accepted');
 const routes=config.routes;
 if(!Array.isArray(routes)||routes.length!==2||routes.some(route=>!exact(route,['pattern','zone_name'])||route.zone_name!=='derech-tkuma.com')||routes.map(route=>route.pattern).sort().join(',')!=='derech-tkuma.com/*,www.derech-tkuma.com/*'||config.route)throw new Error('production_routes_not_accepted');
 if(config.d1_databases?.length!==1||config.r2_buckets?.length!==1||config.d1_databases[0].binding!=='DB'||config.d1_databases[0].database_id!==r.databaseId||config.d1_databases[0].database_name!==r.databaseName||config.d1_databases[0].migrations_dir!=='./drizzle'||config.r2_buckets[0].binding!=='BUCKET'||config.r2_buckets[0].bucket_name!==r.bucketName)throw new Error('production_resources_not_accepted');
 if(v.PLATFORM_RELEASE_STAGE!=='production'||v.PLATFORM_PUBLIC_ORIGIN!==productionOrigin||v.PLATFORM_AUTH_MODE!=='supabase'||v.PLATFORM_AUTH_SUPABASE_URL!=='https://uawcxvkekfqxosfblpxr.supabase.co'||v.PLATFORM_AUTH_ORIGIN!==productionOrigin||!['true','false'].includes(v.PLATFORM_AUTH_REQUIRE_MFA)||v.CMS_ADAPTER_MODE!=='isolated-d1'||v.CMS_TENANT_ID!=='derech'||v.CMS_SITE_ID!=='derech-main'||v.CMS_BACKUP_BUCKET_SCOPE!=='deployment-isolated'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.CMS_OWNER_EMAIL??''))throw new Error('production_scope_identity_not_accepted');
 if(profile.contactReady&&(v.CONTACT_MODE!=='receive-only'||v.CONTACT_ORIGIN!==productionOrigin||v.CONTACT_RETENTION_DAYS!=='30'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.CONTACT_PRIVACY_AUTHORITY_ID??'')))throw new Error('production_contact_config_not_accepted');
 if(profile.paymentsReady&&profile.paymentEvidence.acknowledgmentContract==='installed-wallet-23/v1'&&(v.CART_MODE!=='production'||v.CART_PAYMENT_MODE!=='production'||!['true','false'].includes(v.CART_PAYMENT_ACCEPT_NEW)))throw new Error('production_native_payment_config_not_accepted');
 if(v.CART_PAYMENT_MODE&&v.CART_PAYMENT_MODE!=='disabled'&&(!profile.paymentsReady||profile.paymentEvidence.acknowledgmentContract!=='installed-wallet-23/v1'||v.CART_PAYMENT_MODE!=='production'||v.CART_MODE!=='production'))throw new Error('production_native_payment_config_not_accepted');
 if(v.SUBMISSION_MODE&&v.SUBMISSION_MODE!=='disabled'&&(!profile.contactReady||v.SUBMISSION_MODE!=='receive-only'||v.SUBMISSION_ENV!=='production'||!['rating','quote','rating,quote'].includes(v.SUBMISSION_WORKFLOWS)))throw new Error('production_native_submission_config_not_accepted');
 if(v.SUBMISSION_SIGNATURE_MODE&&v.SUBMISSION_SIGNATURE_MODE!=='disabled'&&(v.SUBMISSION_SIGNATURE_MODE!=='enabled'||v.SUBMISSION_MODE!=='receive-only'||!['quote','rating,quote'].includes(v.SUBMISSION_WORKFLOWS)||!profile.contactReady))throw new Error('production_native_signature_config_not_accepted');
 if(Object.hasOwn(v,'PAYMENT_CONFIG')||Object.keys(v).some(key=>/(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CREDENTIAL)/.test(key)))throw new Error('production_secrets_must_use_provider_storage');
 return config;
}

export const canonicalProductionProfile=value=>Array.isArray(value)?'['+value.map(canonicalProductionProfile).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalProductionProfile(value[key])).join(',')+'}':JSON.stringify(value);
