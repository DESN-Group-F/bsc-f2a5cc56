"""Bounded passive reader for one registered nested RDA member; never executes R code."""
import json
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
import numpy as np
import pandas as pd
import rdata

HARD_MAX_NESTED_BYTES = 500_000_000
HARD_MAX_MEMBER_BYTES = 50_000_000
HARD_MAX_ROWS = 100
HARD_MAX_FIELDS = 8
HARD_MAX_NUMERIC_ELEMENTS = 10_000
HARD_MAX_OUTPUT_BYTES = 200_000

class BudgetError(ValueError): pass

def _bounded_int(name, value, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > maximum:
        raise BudgetError(f"{name} must be an integer from 0 through {maximum}")
    return value

def _selector(name, value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"invalid {name}")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"invalid {name}")
    return value

def _copy_limited(source, destination, expected_size, cap):
    if expected_size < 0 or expected_size > cap:
        raise BudgetError(f"declared member size {expected_size} exceeds cap {cap}")
    written = 0
    with destination.open("wb") as out:
        while True:
            chunk = source.read(min(1024 * 1024, cap - written + 1))
            if not chunk: break
            written += len(chunk)
            if written > cap: raise BudgetError(f"streamed member exceeds cap {cap}")
            out.write(chunk)
    if written != expected_size: raise ValueError("member size changed while extracting")

def read_bounded_numeric(outer_path, nested_archive_member, inner_member_path, *,
                         row_start=0, max_rows=2, fields=None, max_numeric_elements=1000,
                         max_nested_bytes=HARD_MAX_NESTED_BYTES, max_member_bytes=HARD_MAX_MEMBER_BYTES,
                         max_output_bytes=HARD_MAX_OUTPUT_BYTES):
    row_start = _bounded_int("row_start", row_start, 10**9)
    max_rows = _bounded_int("max_rows", max_rows, HARD_MAX_ROWS)
    max_numeric_elements = _bounded_int("max_numeric_elements", max_numeric_elements, HARD_MAX_NUMERIC_ELEMENTS)
    max_nested_bytes = _bounded_int("max_nested_bytes", max_nested_bytes, HARD_MAX_NESTED_BYTES)
    max_member_bytes = _bounded_int("max_member_bytes", max_member_bytes, HARD_MAX_MEMBER_BYTES)
    max_output_bytes = _bounded_int("max_output_bytes", max_output_bytes, HARD_MAX_OUTPUT_BYTES)
    nested_archive_member = _selector("nested_archive_member", nested_archive_member)
    inner_member_path = _selector("inner_member_path", inner_member_path)
    if fields is not None and (not isinstance(fields, list) or len(fields) > HARD_MAX_FIELDS or any(not isinstance(x, str) for x in fields)):
        raise BudgetError(f"fields must be a string list with at most {HARD_MAX_FIELDS} entries")

    with tempfile.TemporaryDirectory(prefix="bsc_rda_bounded_") as td:
        nested_path, member_path = Path(td) / "nested.zip", Path(td) / "member.rda"
        with zipfile.ZipFile(Path(outer_path)) as outer:
            info = outer.getinfo(nested_archive_member)
            with outer.open(info) as source: _copy_limited(source, nested_path, info.file_size, max_nested_bytes)
        with zipfile.ZipFile(nested_path) as nested:
            info = nested.getinfo(inner_member_path)
            with nested.open(info) as source: _copy_limited(source, member_path, info.file_size, max_member_bytes)
        converted = rdata.read_rda(member_path)

    steps = converted.get("steps")
    if not isinstance(steps, pd.DataFrame): raise ValueError("RDA has no steps DataFrame")
    chosen = list(steps.columns) if fields is None else fields
    if len(chosen) > HARD_MAX_FIELDS or any(x not in steps.columns for x in chosen): raise ValueError("unknown or excessive field selection")
    if row_start > len(steps): raise IndexError("row_start exceeds row count")
    remaining, output_rows = max_numeric_elements, []
    for index, row in steps.iloc[row_start:row_start + max_rows].iterrows():
        item = {"row_index": int(index)}
        for field in chosen:
            value = row[field]
            if isinstance(value, np.ndarray):
                flat = value.ravel(); take = min(len(flat), remaining)
                values = [float(x) if np.issubdtype(flat.dtype, np.number) else str(x) for x in flat[:take]]
                remaining -= take
                item[field] = {"shape": list(value.shape), "values": values, "truncated": take < len(flat)}
            elif isinstance(value, (str, int, float, bool, np.generic)):
                item[field] = value.item() if isinstance(value, np.generic) else value
            else: item[field] = {"type": type(value).__name__}
        output_rows.append(item)
    result = {"object": "steps", "total_rows": int(len(steps)), "row_start": row_start,
              "returned_rows": len(output_rows), "fields": chosen,
              "numeric_elements_returned": max_numeric_elements - remaining, "rows": output_rows}
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(encoded) > max_output_bytes: raise BudgetError(f"serialized output {len(encoded)} exceeds cap {max_output_bytes}")
    result["serialized_bytes_checked"] = len(encoded)
    return result
