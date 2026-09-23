import json, pathlib, subprocess, sys, collections, urllib.parse
ROOT=pathlib.Path(__file__).parent; RUN=ROOT.parent
def rows(n): return [json.loads(x) for x in (ROOT/n).read_text(encoding='utf-8').splitlines() if x.strip()]
f=rows('FILE_READINESS.jsonl'); m=rows('MEMBER_READINESS.jsonl'); c=rows('DATA_CONTRACTS.jsonl'); o=rows('OPEN_ITEMS.jsonl'); src=[json.loads(x) for x in (RUN/'SOURCE_OBJECTS.jsonl').read_text(encoding='utf-8-sig').splitlines() if x.strip() and json.loads(x)['lane']=='datasets']; sm={x['file_id']:x for x in src}; ids={x['contract_id'] for x in c}
json_check=json.loads((ROOT/'CONTAINER_JSON_SCHEMA_CHECKS.json').read_text(encoding='utf-8'))
workbook_check=json.loads((ROOT/'WORKBOOK_SCHEMA_CHECKS.json').read_text(encoding='utf-8'))
workbook_package_check=json.loads((ROOT/'WORKBOOK_PACKAGE_CHECKS.json').read_text(encoding='utf-8'))
mat_check=json.loads((ROOT/'MAT_SCHEMA_CHECKS.json').read_text(encoding='utf-8'))
hdf_check=json.loads((ROOT/'HDF5_READER_CHECK_RESULTS.json').read_text(encoding='utf-8'))
tar_json_check=json.loads((ROOT/'TAR_JSON_GZ_SCHEMA_CHECKS.json').read_text(encoding='utf-8'))
tar_csv_check=json.loads((ROOT/'TAR_CSV_SECTION_CHECKS.json').read_text(encoding='utf-8'))
tar_csv_reader_check=json.loads((ROOT/'TAR_CSV_READER_CHECKS.json').read_text(encoding='utf-8'))
rda_check=json.loads((ROOT/'rda_supplement/FINAL_CHECK_RESULTS.json').read_text(encoding='utf-8'))
image_check=json.loads((ROOT/'image_supplement/CHECK_RESULTS.json').read_text(encoding='utf-8'))
ref_cache={}
def member_ref_resolves(ref):
    if '#' not in ref: return pathlib.Path(ref).exists()
    path,query=ref.split('#',1); p=pathlib.Path(path)
    if not p.exists(): return False
    selectors={k:v[-1] for k,v in urllib.parse.parse_qs(query,keep_blank_values=True).items()}
    if not selectors: return False
    if p.suffix.lower()!='.jsonl': return True
    if path not in ref_cache: ref_cache[path]=[json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s.strip()]
    return sum(all(str(row.get(k,''))==v for k,v in selectors.items()) for row in ref_cache[path])==1
