from __future__ import annotations

import csv
import gzip
import io
import json
import math
import re
import struct
import time
import zipfile
from collections import Counter
from pathlib import Path

import ijson
import openpyxl

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
INPUT = RUN / "INPUT_SCOPE.jsonl"
OUT = RUN / "datasets67"
MAX_ZIP_COMPONENTS = 50_000
MAX_MEMBER_BYTES = 262_144
MAX_MEMBER_TOTAL = 2 * 1024 * 1024
MAX_JSON_EVENTS = 20_000
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_TAR_DECOMPRESSED = 8 * 1024 * 1024


def load_rows(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def ref(file_id, tail=""):
    return f"{INPUT}#file_id={file_id}{tail}"


def format_family(path):
    s = path.suffix.lower()
    if s == ".zip": return "ZIP"
    if s == ".json": return "JSON"
    if s == ".xlsx": return "XLSX"
    if s == ".tgz": return "TGZ"
    if s == ".gz": return "GZIP"
    if s[1:].isdigit(): return "NUMERIC_SUFFIX"
    return s.lstrip(".").upper()


def action_decision(row):
    rights = row.get("existing_rights_records") or []
    applicable_id = (row.get("prior_routing", {}).get("rights_record") or {}).get("effective_rights_id")
    applicable = [r for r in rights if r.get("rights_id") == applicable_id]
    conditions = [r.get("basis_summary") for r in applicable if r.get("basis_summary")]
    return {
        "file_id": row["file_id"], "source_id": row["source_id"],
        "document_family_id": row["inventory"].get("document_family_id"), "document_version_id": row["inventory"].get("document_version_id"),
        "prior_ai_processing_values": sorted({str(r.get("ai_processing", "UNMAPPED")) for r in applicable}),
        "prior_status_preserved": (row.get("prior_processing") or {}).get("status"),
        "current_local_action_decision": "ALLOW_THIS_RUN_LOCAL_READ_AND_BOUNDED_STRUCTURE_PREPARATION",
        "user_authorization": "User explicitly authorized local processing of the remaining 60+7 objects and confirmed UNSW coursework or non-commercial research use on 2026-09-20.",
        "allowed_actions": ["read-only local structure inspection", "bounded local field/schema extraction", "local quality checks"],
        "excluded_actions": ["RAG/model context", "training", "publication/redistribution", "server transfer", "code or macro execution"],
        "existing_terms_or_conditions": conditions,
        "rights_refs": [ref(row["file_id"], f"/existing_rights_records[rights_id={r.get('rights_id')}]") for r in applicable],
        "authorization_ref": "E:/desn 2000/bsc/backlog/CR_EXT_DATA_001_TASK_CARDS.md#processing-authorization-boundary",
        "remaining_unknowns": ["User authorization does not alter third-party terms or authorize excluded downstream uses."]
    }


def text_schema(data, locator):
    text = data.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()[:40]
    delimiter = None
    header = []
    for candidate in ["\t", ",", ";", "|"]:
        if lines and lines[0].count(candidate) >= 1:
            delimiter = candidate
            header = next(csv.reader([lines[0]], delimiter=candidate))[:100]
            break
    labels = []
    for line in lines[:20]:
        m = re.match(r"\s*([^:\t]{1,80})\s*[:\t]", line)
        if m: labels.append(m.group(1).strip())
    return {"locator": locator, "structure": "delimited_or_labelled_text", "fields": header, "delimiter": delimiter, "leading_label_names": sorted(set(labels)), "bounded_bytes": len(data), "units_confirmed": False, "conditions_confirmed": bool(labels), "representative_scope": "prefix only; not full member consistency"}


def json_schema_file(path, locator):
    keys, scalar_types, prefixes = set(), Counter(), set()
    events = 0
    nonstandard = set()
    with path.open("rb") as source:
        raw = source.read(MAX_JSON_BYTES)
    for token in re.findall(rb"(?<![A-Za-z0-9_])(?:NaN|-?Infinity)(?![A-Za-z0-9_])", raw):
        nonstandard.add(token.decode("ascii"))
    normalized = re.sub(rb"(?<![A-Za-z0-9_])(?:NaN|-?Infinity)(?![A-Za-z0-9_])", b"null", raw)
    fh = io.BytesIO(normalized)
    try:
        try:
            for prefix, event, value in ijson.parse(fh):
                events += 1
                if event == "map_key":
                    keys.add(str(value))
                    prefixes.add(prefix)
                elif event in {"string", "number", "boolean", "null"}:
                    scalar_types[event] += 1
                    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)): nonstandard.add(str(value))
                if events >= MAX_JSON_EVENTS:
                    break
            consumed = fh.tell()
        except Exception as exc:
            consumed = fh.tell()
            if len(raw) < path.stat().st_size and "premature EOF" in str(exc):
                pass
            else:
                return {"locator": locator, "structure": "json_stream_parse_error", "events": events, "bytes_read": len(raw), "bytes_consumed_normalized": consumed, "nonstandard_constants_observed": sorted(nonstandard), "error": f"{type(exc).__name__}: {exc}", "representative_scope": "bounded prefix"}
    finally:
        fh.close()
    return {"locator": locator, "structure": "json_stream", "field_names": sorted(keys), "object_prefixes": sorted(prefixes), "scalar_event_counts_bounded": dict(scalar_types), "nonstandard_constants_observed": sorted(nonstandard), "events": events, "bytes_read": len(raw), "bytes_consumed_normalized": consumed, "complete_file_parsed": len(raw) >= path.stat().st_size and consumed >= len(normalized), "units_confirmed": False, "conditions_confirmed": False, "representative_scope": f"first {events} parser events within first {len(raw)} source bytes"}


