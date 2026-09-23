"""Stream existing experimental CSVs; retain source values and emit quality summaries."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import csv
import io
import json
import time
import sys
import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent
RUN = OUT.parent
PROJECT = RUN.parents[2]
SOURCE = Path('E:/desn 2000/data/battery_data_workspace_v0_3')
PRIOR = PROJECT / 'data_preparation/CR-DATA-ROUTE-001/20260919T200403_local_processing_05/experiments/src017_file_summaries.json'
VERSION = 'csv_quality_v1'
CHUNK_ROWS = 100_000


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def write(path, obj):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temp.replace(path)


def local_basis(row):
    effective = row['prior_routing']['rights_record']['effective_rights_id']
    for right in row['existing_rights_records']:
        exact = right.get('file_id') == row['file_id'] and right.get('file_sha256') == row['sha256_registered']
        group = not right.get('file_id') and right.get('source_id') == row['source_id'] and right.get('rights_id') == effective
        if right.get('ai_processing') == 'ALLOWED' and (exact or group):
            return {'rights_id': right['rights_id'], 'binding': 'EXACT_FILE_AND_SHA' if exact else 'RECORDED_EFFECTIVE_GROUP',
                    'evidence_ref': str(RUN / 'INPUT_SCOPE.jsonl') + '#file_id=' + row['file_id'] + '/existing_rights_records/' + right['rights_id']}
    raise PermissionError('No exact/effective group basis for this file')


def profile(handle, fields, chunk_size=CHUNK_ROWS):
    numeric = [f for f in fields if f != 'DateTime']
    stats = {f: {'missing': 0, 'invalid_numeric': 0, 'infinite': 0, 'min': None, 'max': None} for f in numeric}
    total = 0
    datetime_missing = 0
    backsteps = {'Test_Time': 0, 'Data_Point': 0}
    previous = {f: None for f in backsteps}
    for frame in pd.read_csv(handle, chunksize=chunk_size, encoding='utf-8-sig', keep_default_na=False,
                             on_bad_lines='error', skip_blank_lines=False, low_memory=False):
        if list(frame.columns) != fields or not isinstance(frame.index, pd.RangeIndex):
            raise ValueError('CSV column or implicit-index mismatch')
        for field in numeric:
            series = frame[field]
            missing = series.isna()
            if series.dtype == object or pd.api.types.is_string_dtype(series.dtype):
                series = series.astype(str).str.strip()
                missing = missing | series.eq('')
            values = pd.to_numeric(series, errors='coerce').to_numpy(dtype=float)
            blank = missing.to_numpy(dtype=bool)
            target = stats[field]
            target['missing'] += int(blank.sum())
            target['invalid_numeric'] += int((np.isnan(values) & ~blank).sum())
            target['infinite'] += int(np.isinf(values).sum())
            finite = values[np.isfinite(values)]
            if len(finite):
                lo, hi = float(finite.min()), float(finite.max())
                target['min'] = lo if target['min'] is None else min(target['min'], lo)
                target['max'] = hi if target['max'] is None else max(target['max'], hi)
            if field in backsteps and len(values):
                backsteps[field] += int((np.diff(values) < 0).sum())
                if previous[field] is not None and np.isfinite(values[0]) and values[0] < previous[field]:
                    backsteps[field] += 1
                previous[field] = float(values[-1]) if np.isfinite(values[-1]) else None
        if 'DateTime' in frame:
            values = frame['DateTime']
            datetime_missing += int((values.isna() | values.astype(str).str.strip().eq('')).sum())
        total += len(frame)
    return {'row_count': total, 'header': fields, 'numeric_fields': stats, 'datetime_missing': datetime_missing,
            'consecutive_backsteps': backsteps,
            'quality_scope': 'FULL_FILE_CSV_PARSE_NUMERIC_MISSING_NONFINITE_AND_CONSECUTIVE_ORDER_CHECK',
            'limits': ['No unit or experimental-condition assumptions; no sorting, imputation or value replacement.',
                       'DateTime values checked for missing only; timestamp format, timezone and calibration not established.',
                       'Excess fields rejected by parser; short records are reported as missing fields, not separately counted.',
                       'Backsteps describe sequence changes, not a claim that every reset is erroneous.']}


def self_check():
    sample = 'Data_Point,Test_Time,Current,DateTime\n1,0,2,t\n2,2,,t\n1,1,inf,\n3,3,bad,t\n'
    found = profile(io.StringIO(sample), ['Data_Point', 'Test_Time', 'Current', 'DateTime'], 2)
    assert found['row_count'] == 4
    assert found['numeric_fields']['Current'] == {'missing': 1, 'invalid_numeric': 1, 'infinite': 1, 'min': 2.0, 'max': 2.0}
    assert found['consecutive_backsteps'] == {'Test_Time': 1, 'Data_Point': 1}
    assert found['datetime_missing'] == 1
    write(OUT / 'CSV_SCANNER_SELF_CHECK.json', {'status': 'PASS', 'scope': 'Known missing/invalid/infinite values and reset across chunk boundary', 'script_version': VERSION})


def main():
    self_check()
    if '--self-check' in sys.argv:
        print('CSV_SCANNER_SELF_CHECK PASS', flush=True)
        return
    inputs = [r for r in rows(RUN / 'INPUT_SCOPE.jsonl') if Path(r['relative_path']).suffix.lower() == '.csv']
    prior_data = json.loads(PRIOR.read_text(encoding='utf-8-sig'))
    if isinstance(prior_data, dict):
        prior_data = prior_data.get('files', prior_data.get('records', []))
    prior = {x['file_id']: x for x in prior_data}
    assert len(inputs) == 140 and len(prior) == 5
    directory = OUT / 'csv_profiles'
    directory.mkdir(exist_ok=True)
    started = time.monotonic()
    results = []
    for index, row in enumerate(sorted(inputs, key=lambda r: r['bytes_registered']), 1):
        fid = row['file_id']
        path = SOURCE / row['relative_path']
        destination = directory / (fid + '.json')
        began = time.monotonic()
        record = {'file_id': fid, 'source_id': row['source_id'], 'source_path': str(path),
                  'sha256_registered': row['sha256_registered'], 'script_version': VERSION}
        try:
            record['local_action_basis'] = local_basis(row)
            stat = path.stat()
            record.update({'source_bytes': stat.st_size, 'source_mtime_ns': stat.st_mtime_ns})
            if stat.st_size != row['bytes_registered']:
                raise ValueError('Original size differs from frozen inventory')
            if destination.exists():
                previous = json.loads(destination.read_text(encoding='utf-8'))
                if previous.get('status') == 'PROFILED' and all(previous.get(k) == record[k] for k in ('script_version', 'sha256_registered', 'source_bytes', 'source_mtime_ns')):
                    results.append(previous)
                    continue
            if fid in prior:
                record.update({'status': 'REUSED_PRIOR_FULL_FILE_PROFILE', 'prior_profile': prior[fid],
                               'evidence_refs': [str(PRIOR) + '#file_id=' + fid], 'source_content_read_this_run': False,
                               'scope': 'Historical exact-file statistics retained, including their original field coverage and limitations.'})
            else:
                with path.open('r', encoding='utf-8-sig', newline='') as stream:
                    fields = next(csv.reader(stream))
                if len(fields) != len(set(fields)):
                    raise ValueError('Duplicate source field names')
                record.update(profile(path, fields))
                record.update({'status': 'PROFILED', 'source_content_read_this_run': True,
                               'evidence_refs': [str(RUN / 'INPUT_SCOPE.jsonl') + '#file_id=' + fid]})
                if path.stat().st_mtime_ns != stat.st_mtime_ns:
                    raise ValueError('Source changed during read')
            record['elapsed_seconds'] = round(time.monotonic() - began, 3)
        except Exception as exc:
            record.update({'status': 'FAILED', 'error_type': type(exc).__name__, 'error': str(exc),
                           'elapsed_seconds': round(time.monotonic() - began, 3)})
        write(destination, record)
        results.append(record)
        print(json.dumps({'file': index, 'of': 140, 'file_id': fid, 'status': record['status'],
                          'elapsed_seconds': record['elapsed_seconds']}), flush=True)
        write(OUT / 'CSV_PROGRESS.json', {'completed': len(results), 'expected': 140,
              'status_counts': dict(Counter(r['status'] for r in results)), 'elapsed_seconds': round(time.monotonic() - started, 2)})
    (OUT / 'CSV_QUALITY_MANIFEST.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in results), encoding='utf-8')
    totals = {'files': len(results), 'status_counts': dict(Counter(r['status'] for r in results)),
              'newly_streamed_bytes': sum(r.get('source_bytes', 0) for r in results if r['status'] == 'PROFILED'),
              'newly_profiled_rows': sum(r.get('row_count', 0) for r in results),
              'pandas_version': pd.__version__, 'numpy_version': np.__version__,
              'runtime': sys.executable, 'chunk_rows': CHUNK_ROWS,
              'completed_at_utc': datetime.now(timezone.utc).isoformat(),
              'elapsed_seconds': round(time.monotonic() - started, 2), 'source_hashes_recomputed': 0}
    write(OUT / 'CSV_QUALITY_SUMMARY.json', totals)
    print(json.dumps(totals), flush=True)


if __name__ == '__main__':
    main()
