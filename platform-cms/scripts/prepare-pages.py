"""Build source-preserving CMS templates from pinned, current public captures.

Normal builds use only checked-in gzip fixtures. --import-source refreshes those
fixtures from the local authoritative capture inventory; it never fetches URLs.
Raw captures are never copied to public/. Character-offset review patches are
recorded so tests can reconstruct every transformed byte from the source.
"""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape, escape
import json, re, hashlib, gzip, sys
ROOT=Path(__file__).resolve().parents[1]
FIXTURES=ROOT/'source-pages'
CAPTURE=ROOT.parent/'migration/source-2026-10-19'
PROVENANCE=FIXTURES/'provenance.json'
VOID={'img','br','hr','meta','link','input','source','area','base','embed','param','track','wbr'}
EDIT={'h1','h2','h3','h4','h5','h6','p','span','a','li','strong','b','label','button'}
POLICY=("default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
        "media-src 'self' data: blob:; connect-src 'self'; "
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; "
        "form-action 'none'; base-uri 'self'")
PROTECTION=('<meta name="robots" content="noindex,nofollow,noarchive" data-pilot-policy="current-source-review">'
            '<meta name="referrer" content="strict-origin-when-cross-origin">'
            '<meta http-equiv="Content-Security-Policy" content="'+escape(POLICY,quote=True)+'">'
            '<script src="/__pilot__/guard.js" data-pilot-policy="guard-first"></script>')
TRACKING=re.compile(r'googletagmanager|google-analytics|google-analytics-for-wordpress|monsterinsights|__gtagTracker|GoogleAnalyticsObject|\bgtag\s*\(|\bfbq\s*\(|fbevents|hotjar|clarity\.ms|maspik-signals|pixel\.',re.I)
PAYMENT=re.compile(r'meshulam[_-]payment|configureGrowSdk|\bGrowSDK\b|grow-sdk|grow\.payments',re.I)
ORIGIN=re.compile(r'(?:https?:)?//(?:www\.)?derech-tkuma\.com(?=/|[\s\"\'<>)]|$)',re.I)
ESCAPED_ORIGIN=re.compile(r'https?:\\/\\/(?:www\.)?derech-tkuma\.com(?=\\/|[\"\']|$)',re.I)
sha=lambda value:hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
def localize(value):
 value=ESCAPED_ORIGIN.sub(lambda m:'' if m.string[m.end():].startswith(r'\/') else r'\/',value)
 return ORIGIN.sub(lambda m:'' if m.string[m.end():].startswith('/') else '/',value)
def logical_route(value):
 return '/' if value=='/' else value.rstrip('/')+'/'
def fixture_name(slug):return 'current-'+sha(slug)[:20]+'.html.gz'

class Locations(HTMLParser):
 def __init__(self,html):
  super().__init__(convert_charrefs=False);self.html=html;self.lines=[0]
  for m in re.finditer('\n',html):self.lines.append(m.end())
 def source_offset(self):
  row,col=self.getpos();return self.lines[row-1]+col

