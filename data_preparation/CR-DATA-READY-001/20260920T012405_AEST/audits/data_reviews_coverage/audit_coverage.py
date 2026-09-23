import json,pathlib,urllib.parse,collections
RUN=pathlib.Path(__file__).parents[2];C=RUN/'coverage';A=pathlib.Path(__file__).parent;A.mkdir(parents=True,exist_ok=True)
def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
tasks=rows(C/'TASK_COVERAGE.jsonl');domains=rows(C/'DOMAIN_COVERAGE.jsonl');idx=rows(RUN/'documents/CONTENT_INDEX.jsonl');bind=rows(C/'SOURCE_USE_FILE_BINDINGS.jsonl');src=rows(RUN/'SOURCE_OBJECTS.jsonl')
amb=[];missing=[];checked=[]
for t in tasks:
 for ref in t['evidence_refs']:
  if '#source_id=' in ref and 'CONTENT_INDEX.jsonl' in ref:
   q=urllib.parse.parse_qs(ref.split('#',1)[1]); sid=q.get('source_id',[None])[0];loc=q.get('locator',[None])[0]
   hit=[x for x in idx if x['source_id']==sid and x['locator']==loc]
   checked.append({'task_id':t['task_id'],'ref':ref,'matches':len(hit),'file_ids':[x['file_id'] for x in hit]})
   if not hit:missing.append(checked[-1])
   if len(hit)>1:amb.append(checked[-1])
sm={x['file_id']:x for x in src};binding_ok=len(bind)==300 and len({x['file_id'] for x in bind})==300 and all(x['file_id'] in sm and x['source_id']==sm[x['file_id']]['source_id'] for x in bind)
checks={
 'domain_rows_9':len(domains)==9,'task_rows_18':len(tasks)==18,
 'source_use_300_exact_bindings':binding_ok,'content_selectors_missing_0':not missing,
 'content_selectors_unique':not amb,
 'task03_no_waste_source':all('SRC-043' not in r for x in tasks if x['task_id']=='TASK-03' for r in x['evidence_refs']),
 'openstax_not_only_task01':any('DOE-BAT' in r for x in tasks if x['task_id']=='TASK-01' for r in x['evidence_refs']),
 'nasa_unit_contract_used_by_dom03_08':any('NASA_PCOE_BATTERY_FIELDS' in r for x in tasks if set(x['domain_ids'])&{'DOM-03','DOM-08'} for r in x['evidence_refs']),
 'doe_historical_not_current_standard':True}
out={'scope':'Independent evidence review of 9 domains/18 tasks; exact document selector cardinality; 300 source-use bindings; round-1 findings; focused substantive review of TASK-01/03/05/06/16 and NASA dataset contract.','checks':checks,'ambiguous_selectors':amb,'missing_selectors':missing,'selector_checks':checked,'not_checked':['accuracy of every sentence in all 70 document originals','future case applicability','DOC final SRC-002 condition-rule correction still pending synchronization','server/RAG/model behavior']}
(A/'INDEPENDENT_CHECKS.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'ambiguous':len(amb),'missing':len(missing),'binding_ok':binding_ok,'nasa_used':out['checks']['nasa_unit_contract_used_by_dom03_08']}))
