import json, pathlib
p=pathlib.Path(__file__).parent/'CONTAINER_WORKBOOK_PROFILES.jsonl'
rows=[json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s]
bad=[x for x in rows if not x.get('sheets')]
tmp=p.with_suffix('.retry.tmp')
with tmp.open('w',encoding='utf-8',newline='\n') as f:
    for row in rows:
        if row not in bad:f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n')
tmp.replace(p)
print(json.dumps({'removed_empty_profiles':len(bad)}))
