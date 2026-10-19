"""Derive current typed seed/bindings from pinned source HTML. No network or writes to CMS."""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape
import json,re,hashlib
R=Path(__file__).resolve().parents[1];pages=json.loads((R/'lib/generated-pages.json').read_text());provenance=json.loads((R/'source-pages/provenance.json').read_text())
VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Tree(HTMLParser):
 def __init__(self,s):
  super().__init__(convert_charrefs=False);self.s=s;self.nodes=[];self.stack=[];self.lines=[0]
  for m in re.finditer('\n',s):self.lines.append(m.end())
 def pos(self):r,c=self.getpos();return self.lines[r-1]+c
 def handle_starttag(self,t,a):
  n={'tag':t,'attrs':dict(a),'start':self.pos(),'openEnd':self.pos()+len(self.get_starttag_text()),'parent':self.stack[-1] if self.stack else None};self.nodes.append(n)
  if t not in VOID:self.stack.append(n)
  else:n['end']=n['openEnd'];n['closeStart']=n['openEnd']
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i]['tag']==t:
    n=self.stack[i];n['closeStart']=self.pos();n['end']=self.s.find('>',self.pos())+1;del self.stack[i:];return
 def text(self,n):return unescape(re.sub('<[^>]*>','',self.s[n['openEnd']:n.get('closeStart',n['openEnd'])]))
def html(page):return page['shellPrefix']+''.join(x['html']for x in page['sections'])+page['shellSuffix']
records=[];bindings=[]
def provenance_for(slug):
 p=provenance['pages'][slug];return {'sourceUrl':p['sourceUrl'],'sourceHash':p['sourceSha256'],'capturedAt':p['capturedAt'],'canonical':p['canonical']}
def field(slug,fid,key,kind,id,**extra):bindings.append({'page':slug,'kind':kind,'id':id,'field':key,'fieldId':fid,'selector':'[data-edit-id="'+fid+'"]',**extra})
route_specs=[('route-points','/maslulim/נקודות-החיבור/'),('route-oz','/maslulim/עוז-מול-תופת/'),('route-contact','/maslulim/קו-המגע/')]
for id,slug in route_specs:
 page=pages[slug];title=page['fields']['text-62']['value'];description=page['fields'].get('text-67',{}).get('value','');description=description if not description.startswith('לקביעת') else ''
 content={'title':title,'slug':slug.strip('/').split('/')[-1],'sourcePath':slug,'description':description,'image':'','imageAlt':''}
 records.append({'kind':'tour','id':id,'content':content,'provenance':provenance_for(slug),'unknownFields':['image','imageAlt']})
 field(slug,'text-62','title','tour',id)
 if description:field(slug,'text-67','description','tour',id)
 for other,p in pages.items():
  if other not in ['/','/המסלולים/']+ [s for _,s in route_specs]:continue
  for fid,x in p['fields'].items():
   if x['type']=='text' and x['value']=='מסלול '+title:field(other,fid,'title','tour',id,prefix='מסלול ')
 # Prefer the source overview's actual route-card image, rather than a shared logo or inferred hero.
 overview=pages['/המסלולים/'];overview_html=html(overview);overview_tree=Tree(overview_html);overview_tree.feed(overview_html)
 headings=[n for n in overview_tree.nodes if n['attrs'].get('data-edit-id') and overview_tree.text(n)=='מסלול '+title]
 for heading in headings:
  parent=heading.get('parent')
  while parent:
   classes=parent['attrs'].get('class','').split();card_class=next((x for x in classes if re.fullmatch('jet-listing-dynamic-post-\d+',x)),None)
   if card_class:
    images=[n for n in overview_tree.nodes if n['tag']=='img' and parent['start']<n['start']<parent.get('end',0)]
    if images:
     attrs=images[0]['attrs']
     if not content['image']:content['image']=attrs.get('data-lazy-src') or attrs.get('data-src') or attrs.get('src','');content['imageAlt']=attrs.get('alt','')
     binding={'page':'/המסלולים/','kind':'tour','id':id,'field':'image','fieldId':attrs['data-image-id'],'selector':'[data-image-id="'+attrs['data-image-id']+'"]'}
     if binding not in bindings:bindings.append(binding)
     visibility={'page':'/המסלולים/','kind':'tour','id':id,'field':'visibility','selector':'.'+card_class,'cardClass':card_class}
     if visibility not in bindings:bindings.append(visibility)
     records[-1]['unknownFields']=[]
    else:
     background=heading.get('parent')
     while background and background is not parent:
      if 'e-con' in background['attrs'].get('class','').split() and background['attrs'].get('data-id'):
       background_class='elementor-element-'+background['attrs']['data-id'];bindings.append({'page':'/המסלולים/','kind':'tour','id':id,'field':'image','selector':'.'+card_class+' .'+background_class,'cardClass':card_class,'backgroundClass':background_class});break
      background=background.get('parent')
     visibility={'page':'/המסלולים/','kind':'tour','id':id,'field':'visibility','selector':'.'+card_class,'cardClass':card_class}
     if visibility not in bindings:bindings.append(visibility)
    break
   parent=parent.get('parent')
