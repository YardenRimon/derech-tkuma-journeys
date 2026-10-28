"""Build source-preserving CMS templates from pinned, current public captures.

Normal builds use only checked-in gzip fixtures. --import-source refreshes those
fixtures from the local authoritative capture inventory; it never fetches URLs.
Raw captures are never copied to public/. Character-offset review patches are
recorded so tests can reconstruct every transformed byte from the source.
"""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape, escape
import json, re, hashlib, gzip, sys, runpy
from urllib.parse import urlsplit, unquote, quote
import posixpath
ROOT=Path(__file__).resolve().parents[1]
FIXTURES=ROOT/'source-pages'
CAPTURE=ROOT.parent/'migration/source-2026-10-19'
PROVENANCE=FIXTURES/'provenance.json'
IDENTITIES=FIXTURES/'field-identities.json'
identity_api=runpy.run_path(str(ROOT/'scripts/field-identities.py'))
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

SNAPSHOT_TRACKING=re.compile(TRACKING.pattern+r'|sourcebuster|(?:woocommerce/assets/js/frontend/|wc-)order-attribution(?:\.min)?(?:\.js)?',re.I)
VENDOR_KEY=re.compile(r'_external/cdnjs\.cloudflare\.com/ajax/libs/font-awesome/6\.0\.0/(?:css/all\.min\.css|webfonts/fa-(?:brands-400|regular-400|solid-900|v4compatibility)\.(?:woff2|ttf))')
ASSET_TOKEN=re.compile(r"(?<![\w./:\\-])(?:(?:https?:)?//(?:www\.)?derech-tkuma\.com)?/(?:wp-content|wp-includes)/[^\s\"'<>),\\]+",re.I)
PINNED_TRUSTINDEX_KEYS=frozenset(
 ['_external/cdn.trustindex.io/assets/fonts/poppins/'+name for name in ('devanagari-600.woff2','devanagari-italic-600.woff2','devanagari-italic.woff2','devanagari.woff2','latin-600.woff2','latin-ext-600.woff2','latin-ext-italic-600.woff2','latin-ext-italic.woff2','latin-ext.woff2','latin-italic-600.woff2','latin-italic.woff2','latin.woff2')]
 +['_external/cdn.trustindex.io/assets/icon/'+name for name in ('ti-info-light.svg','ti-info-regular.svg','ti-quote.svg','ti-verified-black.svg','ti-verified-green.svg','ti-verified.svg')]
 +['_external/cdn.trustindex.io/assets/img/loading_dots.gif','_external/cdn.trustindex.io/assets/platform/Trustindex/icon.svg','_external/cdn.trustindex.io/assets/platform/Trustindex/star/s.svg'])

def validate_asset_map(value,snapshot_id=None):
 if not isinstance(value,dict) or set(value)!={'version','snapshotId','namespace','paths','excludedPaths','manifestSha256'}:raise ValueError('invalid public asset map schema')
 sid=value['snapshotId']
 if type(value['version']) is not int or value['version']!=1 or not isinstance(sid,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}',sid) or snapshot_id is not None and sid!=snapshot_id:raise ValueError('asset map snapshot mismatch')
 namespace='/__source_assets__/'+sid
 if value['namespace'] not in (namespace,namespace+'/') or not isinstance(value['manifestSha256'],str) or not re.fullmatch('[a-f0-9]{64}',value['manifestSha256']):raise ValueError('invalid asset map namespace or manifest pin')
 def safe(path):
  return isinstance(path,str) and path and not path.startswith('/') and '\\' not in path and not re.search(r'[\x00-\x1f\x7f?#]',path) and not re.search(r'%[0-9a-f]{2}',path,re.I) and all(part not in ('','.','..') for part in path.split('/'))
 if not isinstance(value['paths'],dict) or not isinstance(value['excludedPaths'],list) or any(not isinstance(path,str) for path in value['excludedPaths']) or len(set(value['excludedPaths']))!=len(value['excludedPaths']):raise ValueError('invalid asset map paths')
 frozen_path=ROOT/'public-assets-manifest.json'
 frozen={entry['path'] for entry in json.loads(frozen_path.read_text())['files']} if frozen_path.exists() else set()
 for path,target in value['paths'].items():
  if not safe(path) or not isinstance(target,str) or not target.startswith(namespace+'/') or not safe(target[len(namespace)+1:]):raise ValueError('unsafe asset map path')
  # CDN exceptions are exact pinned Font Awesome6 fonts, never arbitrary hosts.
  for item in (path,target[len(namespace)+1:]):
   if not item.startswith(('wp-content/','wp-includes/')) and not VENDOR_KEY.fullmatch(item) and not (item in PINNED_TRUSTINDEX_KEYS and item in frozen):raise ValueError('asset map path outside public source allowlist')
 for path in value['excludedPaths']:
  if not safe(path) or not path.startswith(('wp-content/','wp-includes/')) or path in value['paths']:raise ValueError('invalid excluded asset path')
 return json.loads(json.dumps(value))

