/** Pin public release identity to the exact audited source manifest. No network. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const file=path=>new URL('../'+path,import.meta.url),bytes=readFileSync(file('source-manifest.json')),manifest=JSON.parse(bytes),provenance=JSON.parse(readFileSync(file('source-pages/provenance.json'))),indexing=JSON.parse(readFileSync(file('source-pages/source-indexing.json')));
const hash=value=>createHash('sha256').update(value).digest('hex'),routes=Object.keys(manifest);
assert.equal(indexing.routeCount,routes.length);assert.deepEqual(Object.keys(indexing.pages).sort(),[...routes].sort());assert.equal(indexing.provenanceSha256,hash(readFileSync(file('source-pages/provenance.json'))));
const canonicals=[...new Set(routes.filter(path=>!indexing.pages[path].noindex).map(path=>manifest[path].canonical??'https://derech-tkuma.com'+path))];assert.equal(canonicals.length,indexing.expectedSitemapCount);
const release={mode:'review',pages:routes.length,contentRelease:hash(bytes),capturedAt:provenance.capturedAt,canonicals,redirects:provenance.redirects??[]};
if(process.argv.includes('--verify'))assert.deepEqual(JSON.parse(readFileSync(file('lib/site-release.json'))),release,'source release metadata must match audited source snapshot');
else writeFileSync(file('lib/site-release.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify({verified:process.argv.includes('--verify'),pages:release.pages,contentRelease:release.contentRelease,sitemap:canonicals.length,networkRequests:0}));
