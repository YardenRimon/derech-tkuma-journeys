import {currentCollectionSeed,managedCollectionFields,type PublishedProjectionRecord} from './collection-projection';
import {validateContent,type Occurrence} from './collection-core';
type Field='title'|'dateLabel'|'priceMinor'|'note';
type Binding={page:string;id:string;productId:string;main:boolean;scopeClass:string;fields:{title:string;dateLabel:string;priceMinor:string;note?:string};purchaseField:string};
/** Deployment-owned public source bindings. Generated from the frozen 51-page
 * fixture: exact seed leaf values + source add-to-cart ID in each scoped block.
 * Field numbers are source identities, never positions or visitor selectors. */
const sourceRows:readonly (readonly [string,string,boolean,number,number,number,number,number?])[]=[["03-11-26","8249",true,62,63,64,65],["03-11-26","8257",false,67,68,69,70],["03-11-26","8255",false,72,73,74,75],["03-11-26","8253",false,77,78,79,80],["03-11-26","8251",false,82,83,84,85],["03-11-26","7899",false,92,93,94,95],["13-11-26","8251",true,62,63,64,65],["13-11-26","8257",false,68,69,70,71],["13-11-26","8255",false,73,74,75,76],["13-11-26","8253",false,78,79,80,81],["13-11-26","8249",false,83,84,85,86],["13-11-26","7899",false,92,93,94,95],["19-11-26","8253",true,62,63,64,65],["19-11-26","8257",false,68,69,70,71],["19-11-26","8255",false,73,74,75,76],["19-11-26","8251",false,78,79,80,81],["19-11-26","8249",false,83,84,85,86],["19-11-26","7899",false,92,93,94,95],["20-10-26","7681",true,62,63,64,65,66],["20-10-26","8257",false,68,69,70,71],["20-10-26","8255",false,73,74,75,76],["20-10-26","8253",false,78,79,80,81],["20-10-26","8251",false,83,84,85,86],["20-10-26","8249",false,88,89,90,91],["23-10-2026","7899",true,62,63,64,65],["23-10-2026","8257",false,67,68,69,70],["23-10-2026","8255",false,72,73,74,75],["23-10-2026","8253",false,77,78,79,80],["23-10-2026","8251",false,82,83,84,85],["23-10-2026","8249",false,87,88,89,90],["27-10-26","7882",true,62,63,64,65,66],["27-10-26","8257",false,68,69,70,71],["27-10-26","8255",false,73,74,75,76],["27-10-26","8253",false,78,79,80,81],["27-10-26","8251",false,83,84,85,86],["27-10-26","8249",false,88,89,90,91],["27-11-26","8255",true,62,63,64,65],["27-11-26","8257",false,68,69,70,71],["27-11-26","8253",false,73,74,75,76],["27-11-26","8251",false,78,79,80,81],["27-11-26","8249",false,83,84,85,86],["27-11-26","7899",false,92,93,94,95],["30-10-2026","7891",true,62,63,64,65],["30-10-2026","8257",false,67,68,69,70],["30-10-2026","8255",false,72,73,74,75],["30-10-2026","8253",false,77,78,79,80],["30-10-2026","8251",false,82,83,84,85],["30-10-2026","8249",false,87,88,89,90],["30-11-26","8257",true,62,63,64,65],["30-11-26","8255",false,68,69,70,71],["30-11-26","8253",false,73,74,75,76],["30-11-26","8251",false,78,79,80,81],["30-11-26","8249",false,83,84,85,86],["30-11-26","7899",false,92,93,94,95]];
export const currentProductBindings:readonly Readonly<Binding>[]=Object.freeze(sourceRows.map(([slug,productId,main,title,date,price,purchase,note])=>Object.freeze({page:'/product/'+slug+'/',id:'source-product-'+productId,productId,main,scopeClass:main?'elementor-element-d238136':'e-loop-item-'+productId,fields:Object.freeze({title:'text-'+title,dateLabel:'text-'+date,priceMinor:'text-'+price,...(note?{note:'text-'+note}:{})}),purchaseField:'text-'+purchase})));
export const productProjectionPages:Readonly<Record<string,string>>=Object.freeze(Object.fromEntries(currentProductBindings.filter(x=>x.main).map(x=>[x.page,x.id])));
const seeds=new Map(currentCollectionSeed.filter(row=>row.kind==='occurrence').map(row=>[row.id,validateContent('occurrence',row.content) as Occurrence]));
/** Physical currency leaves are source/catalog controlled. The adjacent numeric
 * prices are raw source HTML, without page-editor field IDs. This ownership map
 * neither creates an occurrence nor projects a private catalog price. */