def member_schema(name, data):
    suffix = Path(name).suffix.lower()
    if suffix in {".csv", ".txt", ".tsv", ".dat", ".log"} or not suffix:
        return text_schema(data, name)
    if suffix == ".json":
        try:
            value = json.loads(data.decode("utf-8-sig"), parse_constant=lambda x: {"nonstandard": x})
            if isinstance(value, dict): keys = sorted(value.keys())
            else: keys = []
            return {"locator": name, "structure": "json_member", "top_level_type": type(value).__name__, "field_names": keys, "bounded_bytes": len(data), "representative_scope": "complete member"}
        except Exception as exc:
            return {"locator": name, "structure": "json_member_prefix", "bounded_bytes": len(data), "error": f"{type(exc).__name__}: {exc}", "representative_scope": "prefix only"}
    if suffix == ".mat":
        generation = "MATLAB_7_3_HDF5" if data.startswith(b"MATLAB 7.3 MAT-file") else "MATLAB_LEVEL_5" if data.startswith(b"MATLAB 5.0 MAT-file") else "MAT_UNKNOWN"
        return {"locator": name, "structure": "mat_member_header", "mat_generation": generation, "bounded_bytes": len(data), "representative_scope": "member header only; variable schema unknown"}
    if suffix == ".xls":
        structure = "ole_compound_excel_workbook" if data.startswith(bytes.fromhex("d0cf11e0a1b11ae1")) else "ooxml_zip_package_with_legacy_xls_suffix" if data.startswith(b"PK\x03\x04") else "xls_signature_unconfirmed"
        return {"locator": name, "structure": structure, "magic_hex": data[:16].hex(), "bounded_bytes": len(data), "representative_scope": "signature only; workbook body not extracted"}
    if suffix == ".xlsx":
        return {"locator": name, "structure": "xlsx_package_member", "magic_hex": data[:4].hex(), "bounded_bytes": len(data), "representative_scope": "package signature only inside outer archive"}
    if suffix in {".py", ".m", ".ipynb"}:
        return {"locator": name, "structure": "source_or_notebook_file_not_executed", "bounded_bytes": len(data), "representative_scope": "signature/prefix only; code not executed"}
    return {"locator": name, "structure": "binary_or_unsupported_member", "magic_hex": data[:16].hex(), "bounded_bytes": len(data), "representative_scope": "signature only"}


