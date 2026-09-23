from __future__ import annotations
import json
import sys
from pathlib import Path
from urllib.parse import parse_qsl

RUN=Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST')
COV=RUN/'coverage'
FILES=['DOMAIN_COVERAGE.jsonl','TASK_COVERAGE.jsonl','SOURCE_USE_DECISIONS.jsonl','SUPPLEMENT_MANIFEST.jsonl','OPEN_ITEMS.jsonl']

def rows(name):
 return [json.loads(x) for x in (COV/name).read_text(encoding='utf-8').splitlines() if x.strip()]

def all_refs(o):
 out=[]
 if isinstance(o,dict):
  for k,v in o.items():
   if k in ('evidence_refs','content_evidence','artifact_refs') and isinstance(v,list): out.extend(x for x in v if isinstance(x,str))
   else: out.extend(all_refs(v))
 elif isinstance(o,list):
  for v in o: out.extend(all_refs(v))
 return out

def resolve(s):
 base,sep,frag=s.partition('#'); p=Path(base)
 d={'ref':s,'path_exists':p.exists(),'selector_checked':False,'matches':None,'error':None}
 if not p.exists(): d['error']='path_missing'; return d
 if not sep: return d
 sel=dict(parse_qsl(frag,keep_blank_values=True))
 if not sel: d['error']='unparsed_selector'; return d
 if p.suffix.lower()!='.jsonl': d['error']='selector_on_non_jsonl'; return d
 d['selector_checked']=True; n=0
 try:
  for line in p.open(encoding='utf-8'):
   if not line.strip(): continue
   o=json.loads(line)
   if all(str(o.get(k))==v for k,v in sel.items()): n+=1
  d['matches']=n
  if not n: d['error']='selector_zero_match'
 except Exception as e: d['error']='read_error:'+type(e).__name__
 return d

sets={f:rows(f) for f in FILES}
resolved=[]
for fn,rs in sets.items():
 for i,o in enumerate(rs,1):
  for x in all_refs(o):
   q=resolve(x); q.update(record=f'{fn}:{i}'); resolved.append(q)
missing=[x for x in resolved if x['error']]
dom={x['domain_id']:x for x in sets['DOMAIN_COVERAGE.jsonl']}; task={x['task_id']:x for x in sets['TASK_COVERAGE.jsonl']}; src={x['source_id']:x for x in sets['SOURCE_USE_DECISIONS.jsonl']}
checks={
 'domain_rows_9':len(dom)==9,
 'task_rows_18':len(task)==18,
 'source_rows_48':len(src)==48,
 'all_evidence_paths_and_selectors_resolve':not missing,
 'all_jsonl_selectors_actually_checked':all(x['selector_checked'] for x in resolved if '#' in x['ref'] and Path(x['ref'].split('#')[0]).suffix.lower()=='.jsonl'),
 'content_index_selectors_unique':all(x['matches']==1 for x in resolved if Path(x['ref'].split('#')[0]).name=='CONTENT_INDEX.jsonl'),
 'dom02_excludes_unfrozen_041_042':not any('SRC-041' in x or 'SRC-042' in x for x in dom['DOM-02']['content_evidence']),
 'task03_excludes_waste_src043':not any('SRC-043' in x for x in task['TASK-03']['evidence_refs']),
 'task01_has_battery_electrochem_heat_and_soc_soh_boundary':all(any(k in x for x in task['TASK-01']['evidence_refs']) for k in ['DOE-BAT-01','OS-CHEM-01','DOE-THERMO-01','SOC-SOH-BOUNDARY-01']),
 'required_thermal_basis_not_openstax_only':all(any(k in x for x in dom['DOM-01']['content_evidence']) for k in ['DOE-THERMO-01','DOE-THERMO-02']),
 'dom03_has_measurement_uncertainty_basis':any('NIST-UNC-01' in x for x in dom['DOM-03']['content_evidence']),
 'dom03_and_task05_bind_nasa_field_contract':all(any('NASA_PCOE_BATTERY_FIELDS' in x for x in y) for y in [dom['DOM-03']['content_evidence'],task['TASK-05']['evidence_refs']]),
 'task06_has_ai_usable_doe_electrical_basis':all(any(k in x for x in task['TASK-06']['evidence_refs']) for k in ['DOE-ELEC-01','DOE-ELEC-02']),
 'src001_is_unsw_public_role':'UNSW public institutional' in src['SRC-001']['use_role'],
 'source_decisions_have_concrete_rights_fields':all(all(x.get(k) is not None for k in ['publisher','authority_class','license_observed','ai_retrieval_permission','redistribution_permission','training_permission','content_preparation_status']) for x in src.values()),
 'src017_current_run_150_files_recorded':src['SRC-017'].get('current_run_file_count')==150 and src['SRC-017'].get('current_run_prepared_file_count')==150,
 'src009_current_run_exact_files_recorded':src['SRC-009'].get('current_run_file_count',0)>0 and src['SRC-009'].get('current_run_prepared_file_count')==src['SRC-009'].get('current_run_file_count'),
 'historical_status_separated_from_current_actions':all(isinstance(x.get('historical_registered_status'),dict) and x.get('local_processing_basis') in ('CURRENT_RUN_EXACT_FILE_BINDINGS_AND_ACTUAL_ACTIONS','NO_CURRENT_RUN_ORIGINAL_OR_ACTION') for x in src.values()),
 'src041_042_not_used':all(src[x]['decision']=='NOT_USED_NO_FROZEN_CONTENT' for x in ['SRC-041','SRC-042']),
 'openstax_ai_restriction_explicit':any(x.get('open_item_id')=='OPEN-06' for x in sets['OPEN_ITEMS.jsonl']),
 'air_transport_full_dgr_gap_explicit':task['TASK-12'].get('required_public_gap') is not None,
}
status='PASS' if all(checks.values()) else 'FAIL'
result={'status':status,'scope':'READY-COVER exact selector resolution, round-1 semantic finding closure, source-use fields and supplement integrity; not downstream scientific/model/site validation','checks':checks,'counts':{'domains':len(dom),'tasks':len(task),'source_decisions':len(src),'source_file_bindings':len(rows('SOURCE_USE_FILE_BINDINGS.jsonl')),'supplement_records':len(sets['SUPPLEMENT_MANIFEST.jsonl']),'open_items':len(sets['OPEN_ITEMS.jsonl']),'evidence_refs_checked':len(resolved),'jsonl_selectors_checked':sum(x['selector_checked'] for x in resolved)},'selector_errors':missing,'round1_finding_closure':{'RC-01':'FIXED: DOM-02 uses exact CONTENT_INDEX locators; SRC-041/042 excluded.','RC-02':'FIXED: TASK-03 uses Molicel/Libre Solar exact content locators; SRC-043 removed.','RC-03':'FIXED: SRC-001 classified as UNSW public institutional guidance with adoption limit.','RC-04':'FIXED: TASK-01 binds DOE, electrochemical, thermal and SOC/SOH boundary facts.','RC-05':'FIXED: each source separates historical registered status from current exact-file actions/rights in SOURCE_USE_FILE_BINDINGS.'},'not_checked':['scientific fitness for every future case','target-site approval or current local emergency card','server/RAG/model behavior','accuracy of facts beyond cited bounded source locators'],'command':r'E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation\CR-DATA-READY-001\20260920T012405_AEST\coverage\validate_coverage.py'}
# Record this invocation rather than copying the historical author's interpreter.
result.pop('command', None)
result['command_argv']=[sys.executable, '-B', str(Path(__file__).resolve())]
(COV/'CHECK_RESULTS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(0 if status=='PASS' else 1)
