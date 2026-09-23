import json,pathlib,tarfile,gzip,csv,time
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
objs={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
targets={(x['container_file_id'],x['member_path']) for x in load(ROOT/'TAR_MEMBER_SCHEMAS.jsonl') if x.get('read_status')=='NESTED_GZIP_PREFIX_ERROR'}
out=[]
for fid in sorted({x[0] for x in targets}):
 t=time.time()
 with tarfile.open(objs[fid]['input_path'],'r|gz') as tf:
  for m in tf:
   if (fid,m.name) not in targets:continue
   try:
    q=tf.extractfile(m);z=gzip.GzipFile(fileobj=q);b=z.read(1024*1024);lines=b.decode('utf-8-sig','replace').splitlines();d='\t' if lines and lines[0].count('\t')>lines[0].count(',') else ',';h=next(csv.reader([lines[0]],delimiter=d)) if lines else []
    out.append({'container_file_id':fid,'member_path':m.name,'resolution_status':'BOUNDED_NESTED_GZIP_SCHEMA_READ','decompressed_bytes_read':len(b),'header':h,'source_values_emitted':False})
   except Exception as e:out.append({'container_file_id':fid,'member_path':m.name,'resolution_status':'RESOLUTION_ERROR','error':type(e).__name__+': '+str(e)[:200]})
with (ROOT/'TAR_GZIP_MEMBER_RESOLUTIONS.jsonl').open('w',encoding='utf-8',newline='\n') as f:
 for x in out:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
print(json.dumps({'targets':len(targets),'resolved':sum(x['resolution_status']!='RESOLUTION_ERROR' for x in out),'errors':sum(x['resolution_status']=='RESOLUTION_ERROR' for x in out)}))
