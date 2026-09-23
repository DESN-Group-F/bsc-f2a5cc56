"""Bounded numeric reader for a MAT member inside a nested ZIP; no object methods."""
import argparse,zipfile,tempfile,shutil,pathlib,json,numpy as np
from matio import load_from_mat
def unwrap(x):
 a=np.asarray(x)
 while a.dtype==object and a.size==1:a=np.asarray(a.reshape(-1)[0])
 return a
def main():
 p=argparse.ArgumentParser();p.add_argument('outer_zip');p.add_argument('nested_zip');p.add_argument('mat_member');p.add_argument('--variable',required=True);p.add_argument('--cycle-index',type=int,required=True);p.add_argument('--field',required=True);p.add_argument('--start',type=int,default=0);p.add_argument('--limit',type=int,default=1000);p.add_argument('--max-bytes',type=int,default=8*1024*1024);a=p.parse_args()
 if min(a.cycle_index,a.start,a.limit,a.max_bytes)<0:raise ValueError('all bounds must be nonnegative')
 with zipfile.ZipFile(a.outer_zip) as oz,tempfile.SpooledTemporaryFile(max_size=16*1024*1024) as nzf:
  with oz.open(a.nested_zip) as q:shutil.copyfileobj(q,nzf,1048576)
  nzf.seek(0)
  with zipfile.ZipFile(nzf) as nz:
   tmp=tempfile.NamedTemporaryFile(suffix='.mat',delete=False);name=tmp.name
   try:
    with nz.open(a.mat_member) as q:shutil.copyfileobj(q,tmp,1048576)
    tmp.close();obj=load_from_mat(name,raw_data=True,variable_names=[a.variable])[a.variable]
    cycles=unwrap(obj['cycle']).reshape(-1)
    if a.cycle_index>=cycles.size:raise IndexError('cycle index outside source array')
    cycle=cycles[a.cycle_index];data=unwrap(cycle['data'])
    if not data.dtype.names or a.field not in data.dtype.names:raise KeyError(f'field absent in selected cycle; available={list(data.dtype.names or [])}')
    vals=unwrap(data[a.field]).reshape(-1)
    if not np.issubdtype(vals.dtype,np.number):raise TypeError('selected field is not numeric')
    vals=vals[a.start:a.start+a.limit]
    if vals.nbytes>a.max_bytes:raise ValueError('selected values exceed max-bytes')
    print(json.dumps({'variable':a.variable,'cycle_index':a.cycle_index,'cycle_type':str(unwrap(cycle['type']).reshape(-1)[0]),'field':a.field,'source_field_length':int(unwrap(data[a.field]).size),'start':a.start,'returned_elements':int(vals.size),'dtype':str(vals.dtype),'values':vals.tolist()}))
   finally:
    try:tmp.close()
    except:pass
    try:pathlib.Path(name).unlink()
    except:pass
if __name__=='__main__':main()
