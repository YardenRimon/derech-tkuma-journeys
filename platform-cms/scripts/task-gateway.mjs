// One-off gateway using an existing authorized browser session; no new API key or stored credentials.
// Dry-run: node --experimental-strip-types scripts/task-gateway.mjs import sanitized.json
// Commit: CMS_TASK_ORIGIN=https://... CMS_TASK_SESSION_COOKIE=... node --experimental-strip-types scripts/task-gateway.mjs import sanitized.json --commit
// Export: same environment, node --experimental-strip-types scripts/task-gateway.mjs export --commit
import {readFileSync} from 'node:fs';
import {validateTaskSnapshot} from '../lib/task-core.ts';
const [operation,file]=process.argv.slice(2),commit=process.argv.includes('--commit');
if(operation!=='import'&&operation!=='export')throw new Error('Use import <sanitized.json> [--commit] or export --commit');
let entries=[];
if(operation==='import'){
 const raw=readFileSync(file,'utf8');if(Buffer.byteLength(raw)>2000000)throw new Error('Snapshot file too large');
 entries=JSON.parse(raw);if(!Array.isArray(entries)||entries.length>200)throw new Error('Expected an array of at most 200 imports');
 for(const entry of entries){validateTaskSnapshot(entry.snapshot);if(!Number.isSafeInteger(entry.expectedRevision)||entry.expectedRevision<0)throw new Error('expectedRevision is required for every import');}
 if(!commit){console.log(JSON.stringify({dryRun:true,count:entries.length,message:'Validated snapshots only. No requests sent.'}));process.exit(0);}
}
if(!commit)throw new Error('Export requires --commit to explicitly authorize the protected read');
const origin=process.env.CMS_TASK_ORIGIN,cookie=process.env.CMS_TASK_SESSION_COOKIE;
if(!origin||!cookie)throw new Error('CMS_TASK_ORIGIN and ephemeral CMS_TASK_SESSION_COOKIE are required');
const url=new URL(origin);if(url.origin!==origin||(!['https:'].includes(url.protocol)&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw new Error('Use a bare HTTPS origin (or loopback HTTP)');
async function request(body){const response=await fetch(origin+'/api/tasks'+(body?'':'?gateway=1'),{redirect:'error',headers:{cookie,origin,...(body?{'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error(`Gateway rejected request (${response.status})`);return response.json();}
if(operation==='export')console.log(JSON.stringify(await request(),null,2));
else for(const entry of entries){const result=await request({operation:'import',snapshot:entry.snapshot,expectedRevision:entry.expectedRevision,...(entry.receipts?{receipts:entry.receipts}:{})});console.log(JSON.stringify({externalId:result.record.snapshot.externalId,revision:result.record.revision}));}
