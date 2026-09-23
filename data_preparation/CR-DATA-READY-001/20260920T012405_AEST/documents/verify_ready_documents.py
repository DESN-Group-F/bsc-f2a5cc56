import json,re
from pathlib import Path
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents")
HIST=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
def jl(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
fr=jl(OUT/'FILE_READINESS.jsonl'); ci=jl(OUT/'CONTENT_INDEX.jsonl'); fc=jl(OUT/'FACT_CANDIDATES.jsonl'); vf=jl(OUT/'VERIFIED_FACTS.jsonl'); reviewed=jl(OUT/'REVIEWED_FACT_ASSERTIONS.jsonl'); op=jl(OUT/'OPEN_ITEMS.jsonl'); sr=jl(OUT/'SUPPLEMENT_READINESS.jsonl'); rev=jl(OUT/'REVIEW_RESOLUTIONS.jsonl'); kp=jl(OUT/'KEY_PAGE_CHECKS.jsonl'); renders=jl(OUT/'KEY_PAGE_RENDER_MANIFEST.jsonl')
scope={x['file_id']:x for x in jl(HIST/'INPUT_SCOPE.jsonl') if x.get('assigned_lane')=='documents'}
ids={x['file_id'] for x in fr}; checks=[]
def add(name,ok,detail): checks.append({'name':name,'status':'PASS' if ok else 'FAIL','detail':detail})
add('file_readiness_exact_70',len(fr)==70 and len(ids)==70,{'rows':len(fr),'unique_ids':len(ids)})
add('input_membership',ids<=set(scope),{'missing':sorted(ids-set(scope))})
bad_hash=[x['file_id'] for x in fr if x['input_sha256']!=scope[x['file_id']]['sha256_registered']]
add('registered_hash_binding',not bad_hash,{'mismatch':bad_hash})
missing_input=[x['file_id'] for x in fr if not Path(x['input_path']).is_file()]
add('input_paths_exist',not missing_input,{'missing':missing_input})
bad_art=[]
for x in fr:
 for ref in x['artifact_refs']:
  p=Path(ref.split('#')[0]);
  if not p.is_file() or p.stat().st_size==0:bad_art.append({'file_id':x['file_id'],'ref':ref})
add('readiness_artifacts_exist_nonempty',not bad_art,{'bad':bad_art})
add('content_index_nonempty',len(ci)>0 and {x['file_id'] for x in ci}<=ids,{'rows':len(ci),'objects':len({x['file_id'] for x in ci})})
bad_verified=[x['fact_id'] for x in vf if x.get('verification_status')!='SOURCE_ASSERTION_CHECKED' or not x.get('numeric_unit_mentions') or x.get('case_use_status')!='SOURCE_CLAIM_CHECKED_CASE_APPLICABILITY_STILL_REQUIRED']
add('verified_source_assertion_contract',not bad_verified,{'verified_rows':len(vf),'bad':bad_verified[:20]})
fact_run=json.loads((OUT/'FACT_REVIEW_RUN.json').read_text(encoding='utf-8'))
add('numeric_parser_calibration',fact_run['all_calibration_pass'],{'cases':fact_run['numeric_parser_calibration']})
vid={x['fact_id'] for x in vf}; cid={x['fact_id'] for x in fc}; rid={x['fact_id'] for x in reviewed}
add('reviewed_fact_partition',not (vid&cid) and vid|cid==rid,{'reviewed':len(rid),'verified':len(vid),'candidates':len(cid),'overlap':sorted(vid&cid)[:10]})
bad_offsets=[]
for x in reviewed:
 for m in x['numeric_unit_mentions']:
  if x['source_literal'][m['start']:m['end']]!=m['literal']:bad_offsets.append(x['fact_id'])
add('numeric_mention_offsets_and_literals',not bad_offsets,{'mentions':sum(len(x['numeric_unit_mentions']) for x in reviewed),'bad':bad_offsets[:20]})
reg=[x for x in reviewed if x['source_id']=='SRC-002' and any(m['value_text']=='25,000' and m['unit'].lower()=='kg' for m in x['numeric_unit_mentions'])]
add('rd01_thousands_separator_regression',len(reg)==1 and reg[0]['semantic_class']=='SOURCE_OPERATIONAL_RULE_OR_LIMIT' and reg[0]['condition_status']!='UNKNOWN_NOT_STATED_IN_LOCAL_BLOCK' and reg[0]['verification_status']=='SOURCE_ASSERTION_CHECKED',{'matches':[x['fact_id'] for x in reg],'classes':[x['semantic_class'] for x in reg]})
src001=[x for x in reviewed if x['source_id']=='SRC-001']; src034=[x for x in reviewed if x['source_id']=='SRC-034']
add('rd02_semantic_role_regression',all(x['semantic_class']!='SOURCE_OPERATIONAL_RULE_OR_LIMIT' for x in src001+src034),{'src001_classes':sorted({x['semantic_class'] for x in src001}),'src034_classes':sorted({x['semantic_class'] for x in src034})})
byfact={x['fact_id']:x for x in reviewed}; a86=byfact.get('FILE-023-498cc96c406b-1255ea-A0086'); a97=byfact.get('FILE-023-498cc96c406b-1255ea-A0097')
add('src023_rule_and_fragment_regressions',bool(a86 and a97 and a86['semantic_class']=='SOURCE_OPERATIONAL_RULE_OR_LIMIT' and a86['verification_status']=='CANDIDATE_WITH_EXPLICIT_UNKNOWNS' and 'TRUNCATED_OR_FRAGMENTARY_CLAUSE' in a86['unknowns'] and a97['semantic_class']=='SOURCE_OPERATIONAL_RULE_OR_LIMIT'),{'A0086':{k:a86.get(k) for k in ['semantic_class','verification_status','unknowns']} if a86 else None,'A0097':{k:a97.get(k) for k in ['semantic_class','verification_status','unknowns']} if a97 else None})
content={}
for p in (OUT/'derived').glob('FILE-*.content.jsonl'): content[p.name.split('.')[0]]=' '.join(' '.join(x.get('text','').split()) for x in jl(p))
unbound=[x['fact_id'] for x in reviewed if ' '.join(x['source_literal'].split()) not in content.get(x['file_id'],'')]
add('fact_literal_content_binding',not unbound,{'reviewed_rows':len(reviewed),'unbound':unbound[:20]})
copy=next(x for x in fr if x['file_id']=='FILE-038-cbd0f5edb42b-16d37f')
add('copy_controlled_original_not_claimed_prepared',copy['readiness']=='NOT_PREPARED_COPY_CONTROLLED_ORIGINAL_ALTERNATIVES_PARTIAL' and not copy['artifact_refs'],{'readiness':copy['readiness'],'artifact_refs':copy['artifact_refs']})
src038_png=[p for p in (OUT/'derived'/'key_page_review').glob('FILE-038-*.png') if p.stat().st_size>0]
add('src038_no_retained_page_renders',not src038_png,{'nonempty_renders':[str(x) for x in src038_png]})
add('old_reviews_accounted',len(rev)==21,{'resolutions':len(rev),'open_items':len(op)})
add('supplements_prepared',len(sr)==21 and sum(x.get('page_count',0) for x in sr)>=1823,{'objects':len(sr),'pdf_pages':sum(x.get('page_count',0) for x in sr),'openstax_human_only':sum(x.get('readiness','').startswith('HUMAN_REFERENCE') for x in sr)})
doe1092=next((x for x in sr if x['supplement_id']=='SUP-READY-DOE-HDBK-1092-2013'),None)
add('doe1092_bounded_content_ready',bool(doe1092 and doe1092.get('selected_pages_checked')==21 and doe1092.get('rag_or_index_status')=='NOT_ADMITTED'),doe1092)
doe1011=next((x for x in sr if x['supplement_id']=='SUP-COVER-DOE_HDBK_1011_92_VOL1'),None); foundation=next((x for x in sr if x['supplement_id']=='SUP-COVER-FOUNDATION_METHOD_FACTS'),None)
add('doe_electrical_historical_scope',bool(doe1011 and doe1011['input_sha256']=='6b70b143a998b6f5d006dabbfbf0c29c857a8ed2a3b74e43b1fd98b59106fdf7' and any('cancelled/archived' in z for z in doe1011['limitations']) and foundation and {'DOE-ELEC-01','DOE-ELEC-02'}<=set(foundation.get('logical_record_ids',[]))),{'doe_record':doe1011,'logical_ids':foundation.get('logical_record_ids',[]) if foundation else []})
add('key_page_review_executed',len(kp)==62 and len(renders)==47,{'geometry_pages':len(kp),'rendered_pages':len(renders)})
add('rag_index_not_admitted',all(x.get('rag_or_index_status')=='CONTENT_PREPARED_LOCAL_ONLY_NOT_ADMITTED' for x in fr),{})
# Every fact selector used by FILE_READINESS must match at least one row.
bad_sel=[]
for x in fr:
 for ref in x.get('artifact_refs',[]):
  if 'FACT_CANDIDATES.jsonl#file_id=' in ref and x['file_id'] not in {y['file_id'] for y in fc}:bad_sel.append(ref)
  if 'VERIFIED_FACTS.jsonl#file_id=' in ref and x['file_id'] not in {y['file_id'] for y in vf}:bad_sel.append(ref)
add('fact_artifact_selectors_resolve',not bad_sel,{'bad':bad_sel})
overall='PASS' if all(x['status']=='PASS' for x in checks) else 'FAIL'
(OUT/'CHECK_RESULTS.json').write_text(json.dumps({'overall':overall,'scope':'Local document preparation checks only; not RAG/server/model/domain acceptance.','checks':checks},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'overall':overall,'checks':len(checks),'failed':[x['name'] for x in checks if x['status']=='FAIL']}))
