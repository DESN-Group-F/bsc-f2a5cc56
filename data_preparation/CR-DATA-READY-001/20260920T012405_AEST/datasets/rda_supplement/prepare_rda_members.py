import hashlib
import importlib.metadata
import json
import math
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import rdata

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
COMPONENTS = Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST\datasets67\CONTAINER_COMPONENTS.jsonl")
OUT = RUN / "datasets/rda_supplement"
OUT.mkdir(parents=True, exist_ok=True)

def json_rows(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

def digest(data): return hashlib.sha256(data).hexdigest()

def scalar(value):
    if pd.isna(value): return None
    if isinstance(value, np.generic): value = value.item()
    if isinstance(value, float) and not math.isfinite(value): return None
    return value if isinstance(value, (int, float, bool, str)) else str(value)

def frame_summary(frame):
    columns, numeric_checks = [], []
    for name in frame.columns:
        series = frame[name]
        columns.append({"field": str(name), "dtype": str(series.dtype), "non_null": int(series.notna().sum())})
        if pd.api.types.is_numeric_dtype(series.dtype):
            values = pd.to_numeric(series, errors="coerce").to_numpy(dtype=float, na_value=np.nan)
            finite = values[np.isfinite(values)]
            numeric_checks.append({
                "field": str(name), "finite_count": int(finite.size),
                "min": scalar(finite.min()) if finite.size else None,
                "max": scalar(finite.max()) if finite.size else None,
                "first_finite": scalar(finite[0]) if finite.size else None,
                "last_finite": scalar(finite[-1]) if finite.size else None,
            })
        elif series.dtype == object:
            first_value = next((v for v in series if isinstance(v, np.ndarray)), None)
            if first_value is not None and np.issubdtype(first_value.dtype, np.number):
                count = 0; minimum = None; maximum = None; first = None; last = None
                shapes = set()
                for value in series:
                    if not isinstance(value, np.ndarray): continue
                    shapes.add(tuple(value.shape))
                    values = value.astype(float, copy=False).ravel()
                    finite = values[np.isfinite(values)]
                    if not finite.size: continue
                    count += int(finite.size)
                    vmin, vmax = float(finite.min()), float(finite.max())
                    minimum = vmin if minimum is None else min(minimum, vmin)
                    maximum = vmax if maximum is None else max(maximum, vmax)
                    if first is None: first = float(finite[0])
                    last = float(finite[-1])
                numeric_checks.append({"field": str(name), "storage": "numeric_ndarray_per_row", "finite_count": count,
                                       "min": scalar(minimum), "max": scalar(maximum), "first_finite": scalar(first),
                                       "last_finite": scalar(last), "unique_element_shapes": [list(x) for x in sorted(shapes)]})
    return {"object_type": "pandas.DataFrame", "shape": list(frame.shape), "fields": columns, "numeric_checks": numeric_checks}

def object_summary(value):
    if isinstance(value, pd.DataFrame): return frame_summary(value)
    if isinstance(value, np.ndarray):
        result = {"object_type": "numpy.ndarray", "shape": list(value.shape), "dtype": str(value.dtype)}
        if np.issubdtype(value.dtype, np.number):
            finite = value.astype(float, copy=False).ravel(); finite = finite[np.isfinite(finite)]
            result["numeric_checks"] = [{"finite_count": int(finite.size), "min": scalar(finite.min()) if finite.size else None, "max": scalar(finite.max()) if finite.size else None, "first_finite": scalar(finite[0]) if finite.size else None, "last_finite": scalar(finite[-1]) if finite.size else None}]
        else:
            result["content_sha256"] = digest("\u0000".join(map(str, value.ravel())).encode("utf-8"))
        return result
    return {"object_type": type(value).__name__, "representation_sha256": digest(repr(value).encode("utf-8"))}

components = [x for x in json_rows(COMPONENTS) if x.get("member_format", "").lower() == ".rda"]
sources = {x["file_id"]: x for x in json_rows(RUN / "SOURCE_OBJECTS.jsonl")}
records = []
by_parent = {}
for item in components: by_parent.setdefault((item["container_file_id"], item["parent_member_path"]), []).append(item)

for (file_id, nested_member), members in sorted(by_parent.items()):
    outer = Path(sources[file_id]["input_path"])
    with zipfile.ZipFile(outer) as outer_zip:
        nested_bytes = outer_zip.read(nested_member)
    nested_sha = digest(nested_bytes)
    with tempfile.TemporaryDirectory(prefix="bsc_rda_") as td:
        nested_path = Path(td) / "nested.zip"; nested_path.write_bytes(nested_bytes)
        with zipfile.ZipFile(nested_path) as nested_zip:
            for item in sorted(members, key=lambda x: x["member_path"]):
                inner = item["member_path"]
                payload = nested_zip.read(inner)
                rda_path = Path(td) / "member.rda"; rda_path.write_bytes(payload)
                base = {
                    "outer_file_id": file_id, "outer_path": str(outer),
                    "nested_archive_member": nested_member, "nested_archive_sha256": nested_sha,
                    "inner_member_path": inner, "canonical_member_locator": nested_member + "!/" + inner,
                    "member_selector": {"outer_file_id": file_id, "nested_archive_member": nested_member, "inner_member_path": inner},
                    "inner_crc32": item.get("crc32"), "inner_bytes": len(payload), "inner_sha256": digest(payload),
                    "parser": {"name": "rdata", "version": importlib.metadata.version("rdata"), "mode": "passive Python parser; no R runtime, R code, methods, or callbacks executed"},
                }
                try:
                    parsed = rdata.read_rda(rda_path)
                    objects = [{"object_name": str(name), **object_summary(value)} for name, value in parsed.items()]
                    base.update({"status": "LOCALLY_CHECKED_RDA_READY", "objects": objects,
                                 "reader_entrypoint": str(OUT / "read_rda_member.py"),
                                 "numeric_read_verified": any(o.get("numeric_checks") for o in objects),
                                 "limitations": ["Schema and bounded numeric summaries only; raw arrays are not emitted.", "Units and experimental meaning require the bound README/source context.", "This local parse does not admit README prose to LLM/RAG and is not scientific validation."]})
                except Exception as exc:
                    base.update({"status": "PREPARATION_FAILED", "error_type": type(exc).__name__, "error": str(exc), "objects": [], "numeric_read_verified": False})
                records.append(base)

(OUT / "RDA_MEMBER_READINESS.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in records), encoding="utf-8")
status_counts = {}
for x in records: status_counts[x["status"]] = status_counts.get(x["status"], 0) + 1
checks = {
    "status": "PASS" if len(records) == 28 and status_counts.get("LOCALLY_CHECKED_RDA_READY") == 28 and all(x["numeric_read_verified"] for x in records) else "FAIL",
    "counts": {"catalog_rda": len(components), "prepared_rda": len(records), "unique_locators": len({x["canonical_member_locator"] for x in records}), "numeric_read_verified": sum(x["numeric_read_verified"] for x in records), "status_counts": status_counts},
    "checks": {"all_28_accounted": len(records) == 28, "identities_unique": len({x["canonical_member_locator"] for x in records}) == 28, "all_inner_hashes_recorded": all(len(x["inner_sha256"]) == 64 for x in records), "all_numeric_reads_verified": all(x["numeric_read_verified"] for x in records)},
    "dependency_versions": {name: importlib.metadata.version(name) for name in ["rdata", "numpy", "pandas"]},
}
(OUT / "CHECK_RESULTS.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(checks, ensure_ascii=True))
