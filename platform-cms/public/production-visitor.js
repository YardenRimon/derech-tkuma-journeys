/** Production only. Server configuration enables capability; a versioned
 * visitor choice enables purposes. Browser flags never enable release mode. */
import {POLICY_VERSION,CONSENT_COOKIE,MAX_AGE,readConsent,consentValue} from './consent-state.js';
export {POLICY_VERSION,CONSENT_COOKIE,MAX_AGE,readConsent,consentValue};
const canonical='https://derech-tkuma.com',phone='972535955166';
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(key=>Object.hasOwn(x,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function validVisitorConfiguration(value,origin){
 if(origin!==canonical||!exact(value,['schema','origin','policyVersion','configuration'])||value.schema!==1||value.origin!==origin||value.policyVersion!==POLICY_VERSION)return false;
 const m=value.configuration;if(m===null)return true;
 return exact(m,['verified','strategy','revision','containerSha256','ga4Id','gtmId','metaPixelId','basicConsentOnly','purposeTagsVerified','enhancedMeasurementDisabled','noCustomHtml','sandboxAccepted','noPersonalDataVariables'])&&m.verified===true&&m.strategy==='gtm'&&hash(m.revision)&&hash(m.containerSha256)&&m.ga4Id==='G-DV3E8J77EX'&&m.gtmId==='GTM-5N7NPTL4'&&m.metaPixelId==='766863783155971'&&['basicConsentOnly','purposeTagsVerified','enhancedMeasurementDisabled','noCustomHtml','sandboxAccepted','noPersonalDataVariables'].every(key=>m[key]===true);
}
function normalizeLinks(document){
 for(const a of document.querySelectorAll('a[href]')){
  const raw=a.getAttribute('href');if(typeof raw!=='string')continue;
  try{const url=new URL(raw);if(url.protocol==='https:'&&url.hostname==='wa.me'&&!url.port&&!url.username&&!url.password&&/^\/(?:535955166|0535955166|972535955166)\/?$/.test(url.pathname)){const normalized=raw.replace(/^(https:\/\/wa\.me\/)\d+(?=\/?(?:[?#]|$))/i,'$1'+phone);if(normalized!==raw)a.setAttribute('href',normalized);}}catch{}
 }
}
export function renderConsentUi(document,{choose,preferences,revoke}){
 const root=document.createElement('div');root.id='dt-consent-wrap';root.dir='rtl';root.lang='he';
 root.innerHTML=`<style>#dt-consent-wrap{font:14px/1.65 Arial,"Noto Sans Hebrew",sans-serif;color:#253c33}#dt-consent-wrap *{box-sizing:border-box}#dt-consent-wrap [hidden]{display:none!important}#dt-consent-wrap button{font:inherit;min-height:44px;padding:10px 18px;border:1px solid #254d3f;border-radius:8px;background:#fff;color:#254d3f;cursor:pointer}#dt-consent-wrap button:hover{background:#edf3ed}#dt-consent-wrap :is(button,input):focus-visible{outline:3px solid #bd985c;outline-offset:3px}#dt-consent-wrap [data-panel]{position:fixed;z-index:10000001;inset:auto 20px 72px 20px;max-width:720px;margin-inline:auto;background:#f7f5ef;border:1px solid #bd985c;box-shadow:0 10px 45px #183b3026;border-radius:14px;padding:22px;max-height:80dvh;overflow:auto;text-align:right}#dt-consent-wrap h2{font-size:20px;color:#254d3f;margin:0 0 8px}#dt-consent-wrap p{margin:0 0 14px}#dt-consent-wrap [data-actions]{display:flex;gap:10px;flex-wrap:wrap}#dt-consent-wrap [data-actions]>button{flex:1;min-width:130px}#dt-consent-wrap fieldset{border:0;padding:0;margin:16px 0}#dt-consent-wrap label{display:flex;gap:10px;align-items:start;margin:12px 0}#dt-consent-wrap input{width:19px;height:19px;accent-color:#254d3f;margin-top:3px}#dt-consent-wrap small{display:block;color:#52675a;font-size:13px}#dt-consent-wrap [data-fab]{position:fixed;z-index:10000000;bottom:12px;left:12px;border-color:#bd985c;font-size:13px}#dt-consent-wrap [data-status]{font-size:13px;min-height:1em;margin-top:10px}@media(max-width:480px){#dt-consent-wrap [data-panel]{inset:auto 10px 70px 10px;padding:18px}#dt-consent-wrap [data-actions]{display:grid;grid-template-columns:1fr}#dt-consent-wrap [data-actions]>button{width:100%}}</style>
 <section data-panel role="dialog" aria-modal="false" aria-labelledby="dt-consent-title"><h2 id="dt-consent-title">העדפות פרטיות</h2><p>אפשר לאפשר מדידת שימוש וכלי שיווק. אפשר להשתמש באתר גם בלי לאשר, ולשנות את הבחירה בכל עת.</p><div data-preferences hidden><small>שמירת ההעדפות ותפקוד הטפסים נחוצים לפעולת האתר. האישור ליצירת קשר בטופס נשאר נפרד.</small><fieldset><legend>כלים שאפשר לבחור</legend><label><input type="checkbox" name="analytics"><span>מדידת שימוש<small>ביקורים ולחיצות בנתונים מצומצמים, ללא פרטי הטופס.</small></span></label><label><input type="checkbox" name="marketing"><span>כלי שיווק<small>כלי שיווק של Meta יופעלו רק לאחר אישור.</small></span></label></fieldset></div><div data-actions><button type="button" data-action="accept">אישור הכול</button><button type="button" data-action="reject">דחיית הכול</button><button type="button" data-action="preferences">בחירת העדפות</button><button type="button" data-action="save" hidden>שמירת הבחירה</button><button type="button" data-action="revoke" hidden>ביטול כל ההסכמות</button></div><div data-status role="status" aria-live="polite"></div></section><button type="button" data-fab>העדפות פרטיות</button>`;
 document.body.appendChild(root);
 const panel=root.querySelector('[data-panel]'),options=root.querySelector('[data-preferences]'),analytics=root.querySelector('[name=analytics]'),marketing=root.querySelector('[name=marketing]');
 const open=(state={analytics:false,marketing:false})=>{panel.hidden=false;options.hidden=false;analytics.checked=state.analytics;marketing.checked=state.marketing;root.querySelector('[data-action=save]').hidden=false;root.querySelector('[data-action=revoke]').hidden=false;analytics.focus();};
 root.querySelector('[data-fab]').addEventListener('click',()=>preferences(open));
 root.addEventListener('click',event=>{const button=event.target.closest?.('button[data-action]');if(!button)return;switch(button.dataset.action){case'accept':choose(true,true);break;case'reject':choose(false,false);break;case'preferences':preferences(open);break;case'save':choose(analytics.checked,marketing.checked);break;case'revoke':revoke();break;}});
 return{root,open,close(){panel.hidden=true;root.querySelector('[data-fab]').focus();},show(){panel.hidden=false;},dispose(){root.remove();}};
}
export function installProductionVisitor(window,document,configuration){
 if(!validVisitorConfiguration(configuration,window.location.origin))return null;
 const config=JSON.parse(JSON.stringify(configuration)),revision=config.configuration?.revision??'disabled';
 const read=()=>{try{return readConsent(document.cookie,revision);}catch{return null;}};
 let state=read()??consentValue(false,false,revision),saved=read()!==null,frame=null,frameReady=false,disposed=false;
 const stop=()=>{frameReady=false;if(frame){frame.onload=null;frame.remove();frame=null;}};
 const clearProviderCookies=()=>{
  const names=[...(!state.analytics?['_ga','_ga_DV3E8J77EX']:[]),...(!state.marketing?['_fbp','_fbc']:[])];
  for(const name of names)for(const domain of['','; Domain=derech-tkuma.com','; Domain=.derech-tkuma.com'])try{document.cookie=name+'=; Path=/; Max-Age=0; Secure; SameSite=Lax'+domain;}catch{}
 };
 const post=value=>{if(frame&&frameReady)frame.contentWindow?.postMessage(value,canonical);};
 const start=()=>{
  stop();clearProviderCookies();if(disposed||!config.configuration||!state.analytics&&!state.marketing)return;
  frame=document.createElement('iframe');frame.hidden=true;frame.setAttribute('aria-hidden','true');frame.setAttribute('title','כלי מדידה לפי העדפות פרטיות');
  // Same origin preserves first-party GA/session cookies. This is a lifecycle
  // boundary for audited code, not a security boundary for untrusted tags.
  frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='no-referrer';frame.src='/measurement-frame/';
  const ownedFrame=frame;frame.onload=()=>{if(frame!==ownedFrame)return;frameReady=true;post({kind:'consent',policyVersion:POLICY_VERSION,revision,analytics:state.analytics,marketing:state.marketing});if(state.analytics)post({kind:'event',name:'page_view',pageKind:window.location.pathname==='/'?'home':decodeURIComponent(window.location.pathname)==='/המסלולים/'?'routes':decodeURIComponent(window.location.pathname)==='/הצעה/'?'quote':window.location.pathname.startsWith('/maslulim/')?'tour':'other'});};
  document.body.appendChild(frame);
 };
 let channel=null;try{channel=window.BroadcastChannel?new window.BroadcastChannel('dt-consent-'+revision):null;}catch{}
 const choose=(analytics,marketing)=>{
  state=consentValue(analytics,marketing,revision);saved=true;stop();
  try{document.cookie=CONSENT_COOKIE+'='+encodeURIComponent(JSON.stringify(state))+'; Path=/; Max-Age='+MAX_AGE+'; Secure; SameSite=Lax';}catch{}
  start();ui.close();try{channel?.postMessage({changed:true});}catch{}
 };
 const ui=renderConsentUi(document,{choose,preferences:open=>open(state),revoke:()=>choose(false,false)});
 const sync=()=>{const current=read();if(!current){if(state.analytics||state.marketing){state=consentValue(false,false,revision);stop();clearProviderCookies();}ui.show();return;}if(current.analytics!==state.analytics||current.marketing!==state.marketing){state=current;start();}};
 if(channel)channel.onmessage=sync;
 const click=event=>{
  const a=event.target.closest?.('a[href]');if(event.defaultPrevented||!a||!state.analytics||!frameReady)return;
  try{const url=new URL(a.href);if(url.origin==='https://wa.me'&&url.pathname.replace(/\/$/,'')==='/'+phone)post({kind:'event',name:'whatsapp_click',placement:a.closest('footer')?'footer':'other'});}catch{}
 };
 normalizeLinks(document);const observer=window.MutationObserver?new window.MutationObserver(()=>normalizeLinks(document)):null;
 observer?.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
 document.addEventListener('click',click,true);window.addEventListener('focus',sync);window.addEventListener('pageshow',sync);window.addEventListener('pagehide',stop);
 if(saved)ui.close();start();
 return Object.freeze({status:()=>Object.freeze({analytics:state.analytics,marketing:state.marketing,configured:config.configuration!==null,policyVersion:POLICY_VERSION}),revoke:()=>choose(false,false),dispose(){disposed=true;stop();observer?.disconnect();channel?.close();document.removeEventListener('click',click,true);window.removeEventListener('focus',sync);window.removeEventListener('pageshow',sync);window.removeEventListener('pagehide',stop);ui.dispose();}});
}
async function boot(){
 if(location.origin!==canonical)return;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch('/visitor-configuration/',{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
  if(response.status!==200)return;const reader=response.body?.getReader();if(!reader)return;let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4096){await reader.cancel();return;}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();
  const config=JSON.parse(raw);if(!validVisitorConfiguration(config,location.origin))return;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>installProductionVisitor(window,document,config),{once:true});else installProductionVisitor(window,document,config);
 }catch{}finally{clearTimeout(timer);}
}
if(typeof window!=='undefined'&&typeof document!=='undefined')void boot();
