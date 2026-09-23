import json
from pathlib import Path

ROOT = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST")
OUT = ROOT / "datasets"
required = {"file_id", "technical_format", "semantic_type", "structure_variant", "structure_signature", "mapping_status", "profile", "evidence_refs", "basis", "limitations", "unknowns", "content_access"}
scope = [json.loads(x) for x in (ROOT / "INPUT_SCOPE.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
expected = {x["file_id"] for x in scope if x.get("assigned_lane") == "datasets"}
rows = [json.loads(x) for x in (OUT / "MAPPING_FRAGMENT.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
ids = [x["file_id"] for x in rows]
assert len(rows) == 230
assert len(ids) == len(set(ids))
assert set(ids) == expected
for row in rows:
    assert required <= row.keys()
    assert row["mapping_status"] in {"STRUCTURE_IDENTIFIED", "PROVISIONAL_METADATA_ONLY", "UNKNOWN_RESTRICTED", "UNKNOWN_INSUFFICIENT_EVIDENCE"}
    assert row["basis"].get("kind") in {"OBSERVED_THIS_RUN", "REUSED_EXISTING_EVIDENCE", "METADATA_INFERENCE"}
    assert isinstance(row["basis"].get("inspection_scope"), str)
    assert isinstance(row["content_access"].get("performed_this_run"), bool)
    if row["mapping_status"] != "STRUCTURE_IDENTIFIED":
        assert isinstance(row["unknowns"], list) and row["unknowns"]
    assert all(Path(ref.split("#", 1)[0]).is_absolute() for ref in row["evidence_refs"])
    assert row["content_access"].get("reason_code") in {"ALLOWED_EXACT_BINDING", "ALLOWED_GROUP_SCOPE_BINDING", "PURPOSE_PENDING", "INSUFFICIENT_BINDING", "EXPLICIT_RESTRICTION"}
    assert all(Path(ref.split("#", 1)[0]).is_absolute() for ref in row["content_access"].get("rights_basis_refs", []))
    if row["mapping_status"] == "UNKNOWN_RESTRICTED":
        assert not row["content_access"]["performed_this_run"]
    if row["technical_format"] in {"ZIP", "TGZ", "GZIP"} and row["mapping_status"] == "STRUCTURE_IDENTIFIED":
        assert any("Internal member content" in x for x in row["unknowns"])
    if row["technical_format"] == "XLSX" and row.get("profile"):
        assert all("bounded_rows" not in sheet for sheet in row["profile"].get("sheet_profiles", []))
        if row["semantic_type"] == "workbook_table_unresolved_semantics":
            assert any("semantic type" in item for item in row["unknowns"])
    if row["technical_format"] == "MAT":
        assert row["profile"].get("internal_directory_observed") is True
        assert row["profile"].get("array_values_read") is False
components = [json.loads(x) for x in (OUT / "CONTAINER_COMPONENTS.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
assert all(x["container_file_id"] in expected and x["member_content_read"] is False for x in components)
print(json.dumps({"status": "PASS", "scope_records": len(rows), "unique_file_ids": len(set(ids)), "component_rows": len(components), "checks": ["required_fields", "exact_file_id_set", "status_enum", "nonidentified_unknowns_nonempty", "absolute_evidence_refs", "absolute_rights_basis_refs", "permission_reason_codes", "restricted_content_not_read", "outer_container_limit_explicit", "xlsx_no_sample_values", "mat_directory_observed_no_array_values", "component_parent_integrity"]}, ensure_ascii=False, indent=2))