def load_asset_map(path,snapshot_id=None):
 raw=path.read_bytes();return validate_asset_map(json.loads(raw),snapshot_id),raw,sha(raw)

def pinned_asset_map(provenance):
 pin=provenance.get('assetMap')
 if pin is None:return None
 if not isinstance(provenance.get('snapshotId'),str):raise ValueError('missing asset map snapshot identity')
 if not isinstance(pin,dict) or set(pin)!={'file','sha256','snapshotId'} or pin['file']!='asset-map.json':raise ValueError('invalid pinned asset map')
 asset_map,raw,digest=load_asset_map(FIXTURES/pin['file'],provenance.get('snapshotId'))
 if digest!=pin['sha256'] or asset_map['snapshotId']!=pin['snapshotId']:raise ValueError('pinned asset map hash mismatch')
 return asset_map

def snapshot_asset_patches(value,asset_map):
 # Decode slash escaping only for matching, retaining original character spans.
 normalized=[];starts=[];ends=[];i=0
 while i<len(value):
  start=i
  if value[i:i+2]==r'\/':normalized.append('/');i+=2
  else:normalized.append(value[i]);i+=1
  starts.append(start);ends.append(i)
 normalized=''.join(normalized);patches=[]
 # Vendor spellings are generated ONLY from explicit validated map keys. This
 # is not a broad external-origin localization rule or an external fetch.
 spellings=[]
 for path in asset_map['paths']:
  if path.startswith('_external/'):
   spellings.extend(['https://'+path[len('_external/'):],'/'+path])
 vendor=(r"(?<![\w./:\\-])(?:"+'|'.join(re.escape(item) for item in sorted(spellings,key=len,reverse=True))+r")(?=[?#\s\"'<>),\\]|$)(?:[?#][^\s\"'<>),\\]*)?") if spellings else None
 pattern=re.compile(ASSET_TOKEN.pattern+('|' + vendor if vendor else ''),re.I)
 for match in pattern.finditer(normalized):
  token=match.group(0);url=urlsplit(token);path=posixpath.normpath(unquote(url.path)).lstrip('/')
  if url.netloc in ('cdnjs.cloudflare.com','cdn.trustindex.io'):path='_external/'+url.netloc+'/'+path
  target=asset_map['paths'].get(path)
  if target is None:continue
  encoded=quote(target,safe='/@._-')
  suffix=('?'+url.query if url.query else '')+('#'+url.fragment if url.fragment else '')
  start,end=starts[match.start()],ends[match.end()-1];replacement=encoded+suffix
  if r'\/' in value[start:end]:replacement=replacement.replace('/',r'\/')
  patches.append({'start':start,'end':end,'replacement':replacement,'kind':'snapshot-asset-url','beforeSha256':sha(value[start:end])})
 return patches

class Locations(HTMLParser):
 def __init__(self,html):
  super().__init__(convert_charrefs=False);self.html=html;self.lines=[0]
  for m in re.finditer('\n',html):self.lines.append(m.end())
 def source_offset(self):
  row,col=self.getpos();return self.lines[row-1]+col

