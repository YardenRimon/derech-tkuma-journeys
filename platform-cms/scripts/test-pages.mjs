import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const pages=JSON.parse(readFileSync(new URL('../lib/generated-pages.json',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('../source-manifest.json',import.meta.url)));
const scripts=html=>[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m=>m[1]);
for(const [slug,page] of Object.entries(pages)){
 const original=new URL(`../../sites/derech-tkuma-client-demo/dist/${manifest[slug].source}`,import.meta.url);
 const fixture=gunzipSync(readFileSync(new URL(`../source-pages/${manifest[slug].fixture}`,import.meta.url))).toString('utf8');
 const source=existsSync(original)?readFileSync(original,'utf8'):fixture;
 assert.equal(fixture,source,'standalone fixture must match exact public original');
 assert.match(source,/<meta name="robots" content="noindex/,'pilot source must remain noindex');
 const annotated=page.shellPrefix+page.sections.map(s=>s.html).join('')+page.shellSuffix;
 assert.equal(createHash('sha256').update(source).digest('hex'),manifest[slug].sha256);
 assert.equal(annotated.replace(/ data-(?:edit|image)-id="(?:text|image)-\d+"/g,''),source,'only CMS leaf annotations may change source');
 assert.deepEqual(scripts(annotated),scripts(source),'inline scripts must remain byte-identical');
 const ids=[...annotated.matchAll(/ data-(?:edit|image)-id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,Object.keys(page.fields).length);
 assert.equal(page.sections.length,1,'initial pilot uses one locked source body');
}
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))),lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);assert.deepEqual(pkg.devDependencies,lock.packages[''].devDependencies);
console.log('PASS 3 source pages: exact source after removing annotations, all inline script bodies unchanged, unique editable fields, dependency lock aligned');
