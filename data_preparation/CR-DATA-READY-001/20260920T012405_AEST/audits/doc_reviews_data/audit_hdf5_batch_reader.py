import json,tempfile,importlib.util
from pathlib import Path
import h5py,numpy as np
B=Path(r'E:/desn 2000/bsc/data_preparation/CR-DATA-READY-001/20260920T012405_AEST');D=B/'datasets';O=B/'audits'/'doc_reviews_data'
s=importlib.util.spec_from_file_location('r',D/'hdf5_batch_reader.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
checks=[]
def ck(i,fn):
 try: ok,ev=fn();checks.append({'check_id':i,'status':'PASS' if ok else 'FAIL','evidence':ev})
 except Exception as e:checks.append({'check_id':i,'status':'FAIL','evidence':{'exception':type(e).__name__,'message':str(e)}})
def rejects(fn,typ=(ValueError,IndexError,KeyError)):
 try:fn();return False,'accepted'
 except typ as e:return True,type(e).__name__+': '+str(e)
with tempfile.TemporaryDirectory(dir=O) as td:
 p=Path(td)/'f.h5'
 with h5py.File(p,'w') as h:
  b=h.create_group('batch'); refs=b.create_dataset('summary',(2,),dtype=h5py.ref_dtype); cyc=b.create_dataset('cycles',(2,),dtype=h5py.ref_dtype)
  for i in range(2):
   g=h.create_group(f's{i}');g['v']=np.array([[i,i+1],[i+2,i+3]],dtype='f8');g['scalar']=np.array(i+9,dtype='i4');g['textcodes']=np.array([65,66],dtype='u2');g['textcodes'].attrs['MATLAB_class']=np.bytes_('char');refs[i]=g.ref
   cg=h.create_group(f'c{i}'); cr=cg.create_dataset('v',(2,),dtype=h5py.ref_dtype)
   for j in range(2):a=h.create_dataset(f'a{i}_{j}',data=np.array([[10*i+j,10*i+j+1],[10*i+j+2,10*i+j+3]],dtype='f8'));cr[j]=a.ref
   cyc[i]=cg.ref
  b.create_dataset('nulls',(1,),dtype=h5py.ref_dtype)
 def rd(*a,**k):return r.read_numeric(p,*a,**k)
 ck('C_ORDER_CROSS_ROW',lambda:(rd('summary/v',0,start=1,count=3)[0].tolist()==[1,2,3],rd('summary/v',0,start=1,count=3)[1]))
 ck('SCALAR',lambda:(rd('summary/scalar',1,count=5)[0].tolist()==[10],rd('summary/scalar',1,count=5)[1]))
 ck('CYCLE_REFERENCE',lambda:(rd('cycles/v',1,1,count=4)[0].tolist()==[11,12,13,14],rd('cycles/v',1,1,count=4)[1]))
 for ident,fn in [('NEG_CELL',lambda:rd('summary/v',-1)),('BAD_FIELD',lambda:rd('summary/nope',0)),('NULL_REF',lambda:rd('nulls',0)),('CYCLE_REQUIRED',lambda:rd('cycles/v',0)),('SPURIOUS_CYCLE',lambda:rd('summary/v',0,0)),('NEG_BOUND',lambda:rd('summary/v',0,start=-1)),('ELEMENT_PREBUDGET',lambda:rd('summary/v',0,count=3,max_elements=2)),('BYTE_PREBUDGET',lambda:rd('summary/v',0,count=2,max_bytes=8)),('MATLAB_CHAR_REJECTED',lambda:rd('summary/textcodes',0))]:
  ck(ident,lambda fn=fn:(lambda q:(q[0],q[1]))(rejects(fn)))
(O/'HDF5_BATCH_READER_FIXTURE.json').write_text(json.dumps({'checks':checks,'pass_count':sum(x['status']=='PASS' for x in checks),'fail_count':sum(x['status']=='FAIL' for x in checks)},indent=2)+'\n')
print(json.dumps({'pass':sum(x['status']=='PASS' for x in checks),'fail':[x['check_id'] for x in checks if x['status']=='FAIL']}))