class ReviewTransform(Locations):
 def __init__(self,html,asset_map=None):super().__init__(html);self.asset_map=validate_asset_map(asset_map) if asset_map is not None else None;self.tracking=SNAPSHOT_TRACKING if self.asset_map is not None else TRACKING;self.patches=[];self.inline=None;self.protected=False
 def add(self,start,end,replacement,kind):
  if kind=='own-site-url':
   # Record only the replaced origin spans, rather than duplicating large
   # Elementor tags/styles/runtime bodies in build provenance.
   before=self.html[start:end]
   mapped=snapshot_asset_patches(before,self.asset_map) if self.asset_map is not None else []
   self.patches.extend({**patch,'start':start+patch['start'],'end':start+patch['end']} for patch in mapped)
   for pattern,slash in [(ESCAPED_ORIGIN,r'\/'),(ORIGIN,'/')]:
    for match in pattern.finditer(before):
     if any(match.start()<patch['end'] and patch['start']<match.end() for patch in mapped):continue
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
  if tag=='script' and (self.tracking.search(whole) or PAYMENT.search(whole)):
   self.patches=[x for x in self.patches if x['kind']=='review-protection' or not(node['start']<=x['start']<close)]
   reason='payment' if PAYMENT.search(whole) else 'tracking'
   self.add(node['start'],close,'<!-- pilot-disabled-'+reason+'-script sha256='+sha(whole)+' -->','disabled-'+reason+'-script')
  elif node['attrs'].get('type') not in {'application/ld+json','application/json'}:self.add(node['content'],end,localize(body),'own-site-url')
 def transform(self):
  self.feed(self.html)
  if not self.protected:raise ValueError('source lacks head')
  result=self.html
  ordered=sorted(self.patches,key=lambda x:(x['start'],x['end']));cursor=0
  for patch in ordered:
   if patch['start']<cursor:raise ValueError('overlapping source transformation patches')
   cursor=patch['end']
  for patch in reversed(ordered):result=result[:patch['start']]+patch['replacement']+result[patch['end']:]
  return result,sorted(self.patches,key=lambda x:(x['start'],x['end']))

class Annotator(Locations):
 def __init__(self,html):super().__init__(html);self.stack=[];self.nodes=[];self.images=[];self.image_anchors={}
 def anchor(self,tag,attrs):
  lineage=[node['anchor_part'] for node in self.stack]+[self.anchor_part(tag,attrs)]
  # No position/index binding. A repeated semantic path remains ambiguous.
  if not any(part[1] or part[2] for part in lineage):return None
  return json.dumps(lineage,ensure_ascii=False,separators=(',',':'))
 def anchor_part(self,tag,attrs):
  return [tag,attrs.get('data-id',''),attrs.get('id',''),
          ' '.join(sorted((attrs.get('class') or '').split())),
          *[attrs.get(key,'') for key in ('role','name','href','itemprop','data-widget_type')]]
 def handle_starttag(self,tag,attrs):
  pos=self.source_offset();raw=self.get_starttag_text();attrs=dict(attrs);anchor=self.anchor(tag,attrs)
  if self.stack:self.stack[-1]['child']=True
  if tag=='img' and attrs.get('src'):self.images.append((pos,raw,attrs));self.image_anchors[pos]=anchor
  if tag not in VOID:self.stack.append({'anchor':anchor,'anchor_part':self.anchor_part(tag,attrs),'tag':tag,'start':pos,'raw':raw,'content':pos+len(raw),'child':False,'hidden':tag in {'script','style','template','noscript'} or any(n['hidden'] for n in self.stack)})
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs)
 def handle_endtag(self,tag):
  at=next((i for i in range(len(self.stack)-1,-1,-1) if self.stack[i]['tag']==tag),None)
  if at is None:return
  node=self.stack[at];del self.stack[at:]
  if tag in EDIT and not node['child'] and not node['hidden']:
   text=self.html[node['content']:self.source_offset()]
   if unescape(text).strip() and '<' not in text:node['text']=unescape(text);self.nodes.append(node)
 def annotate(self,slug=None,registry=None,previous_anchors=None):
  fields={};edits=[]
  nodes=sorted(self.nodes,key=lambda n:n['start'])
  candidates=[{'type':'text','value':n['text']}for n in nodes]+[{'type':'image','value':attrs['src'],'alt':attrs.get('alt','')}for pos,raw,attrs in self.images]
  self.candidates=candidates;self.anchors=[node['anchor'] for node in nodes]+[self.image_anchors[pos] for pos,raw,attrs in self.images]
  if previous_anchors is not None:
   ids,self.retired,self.registry,self.migration_report=identity_api['review_anchored_migration'](slug,candidates,previous_anchors,self.anchors,registry,source_sha256=sha(self.html))
  elif slug is None:ids=[f"{item['type']}-{index+1}"for index,item in enumerate(candidates)]
  else:ids,self.retired,self.registry=identity_api['assign_fields'](slug,candidates,registry,source_sha256=sha(self.html))
  for index,n in enumerate(nodes):
   fid=ids[index];fields[fid]=candidates[index];edits.append((n['start']+len(n['raw'])-1,f' data-edit-id="{fid}"'))
  for index,(pos,raw,attrs) in enumerate(self.images,start=len(nodes)):
   fid=ids[index];fields[fid]=candidates[index];insert=pos+len(raw)-(2 if raw.endswith('/>') else 1);edits.append((insert,f' data-image-id="{fid}"'))
  result=self.html
  for pos,insert in sorted(edits,reverse=True):result=result[:pos]+insert+result[pos:]
  return result,fields

