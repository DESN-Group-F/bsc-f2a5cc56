import json,pathlib
R=pathlib.Path(__file__).parent
rows=[]
for p in R.glob('TAR_JSON_GZ_FULL_SCHEMAS.exact.f0.p*.jsonl'):
 rows += [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
schemas=[json.loads(s) for s in (R/'TAR_MEMBER_SCHEMAS.jsonl').read_text(encoding='utf-8-sig').splitlines() if s]
ordered=sorted((x for x in schemas if x.get('container_file_id')==rows[0]['container_file_id'] and x.get('member_path','').endswith('.json.gz') and '/._' not in x.get('member_path','')),key=lambda x:x['member_path'])
index={(x['container_file_id'],x['member_path']):i for i,x in enumerate(ordered)}
for shard in range(4):
 p=R/f'TAR_JSON_GZ_FULL_SCHEMAS.exact.f0.4way.p{shard}.jsonl'
 with p.open('w',encoding='utf-8',newline='\n') as f:
  for row in sorted((x for x in rows if index[(x['container_file_id'],x['member_path'])]%4==shard),key=lambda x:x['member_path']):f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n')
print(json.dumps({'seed_rows':len(rows),'unique':len({(x['container_file_id'],x['member_path']) for x in rows})}))
