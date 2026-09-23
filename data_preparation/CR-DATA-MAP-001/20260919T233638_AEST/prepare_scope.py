"""Prepare the bounded mapping inventory from existing ledgers; no source bodies."""
from pathlib import Path
import collections
import hashlib
import json
from datetime import datetime, timezone

RUN = Path(__file__).resolve().parent
PROJECT = RUN.parents[2]
SOURCE = Path('E:/desn 2000/data/battery_data_workspace_v0_3')
PHASE = PROJECT / 'data_preparation/CR-DATA-ROUTE-001/20260919T185236_AEST_phase_a'
PRIOR = PROJECT / 'data_preparation/CR-DATA-ROUTE-001/20260919T200403_local_processing_05'

def rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def write_jsonl(path, values):
    path.write_text(''.join(json.dumps(v, ensure_ascii=False) + '\n' for v in values), encoding='utf-8')

def main():
    inputs = {
        'routing': PHASE / 'ROUTING_MANIFEST.jsonl',
        'file_inventory': SOURCE / 'collection/public_collection/file_inventory.jsonl',
        'rights': SOURCE / 'collection/public_collection/rights_inventory.jsonl',
        'extractions': SOURCE / 'collection/public_collection/extraction_inventory.jsonl',
        'prior_processing': PRIOR / 'PROCESSING_MANIFEST.jsonl',
        'prior_rights': PRIOR / 'RIGHTS_RESOLUTION.json',
        'prior_artifacts': PRIOR / 'ARTIFACT_INDEX.json',
    }
    route = rows(inputs['routing'])
    inventory = {r['file_id']: r for r in rows(inputs['file_inventory'])}
    rights = rows(inputs['rights'])
    extracts = collections.defaultdict(list)
    for record in rows(inputs['extractions']):
        extracts[record['input_file_id']].append(record)
    prior = {r['file_id']: r for r in rows(inputs['prior_processing'])}
    prior_rights = {r['file_id']: r for r in json.loads(inputs['prior_rights'].read_text(encoding='utf-8-sig'))['records']}
    assert len(route) == len({r['file_id'] for r in route}) == 300
    assert all(r['file_id'] in inventory for r in route)
    numeric_suffixes = {'.csv', '.xlsx', '.json', '.mat', '.h5', '.hdf5', '.zip', '.gz', '.tgz', '.tar', '.npy', '.npz'}
    scope = []
    for r in route:
        file_id = r['file_id']
        inv = inventory[file_id]
        assert inv['sha256'] == r['sha256']
        ext = Path(r['relative_path']).suffix.lower()
        lane = 'datasets' if ext in numeric_suffixes or ext[1:].isdigit() else 'documents'
        scope.append({
            'file_id': file_id, 'source_id': r['source_id'],
            'relative_path': r['relative_path'], 'sha256_registered': r['sha256'],
            'bytes_registered': r['byte_size_registered'], 'assigned_lane': lane,
            'inventory': inv, 'prior_routing': r, 'prior_processing': prior.get(file_id),
            'prior_selected_rights': prior_rights.get(file_id),
            'existing_rights_records': [x for x in rights if x.get('file_id') == file_id or (x.get('source_id') == r['source_id'] and not x.get('file_id'))],
            'existing_extractions': extracts[file_id],
        })
    scope.sort(key=lambda r: r['file_id'])
    write_jsonl(RUN / 'INPUT_SCOPE.jsonl', scope)
    input_records = []
    for name, path in inputs.items():
        data = path.read_bytes()
        input_records.append({'name': name, 'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    counts = dict(collections.Counter(x['assigned_lane'] for x in scope))
    write_json(RUN / 'INPUT_SNAPSHOT.json', {
        'run_id': RUN.name, 'generated_at_utc': datetime.now(timezone.utc).isoformat(),
        'purpose': 'MAPPING_ONLY_NO_METHOD_SELECTION', 'source_root': str(SOURCE),
        'phase_a_root': str(PHASE), 'prior_processing_root': str(PRIOR),
        'scope_count': len(scope), 'lane_counts': counts, 'inputs': input_records,
        'raw_source_bytes_read': 0, 'raw_source_hashes_recomputed': 0,
        'scope_definition': 'Exact file_id set from existing Phase A routing, 300 original representations; members and derivatives are separate.',
        'baseline_integrity': 'Registered hashes reused; only input ledger bytes hashed this run.',
    })
    for name in ('documents', 'datasets', 'lineage'):
        (RUN / name).mkdir(exist_ok=True)
    write_json(RUN / 'TASK_STATUS.json', {
        'run_id': RUN.name, 'task_cards': str(PROJECT / 'backlog/CR_DATA_MAP_001_TASK_CARDS.md'),
        'tasks': [
            {'id': 'MAP-00', 'status': 'COMPLETE', 'owner': 'root'},
            {'id': 'MAP-01', 'status': 'READY', 'owner': 'documents', 'objects': counts['documents']},
            {'id': 'MAP-02', 'status': 'READY', 'owner': 'datasets', 'objects': counts['datasets']},
            {'id': 'MAP-03', 'status': 'READY', 'owner': 'lineage', 'objects': 300},
            {'id': 'MAP-04', 'status': 'WAITING_FOR_FRAGMENTS', 'owner': 'root'},
            {'id': 'METHOD-01', 'status': 'NOT_DISPATCHED_MAPPING_FIRST'},
            {'id': 'METHOD-02', 'status': 'NOT_DISPATCHED_MAPPING_FIRST'},
        ],
    })
    print(json.dumps({'originals': len(scope), 'lane_counts': counts, 'raw_bodies_read': 0, 'run_dir': str(RUN)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
