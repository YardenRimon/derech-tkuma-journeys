"""Offline source-input and anchored migration proofs; never import source data."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest
import contextlib
import io
from unittest.mock import patch

API=runpy.run_path(str(Path(__file__).with_name('prepare-pages.py')))
IDENTITIES=API['identity_api']

def parse(html):
    parser=API['Annotator'](html)
    parser.feed(html)
    parser.annotate()
    return parser

def registry(html):
    parser=parse(html)
    return IDENTITIES['seed_registry']({'/':{'fields':{entry['type']+'-'+str(index+1):entry for index,entry in enumerate(parser.candidates)}}}, {'/':API['sha'](html)},'a'*64)

def migrate(old,new):
    old_parser,new_parser=parse(old),parse(new)
    return IDENTITIES['review_anchored_migration']('/',new_parser.candidates,old_parser.anchors,new_parser.anchors,registry(old),source_sha256=API['sha'](new))

class AnchoredMigrationTests(unittest.TestCase):
    def test_nonce_only_change_preserves_repeated_fields_by_distinct_elementor_anchors(self):
        old='<html><head><script nonce="old">runtime</script></head><body><div data-id="one"><p>repeated</p><img src="/same.png"></div><div data-id="two"><p>repeated</p><img src="/same.png"></div></body></html>'
        ids,retired,updated,report=migrate(old,old.replace('nonce="old"','nonce="new"'))
        self.assertEqual(ids,['text-1','text-2','image-3','image-4'])
        self.assertEqual(retired,{})
        self.assertEqual(report['ambiguousIds'],[])
        self.assertTrue(all(binding['reason']=='anchor' for binding in report['bindings']))

    def test_legitimate_changed_content_at_same_semantic_leaf_keeps_identity(self):
        old='<div data-id="heading"><h2 class="elementor-heading-title">old title</h2></div>'
        ids,retired,updated,report=migrate(old,old.replace('old title','new title'))
        self.assertEqual(ids,['text-1'])
        self.assertEqual(retired,{})
        self.assertTrue(report['bindings'][0]['contentChanged'])
        self.assertEqual(updated['pages']['/']['active'][0]['value'],'new title')

    def test_ambiguous_repeated_anchor_never_binds_by_position(self):
        old='<div data-id="same"><p>repeated</p><p>repeated</p></div>'
        ids,retired,updated,report=migrate(old,old.replace('repeated','changed',1))
        self.assertEqual(ids,['text-3','text-4'])
        self.assertEqual(set(report['ambiguousIds']),{'text-1','text-2'})
        self.assertEqual(retired,{'text-1':'repeated','text-2':'repeated'})
        self.assertEqual(updated['pages']['/']['nextNumber'],5)
        self.assertEqual(report['bindings'],[])

    def test_removed_field_is_recoverable_and_report_does_not_copy_content(self):
        old='<div data-id="private"><p>synthetic old private value</p></div>'
        ids,retired,updated,report=migrate(old,'<div data-id="private"></div>')
        self.assertEqual(ids,[])
        self.assertEqual(report['removedIds'],['text-1'])
        self.assertEqual(retired,{'text-1':'synthetic old private value'})
        self.assertNotIn('synthetic old private value',json.dumps(report))

class PublicCaptureInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=Path(self.temporary.name)
        self.path=self.root/'inventory.json'
        data=b'<html><head></head><body>synthetic public capture</body></html>'
        (self.root/'page.html').write_bytes(data)
        paths=['/cart/']+['/p'+str(index)+'/' for index in range(50)]
        self.inventory={'version':2,'snapshotId':'fixture-20261028','origin':'https://derech-tkuma.com','capturedAt':'2026-10-28T12:00:00Z','expected':{'html':51,'redirects':1},'pages':[{'route':route,'url':'https://derech-tkuma.com'+route,'file':'page.html','sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'capturedAt':'2026-10-28T12:00:00Z'} for route in paths],'redirects':[{'route':'/checkout/','status':302,'location':'https://derech-tkuma.com/cart/'}]}
    def tearDown(self):
        self.temporary.cleanup()
    def load(self,value=None):
        self.path.write_text(json.dumps(value if value is not None else self.inventory))
        return API['load_capture_inventory'](self.path)
    def test_exact_51_html_and_empty_cart_redirect_are_validated_without_writes(self):
        inventory,loaded,digest=self.load()
        self.assertEqual(len(loaded),51)
        self.assertEqual(len(digest),64)
        self.assertEqual(set(path.name for path in self.root.iterdir()),{'inventory.json','page.html'})
    def test_review_and_unreviewed_import_do_not_mutate_source_or_generated_data(self):
        self.load()
        fixtures=self.root/'source-pages';fixtures.mkdir()
        identities=fixtures/'field-identities.json';identities.write_text(json.dumps({'format':1,'pages':{}}))
        provenance=fixtures/'provenance.json';provenance.write_text(json.dumps({'pages':{}}))
        globals_=API['build'].__globals__
        replacements={'ROOT':self.root,'FIXTURES':fixtures,'IDENTITIES':identities,'PROVENANCE':provenance}
        before={str(path.relative_to(self.root)):path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        with patch.dict(globals_,replacements):
            output=io.StringIO()
            with patch.object(globals_['sys'],'argv',['prepare-pages.py','--capture-inventory',str(self.path),'--review-source']),contextlib.redirect_stdout(output):API['build']()
            report=json.loads(output.getvalue())
            self.assertEqual(report['capturePages'],51)
            self.assertEqual(report['captureInventorySha256'],hashlib.sha256(self.path.read_bytes()).hexdigest())
            with patch.object(globals_['sys'],'argv',['prepare-pages.py','--capture-inventory',str(self.path),'--import-source']):
                with self.assertRaisesRegex(ValueError,'exact reviewed identity migration report required'):API['build']()
        after={str(path.relative_to(self.root)):path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        self.assertEqual(before,after)
        # The approved path is exercised only inside this temporary fixture.
        # No repository source/generated file is imported by this test.
        (self.root/'lib').mkdir()
        reviewed=self.root/'review.json';reviewed.write_text(json.dumps(report))
        with patch.dict(globals_,replacements),patch.object(globals_['sys'],'argv',['prepare-pages.py','--capture-inventory',str(self.path),'--import-source','--identity-review',str(reviewed)]),contextlib.redirect_stdout(io.StringIO()):API['build']()
        generated=json.loads((self.root/'lib/generated-pages.json').read_text())
        self.assertEqual(len(generated),51)
        self.assertNotIn('/checkout/',generated)
        self.assertEqual(json.loads(provenance.read_text())['snapshotId'],'fixture-20261028')
        with patch.dict(globals_,replacements),patch.object(globals_['sys'],'argv',['prepare-pages.py','--verify-build']),contextlib.redirect_stdout(io.StringIO()):API['build']()

    def test_tamper_private_metadata_wrong_redirect_and_path_escape_fail_closed(self):
        cases=[]
        value=deepcopy(self.inventory);value['pages'][0]['sha256']='0'*64;cases.append(value)
        value=deepcopy(self.inventory);value['private_form_settings']={};cases.append(value)
        value=deepcopy(self.inventory);value['pages'][0]['file']='../escape.html';cases.append(value)
        value=deepcopy(self.inventory);value['redirects'][0]['location']='https://outside.invalid/';cases.append(value)
        value=deepcopy(self.inventory);value['pages'][0]['url']='https://derech-tkuma.com/cart/?email=private';cases.append(value)
        value=deepcopy(self.inventory);value['pages'][1]=deepcopy(value['pages'][0]);cases.append(value)
        for value in cases:
            with self.subTest(value=value),self.assertRaises(ValueError):self.load(value)
        self.path.write_text(json.dumps(self.inventory));(self.root/'page.html').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'hash/length mismatch'):API['load_capture_inventory'](self.path)

if __name__=='__main__':unittest.main()
