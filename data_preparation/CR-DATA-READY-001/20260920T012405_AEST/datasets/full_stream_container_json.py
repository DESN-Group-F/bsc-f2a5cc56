import json,pathlib,zipfile,time,collections,ijson
from read_ready_data import NonfiniteTaggedView
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
targets=[x for x in load(ROOT/'CONTAINER_MEMBER_SCHEMAS.jsonl') if x.get('read_status')=='BOUNDED_STREAM_SCHEMA_READ' and x.get('suffix')=='.json']
out=ROOT/'CONTAINER_JSON_FULL_SCHEMAS.jsonl';log=ROOT/'CONTAINER_JSON_FULL_SCHEMAS.log';done={(x['container_file_id'],x['member_path']) for x in load(out)} if out.exists() else set()
with out.open('a',encoding='utf-8',newline='\n') as fo,log.open('a',encoding='utf-8',buffering=1) as lg:
 for k,g in enumerate(targets,1):
  key=(g['container_file_id'],g['member_path'])
  if key in done:continue
  t=time.time();keys=set();prefixes=set();events=collections.Counter();err=None;complete=False
  try:
   with zipfile.ZipFile(src[key[0]]['input_path']) as z, z.open(key[1]) as raw:
    view=NonfiniteTaggedView(raw)
    for prefix,event,value in ijson.parse(view):
     events[event]+=1
     if event=='map_key':keys.add(str(value));prefixes.add(prefix)
    complete=True;nf=dict(view.counts)
  except Exception as e:err=type(e).__name__+': '+str(e);nf={}
  r={'container_file_id':key[0],'member_path':key[1],'member_bytes':g['member_bytes'],'complete':complete,'error':err,'field_names':sorted(keys),'object_prefixes':sorted(prefixes),'event_counts':dict(events),'nonfinite_counts':nf,'elapsed_seconds':round(time.time()-t,3),'source_values_emitted':False}
  fo.write(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n');fo.flush();lg.write(f'{k}/{len(targets)}\t{key[0]}\t{key[1]}\tcomplete={complete}\tfields={len(keys)}\telapsed={r["elapsed_seconds"]}\n')
