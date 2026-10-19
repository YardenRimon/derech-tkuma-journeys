"""Annotate exact public source by byte offsets; never reserialize HTML or scripts."""
from pathlib import Path
from html.parser import HTMLParser
from html import unescape
import json, re, hashlib, shutil, gzip, sys
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'sites/derech-tkuma-client-demo/dist'
TARGETS=[('/', 'index.html','home.html.gz'),('/סיורים/', 'סיורים/index.html','tours.html.gz'),('/maslulim/עוז-מול-תופת/', 'maslulim/עוז-מול-תופת/index.html','oz-mul-tofet.html.gz')]
USE_FIXTURES='--fixtures' in sys.argv or not SOURCE.is_dir()
VOID={'img','br','hr','meta','link','input','source','area','base','embed','param','track','wbr'}
EDIT={'h1','h2','h3','h4','h5','h6','p','span','a','li','strong','b','label','button'}
class Annotator(HTMLParser):
 def __init__(self,html):
  super().__init__(convert_charrefs=False); self.html=html;self.lines=[0];self.stack=[];self.nodes=[];self.images=[]
  for m in re.finditer('\n',html): self.lines.append(m.end())
 def source_offset(self):
  row,col=self.getpos();return self.lines[row-1]+col
 def handle_starttag(self,tag,attrs):
  pos=self.source_offset(); raw=self.get_starttag_text();attrs=dict(attrs)
  if self.stack: self.stack[-1]['child']=True
  if tag=='img' and attrs.get('src'): self.images.append((pos,raw,attrs))
  if tag not in VOID: self.stack.append({'tag':tag,'start':pos,'raw':raw,'content':pos+len(raw),'child':False,'hidden':tag in {'script','style','template','noscript'} or any(n['hidden'] for n in self.stack)})
 def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs)
 def handle_endtag(self,tag):
  at=next((i for i in range(len(self.stack)-1,-1,-1) if self.stack[i]['tag']==tag),None)
  if at is None:return
  node=self.stack[at];del self.stack[at:]
  if tag in EDIT and not node['child'] and not node['hidden']:
   text=self.html[node['content']:self.source_offset()]
   if unescape(text).strip() and '<' not in text: node['text']=unescape(text);self.nodes.append(node)
 def annotate(self):
  fields={};edits=[]
  for n in sorted(self.nodes,key=lambda n:n['start']):
   fid=f'text-{len(fields)+1}';fields[fid]={'type':'text','value':n['text']}
   edits.append((n['start']+len(n['raw'])-1,f' data-edit-id="{fid}"'))
  for pos,raw,attrs in self.images:
   fid=f'image-{len(fields)+1}';fields[fid]={'type':'image','value':attrs['src'],'alt':attrs.get('alt','')}
   insert=pos+len(raw)-(2 if raw.endswith('/>') else 1);edits.append((insert,f' data-image-id="{fid}"'))
  result=self.html
  for pos,insert in sorted(edits,reverse=True):result=result[:pos]+insert+result[pos:]
  return result,fields
pages={};manifest={}
for slug,relative,fixture in TARGETS:
 source=gzip.decompress((ROOT/'source-pages'/fixture).read_bytes()).decode() if USE_FIXTURES else (SOURCE/relative).read_text();parser=Annotator(source);parser.feed(source);annotated,fields=parser.annotate()
 body_start=re.search(r'<body\b[^>]*>',annotated,re.I);body_end=re.search(r'</body\s*>',annotated,re.I)
 if not body_start or not body_end:raise ValueError(relative+' lacks body')
 # Existing body is one locked section. No wrapper node is added to the source.
 title=re.search(r'<title>(.*?)</title>',source,re.S|re.I)
 pages[slug]={'title':unescape(title.group(1)) if title else slug,'page':relative,'sections':[{'id':'source-body','html':annotated[body_start.end():body_end.start()]}],'fields':fields,'shellPrefix':annotated[:body_start.end()],'shellSuffix':annotated[body_end.start():]}
 manifest[slug]={'source':relative,'fixture':fixture,'sha256':hashlib.sha256(source.encode()).hexdigest(),'textFields':sum(f['type']=='text' for f in fields.values()),'imageFields':sum(f['type']=='image' for f in fields.values()),'scriptBodiesPreserved':True}
(ROOT/'lib/generated-pages.json').write_text(json.dumps(pages,ensure_ascii=False,separators=(',',':'))+'\n')
(ROOT/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for p in SOURCE.rglob('*'):
 if p.is_file() and p.suffix!='.html':
  dest=ROOT/'public'/p.relative_to(SOURCE);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
print(json.dumps(manifest,ensure_ascii=False,indent=2))
