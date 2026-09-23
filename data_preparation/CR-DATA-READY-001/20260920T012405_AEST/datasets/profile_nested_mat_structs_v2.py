import json,pathlib,zipfile,tempfile,shutil,time
import numpy as np
from matio import load_from_mat,whosmat
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets' and x['representation']=='ZIP_ARCHIVE'}
out=ROOT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl';log=ROOT/'NESTED_MAT_STRUCT_SCHEMAS_V2.log';done={(x['container_file_id'],x['nested_archive_member'],x['mat_member']) for x in load(out)} if out.exists() else set()
def compact(s):return json.dumps(s,sort_keys=True,separators=(',',':'))
def variants(xs):
 d={compact(x):x for x in xs};return list(d.values())
def summ(x,depth=0):
 a=np.asarray(x);base={'type':type(x).__name__,'shape':list(a.shape),'dtype':str(a.dtype)}
 if depth>=8:
  base['depth_limit_reached']=True;base['unexpanded_struct_or_object']=bool(a.dtype.names or a.dtype==object);return base
 if a.dtype.names:
  base['struct_fields']=list(a.dtype.names);base['element_count']=int(a.size);base['fields']={}
  for n in a.dtype.names:
   vv=[]
   for e in a.reshape(-1):vv.append(summ(e[n],depth+1))
   base['fields'][n]={'variants':variants(vv)}
 elif a.dtype==object:
  vv=[]
  for e in a.reshape(-1):vv.append(summ(e,depth+1))
  base['element_variants']=variants(vv);base['element_count']=int(a.size)
 return base
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg:
 for fid,o in src.items():
  with zipfile.ZipFile(o['input_path']) as outer:
   for zi in [x for x in outer.infolist() if not x.is_dir() and x.filename.lower().endswith('.zip') and not pathlib.PurePosixPath(x.filename).name.startswith('._')]:
    with tempfile.SpooledTemporaryFile(max_size=16*1024*1024) as sp:
     with outer.open(zi) as q:shutil.copyfileobj(q,sp,1048576)
     sp.seek(0)
     try:nz=zipfile.ZipFile(sp)
     except zipfile.BadZipFile:continue
     with nz:
      for mi in [x for x in nz.infolist() if not x.is_dir() and x.filename.lower().endswith('.mat') and not pathlib.PurePosixPath(x.filename).name.startswith('._')]:
       key=(fid,zi.filename,mi.filename)
       if key in done:continue
       t=time.time();tmp=tempfile.NamedTemporaryFile(suffix='.mat',delete=False);name=tmp.name;err=None;struct={}
       try:
        with nz.open(mi) as q:shutil.copyfileobj(q,tmp,1048576)
        tmp.close();names=list(whosmat(name));data=load_from_mat(name,raw_data=True,variable_names=names);struct={k:summ(v) for k,v in data.items()};status='FULL_ALL_STRUCT_ELEMENTS_SCHEMA'
       except Exception as e:err=type(e).__name__+': '+str(e);status='ERROR'
       finally:
        try:tmp.close()
        except:pass
        try:pathlib.Path(name).unlink()
        except:pass
       r={'container_file_id':fid,'nested_archive_member':zi.filename,'mat_member':mi.filename,'mat_bytes':mi.file_size,'status':status,'error':err,'variables':struct,'elapsed_seconds':round(time.time()-t,3),'source_values_emitted':False,'object_methods_executed':False,'schema_code_version':'nested-mat-all-struct-elements-v2'}
       fo.write(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n');fo.flush();lg.write(f'{fid}\t{zi.filename}\t{mi.filename}\t{status}\t{r["elapsed_seconds"]}s\n')
