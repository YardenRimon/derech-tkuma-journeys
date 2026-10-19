import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync(new URL('../public-assets-manifest.json',import.meta.url)));let bytes=0;
for(const file of manifest.files){
 if(file.path.startsWith('/')||file.path.split('/').includes('..'))throw new Error('Unsafe asset path');
 const path=new URL('../public/'+file.path,import.meta.url);if(!existsSync(path))throw new Error('Required deployment asset missing: '+file.path);
 const data=readFileSync(path);if(data.length!==file.bytes||createHash('sha256').update(data).digest('hex')!==file.sha256)throw new Error('Required deployment asset changed: '+file.path);bytes+=data.length;
}
console.log(JSON.stringify({verifiedAssets:manifest.files.length,bytes,source:'exact deployment manifest; code-only CI is not a deployment bundle'}));

if(process.argv.includes('--tracked')){const tracked=new Set(execFileSync('git',['-c','core.quotepath=false','ls-files','-z','--','public'],{encoding:'utf8',cwd:new URL('../',import.meta.url)}).split('\0'));for(const file of manifest.files)if(!tracked.has('public/'+file.path))throw new Error('Required deployment asset is absent from Git source: '+file.path);console.log(JSON.stringify({trackedDeploymentAssets:manifest.files.length}));}
