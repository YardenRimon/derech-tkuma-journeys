"""Audited snapshot URL transformations; synthetic fixtures only, no network."""
from copy import deepcopy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote

API=runpy.run_path(str(Path(__file__).with_name('prepare-pages.py')))
SID='wordpress-public-20261028'
NS='/__source_assets__/'+SID
PATH='wp-content/uploads/2026/10/לוגו-24.png'
CSS='wp-content/cache/min/fontawesome.css'
VENDOR='_external/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'

def asset_map():
    return {'version':1,'snapshotId':SID,'namespace':NS,'paths':{PATH:NS+'/'+PATH,CSS:NS+'/'+CSS,'wp-content/cache/background-css/broken.css':NS+'/'+CSS,VENDOR:NS+'/'+CSS},'excludedPaths':['wp-content/plugins/woocommerce/assets/js/sourcebuster/sourcebuster.min.js'],'manifestSha256':'a'*64}

def transform(body,map_value=None):
    source='<html><head></head><body>'+body+'</body></html>'
    result,patches=API['ReviewTransform'](source,map_value).transform()
    # Reconstruct every patch using original Unicode offsets and exact old SHA.
    output=[];cursor=0
    for item in patches:
        assert item['start']>=cursor
        assert hashlib.sha256(source[item['start']:item['end']].encode()).hexdigest()==item['beforeSha256']
        output.extend([source[cursor:item['start']],item['replacement']]);cursor=item['end']
    output.append(source[cursor:])
    assert ''.join(output)==result
    return source,result,patches