class ReviewTransform(Locations):
 def __init__(self,html):super().__init__(html);self.patches=[];self.inline=None;self.protected=False
 def add(self,start,end,replacement,kind):
  if kind=='own-site-url':
   # Record only the replaced origin spans, rather than duplicating large
   # Elementor tags/styles/runtime bodies in build provenance.
   before=self.html[start:end]
   for pattern,slash in [(ESCAPED_ORIGIN,r'\/'),(ORIGIN,'/')]:
    for match in pattern.finditer(before):
     changed='' if before[match.end():].startswith(slash) else slash
     old=match.group(0);self.patches.append({'start':start+match.start(),'end':start+match.end(),'replacement':changed,'kind':kind,'beforeSha256':sha(old)})
   return
  if self.html[start:end]!=replacement:self.patches.append({'start':start,'end':end,'replacement':replacement,'kind':kind,'beforeSha256':sha(self.html[start:end])})
 def handle_starttag(self,tag,attrs):
  start=self.source_offset();raw=self.get_starttag_text();attrs=dict(attrs)
  if tag=='head' and not self.protected:self.add(start+len(raw),start+len(raw),PROTECTION,'review-protection');self.protected=True
  # Canonical/schema identity remains the original captured source identity.
  if not(tag=='link' and 'canonical' in (attrs.get('rel') or '').split()):self.add(start,start+len(raw),localize(raw),'own-site-url')
  if tag in {'script','style'}:self.inline={'tag':tag,'start':start,'content':start+len(raw),'attrs':attrs}
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs)
 def handle_endtag(self,tag):
  if not self.inline or tag!=self.inline['tag']:return
  node=self.inline;self.inline=None;end=self.source_offset();close=self.html.find('>',end)+1
  body=self.html[node['content']:end];whole=self.html[node['start']:close]
  if tag=='script' and (TRACKING.search(whole) or PAYMENT.search(whole)):
   self.patches=[x for x in self.patches if x['kind']=='review-protection' or not(node['start']<=x['start']<close)]
   reason='payment' if PAYMENT.search(whole) else 'tracking'
   self.add(node['start'],close,'<!-- pilot-disabled-'+reason+'-script sha256='+sha(whole)+' -->','disabled-'+reason+'-script')
  elif node['attrs'].get('type') not in {'application/ld+json','application/json'}:self.add(node['content'],end,localize(body),'own-site-url')
 def transform(self):
  self.feed(self.html)
  if not self.protected:raise ValueError('source lacks head')
  result=self.html
  for patch in sorted(self.patches,key=lambda x:(x['start'],x['end']),reverse=True):result=result[:patch['start']]+patch['replacement']+result[patch['end']:]
  return result,sorted(self.patches,key=lambda x:(x['start'],x['end']))

class Annotator(Locations):
 def __init__(self,html):super().__init__(html);self.stack=[];self.nodes=[];self.images=[]
 def handle_starttag(self,tag,attrs):
  pos=self.source_offset();raw=self.get_starttag_text();attrs=dict(attrs)
  if self.stack:self.stack[-1]['child']=True
  if tag=='img' and attrs.get('src'):self.images.append((pos,raw,attrs))
  if tag not in VOID:self.stack.append({'tag':tag,'start':pos,'raw':raw,'content':pos+len(raw),'child':False,'hidden':tag in {'script','style','template','noscript'} or any(n['hidden'] for n in self.stack)})
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs)
 def handle_endtag(self,tag):
  at=next((i for i in range(len(self.stack)-1,-1,-1) if self.stack[i]['tag']==tag),None)
  if at is None:return
  node=self.stack[at];del self.stack[at:]
  if tag in EDIT and not node['child'] and not node['hidden']:
   text=self.html[node['content']:self.source_offset()]
   if unescape(text).strip() and '<' not in text:node['text']=unescape(text);self.nodes.append(node)
 def annotate(self):
  fields={};edits=[]
  for n in sorted(self.nodes,key=lambda n:n['start']):
   fid=f'text-{len(fields)+1}';fields[fid]={'type':'text','value':n['text']};edits.append((n['start']+len(n['raw'])-1,f' data-edit-id="{fid}"'))
  for pos,raw,attrs in self.images:
   fid=f'image-{len(fields)+1}';fields[fid]={'type':'image','value':attrs['src'],'alt':attrs.get('alt','')};insert=pos+len(raw)-(2 if raw.endswith('/>') else 1);edits.append((insert,f' data-image-id="{fid}"'))
  result=self.html
  for pos,insert in sorted(edits,reverse=True):result=result[:pos]+insert+result[pos:]
  return result,fields

