import collections,gzip,ijson,json,pathlib,sys,tarfile,time
from fast_json_normalizer import FastNormalizer
R=pathlib.Path(__file__).parent;RUN=R.parent;FID_INDEX=int(sys.argv[1]);PARITY=int(sys.argv[2]);TOTAL=int(sys.argv[3]) if len(sys.argv)>3 else 2
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
allrows=[x for x in load(R/'TAR_MEMBER_SCHEMAS.jsonl') if x.get('member_path','').endswith('.json.gz') and '/._' not in x.get('member_path','')]
fids=sorted({x['container_file_id'] for x in allrows});fid=fids[FID_INDEX];ordered=sorted((x for x in allrows if x['container_file_id']==fid),key=lambda x:x['member_path']);targets={(x['container_file_id'],x['member_path']):x for i,x in enumerate(ordered) if i%TOTAL==PARITY}
tag=f'f{FID_INDEX}.p{PARITY}' if TOTAL==2 else f'f{FID_INDEX}.{TOTAL}way.p{PARITY}'
out=R/f'TAR_JSON_GZ_FULL_SCHEMAS.exact.{tag}.jsonl';log=R/f'TAR_JSON_GZ_FULL_SCHEMAS.exact.{tag}.log';done={(x['container_file_id'],x['member_path']) for x in load(out)} if out.exists() else set()
class Count:
 def __init__(self,r):self.r=r;self.n=0
 def read(self,n=-1):b=self.r.read(n);self.n+=len(b);return b
class ExactNorm:
 def __init__(self,r):self.r=r;self.b=bytearray();self.w=bytearray();self.s=False;self.e=False;self.eof=False;self.c=collections.Counter()
 def emit(self):
  if self.w:
   w=bytes(self.w)
   if w in (b'NaN',b'Infinity',b'-Infinity'):self.b.extend(b'null');self.c[w.decode()]+=1
   else:self.b.extend(w)
   self.w.clear()
 def fill(self,n):
  while len(self.b)<n and not self.eof:
   q=self.r.read(1048576)
   if not q:self.emit();self.eof=True;break
   for x in q:
    if self.s:
     self.b.append(x)
     if self.e:self.e=False
     elif x==92:self.e=True
     elif x==34:self.s=False
    elif x==34:self.emit();self.b.append(x);self.s=True
    elif 65<=x<=90 or 97<=x<=122 or x==45:self.w.append(x)
    else:self.emit();self.b.append(x)
 def read(self,n=-1):
  if n<0:
   while not self.eof:self.fill(max(len(self.b)+1,1048576))
   n=len(self.b)
  else:self.fill(n)
  q=bytes(self.b[:n]);del self.b[:n];return q
class Chunk:
 def __init__(self,b,n=5):self.b=b;self.p=0;self.n=n
 def read(self,n=-1):
  if self.p>=len(self.b):return b''
  n=self.n if n<0 else min(n,self.n);q=self.b[self.p:self.p+n];self.p+=len(q);return q
fixture=b'{"quoted":"NaN/Infinity","escaped":"a\\\"NaN\\\\b","n":NaN,"p":Infinity,"m":-Infinity,"e":-1.2e-9}'
fv=ExactNorm(Chunk(fixture));parsed=json.loads(fv.read());assert parsed['quoted']=='NaN/Infinity' and parsed['escaped']=='a"NaN\\b' and parsed['e']==-1.2e-9 and parsed['n'] is None and fv.c=={'NaN':1,'Infinity':1,'-Infinity':1}
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg,tarfile.open(src[fid]['input_path'],'r|*') as tar:
 for member in tar:
  key=(fid,member.name)
  if key not in targets or key in done:continue
  start=time.time();paths=collections.defaultdict(set);fields=set();events=collections.Counter();err=None;complete=False;counted=None;view=None
  try:
   raw=tar.extractfile(member)
   with gzip.GzipFile(fileobj=raw,mode='rb') as nested:
    counted=Count(nested);view=FastNormalizer(counted)
    for prefix,event,value in ijson.parse(view):
     events[event]+=1
     if event=='map_key':fields.add(str(value));paths[(prefix+'.' if prefix else '')+str(value)].add('field')
     elif event in ('string','number','boolean','null','start_map','start_array'):paths[prefix].add(event)
   complete=True
  except Exception as e:err=type(e).__name__+': '+str(e)
  row={'container_file_id':fid,'member_path':member.name,'compressed_member_bytes':member.size,'decompressed_json_bytes':counted.n if counted else 0,'complete':complete,'error':err,'field_names':sorted(fields),'path_types':{p:sorted(v) for p,v in sorted(paths.items())},'event_counts':dict(events),'nonfinite_counts':dict(view.c) if view else {},'elapsed_seconds':round(time.time()-start,3),'parser_code_version':'tar-nested-gzip-json-fast-equivalent-v4','normalization_policy':'fixture-and-real-member-equivalent string-aware finite-state normalizer; bare NaN/+Infinity/-Infinity mapped to parser-view null and counted; quoted strings unchanged','normalizer_validation_refs':[str(R/'FAST_NORMALIZER_FIXTURE_CHECKS.json'),str(R/'FAST_TAR_MEMBER_EQUIVALENCE.json')],'source_values_emitted':False}
  fo.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n');fo.flush();lg.write(f'{key[1]}\tcomplete={complete}\tcompressed={member.size}\tdecompressed={row["decompressed_json_bytes"]}\tpaths={len(paths)}\telapsed={row["elapsed_seconds"]}\n')
print(json.dumps({'fid':fid,'parity':PARITY,'targets':len(targets),'rows':len(load(out))}))
