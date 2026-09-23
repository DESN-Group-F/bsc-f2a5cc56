import json,pathlib,zipfile,tempfile,shutil,time
import numpy as np
from matio import load_from_mat, whosmat
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets' and x['representation']=='ZIP_ARCHIVE'}
out=ROOT/'NESTED_MAT_STRUCT_SCHEMAS.jsonl';log=ROOT/'NESTED_MAT_STRUCT_SCHEMAS.log';done={(x['container_file_id'],x['nested_archive_member'],x['mat_member']) for x in load(out)} if out.exists() else set()
def summ(x,depth=0):
 d={'type':type(x).__name__}
 if hasattr(x,'shape'):d['shape']=list(x.shape)
 if hasattr(x,'dtype'):d['dtype']=str(x.dtype)
 if depth>=6:return d
 a=np.asarray(x)
 if a.dtype.names:
  d['struct_fields']=list(a.dtype.names);d['fields']={}
  if a.size:
   first=a.reshape(-1)[0]
   for n in a.dtype.names:d['fields'][n]=summ(first[n],depth+1)
 elif a.dtype==object and a.size:
  types=sorted(set(type(v).__name__ for v in a.reshape(-1)[:100]));d['object_element_types']=types
  d['first_element']=summ(a.reshape(-1)[0],depth+1)
 return d
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg:
 for fid,o in src.items():
  with zipfile.ZipFile(o['input_path']) as outer:
   for zi in [x for x in outer.infolist() if not x.is_dir() and x.filename.lower().endswith('.zip') and not pathlib.PurePosixPath(x.filename).name.startswith('._')]:
    with tempfile.SpooledTemporaryFile(max_size=16*1024*1024) as sp:
     with outer.open(zi) as q:shutil.copyfileobj(q,sp,1024*1024)
     sp.seek(0)
     try:nz=zipfile.ZipFile(sp)
     except zipfile.BadZipFile:continue
     with nz:
      for mi in [x for x in nz.infolist() if not x.is_dir() and x.filename.lower().endswith('.mat') and not pathlib.PurePosixPath(x.filename).name.startswith('._')]:
       key=(fid,zi.filename,mi.filename)
       if key in done:continue
       t=time.time();tmp=tempfile.NamedTemporaryFile(suffix='.mat',delete=False);name=tmp.name;err=None;struct={}
       try:
        with nz.open(mi) as q:shutil.copyfileobj(q,tmp,1024*1024)
        tmp.close();names=list(whosmat(name));data=load_from_mat(name,raw_data=True,variable_names=names);struct={k:summ(v) for k,v in data.items()};status='FULL_PASSIVE_STRUCT_SCHEMA'
       except Exception as e:err=type(e).__name__+': '+str(e);status='ERROR'
       finally:
        try:tmp.close()
        except:pass
        try:pathlib.Path(name).unlink()
        except:pass
       r={'container_file_id':fid,'nested_archive_member':zi.filename,'mat_member':mi.filename,'mat_bytes':mi.file_size,'status':status,'error':err,'variables':struct,'elapsed_seconds':round(time.time()-t,3),'source_values_emitted':False,'object_methods_executed':False}
       fo.write(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n');fo.flush();lg.write(f'{fid}\t{zi.filename}\t{mi.filename}\t{status}\t{r["elapsed_seconds"]}s\n')
