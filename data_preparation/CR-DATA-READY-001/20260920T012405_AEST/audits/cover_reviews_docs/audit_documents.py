from __future__ import annotations
import json
from pathlib import Path
RUN=Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST'); DOC=RUN/'documents'; OUT=RUN/'audits'/'cover_reviews_docs'
def jl(p): return [json.loads(x) for x in p.open(encoding='utf-8') if x.strip()]
ready=jl(DOC/'FILE_READINESS.jsonl'); idx=jl(DOC/'CONTENT_INDEX.jsonl'); reviewed=jl(DOC/'REVIEWED_FACT_ASSERTIONS.jsonl'); verified=jl(DOC/'VERIFIED_FACTS.jsonl'); candidates=jl(DOC/'FACT_CANDIDATES.jsonl'); supplements=jl(DOC/'SUPPLEMENT_READINESS.jsonl'); domains=jl(DOC/'DOMAIN_EVIDENCE_SUMMARY.jsonl')
by_fact={x['fact_id']:x for x in reviewed}; v_ids={x['fact_id'] for x in verified}; c_ids={x['fact_id'] for x in candidates}
offset_errors=[]
for x in reviewed:
 for m in x.get('numeric_unit_mentions',[]):
  if x['source_literal'][m['start']:m['end']] != m['literal']: offset_errors.append({'fact_id':x['fact_id'],'mention':m})
f25000=by_fact.get('FILE-002-dbbe09d3bc5e-861f23-A0001',{}); f381=by_fact.get('FILE-001-57fd540ef8f1-ae5469-A0001',{}); f86=by_fact.get('FILE-023-498cc96c406b-1255ea-A0086',{}); f97=by_fact.get('FILE-023-498cc96c406b-1255ea-A0097',{})
src38=[x for x in ready if x.get('source_id')=='SRC-038']; institutional=next((x for x in domains if x.get('domain')=='institutional_and_standards'),{})
supp_names={Path(x['input_path']).name:x for x in supplements}; doe_e=supp_names.get('DOE_HDBK_1011_92_VOL1.pdf')
checks={
 '70_unique_file_rows':len(ready)==70 and len({x['file_id'] for x in ready})==70,
 '69_content_objects':len({x['file_id'] for x in idx})==69,
 'review_partition_exact':len(reviewed)==len(verified)+len(candidates) and not(v_ids&c_ids) and set(by_fact)==v_ids|c_ids,
 'numeric_offsets_exact':not offset_errors,
 '25000kg_preserved_and_rule':any(m['literal']=='25,000kg' for m in f25000.get('numeric_unit_mentions',[])) and f25000.get('semantic_class')=='SOURCE_OPERATIONAL_RULE_OR_LIMIT' and f25000.get('condition_status')=='EXPLICIT_IN_SAME_SENTENCE',
 '381kwh_event_not_rule':f381.get('semantic_class')=='INCIDENT_OR_EVENT_DESCRIPTION',
 'src023_a0086_rule_candidate_fragment':f86.get('semantic_class')=='SOURCE_OPERATIONAL_RULE_OR_LIMIT' and f86.get('verification_status')=='CANDIDATE_WITH_EXPLICIT_UNKNOWNS' and 'TRUNCATED_OR_FRAGMENTARY_CLAUSE' in f86.get('unknowns',[]),
 'src023_a0097_rule_checked':f97.get('semantic_class')=='SOURCE_OPERATIONAL_RULE_OR_LIMIT' and f97.get('verification_status')=='SOURCE_ASSERTION_CHECKED',
 'copy_controlled_src038_not_prepared':sum(str(x.get('readiness','')).startswith('NOT_PREPARED_COPY_CONTROLLED') and not x.get('artifact_refs') for x in src38)==1,
 'institutional_live_check_bound_with_applicability_limit':institutional.get('currentness_evidence_ref','').endswith('SOURCE_USE_DECISIONS.jsonl#source_id=SRC-044') and 'applicability' in institutional.get('limit','').lower() and 'approval' in institutional.get('limit','').lower(),
 'doe_electrical_synced_to_document_readiness':bool(doe_e) and doe_e.get('input_sha256')=='6b70b143a998b6f5d006dabbfbf0c29c857a8ed2a3b74e43b1fd98b59106fdf7' and any(Path(x.split('#')[0]).exists() for x in doe_e.get('artifact_refs',[])),
 'openstax_human_only':all('HUMAN_REFERENCE' in x.get('readiness','') for n,x in supp_names.items() if n.startswith('OPENSTAX_')),
}
status='PASS_WITH_EXPLICIT_LIMITS' if all(checks.values()) else 'REWORK_REQUIRED'; findings=[]
if not checks['doe_electrical_synced_to_document_readiness']: findings.append({'finding_id':'COVER-DOC-06','severity':'MEDIUM','finding':'New DOE electrical reference used by READY-COVER is not yet synchronized into document supplement readiness with its derived locator package.','required_fix':'Add exact PDF hash, derived page/fact locator, archive/canceled historical-use limitation, Distribution A basis, and keep RAG/index admission separate.'})
result={'audit_id':'COVER-REVIEWS-DOCS-FINAL','status':status,'scope':'Independent metadata/content-binding regression audit of locked READY-DOC outputs; bounded checks, not a reread of every source page.','checks':checks,'counts':{'file_readiness':len(ready),'content_objects':len({x['file_id'] for x in idx}),'reviewed_assertions':len(reviewed),'verified_assertions':len(verified),'explicit_candidates':len(candidates),'numeric_mentions':sum(len(x.get('numeric_unit_mentions',[])) for x in reviewed),'supplement_objects':len(supplements),'offset_errors':len(offset_errors)},'findings':findings,'resolved_round1':['COVER-DOC-01 thousands separator and exact offset regression','COVER-DOC-02 assertion classes replace keyword-as-descriptive treatment','COVER-DOC-03 fragment A0086 retained as explicit candidate unknown; A0097 rule checked','COVER-DOC-04 coverage supplements synchronized except any finding listed above','COVER-DOC-05 SRC-044 official check bound while target applicability/approval remains separate'],'limitations':['Assertions were classified deterministically; this audit does not claim manual review of all 673 rows.','No all-page scientific correctness, target-site approval, legal approval, server, RAG or model behavior was tested.','SOURCE_ASSERTION_CHECKED means the assertion and binding were checked; case applicability and parameter admission remain separate.'],'command':r'E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation\CR-DATA-READY-001\20260920T012405_AEST\audits\cover_reviews_docs\audit_documents.py'}
(OUT/'ROUND1.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':status,'checks':checks,'counts':result['counts'],'findings':findings},ensure_ascii=False,indent=2)); raise SystemExit(0 if status.startswith('PASS') else 1)
