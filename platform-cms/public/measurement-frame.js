/** Same-origin lifecycle frame for one audited GTM container. No source DOM,
 * URL query, form data, free text, booking or purchase data enters this API. */
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(key=>Object.hasOwn(x,key));
export function installMeasurementFrame(window,document,config){
 if(window.parent===window||window.location.origin!=='https://derech-tkuma.com'||!config||config.verified!==true||config.strategy!=='gtm'||config.gtmId!=='GTM-5N7NPTL4'||config.ga4Id!=='G-DV3E8J77EX'||config.metaPixelId!=='766863783155971'||!/^[a-f0-9]{64}$/.test(config.revision))return null;
 let analytics=false,marketing=false,loaded=false;const allowed=config.allowedPurposes;
 if(!exact(allowed,['analytics','marketing'])||typeof allowed.analytics!=='boolean'||typeof allowed.marketing!=='boolean')return null;
 window.dataLayer=[];const gtag=(...args)=>window.dataLayer.push(args);
 const receive=event=>{
  if(event.source!==window.parent||event.origin!=='https://derech-tkuma.com')return;
  const value=event.data;
  if(exact(value,['kind','policyVersion','revision','analytics','marketing'])&&value.kind==='consent'&&value.policyVersion==='2026-10-20'&&value.revision===config.revision&&typeof value.analytics==='boolean'&&typeof value.marketing==='boolean'){
   if(loaded)return;analytics=value.analytics&&allowed.analytics;marketing=value.marketing&&allowed.marketing;if(!analytics&&!marketing)return;
   const consent={analytics_storage:analytics?'granted':'denied',ad_storage:marketing?'granted':'denied',ad_user_data:marketing?'granted':'denied',ad_personalization:marketing?'granted':'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted'};
   gtag('consent','default',consent);gtag('set','ads_data_redaction',true);gtag('set','url_passthrough',false);
   window.dataLayer.push({event:'dt_consent',dt_analytics:analytics,dt_marketing:marketing,dt_ga4_id:'G-DV3E8J77EX',dt_pixel_id:'766863783155971',dt_page_location:'https://derech-tkuma.com/',dt_page_referrer:''});
   window.dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});
   const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtm.js?id=GTM-5N7NPTL4';if(document.currentScript?.nonce)script.nonce=document.currentScript.nonce;document.head.appendChild(script);loaded=true;return;
  }
  if(!loaded||!analytics)return;
  if(exact(value,['kind','name','pageKind'])&&value.kind==='event'&&value.name==='page_view'&&['home','tour','routes','quote','other'].includes(value.pageKind))window.dataLayer.push({event:'dt_page_view',dt_event_name:'page_view',dt_page_kind:value.pageKind});
  if(exact(value,['kind','name','placement'])&&value.kind==='event'&&value.name==='whatsapp_click'&&['home','tour','footer','other'].includes(value.placement))window.dataLayer.push({event:'dt_whatsapp_click',dt_event_name:'whatsapp_click',dt_placement:value.placement});
 };
 window.addEventListener('message',receive);
 return{dispose(){analytics=false;marketing=false;window['ga-disable-G-DV3E8J77EX']=true;window.removeEventListener('message',receive);window.dataLayer.length=0;}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 const element=document.getElementById('dt-measurement-config');let config;try{config=JSON.parse(element?.textContent??'null');}catch{}
 installMeasurementFrame(window,document,config);
}
