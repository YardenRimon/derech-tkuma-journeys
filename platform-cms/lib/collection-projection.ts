import current from './current-collections.json' with { type: 'json' };
import { validateContent, type Kind, type Tour, type Record as CollectionRecord } from './collection-core';
/** Source bindings are deployment-owned. No caller-supplied selectors or HTML are executed. */
export type PublishedProjectionRecord = Pick<CollectionRecord,'kind'|'id'|'published'|'publishedVersion'>;
export type SourceBinding = {page:string;kind:Kind;id:string;field:string;fieldId?:string;selector:string;prefix?:string;currencyFieldId?:string;sourceLiteral?:string;cardClass?:string;backgroundClass?:string};
export const currentCollectionSeed = current.records;
export const currentCollectionBindings = current.bindings as SourceBinding[];
export const tourHref=(tour:Tour):string=>tour.sourcePath||('/'+tour.slug+'/');
export function managedCollectionFields(page:string): {[fieldId:string]:{kind:Kind;id:string;field:string;label:string}} {
 const result:{[fieldId:string]:{kind:Kind;id:string;field:string;label:string}}={};
 for(const binding of currentCollectionBindings.filter(x=>x.page===page))if(binding.fieldId||binding.currencyFieldId){const seed=current.records.find(x=>x.kind===binding.kind&&x.id===binding.id);result[(binding.fieldId||binding.currencyFieldId)!]={kind:binding.kind,id:binding.id,field:binding.field,label:seed?.content.title||'סיור ומועד'};}
 return result;
}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type Node={tag:string;attrs:{[key:string]:string};start:number;openEnd:number;closeStart:number;end:number;parent?:Node};
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function nodes(html:string):Node[]{
 const result:Node[]=[],stack:Node[]=[];
 // Raw-text script/style bodies are one token; '<' in JS never becomes a node.
 const token=/<!--[\s\S]*?-->|<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<\/?([a-zA-Z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
 for(const m of html.matchAll(token)){
  if(m[0].startsWith('<!--')||m[1])continue;const tag=m[2].toLowerCase(),start=m.index!;
  if(m[0].startsWith('</')){const at=stack.map(x=>x.tag).lastIndexOf(tag);if(at>=0){const n=stack[at];n.closeStart=start;n.end=start+m[0].length;stack.splice(at);}continue;}
  const attrs:{[key:string]:string}={};for(const a of m[0].matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4];
  const n:Node={tag,attrs,start,openEnd:start+m[0].length,closeStart:start+m[0].length,end:start+m[0].length,parent:stack.at(-1)};result.push(n);if(!voidTags.has(tag)&&!m[0].endsWith('/>'))stack.push(n);
 }
 return result;
}
/** Overlay existing source DOM only; source HTML is byte-identical when published values equal the seed.
 * Draft is intentionally absent from the input contract and is never inspected.
 */
export function projectPublishedCollections(html:string,page:string,records:readonly PublishedProjectionRecord[]):string {
 const bindings=currentCollectionBindings.filter(x=>x.page===page);if(!bindings.length)return html;
 const active=records.filter(x=>x.publishedVersion>0),tree=nodes(html),edits:{start:number;end:number;value:string}[]=[];
 const add=(start:number,end:number,value:string)=>{if(html.slice(start,end)!==value)edits.push({start,end,value});};
 const byField=(id:string)=>tree.find(x=>x.attrs['data-edit-id']===id||x.attrs['data-image-id']===id);
 for(const binding of bindings){
  const record=active.find(x=>x.kind===binding.kind&&x.id===binding.id);if(!record)continue;
  const seed=current.records.find(x=>x.kind===binding.kind&&x.id===binding.id)!;
  if(record.published===null){if(binding.cardClass)for(const card of tree.filter(x=>(x.attrs.class||'').split(/\s+/).includes(binding.cardClass!)))add(card.start,card.end,'');continue;}
  const content=validateContent(binding.kind,record.published) as unknown as {[key:string]:unknown},initial=seed.content as {[key:string]:unknown};
  if(binding.field==='visibility'||(content[binding.field]===initial[binding.field]&&(binding.field!=='image'||content.imageAlt===initial.imageAlt)))continue;
  if(binding.field==='priceMinor'){
   const currency=byField(binding.currencyFieldId!);if(!currency)continue;
   const amount=/^[\d,.]+/.exec(html.slice(currency.end));if(amount)add(currency.end,currency.end+amount[0].length,((content.priceMinor as number)/100).toFixed(2));
  }else if(binding.backgroundClass&&content.image){
   for(const node of tree.filter(x=>(x.attrs.class||'').split(/\s+/).includes(binding.backgroundClass!))){let parent=node.parent;while(parent&&!(parent.attrs.class||'').split(/\s+/).includes(binding.cardClass!))parent=parent.parent;if(!parent)continue;let opening=html.slice(node.start,node.openEnd);const style=(node.attrs.style||'')+';background-image:url(&quot;'+escapeHtml(String(content.image))+'&quot;)';opening=/\sstyle="/.test(opening)?opening.replace(/\sstyle="[^"]*"/,' style="'+style+'"'):opening.slice(0,-1)+' style="'+style+'">';add(node.start,node.openEnd,opening);}
  }else if(binding.fieldId){
   const node=byField(binding.fieldId);if(!node)continue;
   if(binding.field==='image'){
    let opening=html.slice(node.start,node.openEnd);const image=String(content.image??'');
    if(!image)continue;
    for(const name of ['src','data-lazy-src','data-src']){const pattern=new RegExp('(\\s)'+name+'="[^"]*"','g');if(pattern.test(opening))opening=opening.replace(pattern,'$1'+name+'="'+escapeHtml(image)+'"');}
    opening=opening.replace(/\s(?:srcset|sizes|data-srcset|data-lazy-srcset)="[^"]*"/g,'');
    opening=opening.replace(/\balt="[^"]*"/, 'alt="'+escapeHtml(String(content.imageAlt??''))+'"');add(node.start,node.openEnd,opening);
   }else add(node.openEnd,node.closeStart,escapeHtml((binding.prefix??'')+String(content[binding.field]??'')));
  }
 }
 for(const record of active.filter(x=>x.kind==='tour'&&x.published)){
  const seed=current.records.find(x=>x.kind==='tour'&&x.id===record.id);if(!seed)continue;
  const tour=validateContent('tour',record.published) as Tour,old=(seed.content as {sourcePath?:string}).sourcePath;
  if(!old||tourHref(tour)===old)continue;
  for(const node of tree.filter(x=>x.tag==='a')){let href=node.attrs.href;try{href=decodeURIComponent(href);}catch{continue;}if(href===old){const opening=html.slice(node.start,node.openEnd).replace(/\bhref="[^"]*"/,'href="'+escapeHtml(tourHref(tour))+'"');add(node.start,node.openEnd,opening);}}
 }
 // Removing a published card supersedes edits inside that same card.
 const final=edits.filter((edit,index)=>!edits.some((other,otherIndex)=>otherIndex!==index&&other.value===''&&other.start<=edit.start&&other.end>=edit.end&&(other.start!==edit.start||other.end!==edit.end||otherIndex<index)));
 let result=html;for(const edit of final.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.value+result.slice(edit.end);return result;
}
