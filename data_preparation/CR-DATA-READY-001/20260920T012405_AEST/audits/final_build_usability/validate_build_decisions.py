from __future__ import annotations
import hashlib,json
from pathlib import Path
R=Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST'); O=R/'audits'/'final_build_usability'
def jl(p): return [json.loads(x) for x in p.open(encoding='utf-8') if x.strip()]
d=jl(O/'BUILD_USE_DECISIONS.jsonl'); bind=jl(R/'coverage'/'SOURCE_USE_FILE_BINDINGS.jsonl'); manifest=jl(R/'coverage'/'SUPPLEMENT_MANIFEST.jsonl')
bm={(x['file_id'],x['sha256']) for x in bind}; mm={x['supplement_id']:x for x in manifest}
allowed=[x for x in d if x['status'].startswith('ALLOWED')]; partial=[x for x in d if x['status']=='PARTIAL_ACTION_SPLIT']; denied=[x for x in d if x['status'].startswith('NOT_ALLOWED')]
af={(y['file_id'],y['sha256']) for x in allowed for y in x['exact_files']}; df={(y['file_id'],y['sha256']) for x in denied for y in x['exact_files']}
asup={y['supplement_id'] for x in allowed for y in x['exact_supplements']}; dsup={y['supplement_id'] for x in denied for y in x['exact_supplements']}
allowed_names={Path(y['local_path']).name for x in allowed for y in x['exact_supplements']}; denied_names={Path(y['local_path']).name for x in denied for y in x['exact_supplements']}
pf={(y['file_id'],y['sha256']) for x in partial for y in x['exact_files']}
binding_errors=[]; payload_errors=[]
for x in d:
 for y in x['exact_files']:
  if (y['file_id'],y['sha256']) not in bm: binding_errors.append([x['decision_id'],'file',y])
 for y in x['exact_supplements']:
  m=mm.get(y['supplement_id']); p=Path(y['local_path']) if y.get('local_path') else None
  if not m or not p or not p.is_file(): binding_errors.append([x['decision_id'],'supplement_missing',y]); continue
  actual=hashlib.sha256(p.read_bytes()).hexdigest()
  if actual!=y['sha256'] or actual!=m['sha256'] or y['local_path']!=m['local_path']: binding_errors.append([x['decision_id'],'supplement_hash_or_path',y])
  semantic=' '.join(str(y.get(k,'')) for k in ['title','local_path','license_basis','use_limit']).lower()
  if x['status'].startswith('ALLOWED') and 'openstax' in semantic: payload_errors.append([x['decision_id'],'restricted_openstax_in_allowed',y['supplement_id']])
checks={
 'nine_decisions_unique':len(d)==9 and len({x['decision_id'] for x in d})==9,
 'all_file_hash_bindings_match':not binding_errors,
 'all_supplement_payload_hashes_match':not binding_errors,
 'no_allowed_denied_file_overlap':not(af&df),
 'no_allowed_denied_supplement_overlap':not(asup&dsup),
 'no_openstax_in_allowed_payloads':not payload_errors,
 'restricted_actions_empty':all(not x.get('permitted_project_actions') for x in denied),
 'restricted_payloads_exactly_bound':all(x.get('exact_files') or x.get('exact_supplements') for x in denied),
 'openstax_exactly_denied':{'OPENSTAX_CHEMISTRY_2E_17_5.html','OPENSTAX_HEAT_TRANSFER_1_4.html'}<=denied_names and not any('OPENSTAX' in x for x in allowed_names),
 'nasa_pcoe_action_split_exact':len(partial)==1 and len(pf)==2 and partial[0].get('action_permissions',{}).get('raw_numeric_tool_input')=='ALLOWED_LOCAL_NONCOMMERCIAL_ANALYSIS' and partial[0].get('action_permissions',{}).get('faithful_readme_text_retrieval_into_llm_or_rag')=='PENDING_SOURCE_SPECIFIC_PERMISSION',
 'current_overlay_declared':all(x.get('overlay_status')=='CURRENT_ACTION_SPECIFIC_OVERLAY' for x in d) and (O/'CURRENT_BUILD_USE_OVERLAY.json').is_file(),
}
status='PASS' if all(checks.values()) else 'FAIL'
out={'status':status,'scope':'Exact build-use decision cross-conflict, action split and actual-payload validation.','checks':checks,'counts':{'decisions':len(d),'allowed_exact_files':len(af),'partial_action_exact_files':len(pf),'denied_exact_files':len(df),'allowed_exact_supplements':len(asup),'denied_exact_supplements':len(dsup)},'binding_errors':binding_errors,'payload_errors':payload_errors,'preserved_rejected_artifacts':['BUILD_USE_DECISIONS.REJECTED_20260920.jsonl','CHECK_RESULTS.REJECTED_20260920.json','REPORT.REJECTED_20260920.md']}
(O/'BUILD_USE_VALIDATION.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); print(json.dumps(out,ensure_ascii=False,indent=2)); raise SystemExit(0 if status=='PASS' else 1)
