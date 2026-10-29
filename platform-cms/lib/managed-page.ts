import {validateContent,type Tour,type Occurrence} from './collection-core';
import {normalizeManagedPath,type ManagedPublicationEntry} from './managed-publication';
import source from './current-collections.json' with {type:'json'};
import previous from '../source-pages/previous-collections-20261019.json' with {type:'json'};
/** Pure public presentation. Entries come from the published registry; this
 * module never reads drafts, catalog/inventory, providers, or a clock. */
export class ManagedPageError extends Error{readonly status=503;constructor(){super('managed_page_unavailable');}}
export type ManagedDocumentOptions={parent?:{title:string;path:string}|null;children?:readonly ManagedPublicationEntry[];nextHref?:string|null;origin:string;indexable:boolean};
export type ManagedCardsOptions={heading:string;nextHref?:string|null;insertion?:'main'|'before-source-footer-1489'};
const escaped=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const knownSourceIds=new Set([...source.records,...previous.records].map(row=>row.kind+':'+row.id));knownSourceIds.add('occurrence:source-product-7969');
const sourceTourPaths=new Set([...source.records,...previous.records].filter(row=>row.kind==='tour').map(row=>'sourcePath' in row.content?row.content.sourcePath:''));
const origins=new Set(['https://derech-tkuma.com','https://derech-tkuma-review.22yarden22.workers.dev']);
function safeOrigin(origin:string){if(origins.has(origin))return true;try{const url=new URL(origin);return url.origin===origin&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}}
function fail():never{throw new ManagedPageError();}
function pathOnly(value:unknown):string|null{
 if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\s\u0000-\u001f\u007f?#\\<>"']/.test(value)||/%(?:2f|5c)/i.test(value))return null;
 let path:string;try{path=decodeURIComponent(value).normalize('NFC');}catch{return null;}
 if(/[\u0000-\u001f\u007f%?#\\<>"']/.test(path)||path.includes('//')||path.split('/').some(part=>part==='.'||part==='..'))return null;return path;
}
function knownLink(value:string,parent=false):string|null{
 const path=pathOnly(value);if(!path)return null;
 if(sourceTourPaths.has(path)||(!parent&&['/המסלולים/','/סיורים/'].includes(path)))return path;
 try{const normalized=normalizeManagedPath(path);return !parent||normalized.startsWith('/maslulim/')?normalized:null;}catch{return null;}
}
function nextLink(value:string|null|undefined){
 if(value==null)return '';if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.includes('#'))fail();
 let url:URL;try{url=new URL(value,'https://derech-tkuma.com');}catch{fail();}
 const path=knownLink(url.pathname);if(!path||url.origin!=='https://derech-tkuma.com'||url.username||url.password||[...url.searchParams.keys()].some(k=>k!=='managed_cursor')||url.searchParams.getAll('managed_cursor').length>1)fail();
 const cursor=url.searchParams.get('managed_cursor');if(cursor!==null&&!/^(tour|occurrence):(?:[a-f0-9]{2}){1,80}$/.test(cursor))fail();
 return path+(cursor===null?'':'?managed_cursor='+encodeURIComponent(cursor));
}
function safeImage(value:string){
 const path=pathOnly(value);if(!path)return null;
 if(/^\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(path))return value;
 return path.startsWith('/__source_assets__/wordpress-public-20261028/')&&path.length>'/__source_assets__/wordpress-public-20261028/'.length?value:null;
}
function entryPath(entry:ManagedPublicationEntry){
 if(!entry||!['tour','occurrence'].includes(entry.kind)||entry.template!==entry.kind||typeof entry.id!=='string'||knownSourceIds.has(entry.kind+':'+entry.id)||!Number.isSafeInteger(entry.publishedVersion)||entry.publishedVersion<1||!['published','withdrawn','parent_withdrawn'].includes(entry.state))fail();
 let path:string;try{path=normalizeManagedPath(entry.path);}catch{fail();}
 if(path!==entry.path||!(entry.kind==='tour'?path.startsWith('/maslulim/'):path.startsWith('/product/')))fail();return path;
}
const money=(minor:number)=>{if(!Number.isSafeInteger(minor)||minor<0)fail();return Math.floor(minor/100).toLocaleString('he-IL')+'.'+String(minor%100).padStart(2,'0')+' ₪';};
const titleOf=(entry:ManagedPublicationEntry,content:Tour|Occurrence)=>content.title||('dateLabel' in content?'מועד סיור · '+content.dateLabel:'סיור');
const css=`.managed-public{direction:rtl;box-sizing:border-box;width:100%;max-width:1140px;margin:0 auto;padding:clamp(24px,5vw,64px) 20px;color:var(--e-global-color-primary,#154332);font-family:inherit;overflow-wrap:anywhere}.managed-public *{box-sizing:border-box;min-width:0}.managed-public h1{font-size:clamp(30px,5vw,56px);line-height:1.2}.managed-public h2{font-size:clamp(24px,3vw,36px)}.managed-public p,.managed-public dd{line-height:1.7;white-space:pre-wrap}.managed-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:24px}.managed-card{padding:24px;background:var(--e-global-color-b66dc81,#F7EFE1);border-radius:16px;display:flex;flex-direction:column;gap:12px}.managed-public img{display:block;max-width:100%;width:100%;height:auto;max-height:540px;object-fit:cover;border-radius:12px}.managed-public .managed-link{display:inline-block;align-self:flex-start;padding:12px 22px;border-radius:32px;background:var(--e-global-color-primary,#154332);color:var(--e-global-color-b66dc81,#F7EFE1);text-decoration:none;max-width:100%;white-space:normal}.managed-public .managed-link:focus-visible{outline:3px solid var(--e-global-color-b5f1a0a,#B6855B);outline-offset:3px}.managed-notice{padding:16px;border-inline-start:4px solid var(--e-global-color-b5f1a0a,#B6855B);background:var(--e-global-color-b66dc81,#F7EFE1)}.managed-public dl{display:grid;grid-template-columns:minmax(0,160px) minmax(0,1fr);gap:12px}.managed-public dt{font-weight:700}.managed-public dd{margin:0}.managed-next{margin-block-start:24px}@media(max-width:500px){.managed-public dl{grid-template-columns:minmax(0,1fr);gap:8px}.managed-public dd{margin-block-end:12px}.managed-card{padding:20px}}`;
function image(tour:Tour){const url=safeImage(tour.image);return url?'<img src="'+escaped(url)+'" alt="'+escaped(tour.imageAlt)+'" loading="lazy" decoding="async">':'';}
function cards(entries:readonly ManagedPublicationEntry[]){
 const seen=new Map<string,string>(),paths=new Set<string>(),parts:string[]=[];
 for(const entry of entries){
  if(knownSourceIds.has(entry.kind+':'+entry.id))continue;
  const path=entryPath(entry),identity=entry.kind+':'+entry.id;
  if(seen.has(identity)){if(seen.get(identity)!==path)fail();continue;}if(paths.has(path))fail();seen.set(identity,path);paths.add(path);
  if(entry.state!=='published'||entry.content===null)continue;
  let content:Tour|Occurrence;try{content=validateContent(entry.kind,entry.content);}catch{fail();}
  const detail=entry.kind==='tour'?image(content as Tour)+'<p>'+escaped((content as Tour).description)+'</p>':'<p>'+escaped((content as Occurrence).dateLabel)+'</p><p>'+escaped(money((content as Occurrence).priceMinor))+'</p><p class="managed-notice">ההרשמה למועד זה אינה פתוחה כרגע.</p>';
  parts.push('<article class="managed-card" data-managed-item="'+escaped(identity)+'"><h3>'+escaped(titleOf(entry,content))+'</h3>'+detail+'<a class="managed-link" href="'+escaped(path)+'">'+(entry.kind==='tour'?'לפרטי הסיור':'לפרטי המועד')+'</a></article>');
 }
 return parts.join('');
}
// Offset parser respects quoted attributes, comments and script/style raw text.
// No source DOM is reserialized, and no source code is ever executed here.
type Node={tag:string;attrs:Map<string,string>;start:number;openEnd:number;closeStart:number;end:number};
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function nodes(html:string){const out:Node[]=[],stack:Node[]=[],lower=html.toLowerCase();let cursor=0;
 while(cursor<html.length){const start=html.indexOf('<',cursor);if(start<0)break;if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);cursor=end<0?html.length:end+3;continue;}let at=start+1,closing=false;if(html[at]==='/'){closing=true;at++;}const name=/^[a-zA-Z][\w:-]*/.exec(html.slice(at));if(!name){cursor=start+1;continue;}const tag=name[0].toLowerCase();at+=name[0].length;const attrs=new Map<string,string>();let complete=false;
  while(at<html.length){while(/\s/.test(html[at]??'')&&at<html.length)at++;if(html[at]==='>'){at++;complete=true;break;}if(html[at]==='/'&&html[at+1]==='>'){at+=2;complete=true;break;}const key=/^[^\s=/>]+/.exec(html.slice(at));if(!key){at++;continue;}at+=key[0].length;while(/\s/.test(html[at]??'')&&at<html.length)at++;let value='';if(html[at]==='='){at++;while(/\s/.test(html[at]??'')&&at<html.length)at++;const quote=html[at]==='"'||html[at]==="'"?html[at++]:null,from=at;if(quote){while(at<html.length&&html[at]!==quote)at++;value=html.slice(from,at);if(at<html.length)at++;}else{while(at<html.length&&!/\s|>/.test(html[at]))at++;value=html.slice(from,at);}}attrs.set(key[0].toLowerCase(),value);}
  cursor=at;if(!complete)break;if(closing){const index=stack.map(n=>n.tag).lastIndexOf(tag);if(index>=0){stack[index].closeStart=start;stack[index].end=at;stack.splice(index);}continue;}
  const node:Node={tag,attrs,start,openEnd:at,closeStart:at,end:at};out.push(node);
  if(['script','style','textarea','title'].includes(tag)){const pattern=new RegExp('</'+tag+'\\s*>','ig');pattern.lastIndex=at;const close=pattern.exec(lower);if(close){node.closeStart=close.index;node.end=pattern.lastIndex;cursor=node.end;}continue;}if(!voids.has(tag)&&html[at-2]!=='/')stack.push(node);
 }return out;
}
function mainOf(tree:Node[]){const main=tree.filter(n=>n.tag==='main');if(main.length!==1||main[0].end<=main[0].openEnd)fail();return main[0];}
function apply(html:string,edits:{start:number;end:number;value:string}[]){let result=html;for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.value+result.slice(edit.end);return result;}
export function appendManagedCards(shellHtml:string,entries:readonly ManagedPublicationEntry[],options:ManagedCardsOptions):string{
 const body=cards(entries),next=nextLink(options.nextHref);if(!body&&!next)return shellHtml;
 const tree=nodes(shellHtml);let insertion:number;if(options.insertion===undefined||options.insertion==='main')insertion=mainOf(tree).closeStart;else if(options.insertion==='before-source-footer-1489'){const footers=tree.filter(n=>n.tag==='footer'&&n.attrs.get('data-elementor-type')==='footer'&&n.attrs.get('data-elementor-id')==='1489'&&(n.attrs.get('class')??'').split(/\s+/).includes('elementor-location-footer'));if(tree.some(n=>n.tag==='main')||footers.length!==1)fail();insertion=footers[0].start;}else fail();return shellHtml.slice(0,insertion)+'<section class="managed-public" data-managed-cards="v1"><style>'+css+'</style><h2>'+escaped(options.heading)+'</h2><div class="managed-grid">'+body+'</div>'+(next?'<nav class="managed-next" aria-label="פריטים נוספים"><a class="managed-link" href="'+escaped(next)+'">לפריטים נוספים</a></nav>':'')+'</section>'+shellHtml.slice(insertion);
}
export function renderManagedDocument(shellHtml:string,entry:ManagedPublicationEntry,options:ManagedDocumentOptions):string{
 if(!safeOrigin(options.origin)||typeof options.indexable!=='boolean')fail();const path=entryPath(entry),tree=nodes(shellHtml),main=mainOf(tree),heads=tree.filter(n=>n.tag==='head');if(heads.length!==1||heads[0].end<=heads[0].openEnd)fail();
 const available=entry.state==='published'&&entry.content!==null;let title='הפריט אינו זמין כרגע',description='הפריט אינו זמין כרגע. אפשר לעיין בסיורים ובמועדים נוספים.',body='<h1>'+title+'</h1><p>הפריט אינו זמין כרגע.</p><a class="managed-link" href="/המסלולים/">לסיורים נוספים</a>';
 if(available){let content:Tour|Occurrence;try{content=validateContent(entry.kind,entry.content);}catch{fail();}title=titleOf(entry,content);
  if(entry.kind==='tour'){
   const tour=content as Tour;description=tour.description.replace(/\s+/g,' ').trim().slice(0,180)||tour.title;
   const children=(options.children??[]).filter(child=>child.kind==='occurrence'&&child.state==='published'&&child.content!==null&&(child.content as Occurrence).tourId===entry.id),childCards=cards(children),next=nextLink(options.nextHref);
   body='<h1>'+escaped(title)+'</h1>'+image(tour)+(tour.description?'<p>'+escaped(tour.description)+'</p>':'')+(childCards||next?'<section><h2>מועדי הסיור</h2><div class="managed-grid">'+childCards+'</div>'+(next?'<nav class="managed-next" aria-label="מועדים נוספים"><a class="managed-link" href="'+escaped(next)+'">למועדים נוספים</a></nav>':'')+'</section>':'<p>אין כרגע מועדים זמינים להצגה.</p>');
  }else{
   const item=content as Occurrence;description=[title,item.dateLabel,item.meetingPoint].filter(Boolean).join(' · ').slice(0,180);const parent=options.parent,href=parent?knownLink(parent.path,true):null;if(parent&&!href)fail();
   const time=(value:string|null)=>value?new Intl.DateTimeFormat('he-IL',{timeZone:item.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(value)):null,start=time(item.startsAt),end=time(item.endsAt);
   body='<h1>'+escaped(title)+'</h1>'+(parent&&href?'<p>הסיור: <a href="'+escaped(href)+'">'+escaped(parent.title)+'</a></p>':'')+'<dl><dt>תאריך</dt><dd>'+escaped(item.dateLabel)+'</dd><dt>מחיר</dt><dd>'+escaped(money(item.priceMinor))+'</dd>'+(start&&end?'<dt>שעות</dt><dd>'+escaped(start+'–'+end)+'</dd>':'')+(item.meetingPoint?'<dt>נקודת מפגש</dt><dd>'+escaped(item.meetingPoint)+'</dd>':'')+'</dl>'+(item.note?'<p>'+escaped(item.note)+'</p>':'')+'<p class="managed-notice">ההרשמה למועד זה אינה פתוחה כרגע.</p>';
  }
 }
 const fullTitle=title+' | דרך התקומה',canonical=new URL(path,options.origin).href,robots=options.indexable&&available?'index, follow':'noindex, nofollow, noarchive';
 const metadata='<title>'+escaped(fullTitle)+'</title><meta name="description" content="'+escaped(description)+'"><link rel="canonical" href="'+escaped(canonical)+'"><meta name="robots" content="'+robots+'"><meta property="og:type" content="website"><meta property="og:title" content="'+escaped(fullTitle)+'"><meta property="og:description" content="'+escaped(description)+'"><meta property="og:url" content="'+escaped(canonical)+'"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="'+escaped(fullTitle)+'"><meta name="twitter:description" content="'+escaped(description)+'">';
 const edits=[{start:main.start,end:main.end,value:'<main id="content" class="site-main managed-public" dir="rtl"><style>'+css+'</style>'+body+'</main>'},{start:heads[0].closeStart,end:heads[0].closeStart,value:metadata}];
 for(const node of tree){if(node.start>=main.start&&node.end<=main.end)continue;const name=(node.attrs.get('name')??'').toLowerCase(),property=(node.attrs.get('property')??'').toLowerCase(),rel=(node.attrs.get('rel')??'').toLowerCase().split(/\s+/);
  if(node.tag==='title'||node.tag==='script'&&(node.attrs.get('type')??'').toLowerCase()==='application/ld+json'||node.tag==='meta'&&(name==='description'||name==='robots'||name.startsWith('twitter:')||property.startsWith('og:')||property.startsWith('article:'))||node.tag==='link'&&(rel.includes('canonical')||rel.includes('shortlink')||rel.includes('alternate')&&/oembed|application\/(?:json|xml)\+oembed/i.test((node.attrs.get('href')??'')+' '+(node.attrs.get('type')??''))))edits.push({start:node.start,end:node.end,value:''});
 }
 return apply(shellHtml,edits);
}
