import json,pathlib
R=pathlib.Path(__file__).parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
xs=[]
for p in sorted(R.glob('CONTAINER_JSON_FULL_SCHEMAS.4way.shard*.jsonl')):xs+=load(p)
xs.sort(key=lambda x:(x['container_file_id'],x['member_path']))
targets={(x['container_file_id'],x['member_path']) for x in load(R/'CONTAINER_MEMBER_SCHEMAS.jsonl') if x.get('read_status')=='BOUNDED_STREAM_SCHEMA_READ' and x.get('suffix')=='.json'}
keys=[(x['container_file_id'],x['member_path']) for x in xs]
assert len(targets)==229, len(targets)
assert len(xs)==229 and len(set(keys))==229 and set(keys)==targets
assert all(x.get('complete') and x.get('bytes_read')==x.get('member_bytes') and x.get('path_types') for x in xs)
assert not any('__reader_nonfinite__' in k for x in xs for k in list(x.get('field_names',[]))+list(x.get('path_types',{})))
for x in xs:
 x['parser_code_version']='container-json-schema-v2-local-normalizer-no-injected-fields';x['normalization_policy']='bare NaN/Infinity/-Infinity mapped to parser-view null for structural traversal and counted separately; original null remains in null event counts; use typed reader to preserve value distinctions'
tmp=R/'CONTAINER_JSON_FULL_SCHEMAS.jsonl.tmp'
with tmp.open('w',encoding='utf-8',newline='\n') as f:
 for x in xs:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
tmp.replace(R/'CONTAINER_JSON_FULL_SCHEMAS.jsonl')
print(json.dumps({'rows':len(xs),'complete':sum(x['complete'] for x in xs),'errors':sum(not x['complete'] for x in xs),'bytes_read':sum(x['bytes_read'] for x in xs)}))
