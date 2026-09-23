import json
from pathlib import Path
import numpy as np
from matio import load_from_mat,whosmat

DS=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\datasets")
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\audits\doc_reviews_data")
BASE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate")
files={'FILE-017-a84a4fc6203e-cf19e9':'finaldata_4.mat','FILE-017-bf69dc8c4301-3c8b1d':'finaldata_6and8.mat','FILE-017-6749aee75bee-8d52a4':'initialdata_all.mat'}
contracts=[json.loads(x) for x in (DS/'MCOS_NUMERIC_EXPORTS.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
by={(x['file_id'],x['variable_name']):x for x in contracts}; out=[]
def text_list(x):
 r=[]
 for v in np.asarray(x,dtype=object).reshape(-1): r.append(v if isinstance(v,str) else ''.join(str(q) for q in v.reshape(-1)) if isinstance(v,np.ndarray) else str(v))
 return r
for fid,name in files.items():
 p=BASE/name; data=load_from_mat(p,raw_data=True,variable_names=list(whosmat(p)))
 for vn,obj in data.items():
  c=by[(fid,vn)]; pr=obj.properties; names=text_list(pr['varnames']); cells=np.asarray(pr['data'],dtype=object).reshape(-1)
  with np.load(c['artifact_path'],allow_pickle=False) as z:
   cols=[]
   for cn,cell in zip(names,cells):
    raw=np.asarray(cell); src=raw.reshape(-1); dst=z[cn]
    cols.append({'name':cn,'raw_source_shape':list(raw.shape),'flattened_source_shape':list(src.shape),'npz_shape':list(dst.shape),'dtype_source':str(src.dtype),'dtype_npz':str(dst.dtype),'array_equal':bool(np.array_equal(src,dst,equal_nan=True))})
   out.append({'file_id':fid,'variable_name':vn,'source_names':names,'npz_names':list(z.files),'rows_declared':c['rows_declared'],'columns_declared':c['columns_declared'],'columns':cols,'all_exact':names==list(z.files) and all(x['array_equal'] for x in cols) and all(x['flattened_source_shape']==[c['rows_declared']] for x in cols),'orientation_note':'NPZ columns are explicitly 1-D; raw MATLAB column orientation is retained here for audit.'})
(OUT/'MCOS_FIDELITY_CHECKS.json').write_text(json.dumps({'tables':out,'all_exact':len(out)==11 and all(x['all_exact'] for x in out),'units_declared':any(any(c.get('unit_declaration') for c in x['columns']) for x in contracts),'unit_policy':'UNKNOWN_BLOCK_UNIT_DEPENDENT_USE'},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'tables':len(out),'all_exact':all(x['all_exact'] for x in out),'columns':sum(len(x['columns']) for x in out)}))
