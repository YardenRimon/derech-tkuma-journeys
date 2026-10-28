import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const release=JSON.parse(readFileSync(new URL('../lib/site-release.json',import.meta.url))),provenance=JSON.parse(readFileSync(new URL('../source-pages/provenance.json',import.meta.url)));
assert.deepEqual(release.redirects??[],provenance.redirects??[]);
async function moduleFor(value){const source=readFileSync(new URL('../lib/source-redirect.ts',import.meta.url),'utf8').replace("import release from './site-release.json';",'const release='+JSON.stringify(value)+';');return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));}
const current=await moduleFor(release);
for(const method of ['GET','HEAD'])assert.deepEqual(current.sourcePublicRedirect('/checkout/',method),{status:302,location:'/cart/'});
for(const [path,method]of [['/checkout/','POST'],['/cart/','GET'],['//checkout/','GET'],['/%zz/','GET'],['https://evil.invalid/checkout/','GET'],['/checkout/?next=https://evil.invalid','GET']])assert.equal(current.sourcePublicRedirect(path,method),null);
assert.equal((await moduleFor({redirects:[]})).sourcePublicRedirect('/checkout/'),null);
for(const bad of [{route:'/checkout/',status:302,location:'https://evil.invalid/cart/'},{route:'/checkout/',status:301,location:'https://derech-tkuma.com/cart/'},{route:'/checkout/',status:302,location:'https://derech-tkuma.com/cart/?private=x'}]){const invalid=await moduleFor({redirects:[bad]});assert.throws(()=>invalid.sourcePublicRedirect('/checkout/'),/source_redirect_policy_mismatch/);}

console.log('PASS source redirect: captured empty checkout, fixed same-origin cart, GET/HEAD only, unknown/malformed destinations denied; no provider requests.');
