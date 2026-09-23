import json, pathlib, re
import numpy as np
from matio import load_from_mat, whosmat
BASE=pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate')
OUT=pathlib.Path(__file__).parent; DER=OUT/'derived'/'mcos_numeric'; DER.mkdir(parents=True,exist_ok=True)
FILES={'FILE-017-a84a4fc6203e-cf19e9':'finaldata_4.mat','FILE-017-bf69dc8c4301-3c8b1d':'finaldata_6and8.mat','FILE-017-6749aee75bee-8d52a4':'initialdata_all.mat'}
def text_list(x):
 out=[]
 for v in np.asarray(x,dtype=object).reshape(-1):
  if isinstance(v,str): out.append(v)
  elif isinstance(v,np.ndarray): out.append(''.join(str(q) for q in v.reshape(-1)))
  else: out.append(str(v))
 return out
def field(x,name):
 try:return x[name][0,0]
 except:return None
rows=[]
for fid,name in FILES.items():
 p=BASE/name; data=load_from_mat(p,raw_data=True,variable_names=list(whosmat(p)))
 for vn,obj in data.items():
  pr=obj.properties; names=text_list(pr['varnames']); cells=np.asarray(pr['data'],dtype=object).reshape(-1); arrays={}; cols=[]
  props=np.asarray(pr['props'])
  units=text_list(field(props,'VariableUnits')) if field(props,'VariableUnits') is not None else []
  desc=text_list(field(props,'VariableDescriptions')) if field(props,'VariableDescriptions') is not None else []
  for i,(cn,cell) in enumerate(zip(names,cells)):
   a=np.asarray(cell).reshape(-1)
   numeric=np.issubdtype(a.dtype,np.number)
   rec={'name':cn,'dtype':str(a.dtype),'length':int(a.size),'numeric':bool(numeric),'nan_count':None,'positive_infinity_count':None,'negative_infinity_count':None,'unit_declaration':units[i] if i<len(units) and units[i] else None,'description_declaration':desc[i] if i<len(desc) and desc[i] else None}
   if numeric:
    af=a.astype(float,copy=False); rec.update(nan_count=int(np.isnan(af).sum()),positive_infinity_count=int(np.isposinf(af).sum()),negative_infinity_count=int(np.isneginf(af).sum())); arrays[cn]=a
   cols.append(rec)
  target=DER/(fid+'__'+re.sub(r'[^A-Za-z0-9_.-]','_',vn)+'.npz')
  status='EXPORTED_NUMERIC_NPZ' if len(arrays)==len(names) and all(c['length']==int(np.asarray(pr['nrows']).reshape(-1)[0]) for c in cols) else 'NOT_EXPORTED_CONTRACT_MISMATCH'
  if status=='EXPORTED_NUMERIC_NPZ': np.savez_compressed(target,**arrays)
  rows.append({'file_id':fid,'variable_name':vn,'rows_declared':int(np.asarray(pr['nrows']).reshape(-1)[0]),'columns_declared':int(np.asarray(pr['nvars']).reshape(-1)[0]),'columns':cols,'variable_units_property_present':bool(units),'variable_descriptions_property_present':bool(desc),'status':status,'artifact_path':str(target) if target.exists() else None,'artifact_format':'NPZ_NUMERIC_ALLOW_PICKLE_FALSE','source_values_in_json':False,'object_methods_executed':False})
with (OUT/'MCOS_NUMERIC_EXPORTS.jsonl').open('w',encoding='utf-8',newline='\n') as f:
 for x in rows:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
print(json.dumps({'tables':len(rows),'exported':sum(x['status']=='EXPORTED_NUMERIC_NPZ' for x in rows),'artifacts':len(list(DER.glob('*.npz')))}))
