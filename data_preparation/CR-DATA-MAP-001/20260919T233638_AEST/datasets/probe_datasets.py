from __future__ import annotations

import csv
import gzip
import json
import re
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET


RUN_ROOT = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST")
SOURCE_ROOT = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
INPUT = RUN_ROOT / "INPUT_SCOPE.jsonl"
OUT = RUN_ROOT / "datasets"
HISTORICAL = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-ROUTE-001\20260919T200403_local_processing_05\experiments\src017_file_summaries.json")
MAX_PREFIX = 262_144
MAX_JSON = 4 * 1024 * 1024
MAX_COMPONENTS_PER_ARCHIVE = 20_000


def load_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def exact_local_basis(row):
    route = row.get("prior_routing") or {}
    effective_id = (route.get("rights_record") or {}).get("effective_rights_id")
    records = row.get("existing_rights_records") or []
    exact = [r for r in records if r.get("file_id") == row["file_id"] and r.get("file_sha256") == row["sha256_registered"] and r.get("ai_processing") == "ALLOWED"]
    group = [r for r in records if not r.get("file_id") and r.get("source_id") == row["source_id"] and r.get("rights_id") == effective_id and r.get("ai_processing") == "ALLOWED"]
    if exact:
        return True, [exact[0]["rights_id"]], "existing ALLOW binds the exact file_id and registered SHA-256"
    if group:
        return True, [group[0]["rights_id"]], "existing ALLOW binds the route's effective rights ID and recorded group scope for exact acquired representations"
    applicable = [r for r in records if (r.get("file_id") == row["file_id"] and r.get("file_sha256") == row["sha256_registered"]) or (not r.get("file_id") and r.get("source_id") == row["source_id"] and r.get("rights_id") == effective_id)]
    return False, sorted({r.get("rights_id") for r in applicable if r.get("rights_id")}), "no exact-file or effective group-scope ALLOW binding exists for this object"


def fmt_for(path: Path):
    suffix = path.suffix.lower()
    return {
        ".csv": "CSV", ".xlsx": "XLSX", ".json": "JSON", ".mat": "MAT",
        ".zip": "ZIP", ".tgz": "TGZ", ".gz": "GZIP",
    }.get(suffix, "NUMERIC_SUFFIX_OBJECT" if suffix[1:].isdigit() else suffix.lstrip(".").upper() or "UNKNOWN")


def inspect_csv(path: Path):
    raw = path.open("rb").read(MAX_PREFIX)
    text = raw.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()[:6]
    dialect = csv.Sniffer().sniff("\n".join(lines[:3]), delimiters=",;\t|") if lines else csv.excel
    parsed = list(csv.reader(lines, dialect))
    header = parsed[0] if parsed else []
    widths = [len(x) for x in parsed]
    return {
        "fields": header,
        "field_count": len(header),
        "delimiter": dialect.delimiter,
        "bounded_rows_read": len(parsed),
        "bounded_bytes_read": len(raw),
        "sample_row_widths": widths,
        "encoding_assumption": "UTF-8-SIG_WITH_REPLACEMENT",
    }, "experimental_time_series_table" if {"Current", "Voltage"}.issubset(header) else "tabular_data", "delimited_table"


