import json,pathlib
R=pathlib.Path(__file__).parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
targets=[x for x in load(R/'CONTAINER_MEMBER_SCHEMAS.jsonl') if x.get('read_status')=='BOUNDED_STREAM_SCHEMA_READ' and x.get('suffix')=='.json'];index={(x['container_file_id'],x['member_path']):i for i,x in enumerate(targets)}
old=[]
for p in R.glob('CONTAINER_JSON_FULL_SCHEMAS.2way.shard*.jsonl'):old+=load(p)
for s in range(4):
 xs=[x for x in old if index[(x['container_file_id'],x['member_path'])]%4==s]
 with (R/f'CONTAINER_JSON_FULL_SCHEMAS.4way.shard{s}.jsonl').open('w',encoding='utf-8',newline='\n') as f:
  for x in xs:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
print(json.dumps({'seeded':len(old),'per_shard':[sum(index[(x['container_file_id'],x['member_path'])]%4==s for x in old) for s in range(4)]}))