class SnapshotAssetMapTests(unittest.TestCase):
    def test_own_origin_root_protocol_and_percent_encoded_unicode_preserve_suffix(self):
        encoded=quote('/'+PATH,safe='/')
        expected=quote(NS+'/'+PATH,safe='/')+'?ver=4&amp;x=2#fragment'
        for url in ['/'+PATH,'https://derech-tkuma.com/'+PATH,'//www.derech-tkuma.com/'+PATH,encoded]:
            with self.subTest(url=url):
                source,result,patches=transform('<img src="'+url+'?ver=4&amp;x=2#fragment">',asset_map())
                self.assertIn('src="'+expected+'"',result)
                self.assertEqual(sum(item['kind']=='snapshot-asset-url' for item in patches),1)
                self.assertNotIn('%25D7',result,'Unicode target must be encoded exactly once')
                self.assertFalse(any(item['kind']=='own-site-url' for item in patches),'mapped origin cannot overlap another origin patch')

    def test_json_escaped_slashes_and_srcset_inline_css_original_offsets(self):
        escaped=('https://derech-tkuma.com/'+PATH+'?v=2#x').replace('/',r'\/')
        body='<script>window.asset="'+escaped+'";</script><img srcset="/'+PATH+' 1x, /'+PATH+'?v=2 2x"><style>.a{background:url("/'+PATH+'")}</style><div style="background:url(/'+PATH+')"></div>'
        source,result,patches=transform(body,asset_map())
        mapped=[item for item in patches if item['kind']=='snapshot-asset-url']
        self.assertEqual(len(mapped),5)
        expected=(quote(NS+'/'+PATH,safe='/')+'?v=2#x').replace('/',r'\/')
        self.assertIn(expected,result)
        self.assertIn(' 1x, ',result);self.assertIn(' 2x',result)

    def test_canonical_and_schema_identity_are_unchanged(self):
        canonical='<link rel="canonical" href="https://derech-tkuma.com/'+PATH+'">'
        schema='<script type="application/ld+json">{"image":"https://derech-tkuma.com/'+PATH+'"}</script>'
        source=('<html><head>'+canonical+schema+'</head><body><img src="/'+PATH+'"></body></html>')
        result,patches=API['ReviewTransform'](source,asset_map()).transform()
        self.assertIn(canonical,result);self.assertIn(schema,result)
        self.assertEqual(sum(item['kind']=='snapshot-asset-url' for item in patches),1)

    def test_reviewed_css_alias_and_exact_fontawesome_vendor_only(self):
        known='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
        foreign='https://cdnjs.cloudflare.com/ajax/libs/other/1/a.css'
        source,result,patches=transform('<link href="/'+ 'wp-content/cache/background-css/broken.css'+'"><link href="'+known+'"><link href="'+foreign+'">',asset_map())
        self.assertEqual(result.count(NS+'/'+CSS),2)
        self.assertIn(foreign,result)
        self.assertNotIn(known,result)
        self.assertEqual(sum(item['kind']=='snapshot-asset-url' for item in patches),2)

    def test_tracking_removal_replaces_inner_url_patches_and_legacy_is_unchanged(self):
        scripts='<script src="https://derech-tkuma.com/wp-content/plugins/woocommerce/assets/js/sourcebuster/sourcebuster.min.js"></script><script src="https://derech-tkuma.com/wp-content/plugins/woocommerce/assets/js/frontend/order-attribution.min.js"></script>'
        source,legacy,old_patches=transform(scripts)
        self.assertEqual(sum(item['kind']=='disabled-tracking-script' for item in old_patches),0)
        self.assertIn('sourcebuster.min.js',legacy)
        source,result,patches=transform(scripts,asset_map())
        self.assertEqual(sum(item['kind']=='disabled-tracking-script' for item in patches),2)
        self.assertEqual(sum(item['kind'] in ['snapshot-asset-url','own-site-url'] for item in patches),0)
        self.assertEqual(API['ReviewTransform'](source).transform(),(legacy,old_patches),'per-instance map cannot affect legacy transform')

    def test_map_validation_rejects_wrong_snapshot_escape_encoded_paths_overlap_and_unreviewed_vendor(self):
        API['validate_asset_map'](asset_map(),SID)
        variants=[]
        for key,value in [('version',True),('snapshotId','other'),('namespace','https://outside.invalid/'),('manifestSha256','bad')]:
            item=asset_map();item[key]=value;variants.append(item)
        for key,value in [('wp-content/../x.png',NS+'/wp-content/x.png'),('wp-content/%D7%90.png',NS+'/wp-content/x.png'),('_external/evil.invalid/a.css',NS+'/wp-content/x.css'),('wp-content/x.png','/other/x.png')]:
            item=asset_map();item['paths'][key]=value;variants.append(item)
        item=asset_map();item['excludedPaths']=[PATH];variants.append(item)
        item=asset_map();item['secret']='not-allowed';variants.append(item)
        for item in variants:
            with self.subTest(item=item),self.assertRaises(ValueError):API['validate_asset_map'](item,SID)

    def test_exact_trustindex_alias_requires_frozen_manifest_and_never_rewrites_other_vendor_urls(self):
        key='_external/cdn.trustindex.io/assets/fonts/poppins/latin.woff2'
        value=asset_map();value['paths'][key]=NS+'/'+key
        API['validate_asset_map'](value)
        url='https://cdn.trustindex.io/assets/fonts/poppins/latin.woff2'
        source,result,patches=transform('<style>@font-face{src:url('+url+'?v=1#font)}</style><img src="https://cdn.trustindex.io/unreviewed.png">',value)
        self.assertIn(NS+'/'+key+'?v=1#font',result)
        self.assertIn('https://cdn.trustindex.io/unreviewed.png',result)
        self.assertEqual(sum(item['kind']=='snapshot-asset-url' for item in patches),1)
        with tempfile.TemporaryDirectory() as temporary,patch.dict(API['validate_asset_map'].__globals__,{'ROOT':Path(temporary)}):
            with self.assertRaisesRegex(ValueError,'outside public source allowlist'):API['validate_asset_map'](value)
        unreviewed=asset_map();unreviewed['paths']['_external/cdn.trustindex.io/arbitrary.woff2']=NS+'/_external/cdn.trustindex.io/arbitrary.woff2'
        with self.assertRaises(ValueError):API['validate_asset_map'](unreviewed)

    def test_vendor_alias_is_not_a_prefix_rewrite(self):
        source,result,patches=transform('<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css.unreviewed">',asset_map())
        self.assertIn('all.min.css.unreviewed',result)
        self.assertEqual(sum(item['kind']=='snapshot-asset-url' for item in patches),0)

    def test_asset_map_is_pinned_in_review_and_copied_only_after_approved_synthetic_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);fixtures=root/'source-pages';fixtures.mkdir();(root/'lib').mkdir()
            identities=fixtures/'field-identities.json';identities.write_text(json.dumps({'format':1,'pages':{}}))
            provenance=fixtures/'provenance.json';provenance.write_text(json.dumps({'pages':{}}))
            source=('<html><head></head><body><img src="/'+PATH+'"></body></html>').encode()
            (root/'page.html').write_bytes(source)
            routes=['/cart/']+['/p'+str(index)+'/' for index in range(50)]
            inventory={'version':2,'snapshotId':SID,'origin':'https://derech-tkuma.com','capturedAt':'2026-10-28T12:00:00Z','expected':{'html':51,'redirects':1},'pages':[{'route':route,'url':'https://derech-tkuma.com'+route,'file':'page.html','sha256':hashlib.sha256(source).hexdigest(),'bytes':len(source),'capturedAt':'2026-10-28T12:00:00Z'} for route in routes],'redirects':[{'route':'/checkout/','status':302,'location':'https://derech-tkuma.com/cart/'}]}
            inventory_path=root/'inventory.json';inventory_path.write_text(json.dumps(inventory))
            # Keep this fixture WP-only; frozen CDN authority is tested separately.
            value=asset_map();value['paths'].pop(VENDOR)
            map_path=root/'input-assets.json';map_raw=(json.dumps(value)+'\n').encode();map_path.write_bytes(map_raw)
            args=['prepare-pages.py','--capture-inventory',str(inventory_path),'--asset-map',str(map_path)]
            globals_=API['build'].__globals__
            replacements={'ROOT':root,'FIXTURES':fixtures,'IDENTITIES':identities,'PROVENANCE':provenance}
            with patch.dict(globals_,replacements):
                output=io.StringIO()
                with patch.object(globals_['sys'],'argv',args+['--review-source']),contextlib.redirect_stdout(output):API['build']()
                report=json.loads(output.getvalue())
                expected_pin={'file':'asset-map.json','sha256':hashlib.sha256(map_raw).hexdigest(),'snapshotId':SID}
                self.assertEqual(report['assetMap'],expected_pin)
                self.assertFalse((fixtures/'asset-map.json').exists())
                with patch.object(globals_['sys'],'argv',args+['--import-source']),self.assertRaisesRegex(ValueError,'exact reviewed identity migration report required'):API['build']()
                self.assertFalse((fixtures/'asset-map.json').exists())
                reviewed=root/'review.json';reviewed.write_text(json.dumps(report))
                with patch.object(globals_['sys'],'argv',args+['--import-source','--identity-review',str(reviewed)]),contextlib.redirect_stdout(io.StringIO()):API['build']()
                self.assertEqual((fixtures/'asset-map.json').read_bytes(),map_raw)
                self.assertEqual(json.loads(provenance.read_text())['assetMap'],expected_pin)
                with patch.object(globals_['sys'],'argv',['prepare-pages.py','--verify-build']),contextlib.redirect_stdout(io.StringIO()):API['build']()
                (fixtures/'asset-map.json').write_bytes(map_raw+b' ')
                with patch.object(globals_['sys'],'argv',['prepare-pages.py','--verify-build']),self.assertRaisesRegex(ValueError,'hash mismatch'):API['build']()

    def test_pinned_map_exact_hash_and_snapshot_are_required_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);path=directory/'asset-map.json';raw=(json.dumps(asset_map())+'\n').encode();path.write_bytes(raw)
            pin={'snapshotId':SID,'assetMap':{'file':'asset-map.json','sha256':hashlib.sha256(raw).hexdigest(),'snapshotId':SID}}
            with patch.dict(API['pinned_asset_map'].__globals__,{'FIXTURES':directory}):
                self.assertEqual(API['pinned_asset_map'](pin),asset_map())
                self.assertEqual(path.read_bytes(),raw)
                path.write_bytes(raw+b' ')
                with self.assertRaisesRegex(ValueError,'hash mismatch'):API['pinned_asset_map'](pin)
                path.write_bytes(raw);bad=deepcopy(pin);bad['assetMap']['snapshotId']='other'
                with self.assertRaises(ValueError):API['pinned_asset_map'](bad)

if __name__=='__main__':unittest.main()
