#!/usr/bin/env python3
"""Validate this specification bundle, not the future application or Qwen capability."""
from __future__ import annotations
import json
from pathlib import Path
import sys
try:
    from jsonschema import Draft202012Validator
except ImportError as exc:
    raise SystemExit('Use an isolated environment; install requirements-handoff.txt with user approval.') from exc
ROOT=Path(__file__).resolve().parents[1]

def read(rel:str):return json.loads((ROOT/rel).read_text(encoding='utf-8'))
def read_lines(rel:str):return [json.loads(x) for x in (ROOT/rel).read_text(encoding='utf-8').splitlines() if x.strip()]

def check_envelope_consistency(envelope:dict) -> list[str]:
    """Small contract consistency checks only; not a domain/safety validator."""
    problems=[]
    proposal=envelope.get('proposal')
    if proposal and proposal['scope']['scope_class']=='C4':
        if envelope.get('retrieval_status')!='COMPLETE' or not proposal['scope']['search_run_refs']:
            problems.append('C4_REQUIRES_COMPLETED_RETRIEVAL_AND_TRACE')
    if envelope.get('provider_type')=='MOCK' and not envelope.get('is_demo'):
        problems.append('MOCK_MUST_BE_LABELLED_DEMO')
    if envelope.get('actual_business_receipts'):
        problems.append('BUSINESS_NOT_CONNECTED')
    return problems

def validate()->dict:
    errors=[]
    required=['README.md','IMPLEMENTATION_PLAN.md','AGENTS.md','PROJECT_START.md','docs/ARCHITECTURE.md','docs/RAG_AND_DATA.md','docs/CONTRACTS_AND_API.md','docs/STATE_TOOLS_AND_PREDICTION.md','docs/EVALUATION_AND_TRAINING_LATER.md','docs/LOCAL_SETUP_AND_MIGRATION.md','docs/SOURCES_AND_DECISIONS.md','docs/OPEN_DECISIONS.md']
    for f in required:
        if not (ROOT/f).is_file():errors.append('MISSING '+f)
    schemas={}
    for p in (ROOT/'contracts').glob('*.schema.json'):
        schema=json.loads(p.read_text(encoding='utf-8'))
        Draft202012Validator.check_schema(schema)
        schemas[p.stem.removesuffix('.schema')]=Draft202012Validator(schema)
    mapping={'examples/education_proposal.json':'model_analysis_proposal','examples/tool_result.demo.json':'tool_result','examples/analysis_envelope.demo.json':'analysis_envelope','examples/source_record.demo.json':'source_record','examples/analysis_request.demo.json':'analysis_request','examples/case_snapshot.demo.json':'case_snapshot','config/model_profile.example.json':'model_profile'}
    for path,name in mapping.items():
        for e in schemas[name].iter_errors(read(path)):errors.append(f'{path}: {e.message}')
    errors.extend(check_envelope_consistency(read('examples/analysis_envelope.demo.json')))
    cfg=read('config/local.example.json')
    for key in ['training_enabled','automatic_seed_generation_enabled','online_feedback_training_enabled','external_business_writes_enabled','device_control_enabled']:
        if cfg[key] is not False:errors.append('UNSAFE_INITIAL_FLAG '+key)
    if cfg['server']['host']!='127.0.0.1':errors.append('LOOPBACK_DEFAULT_REQUIRED')
    if cfg['ingest']['follow_symlinks'] or cfg['ingest']['auto_run_document_code']:errors.append('UNSAFE_INGEST_DEFAULT')
    for alg,v in read('config/training_deferred.json')['algorithms'].items():
        if v['enabled']:errors.append('TRAINING_NOT_DEFERRED '+alg)
    if read('config/training_deferred.json')['fixed_seed_count'] is not None:errors.append('NO_FIXED_SEED_QUOTA_NOW')
    tasks=read('backlog/tasks.json');taskmap={t['task_id']:t for t in tasks}
    if len(taskmap)!=len(tasks):errors.append('DUPLICATE_TASK_ID')
    visiting=set();visited=set()
    def visit(tid):
        if tid in visiting:raise ValueError('TASK_DEPENDENCY_CYCLE')
        if tid in visited:return
        if tid not in taskmap:raise ValueError('UNKNOWN_DEPENDENCY '+tid)
        visiting.add(tid)
        for dep in taskmap[tid]['depends_on']:visit(dep)
        visiting.remove(tid);visited.add(tid)
    try:
        for tid in taskmap:visit(tid)
    except ValueError as exc:errors.append(str(exc))
    for t in tasks:
        if t['status']!='NOT_STARTED':errors.append('NO_LOCAL_TASK_COMPLETION_CLAIMS')
    cases=read_lines('evaluation/scenario_specs.jsonl')
    ids=[c['scenario_id'] for c in cases]
    if len(ids)!=len(set(ids)):errors.append('DUPLICATE_SCENARIO_ID')
    for c in cases:
        if c['execution_status']!='NOT_RUN' or c['result'] is not None or c['is_locked_test']:errors.append('UNRUN_DESIGN_MISREPRESENTED')
    covered={m for c in cases for m in c['module_ids']}
    if covered!={f'M{i:02}' for i in range(1,10)}:errors.append('MISSING_MODULE_DESIGN')
    sources=read('manifests/technical_sources.json')
    srcids={s['id'] for s in sources}
    if srcids!={f'W{i}' for i in range(1,15)}:errors.append('SOURCE_INDEX_MISMATCH')
    if any(s['content_bundled'] for s in sources):errors.append('NO_EXTERNAL_CONTENT_BUNDLED')
    return {'status':'PASS' if not errors else 'FAIL','scope':'HANDOFF_STRUCTURE_AND_CONSISTENCY_ONLY','schemas':len(schemas),'example_records_checked':len(mapping),'planned_tasks':len(tasks),'scenario_designs_not_executed':len(cases),'modules_in_design':sorted(covered),'errors':errors,'qwen_executed':False,'local_E_drive_accessed':False,'domain_expert_review_performed':False}

if __name__=='__main__':
    try:report=validate()
    except Exception as exc:report={'status':'FAIL','errors':[f'{type(exc).__name__}: {exc}']}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    raise SystemExit(0 if report['status']=='PASS' else 1)