def inspect_xlsx(path: Path):
    import openpyxl
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        sheet_names = [e.attrib.get("name", "") for e in workbook.findall(".//m:sheets/m:sheet", ns)]
        worksheet_parts = sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        macro = "xl/vbaProject.bin" in names
    sheet_profiles = []
    wb = openpyxl.load_workbook(path, read_only=True, data_only=False, keep_links=False)
    try:
        for ws in wb.worksheets:
            rows = []
            for row in ws.iter_rows(min_row=1, max_row=5, values_only=True):
                rows.append([None if v is None else str(v)[:200] for v in row[:50]])
            header_candidates = [[v for v in row if v is not None] for row in rows if any(v is not None for v in row)]
            fields = max(header_candidates, key=len, default=[])
            sheet_profiles.append({"sheet_name": ws.title, "fields": fields, "bounded_row_count": len(rows), "bounded_column_limit": 50, "formula_present_in_boundary": any(isinstance(v, str) and v.startswith("=") for row in rows for v in row if v is not None)})
    finally:
        wb.close()
    normalized = " ".join(str(v).lower() for s in sheet_profiles for v in s["fields"] if v is not None)
    if ("potential failure" in normalized or "failure mode" in normalized) and ("effect" in normalized or "severity" in normalized):
        semantic = "fmmea_or_fmea_table"
    elif "parameter" in normalized and ("unit" in normalized or "value" in normalized):
        semantic = "parameter_table"
    elif "current" in normalized and "voltage" in normalized:
        semantic = "experimental_time_series_table"
    else:
        semantic = "workbook_table_unresolved_semantics"
    return {
        "sheet_names": sheet_names,
        "worksheet_count": len(worksheet_parts),
        "package_part_count": len(names),
        "macro_part_present": macro,
        "sheet_profiles": sheet_profiles,
        "read_boundary": "workbook metadata plus first five rows and first fifty columns per worksheet; formulas not evaluated",
    }, semantic, "xlsx_bounded_sheet_headers"


def shape_json(value, depth=0):
    if depth >= 5:
        return {"type": type(value).__name__, "deeper_structure": "NOT_INSPECTED"}
    if isinstance(value, dict):
        return {"type": "object", "keys": list(value.keys()), "children": {k: shape_json(v, depth + 1) for k, v in value.items()}}
    if isinstance(value, list):
        return {"type": "array", "length": len(value), "item_examples": [shape_json(v, depth + 1) for v in value[:3]]}
    return {"type": type(value).__name__}


def inspect_json(path: Path):
    size = path.stat().st_size
    if size > MAX_JSON:
        raw = path.open("rb").read(MAX_PREFIX)
        return {"bytes_registered_locally": size, "bounded_prefix_bytes_read": len(raw), "full_parse": False}, "metadata_or_structured_data", "json_unparsed_large"
    text = path.read_text(encoding="utf-8-sig")
    constants = []
    def constant(v):
        constants.append(v)
        return {"nonstandard_constant": v}
    value = json.loads(text, parse_constant=constant)
    return {"full_parse": True, "shape": shape_json(value), "nonstandard_constants": sorted(set(constants))}, "metadata_or_structured_data", "json_hierarchical"


def inspect_mat(path: Path):
    head = path.open("rb").read(128)
    if head.startswith(b"MATLAB 7.3 MAT-file"):
        generation = "MATLAB_7_3_HDF5"
    elif head.startswith(b"\x89HDF\r\n\x1a\n"):
        generation = "MATLAB_7_3_HDF5"
    elif head.startswith(b"MATLAB 5.0 MAT-file"):
        generation = "MATLAB_LEVEL_5"
    elif len(head) >= 4 and head[:4] in (b"\x00\x00\x03\xe8", b"\xe8\x03\x00\x00"):
        generation = "MATLAB_LEVEL_4_POSSIBLE"
    else:
        generation = "MAT_GENERATION_UNKNOWN"
    return {"mat_generation": generation, "header_bytes_read": len(head), "variable_directory": "NOT_INSPECTED"}, "experimental_or_model_data", "mat_container"


def inspect_zip(path: Path, file_id: str, components):
    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
        suffixes = Counter(Path(i.filename).suffix.lower() or "<none>" for i in infos if not i.is_dir())
        nested = sum(1 for i in infos if Path(i.filename).suffix.lower() in {".zip", ".tgz", ".gz", ".tar", ".7z"})
        for i in infos[:MAX_COMPONENTS_PER_ARCHIVE]:
            components.append({
                "container_file_id": file_id,
                "member_path": i.filename,
                "is_directory": i.is_dir(),
                "uncompressed_bytes": i.file_size,
                "compressed_bytes": i.compress_size,
                "crc32": f"{i.CRC:08x}",
                "member_content_read": False,
            })
    return {
        "member_count": len(infos), "member_type_distribution": dict(sorted(suffixes.items())),
        "nested_archive_name_count": nested, "component_rows_written": min(len(infos), MAX_COMPONENTS_PER_ARCHIVE),
        "component_list_truncated": len(infos) > MAX_COMPONENTS_PER_ARCHIVE,
        "read_boundary": "ZIP central directory only; members not opened or extracted",
    }, "data_container", "zip_archive"


