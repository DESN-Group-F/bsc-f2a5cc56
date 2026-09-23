import json,pathlib
run=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST')
ids={json.loads(s)['fact_id'] for s in (run/'CANDIDATE_SCOPE.jsonl').read_text(encoding='utf-8-sig').splitlines() if s and json.loads(s).get('lane')=='review_b'}
p=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents\FACT_CANDIDATES.jsonl')
for s in p.read_text(encoding='utf-8-sig').splitlines():
 x=json.loads(s)
 if x.get('fact_id') in ids: print(json.dumps(x,ensure_ascii=False))
