import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadSourceSnapshotAssets,verifyAssetFiles,verifySourceNamespace} from './source-snapshot-verification.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../public-assets-manifest.json',import.meta.url)));
const bytes=verifyAssetFiles(root,manifest.files),supplement=loadSourceSnapshotAssets(root);
let sourceBytes=0;
if(supplement){sourceBytes=verifyAssetFiles(root,supplement.files);verifySourceNamespace(root,supplement);}
console.log(JSON.stringify({verifiedAssets:manifest.files.length,bytes,verifiedSourceAssets:supplement?.files.length??0,sourceBytes,snapshotId:supplement?.snapshotId??null,source:'exact frozen manifest plus independently pinned active source supplement'}));
// Frozen media must remain tracked under the original contract. Supplemental
// binaries are supplied by the immutable public release, with metadata in Git.
if(process.argv.includes('--tracked')){const tracked=new Set(execFileSync('git',['-c','core.quotepath=false','ls-files','-z','--','public'],{encoding:'utf8',cwd:new URL('../',import.meta.url)}).split('\0'));for(const file of manifest.files)if(!tracked.has('public/'+file.path))throw new Error('Required frozen asset is absent from Git source: '+file.path);console.log(JSON.stringify({trackedDeploymentAssets:manifest.files.length}));}
