import json,importlib.util,h5py,numpy as np
from pathlib import Path
B=Path(r'E:/desn 2000/bsc/data_preparation/CR-DATA-READY-001/20260920T012405_AEST');D=B/'datasets';O=B/'audits'/'doc_reviews_data'
x=json.loads(next(iter(open(D/'HDF5_BATCH_CONTRACTS.jsonl',encoding='utf8')))); cell=x['cells'][0]; name=next(n for n,v in cell['fields']['summary']['fields'].items() if v['kind']=='numeric_or_text_leaf' and v.get('matlab_class')!='char')
s=importlib.util.spec_from_file_location('r',D/'hdf5_batch_reader.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
v,m=r.read_numeric(x['input_path'],f'summary/{name}',0,start=0,count=7)
with h5py.File(x['input_path'],'r') as h:
 ref=h['batch']['summary'][r.physical_index(h['batch']['summary'].shape,0)];g=h[ref];d=g[name]; exp=np.array([d[r.physical_index(d.shape,i)] for i in range(min(7,d.size))])
out={'file_id':x['file_id'],'field':f'summary/{name}','elements':len(v),'exact_equal':bool(np.array_equal(v,exp,equal_nan=True)),'trace':m['reference_trace'],'values_emitted':False}
(O/'HDF5_ACTUAL_SPOTCHECK.json').write_text(json.dumps(out,indent=2)+'\n');print(out['exact_equal'])
