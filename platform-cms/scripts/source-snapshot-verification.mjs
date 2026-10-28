/** Node-only pinned supplemental manifest checks; no network or provider SDK. */
import {readFileSync,lstatSync,readdirSync,existsSync} from 'node:fs';
import {join,extname,relative} from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(object,names)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===names.length&&names.every(key=>Object.hasOwn(object,key));
const refuse=code=>{throw new Error(code);};
const ensure=(condition,code)=>{if(!condition)refuse(code);};
export const safeAssetPath=value=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!/[\u0000-\u001f\u007f?#\\]/.test(value)&&!/%[a-f0-9]{2}/i.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const read=(root,path,maximum=8*1024*1024)=>{const target=join(root,path),stat=lstatSync(target);ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum,'unsafe_source_metadata');const raw=readFileSync(target);return {raw,value:JSON.parse(raw)};};
const extensions=new Set(['.css','.js','.jpg','.jpeg','.png','.webp','.svg','.gif','.ico','.woff','.woff2','.ttf','.eot','.avif','.mp4','.pdf']);
export function loadSourceSnapshotAssets(root){
 const provenance=read(root,'source-pages/provenance.json',64*1024*1024).value;
 if(!Object.hasOwn(provenance,'assetMap'))return null;
 const pin=provenance.assetMap,sid=provenance.snapshotId;
 ensure(typeof sid==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(sid)&&exact(pin,['file','sha256','snapshotId'])&&pin.file==='asset-map.json'&&pin.snapshotId===sid&&sha(pin.sha256),'invalid_source_map_pin');
 const map=read(root,'source-pages/asset-map.json');
 ensure(hash(map.raw)===pin.sha256&&exact(map.value,['version','snapshotId','namespace','paths','excludedPaths','manifestSha256'])&&map.value.version===1&&map.value.snapshotId===sid&&sha(map.value.manifestSha256),'source_map_pin_mismatch');
 const namespace='__source_assets__/'+sid+'/';
 ensure(typeof map.value.namespace==='string'&&map.value.namespace.replace(/^\/+|\/+$/g,'')===namespace.slice(0,-1),'source_namespace_mismatch');
 const manifest=read(root,'source-snapshot-assets-manifest.json');
 ensure(hash(manifest.raw)===map.value.manifestSha256&&manifest.value.version===1&&manifest.value.snapshotId===sid&&typeof manifest.value.namespace==='string'&&manifest.value.namespace.replace(/^\/+|\/+$/g,'')===namespace.slice(0,-1)&&Array.isArray(manifest.value.files),'source_manifest_pin_mismatch');
 const files=manifest.value.files,seen=new Set();let bytes=0;
 ensure(files.length>0&&files.length<=2048,'source_file_cap');
 const normalized=files.map(file=>{
  ensure(file&&typeof file==='object'&&Object.keys(file).every(key=>['path','sourcePath','originalSha256','transformedSha256','bytes','disposition','provenanceHash'].includes(key))&&safeAssetPath(file.path)&&file.path.startsWith(namespace)&&!seen.has(file.path)&&extensions.has(extname(file.path).toLowerCase())&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=16*1024*1024&&sha(file.transformedSha256),'unsafe_source_asset_entry');
  seen.add(file.path);bytes+=file.bytes;ensure(bytes<=128*1024*1024,'source_byte_cap');return {path:file.path,bytes:file.bytes,sha256:file.transformedSha256};
 });
 ensure(map.value.paths&&typeof map.value.paths==='object'&&!Array.isArray(map.value.paths)&&Array.isArray(map.value.excludedPaths)&&map.value.excludedPaths.every(safeAssetPath)&&new Set(map.value.excludedPaths).size===map.value.excludedPaths.length,'invalid_source_aliases');
 for(const [source,target] of Object.entries(map.value.paths))ensure(safeAssetPath(source)&&!map.value.excludedPaths.includes(source)&&typeof target==='string'&&target.startsWith('/')&&seen.has(target.slice(1)),'source_alias_outside_manifest');
 const bundle=read(root,'source-pages/asset-bundle.json',65536).value;
 const expected='https://github.com/YardenRimon/derech-tkuma-journeys/releases/download/'+sid+'-assets-v1/source-media-'+sid+'.tgz';
 ensure(exact(bundle,['version','snapshotId','archiveUrl','archiveSha256','manifestSha256','files','bytes'])&&bundle.version===1&&bundle.snapshotId===sid&&bundle.archiveUrl===expected&&sha(bundle.archiveSha256)&&bundle.manifestSha256===hash(manifest.raw)&&bundle.files===files.length&&bundle.bytes===bytes,'source_bundle_pin_mismatch');
 return {files:normalized,bytes,namespace,snapshotId:sid,mapSha256:hash(map.raw),manifestSha256:hash(manifest.raw)};
}
export function verifyAssetFiles(root,files){
 const publicStat=lstatSync(join(root,'public'));ensure(publicStat.isDirectory()&&!publicStat.isSymbolicLink(),'symlink_public_root_refused');
 let bytes=0;const seen=new Set();
 for(const file of files){
  ensure(safeAssetPath(file.path)&&!seen.has(file.path)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&sha(file.sha256),'unsafe_asset_manifest');seen.add(file.path);
  let target=join(root,'public');
  for(const segment of file.path.split('/')){target=join(target,segment);ensure(!lstatSync(target).isSymbolicLink(),'symlink_asset_refused');}
  ensure(lstatSync(target).isFile(),'required_asset_missing');const data=readFileSync(target);ensure(data.length===file.bytes&&hash(data)===file.sha256,'required_asset_changed');bytes+=data.length;
 }
 return bytes;
}
export function verifySourceNamespace(root,supplement){
 const directory=join(root,'public',supplement.namespace),expected=new Set(supplement.files.map(file=>file.path));let examined=0;
 if(!existsSync(directory))refuse('source_namespace_missing');
 const walk=path=>{ensure(++examined<=16384,'source_namespace_entry_cap');const stat=lstatSync(path);ensure(!stat.isSymbolicLink(),'symlink_source_namespace_refused');if(stat.isDirectory()){for(const name of readdirSync(path))walk(join(path,name));}else ensure(stat.isFile()&&expected.has(relative(join(root,'public'),path).split('\\').join('/')),'unexpected_source_namespace_file');};
 walk(directory);
}
