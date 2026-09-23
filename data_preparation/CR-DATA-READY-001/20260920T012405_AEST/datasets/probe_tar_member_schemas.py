import json,pathlib,tarfile,gzip,io,csv,time
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
objs=[x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets' and x['representation']=='TAR_GZIP_ARCHIVE']
out=ROOT/'TAR_MEMBER_SCHEMAS.jsonl';log=ROOT/'TAR_SCHEMA_PROBE.log';done=set()
if out.exists():done={x['container_file_id'] for x in load(out) if x.get('container_complete_marker')}
def header(b):
 lines=b.decode('utf-8-sig','replace').splitlines();
 if not lines:return []
 d='\t' if lines[0].count('\t')>lines[0].count(',') else ','
 return next(csv.reader([lines[0]],delimiter=d))
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg:
 for o in objs:
  fid=o['file_id']
  if fid in done:continue
  t=time.time();n=err=0
  try:
   with tarfile.open(o['input_path'],'r|gz') as tf:
    for m in tf:
     r={'container_file_id':fid,'member_path':m.name,'member_bytes':m.size,'member_type':str(m.type),'read_status':'DIRECTORY_OR_NONFILE' if not m.isfile() else None,'source_values_emitted':False}
     if m.isfile():
      try:
       q=tf.extractfile(m);b=q.read(2*1024*1024)
       if m.name.lower().endswith('.gz'):
        try:b=gzip.GzipFile(fileobj=io.BytesIO(b)).read(1024*1024)
        except Exception as e:r.update(read_status='NESTED_GZIP_PREFIX_ERROR',error=type(e).__name__+': '+str(e)[:200]);err+=1
       if r['read_status'] is None:r.update(read_status='BOUNDED_MEMBER_SCHEMA_READ',bytes_read=len(b),format='CSV_OR_DELIMITED_TEXT',header=header(b))
      except Exception as e:r.update(read_status='MEMBER_READ_ERROR',error=type(e).__name__+': '+str(e)[:200]);err+=1
     fo.write(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n');n+=1
   fo.write(json.dumps({'container_file_id':fid,'container_complete_marker':True,'members':n,'errors':err},sort_keys=True)+'\n');fo.flush();lg.write(f'{fid}\tmembers={n}\terrors={err}\telapsed={time.time()-t:.3f}\n')
  except Exception as e:lg.write(f'{fid}\tCONTAINER_ERROR\t{type(e).__name__}: {e}\n')