def inspect_zip(path, row, components, schemas, findings):
    total_read = 0
    representatives = set()
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        for info in infos[:MAX_ZIP_COMPONENTS]:
            components.append({"container_file_id": row["file_id"], "member_path": info.filename, "member_format": Path(info.filename).suffix.lower() or "<none>", "uncompressed_bytes": info.file_size, "compressed_bytes": info.compress_size, "crc32": f"{info.CRC:08x}", "directory_only": True, "content_sampled": False})
        for info in infos:
            ext = Path(info.filename).suffix.lower() or "<none>"
            if info.is_dir() or ext in representatives or total_read >= MAX_MEMBER_TOTAL:
                continue
            representatives.add(ext)
            if info.file_size > 64 * 1024 * 1024:
                findings.append({"file_id": row["file_id"], "severity": "INFO", "code": "REPRESENTATIVE_MEMBER_TOO_LARGE_FOR_COMPLETE_READ", "locator": info.filename, "detail": "Only a bounded prefix was inspected."})
            with z.open(info) as f:
                data = f.read(min(MAX_MEMBER_BYTES, info.file_size))
            total_read += len(data)
            schema = member_schema(info.filename, data)
            schema.update({"file_id": row["file_id"], "schema_id": f"{row['file_id']}#member:{len(schemas)}", "container_format": "ZIP", "member_format": ext})
            schemas.append(schema)
            if schema["structure"] == "ooxml_zip_package_with_legacy_xls_suffix":
                findings.append({"file_id": row["file_id"], "severity": "WARNING", "code": "XLS_SUFFIX_OOXML_SIGNATURE", "locator": info.filename, "detail": "Member uses an .xls suffix but has a ZIP/OOXML package signature; consumers must use detected format rather than suffix."})
        nested_candidates = [i for i in infos if not i.is_dir() and Path(i.filename).suffix.lower() == ".zip" and i.file_size <= 64 * 1024 * 1024]
        nested_observed = 0
        if nested_candidates:
            chosen = None
            nested_bytes = None
            for candidate in sorted(nested_candidates, key=lambda i: i.file_size):
                candidate_bytes = z.read(candidate)
                if zipfile.is_zipfile(io.BytesIO(candidate_bytes)):
                    chosen, nested_bytes = candidate, candidate_bytes
                    break
                findings.append({"file_id": row["file_id"], "severity": "WARNING", "code": "ZIP_NAMED_MEMBER_NOT_ZIP", "locator": candidate.filename, "detail": "Member has a .zip suffix but is not a valid ZIP container; no multipart/container inference was made."})
            if chosen is not None:
                total_read += len(nested_bytes)
                with zipfile.ZipFile(io.BytesIO(nested_bytes)) as nested:
                    nested_infos = nested.infolist()
                    nested_observed = len(nested_infos)
                    for ni in nested_infos[:MAX_ZIP_COMPONENTS]:
                        components.append({"container_file_id": row["file_id"], "parent_member_path": chosen.filename, "member_path": ni.filename, "member_format": Path(ni.filename).suffix.lower() or "<none>", "uncompressed_bytes": ni.file_size, "compressed_bytes": ni.compress_size, "crc32": f"{ni.CRC:08x}", "directory_only": True, "content_sampled": False})
                    seen_inner = set()
                    for ni in nested_infos:
                        ext = Path(ni.filename).suffix.lower() or "<none>"
                        if ni.is_dir() or ext in seen_inner: continue
                        seen_inner.add(ext)
                        with nested.open(ni) as nf: sample = nf.read(min(MAX_MEMBER_BYTES, ni.file_size))
                        schema = member_schema(f"{chosen.filename}!/{ni.filename}", sample)
                        schema.update({"file_id": row["file_id"], "schema_id": f"{row['file_id']}#nested-member:{len(schemas)}", "container_format": "NESTED_ZIP_REPRESENTATIVE", "member_format": ext})
                        schemas.append(schema)
                findings.append({"file_id": row["file_id"], "severity": "LIMITATION", "code": "NESTED_ZIP_REPRESENTATIVE_ONLY", "detail": f"Inspected the smallest eligible valid nested ZIP ({chosen.filename}); other nested ZIPs were not opened."})
    if len(infos) > MAX_ZIP_COMPONENTS:
        findings.append({"file_id": row["file_id"], "severity": "LIMITATION", "code": "COMPONENT_LIST_TRUNCATED", "detail": f"Recorded first {MAX_ZIP_COMPONENTS} of {len(infos)} members."})
    return {"action": "ZIP_CENTRAL_DIRECTORY_AND_PER_FORMAT_REPRESENTATIVE_PREFIX", "member_count": len(infos), "member_formats": dict(Counter(Path(i.filename).suffix.lower() or "<none>" for i in infos if not i.is_dir())), "representative_formats": sorted(representatives), "representative_bytes_read": total_read, "nested_zip_member_count_observed": nested_observed, "complete_internal_coverage": False}