export const physicalProductPriceFields=Object.freeze([
 {page:'/product/אבן-התקומה/',fieldId:'text-64'},
 {page:'/product/03-11-26/',fieldId:'text-89'},
 {page:'/product/13-11-26/',fieldId:'text-89'},
 {page:'/product/19-11-26/',fieldId:'text-89'},
 {page:'/product/20-10-26/',fieldId:'text-94'},
 {page:'/product/23-10-2026/',fieldId:'text-93'},
 {page:'/product/27-10-26/',fieldId:'text-94'},
 {page:'/product/27-11-26/',fieldId:'text-89'},
 {page:'/product/30-10-2026/',fieldId:'text-93'},
 {page:'/product/30-11-26/',fieldId:'text-89'},
].map(row=>Object.freeze(row)));
export type ManagedProductField={kind:'occurrence';id:string;field:string;label:string}|{kind:'catalog';id:'source-product-7969';field:'currency';label:string;readOnly:true};
export function managedProductFields(page:string):{[fieldId:string]:ManagedProductField}{
 const result:{[fieldId:string]:ManagedProductField}={};for(const binding of currentProductBindings.filter(row=>row.page===page))for(const [field,id]of Object.entries(binding.fields))result[id]={kind:'occurrence',id:binding.id,field,label:seeds.get(binding.id)?.title||'מועד'};
 for(const binding of physicalProductPriceFields)if(binding.page===page)result[binding.fieldId]={kind:'catalog',id:'source-product-7969',field:'currency',label:'מטבע מחיר אבן התקומה',readOnly:true};return result;
}
/** Unified editor ownership; event prices share collections, while the physical
 * product's currency remains read-only until catalog projection is supported. */
export function managedPageFields(page:string){return {...managedCollectionFields(page),...managedProductFields(page)};}
type Attribute={name:string;value:string;start:number;end:number;valueStart:number;valueEnd:number};
type Node={tag:string;attrs:Map<string,Attribute>;start:number;openEnd:number;closeStart:number;end:number;parent?:Node};
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const whitespace=(c:string)=>c===' '||c==='\n'||c==='\r'||c==='\t'||c==='\f';
const nameChar=(c:string)=>!!c&&/[a-zA-Z0-9:_-]/.test(c);
/** Offset parser: quoted attributes, comments and raw script/style bodies are
 * consumed as units. It never executes source code or reserializes the DOM. */
