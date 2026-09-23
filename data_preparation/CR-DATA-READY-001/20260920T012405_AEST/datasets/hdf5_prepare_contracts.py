"""Record every batch cell's actual fields and reference matrix metadata.

Reuses the earlier full physical directory scan; does not repeat the complete
1.8-million-node inventory or copy numeric payloads. All batch cells and their
field/reference matrices are examined, rather than assuming the first cell's
schema applies to later cells.
"""
import json
from pathlib import Path
import time

import h5py
import numpy as np
from hdf5_batch_reader import VERSION, ref_target, read_numeric, object_address

ROOT = Path(__file__).resolve().parent
RUN = ROOT.parent


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def describe(dataset):
    result = {'hdf5_object_address': object_address(dataset), 'shape': list(dataset.shape),
              'dtype': str(dataset.dtype), 'elements': int(dataset.size)}
    if h5py.check_dtype(ref=dataset.dtype) is not None:
        refs = dataset[()].reshape(-1)
        result.update({'kind': 'object_reference_matrix', 'reference_count': len(refs),
                       'null_references': sum(not bool(ref) for ref in refs)})
    else:
        result['kind'] = 'numeric_or_text_leaf'
    if 'MATLAB_class' in dataset.attrs:
        result['matlab_class'] = str(dataset.attrs['MATLAB_class'])
    return result


def main():
    originals = {r['file_id']: r for r in rows(RUN / 'SOURCE_OBJECTS.jsonl')}
    selected = [r for r in rows(ROOT / 'FILE_READINESS.jsonl')
                if r['readiness_status'] == 'READY_NATIVE_HDF5_DIRECTORY']
    checks = []
    with (ROOT / 'HDF5_BATCH_CONTRACTS.jsonl').open('w', encoding='utf-8') as output:
        for item in selected:
            started = time.time()
            cells = []
            with h5py.File(item['input_path'], 'r') as handle:
                batch = handle['batch']
                sizes = {field: int(dataset.size) for field, dataset in batch.items()}
                if len(set(sizes.values())) != 1:
                    raise ValueError(f'batch reference count mismatch: {item["file_id"]}: {sizes}')
                for cell in range(next(iter(sizes.values()))):
                    fields = {}
                    for field, dataset in batch.items():
                        target = ref_target(handle, dataset, cell)
                        if isinstance(target, h5py.Group):
                            if any(not isinstance(value, h5py.Dataset) for value in target.values()):
                                raise ValueError('unexpected deeper group in ' + field)
                            fields[field] = {'kind': 'referenced_struct', 'hdf5_object_address': object_address(target),
                                             'fields': {name: describe(value) for name, value in target.items()}}
                        else:
                            fields[field] = describe(target)
                    cells.append({'cell_index': cell, 'fields': fields})
            contract = {'file_id': item['file_id'], 'source_id': item['source_id'],
                        'input_sha256': originals[item['file_id']]['registered_sha256'],
                        'input_path': item['input_path'], 'status': 'ALL_BATCH_CELLS_AND_FIELD_REFERENCE_MATRICES_PREPARED',
                        'reader': str(ROOT / 'hdf5_batch_reader.py'), 'reader_version': VERSION,
                        'index_order': 'ZERO_BASED_PHYSICAL_HDF5_C_ORDER', 'cells': cells,
                        'cell_count': len(cells), 'numeric_payload_fully_scanned': False,
                        'full_physical_directory_evidence': item['artifact_refs'],
                        'units': 'Original field names retained; no alias or universal unit mapping inferred',
                        'elapsed_seconds': round(time.time() - started, 3)}
            output.write(json.dumps(contract, ensure_ascii=False) + '\n')
            output.flush()
            # Exercise both direct summary leaves and per-cycle reference leaves.
            # Compare to direct h5py access without logging source values.
            for cell in sorted({0, len(cells) - 1}):
                fields = cells[cell]['fields']
                summary_field = next(name for name, value in fields['summary']['fields'].items()
                                     if value['kind'] == 'numeric_or_text_leaf')
                cycle_field = next(iter(fields['cycles']['fields']))
                cycle_count = fields['cycles']['fields'][cycle_field]['reference_count']
                for field, cycle in [(f'summary/{summary_field}', None),
                                     (f'cycles/{cycle_field}', 0),
                                     (f'cycles/{cycle_field}', cycle_count - 1)]:
                    values, metadata = read_numeric(item['input_path'], field, cell, cycle, 0, 7)
                    with h5py.File(item['input_path'], 'r') as handle:
                        branch, leaf = field.split('/')
                        container = handle[handle['batch'][branch][cell, 0]]
                        target = container[leaf]
                        if cycle is not None:
                            target = handle[target[cycle, 0]]
                        # Read at most seven individual physical elements. The
                        # acquired files contain both row and column vectors.
                        expected = np.asarray([target[tuple(int(v) for v in
                            np.unravel_index(i, target.shape, order='C'))]
                            for i in range(min(7, target.size))], dtype=target.dtype)
                    equal = bool(np.array_equal(values, expected, equal_nan=True))
                    checks.append({'file_id': item['file_id'], 'cell_index': cell,
                                   'field': field, 'cycle_index': cycle, 'returned_elements': len(values),
                                   'reference_trace': metadata['reference_trace'],
                                   'direct_h5py_numeric_equality': equal, 'source_values_emitted': False})
                    if not equal:
                        raise ValueError('HDF5 reader mismatch')
            print(json.dumps({'file_id': item['file_id'], 'cells': len(cells), 'elapsed': round(time.time() - started, 2)}), flush=True)
    (ROOT / 'HDF5_READER_CHECK_RESULTS.json').write_text(json.dumps(
        {'status': 'PASS' if all(c['direct_h5py_numeric_equality'] for c in checks) else 'FAIL',
         'scope': 'Actual first/last batch cell; direct summary and first/last cycle numeric equality per source file',
         'file_count': len(selected), 'check_count': len(checks), 'checks': checks}, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