def option(name):
 if name not in sys.argv:return None
 at=sys.argv.index(name)
 if at+1>=len(sys.argv) or sys.argv[at+1].startswith('--'):raise ValueError('missing '+name+' value')
 return Path(sys.argv[at+1]).resolve()

def load_capture_inventory(path):
 """Only allowlisted public-HTML metadata; never consume WXR/form exports.

 Files are resolved relative to this sanitized inventory. All hashes/lengths/
 routes/redirects are validated before the caller may write a single fixture.
 """
 raw=path.read_bytes();inventory=json.loads(raw);origin='https://derech-tkuma.com'
 if not isinstance(inventory,dict) or set(inventory)!={'version','snapshotId','origin','capturedAt','expected','pages','redirects'}:raise ValueError('unsupported sanitized public inventory')
 if inventory['version']!=2 or inventory['origin']!=origin or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}',inventory['snapshotId'] or ''):raise ValueError('invalid source snapshot identity')
 expected=inventory['expected']
 if expected!={'html':51,'redirects':1}:raise ValueError('reviewed snapshot requires 51 HTML captures and one redirect')
 if not isinstance(inventory['capturedAt'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)',inventory['capturedAt']):raise ValueError('invalid public capture timestamp')
 if not isinstance(inventory['pages'],list) or len(inventory['pages'])!=51 or not isinstance(inventory['redirects'],list) or len(inventory['redirects'])!=1:raise ValueError('source snapshot coverage mismatch')
 routes=set();loaded={}
 def route(value):
  if not isinstance(value,str) or not value.startswith('/') or value.startswith('//') or re.search(r'[\x00-\x20\x7f]',value) or value!=logical_route(value) or any(char in value for char in ('?','#','\\')) or unquote(value)!=value or '..' in value.split('/'):raise ValueError('invalid logical source route')
  if value in routes:raise ValueError('duplicate source route')
  routes.add(value)
 for page in inventory['pages']:
  if not isinstance(page,dict) or set(page)!={'route','url','file','sha256','bytes','capturedAt'}:raise ValueError('unexpected public page metadata')
  if not isinstance(page['capturedAt'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)',page['capturedAt']):raise ValueError('invalid page capture timestamp')
  route(page['route']);url=urlsplit(page['url'])
  if url.scheme!='https' or url.netloc!='derech-tkuma.com' or url.query or url.fragment or unquote(url.path)!=page['route']:raise ValueError('source URL does not match route')
  relative=Path(page['file'])
  if relative.is_absolute() or '..' in relative.parts or relative.suffix!='.html':raise ValueError('unsafe public capture path')
  source=(path.parent/relative).resolve()
  if not source.is_relative_to(path.parent.resolve()):raise ValueError('public capture escapes inventory directory')
  data=source.read_bytes()
  if type(page['bytes']) is not int or not 0<page['bytes']<=4*1024*1024 or page['bytes']!=len(data) or not isinstance(page['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',page['sha256']) or sha(data)!=page['sha256']:raise ValueError('source hash/length mismatch: '+page['route'])
  html=data.decode('utf-8')
  if not re.search(r'<html\b',html,re.I) or not re.search(r'<head\b',html,re.I) or not re.search(r'<body\b',html,re.I):raise ValueError('capture is not a public HTML document')
  loaded[page['route']]=data
 redirect=inventory['redirects'][0]
 if not isinstance(redirect,dict) or set(redirect)!={'route','status','location'}:raise ValueError('unexpected redirect metadata')
 route(redirect['route'])
 if redirect!={'route':'/checkout/','status':302,'location':origin+'/cart/'} or '/cart/' not in loaded:raise ValueError('unverified redirect contract')
 return inventory,loaded,sha(raw)

def source_migration_review(inventory,loaded,inventory_sha,asset_map=None,asset_map_sha=None):
 registry=json.loads(IDENTITIES.read_text());provenance=json.loads(PROVENANCE.read_text());previous_asset_map=pinned_asset_map(provenance);reports=[]
 for slug,data in loaded.items():
  previous_anchors=[]
  if slug in registry['pages']:
   old_record=provenance['pages'].get(slug)
   if not old_record:raise ValueError('missing previous source proof: '+slug)
   old_raw=gzip.decompress((FIXTURES/old_record['fixture']).read_bytes())
   if sha(old_raw)!=old_record['sourceSha256']:raise ValueError('previous source fixture mismatch')
   old_html,_=ReviewTransform(old_raw.decode('utf-8'),previous_asset_map).transform()
   if sha(old_html)!=registry['pages'][slug]['sourceTemplateSha256']:raise ValueError('previous source template mismatch')
   previous=Annotator(old_html);previous.feed(old_html);previous.annotate()
   if previous.candidates!=[{key:value for key,value in entry.items() if key!='id'} for entry in registry['pages'][slug]['active']]:raise ValueError('previous DOM candidates do not match existing IDs')
   previous_anchors=previous.anchors
  transformed,_=ReviewTransform(data.decode('utf-8'),asset_map).transform();parser=Annotator(transformed);parser.feed(transformed)
  parser.annotate(slug,registry,previous_anchors=previous_anchors);reports.append(parser.migration_report)
 return {'version':1,'snapshotId':inventory['snapshotId'],'captureInventorySha256':inventory_sha,'registrySha256':sha(IDENTITIES.read_bytes()),
         'capturePages':len(loaded),'redirects':inventory['redirects'],'pages':reports,
         **({'assetMap':{'file':'asset-map.json','sha256':asset_map_sha,'snapshotId':asset_map['snapshotId']}} if asset_map is not None else {}),
         'missingPreviousRoutes':sorted(set(registry['pages'])-set(loaded))}

def import_public_snapshot(inventory,loaded,inventory_sha):
 # Called only after exact equality with the separately reviewed migration map.
 records={}
 for page in inventory['pages']:
  slug=page['route'];data=loaded[slug];fixture=fixture_name(slug);html=data.decode('utf-8')
  canon=re.search(r'<link\b(?=[^>]*\brel=["\']canonical["\'])[^>]*\bhref=["\']([^"\']+)',html,re.I)
  description=re.search(r'<meta\b(?=[^>]*\bname=["\']description["\'])[^>]*\bcontent=["\']([^"\']*)',html,re.I)
  records[slug]={'fixture':fixture,'sourceUrl':page['url'],'sourcePath':page['file'],'sourceSha256':page['sha256'],'sourceBytes':len(data),'canonical':unescape(canon[1]) if canon else None,'capturedAt':page['capturedAt'],'description':unescape(description[1]) if description else ''}
 return {'version':1,'snapshotId':inventory['snapshotId'],'captureInventorySha256':inventory_sha,'origin':inventory['origin'],'capturedAt':inventory['capturedAt'],'logicalPageCount':len(records),'capturedHtmlCount':len(records),'aliases':[],'redirects':inventory['redirects'],'offsetUnit':'Unicode code points in original UTF-8 decoded source','protectionPolicy':POLICY,'pages':records}

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
 if '--import-source' in sys.argv and '--verify-build' in sys.argv:raise ValueError('source import and read-only build verification are separate operations')
 capture_path=option('--capture-inventory');reviewed_path=option('--identity-review');capture=None;loaded=None;migration_review=None;asset_map=None;asset_map_raw=None;asset_map_sha=None;asset_map_path=option('--asset-map')
 if capture_path:
  if '--import-source' not in sys.argv and '--review-source' not in sys.argv:raise ValueError('capture inventory requires explicit review or import mode')
  capture,loaded,capture_sha=load_capture_inventory(capture_path)
  if asset_map_path:asset_map,asset_map_raw,asset_map_sha=load_asset_map(asset_map_path,capture['snapshotId'])
  migration_review=source_migration_review(capture,loaded,capture_sha,asset_map,asset_map_sha)
  if '--review-source' in sys.argv:
   if '--import-source' in sys.argv or '--verify-build' in sys.argv:raise ValueError('source review is read-only and separate from build/import')
   print(json.dumps(migration_review,ensure_ascii=False,indent=2));return
  if not reviewed_path or json.loads(reviewed_path.read_text())!=migration_review:raise ValueError('exact reviewed identity migration report required')
  if migration_review['missingPreviousRoutes']:raise ValueError('source snapshot removes existing routes')
 elif '--review-source' in sys.argv or reviewed_path or asset_map_path:raise ValueError('explicit capture inventory required')
 provenance=import_public_snapshot(capture,loaded,capture_sha) if capture else import_source() if '--import-source' in sys.argv else json.loads(PROVENANCE.read_text())
 if capture and asset_map is not None:provenance['assetMap']=migration_review['assetMap']
 if not capture:asset_map=pinned_asset_map(provenance)
 original_registry=json.loads(IDENTITIES.read_text());registry=original_registry
 pages={};manifest={}
 for slug,record in provenance['pages'].items():
  raw=loaded[slug] if loaded is not None else gzip.decompress((FIXTURES/record['fixture']).read_bytes());source=raw.decode('utf-8')
  if sha(raw)!=record['sourceSha256']:raise ValueError('fixture hash mismatch: '+slug)
  transformed,patches=ReviewTransform(source,asset_map).transform()
  identity_api['require_source_template'](slug,sha(transformed),registry,import_source='--import-source' in sys.argv)
  parser=Annotator(transformed);parser.feed(transformed)
  if capture:
   report=next(entry for entry in migration_review['pages'] if entry['route']==slug)
   # Reapply only the exact reviewed bindings; report equality pins all inputs.
   previous_anchors=[]
   if slug in original_registry['pages']:
    old_provenance=json.loads(PROVENANCE.read_text());old_record=old_provenance['pages'][slug];old_html,_=ReviewTransform(gzip.decompress((FIXTURES/old_record['fixture']).read_bytes()).decode('utf-8'),pinned_asset_map(old_provenance)).transform();previous=Annotator(old_html);previous.feed(old_html);previous.annotate();previous_anchors=previous.anchors
   annotated,fields=parser.annotate(slug,registry,previous_anchors=previous_anchors)
   if parser.migration_report!=report:raise ValueError('reviewed migration changed during build')
  else:annotated,fields=parser.annotate(slug,registry)
  registry=parser.registry
  registry['pages'][slug]['sourceTemplateSha256']=sha(transformed)
  raw_parser=Annotator(source);raw_parser.feed(source);_,raw_fields=raw_parser.annotate()
  if [x['value'] for x in raw_fields.values() if x['type']=='text']!=[x['value'] for x in fields.values() if x['type']=='text']:raise ValueError('visible source text changed: '+slug)
  body_start=re.search(r'<body\b[^>]*>',annotated,re.I);body_end=re.search(r'</body\s*>',annotated,re.I)
  if not body_start or not body_end:raise ValueError(slug+' lacks body')
  title=re.search(r'<title>(.*?)</title>',source,re.S|re.I);relative='index.html' if slug=='/' else slug.strip('/')+'/index.html'
  pages[slug]={'title':unescape(title.group(1)) if title else slug,'description':record.get('description',''),'page':relative,'sections':[{'id':'source-body','html':annotated[body_start.end():body_end.start()]}],'fields':fields,'shellPrefix':annotated[:body_start.end()],'shellSuffix':annotated[body_end.start():]}
  if parser.retired:pages[slug]['retired']=parser.retired
  record.update(reviewSha256=sha(transformed),textFields=sum(f['type']=='text' for f in fields.values()),imageFields=sum(f['type']=='image' for f in fields.values()),patches=patches,sourceTextValuesSha256=sha(json.dumps([x['value'] for x in raw_fields.values() if x['type']=='text'],ensure_ascii=False,separators=(',',':'))),sourceImageValuesSha256=sha(json.dumps([x['value'] for x in raw_fields.values() if x['type']=='image'],ensure_ascii=False,separators=(',',':'))))
  manifest[slug]={'source':relative,'fixture':record['fixture'],'sha256':sha(transformed),'sourceSha256':record['sourceSha256'],'sourceUrl':record['sourceUrl'],'canonical':record['canonical'],'textFields':record['textFields'],'imageFields':record['imageFields'],'scriptBodiesPreservedExceptOwnSiteUrlsAndDisabledReviewIntegrations':True}
 if registry!=original_registry and '--import-source' not in sys.argv:raise ValueError('field identity drift; review explicit source import mapping before rebuilding')
 payload=(json.dumps(pages,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8')
 # Python 3.11/3.12 can inherit zlib's OS byte for mtime=0, while newer
 # versions use 255. Normalize it so macOS/Linux CI share the same header.
 packed=bytearray(gzip.compress(payload,mtime=0));packed[9]=255;packed=bytes(packed)
 build_manifest={'version':1,'format':'gzip-json-utf8','routeCount':len(pages),'payloadSha256':sha(payload),'payloadBytes':len(payload),'packedSha256':sha(packed),'sources':{slug:{'fixture':record['fixture'],'sourceSha256':record['sourceSha256'],'fixtureSha256':sha(gzip.compress(loaded[slug],mtime=0) if loaded is not None else (FIXTURES/record['fixture']).read_bytes())}for slug,record in provenance['pages'].items()}}
 if '--verify-build' in sys.argv:
  if (FIXTURES/'generated-review-pages.json.gz').read_bytes()!=packed:raise ValueError('pinned review build differs from full source reconstruction; refresh with prepare-pages.py')
  if json.loads((FIXTURES/'review-build.json').read_text())!=build_manifest:raise ValueError('pinned review build identity differs from current source fixtures')
  if json.loads((ROOT/'source-manifest.json').read_text())!=manifest:raise ValueError('source manifest differs from reconstruction')
  if json.loads(PROVENANCE.read_text())!=provenance:raise ValueError('source provenance differs from reconstruction')
  print(json.dumps({'verified':True,'routeCount':len(pages),'payloadSha256':sha(payload),'sourceReconstruction':'full Python parser and byte-offset provenance; no files written'}));return
 # All source/mapping/output validation completes before import mutations.
 if loaded is not None:
  if asset_map_raw is not None:(FIXTURES/'asset-map.json').write_bytes(asset_map_raw)
  for slug,data in loaded.items():(FIXTURES/provenance['pages'][slug]['fixture']).write_bytes(gzip.compress(data,mtime=0))
 (ROOT/'lib/generated-pages.json').write_bytes(payload)
 (ROOT/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 PROVENANCE.write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
 (FIXTURES/'generated-review-pages.json.gz').write_bytes(packed)
 (FIXTURES/'review-build.json').write_text(json.dumps(build_manifest,ensure_ascii=False,indent=2)+'\n')
 if '--import-source' in sys.argv:IDENTITIES.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'logicalPages':len(pages),'sourceHtmlCaptures':provenance['capturedHtmlCount'],'aliases':len(provenance['aliases']),'textFields':sum(x['textFields'] for x in manifest.values()),'imageFields':sum(x['imageFields'] for x in manifest.values()),'source':'pinned current gzip fixtures','networkRequests':0,'rawSourcesCopiedToPublic':0}))
if __name__=='__main__':build()
