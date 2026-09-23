import json,zipfile,tarfile,gzip,collections,io,importlib.util
from pathlib import Path
import ijson
BASE=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
DS=BASE/'datasets'; OUT=BASE/'audits'/'doc_reviews_data'
spec=importlib.util.spec_from_file_location('ready_reader',DS/'read_ready_data.py'); ready_reader=importlib.util.module_from_spec(spec); spec.loader.exec_module(ready_reader)
def jl(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
src={x['file_id']:x for x in jl(BASE/'SOURCE_OBJECTS.jsonl')}
mr=jl(DS/'MEMBER_READINESS.jsonl'); cms=jl(DS/'CONTAINER_MEMBER_SCHEMAS.jsonl'); gaps=jl(DS/'CONTAINER_GAP_RESOLUTIONS.jsonl'); tr=jl(DS/'TAR_GZIP_MEMBER_RESOLUTIONS.jsonl')
checks=[]
def ck(i,ok,e):checks.append({'check_id':i,'status':'PASS' if ok else 'FAIL','evidence':e})

zip_ids={x['container_file_id'] for x in cms}; cms_actual=[x for x in cms if x.get('member_path')]; mr_zip=[x for x in mr if x['container_file_id'] in zip_ids]
cmsset={(x['container_file_id'],x['member_path']) for x in cms_actual}
for x in cms_actual:
 for n in (x.get('schema') or {}).get('nested_members',[]):cmsset.add((x['container_file_id'],n['member_path']))
for g in gaps:
 for n in g.get('nested_members',[]):cmsset.add((g['container_file_id'],n['member_path']))
mrzset={(x['container_file_id'],x['member_path']) for x in mr_zip}
ck('ZIP_PARENT_CHILD_PATH_SET_CONSERVATION',cmsset==mrzset,{'schema_members':len(cmsset),'readiness_members':len(mrzset),'schema_only':list(cmsset-mrzset)[:10],'readiness_only':list(mrzset-cmsset)[:10]})
markers={x['container_file_id']:x for x in cms if x.get('container_complete_marker')}
marker_bad=[]
for fid,m in markers.items():
 n=sum(x['container_file_id']==fid for x in cms_actual)
 declared=sum(m.get('status_counts',{}).values())
 if declared!=n:marker_bad.append({'file_id':fid,'marker_status_sum':declared,'actual':n})
ck('ZIP_COMPLETE_MARKER_COUNTS',len(markers)==46 and not marker_bad,{'markers':len(markers),'bad':marker_bad})
resources=[x for x in cms_actual if x.get('read_status')=='EXCLUDED_NON_DATA_RESOURCE_FORK']
path_ok=all('/._' in x['member_path'] or x['member_path'].split('/')[-1].startswith('._') for x in resources)
ck('ZIP_RESOURCE_FORK_PATH_EVIDENCE',len(resources)==273 and path_ok,{'count':len(resources),'all_dot_underscore_paths':path_ok})

# TAR schemas are large; stream only IDs/paths and complete markers.
tarset=set(); tmarkers={}; tstatus=collections.Counter()
with (DS/'TAR_MEMBER_SCHEMAS.jsonl').open(encoding='utf-8') as f:
 for line in f:
  x=json.loads(line)
  if x.get('container_complete_marker'):tmarkers[x['container_file_id']]=x
  elif x.get('member_path'):tarset.add((x['container_file_id'],x['member_path']));tstatus[x.get('read_status')]+=1
tar_ids=set(tmarkers); mrt={(x['container_file_id'],x['member_path']) for x in mr if x['container_file_id'] in tar_ids}
ck('TAR_PARENT_CHILD_PATH_SET_CONSERVATION',tarset==mrt,{'schema_members':len(tarset),'readiness_members':len(mrt),'schema_only':list(tarset-mrt)[:10],'readiness_only':list(mrt-tarset)[:10]})
tbad=[]
for fid,m in tmarkers.items():
 n=sum(a==fid for a,b in tarset)
 if m.get('members')!=n:tbad.append({'file_id':fid,'marker':m.get('members'),'actual':n})
ck('TAR_COMPLETE_MARKER_COUNTS',len(tmarkers)==2 and not tbad,{'markers':len(tmarkers),'bad':tbad,'statuses':dict(tstatus)})

# Independently verify all failed nested-gzip candidates are AppleDouble by path and 4-byte magic.
targets={(x['container_file_id'],x['member_path']) for x in tr}; magic=[]
for fid in sorted({x[0] for x in targets}):
 with tarfile.open(src[fid]['input_path'],'r|gz') as tf:
  for m in tf:
   if (fid,m.name) in targets:
    q=tf.extractfile(m);b=q.read(4);magic.append({'file_id':fid,'path':m.name,'prefix_hex':b.hex(),'dot_underscore':m.name.split('/')[-1].startswith('._')})
ck('TAR_RESOURCE_FORK_MAGIC_AND_PATH',len(magic)==182 and all(x['prefix_hex']=='00051607' and x['dot_underscore'] for x in magic),{'count':len(magic),'prefix_counts':dict(collections.Counter(x['prefix_hex'] for x in magic)),'path_failures':sum(not x['dot_underscore'] for x in magic)})

# Reopen the five misleading .xls members and prove OOXML magic independently.
xls=[x for x in gaps if x.get('resolution_status')=='SCHEMA_READ_WORKBOOK']; xls_a=[]
for x in xls:
 with zipfile.ZipFile(src[x['container_file_id']]['input_path']) as z:b=z.read(x['member_path'])[:4]
 xls_a.append({'file_id':x['container_file_id'],'member':x['member_path'],'magic':b.hex(),'decoder':x.get('decoder'),'sheets':len(x.get('schema',[]))})
ck('MISLABELED_XLS_OOXML_MAGIC',len(xls_a)==5 and all(x['magic']=='504b0304' and x['decoder']=='openpyxl_mislabeled_xlsx' and x['sheets']>0 for x in xls_a),{'members':xls_a})

# Nested archive conservation and the actual semantic limit of whosmat-only MAT entries.
nested=[x for x in gaps if x.get('resolution_status')=='NESTED_ZIP_FULL_DIRECTORY_AND_MAT_SCHEMA']; nb=[]; mats=[]
for x in nested:
 if x.get('nested_member_count')!=len(x.get('nested_members',[])):nb.append(x['member_path'])
 for m in x.get('nested_members',[]):
  if m.get('variables'):
   mats.append({'parent':x['member_path'],'member':m['member_path'],'variables':m['variables'],'all_top_level_struct':all(v[1]=='struct' for v in m['variables'].values())})
ck('NESTED_ZIP_MEMBER_COUNT_CONSERVATION',len(nested)==7 and not nb,{'archives':len(nested),'bad':nb,'nested_members':sum(x['nested_member_count'] for x in nested)})
ck('NESTED_MAT_FIELD_SCHEMA_COMPLETE',len(mats)>0 and all(not x['all_top_level_struct'] for x in mats),{'mat_members':len(mats),'top_level_struct_only':sum(x['all_top_level_struct'] for x in mats),'examples':mats[:3]})

# Full-stream one large JSON member and compare all map keys with the retained 4 MiB prefix schema.
sample=next(x for x in cms_actual if x.get('read_status')=='BOUNDED_STREAM_SCHEMA_READ' and x.get('member_bytes',0)>100_000_000)
fullkeys=set(); events=0
with zipfile.ZipFile(src[sample['container_file_id']]['input_path']) as z:
 with z.open(sample['member_path']) as raw:
  for prefix,event,value in ijson.parse(ready_reader.NonfiniteTaggedView(raw)):
   events+=1
   if event=='map_key' and value!='__reader_nonfinite__':fullkeys.add(str(value))
prefixkeys=set(sample['schema']['field_names'])
ck('LARGE_JSON_PREFIX_SCHEMA_REPRESENTATIVE_FULL_STREAM',fullkeys==prefixkeys,{'file_id':sample['container_file_id'],'member':sample['member_path'],'bytes':sample['member_bytes'],'prefix_keys':sorted(prefixkeys),'full_keys':sorted(fullkeys),'events':events,'scope':'one representative of 229; does not prove all members'})

(OUT/'CONTAINER_FINAL_CHECKS.json').write_text(json.dumps({'checks':checks,'pass_count':sum(x['status']=='PASS' for x in checks),'fail_count':sum(x['status']=='FAIL' for x in checks)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checks':len(checks),'pass':sum(x['status']=='PASS' for x in checks),'fail':[x['check_id'] for x in checks if x['status']=='FAIL']}))
