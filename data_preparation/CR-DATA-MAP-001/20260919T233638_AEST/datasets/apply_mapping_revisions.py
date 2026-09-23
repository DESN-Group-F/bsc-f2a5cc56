import json
from pathlib import Path

ROOT = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST")
OUT = ROOT / "datasets"
INPUT = ROOT / "INPUT_SCOPE.jsonl"


def read_jsonl(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def binding(row):
    route = row["prior_routing"]
    effective = (route.get("rights_record") or {}).get("effective_rights_id")
    rights = row.get("existing_rights_records") or []
    exact = [r for r in rights if r.get("file_id") == row["file_id"] and r.get("file_sha256") == row["sha256_registered"]]
    group = [r for r in rights if not r.get("file_id") and r.get("source_id") == row["source_id"] and r.get("rights_id") == effective]
    applicable = exact or group
    mode = "EXACT_FILE_ID_AND_SHA256" if exact else "RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS" if group else None
    return mode, applicable, rights


def pointer(row, rec):
    return f"{INPUT}#file_id={row['file_id']}/existing_rights_records[rights_id={rec['rights_id']}]"


def stable_signature(mapped):
    p = mapped.get("profile") or {}
    fmt = mapped["technical_format"]
    core = {"format_family": fmt, "structure_variant": mapped["structure_variant"], "semantic_type": mapped["semantic_type"]}
    if fmt == "CSV":
        core.update({"fields": p.get("fields"), "delimiter": p.get("delimiter", ",")})
    elif fmt == "XLSX":
        core.update({"sheets": [{"name": s.get("sheet_name"), "fields": s.get("fields")} for s in p.get("sheet_profiles", [])]})
    elif fmt == "MAT":
        core.update({"mat_generation": p.get("mat_generation"), "root_keys": p.get("root_keys"), "directory_schema": [{k: n.get(k) for k in ("path", "kind", "shape", "dtype")} for n in p.get("directory_nodes", [])], "level5_variables": [{k: n.get(k) for k in ("name", "shape", "class_id")} for n in p.get("variable_directory", [])]})
    elif fmt == "ZIP":
        core.update({"member_format_families": sorted((p.get("member_type_distribution") or {}).keys()), "nested_archive_names_present": bool(p.get("nested_archive_name_count"))})
    elif fmt == "JSON":
        core.update({"hierarchy_shape": p.get("shape"), "nonstandard_constants": p.get("nonstandard_constants")})
    else:
        core.update({k: p.get(k) for k in ("gzip_signature", "mat_generation", "signature_probe") if k in p})
    return json.dumps(core, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main():
    scope = {r["file_id"]: r for r in read_jsonl(INPUT)}
    mapped = read_jsonl(OUT / "MAPPING_FRAGMENT.jsonl")
    mat = {r["file_id"]: r for r in read_jsonl(OUT / "MAT_SUPPLEMENT.jsonl")}
    reason_counts = {}
    xlsx_semantics = {}
    for m in mapped:
        row = scope[m["file_id"]]
        mode, applicable, all_rights = binding(row)
        allowed = [r for r in applicable if r.get("ai_processing") == "ALLOWED"]
        if allowed:
            reason_code = "ALLOWED_EXACT_BINDING" if mode == "EXACT_FILE_ID_AND_SHA256" else "ALLOWED_GROUP_SCOPE_BINDING"
            m["content_access"]["rights_basis_refs"] = [pointer(row, allowed[0])]
            m["content_access"]["reason"] = "Existing ALLOW binds exact file_id and SHA-256." if mode == "EXACT_FILE_ID_AND_SHA256" else "Existing ALLOW matches the route effective rights ID and recorded group scope for exact acquired representations."
        else:
            values = sorted({str(r.get("ai_processing", "UNMAPPED")) for r in applicable})
            if any(v in {"RESTRICTED", "DENIED"} for v in values):
                reason_code, m["mapping_status"] = "EXPLICIT_RESTRICTION", "UNKNOWN_RESTRICTED"
            elif values == ["PENDING"]:
                reason_code, m["mapping_status"] = "PURPOSE_PENDING", "PROVISIONAL_METADATA_ONLY"
            else:
                reason_code, m["mapping_status"] = "INSUFFICIENT_BINDING", "UNKNOWN_INSUFFICIENT_EVIDENCE"
            m["content_access"]["rights_basis_refs"] = [pointer(row, r) for r in applicable]
            m["content_access"]["reason"] = {"EXPLICIT_RESTRICTION": "Applicable existing record explicitly restricts or denies AI processing.", "PURPOSE_PENDING": "Applicable exact/group record leaves the local AI-processing purpose decision pending.", "INSUFFICIENT_BINDING": "Existing source records do not bind this file by exact file/hash or the route effective group rights ID."}[reason_code]
            if reason_code == "PURPOSE_PENDING":
                m["unknowns"] = [
                    "Internal structure/schema was not inspected because the applicable local AI-processing purpose decision remains pending.",
                    "Permission for content inspection for this mapping purpose remains pending; metadata classification does not resolve that purpose decision.",
                ]
            elif reason_code == "INSUFFICIENT_BINDING":
                m["unknowns"] = [
                    "Internal structure/schema was not inspected because no exact-file or effective group-scope permission binding was established.",
                    "The applicable content-access basis for this mapping purpose remains unresolved.",
                ]
            else:
                m["unknowns"] = [
                    "Internal structure/schema was not inspected because an applicable record explicitly restricts this content access.",
                ]
            if m["technical_format"] == "NUMERIC_SUFFIX_OBJECT":
                m["unknowns"].append("The numeric suffix does not establish a multipart archive relationship; whether this object is a volume/part remains unknown.")
        m["content_access"]["reason_code"] = reason_code
        m["content_access"]["binding"] = mode
        reason_counts[reason_code] = reason_counts.get(reason_code, 0) + 1

        if m["technical_format"] == "XLSX" and m.get("profile"):
            profiles = []
            for s in m["profile"].get("sheet_profiles", []):
                nonempty = [[v for v in r if v is not None] for r in s.get("bounded_rows", []) if any(v is not None for v in r)]
                fields = max(nonempty, key=len, default=s.get("fields", []))
                profiles.append({"sheet_name": s.get("sheet_name"), "fields": fields, "bounded_row_count": s.get("bounded_row_count"), "bounded_column_limit": s.get("bounded_column_limit"), "formula_present_in_boundary": any(isinstance(v, str) and v.startswith("=") for r in s.get("bounded_rows", []) for v in r if v is not None) or s.get("formula_present_in_boundary", False)})
            m["profile"]["sheet_profiles"] = profiles
            header_text = " ".join(str(v).lower() for s in profiles for v in (s.get("fields") or []))
            if ("potential failure" in header_text or "failure mode" in header_text) and ("effect" in header_text or "severity" in header_text):
                m["semantic_type"] = "failure_mode_effects_analysis_table"
            elif "parameter" in header_text and ("unit" in header_text or "value" in header_text):
                m["semantic_type"] = "parameter_table"
            else:
                m["semantic_type"] = "workbook_table_unresolved_semantics"
                m["unknowns"] = [
                    "The bounded worksheet fields did not establish the workbook's semantic type; semantic classification requires a separately permitted follow-up review."
                ]
            m["structure_variant"] = "xlsx_bounded_sheet_headers"
            xlsx_semantics[m["semantic_type"]] = xlsx_semantics.get(m["semantic_type"], 0) + 1

        if m["technical_format"] == "MAT":
            supplement = mat[m["file_id"]]
            assert supplement["status"] == "DIRECTORY_METADATA_OBSERVED"
            p = supplement["profile"]
            m["profile"] = {"outer_container": {"technical_format": "MAT", "mat_generation": p["mat_generation"]}, "internal_directory_observed": True, **p, "remaining_unknown": ["Dataset/array values were not read.", "Units and experimental conditions remain unknown unless represented by observed key names.", "Directory is partial where directory_truncated=true."]}
            m["basis"] = {"kind": "OBSERVED_THIS_RUN", "inspection_scope": "MAT supplemental directory metadata only: bounded HDF5 traversal or bounded Level-5 element metadata; no array values"}
            m["limitations"] = ["MAT directory metadata does not validate array values, units, experimental conditions, or full-file semantic consistency."]
            m["unknowns"] = list(m["profile"]["remaining_unknown"])
            m["content_access"]["action"] = "BOUNDED_MAT_DIRECTORY_METADATA_READ"
            mat_ref = f"{OUT / 'MAT_SUPPLEMENT.jsonl'}#file_id={m['file_id']}"
            if mat_ref not in m["evidence_refs"]:
                m["evidence_refs"].append(mat_ref)

        m["structure_signature"] = stable_signature(m) if m.get("profile") is not None else None

    (OUT / "MAPPING_FRAGMENT.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in mapped), encoding="utf-8")
    result = {"reason_code_counts": reason_counts, "xlsx_semantic_counts": xlsx_semantics, "mat_supplements_applied": len(mat)}
    (OUT / "REVISION_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    from collections import Counter
    previous = json.loads((OUT / "RUN_RESULTS.json").read_text(encoding="utf-8"))
    previous.update({"status_counts": dict(Counter(r["mapping_status"] for r in mapped)), "structure_variant_counts": dict(Counter(r["structure_variant"] for r in mapped)), "basis_counts": dict(Counter(r["basis"]["kind"] for r in mapped)), "content_access_action_counts": dict(Counter(r["content_access"]["action"] for r in mapped)), "reason_code_counts": reason_counts, "semantic_type_counts": dict(Counter(r["semantic_type"] for r in mapped)), "mat_supplement": {"objects": len(mat), "hdf5_generation": sum(r["profile"].get("mat_generation") == "MATLAB_7_3_HDF5" for r in mat.values()), "level5_generation": sum(r["profile"].get("mat_generation") == "MATLAB_LEVEL_5" for r in mat.values()), "directory_truncated": sum(bool(r["profile"].get("directory_truncated")) for r in mat.values())}})
    (OUT / "RUN_RESULTS.json").write_text(json.dumps(previous, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
