/* Only injected by the accepted production continuity adapter, never review.
 * Existing Elementor submits to its original WP AJAX endpoint. No new intake. */
(() => {
 'use strict';
 const pairs=new Set(['13:0899899','1489:1b8a2d8','18:af355f0','5133:c5cb8a0','5982:aa2b8e0']);
 const ajax=(value,method,body)=>{try{const u=new URL(value,location.href);if(u.origin!==location.origin||u.pathname!=='/wp-admin/admin-ajax.php'||u.search||String(method).toUpperCase()!=='POST'||!(body instanceof FormData))return false;return body.get('action')==='elementor_pro_forms_send_form'&&pairs.has(body.get('post_id')+':'+body.get('form_id'));}catch{return false;}};
 const readable=(value,method)=>{try{const u=new URL(value,location.href);return /^(GET|HEAD)$/i.test(method)&&u.origin===location.origin;}catch{return false;}};
 const denied=()=>new DOMException('Existing WordPress action unavailable','NotAllowedError');
 const fetch=window.fetch.bind(window);window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url,method=init?.method||input?.method||'GET';return readable(url,method)||ajax(url,method,init?.body)?fetch(input,init):Promise.reject(denied());};
 const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;const requests=new WeakMap();
 XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,{method,url});return open.call(this,method,url,...rest);};
 XMLHttpRequest.prototype.send=function(body){const r=requests.get(this);if(!r||!readable(r.url,r.method)&&!ajax(r.url,r.method,body))throw denied();return send.call(this,body);};
 navigator.sendBeacon=()=>false;
 // Native form navigation remains disabled; source Elementor's JS handles the
 // original forms. Dynamic checkout/account documents are served by WordPress.
 HTMLFormElement.prototype.submit=()=>{throw denied();};
 document.addEventListener('submit',event=>{const form=event.target;if(!form?.matches?.('form.elementor-form')){event.preventDefault();event.stopImmediatePropagation();}},true);
})();
