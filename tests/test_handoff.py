from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from inventory_local import collect,save_report
from validate_handoff import validate,read,check_envelope_consistency
from jsonschema import Draft202012Validator

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.home=Path(self.tmp.name)
        self.source=self.home/'data with spaces';self.source.mkdir()
        self.original=self.source/'原始资料.txt';self.original.write_text('original evidence',encoding='utf-8')
    def tearDown(self):self.tmp.cleanup()
    def test_metadata_only(self):
        r=collect(self.source);self.assertEqual(len(r['records']),1)
        self.assertIsNone(r['records'][0]['sha256']);self.assertFalse(r['records'][0]['content_parsed'])
    def test_optional_hash(self):
        r=collect(self.source,hash_max_bytes=1024)
        self.assertEqual(r['records'][0]['sha256'],hashlib.sha256(self.original.read_bytes()).hexdigest())
    def test_source_unchanged(self):
        before=self.original.stat();payload=self.original.read_bytes()
        collect(self.source,hash_max_bytes=1024)
        self.assertEqual(self.original.read_bytes(),payload);self.assertEqual(self.original.stat().st_mtime_ns,before.st_mtime_ns)
    def test_size_limit(self):
        r=collect(self.source,hash_max_bytes=2);self.assertEqual(r['records'][0]['hash_status'],'SKIPPED_SIZE')
    def test_output_inside_source_rejected(self):
        r=collect(self.source)
        with self.assertRaises(ValueError):save_report(r,self.source/'output.json')
    def test_report_no_overwrite(self):
        r=collect(self.source);out=self.home/'reports'/'report.json';save_report(r,out)
        with self.assertRaises(FileExistsError):save_report(r,out)
    def test_eval_directory_excluded(self):
        d=self.source/'evaluation';d.mkdir();(d/'answers.txt').write_text('private answers')
        r=collect(self.source);self.assertEqual(len(r['records']),1);self.assertTrue(r['excluded'])
    def test_secret_file_excluded(self):
        (self.source/'.env').write_text('SECRET=x')
        self.assertEqual(len(collect(self.source)['records']),1)
    def test_symlink_not_followed(self):
        outside=self.home/'outside.txt';outside.write_text('private')
        link=self.source/'link.txt'
        try:link.symlink_to(outside)
        except (OSError,NotImplementedError):self.skipTest('symlinks unavailable')
        r=collect(self.source,hash_max_bytes=1024);self.assertEqual(len(r['records']),1)
        self.assertIn('SYMLINK_OR_REPARSE_POINT',[x['reason'] for x in r['excluded']])
    def test_file_limit_is_partial(self):
        (self.source/'other.txt').write_text('other')
        r=collect(self.source,max_files=1);self.assertTrue(r['truncated']);self.assertEqual(r['status'],'PARTIAL')
    def test_root_must_exist(self):
        with self.assertRaises(OSError):collect(self.home/'missing')
    def test_invalid_limits_rejected(self):
        with self.assertRaises(ValueError):collect(self.source,max_files=0)

class ContractTests(unittest.TestCase):
    def test_all_handoff_checks(self):self.assertEqual(validate()['errors'],[])
    def test_approval_field_rejected(self):
        p=read('examples/education_proposal.json');p['approved']=True
        v=Draft202012Validator(read('contracts/model_analysis_proposal.schema.json'))
        self.assertTrue(list(v.iter_errors(p)))
    def test_documented_claim_needs_reference(self):
        p=read('examples/education_proposal.json');p['claims'][0]['basis']='DOCUMENTED'
        v=Draft202012Validator(read('contracts/model_analysis_proposal.schema.json'))
        self.assertTrue(list(v.iter_errors(p)))
    def test_probability_requires_validated_method(self):
        p=read('examples/education_proposal.json')
        p['predictions']=[{'prediction_id':'p','level':'SCENARIO_REASONING','target':'failure','horizon':'one hour','method_ref':None,'input_refs':[],'assumptions':[],'result_text':'hypothetical','probability':0.9,'validation_ref':None,'uncertainty':'unknown','invalidating_conditions':[]}]
        v=Draft202012Validator(read('contracts/model_analysis_proposal.schema.json'))
        self.assertTrue(list(v.iter_errors(p)))
    def test_c4_retrieval_failure_rejected(self):
        e=read('examples/analysis_envelope.demo.json');e['proposal']['scope']['scope_class']='C4';e['retrieval_status']='FAILED'
        self.assertIn('C4_REQUIRES_COMPLETED_RETRIEVAL_AND_TRACE',check_envelope_consistency(e))
    def test_mock_label_required(self):
        e=read('examples/analysis_envelope.demo.json');e['is_demo']=False
        self.assertIn('MOCK_MUST_BE_LABELLED_DEMO',check_envelope_consistency(e))
    def test_external_receipts_not_enabled(self):
        e=read('examples/analysis_envelope.demo.json');e['actual_business_receipts']=[{'fake':'approved'}]
        v=Draft202012Validator(read('contracts/analysis_envelope.schema.json'))
        self.assertTrue(list(v.iter_errors(e)))
    def test_source_unknown_not_auto_allowed(self):
        s=read('examples/source_record.demo.json');s['allowed_uses']['ai_context']='UNKNOWN'
        self.assertNotEqual(s['allowed_uses']['ai_context'],'ALLOW')
    def test_training_deferred(self):
        c=read('config/training_deferred.json');self.assertIsNone(c['fixed_seed_count'])
        self.assertTrue(all(not x['enabled'] for x in c['algorithms'].values()))
    def test_no_hidden_test_run_claim(self):
        report=validate();self.assertFalse(report['qwen_executed']);self.assertFalse(report['local_E_drive_accessed'])

if __name__=='__main__':unittest.main(verbosity=2)