def inspect_gzip(path: Path, suffix: str):
    head = path.open("rb").read(64)
    flags = head[3] if len(head) >= 4 and head[:2] == b"\x1f\x8b" else None
    return {
        "gzip_signature": head[:2].hex(), "flags": flags, "header_bytes_read": len(head),
        "inner_stream": "NOT_DECOMPRESSED", "member_listing": "UNAVAILABLE_WITHOUT_STREAM_DECOMPRESSION",
    }, "data_container", "tar_gzip_stream" if suffix == ".tgz" else "gzip_stream"


def inspect_numeric(path: Path):
    head = path.open("rb").read(64)
    sig = "ZIP" if head.startswith(b"PK") else "GZIP" if head.startswith(b"\x1f\x8b") else "HDF5" if head.startswith(b"\x89HDF") else "UNRECOGNIZED"
    return {
        "numeric_suffix": path.suffix,
        "signature_probe": sig,
        "header_bytes_read": len(head),
        "multipart_relationship": "NOT_ESTABLISHED",
    }, "opaque_data_object", "numeric_suffix_unresolved"


def main():
    rows = [r for r in load_jsonl(INPUT) if r.get("assigned_lane") == "datasets"]
    historical = {r["file_id"]: r for r in json.loads(HISTORICAL.read_text(encoding="utf-8"))}
    mapped, components, errors = [], [], []
    access_counts = Counter()
    for row in rows:
        rel = row["relative_path"]
        path = SOURCE_ROOT / Path(rel)
        suffix = path.suffix.lower()
        technical = fmt_for(path)
        allowed, rights_refs, rights_reason = exact_local_basis(row)
        input_ref = f"{INPUT}#file_id={row['file_id']}"
        evidence = [input_ref]
        profile = None
        semantic = "dataset_or_container"
        variant = "metadata_only"
        limitations = []
        unknowns = []
        performed = False
        action = "METADATA_ONLY"
        basis_kind = "METADATA_INFERENCE"
        inspection = "frozen input metadata only"
        status = "UNKNOWN_RESTRICTED" if not allowed else "UNKNOWN_INSUFFICIENT_EVIDENCE"
        if not allowed:
            unknowns.append("Internal structure not inspected because existing object-linked local content-access basis was not sufficient.")
            limitations.append("Source ID or public availability was not treated as permission.")
        elif not path.is_file():
            unknowns.append("Registered source path was not a regular file at inspection time.")
        else:
            try:
                if row["file_id"] in historical:
                    h = historical[row["file_id"]]
                    profile = {"fields": h.get("header"), "field_count": len(h.get("header") or []), "historical_full_row_count": h.get("row_count"), "historical_malformed_rows": h.get("malformed_rows"), "history_scope": h.get("scope_note")}
                    semantic, variant = "experimental_time_series_table", "delimited_table"
                    evidence.append(f"{HISTORICAL}#file_id={row['file_id']}")
                    basis_kind = "REUSED_EXISTING_EVIDENCE"
                    inspection = "historical full-stream statistics reused; source content not reread this run"
                    action = "REUSED_HISTORICAL_STRUCTURE_EVIDENCE"
                    status = "STRUCTURE_IDENTIFIED"
                    limitations.append("Historical statistics cover only this exact file; they do not support other CSV objects.")
                else:
                    if suffix == ".csv": profile, semantic, variant = inspect_csv(path)
                    elif suffix == ".xlsx": profile, semantic, variant = inspect_xlsx(path)
                    elif suffix == ".json": profile, semantic, variant = inspect_json(path)
                    elif suffix == ".mat": profile, semantic, variant = inspect_mat(path)
                    elif suffix == ".zip": profile, semantic, variant = inspect_zip(path, row["file_id"], components)
                    elif suffix in {".tgz", ".gz"}: profile, semantic, variant = inspect_gzip(path, suffix)
                    elif suffix[1:].isdigit(): profile, semantic, variant = inspect_numeric(path)
                    else: raise ValueError(f"unsupported format {suffix}")
                    performed = True
                    action = {".csv":"BOUNDED_HEADER_READ", ".xlsx":"PACKAGE_METADATA_READ", ".json":"BOUNDED_OR_SMALL_FULL_STRUCTURE_READ", ".mat":"HEADER_READ", ".zip":"CENTRAL_DIRECTORY_READ", ".tgz":"GZIP_HEADER_READ", ".gz":"GZIP_HEADER_READ"}.get(suffix, "SIGNATURE_HEADER_READ")
                    basis_kind = "OBSERVED_THIS_RUN"
                    inspection = profile.get("read_boundary", action) if isinstance(profile, dict) else action
                    status = "STRUCTURE_IDENTIFIED"
                if suffix == ".csv":
                    limitations.append("Header and at most five bounded rows do not establish full-file row consistency, units, conditions, or value quality.")
                    unknowns.append("Field units and experiment conditions are unknown unless encoded explicitly in field names.")
                if suffix == ".mat":
                    limitations.append("MAT generation was identified from the header only; variable keys, arrays, units, and nested structures remain uninspected.")
                    unknowns.append("MAT variable directory and schema are unknown.")
                if suffix in {".zip", ".tgz", ".gz"}:
                    limitations.append("Outer container identification does not identify or validate internal data semantics.")
                    unknowns.append("Internal member content and data semantics were not verified; any listing describes names and container metadata only.")
                    if profile.get("nested_archive_name_count", 0): unknowns.append("Nested archives were detected by member name and were not opened.")
                if suffix[1:].isdigit():
                    limitations.append("A numeric suffix alone is not evidence of a multipart archive.")
                    unknowns.append("Relationship to other objects and internal format remain unestablished.")
            except Exception as exc:
                errors.append({"file_id": row["file_id"], "relative_path": rel, "error_type": type(exc).__name__, "error": str(exc)})
                unknowns.append(f"Structure probe failed: {type(exc).__name__}: {exc}")
                status = "UNKNOWN_INSUFFICIENT_EVIDENCE"
        if profile is not None:
            signature = json.dumps({"technical_format": technical, "structure_variant": variant, "profile": profile}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        else:
            signature = None
        access_counts[action] += 1
        mapped.append({
            "file_id": row["file_id"], "technical_format": technical, "semantic_type": semantic,
            "structure_variant": variant, "structure_signature": signature, "mapping_status": status,
            "profile": profile, "evidence_refs": evidence + [f"{INPUT}#file_id={row['file_id']}/existing_rights_records[rights_id={x}]" for x in rights_refs],
            "basis": {"kind": basis_kind, "inspection_scope": inspection},
            "limitations": limitations, "unknowns": unknowns,
            "content_access": {"performed_this_run": performed, "action": action, "rights_basis_refs": rights_refs, "reason": rights_reason},
        })
    if len(mapped) != 230 or len({r["file_id"] for r in mapped}) != 230:
        raise RuntimeError("datasets coverage contract failed")
    (OUT / "MAPPING_FRAGMENT.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in mapped), encoding="utf-8")
    (OUT / "CONTAINER_COMPONENTS.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in components), encoding="utf-8")
    summary = {
        "assigned_objects": len(rows), "mapping_records": len(mapped), "unique_file_ids": len({r["file_id"] for r in mapped}),
        "status_counts": dict(Counter(r["mapping_status"] for r in mapped)),
        "format_counts": dict(Counter(r["technical_format"] for r in mapped)),
        "structure_variant_counts": dict(Counter(r["structure_variant"] for r in mapped)),
        "basis_counts": dict(Counter(r["basis"]["kind"] for r in mapped)),
        "content_access_action_counts": dict(access_counts), "component_rows": len(components), "errors": errors,
    }
    (OUT / "RUN_RESULTS.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
