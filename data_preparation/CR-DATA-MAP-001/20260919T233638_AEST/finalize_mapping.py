"""Freeze completed mapping outputs after the independent local review."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json

RUN = Path(__file__).resolve().parent
PROJECT = RUN.parents[2]


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    checks = json.loads((RUN / 'CHECK_RESULTS.json').read_text(encoding='utf-8-sig'))
    review = json.loads((RUN / 'lineage/FINAL_REVIEW.json').read_text(encoding='utf-8-sig'))
    if checks['status'] != 'PASS' or not review.get('status', '').startswith('PASS'):
        raise SystemExit('Mapping cannot be frozen before checks and independent review pass.')
    summary_path = RUN / 'SUMMARY.md'
    summary = summary_path.read_text(encoding='utf-8')
    summary = summary.replace('状态：合并检查已通过，最终独立复核待完成。', '状态：Mapping v1 已固定（保留明确待查项）；合并检查与独立复核通过。')
    summary_path.write_text(summary, encoding='utf-8')
    status_path = RUN / 'TASK_STATUS.json'
    status = json.loads(status_path.read_text(encoding='utf-8-sig'))
    for task in status['tasks']:
        if task['id'].startswith('MAP-'):
            task['status'] = 'COMPLETE_WITH_EXPLICIT_GAPS' if task['id'] == 'MAP-04' else 'COMPLETE'
    status['mapping_version'] = 'CR-DATA-MAP-001/v1'
    status['frozen_at_utc'] = datetime.now(timezone.utc).isoformat()
    status['independent_review'] = str(RUN / 'lineage/FINAL_REVIEW.json')
    status['model_handoff'] = {'interrupted': ['mapping_documents', 'mapping_datasets', 'mapping_lineage'],
                             'worker_model': 'gpt-5.6-sol', 'context_mode': 'TASK_CARDS_AND_NECESSARY_CHECKPOINTS_ONLY',
                             'measured_token_savings': None}
    write_json(status_path, status)
    artifacts = []
    paths = sorted(p for p in RUN.rglob('*') if p.is_file() and p.name != 'ARTIFACT_INDEX.json')
    paths += [PROJECT / 'backlog/CR_DATA_MAP_001_TASK_CARDS.md', PROJECT / 'AGENTS.md']
    for path in paths:
        data = path.read_bytes()
        artifacts.append({'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    write_json(RUN / 'ARTIFACT_INDEX.json', {'mapping_version': 'CR-DATA-MAP-001/v1',
               'scope': 'New local mapping artifacts and changed coordination instructions only; no raw source hashes.',
               'artifacts': artifacts})
    print(json.dumps({'status': 'FROZEN_WITH_EXPLICIT_GAPS', 'artifacts': len(artifacts),
                      'method_assessment': 'NOT_DISPATCHED'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
