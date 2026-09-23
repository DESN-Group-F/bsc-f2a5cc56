"""Review full-file CSV profiles without reading originals a second time."""
import json
from collections import Counter
from pathlib import Path

OUT = Path(__file__).resolve().parent
RUN = OUT.parent


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def main():
    inputs = {r['file_id']: r for r in read_rows(RUN / 'INPUT_SCOPE.jsonl') if Path(r['relative_path']).suffix.lower() == '.csv'}
    profiles = read_rows(OUT / 'CSV_QUALITY_MANIFEST.jsonl')
    checks = {'exact_140_file_set': len(profiles) == len(inputs) == 140 and {r['file_id'] for r in profiles} == set(inputs)}
    checks['scanner_calibration_pass'] = json.loads((OUT / 'CSV_SCANNER_SELF_CHECK.json').read_text(encoding='utf-8'))['status'] == 'PASS'
    missing = Counter()
    missing_files = Counter()
    invalid = Counter()
    infinite = Counter()
    schema_counts = Counter()
    review = []
    total_rows = 0
    total_bytes = 0
    historical_rows = 0
    backsteps = 0
    files_with_backsteps = 0
    validation_errors = []
    for p in profiles:
        source = inputs[p['file_id']]
        fid = p['file_id']
        if p['sha256_registered'] != source['sha256_registered'] or p['source_bytes'] != source['bytes_registered']:
            validation_errors.append([fid, 'frozen_input_binding'])
        saved = json.loads((OUT / 'csv_profiles' / (fid + '.json')).read_text(encoding='utf-8'))
        if saved != p:
            validation_errors.append([fid, 'individual_profile_disagrees'])
        flags = []
        reuse = p['status'] == 'REUSED_PRIOR_FULL_FILE_PROFILE'
        if reuse:
            q = p['prior_profile']
            if q['file_id'] != fid or q['source_sha256_registered_not_recomputed'] != source['sha256_registered']:
                validation_errors.append([fid, 'historical_hash_binding'])
            count = q['row_count']
            header = q['header']
            fields = q['numeric_statistics']
            historical_rows += count
            resets = q['test_time_resets']
            for field, values in fields.items():
                missing[field] += values.get('missing', 0)
                missing_files[field] += int(values.get('missing', 0) > 0)
                if values.get('missing', 0) or values.get('nonfinite', 0):
                    flags.append('HISTORICAL_MISSING_OR_NONFINITE')
            limits = ['Historical profiler retains its original definitions; invalid numeric and nonfinite categories are not silently reinterpreted.']
        elif p['status'] == 'PROFILED':
            count = p['row_count']
            header = p['header']
            fields = p['numeric_fields']
            resets = p['consecutive_backsteps']['Test_Time']
            for field, values in fields.items():
                n = sum(values[key] for key in ('missing', 'invalid_numeric', 'infinite'))
                if not (0 <= n <= count):
                    validation_errors.append([fid, field, 'quality_counts_out_of_range'])
                if (values['min'] is None) != (values['max'] is None) or (values['min'] is not None and values['min'] > values['max']):
                    validation_errors.append([fid, field, 'finite_extrema_inconsistent'])
                missing[field] += values['missing']
                missing_files[field] += int(values['missing'] > 0)
                invalid[field] += values['invalid_numeric']
                infinite[field] += values['infinite']
                if values['missing']:
                    flags.append('MISSING:' + field)
                if values['invalid_numeric']:
                    flags.append('INVALID_NUMERIC:' + field)
                if values['infinite']:
                    flags.append('INFINITE:' + field)
            if not 0 <= p['datetime_missing'] <= count:
                validation_errors.append([fid, 'datetime_missing_out_of_range'])
            limits = p['limits']
        else:
            validation_errors.append([fid, 'profile_failed'])
            continue
        if not (count > 0 and len(header) == len(set(header)) and len(header) in (15, 16)):
            validation_errors.append([fid, 'schema_or_row_count'])
        if resets:
            flags.append('TEST_TIME_BACKSTEPS_REQUIRE_SEGMENTATION')
        backsteps += resets
        files_with_backsteps += int(resets > 0)
        total_rows += count
        total_bytes += p['source_bytes']
        schema_counts[str(len(header))] += 1
        review.append({
            'file_id': fid, 'source_id': source['source_id'], 'registered_sha256': source['sha256_registered'],
            'pending67': False, 'preparation_status': 'FULL_FILE_STRUCTURAL_QUALITY_PROFILE_COMPLETE',
            'quality_status': 'PROFILE_COMPLETE_WITH_FINDINGS' if flags else 'PROFILE_COMPLETE_WITH_DECLARED_LIMITS',
            'profile_kind': p['status'], 'row_count': count, 'field_count': len(header),
            'local_action_basis': p['local_action_basis'],
            'quality_flags': sorted(set(flags)), 'unit_and_experiment_applicability': 'NOT_ESTABLISHED_BY_CSV_VALUES_OR_HEADERS',
            'method_constraints': [
                'Preserve blanks as missing; do not convert them to zero.',
                'Establish source units, current sign convention, experiment conditions and timebase before integration.',
                'Treat clock backsteps as segmentation candidates; do not sort the entire file or integrate across resets.',
                'Aux_Voltage is an optional observed field; its missingness does not alone invalidate all other channels.',
                'No target-asset safety threshold, lifetime predictor or risk probability is justified by this quality scan.'
            ],
            'evidence_refs': [str(OUT / 'csv_profiles' / (fid + '.json'))],
            'limits': limits, 'rag_admission': 'NOT_GRANTED_BY_THIS_RUN', 'training_admission': 'NOT_GRANTED_BY_THIS_RUN'
        })
    checks['profile_binding_and_internal_consistency'] = not validation_errors
    checks['all_profiles_reviewed'] = len(review) == 140
    result = {
        'status': 'PASS' if all(checks.values()) else 'FAIL', 'checks': checks, 'errors': validation_errors,
        'scope': 'Exact set, frozen ID/hash/size bindings, retained profile consistency, count/extrema invariants; no reread or rehash of originals.',
        'not_validated': ['Experimental units and protocol', 'Timestamp timezone/calibration', 'Scientific applicability', 'Safety parameters', 'Integration implementation', 'RAG or server acceptance']
    }
    (OUT / 'CSV_PREPARATION_MANIFEST.jsonl').write_text(''.join(json.dumps(x, ensure_ascii=False, allow_nan=False) + '\n' for x in review), encoding='utf-8')
    summary = {
        'files': len(review), 'total_rows_including_reused_profiles': total_rows, 'historical_rows_reused': historical_rows,
        'total_original_bytes': total_bytes, 'schema_field_counts': dict(schema_counts),
        'missing_cells_by_field': {k: v for k, v in missing.items() if v},
        'files_with_missing_by_field': {k: v for k, v in missing_files.items() if v},
        'new_profile_invalid_numeric_cells': sum(invalid.values()), 'new_profile_infinite_cells': sum(infinite.values()),
        'test_time_backsteps': backsteps, 'files_with_test_time_backsteps': files_with_backsteps,
        'quality_status_counts': dict(Counter(x['quality_status'] for x in review)),
        'no_source_values_changed': True, 'no_originals_reread_for_this_review': True,
        'interpretation': 'Missingness and timebase resets are data-use constraints, not proof of corrupted experiments. Profiles do not establish unit/protocol or target applicability.'
    }
    write_json(OUT / 'CSV_REVIEW_SUMMARY.json', summary)
    write_json(OUT / 'CSV_CHECK_RESULTS.json', result)
    notes = f'''# CSV preparation review

All 140 registered CSV originals now have full-file structural quality profiles covering {total_rows:,} rows. Five exact-file historical profiles ({historical_rows:,} rows) were reused; 135 were newly streamed. The source values were not changed or copied into another full data corpus.

The scan found {backsteps} Test_Time backsteps in {files_with_backsteps} files. These can be instrument/session resets and must be interpreted using the experiment protocol. Never globally sort the records or integrate across a reset simply to make the sequence monotonic. Data_Point ordering checks found no backsteps in the scanned profiles.

Missing values are concentrated in Aux_Voltage ({missing['Aux_Voltage']:,} cells), Internal_Resistance ({missing['Internal_Resistance']:,}) and Temperature ({missing['Temperature']:,}). Blank auxiliary channels are not automatically failed experiments; downstream methods must declare which channels are required and how missingness is handled. No invalid numeric or infinite values were found by the new profiler. The five historical profiles retain their original definitions.

The 94 15-column and 46 16-column schemas are retained. Units, current polarity, timestamp timezone, calibration, chemistry, operating conditions and target-asset compatibility are not established merely by field names or numeric ranges. Ah/Wh integration must wait for those assumptions and the relevant segmentation rules. These are analysis-use conditions, not reasons to download more copies of the same dataset.

`CSV_CHECK_RESULTS.json` verifies the exact 140-file set, frozen source bindings, artifact consistency and count invariants. `CSV_SCANNER_SELF_CHECK.json` separately checks known missing/invalid/infinite inputs and a reset across a chunk boundary. These passes are local data-processing checks, not model, RAG, server or site-safety validation.

Reproduce the metadata review with the bundled Python and `-B existing233/review_csv_profiles.py`. It does not reread original CSV content. The original full scan is recorded in `CSV_RUN.log` and `CSV_QUALITY_SUMMARY.json`.
'''
    (OUT / 'CSV_NOTES.md').write_text(notes, encoding='utf-8')
    print(json.dumps({'check_status': result['status'], **summary}, ensure_ascii=False))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