# The open tour is its own definition. The source never proves that every dated product is a particular route.
slug='/סיורים/';page=pages[slug];content={'title':page['fields']['text-67']['value'],'slug':'סיורים','sourcePath':slug,'description':'','image':'','imageAlt':''};records.append({'kind':'tour','id':'open-tour','content':content,'provenance':provenance_for(slug),'unknownFields':['image','imageAlt']});field(slug,'text-67','title','tour','open-tour')
s=html(page);tree=Tree(s);tree.feed(s)
for card in [n for n in tree.nodes if n['tag']=='div' and 'e-loop-item' in n['attrs'].get('class','').split() and 'product' in n['attrs'].get('class','').split()]:
 inner=[n for n in tree.nodes if card['start']<n['start']<card.get('end',0)];dated=[n for n in inner if re.fullmatch(r'\d{2}/\d{2}/(?:\d{2}|\d{4})',tree.text(n))]
 if not dated:continue
 date_node=dated[0];literal=tree.text(date_node);d,m,y=literal.split('/');iso=('20'+y if len(y)==2 else y)+'-'+m+'-'+d
 title_node=next(n for n in inner if n['attrs'].get('data-edit-id') and tree.text(n).startswith('סיור בעוטף ביום'))
 currency=next(n for n in inner if 'woocommerce-Price-currencySymbol' in n['attrs'].get('class',''));price_match=re.match(r'([\d,.]+)',s[currency['end']:]);assert price_match
 price=price_match.group(1);product=re.search(r'\be-loop-item-(\d+)\b',card['attrs']['class']).group(1);id='source-product-'+product
 note_nodes=[n for n in inner if n['attrs'].get('data-edit-id') and (tree.text(n).startswith('סיור כולל הסעה') or tree.text(n)=='יום בחירות')];note=tree.text(note_nodes[0])if note_nodes else ''
 content={'tourId':'open-tour','title':tree.text(title_node),'date':iso,'dateLabel':literal,'startsAt':None,'endsAt':None,'timezone':'Asia/Jerusalem','meetingPoint':'','priceMinor':round(float(price.replace(',',''))*100),'currency':'ILS','capacity':None,'note':note}
 records.append({'kind':'occurrence','id':id,'content':content,'provenance':{**provenance_for(slug),'productId':product,'dateLiteral':literal,'priceLiteral':price},'unknownFields':['startsAt','endsAt','capacity','meetingPoint'],'cardSelector':'.e-loop-item-'+product})
 field(slug,title_node['attrs']['data-edit-id'],'title','occurrence',id);field(slug,date_node['attrs']['data-edit-id'],'dateLabel','occurrence',id)
 bindings.append({'page':slug,'kind':'occurrence','id':id,'field':'priceMinor','selector':'.e-loop-item-'+product+' .woocommerce-Price-amount','currencyFieldId':currency['attrs']['data-edit-id'],'sourceLiteral':price})
 bindings.append({'page':slug,'kind':'occurrence','id':id,'field':'visibility','selector':'.e-loop-item-'+product,'cardClass':'e-loop-item-'+product})
 if note_nodes:field(slug,note_nodes[0]['attrs']['data-edit-id'],'note','occurrence',id)
assert len([x for x in records if x['kind']=='occurrence'])==6
expected=[('2026-10-16',17000),('2026-10-18',17000),('2026-10-20',24900),('2026-10-23',17000),('2026-10-27',17000),('2026-10-30',17000)]
assert [(x['content']['date'],x['content']['priceMinor'])for x in records if x['kind']=='occurrence']==expected
out={'version':1,'sourceCapturedAt':provenance['capturedAt'],'records':records,'bindings':bindings,'notes':['Only existing imported records have source-card bindings. New records require an explicit presentation binding.','Unknown source times, exact meeting points and capacities are not inferred.','Open-tour dated products are not assumed to equal a particular route.','Source payments/forms remain disabled by the existing review guard.']};(R/'lib/current-collections.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'tours':4,'occurrences':6,'bindings':len(bindings)}))
