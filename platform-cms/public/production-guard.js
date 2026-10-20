/* Production preserves native source visuals, but source integrations cannot
 * acquire payment/form/tracking authority by removing the old preview guard. */
(() => {
 'use strict';
 const forbidden=/\/(?:wp-admin|wp-json|cart|checkout)(?:\/|$)|(?:^|[?&])(?:wc-ajax|add-to-cart)=/i;
 const readable=(value,method='GET')=>{try{const url=new URL(value,location.href);return /^(GET|HEAD)$/i.test(method)&&(url.origin===location.origin||url.protocol==='data:')&&!forbidden.test(url.pathname+url.search);}catch{return false;}};
 const unavailable=()=>{let alert=document.getElementById('dt-integration-unavailable');if(!alert){alert=document.createElement('div');alert.id='dt-integration-unavailable';alert.setAttribute('role','alert');alert.setAttribute('dir','rtl');alert.style.cssText='position:fixed;z-index:2147483647;inset:auto 16px 16px;max-width:640px;margin:auto;padding:18px 22px;background:#f7f5ef;color:#254d3f;border:2px solid #bd985c;border-radius:12px;font:18px/1.6 Arial,sans-serif;box-shadow:0 4px 24px #0003';const message=document.createElement('p');message.textContent='הפעולה הזו אינה זמינה כרגע. אפשר ליצור איתנו קשר דרך כפתור ה־WhatsApp או מספר הטלפון שמופיעים באתר.';message.style.margin='0 0 10px';const close=document.createElement('button');close.type='button';close.textContent='סגירה';close.style.cssText='min-height:44px;padding:6px 20px;background:#254d3f;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer';close.addEventListener('click',()=>alert.remove());alert.append(message,close);document.body.appendChild(alert);}return alert;};
 const denied=()=>new DOMException('This action requires a verified native integration','NotAllowedError');
 const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>readable(typeof input==='string'?input:input.url,init?.method||input?.method||'GET')?nativeFetch(input,init):Promise.reject(denied());
 const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){if(!readable(url,method))throw denied();return open.call(this,method,url,...rest);};
 navigator.sendBeacon=()=>false;
 HTMLFormElement.prototype.submit=()=>{unavailable();throw denied();};
 document.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();unavailable();},true);
 const navigation=value=>{try{const url=new URL(value,location.href);return ['http:','https:','tel:','mailto:'].includes(url.protocol)&&!forbidden.test(url.pathname+url.search)&&!/(?:^|\.)grow\.payments$|(?:^|\.)meshulam\.co\.il$/i.test(url.hostname);}catch{return false;}};
 const nativeOpen=window.open.bind(window);window.open=(url,...rest)=>{if(url&&navigation(url))return nativeOpen(url,...rest);unavailable();return null;};
 document.addEventListener('click',event=>{const link=event.target?.closest?.('a[href]');if(link&&!navigation(link.href)){event.preventDefault();event.stopImmediatePropagation();unavailable();}},true);
})();
