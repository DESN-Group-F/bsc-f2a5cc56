import collections, gzip, ijson, json, pathlib, tarfile, time, re
R=pathlib.Path(__file__).parent;RUN=R.parent
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
targets={(x['container_file_id'],x['member_path']):x for x in load(R/'TAR_MEMBER_SCHEMAS.jsonl') if x.get('member_path','').endswith('.json.gz') and '/._' not in x.get('member_path','')}
out=R/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl';log=R/'TAR_JSON_GZ_FULL_SCHEMAS.log';done={(x['container_file_id'],x['member_path']) for x in load(out)} if out.exists() else set()
class CountingReader:
 def __init__(self,r):self.r=r;self.n=0
 def read(self,n=-1):
  b=self.r.read(n);self.n+=len(b);return b
class FastNonfiniteView:
 token_re=re.compile(rb'(?<![A-Za-z0-9_])(?:NaN|-Infinity|Infinity)(?![A-Za-z0-9_])')
 def __init__(self,r):self.r=r;self.out=bytearray();self.tail=b'';self.in_string=False;self.trailing_bs=0;self.eof=False;self.source_bytes=0;self.counts=collections.Counter()
 def outside(self,data,final=False):
  data=self.tail+data
  if not final and len(data)>16:self.tail=data[-16:];data=data[:-16]
  elif not final:self.tail=data;return
  else:self.tail=b''
  def repl(m):self.counts[m.group().decode()]+=1;return b'null'
  self.out.extend(self.token_re.sub(repl,data))
 def process(self,data):
  pos=0
  while pos<len(data):
   if not self.in_string:
    q=data.find(b'"',pos)
    if q<0:self.outside(data[pos:]);break
    self.outside(data[pos:q],True);self.out.append(34);self.in_string=True;self.trailing_bs=0;pos=q+1
   else:
    q=data.find(b'"',pos)
    if q<0:
     self.out.extend(data[pos:]);n=0
     for b in reversed(data[pos:]):
      if b==92:n+=1
      else:break
     self.trailing_bs=n if n<len(data)-pos else self.trailing_bs+n;break
    n=0;i=q-1
    while i>=pos and data[i]==92:n+=1;i-=1
    if i<pos:n+=self.trailing_bs
    self.out.extend(data[pos:q+1]);pos=q+1;self.trailing_bs=0
    if n%2==0:self.in_string=False
 def fill(self,n):
  while len(self.out)<n and not self.eof:
   b=self.r.read(1048576);self.source_bytes+=len(b)
   if not b:self.outside(b'',True);self.eof=True;break
   self.process(b)
 def read(self,n=-1):
  if n<0:
   while not self.eof:self.fill(max(len(self.out)+1,1048576))
   n=len(self.out)
  else:self.fill(n)
  b=bytes(self.out[:n]);del self.out[:n];return b
class ChunkReader:
 def __init__(self,b,chunk=7):self.b=b;self.p=0;self.chunk=chunk
 def read(self,n=-1):
  if self.p>=len(self.b):return b''
  n=self.chunk if n<0 else min(n,self.chunk);q=self.b[self.p:self.p+n];self.p+=len(q);return q
fixture=b'{"quoted":"NaN/Infinity","escaped":"a\\\"NaN\\\\b","n":NaN,"p":Infinity,"m":-Infinity,"e":-1.2e-9}'
fixture_view=FastNonfiniteView(ChunkReader(fixture));fixture_parsed=json.loads(fixture_view.read())
assert fixture_parsed['quoted']=='NaN/Infinity' and fixture_parsed['escaped']=='a"NaN\\b' and fixture_parsed['e']==-1.2e-9
assert fixture_parsed['n'] is None and fixture_parsed['p'] is None and fixture_parsed['m'] is None and fixture_view.counts=={'NaN':1,'Infinity':1,'-Infinity':1}
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg:
 for fid in sorted({k[0] for k in targets}):
  t0=time.time();seen=0
  with tarfile.open(src[fid]['input_path'],'r|*') as tar:
   for member in tar:
    key=(fid,member.name)
    if key not in targets:continue
    if key in done:seen+=1;continue
    start=time.time();paths=collections.defaultdict(set);fields=set();events=collections.Counter();err=None;complete=False;reader=None
    try:
     raw=tar.extractfile(member)
     with gzip.GzipFile(fileobj=raw,mode='rb') as nested:
      counted=CountingReader(nested);reader=FastNonfiniteView(counted)
      for prefix,event,value in ijson.parse(reader):
       events[event]+=1
       if event=='map_key':fields.add(str(value));paths[(prefix+'.' if prefix else '')+str(value)].add('field')
       elif event in ('string','number','boolean','null','start_map','start_array'):paths[prefix].add(event)
     complete=True
    except Exception as e:err=type(e).__name__+': '+str(e)
    row={'container_file_id':fid,'member_path':member.name,'compressed_member_bytes':member.size,'decompressed_json_bytes':counted.n if reader else 0,'complete':complete,'error':err,'field_names':sorted(fields),'path_types':{p:sorted(v) for p,v in sorted(paths.items())},'event_counts':dict(events),'nonfinite_counts':dict(reader.counts) if reader else {},'elapsed_seconds':round(time.time()-start,3),'parser_code_version':'tar-nested-gzip-json-fast-lexical-nonfinite-v2','normalization_policy':'bare NaN/+Infinity/-Infinity mapped to parser-view null outside strings and counted separately; quoted strings unchanged','source_values_emitted':False}
    fo.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n');fo.flush();seen+=1;lg.write(f'{fid}\t{seen}\t{member.name}\tcomplete={complete}\tcompressed={member.size}\tdecompressed={row["decompressed_json_bytes"]}\tpaths={len(paths)}\telapsed={row["elapsed_seconds"]}\n')
  lg.write(f'{fid}\tCONTAINER_PASS_COMPLETE\telapsed={round(time.time()-t0,3)}\n')
print(json.dumps({'targets':len(targets),'rows':len(load(out))}))
