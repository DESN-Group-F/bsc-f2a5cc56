import json, pathlib, time
from matio import load_from_mat, whosmat
import numpy as np
BASE=pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate')
FILES={'FILE-017-a84a4fc6203e-cf19e9':'finaldata_4.mat','FILE-017-bf69dc8c4301-3c8b1d':'finaldata_6and8.mat','FILE-017-6749aee75bee-8d52a4':'initialdata_all.mat'}
OUT=pathlib.Path(__file__).parent/'MCOS_TABLE_CONTRACTS.jsonl'
def scalar(a):
    try:return int(np.asarray(a).reshape(-1)[0])
    except:return None
def strings(a):
    out=[]
    for x in np.asarray(a,dtype=object).reshape(-1):
        if isinstance(x,str): out.append(x)
        elif isinstance(x,np.ndarray):
            try: out.append(''.join(map(str,x.reshape(-1))))
            except: out.append(type(x).__name__)
        else: out.append(str(x))
    return out
with OUT.open('w',encoding='utf-8',newline='\n') as f:
 for fid,name in FILES.items():
  p=BASE/name; names=list(whosmat(p)); data=load_from_mat(p,raw_data=True,variable_names=names)
  for vn,obj in data.items():
   pr=obj.properties
   rec={'file_id':fid,'variable_name':vn,'matlab_class':obj.classname,'rows':scalar(pr.get('nrows')),'columns':scalar(pr.get('nvars')),'variable_names':strings(pr.get('varnames')),'data_container_shape':list(np.asarray(pr.get('data')).shape),'metadata_status':'DECODED_RAW_PROPERTY_MAP','source_values_emitted':False,'object_methods_executed':False,'decoder':'mat-io 1.0.0 raw_data=True'}
   f.write(json.dumps(rec,ensure_ascii=False,sort_keys=True)+'\n')
