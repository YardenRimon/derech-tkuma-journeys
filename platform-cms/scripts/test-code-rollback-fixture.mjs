import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {restoredMediaRows,mediaPutOptions,bakedPublicFiles,supplementalAssetPlan} from './verify-code-rollback.mjs';
const sha=body=>createHash('sha256').update(body).digest('hex');
const temp=mkdtempSync(join(tmpdir(),'derech-rollback-contract-'));
try{
 const media=join(temp,'media');mkdirSync(media);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),privateBody=Buffer.from('synthetic private non-image');
 const objects=[{key:'10000000-0000-4000-8000-000000000001',body:image,httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=31536000',cacheExpiry:'2027-01-01T00:00:00.000Z'},customMetadata:{fixture:'synthetic'}},{key:'10000000-0000-4000-8000-000000000002',body:privateBody,httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'},customMetadata:{classification:'private'}}];
 for(const object of objects)writeFileSync(join(media,object.key),object.body);
 const fixture={mediaDirectory:media,mediaObjects:objects.map(({body,...row})=>({...row,size:body.length,sha256:sha(body)}))};
 const rows=restoredMediaRows(fixture);assert.equal(rows[0].public,true);assert.equal(rows[1].public,false);assert.equal(rows[1].httpMetadata.contentType,'application/octet-stream');assert.deepEqual(mediaPutOptions(rows[1]).customMetadata,{classification:'private'});assert.ok(mediaPutOptions(rows[0]).httpMetadata.cacheExpiry instanceof Date);assert.equal(JSON.stringify(mediaPutOptions(rows[0]).httpMetadata),JSON.stringify(rows[0].httpMetadata));
 assert.throws(()=>restoredMediaRows({mediaDirectory:media}),/Original snapshot.media/);assert.throws(()=>restoredMediaRows({...fixture,mediaObjects:fixture.mediaObjects.map((row,index)=>index?row:{...row,size:1})}));assert.throws(()=>restoredMediaRows({...fixture,mediaObjects:[fixture.mediaObjects[0]]}),/Missing\/extra/);
 for(const quotes of ['"',"'",'`'])assert.deepEqual([...bakedPublicFiles('const P=new Set(`/a,/b`.split('+quotes+','+quotes+'));const route={publicFiles:P};')],['/a','/b']);
 assert.throws(()=>bakedPublicFiles('const P=new Set(`/a`.split(`,`));const route={publicFiles:other};'),/Compiled publicFiles/);
 const current=join(temp,'current'),previous=join(temp,'previous'),namespace='/__source_assets__/wordpress-public-20261028/';
 const files=Array.from({length:763},(_,index)=>{const body=Buffer.from('/* synthetic asset '+index+' */');return {path:namespace.slice(1)+'synthetic-'+index+'.css',body,bytes:body.length,transformedSha256:sha(body)};});
 for(const project of [current,previous]){mkdirSync(join(project,'source-pages'),{recursive:true});mkdirSync(join(project,'dist/server'),{recursive:true});for(const directory of ['public','dist/client'])for(const file of files){mkdirSync(join(project,directory,namespace),{recursive:true});writeFileSync(join(project,directory,file.path),file.body);}writeFileSync(join(project,'dist/server/index.js'),'const P=new Set(`'+files.map(row=>'/'+row.path).join(',')+'`.split(`,`));const route={publicFiles:P};');}
 const manifest=Buffer.from(JSON.stringify({snapshotId:'wordpress-public-20261028',namespace,files:files.map(({body,...row})=>row)}));writeFileSync(join(current,'source-snapshot-assets-manifest.json'),manifest);writeFileSync(join(current,'source-pages/asset-map.json'),JSON.stringify({manifestSha256:sha(manifest),paths:{sample:'/'+files[0].path}}));
 assert.equal(supplementalAssetPlan(current,previous).rows.length,763);
 writeFileSync(join(previous,'dist/server/index.js'),'const P=new Set(`/old-only`.split(`,`));const route={publicFiles:P};');assert.throws(()=>supplementalAssetPlan(current,previous),/Missing baked supplemental publicFiles/);
 writeFileSync(join(previous,'dist/server/index.js'),'const P=new Set(`'+files.map(row=>'/'+row.path).join(',')+'`.split(`,`));const route={publicFiles:P};');writeFileSync(join(previous,'dist/client',files[0].path),'changed');assert.throws(()=>supplementalAssetPlan(current,previous),/Supplemental bytes differ|Expected values/);
 console.log('PASS rollback fixture contract: exact original image/octet HTTP/custom metadata, Date conversion, missing metadata/body mismatch denial, actual minified publicFiles parser, 763 supplemental PUBLIC/dist/baked-inventory proof and post-build-only/mutated-byte rejection.');
}finally{rmSync(temp,{recursive:true,force:true});}
