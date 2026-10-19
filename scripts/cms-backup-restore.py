#!/usr/bin/env python3
"""Restore verified CMS backup to NEW isolated SQLite only. Never accepts a server/URL."""
import argparse, hashlib, json, pathlib, re, sqlite3, os
TABLES=['cms_deployment_scope','cms_settings','cms_users','cms_permission_audit','cms_pages','cms_versions','cms_records','cms_record_history','cms_task_mirrors','cms_task_commands','cms_task_audit']
ORDER={'cms_deployment_scope':'singleton','cms_settings':'key','cms_users':'email','cms_permission_audit':'id','cms_pages':'slug','cms_versions':'slug,version','cms_records':'tenant_id,site_id,kind,id','cms_record_history':'tenant_id,site_id,kind,id,version','cms_task_mirrors':'tenant_id,site_id,external_id','cms_task_commands':'tenant_id,site_id,command_key','cms_task_audit':'tenant_id,site_id,external_id,revision'}
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(v):return hashlib.sha256(v).hexdigest()
def sql_shape(sql):
 # Ignore identifier quoting, whitespace, case and optional CREATE IF NOT EXISTS;
 # preserve literal tokens, numeric defaults, constraints, index definitions and order.
 tokens=re.findall(r"'(?:''|[^'])*'|`[^`]*`|\"[^\"]*\"|\[[^\]]*\]|[\w]+|[^\s]",sql or '')
 tokens=[t if t.startswith("'") else t.strip('`"[]').lower() for t in tokens]
 return [t for i,t in enumerate(tokens) if not(t=='if' and tokens[i:i+3]==['if','not','exists']) and not(t=='not' and i>0 and tokens[i-1:i+2]==['if','not','exists']) and not(t=='exists' and i>1 and tokens[i-2:i+1]==['if','not','exists'])]
def restore(directory,target,migrations):
 directory=pathlib.Path(directory);target=pathlib.Path(target);migrations=pathlib.Path(migrations)
 if target.exists() or target.is_symlink():raise ValueError('Restore target must not exist; live/overwrite restore is prohibited')
 wrapper=json.loads((directory/'snapshot.json').read_text());snapshot=wrapper['snapshot'];manifest=json.loads((directory/'manifest.json').read_text())
 if snapshot['format']!='cms-backup-v1' or snapshot['schemaVersion']!=1 or wrapper['sha256']!=sha(canonical(snapshot).encode()) or manifest['snapshotSha256']!=wrapper['sha256'] or manifest['scope']!=snapshot['scope'] or manifest['format']!='cms-backup-complete-v1':raise ValueError('Backup manifest, snapshot digest or scope mismatch')
 if sorted(t['name']for t in snapshot['tables'])!=sorted(TABLES):raise ValueError('Unknown/missing CMS tables')
 inventory={x['key']:x for x in snapshot['media']};objects={x['key']:x for x in manifest['media']}
 if len(inventory)!=len(snapshot['media']) or len(objects)!=len(manifest['media']) or set(inventory)!=set(objects):raise ValueError('Incomplete/duplicate media manifest')
 for key,item in objects.items():
  if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',key):raise ValueError('Invalid media path')
  path=directory/'media'/key
  if path.is_symlink():raise ValueError('Symlink media is prohibited')
  data=path.read_bytes()
  if len(data)!=item['size'] or len(data)!=inventory[key]['size'] or sha(data)!=item['sha256']:raise ValueError('Media byte/hash verification failed')
 if {p.name for p in(directory/'media').iterdir()}!=set(inventory):raise ValueError('Unexpected media files')
 # Exclusive file create prevents races/accidental overwrite. SQL supplied by the snapshot is NEVER executed.
 handle=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(handle);db=sqlite3.connect(target);db.row_factory=sqlite3.Row
 try:
  paths=sorted(migrations.glob('*.sql'))
  if [{'name':p.name,'sha256':sha(p.read_bytes())}for p in paths]!=snapshot['migrations']:raise ValueError('Migration source identity mismatch')
  for path in paths:db.executescript(path.read_text())
  actual=[dict(r)for r in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name LIKE 'cms_%' ORDER BY type,name")]
  if [(x['type'],x['name'],x['tbl_name'],sql_shape(x['sql']))for x in actual]!=[(x['type'],x['name'],x['tbl_name'],sql_shape(x['sql']))for x in snapshot['schema']]:raise ValueError('Repository migrations do not match snapshot schema')
  db.execute('PRAGMA foreign_keys=ON');db.execute('BEGIN')
  by_name={t['name']:t for t in snapshot['tables']}
  for name in TABLES:
   table=by_name[name];columns=[dict(r)for r in db.execute('PRAGMA table_info('+name+')')]
   def normalized(items):return[{**x,'type':str(x['type']).upper(),'dflt_value':str(x['dflt_value']).strip('()') if x['dflt_value']is not None else None}for x in items]
   if normalized(columns)!=normalized(table['columns']) or len(table['rows'])!=table['count'] or sha(canonical(table['rows']).encode())!=table['sha256']:raise ValueError('Table schema/count/digest mismatch: '+name)
   fields=[c['name']for c in columns]
   for row in table['rows']:
    if set(row)!=set(fields):raise ValueError('Unexpected columns')
    if 'tenant_id'in row and(row['tenant_id']!=snapshot['scope']['tenantId']or row['site_id']!=snapshot['scope']['siteId']):raise ValueError('Cross-tenant row rejected')
    db.execute('INSERT INTO '+name+' ('+','.join(fields)+') VALUES ('+','.join('?'for _ in fields)+')',[row[f]for f in fields])
   restored=[dict(r)for r in db.execute('SELECT * FROM '+name+' ORDER BY '+ORDER[name])]
   if canonical(restored)!=canonical(table['rows']):raise ValueError('Restored row mismatch: '+name)
  scope=db.execute('SELECT * FROM cms_deployment_scope').fetchall()
  if len(scope)!=1 or scope[0]['tenant_id']!=snapshot['scope']['tenantId']or scope[0]['site_id']!=snapshot['scope']['siteId']:raise ValueError('Restored deployment scope mismatch')
  expected=snapshot['sqliteSequence']
  if any(x['name']!='cms_permission_audit'or not isinstance(x['seq'],int)for x in expected):raise ValueError('Unexpected SQLite sequence')
  db.execute("DELETE FROM sqlite_sequence WHERE name LIKE 'cms_%'")
  for row in expected:db.execute('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)',(row['name'],row['seq']))
  if [dict(r)for r in db.execute("SELECT name,seq FROM sqlite_sequence WHERE name LIKE 'cms_%' ORDER BY name")]!=expected:raise ValueError('Sequence mismatch')
  if db.execute('PRAGMA foreign_key_check').fetchall() or db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Restored SQLite integrity failed')
  db.commit()
  report={'restored':True,'isolated':True,'scope':snapshot['scope'],'tableCounts':{t['name']:t['count']for t in snapshot['tables']},'rows':sum(t['count']for t in snapshot['tables']),'mediaObjects':len(objects),'mediaBytes':sum(x['size']for x in objects.values()),'snapshotSha256':wrapper['sha256'],'integrity':'ok','foreignKeys':'ok','sourceArchiveRestored':False,'liveProviderRestorePerformed':False}
  print(json.dumps(report));return report
 except Exception:
  db.rollback();db.close();target.unlink(missing_ok=True);raise
 finally:db.close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--backup',required=True);p.add_argument('--target',required=True);p.add_argument('--migrations',required=True);a=p.parse_args();restore(a.backup,a.target,a.migrations)
