import json,pathlib,sys
R=pathlib.Path(__file__).parent
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
targets={(x['container_file_id'],x['member_path']) for x in load(R/'TAR_MEMBER_SCHEMAS.jsonl') if x.get('member_path','').endswith('.json.gz') and '/._' not in x.get('member_path','')}
rows=[]
selected=list(R.glob('TAR_JSON_GZ_FULL_SCHEMAS.exact.f0.4way.p*.jsonl'))+list(R.glob('TAR_JSON_GZ_FULL_SCHEMAS.exact.f1.p*.jsonl'))
for p in sorted(selected):rows+=load(p)
keys=[(x['container_file_id'],x['member_path']) for x in rows]
valid_versions={'tar-nested-gzip-json-exact-normalizer-v3','tar-nested-gzip-json-fast-equivalent-v4'}
checks={'target_count_264':len(targets)==264,'row_count_264':len(rows)==264,'unique_exact_target_set':len(keys)==len(set(keys)) and set(keys)==targets,'all_complete':all(x.get('complete') and not x.get('error') for x in rows),'all_have_path_types':all(x.get('path_types') for x in rows),'validated_parser_versions':all(x.get('parser_code_version') in valid_versions for x in rows),'fast_parser_equivalence_pass':json.loads((R/'FAST_TAR_MEMBER_EQUIVALENCE.json').read_text(encoding='utf-8'))['status']=='PASS','compressed_member_bytes_match':sum(x.get('compressed_member_bytes',0) for x in rows)==18744327321}
result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'counts':{'rows':len(rows),'unique':len(set(keys)),'compressed_member_bytes':sum(x.get('compressed_member_bytes',0) for x in rows),'decompressed_json_bytes':sum(x.get('decompressed_json_bytes',0) for x in rows),'path_type_entries':sum(len(x.get('path_types',{})) for x in rows),'nonfinite_counts':{k:sum(x.get('nonfinite_counts',{}).get(k,0) for x in rows) for k in ['NaN','Infinity','-Infinity']}},'scope':'Full nested-gzip decompression and string-aware JSON event traversal for all 264 non-resource-fork .json.gz TAR members; source values not emitted.','not_checked':['Scientific validity','unit semantics absent field evidence'],'command':f'python -B {__file__}'}
if result['status']=='PASS':
 tmp=R/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl.tmp'
 with tmp.open('w',encoding='utf-8',newline='\n') as f:
  for row in sorted(rows,key=lambda x:(x['container_file_id'],x['member_path'])):f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n')
 tmp.replace(R/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl')
(R/'TAR_JSON_GZ_SCHEMA_CHECKS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False));sys.exit(0 if result['status']=='PASS' else 1)
