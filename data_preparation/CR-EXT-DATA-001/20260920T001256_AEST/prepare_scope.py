"""Freeze the new user-authorized scope from existing mapping metadata."""
from pathlib import Path
from datetime import datetime, timezone
import json
import hashlib

RUN = Path(__file__).resolve().parent
PROJECT = RUN.parents[2]
OLD = PROJECT / 'data_preparation/CR-DATA-MAP-001/20260919T233638_AEST'


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def write(name, obj):
    (RUN / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    mapping = {r['file_id']: r for r in rows(OLD / 'DATA_MAPPING.jsonl')}
    inputs = rows(OLD / 'INPUT_SCOPE.jsonl')
    for row in inputs:
        row['mapping_v1'] = mapping[row['file_id']]
        row['pending67'] = mapping[row['file_id']]['mapping_status'] != 'STRUCTURE_IDENTIFIED'
    assert len(inputs) == len({r['file_id'] for r in inputs}) == 300
    assert sum(r['pending67'] for r in inputs) == 67
    assert sum(r['pending67'] and r['assigned_lane'] == 'documents' for r in inputs) == 32
    (RUN / 'INPUT_SCOPE.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in inputs), encoding='utf-8')
    for directory in ('requirements', 'documents67', 'datasets67', 'existing233'):
        (RUN / directory).mkdir(exist_ok=True)
    write('USER_SCOPE.json', {
        'recorded_at_utc': datetime.now(timezone.utc).isoformat(),
        'user_requested': ['Assess authority and coverage against project external-data requirements',
                           'Process the remaining local 60+7',
                           'Complete external data preparation before the next project stage'],
        'purpose_user_confirmed': 'UNSW_COURSE_OR_NONCOMMERCIAL_RESEARCH_ONLY',
        'target_chemistries_equipment_and_site': 'USER_QUESTION_PENDING',
        'source_root_read_only': 'E:/desn 2000/data/battery_data_workspace_v0_3',
        'local_action_authorization': 'Specific local inspection, offline extraction/preparation and quality checks for existing materials',
        'not_implied': ['rights-holder waiver', 'AI-context/indexing admission', 'training', 'redistribution', 'server transfer', 'production deployment'],
        'legacy_ai_precheck_state_policy': 'Preserve old state; assess the concrete local action separately with current user authorization and recorded conditions',
    })
    paths = [OLD / 'INPUT_SCOPE.jsonl', OLD / 'DATA_MAPPING.jsonl', OLD / 'MAPPING_COUNTS.json']
    write('INPUT_SNAPSHOT.json', {'count': 300, 'pending': 67, 'source_hashes_recomputed': 0,
          'inputs': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]})
    write('TASK_STATUS.json', {'tasks': [
        {'id': 'EXT-01', 'owner': 'requirements', 'model': 'gpt-5.6-sol', 'status': 'READY'},
        {'id': 'EXT-02', 'owner': 'documents67', 'model': 'gpt-5.6-sol', 'status': 'READY'},
        {'id': 'EXT-03', 'owner': 'datasets67', 'model': 'gpt-5.6-sol', 'status': 'READY'},
        {'id': 'EXT-04', 'owner': 'root', 'status': 'RUNNING'},
    ], 'overall_external_readiness': 'NOT_READY_UNDER_ASSESSMENT', 'next_project_stage': 'NOT_STARTED'})
    print(json.dumps({'originals': 300, 'pending67': 67, 'documents67': 32, 'datasets67': 35}))


if __name__ == '__main__':
    main()
