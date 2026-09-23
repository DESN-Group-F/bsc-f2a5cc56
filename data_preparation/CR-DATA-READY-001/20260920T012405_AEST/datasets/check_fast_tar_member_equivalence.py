import collections,gzip,ijson,json,pathlib,sys,tarfile,time
from fast_json_normalizer import FastNormalizer
R=pathlib.Path(__file__).parent;RUN=R.parent
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
reference=load(R/'TAR_JSON_GZ_FULL_SCHEMAS.exact.f0.p0.jsonl')[0];fid=reference['container_file_id'];name=reference['member_path'];src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl')}
start=time.time();row=None
with tarfile.open(src[fid]['input_path'],'r|*') as tar:
 for member in tar:
  if member.name!=name:continue
  paths=collections.defaultdict(set);fields=set();events=collections.Counter()
  with gzip.GzipFile(fileobj=tar.extractfile(member),mode='rb') as nested:
   view=FastNormalizer(nested)
   for prefix,event,value in ijson.parse(view,use_float=True):
    events[event]+=1
    if event=='map_key':fields.add(str(value));paths[(prefix+'.' if prefix else '')+str(value)].add('field')
    elif event in ('string','number','boolean','null','start_map','start_array'):paths[prefix].add(event)
  row={'bytes':view.n,'field_names':sorted(fields),'path_types':{p:sorted(v) for p,v in sorted(paths.items())},'event_counts':dict(events),'nonfinite_counts':dict(view.c),'elapsed_seconds':round(time.time()-start,3)};break
checks={'target_found':row is not None,'bytes_equal':row and row['bytes']==reference['decompressed_json_bytes'],'field_names_equal':row and row['field_names']==reference['field_names'],'path_types_equal':row and row['path_types']==reference['path_types'],'event_counts_equal':row and row['event_counts']==reference['event_counts'],'nonfinite_counts_equal':row and row['nonfinite_counts']==reference['nonfinite_counts'],'faster_than_reference':row and row['elapsed_seconds']<reference['elapsed_seconds']}
result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'target':{'container_file_id':fid,'member_path':name},'reference_elapsed_seconds':reference['elapsed_seconds'],'fast_elapsed_seconds':row['elapsed_seconds'] if row else None,'speedup':round(reference['elapsed_seconds']/row['elapsed_seconds'],2) if row else None,'fast_normalizer_fixture':str(R/'FAST_NORMALIZER_FIXTURE_CHECKS.json')}
(R/'FAST_FLOAT_TAR_MEMBER_EQUIVALENCE.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result));sys.exit(0 if result['status']=='PASS' else 1)
