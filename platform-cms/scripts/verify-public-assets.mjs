import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync(new URL('../public-assets-manifest.json',import.meta.url)));let bytes=0;
for(const file of manifest.files){
 if(file.path.startsWith('/')||file.path.split('/').includes('..'))throw new Error('Unsafe asset path');
 const path=new URL('../public/'+file.path,import.meta.url);if(!existsSync(path))throw new Error('Required deployment asset missing: '+file.path);
 const data=readFileSync(path);if(data.length!==file.bytes||createHash('sha256').update(data).digest('hex')!==file.sha256)throw new Error('Required deployment asset changed: '+file.path);bytes+=data.length;
}
console.log(JSON.stringify({verifiedAssets:manifest.files.length,bytes,source:'exact deployment manifest; code-only CI is not a deployment bundle'}));
