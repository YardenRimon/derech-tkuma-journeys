// Real HTMLRewriter and D1 runtime with synthetic content and no provider calls.
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'derech-cms-render-'));
const base={title:'CURRENT CODE TITLE',page:'fixture/index.html',fields:{'text-1':{type:'text',value:'original'}},sections:[{id:'new',html:'<nav>NEW CODE NAVIGATION</nav>'},{id:'body',html:'<h1 data-edit-id="text-1">original</h1>'}],shellPrefix:'<html><head><title>Original</title></head><body>',shellSuffix:'</body></html>'};
const entry=`import {getPublishedPage,renderDocument,getBasePage} from './lib/cms.ts';
export default{async fetch(request,env){
 const published={fields:{'text-1':{value:'PUBLISHED EDIT'},gone:{value:'ORPHAN'}},order:['body','removed']};
 await env.DB.prepare('INSERT INTO cms_pages VALUES(?,?,?,?,?)').bind('/fixture/',JSON.stringify({fields:{'text-1':{value:'PRIVATE DRAFT'}},order:['body']}),'ARCHIVED HTML',1,1).run();
 await env.DB.prepare('INSERT INTO cms_versions VALUES(?,?,?)').bind('/fixture/',1,JSON.stringify(published)).run();
 const publicHtml=await getPublishedPage('/fixture/');
 const preview=await renderDocument(getBasePage('/fixture/'),published);
 await env.DB.prepare('UPDATE cms_versions SET draft_json=?').bind('{damaged').run();
 const damaged=await getPublishedPage('/fixture/');
 await env.DB.prepare('DELETE FROM cms_versions').run();
 const missing=await getPublishedPage('/fixture/');
 return Response.json({publicHtml,preview,damaged,missing});
}};`;
let runtime;
try{
 const compiled=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],logLevel:'silent',plugins:[{name:'synthetic-content',setup(b){
   b.onResolve({filter:/^@\/lib\/(access|generated-pages\.json|visual-resource-map\.json|collection-projection|collection-d1|site-scope)$/},a=>({path:a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>{
     if(a.path.endsWith('generated-pages.json'))return {contents:JSON.stringify({'/fixture/':base}),loader:'json'};
     if(a.path.endsWith('visual-resource-map.json'))return {contents:'{}',loader:'json'};
     if(a.path.endsWith('/access'))return {contents:'export class CmsError extends Error{constructor(status,message){super(message);this.status=status;}};export async function assertIsolatedD1Scope(){}',loader:'js'};
     if(a.path.endsWith('/collection-projection'))return {contents:'export const managedCollectionFields=()=>({});export const projectPublishedCollections=html=>html;',loader:'js'};
     if(a.path.endsWith('/collection-d1'))return {contents:'export class D1Collections{}',loader:'js'};
     return {contents:'export const siteScope=()=>({});',loader:'js'};
   });
 }}]});
 const path=join(temporary,'worker.mjs');writeFileSync(path,compiled.outputFiles[0].text);
 runtime=new Miniflare({modules:true,modulesRoot:temporary,rootPath:temporary,scriptPath:path,compatibilityDate:'2026-05-15',d1Databases:['DB'],outboundService:()=>new Response('external network disabled',{status:503})});
 const db=await runtime.getD1Database('DB');
 await db.exec('CREATE TABLE cms_pages(slug TEXT PRIMARY KEY,draft_json TEXT,published_html TEXT,published_version INTEGER,revision INTEGER);CREATE TABLE cms_versions(slug TEXT,version INTEGER,draft_json TEXT);');
 const response=await runtime.dispatchFetch('https://synthetic.invalid/test');assert.equal(response.status,200);
 const result=await response.json();
 for(const html of [result.publicHtml,result.preview]){assert.ok(html.includes('NEW CODE NAVIGATION'));assert.ok(html.includes('PUBLISHED EDIT'));assert.ok(!html.includes('PRIVATE DRAFT'));assert.ok(!html.includes('ORPHAN'));assert.ok(html.indexOf('NEW CODE NAVIGATION')<html.indexOf('PUBLISHED EDIT'));}
 assert.equal(result.damaged,'ARCHIVED HTML','damaged publication must keep archive fallback');assert.equal(result.missing,'ARCHIVED HTML','missing published revision must keep archive fallback');
 console.log('PASS actual workerd/D1/HTMLRewriter: current code + published-only edits, private draft isolation, removed fields/sections, inserted sections and damaged/missing archive fallback.');
}finally{await runtime?.dispose();rmSync(temporary,{recursive:true,force:true});}