checks={
 'file_rows_230':len(f)==230,
 'unique_file_ids':len({x['file_id'] for x in f})==230,
 'exact_source_binding':all(x['file_id'] in sm and x['source_id']==sm[x['file_id']]['source_id'] and x['input_path']==sm[x['file_id']]['input_path'] and x['input_sha256']==sm[x['file_id']]['registered_sha256'] for x in f),
 'all_have_reader':all(pathlib.Path(x['reader_entrypoint']).exists() for x in f),
 'role_and_readiness_present':all(x.get('role')=='dataset' and x.get('readiness')==x.get('readiness_status') and isinstance(x.get('blocking_items'),list) for x in f),
 'all_have_contract_ref':all(x['data_contract_refs'] for x in f),
 'all_source_immutable':all(x['source_mutated'] is False for x in f),
 'members_reference_known_container':all(x['container_file_id'] in sm for x in m),
 'member_locators_unique':len(m)==len({(x['container_file_id'],x['member_path']) for x in m}),
 'no_member_executed':all(x['execution_status']=='NEVER_EXECUTED' for x in m),
 'no_current_member_errors':all(not x.get('error') for x in m),
 'all_members_have_evidence':all(x.get('evidence_refs') for x in m),
 'no_superseded_member_statuses':not any(x.get('readiness_status') in ('DIRECTORY_METADATA_ONLY','UNSUPPORTED_XLS_READER','NESTED_RDA_PENDING_SUPPLEMENT') for x in m),
 'member_evidence_refs_resolve':all(member_ref_resolves(r) for x in m for r in x.get('evidence_refs',[])),
 'member_refs_use_composite_query_selectors':all('/member_path=' not in r for x in m for r in x.get('evidence_refs',[])),
 'mcos_numeric_exports':sum(x['readiness_status']=='READY_WITH_NUMERIC_NPZ_UNKNOWN_UNITS' for x in f)==3 and len(rows('MCOS_TABLE_CONTRACTS.jsonl'))==11 and len(rows('MCOS_NUMERIC_EXPORTS.jsonl'))==11 and all(pathlib.Path(x['artifact_path']).exists() for x in rows('MCOS_NUMERIC_EXPORTS.jsonl')),
 'contract_ids_unique':len(c)==len({x['contract_id'] for x in c})
 ,'contract_refs_resolve':all(any(r.endswith('#contract_id='+i) for i in ids) for x in f for r in x['data_contract_refs']),
 'container_schema_artifacts_exist':all(x['readiness_status']=='READY_WITH_MEMBER_SCHEMAS_AND_READER_LIMITS' for x in f if x['format_family'] in ('ZIP_ARCHIVE','TAR_GZIP_ARCHIVE')),
 'unit_capabilities_are_scoped':all(any(q.startswith('unit_dependent_calculation') for q in x['disabled_capabilities']) for x in f) and all(x['verified_field_contract_refs'] for x in f if x['source_id'] in ('SRC-012','SRC-013')),
 'zip_schema_coverage_complete':sum(1 for x in rows('CONTAINER_MEMBER_SCHEMAS.jsonl') if x.get('container_complete_marker'))==46 and all(x.get('resolution_status')!='RESOLUTION_ERROR' for x in rows('CONTAINER_GAP_RESOLUTIONS.jsonl')),
 'tar_schema_coverage_complete':sum(1 for x in rows('TAR_MEMBER_SCHEMAS.jsonl') if x.get('container_complete_marker'))==2 and all(x.get('resolution_status')=='RESOLUTION_ERROR' and '/._' in x.get('member_path','') for x in rows('TAR_GZIP_MEMBER_RESOLUTIONS.jsonl')),
 'tar_nested_json_full_schema_pass':tar_json_check.get('status')=='PASS' and len(rows('TAR_JSON_GZ_FULL_SCHEMAS.jsonl'))==264,
 'tar_csv_section_contract_pass':tar_csv_check.get('status')=='PASS' and len(rows('TAR_CSV_SECTION_CONTRACTS.jsonl'))==182,
 'tar_csv_bounded_reader_pass':tar_csv_reader_check.get('status')=='PASS' and sum(x.get('readiness_status')=='FULL_SECTIONED_CSV_DATA_CONTRACT' for x in m)==182,
 'rda_supplement_pass':rda_check.get('status')=='PASS' and len(rows('rda_supplement/RDA_MEMBER_READINESS.jsonl'))==28,
 'image_and_inert_asset_supplement_pass':image_check.get('status')=='PASS' and len(rows('image_supplement/MEMBER_PROFILES.jsonl'))==166,
 'container_json_full_schema_pass':json_check.get('status')=='PASS' and len(rows('CONTAINER_JSON_FULL_SCHEMAS.jsonl'))==229,
 'container_workbook_contract_pass':workbook_check.get('status')=='PASS' and len(rows('CONTAINER_WORKBOOK_CONTRACTS.jsonl'))==449,
 'all_workbook_declared_reader_sheet_sets_reconcile':workbook_package_check.get('status')=='PASS' and workbook_package_check.get('counts',{}).get('total_workbooks')==102,
 'nested_mat_all_elements_pass':mat_check.get('status')=='PASS' and mat_check.get('depth_truncations')==0 and len(rows('NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl'))==66,
 'hdf5_referenced_field_reader_pass':hdf_check.get('status')=='PASS' and len(rows('HDF5_BATCH_CONTRACTS.jsonl'))==10,
 'reader_smoke_tests_exist':all((ROOT/n).exists() and (ROOT/n).stat().st_size>0 for n in ['READER_JSON_TEST.log','READER_JSON_TAGGED_TEST.log','READER_XLSX_TEST.log','READER_MAT_TEST.log','READER_MAT_SLICE_TEST.log','READER_NUMERIC_TEST.log','READER_CSV_SEGMENT_TEST.log','READER_XLSX_FORMULA_TEST.log'])
}
res={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'counts':{'files':len(f),'members':len(m),'contracts':len(c),'open_items':len(o)},'scope':'historical full profiles plus fresh member-level schemas, safe readers, MCOS numeric export and reader fixtures; does not reread 19GB CSV','not_checked':['scientific fitness for a particular downstream claim','unit-dependent operations for fields lacking authoritative field evidence'],'command':f'python -B {__file__}'}
(ROOT/'CHECK_RESULTS.json').write_text(json.dumps(res,indent=2),encoding='utf-8'); print(json.dumps(res)); sys.exit(0 if res['status']=='PASS' else 1)