def import_source():
 inventory=json.loads((CAPTURE/'inventory.json').read_text());records={};aliases=[]
 for page in inventory['pages']:
  slug=logical_route(page['route'])
  if slug in records:aliases.append({'route':page['route'],'logicalRoute':slug,'url':page['url'],'sha256':page['source_sha256']});continue
  data=(CAPTURE/page['local_path']).read_bytes()
  if sha(data)!=page['source_sha256']:raise ValueError('source hash mismatch: '+slug)
  # UTF-8 byte preservation is required; no silent decoder replacement.
  data.decode('utf-8');fixture=fixture_name(slug);(FIXTURES/fixture).write_bytes(gzip.compress(data,mtime=0))
  receipt=next((x for x in inventory['receipts'] if x.get('local_path')==page['local_path']),{})
  records[slug]={'fixture':fixture,'sourceUrl':page['url'],'sourcePath':page['local_path'],'sourceSha256':page['source_sha256'],'sourceBytes':len(data),'canonical':page.get('canonical'),'capturedAt':receipt.get('started_at_utc'),'description':page.get('description',''),'title':page.get('title',[])}
 expected=inventory['coverage']['captured_html_logical_routes_without_trailing_slash_alias']
 if len(records)!=expected:raise ValueError('logical route coverage mismatch')
 # No public capture/audit document is copied to public/. These are build-only fixtures.
 return {'version':1,'origin':inventory['origin'],'capturedAt':inventory['captured_at_utc'],'logicalPageCount':len(records),'capturedHtmlCount':len(inventory['pages']),'aliases':aliases,'offsetUnit':'Unicode code points in original UTF-8 decoded source','protectionPolicy':POLICY,'pages':records}

def build():
 FIXTURES.mkdir(parents=True,exist_ok=True)
 provenance=import_source() if '--import-source' in sys.argv else json.loads(PROVENANCE.read_text())
 pages={};manifest={}
 for slug,record in provenance['pages'].items():
  raw=gzip.decompress((FIXTURES/record['fixture']).read_bytes());source=raw.decode('utf-8')
  if sha(raw)!=record['sourceSha256']:raise ValueError('fixture hash mismatch: '+slug)
  transformed,patches=ReviewTransform(source).transform();parser=Annotator(transformed);parser.feed(transformed);annotated,fields=parser.annotate()
  raw_parser=Annotator(source);raw_parser.feed(source);_,raw_fields=raw_parser.annotate()
  if [x['value'] for x in raw_fields.values() if x['type']=='text']!=[x['value'] for x in fields.values() if x['type']=='text']:raise ValueError('visible source text changed: '+slug)
  body_start=re.search(r'<body\b[^>]*>',annotated,re.I);body_end=re.search(r'</body\s*>',annotated,re.I)
  if not body_start or not body_end:raise ValueError(slug+' lacks body')
  title=re.search(r'<title>(.*?)</title>',source,re.S|re.I);relative='index.html' if slug=='/' else slug.strip('/')+'/index.html'
  pages[slug]={'title':unescape(title.group(1)) if title else slug,'description':record.get('description',''),'page':relative,'sections':[{'id':'source-body','html':annotated[body_start.end():body_end.start()]}],'fields':fields,'shellPrefix':annotated[:body_start.end()],'shellSuffix':annotated[body_end.start():]}
  record.update(reviewSha256=sha(transformed),textFields=sum(f['type']=='text' for f in fields.values()),imageFields=sum(f['type']=='image' for f in fields.values()),patches=patches,sourceTextValuesSha256=sha(json.dumps([x['value'] for x in raw_fields.values() if x['type']=='text'],ensure_ascii=False,separators=(',',':'))),sourceImageValuesSha256=sha(json.dumps([x['value'] for x in raw_fields.values() if x['type']=='image'],ensure_ascii=False,separators=(',',':'))))
  manifest[slug]={'source':relative,'fixture':record['fixture'],'sha256':sha(transformed),'sourceSha256':record['sourceSha256'],'sourceUrl':record['sourceUrl'],'canonical':record['canonical'],'textFields':record['textFields'],'imageFields':record['imageFields'],'scriptBodiesPreservedExceptOwnSiteUrlsAndDisabledReviewIntegrations':True}
 (ROOT/'lib/generated-pages.json').write_text(json.dumps(pages,ensure_ascii=False,separators=(',',':'))+'\n')
 (ROOT/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 PROVENANCE.write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'logicalPages':len(pages),'sourceHtmlCaptures':provenance['capturedHtmlCount'],'aliases':len(provenance['aliases']),'textFields':sum(x['textFields'] for x in manifest.values()),'imageFields':sum(x['imageFields'] for x in manifest.values()),'source':'pinned current gzip fixtures','networkRequests':0,'rawSourcesCopiedToPublic':0}))
if __name__=='__main__':build()
