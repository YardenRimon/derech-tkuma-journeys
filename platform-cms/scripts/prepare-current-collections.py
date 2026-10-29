"""Derive current typed seed/bindings from pinned source HTML. No network or writes to CMS."""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape
import argparse,json,re,hashlib
R=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pages',type=Path,default=R/'lib/generated-pages.json')
parser.add_argument('--provenance',type=Path,default=R/'source-pages/provenance.json')
parser.add_argument('--output',type=Path,default=R/'lib/current-collections.json')
args=parser.parse_args();pages=json.loads(args.pages.read_text());provenance=json.loads(args.provenance.read_text())
# Each accepted snapshot keeps its exact public product/date/price contract.
legacy_expected=[('7844','2026-10-16','16/10/26',17000),('7920','2026-10-18','18/10/26',17000),('7681','2026-10-20','20/10/26',24900),('7899','2026-10-23','23/10/2026',17000),('7882','2026-10-27','27/10/26',17000),('7891','2026-10-30','30/10/2026',17000)]
current_expected=legacy_expected[2:]+[('8249','2026-11-03','03/11/26',17000),('8251','2026-11-13','13/11/26',17000),('8253','2026-11-19','19/11/26',17000),('8255','2026-11-27','27/11/26',17000),('8257','2026-11-30','30/11/26',17000)]
if provenance.get('snapshotId')=='wordpress-public-20261028':
 assert provenance['capturedAt'].startswith('2026-10-28') and provenance['logicalPageCount']==51 and len(pages)==51,'current_snapshot_identity_changed'
 expected=current_expected
else:
 assert provenance.get('snapshotId') is None and provenance['capturedAt']=='2026-10-19T17:35:54.172502+00:00' and provenance['logicalPageCount']==37 and len(pages)==37,'unreviewed_collection_snapshot'
 expected=legacy_expected
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
def ancestors(n):
 while n:
  yield n;n=n.get('parent')
def leaf_fields(page,tree):
 result=[]
 for n in tree.nodes:
  fid=n['attrs'].get('data-edit-id')
  if not fid:continue
  source=page['fields'][fid]
  if source['type']!='text':continue
  assert source['value']==tree.text(n),'source_field_dom_mismatch'
  # Editable fields must be leaves, so an enclosing container cannot become a binding.
  if any(child['parent'] is n for child in tree.nodes):continue
  result.append(n)
 return result
def heading_field(page,tree,title):
 matches=[n for n in leaf_fields(page,tree) if tree.text(n)==title and any(re.fullmatch('h[1-6]',a['tag']) for a in ancestors(n))]
 assert len(matches)==1,'unique_semantic_heading_required: '+title
 return matches[0]
def route_description(page,tree,title_node):
 leaves=leaf_fields(page,tree)
 ctas=[n for n in leaves if n['start']>title_node['start'] and tree.text(n).startswith('לקביעת סיור במסלול')]
 assert ctas,'route_cta_missing'
 first_cta=min(n['start'] for n in ctas)
 matches=[n for n in leaves if title_node['end']<=n['start']<first_cta and any(a['attrs'].get('data-widget_type')=='text-editor.default' for a in ancestors(n)) and tree.text(n).strip()]
 assert len(matches)<=1,'ambiguous_route_intro'
 return matches[0] if matches else None
records=[];bindings=[]
def provenance_for(slug):
 p=provenance['pages'][slug];return {'sourceUrl':p['sourceUrl'],'sourceHash':p['sourceSha256'],'capturedAt':p['capturedAt'],'canonical':p['canonical']}
def field(slug,fid,key,kind,id,**extra):bindings.append({'page':slug,'kind':kind,'id':id,'field':key,'fieldId':fid,'selector':'[data-edit-id="'+fid+'"]',**extra})
route_specs=[('route-points','/maslulim/נקודות-החיבור/'),('route-oz','/maslulim/עוז-מול-תופת/'),('route-contact','/maslulim/קו-המגע/')]
for id,slug in route_specs:
 page=pages[slug];s=html(page);route_tree=Tree(s);route_tree.feed(s);title=slug.strip('/').split('/')[-1].replace('-',' ');title_node=heading_field(page,route_tree,title);description_node=route_description(page,route_tree,title_node);description=route_tree.text(description_node) if description_node else ''
 assert description==('מסלול תמציתי וממוקד שמביא את הסיפור בשלוש תחנות עוצמתיות' if id=='route-points' else ''),'route_intro_source_changed'
 content={'title':title,'slug':slug.strip('/').split('/')[-1],'sourcePath':slug,'description':description,'image':'','imageAlt':''}
 records.append({'kind':'tour','id':id,'content':content,'provenance':provenance_for(slug),'unknownFields':['image','imageAlt']})
 field(slug,title_node['attrs']['data-edit-id'],'title','tour',id)
 if description_node:field(slug,description_node['attrs']['data-edit-id'],'description','tour',id)
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
slug='/סיורים/';page=pages[slug];s=html(page);tree=Tree(s);tree.feed(s);open_title=heading_field(page,tree,'סיור פתוח - הרשמה כאן');content={'title':tree.text(open_title),'slug':'סיורים','sourcePath':slug,'description':'','image':'','imageAlt':''};records.append({'kind':'tour','id':'open-tour','content':content,'provenance':provenance_for(slug),'unknownFields':['image','imageAlt']});field(slug,open_title['attrs']['data-edit-id'],'title','tour','open-tour')
s=html(page);tree=Tree(s);tree.feed(s)
for card in [n for n in tree.nodes if n['tag']=='div' and 'e-loop-item' in n['attrs'].get('class','').split() and 'product' in n['attrs'].get('class','').split()]:
 inner=[n for n in tree.nodes if card['start']<n['start']<card.get('end',0)];dated=[n for n in inner if n['attrs'].get('data-edit-id') and re.fullmatch(r'\d{2}/\d{2}/(?:\d{2}|\d{4})',tree.text(n))]
 if not dated:continue
 assert len(dated)==1,'ambiguous_dated_card'
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
assert [(x['provenance']['productId'],x['content']['date'],x['content']['dateLabel'],x['content']['priceMinor'])for x in records if x['kind']=='occurrence']==expected,'snapshot_occurrences_changed'
assert all(x['id']!='source-product-7969' for x in records),'physical_product_is_not_an_occurrence'
out={'version':1,'sourceCapturedAt':provenance['capturedAt'],'records':records,'bindings':bindings,'notes':['Only existing imported records have source-card bindings. New records require an explicit presentation binding.','Unknown source times, exact meeting points and capacities are not inferred.','Open-tour dated products are not assumed to equal a particular route.','Source payments/forms remain disabled by the existing review guard.']};args.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'tours':4,'occurrences':len(expected),'bindings':len(bindings)}))