function parse(html:string):Node[]{
 const nodes:Node[]=[],stack:Node[]=[],lower=html.toLowerCase();let cursor=0;
 while(cursor<html.length){const start=html.indexOf('<',cursor);if(start<0)break;if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);cursor=end<0?html.length:end+3;continue;}
  let at=start+1,closing=false;if(html[at]==='/'){closing=true;at++;}const nameStart=at;while(nameChar(html[at]))at++;if(at===nameStart){cursor=start+1;continue;}const tag=html.slice(nameStart,at).toLowerCase(),attrs=new Map<string,Attribute>();let complete=false;
  while(at<html.length){while(whitespace(html[at]))at++;if(html[at]==='>'){at++;complete=true;break;}if(html[at]==='/'&&html[at+1]==='>'){at+=2;complete=true;break;}const attrStart=at;while(at<html.length&&!whitespace(html[at])&&!['=','>','/'].includes(html[at]))at++;if(at===attrStart){at++;continue;}const name=html.slice(attrStart,at).toLowerCase();while(whitespace(html[at]))at++;let valueStart=at,valueEnd=at;
   if(html[at]==='='){at++;while(whitespace(html[at]))at++;const quote=html[at]==='"'||html[at]==="'"?html[at++]:null;valueStart=at;if(quote){while(at<html.length&&html[at]!==quote)at++;valueEnd=at;if(at<html.length)at++;}else{while(at<html.length&&!whitespace(html[at])&&html[at]!=='>')at++;valueEnd=at;}}
   if(!attrs.has(name))attrs.set(name,{name,value:html.slice(valueStart,valueEnd),start:attrStart,end:at,valueStart,valueEnd});
  }
  cursor=at;if(!complete)break;if(closing){const index=stack.map(node=>node.tag).lastIndexOf(tag);if(index>=0){stack[index].closeStart=start;stack[index].end=at;stack.splice(index);}continue;}
  const node:Node={tag,attrs,start,openEnd:at,closeStart:at,end:at,parent:stack.at(-1)};nodes.push(node);
  if(tag==='script'||tag==='style'||tag==='textarea'||tag==='title'){let close=lower.indexOf('</'+tag,at);while(close>=0&&nameChar(lower[close+tag.length+2]))close=lower.indexOf('</'+tag,close+2);if(close>=0){const end=html.indexOf('>',close);node.closeStart=close;node.end=end<0?html.length:end+1;cursor=node.end;}continue;}
  if(!voidTags.has(tag)&&html[at-2]!=='/')stack.push(node);
 }
 return nodes;
}
function decode(value:string){return value.replace(/&(#(?:x[a-f0-9]+|\d+)|amp|quot|apos|lt|gt);/gi,(all,key:string)=>{if(key[0]==='#'){const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):all;}return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[key.toLowerCase()]??all;});}
const escaped=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const attr=(node:Node,key:string)=>decode(node.attrs.get(key)?.value??'');
const hasClass=(node:Node,name:string)=>attr(node,'class').split(/\s+/).includes(name);
function within(node:Node,scope:Node){let current:Node|undefined=node;while(current){if(current===scope)return true;current=current.parent;}return false;}
function sourcePurchase(node:Node,productId:string){try{const url=new URL(attr(node,'href'),'https://derech-tkuma.com');return ['https://derech-tkuma.com','https://www.derech-tkuma.com','https://derech-tkuma-review.22yarden22.workers.dev'].includes(url.origin)&&!url.username&&!url.password&&url.searchParams.getAll('add-to-cart').length===1&&url.searchParams.get('add-to-cart')===productId;}catch{return false;}}
function sourcePage(value:unknown,page:string,fragment=''){if(typeof value!=='string')return false;try{const url=new URL(value);return ['https://derech-tkuma.com','https://www.derech-tkuma.com','https://derech-tkuma-review.22yarden22.workers.dev'].includes(url.origin)&&decodeURIComponent(url.pathname)===page&&!url.search&&url.hash===fragment;}catch{return false;}}
/** Existing event product presentation only. Missing/never-published records
 * preserve source bytes; drafts never enter the projection contract. */
export function projectPublishedProducts(html:string,page:string,records:readonly PublishedProjectionRecord[]):string{
 const bindings=currentProductBindings.filter(row=>row.page===page);if(!bindings.length)return html;const active=records.filter(row=>row.publishedVersion>0),tree=parse(html),edits:{start:number;end:number;value:string}[]=[];
 const add=(start:number,end:number,value:string)=>{if(html.slice(start,end)!==value)edits.push({start,end,value});};
 const unique=(nodes:Node[])=>nodes.length===1?nodes[0]:undefined;
 const field=(id:string,scope:Node)=>unique(tree.filter(node=>attr(node,'data-edit-id')===id&&within(node,scope)));
 const leaf=(node:Node|undefined,value:string)=>{if(node&&node.closeStart>=node.openEnd&&!tree.some(child=>child.parent===node))add(node.openEnd,node.closeStart,escaped(value));};
 function disable(link:Node,cta:Node){let opening=html.slice(link.start,link.openEnd);const remove=['href','data-product_id','data-product-id','data-add-to-cart','data-quantity','data-product_sku','data-product-sku','aria-disabled','tabindex','inert'];for(const item of [...link.attrs.values()].filter(item=>remove.includes(item.name)).sort((a,b)=>b.start-a.start))opening=opening.slice(0,item.start-link.start)+opening.slice(item.end-link.start);opening=opening.slice(0,-1)+' aria-disabled="true" tabindex="-1" inert>';add(link.start,link.openEnd,opening);leaf(cta,'המועד אינו זמין כרגע');}
 function metadata(initial:Occurrence,current:Occurrence){if(initial.dateLabel===current.dateLabel)return;const prefix=initial.dateLabel+' - ',rename=(value:string)=>value.startsWith(prefix)?current.dateLabel+value.slice(initial.dateLabel.length):value;
  for(const node of tree){if(node.tag==='title'){const old=decode(html.slice(node.openEnd,node.closeStart)),next=rename(old);if(old!==next)leaf(node,next);}if(node.tag==='meta'&&['og:title','twitter:title'].includes(attr(node,'property')||attr(node,'name'))){const value=node.attrs.get('content');if(value){const old=decode(value.value),next=rename(old);if(old!==next)add(value.valueStart,value.valueEnd,escaped(next));}}
   if(node.tag!=='script'||attr(node,'type')!=='application/ld+json')continue;let value:unknown;try{value=JSON.parse(html.slice(node.openEnd,node.closeStart));}catch{continue;}if(!value||typeof value!=='object'||Array.isArray(value))continue;const graph=(value as {'@graph'?:unknown})['@graph'];if(!Array.isArray(graph))continue;let changed=false;
   for(const item of graph){if(!item||typeof item!=='object')continue;const row=item as Record<string,unknown>;if(row['@type']==='WebPage'&&sourcePage(row.url,page)&&typeof row.name==='string'){const next=rename(row.name);if(next!==row.name){row.name=next;changed=true;}}
    if(row['@type']==='BreadcrumbList'&&sourcePage(row['@id'],page,'#breadcrumb')&&Array.isArray(row.itemListElement))for(const element of row.itemListElement){if(element&&typeof element==='object'&&element.name===initial.dateLabel){element.name=current.dateLabel;changed=true;}}
   }
   if(changed)add(node.openEnd,node.closeStart,JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')));
  }
 }
 for(const binding of bindings){const record=active.find(row=>row.kind==='occurrence'&&row.id===binding.id);if(!record)continue;const initial=seeds.get(binding.id);if(!initial)continue;const scope=unique(tree.filter(node=>hasClass(node,binding.scopeClass)));if(!scope)continue;const cta=field(binding.purchaseField,scope);if(!cta)continue;let link:Node|undefined=cta.parent;while(link&&link!==scope&&link.tag!=='a')link=link.parent;if(!link||link===scope||!hasClass(link,'elementor-button')||!sourcePurchase(link,binding.productId))continue;
  const linkedTour=active.find(row=>row.kind==='tour'&&row.id===(record.published as Occurrence|null)?.tourId);if(record.published===null||linkedTour?.published===null){disable(link,cta);continue;}const content=validateContent('occurrence',record.published) as Occurrence;
  for(const key of ['title','dateLabel','note'] as const){const id=binding.fields[key];if(id&&content[key]!==initial[key])leaf(field(id,scope),String(content[key]??''));}
  if(content.priceMinor!==initial.priceMinor){const currency=field(binding.fields.priceMinor,scope),bdi=currency?.parent;if(currency&&bdi&&(hasClass(bdi,'woocommerce-Price-amount')||bdi.tag==='bdi'&&!!bdi.parent&&hasClass(bdi.parent,'woocommerce-Price-amount'))&&decode(html.slice(currency.openEnd,currency.closeStart))==='₪'){let start=currency.end;while(whitespace(html[start]))start++;let end=start;while(/[0-9.,]/.test(html[end]??'')&&end<bdi.closeStart)end++;if(end>start&&/^[0-9][0-9,.]*$/.test(html.slice(start,end)))add(start,end,(content.priceMinor/100).toFixed(2));}}
  if(binding.main)metadata(initial,content);
 }
 let output=html;for(const edit of edits.sort((a,b)=>b.start-a.start)){output=output.slice(0,edit.start)+edit.value+output.slice(edit.end);}return output;
}
