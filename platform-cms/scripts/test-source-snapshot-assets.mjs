/** Offline Node verifier/workflow proofs plus bounded synthetic Python archives. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadSourceSnapshotAssets,verifyAssetFiles,verifySourceNamespace} from './source-snapshot-verification.mjs';
const python=spawnSync('python3',[fileURLToPath(new URL('./test_source_bundle.py',import.meta.url))],{encoding:'utf8'});assert.equal(python.status,0,python.stderr);
const hash=value=>createHash('sha256').update(value).digest('hex'),sid='fixture-20261028',namespace='__source_assets__/'+sid+'/';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'source-assets-node-'));mkdirSync(join(root,'source-pages'));mkdirSync(join(root,'public'));
 const files=[{path:namespace+'wp-content/a.css',body:Buffer.from('body{color:red}')},{path:namespace+'wp-content/a.woff2',body:Buffer.from('synthetic font')}];
 const manifest={version:1,snapshotId:sid,namespace:'/'+namespace,files:files.map(file=>({path:file.path,bytes:file.body.length,transformedSha256:hash(file.body)}))};
 const map={version:1,snapshotId:sid,namespace:'/'+namespace,paths:Object.fromEntries(files.map(file=>[file.path.slice(namespace.length),'/'+file.path])),excludedPaths:[],manifestSha256:''};
 const bundle={version:1,snapshotId:sid,archiveUrl:'https://github.com/YardenRimon/derech-tkuma-journeys/releases/download/'+sid+'-assets-v1/source-media-'+sid+'.tgz',archiveSha256:'a'.repeat(64),manifestSha256:'',files:2,bytes:files.reduce((total,file)=>total+file.body.length,0)};
 const write=(path,value)=>writeFileSync(join(root,path),JSON.stringify(value)+'\n');
 const repin=()=>{write('source-snapshot-assets-manifest.json',manifest);map.manifestSha256=hash(readFileSync(join(root,'source-snapshot-assets-manifest.json')));bundle.manifestSha256=map.manifestSha256;write('source-pages/asset-map.json',map);write('source-pages/provenance.json',{snapshotId:sid,assetMap:{file:'asset-map.json',snapshotId:sid,sha256:hash(readFileSync(join(root,'source-pages/asset-map.json')))}});write('source-pages/asset-bundle.json',bundle);};
 repin();for(const file of files){mkdirSync(join(root,'public',namespace,'wp-content'),{recursive:true});writeFileSync(join(root,'public',file.path),file.body);}
 return {root,files,manifest,map,bundle,write,repin,close:()=>rmSync(root,{recursive:true,force:true})};
}
let f=fixture();try{
 const source=loadSourceSnapshotAssets(f.root);assert.equal(source.files.length,2);assert.equal(verifyAssetFiles(f.root,source.files),f.bundle.bytes);verifySourceNamespace(f.root,source);
 writeFileSync(join(f.root,'public',f.files[0].path),'tampered');assert.throws(()=>verifyAssetFiles(f.root,source.files),/required_asset_changed/);
 writeFileSync(join(f.root,'public',f.files[0].path),f.files[0].body);writeFileSync(join(f.root,'public',namespace,'extra.js'),'unlisted');assert.throws(()=>verifySourceNamespace(f.root,source),/unexpected_source_namespace_file/);
}finally{f.close();}
f=fixture();try{
 f.bundle.archiveUrl+='?token=forbidden';f.repin();assert.throws(()=>loadSourceSnapshotAssets(f.root),/source_bundle_pin_mismatch/);
 f.bundle.archiveUrl=f.bundle.archiveUrl.split('?')[0];f.manifest.files.push({...f.manifest.files[0]});f.repin();assert.throws(()=>loadSourceSnapshotAssets(f.root),/unsafe_source_asset_entry/);
}finally{f.close();}
f=fixture();try{
 f.map.paths['wp-content/escape.css']='/other/a.css';f.repin();assert.throws(()=>loadSourceSnapshotAssets(f.root),/source_alias_outside_manifest/);
 delete f.map.paths['wp-content/escape.css'];f.repin();writeFileSync(join(f.root,'source-pages/asset-map.json'),readFileSync(join(f.root,'source-pages/asset-map.json'))+' ');assert.throws(()=>loadSourceSnapshotAssets(f.root),/source_map_pin_mismatch/);
}finally{f.close();}
f=fixture();try{
 const source=loadSourceSnapshotAssets(f.root),target=join(f.root,'public',f.files[0].path),foreign=join(f.root,'foreign');rmSync(target);writeFileSync(foreign,'synthetic foreign data');symlinkSync(foreign,target);assert.throws(()=>verifyAssetFiles(f.root,source.files),/symlink_asset_refused/);
 f.write('source-pages/provenance.json',{});rmSync(join(f.root,'source-pages/asset-bundle.json'));assert.equal(loadSourceSnapshotAssets(f.root),null,'legacy bootstrap requires no source bundle');
}finally{f.close();}
for(const name of ['../../.github/workflows/site-ci.yml','../../.github/workflows/site-cloudflare.yml','../../production/github-workflows/site-ci.yml','../../production/github-workflows/site-cloudflare.yml','../../production/github-workflows/site-production.yml']){
 const text=readFileSync(new URL(name,import.meta.url),'utf8'),old=text.indexOf('python3 platform-cms/scripts/hydrate-cloudflare-media.py'),added=text.lastIndexOf('python3 platform-cms/scripts/hydrate-source-snapshot.py --root platform-cms');assert.ok(old>=0&&added>old,'source supplement follows existing frozen hydration: '+name);
 assert.ok(text.includes('persist-credentials: false'));assert.ok(text.includes('cancel-in-progress: false')||text.includes('cancel-in-progress: ${{'));assert.doesNotMatch(text,/vars\.DERECH_SOURCE_|secrets\.SOURCE_ASSET/,'no new source archive settings/secrets');
}
console.log('PASS pinned source assets: Python offline archive/metadata/bounds/HTTPS/legacy tests; Node frozen+supplement pins/hash/namespace/extras/symlinks; existing review/prepared-production hydration ordering and approval boundaries. No network.');