def tar_headers(block):
    pos, rows = 0, []
    while pos + 512 <= len(block):
        header = block[pos:pos + 512]
        if header == b"\0" * 512: break
        name = header[:100].split(b"\0", 1)[0].decode("utf-8", errors="replace")
        try: size = int(header[124:136].split(b"\0", 1)[0].strip() or b"0", 8)
        except ValueError: break
        rows.append((name, size, pos + 512))
        nxt = pos + 512 + ((size + 511) // 512) * 512
        if nxt > len(block): break
        pos = nxt
    return rows


def inspect_targz(path, row, components, schemas, findings):
    with gzip.open(path, "rb") as g:
        data = g.read(MAX_TAR_DECOMPRESSED)
    headers = tar_headers(data)
    for name, size, offset in headers:
        components.append({"container_file_id": row["file_id"], "member_path": name, "member_format": Path(name).suffix.lower() or "<none>", "uncompressed_bytes": size, "directory_only": True, "content_sampled": False})
    reps = set()
    for name, size, offset in headers:
        ext = Path(name).suffix.lower() or "<none>"
        if ext in reps or offset + min(size, MAX_MEMBER_BYTES) > len(data): continue
        reps.add(ext)
        schema = member_schema(name, data[offset:offset + min(size, MAX_MEMBER_BYTES)])
        schema.update({"file_id": row["file_id"], "schema_id": f"{row['file_id']}#member:{len(schemas)}", "container_format": "TAR_GZIP", "member_format": ext})
        schemas.append(schema)
    findings.append({"file_id": row["file_id"], "severity": "LIMITATION", "code": "TAR_STREAM_BOUNDED_PREFIX_ONLY", "detail": f"Inspected at most {MAX_TAR_DECOMPRESSED} decompressed bytes; full member count/version equivalence not established."})
    return {"action": "BOUNDED_GZIP_DECOMPRESSION_AND_TAR_PREFIX_HEADERS", "decompressed_bytes": len(data), "members_observed_in_prefix": len(headers), "representative_formats": sorted(reps), "complete_internal_coverage": False}


def inspect_xlsx(path, row, schemas, findings):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=False, keep_links=False)
    sheets = []
    try:
        for ws in wb.worksheets:
            bounded = [list(r[:100]) for r in ws.iter_rows(min_row=1, max_row=20, values_only=True)]
            nonempty = [[str(v) for v in r if v is not None] for r in bounded if any(v is not None for v in r)]
            fields = max(nonempty, key=len, default=[])
            sheets.append({"sheet_name": ws.title, "fields": fields, "bounded_rows": len(bounded), "formula_present": any(isinstance(v, str) and v.startswith("=") for r in bounded for v in r if v is not None)})
    finally: wb.close()
    schemas.append({"file_id": row["file_id"], "schema_id": f"{row['file_id']}#workbook", "locator": str(path), "structure": "xlsx_workbook", "sheets": sheets, "units_confirmed": False, "conditions_confirmed": False, "representative_scope": "first 20 rows and 100 columns per sheet; formulas not evaluated"})
    return {"action": "BOUNDED_XLSX_FIELDS", "worksheet_count": len(sheets), "complete_internal_coverage": False}


