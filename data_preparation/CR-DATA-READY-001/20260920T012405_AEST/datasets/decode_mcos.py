import json, pathlib, time, sys
from matio import load_from_mat, whosmat
import numpy as np
OUT=pathlib.Path(__file__).parent/'MCOS_DECODE_RESULTS.jsonl'
BASE=pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate')
FILES={'FILE-017-a84a4fc6203e-cf19e9':'finaldata_4.mat','FILE-017-bf69dc8c4301-3c8b1d':'finaldata_6and8.mat','FILE-017-6749aee75bee-8d52a4':'initialdata_all.mat'}
def shape(x,depth=0):
    if depth>4:return {'type':type(x).__name__,'truncated_depth':True}
    d={'type':type(x).__name__}
    if hasattr(x,'shape'): d['shape']=list(x.shape)
    if hasattr(x,'dtype'): d['dtype']=str(x.dtype)
    for a in ('classname','type_system','class_alias'):
        if hasattr(x,a): d[a]=str(getattr(x,a))
    if hasattr(x,'properties'):
        p=x.properties; d['property_names']=sorted(map(str,p.keys())) if isinstance(p,dict) else None
        if isinstance(p,dict): d['properties']={str(k):shape(v,depth+1) for k,v in list(p.items())[:100]}
    if isinstance(x,dict): d['keys']=sorted(map(str,x.keys())); d['children']={str(k):shape(v,depth+1) for k,v in list(x.items())[:100]}
    return d
with OUT.open('w',encoding='utf-8',newline='\n') as f:
  for fid,name in FILES.items():
    p=BASE/name; t=time.time(); rec={'file_id':fid,'path':str(p),'bytes':p.stat().st_size,'raw_data':True,'variable_selection':None,'status':None,'error':None}
    try:
      inventory=whosmat(p); rec['whosmat']={str(k):v for k,v in inventory.items()}
      names=list(inventory); rec['variable_selection']=names
      data=load_from_mat(p,raw_data=True,variable_names=names)
      rec['structure']={str(k):shape(v) for k,v in data.items()}; rec['status']='DECODED_RAW_PROPERTY_MAP'
    except Exception as e: rec['status']='DECODE_ERROR'; rec['error']=type(e).__name__+': '+str(e)
    rec['elapsed_seconds']=round(time.time()-t,3); f.write(json.dumps(rec,ensure_ascii=False,sort_keys=True)+'\n'); f.flush(); print(fid,rec['status'],rec['elapsed_seconds'],flush=True)
