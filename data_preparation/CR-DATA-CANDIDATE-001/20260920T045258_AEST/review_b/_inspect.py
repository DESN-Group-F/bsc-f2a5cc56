import json,pathlib,collections
p=pathlib.Path('CANDIDATE_SCOPE.jsonl')
xs=[json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
ys=[x for x in xs if x.get('lane')=='review_b']
print(len(ys),collections.Counter(x.get('source_id') for x in ys),collections.Counter(x.get('file_id') for x in ys))
for x in ys:
 c=x.get('candidate',x)
 print(json.dumps({k:c.get(k) for k in ['fact_id','file_id','source_id','locator','original_locator','text','statement','quantity','unit','conditions','unknowns']},ensure_ascii=False))
