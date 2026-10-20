import {existsSync,copyFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import './sites-env.mjs';
// Only local emulation; synthetic fixture identity. Never runs provider provisioning.
if(!existsSync('.dev.vars'))copyFileSync('.dev.vars.example','.dev.vars');
for(const name of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()){
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'d1','execute','DB','--local','--config','wrangler.local.json','--file',`drizzle/${name}`],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