def inspect_numeric(path, row, schemas, findings):
    size = path.stat().st_size
    with path.open("rb") as f: data = f.read(min(MAX_MEMBER_BYTES, size))
    printable = sum((b in b"\t\r\n" or 32 <= b < 127) for b in data) / max(1, len(data))
    if printable > 0.95:
        schema = text_schema(data, str(path))
        actual = "PLAIN_TEXT_DIAGNOSTIC_OR_TABULAR_FILE"
        if size <= 16 and re.fullmatch(rb"\d+\r?\n?", data):
            actual = "TRUNCATED_OR_PLACEHOLDER_NUMERIC_TEXT"
            findings.append({"file_id": row["file_id"], "severity": "WARNING", "code": "NINE_BYTE_NUMERIC_TEXT_OBJECT", "detail": "Object contains only a short numeric line; it is not evidence of a multipart archive and is insufficient as the corresponding full data object."})
    else:
        schema = {"locator": str(path), "structure": "opaque_binary", "magic_hex": data[:16].hex(), "bounded_bytes": len(data), "representative_scope": "prefix signature only"}
        actual = "OPAQUE_BINARY"
    schema.update({"file_id": row["file_id"], "schema_id": f"{row['file_id']}#object", "declared_suffix": path.suffix, "actual_format": actual})
    schemas.append(schema)
    return {"action": "NUMERIC_SUFFIX_SIGNATURE_AND_BOUNDED_TEXT_STRUCTURE", "actual_format": actual, "bytes_read": len(data), "multipart_relationship_established": False, "complete_internal_coverage": size <= len(data)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [r for r in load_rows(INPUT) if r.get("pending67") is True and r.get("assigned_lane") == "datasets"]
    assert len(rows) == 35
    decisions, manifests, components, schemas, findings = [], [], [], [], []
    for row in rows:
        decisions.append(action_decision(row))
        path = SOURCE / Path(row["relative_path"])
        fmt = format_family(path)
        started = time.monotonic()
        before_c, before_s, before_f = len(components), len(schemas), len(findings)
        try:
            if fmt == "ZIP": detail = inspect_zip(path, row, components, schemas, findings)
            elif fmt in {"TGZ", "GZIP"}: detail = inspect_targz(path, row, components, schemas, findings)
            elif fmt == "JSON":
                schema = json_schema_file(path, str(path)); schema.update({"file_id": row["file_id"], "schema_id": f"{row['file_id']}#object"}); schemas.append(schema)
                detail = {"action": "BOUNDED_STREAMING_JSON_SCHEMA", "events": schema.get("events", 0), "bytes_read": schema.get("bytes_read", 0), "complete_internal_coverage": schema.get("complete_file_parsed", False), "nonstandard_constants_observed": schema.get("nonstandard_constants_observed", [])}
                if schema["structure"] == "json_stream_parse_error": findings.append({"file_id": row["file_id"], "severity": "WARNING", "code": "JSON_STREAM_PARSE_ERROR", "detail": schema["error"]})
            elif fmt == "XLSX": detail = inspect_xlsx(path, row, schemas, findings)
            elif fmt == "NUMERIC_SUFFIX": detail = inspect_numeric(path, row, schemas, findings)
            else: raise ValueError(f"unsupported format {fmt}")
            status = "PREPARED_BOUNDED" if detail.get("complete_internal_coverage") else "PREPARED_PARTIAL_RESOURCE_BOUNDED"
            error = None
        except Exception as exc:
            detail, status, error = {"action": "FAILED_INSPECTION"}, "PREPARATION_FAILED", f"{type(exc).__name__}: {exc}"
            findings.append({"file_id": row["file_id"], "severity": "ERROR", "code": "INSPECTION_FAILED", "detail": error})
        inv = row["inventory"]
        manifests.append({
            "file_id": row["file_id"], "source_id": row["source_id"], "document_family_id": inv.get("document_family_id"), "document_version_id": inv.get("document_version_id"),
            "relative_path": row["relative_path"], "registered_bytes": row["bytes_registered"], "technical_format": fmt,
            "processing_status": status, "actual_local_action": detail.get("action"), "detail": detail, "elapsed_seconds": round(time.monotonic() - started, 4), "error": error,
            "component_rows": len(components) - before_c, "schema_rows": len(schemas) - before_s, "quality_finding_rows": len(findings) - before_f,
            "rights_and_authorization_refs": [ref(row["file_id"]), "E:/desn 2000/bsc/backlog/CR_EXT_DATA_001_TASK_CARDS.md#processing-authorization-boundary"],
            "fields_confirmed": any(s.get("fields") or s.get("field_names") for s in schemas[before_s:]), "units_confirmed": any(s.get("units_confirmed") for s in schemas[before_s:]), "conditions_confirmed": any(s.get("conditions_confirmed") for s in schemas[before_s:]),
            "representative_scope": [s.get("representative_scope") for s in schemas[before_s:]], "quality_status": "HAS_LIMITATIONS" if len(findings) > before_f else "NO_ISSUE_IN_BOUNDED_CHECK",
            "requirement_support": {"supported_requirement_ids": [], "candidate_requirement_ids": ["D15"] if row.get("prior_routing", {}).get("primary_route") == "EXPERIMENT_DATA" else [], "status": "CANDIDATE_ONLY_UNTIL_CHEMISTRY_DEVICE_AND_CONDITION_MATCH" if row.get("prior_routing", {}).get("primary_route") == "EXPERIMENT_DATA" else "UNSUPPORTED_BY_THIS_STRUCTURE_CHECK"},
            "limitations": ["No RAG/model/training/publication/server-transfer permission is inferred.", "Representative structures do not prove full-container or full-file consistency."]
        })
    for name, data in [("LOCAL_ACTION_DECISIONS.jsonl", decisions), ("PROCESSING_MANIFEST.jsonl", manifests), ("CONTAINER_COMPONENTS.jsonl", components), ("SCHEMA_CATALOG.jsonl", schemas), ("QUALITY_FINDINGS.jsonl", findings)]:
        (OUT / name).write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in data), encoding="utf-8")
    summary = {"objects": len(rows), "status_counts": dict(Counter(x["processing_status"] for x in manifests)), "format_counts": dict(Counter(x["technical_format"] for x in manifests)), "component_rows": len(components), "schema_rows": len(schemas), "quality_findings": len(findings), "actual_format_counts_numeric_suffix": dict(Counter(x["detail"].get("actual_format") for x in manifests if x["technical_format"] == "NUMERIC_SUFFIX"))}
    (OUT / "RUN_RESULTS.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__": main()
