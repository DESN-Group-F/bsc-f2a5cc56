"""Join reviewed action decisions to exact inputs; no RAG or transfer is run."""
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path

RUN = Path(__file__).resolve().parent
DECISIONS = RUN / 'audits/final_build_usability/BUILD_USE_DECISIONS.jsonl'
STATUSES = {'ALLOWED_CONDITIONAL', 'PARTIAL_ACTION_SPLIT', 'NOT_ALLOWED_FOR_LOCAL_RAG'}


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def write_rows(path, records):
    path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in records), encoding='utf-8')


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1048576), b''):
            value.update(chunk)
    return value.hexdigest()


def action_record(decision):
    return {'decision_ref': str(DECISIONS) + '#decision_id=' + decision['decision_id'],
            'decision_id': decision['decision_id'], 'status': decision['status'],
            'permitted_project_actions': decision['permitted_project_actions'],
            'action_permissions': decision.get('action_permissions', {}),
            'conditions': decision.get('conditions', []),
            'excluded_components': decision.get('excluded_components', []),
            'not_permitted_or_not_decided': decision['not_permitted_or_not_decided']}


def main():
    sources = {row['file_id']: row for row in rows(RUN / 'SOURCE_OBJECTS.jsonl')}
    decisions = rows(DECISIONS)
    by_file = defaultdict(list)
    supplements = []
    errors = []
    for decision in decisions:
        if decision['status'] not in STATUSES:
            errors.append('Unknown decision status: ' + decision['decision_id'])
        if decision['status'] == 'NOT_ALLOWED_FOR_LOCAL_RAG' and decision['permitted_project_actions']:
            errors.append('Denied decision contains machine actions: ' + decision['decision_id'])
        for item in decision['exact_files']:
            original = sources.get(item['file_id'])
            if not original or original['registered_sha256'] != item['sha256']:
                errors.append('Exact source binding mismatch: ' + item['file_id'])
            by_file[item['file_id']].append(action_record(decision))
        for item in decision['exact_supplements']:
            path = Path(item['local_path'])
            if not path.is_file() or sha(path) != item['sha256']:
                errors.append('Exact supplement payload mismatch: ' + str(path))
            if decision['status'] == 'ALLOWED_CONDITIONAL' and 'openstax' in path.name.lower():
                errors.append('Explicitly restricted OpenStax payload in allowed set: ' + str(path))
            supplements.append({**item, **action_record(decision)})
    records = []
    for file_id, source in sources.items():
        matches = by_file[file_id]
        states = {row['status'] for row in matches}
        if len(states) > 1:
            errors.append('Conflicting decisions for ' + file_id)
        status = next(iter(states)) if states else 'NOT_SELECTED_FOR_MINIMUM_BUILD_SET'
        records.append({'file_id': file_id, 'source_id': source['source_id'],
                        'registered_sha256': source['registered_sha256'],
                        'local_preparation_ref': str(RUN / source['lane'] / 'FILE_READINESS.jsonl') + '#file_id=' + file_id,
                        'build_use_status': status, 'action_decisions': matches,
                        'unlisted_rule': 'No machine-use admission inferred; see exact rights/local preparation evidence before selecting another use.',
                        'server_transfer_performed': False})
    supplement_states = defaultdict(set)
    for item in supplements:
        supplement_states[str(Path(item['local_path']).resolve()).casefold()].add(item['status'])
    if any(len(states) > 1 for states in supplement_states.values()):
        errors.append('Conflicting decisions for an exact supplement payload')
    result = {'status': 'PASS' if not errors else 'FAIL',
              'checked_at': datetime.now().astimezone().isoformat(),
              'scope': 'Exact use-decision joins and supplement payload integrity, not legal certification or permission for new actions.',
              'source_file_count': len(records),
              'source_status_counts': dict(Counter(r['build_use_status'] for r in records)),
              'supplement_payload_count': len(supplements),
              'supplement_status_counts': dict(Counter(r['status'] for r in supplements)),
              'decisions_sha256': sha(DECISIONS),
              'original_payloads_rehashed': False,
              'original_integrity_basis': 'Frozen registered hashes plus current source stat checks; originals remain read-only.',
              'errors': errors}
    (RUN / 'BUILD_USE_INDEX_CHECK_RESULTS.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if errors:
        raise ValueError('; '.join(errors))
    write_rows(RUN / 'BUILD_USE_INDEX.jsonl', records)
    write_rows(RUN / 'SUPPLEMENT_USE_INDEX.jsonl', supplements)
    print(json.dumps({'status': result['status'], 'source_status_counts': result['source_status_counts'],
                      'supplement_status_counts': result['supplement_status_counts']}))


if __name__ == '__main__':
    main()
