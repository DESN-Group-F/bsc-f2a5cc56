import json,collections
xs=[json.loads(s) for s in open('review_b/CANDIDATES_DETAIL.jsonl',encoding='utf-8-sig')]
for x in xs:
 print(x['fact_id'],x['locator'],[(m['literal'],m['unit']) for m in x['numeric_unit_mentions']],x['source_literal'])
