import importlib.util,json,tempfile,zipfile
from pathlib import Path
import numpy as np,h5py
DS=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\datasets")
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\audits\doc_reviews_data")
spec=importlib.util.spec_from_file_location('reader',DS/'read_ready_data.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
checks=[]
def ck(i,ok,e):checks.append({'check_id':i,'status':'PASS' if ok else 'FAIL','evidence':e})
with tempfile.TemporaryDirectory(dir=OUT) as td:
 p=Path(td); j=p/'collision.json';j.write_bytes(b'{"native":{"__reader_nonfinite__":"NaN"},"actual":NaN,"tail":1}')
 ev=r.json_tagged_events(j,20); native=[x for x in ev['events'] if x['path']=='native.__reader_nonfinite__']; actual=[x for x in ev['events'] if x['path']=='actual']
 ck('JSON_NATIVE_SENTINEL_SHAPE_DISTINCT',len(native)==1 and native[0]['type']=='string' and native[0]['value']=='NaN' and len(actual)==1 and actual[0]['type']=='nonfinite',{'events':ev['events']})
 lim=r.json_tagged_events(j,1);ck('JSON_LIMIT_SETS_INCOMPLETE',len(lim['events'])==1 and lim['complete'] is False and lim['truncated_by_limit'] is True,lim)
 h=p/'wide.h5'
 with h5py.File(h,'w') as f:f['wide']=np.arange(2000,dtype=np.float64).reshape(2,1000)
 try:
  hs=r.mat73_slice(h,'wide',0,100,max_elements=100,max_bytes=800);budget_ok=hs['returned_elements']<=100 and hs['returned_bytes']<=800;e={'result':hs}
 except ValueError as ex:budget_ok=True;e={'bounded_rejection':str(ex)}
 ck('HDF_SLICE_TOTAL_BUDGET_ENFORCED',budget_ok,e)
 z=p/'x.zip'
 with zipfile.ZipFile(z,'w') as q:q.writestr('a.txt',b'abc')
 try:r.bounded_member(z,'a.txt',-1);neg=False;detail='no error'
 except ValueError as ex:neg=True;detail=str(ex)
 ck('NEGATIVE_MEMBER_BYTE_LIMIT_REJECTED',neg,detail)
(OUT/'READER_EDGE_RECHECK.json').write_text(json.dumps({'checks':checks,'pass_count':sum(x['status']=='PASS' for x in checks),'fail_count':sum(x['status']=='FAIL' for x in checks)},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pass':sum(x['status']=='PASS' for x in checks),'fail':[x['check_id'] for x in checks if x['status']=='FAIL']}))
