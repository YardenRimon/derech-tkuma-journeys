import {RATING_SOURCE_PATHS,RATING_SCORE5_MESSAGE} from './submission-core';
export type PublicRatingConfig={enabled?:boolean;mode?:'review'|'production';productionApproved?:boolean;pageId?:string};
type ClientConfig={enabled:true;mode:'review'|'production';productionApproved:boolean;sourcePath:string;pageId:string;score5Message:string};
/** Public deployment-owned path bindings, independently checked against SHA256
 * of each exact RATING_SOURCE_PATHS value. No source title/URL comes from DOM. */
const sourceHashes=['ac102a5f6545688de5ef','f7ed81bd37483e9df17b','36ea13d26d28d7d9e144','6635fd8005291164a3a4','999935f1f97211c3c724','b8f16f91881e78e5fb80','8865f3d8001e01d0ba37','e627e3b7aad50c28ff51','69fa32601c316d2d85a7','55a54cd6b7050f23df00'];
export const ratingSourcePageIds:Readonly<Record<string,string>>=Object.freeze(Object.fromEntries(RATING_SOURCE_PATHS.map((path,index)=>[path,'rating-'+sourceHashes[index]])));
function nativeRatingClient(config:ClientConfig){
 'use strict';
 const origin=config.mode==='review'?'https://derech-tkuma-review.22yarden22.workers.dev':'https://derech-tkuma.com';let path:string;try{path=decodeURIComponent(location.pathname);}catch{return;}
 if(config.enabled!==true||location.origin!==origin||path!==config.sourcePath||config.mode==='production'&&config.productionApproved!==true||!/^rating-[a-f0-9]{20}$/.test(config.pageId))return;
 const nativeFetch=window.fetch.bind(window),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 type Payload={workflow:'rating';idempotencyKey:string;pageId:string;score:number;message:string;honeypot:''};
 type Attempt={payload:Payload;identity:string;body:string;uncertain:boolean;accepted:boolean};
 type State={form:HTMLFormElement;widget:HTMLElement;faces:HTMLButtonElement[];next:HTMLButtonElement;submit:HTMLButtonElement;textarea:HTMLTextAreaElement;steps:HTMLElement[];first:HTMLElement;second:HTMLElement;thanks:HTMLElement;trap:HTMLInputElement;box:HTMLElement;retry:HTMLButtonElement;score:number|null;busy:boolean;attempt?:Attempt};
 let state:State|undefined;
 const one=<T extends Element>(root:HTMLElement,selector:string)=>{const found=root.querySelectorAll<T>(selector);return found.length===1?found[0]:null;};
 const field=(form:HTMLFormElement,name:string)=>{const found=[...form.elements].filter(item=>(item as HTMLInputElement).name===name);return found.length===1?found[0] as HTMLInputElement:null;};
 function identity(form:HTMLFormElement){return form.matches('form.elementor-form')&&field(form,'form_id')?.value==='c5cb8a0'&&field(form,'post_id')?.value==='5133';}
 function show(current:State,step:HTMLElement){for(const item of current.steps)item.classList.toggle('is-active',item===step);}
 function controls(current:State){const disabled=current.busy||current.attempt?.accepted===true;for(const face of current.faces)face.disabled=disabled;current.next.disabled=disabled||current.score===null;current.submit.disabled=disabled;current.retry.disabled=disabled;current.textarea.readOnly=disabled;current.widget.setAttribute('aria-busy',String(current.busy));}
 function message(current:State,text:string,retry=false){current.box.textContent=text;current.box.hidden=false;current.retry.hidden=!retry;}
 function input(current:State){if(current.score===null||!Number.isInteger(current.score)||current.score<1||current.score>5){message(current,'יש לבחור דירוג לפני השליחה.');return null;}if(current.trap.value){message(current,'לא ניתן לשמור את המשוב.');return null;}
  const raw=current.score===5?config.score5Message:current.textarea.value;if(raw.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(raw)){message(current,'בדוק את הטקסט. אפשר לכתוב עד 2,000 תווים, ללא תגיות.');return null;}
  return {workflow:'rating' as const,pageId:config.pageId,score:current.score,message:raw.replace(/\r\n?/g,'\n').trim(),honeypot:'' as const};
 }
 async function responseBody(response:Response){const reader=response.body?.getReader();if(!reader)throw new Error('unknown');const chunks:Uint8Array[]=[];let bytes=0,done=false;try{for(;;){const part=await reader.read();if(part.done){done=true;break;}bytes+=part.value.byteLength;if(bytes>2048)throw new Error('unknown');chunks.push(part.value);}const buffer=new Uint8Array(bytes);let offset=0;for(const part of chunks){buffer.set(part,offset);offset+=part.byteLength;}const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}finally{if(!done)void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}}
 async function submit(current:State){
  if(current.busy)return;if(current.attempt?.accepted){message(current,'המשוב כבר נשמר.');return;}const value=input(current);if(!value)return;const comparison=JSON.stringify(value);let attempt=current.attempt;
  if(attempt&&comparison!==attempt.identity&&attempt.uncertain){message(current,'הפרטים השתנו מאז ניסיון שעדיין לא אומת. החזר את הדירוג והטקסט הקודמים לפני ניסיון נוסף.',true);return;}
  if(!attempt||comparison!==attempt.identity){let key:string;try{key=crypto.randomUUID();}catch{message(current,'לא ניתן להכין את המשוב כרגע. נסה שוב מאוחר יותר.');return;}if(!uuid.test(key)){message(current,'לא ניתן להכין את המשוב כרגע. נסה שוב מאוחר יותר.');return;}const payload:Payload={...value,idempotencyKey:key.toLowerCase()},body=JSON.stringify(payload);if(new TextEncoder().encode(body).byteLength>8192){message(current,'המשוב ארוך מדי לשמירה.');return;}attempt={payload,identity:comparison,body,uncertain:false,accepted:false};current.attempt=attempt;}
  current.busy=true;controls(current);message(current,'שומר את המשוב...');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await nativeFetch('/api/submissions/',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json','x-derech-submission':'1'},body:attempt.body}),result=await responseBody(response);
   if(response.status===202&&result&&Object.keys(result).sort().join(',')==='accepted,receipt,state'&&result.accepted===true&&result.state==='stored_pending_processing'&&typeof result.receipt==='string'&&uuid.test(result.receipt)){attempt.accepted=true;attempt.uncertain=false;show(current,current.thanks);message(current,'המשוב נשמר וממתין לעיבוד. אסמכתה: '+result.receipt);return;}
   if(!attempt.uncertain&&[400,403,410,413,429].includes(response.status)&&result?.accepted===false){message(current,response.status===429?'התקבלו כמה ניסיונות בזמן קצר. אפשר לנסות שוב מאוחר יותר.':'לא ניתן לשמור כרגע את המשוב. בדוק את הפרטים ונסה שוב.',true);return;}
   attempt.uncertain=true;message(current,'לא ניתן לוודא אם המשוב נשמר. לא נשלח ניסיון נוסף באופן אוטומטי. אפשר לנסות שוב עם אותו דירוג וטקסט.',true);
  }catch{attempt.uncertain=true;message(current,'לא ניתן לוודא אם המשוב נשמר. לא נשלח ניסיון נוסף באופן אוטומטי. אפשר לנסות שוב עם אותו דירוג וטקסט.',true);}finally{clearTimeout(timer);current.busy=false;controls(current);}
 }
 const stop=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
 window.addEventListener('click',event=>{const current=state,target=event.target instanceof Element?event.target:null;if(!current||!target)return;const button=target.closest<HTMLButtonElement>('button');if(!button||!current.widget.contains(button))return;
  if(current.faces.includes(button)){stop(event);if(current.busy||current.attempt?.accepted)return;const score=Number(button.dataset.value);if(current.attempt?.uncertain&&score!==current.attempt.payload.score){message(current,'יש לבדוק את הניסיון הקודם לפני בחירת דירוג חדש.',true);return;}current.score=score;for(const face of current.faces){const selected=face===button;face.classList.toggle('is-selected',selected);face.setAttribute('aria-pressed',String(selected));}current.widget.querySelector('.cf-faces')?.classList.add('has-selection');controls(current);return;}
  if(button===current.next){stop(event);if(current.busy||current.attempt?.accepted)return;if(current.score===null){message(current,'יש לבחור דירוג לפני השליחה.');return;}if(current.score===5){void submit(current);return;}show(current,current.second);current.textarea.focus();return;}
  if(button===current.submit||button===current.retry){stop(event);void submit(current);}
 },true);
 window.addEventListener('submit',event=>{const current=state,form=event.target instanceof HTMLFormElement?event.target:null;if(!current||form!==current.form||!identity(form))return;stop(event);void submit(current);},true);
 function boot(){
  const forms=[...document.querySelectorAll<HTMLFormElement>('form.elementor-form')].filter(identity),widgets=document.querySelectorAll<HTMLElement>('.content-feedback-widget');if(forms.length!==1||widgets.length!==1)return;const form=forms[0],widget=widgets[0],wrapper=form.closest('.feedback-hidden-form.elementor-element-c5cb8a0'),htmlWidget=widget.closest('.elementor-widget-html');if(!wrapper||!htmlWidget||wrapper.parentElement!==htmlWidget.parentElement)return;
  if(['feedback_rating','feedback_message','feedback_page_title','feedback_page_url'].some(name=>!field(form,'form_fields['+name+']')))return;
  const faces=[...widget.querySelectorAll<HTMLButtonElement>('button.cf-face')],next=one<HTMLButtonElement>(widget,'button.cf-next'),send=one<HTMLButtonElement>(widget,'button.cf-submit'),textarea=one<HTMLTextAreaElement>(widget,'textarea.cf-textarea'),first=one<HTMLElement>(widget,'.cf-step-1'),second=one<HTMLElement>(widget,'.cf-step-2'),thanks=one<HTMLElement>(widget,'.cf-thanks');
  if(faces.length!==5||new Set(faces.map(face=>face.dataset.value)).size!==5||faces.some(face=>!['1','2','3','4','5'].includes(face.dataset.value??''))||!next||!send||!textarea||!first||!second||!thanks)return;
  const trap=document.createElement('input');trap.type='text';trap.name='rating_website';trap.hidden=true;trap.tabIndex=-1;trap.autocomplete='off';trap.setAttribute('aria-hidden','true');form.appendChild(trap);
  const box=document.createElement('div');box.dataset.nativeRatingStatus='';box.className='elementor-message elementor-message-info';box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.style.overflowWrap='anywhere';box.hidden=true;const retry=document.createElement('button');retry.type='button';retry.textContent='ניסיון נוסף לאותו משוב';retry.dataset.nativeRatingRetry='';retry.hidden=true;retry.style.maxWidth='100%';retry.style.whiteSpace='normal';widget.appendChild(box);widget.appendChild(retry);textarea.maxLength=2000;
  state={form,widget,faces,next,submit:send,textarea,steps:[...widget.querySelectorAll<HTMLElement>('.cf-step')],first,second,thanks,trap,box,retry,score:null,busy:false};widget.dataset.nativeRatingWidget='';for(const face of faces)face.setAttribute('aria-pressed','false');controls(state);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
}
function enabled(url:URL,config:PublicRatingConfig):ClientConfig|null{
 if(!config||config.enabled!==true||Object.keys(config).some(key=>!['enabled','mode','productionApproved','pageId'].includes(key))||!['review','production'].includes(config.mode??''))return null;
 const origin=config.mode==='review'?'https://derech-tkuma-review.22yarden22.workers.dev':'https://derech-tkuma.com';let path:string;try{path=decodeURIComponent(url.pathname);}catch{return null;}if(url.origin!==origin||url.username||url.password||config.mode==='production'&&config.productionApproved!==true||!RATING_SOURCE_PATHS.includes(path)||ratingSourcePageIds[path]!==config.pageId)return null;
 return {enabled:true,mode:config.mode!,productionApproved:config.productionApproved===true,sourcePath:path,pageId:config.pageId!,score5Message:RATING_SCORE5_MESSAGE};
}
export function ratingClientSource(url:URL,config:PublicRatingConfig={}):string{const value=enabled(url,config);return value?'('+nativeRatingClient.toString()+')('+JSON.stringify(value).replace(/</g,'\\u003c')+');':'';}
/** One early classic script; the exact source form/widget DOM is retained. */
export function preparePublicRating(html:string,url:URL,serverConfig:PublicRatingConfig={}):string{const source=ratingClientSource(url,serverConfig);if(!source||html.includes('data-native-rating=')||!html.includes('c5cb8a0')||!/<head(?:\s[^>]*)?>/i.test(html))return html;return html.replace(/<head(?:\s[^>]*)?>/i,head=>head+'<script data-native-rating="source-rating-v1">'+source+'</script>');}
