import{readFileSync,realpathSync}from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
/** Verify the complete emitted browser graph, including lazy imports and CSS.
 * No source-module names or .vite metadata leave the build machine. */
export function collectCloudflareClientAssets(clientDirectory){
 const root=realpathSync(clientDirectory),manifest=JSON.parse(readFileSync(path.join(root,'.vite/manifest.json'),'utf8')),entry=JSON.parse(readFileSync(path.join(root,'vinext-client-entry-manifest.json'),'utf8'));
 if(!entry.appBrowserEntry||!Object.values(manifest).some(item=>item.isEntry&&item.file===entry.appBrowserEntry))throw new Error('Browser hydration entry is absent from the emitted manifest');
 const names=new Set();
 for(const item of Object.values(manifest)){
  for(const dependency of[...(item.imports??[]),...(item.dynamicImports??[])])if(!Object.hasOwn(manifest,dependency))throw new Error('Browser graph dependency is absent');
  for(const file of[item.file,...(item.css??[]),...(item.assets??[])]){
   if(typeof file!=='string'||!/^_next\/static\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(file))throw new Error('Unsafe browser artifact path');
   names.add(file);
  }
 }
 if(names.size<3||names.size>500)throw new Error('Unexpected browser artifact graph size');
 return[...names].sort().map(name=>{
  const file=realpathSync(path.join(root,name));if(!file.startsWith(root+path.sep))throw new Error('Browser artifact escapes its build root');
  const bytes=readFileSync(file);if(bytes.length===0||bytes.length>8*1024*1024)throw new Error('Browser artifact byte bound');
  return{path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 });
}
