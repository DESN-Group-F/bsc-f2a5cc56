"""Passive, bounded readers for the acquired MATLAB v7.3 batch representations.

Indices use the physical HDF5 C-order layout, recorded in each result. No MATLAB
method is executed, field names are never aliased, and units are not inferred.
"""
import argparse
import json
import math
from pathlib import PurePosixPath

import h5py
import numpy as np

VERSION = 'hdf5-batch-reference-reader-2'


def object_address(node):
    # Resolving .name on a reference-opened HDF5 object can search enormous
    # anonymous-reference groups. Its address is unambiguous within this file.
    return int(h5py.h5o.get_info(node.id).addr)


def physical_index(shape, index):
    size = math.prod(shape)
    if index < 0 or index >= size:
        raise IndexError(f'index {index} outside {size} physical elements')
    return tuple(int(v) for v in np.unravel_index(index, shape, order='C'))


def ref_target(handle, dataset, index):
    if not isinstance(dataset, h5py.Dataset) or h5py.check_dtype(ref=dataset.dtype) is None:
        raise ValueError('expected an HDF5 object reference dataset')
    ref = dataset[physical_index(dataset.shape, index)]
    if not ref:
        raise ValueError('null object reference')
    return handle[ref]


def resolve(handle, field, cell_index, cycle_index=None):
    parts = list(PurePosixPath(field).parts)
    if not parts or any(p in ('/', '..', '.') for p in parts) or len(parts) > 2:
        raise ValueError('field must be a batch field or summary/field or cycles/field')
    if parts[0] not in handle['batch']:
        raise KeyError(field)
    source = handle['batch'][parts[0]]
    target = ref_target(handle, source, cell_index)
    trace = [{'reference_dataset': '/batch/' + parts[0], 'index': cell_index,
              'target_object_address': object_address(target)}]
    if len(parts) == 2:
        if not isinstance(target, h5py.Group):
            raise ValueError('nested field requires a referenced group')
        target = target[parts[1]]
    if isinstance(target, h5py.Dataset) and h5py.check_dtype(ref=target.dtype) is not None:
        if cycle_index is None:
            raise ValueError('cycle_index required for this referenced field')
        source = target
        target = ref_target(handle, source, cycle_index)
        trace.append({'reference_dataset_object_address': object_address(source), 'index': cycle_index,
                      'target_object_address': object_address(target)})
    elif cycle_index is not None:
        raise ValueError('cycle_index was supplied for a field without cycle references')
    if not isinstance(target, h5py.Dataset):
        raise ValueError('select a numeric leaf field')
    return target, trace


def bounded_flat_slice(dataset, start=0, count=32, max_elements=100000, max_bytes=1048576):
    if min(start, count, max_elements, max_bytes) < 0:
        raise ValueError('all bounds must be nonnegative')
    if dataset.dtype.kind not in 'biufc' or h5py.check_dtype(ref=dataset.dtype) is not None:
        raise ValueError('numeric leaf dataset required')
    if dataset.attrs.get('MATLAB_class') in (b'char', 'char'):
        raise ValueError('MATLAB char codes are text, not a numeric measurement')
    if count > max_elements or count * dataset.dtype.itemsize > max_bytes:
        raise ValueError('requested slice exceeds element/byte budget before reading')
    available = int(dataset.size)
    take = min(count, max(0, available - start))
    result = np.empty(take, dtype=dataset.dtype)
    # Read only the requested runs along the final physical dimension.
    # In particular, never fetch a whole wide row to obtain one element.
    offset = 0
    while offset < take:
        if dataset.ndim == 0:
            result[offset] = dataset[()]
            offset += 1
            continue
        coords = physical_index(dataset.shape, start + offset)
        run = min(take - offset, dataset.shape[-1] - coords[-1])
        selection = coords[:-1] + (slice(coords[-1], coords[-1] + run),)
        result[offset:offset + run] = np.asarray(dataset[selection]).reshape(-1)
        offset += run
    return result


def read_numeric(path, field, cell_index=0, cycle_index=None, start=0, count=32,
                 max_elements=100000, max_bytes=1048576):
    with h5py.File(path, 'r') as handle:
        target, trace = resolve(handle, field, cell_index, cycle_index)
        values = bounded_flat_slice(target, start, count, max_elements, max_bytes)
        metadata = {'reader_version': VERSION, 'field': field,
                    'cell_index': cell_index, 'cycle_index': cycle_index,
                    'source_object_address': object_address(target), 'source_shape': list(target.shape),
                    'source_dtype': str(target.dtype), 'reference_trace': trace,
                    'start': start, 'requested_elements': count,
                    'returned_elements': int(values.size), 'returned_bytes': int(values.nbytes),
                    'index_order': 'ZERO_BASED_PHYSICAL_HDF5_C_ORDER',
                    'units': 'NOT_INFERRED; consult exact field contract',
                    'source_mutated': False, 'matlab_object_methods_executed': False}
        return values, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('field')
    parser.add_argument('--cell', type=int, default=0)
    parser.add_argument('--cycle', type=int)
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--count', type=int, default=32)
    args = parser.parse_args()
    values, result = read_numeric(args.path, args.field, args.cell, args.cycle, args.start, args.count)
    if values.dtype.kind == 'c':
        raise ValueError('CLI serialization of complex values is not supported; use the local Python reader')
    result['values'] = [value if math.isfinite(float(value)) else
                        {'numeric_nonfinite': 'NaN' if math.isnan(float(value)) else
                         ('+Infinity' if value > 0 else '-Infinity')}
                        for value in values.tolist()]
    print(json.dumps(result, allow_nan=False))


if __name__ == '__main__':
    main()
