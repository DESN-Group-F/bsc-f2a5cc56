import json,pathlib
run=pathlib.Path('.');ready=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST')
ids={json.loads(s)['fact_id'] for s in (run/'CANDIDATE_SCOPE.jsonl').read_text(encoding='utf-8-sig').splitlines() if s and json.loads(s).get('lane')=='review_restricted'}
xs=[]
for s in (ready/'documents/FACT_CANDIDATES.jsonl').read_text(encoding='utf-8-sig').splitlines():
 x=json.loads(s)
 if x.get('fact_id') in ids:xs.append(x)
pathlib.Path('review_restricted/CANDIDATES_DETAIL.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in xs),encoding='utf-8')
for x in xs:print(x['fact_id'],x['locator'],[(m['literal'],m['unit']) for m in x['numeric_unit_mentions']],ascii(x['source_literal']))
