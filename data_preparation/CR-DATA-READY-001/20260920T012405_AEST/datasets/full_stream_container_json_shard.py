import json,pathlib,zipfile,time,collections,ijson,sys
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent;SHARD=int(sys.argv[1]);TOTAL=int(sys.argv[2])
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
alltargets=[x for x in load(ROOT/'CONTAINER_MEMBER_SCHEMAS.jsonl') if x.get('read_status')=='BOUNDED_STREAM_SCHEMA_READ' and x.get('suffix')=='.json']
targets=[x for i,x in enumerate(alltargets) if i%TOTAL==SHARD];out=ROOT/f'CONTAINER_JSON_FULL_SCHEMAS.{TOTAL}way.shard{SHARD}.jsonl';log=ROOT/f'CONTAINER_JSON_FULL_SCHEMAS.{TOTAL}way.shard{SHARD}.log';done={(x['container_file_id'],x['member_path']) for x in load(out)} if out.exists() else set()
class Norm:
 def __init__(self,r):self.r=r;self.b=bytearray();self.w=bytearray();self.s=False;self.e=False;self.eof=False;self.c=collections.Counter();self.n=0
 def emit(self):
  if self.w:
   w=bytes(self.w)
   if w in (b'NaN',b'Infinity',b'-Infinity'):self.b.extend(b'null');self.c[w.decode()]+=1
   else:self.b.extend(w)
   self.w.clear()
 def fill(self,n):
  while len(self.b)<n and not self.eof:
   q=self.r.read(1048576);self.n+=len(q)
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
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg:
 for k,g in enumerate(targets,1):
  key=(g['container_file_id'],g['member_path'])
  if key in done:continue
  t=time.time();paths=collections.defaultdict(set);keys=set();events=collections.Counter();err=None;complete=False
  try:
   with zipfile.ZipFile(src[key[0]]['input_path']) as z,z.open(key[1]) as raw:
    view=Norm(raw)
    for prefix,event,value in ijson.parse(view):
     events[event]+=1
     if event=='map_key':keys.add(str(value));paths[(prefix+'.' if prefix else '')+str(value)].add('field')
     elif event in ('string','number','boolean','null','start_map','start_array'):paths[prefix].add(event)
    complete=True;nf=dict(view.c);read=view.n
  except Exception as e:err=type(e).__name__+': '+str(e);nf={};read=0
  r={'container_file_id':key[0],'member_path':key[1],'member_bytes':g['member_bytes'],'bytes_read':read,'complete':complete,'error':err,'field_names':sorted(keys),'path_types':{p:sorted(v) for p,v in sorted(paths.items())},'event_counts':dict(events),'nonfinite_counts':nf,'elapsed_seconds':round(time.time()-t,3),'source_values_emitted':False,'shard':SHARD,'parser_code_version':'container-json-schema-v2-local-normalizer-no-injected-fields','normalization_policy':'bare NaN/+Infinity/-Infinity mapped to parser-view null for structural traversal and counted separately; original null remains in null event counts; use typed reader to preserve value distinctions'}
  fo.write(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n');fo.flush();lg.write(f'{k}/{len(targets)}\t{key[0]}\t{key[1]}\tcomplete={complete}\tpaths={len(paths)}\telapsed={r["elapsed_seconds"]}\n')
