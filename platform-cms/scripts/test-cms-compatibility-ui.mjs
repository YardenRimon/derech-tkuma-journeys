import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../managed-assets/admin.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
class Element {
  constructor(){this.children=[];this.events={};this.dataset={};this.value='';this.textContent='';this.classList={toggle(){}};}
  set innerHTML(value){throw new Error('unsafe HTML sink: '+value);}
  setAttribute(key,value){this[key]=value;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  addEventListener(event,fn){(this.events[event]||=[]).push(fn);}
  emit(event){for(const fn of this.events[event]||[])fn({preventDefault(){}});}
}
async function boot(canPublish=true,managedFields={}){
  const windowEvents={};
  const elements=new Map(['page-picker','editor-frame','panel-content','admin-status','admin-stale','admin-toast','save','preview','publish','restore','admin-app'].map(id=>[id,new Element()]));
  elements.get('admin-app').dataset.canPublish=String(canPublish);
  elements.get('editor-frame').contentWindow={postMessage(){}};
  const stale=[{name:'removed',reason:'removed',value:'<img src=x onerror=alert(1)>',english:'old English',alt:'old alt'}];
  const initial={slug:'/',base:{title:'Synthetic',fields:{'text-1':{type:'text',value:'original'}},sections:[{id:'body',html:'<p>source</p>'}]},draft:{fields:{},order:['body']},revision:2,publishedVersion:1,stale,managedFields};
  const requests=[],confirmations=[];let allow=false,fail=false;
  const context={document:{querySelector:s=>elements.get(s.slice(1)),querySelectorAll:()=>[],createElement:()=>new Element()},location:{origin:'https://cms.invalid'},confirm:message=>{confirmations.push(message);return allow;},window:{addEventListener(name,fn){windowEvents[name]=fn;}},URL,Date,JSON,setTimeout(){return 1;},clearTimeout(){},
    async fetch(url,options={}){const body=options.body?JSON.parse(options.body):undefined;requests.push({url,body});let data=structuredClone(initial);if(fail){fail=false;return {ok:false,status:503,json:async()=>({error:'Synthetic failure'})};}if(url.includes('/history'))data={versions:[],permissions:{canPublish}};else if(body)data={revision:3,publishedVersion:2};return {ok:true,json:async()=>data};}};
  vm.runInNewContext(source,context);await flush();
  return {elements,requests,confirmations,select(id){windowEvents.message({origin:context.location.origin,source:elements.get("editor-frame").contentWindow,data:{type:"cms:select",id}});},allow(value){allow=value;},failNext(){fail=true;},async click(id){elements.get(id).emit('click');await flush();}};
}
let ui=await boot();
assert.equal(ui.elements.get('admin-stale').hidden,false);
const walk=node=>[node,...node.children.flatMap(child=>typeof child==='object'?walk(child):[])];
assert.ok(walk(ui.elements.get('admin-stale')).some(e=>e.value==='<img src=x onerror=alert(1)>'),'old content is a plain recoverable value');
await ui.click('save');assert.equal(ui.requests.filter(r=>r.body).length,0,'cancelling never saves or discards');
ui.allow(true);await ui.click('save');assert.equal(ui.requests.at(-1).body.discardStale,true);assert.equal(ui.requests.at(-1).body.revision,2);assert.equal(ui.elements.get('admin-stale').hidden,true);
assert.equal(ui.elements.get('admin-toast').className,'admin-toast is-saved');await ui.click('save');assert.match(ui.elements.get('admin-toast').children[0].textContent,/אין שינויים/);
await ui.click('restore');
let original=walk(ui.elements.get('panel-content')).find(e=>e.textContent==='שחזור ופרסום הגרסה המקורית מהקוד');assert.ok(original);
ui.allow(false);original.emit('click');await flush();assert.equal(ui.requests.filter(r=>r.url.endsWith('/rollback')).length,0);
ui.allow(true);original.emit('click');await flush();assert.equal(ui.requests.find(r=>r.url.endsWith('/rollback')).body.version,0);assert.match(ui.confirmations.at(-1),/פרסום חדש/);
ui=await boot(false);assert.equal(ui.elements.get('publish').hidden,true);await ui.click('restore');assert.ok(!walk(ui.elements.get('panel-content')).some(e=>e.textContent==='שחזור ופרסום הגרסה המקורית מהקוד'));
ui=await boot();ui.allow(true);ui.failNext();await ui.click('save');assert.equal(ui.elements.get('admin-toast').role,'alert');assert.equal(ui.elements.get('admin-toast').hidden,false);assert.equal(ui.elements.get('admin-stale').hidden,false,'failed save preserves recovery');ui.elements.get('admin-toast').children[1].emit('click');assert.equal(ui.elements.get('admin-toast').hidden,true);
ui=await boot(true,{'text-1':{kind:'catalog',id:'source-product-7969',field:'currency',label:'מטבע מחיר אבן התקומה',readOnly:true}});ui.select('text-1');
assert.ok(walk(ui.elements.get('panel-content')).some(e=>e.textContent.includes('אינו ניתן לעריכה בעורך העמוד')));assert.ok(!walk(ui.elements.get('panel-content')).some(e=>e.href),'catalog controlled field must not link to a nonexistent collection editor');
ui=await boot(true,{'text-1':{kind:'occurrence',id:'fixture-event',field:'priceMinor',label:'מועד'}});ui.select('text-1');assert.ok(walk(ui.elements.get('panel-content')).some(e=>e.href==='/admin/collections?kind=occurrence&id=fixture-event'),'event field retains its real editor link');
console.log('PASS real CMS client: safe recoverable stale text, cancel preserves data, explicit discard/revision save, source reset confirmation and publisher-only controls.');
