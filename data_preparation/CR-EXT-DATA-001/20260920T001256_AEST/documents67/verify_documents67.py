"""Coverage and artifact checks for EXT-02."""
from __future__ import annotations
import json
from collections import Counter
from pathlib import Path

ROOT = Path(r"E:\desn 2000\bsc")
RUN = ROOT / "data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"
OUT = RUN / "documents67"
scope = [json.loads(x) for x in (RUN / "INPUT_SCOPE.jsonl").open(encoding="utf-8") if x.strip()]
expected = {x["file_id"] for x in scope if x.get("pending67") is True and x.get("assigned_lane") == "documents"}
decisions = [json.loads(x) for x in (OUT / "LOCAL_ACTION_DECISIONS.jsonl").open(encoding="utf-8") if x.strip()]
manifest = [json.loads(x) for x in (OUT / "PROCESSING_MANIFEST.jsonl").open(encoding="utf-8") if x.strip()]
quality = [json.loads(x) for x in (OUT / "QUALITY_FINDINGS.jsonl").open(encoding="utf-8") if x.strip()]
external_requirements = {x["external_requirement_id"] for x in (json.loads(z) for z in (RUN / "requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl").open(encoding="utf-8") if z.strip())}
requirements = {x["requirement_id"] for x in (json.loads(z) for z in (RUN / "requirements/REQUIREMENTS.jsonl").open(encoding="utf-8") if z.strip())}
special = {x["file_id"] for x in manifest if x["source_id"] in {"SRC-038", "SRC-048"}}
checks = {
    "scope_32_unique": len(expected) == 32,
    "decisions_exactly_once": len(decisions) == 32 and {x["file_id"] for x in decisions} == expected,
    "manifest_exactly_once": len(manifest) == 32 and {x["file_id"] for x in manifest} == expected,
    "quality_exactly_once": len(quality) == 32 and {x["file_id"] for x in quality} == expected,
    "no_failed_status": all(x["status"] != "PREPARATION_FAILED" for x in manifest),
    "seven_terms_records_distinguished": len(special) == 7 and sum(x["status"] == "LOCALLY_PREPARED_BOUNDED_TERMS_AWARE" for x in manifest if x["file_id"] in special) == 6 and sum(x["status"] == "LOCALLY_INSPECTED_COPY_DISABLED_EXCEPTION" for x in manifest if x["file_id"] in special) == 1,
    "molicel_no_complete_fulltext_copy": all(not x["profile"].get("complete_fulltext_copy_created", False) for x in manifest if x["source_id"] == "SRC-038"),
    "copy_disabled_exception_has_no_body_output": all(not x["derived_outputs"] for x in manifest if x["status"] == "LOCALLY_INSPECTED_COPY_DISABLED_EXCEPTION"),
    "artwork_not_copied": all(not x["profile"].get("images_or_third_party_artwork_copied", False) for x in manifest if x["source_id"] in {"SRC-038", "SRC-048"} and x["status"] != "LOCALLY_INSPECTED_COPY_DISABLED_EXCEPTION"),
    "bounded_candidate_literals_match_source_lines": all(x["profile"].get("source_literal_consistency_failure_count") == 0 for x in manifest if x["status"] == "LOCALLY_PREPARED_BOUNDED_TERMS_AWARE"),
    "bounded_candidate_condition_flags_present": all(x["profile"].get("condition_not_automatically_verified_count") == x["profile"].get("fact_candidate_count") for x in manifest if x["status"] == "LOCALLY_PREPARED_BOUNDED_TERMS_AWARE"),
    "external_requirement_ids_valid": all(set(x["requirement_support"].get("external_requirement_ids", [])) <= external_requirements for x in manifest if x["file_id"] in special),
    "all_32_requirement_links_assessed": all(x["requirement_support"].get("status", "").startswith("ASSESSED_") for x in manifest),
    "all_requirement_ids_valid": all(set(x["requirement_support"].get("requirement_ids", [])) <= requirements and set(x["requirement_support"].get("external_requirement_ids", [])) <= external_requirements for x in manifest),
    "no_module_ids_used_as_evidence": all(x["requirement_support"].get("module_ids_used_as_evidence") is False for x in manifest),
    "derived_outputs_exist": all(Path(p).is_file() for x in manifest for p in x["derived_outputs"]),
    "all_readable_objects_have_derived": all(x["derived_outputs"] for x in manifest if x["status"] != "LOCALLY_INSPECTED_COPY_DISABLED_EXCEPTION"),
    "prohibited_uses_remain_closed": all(x["rag_status"] == "NOT_DECIDED_NOT_ADMITTED" and x["training_status"] == "NOT_AUTHORIZED" and x["external_transfer"] == "NOT_AUTHORIZED_NOT_ATTEMPTED" for x in manifest),
    "user_authority_and_terms_retained": all(x["user_local_authorization"]["does_not_modify_third_party_terms"] and len(x["remaining_not_authorized"]) >= 5 for x in decisions),
}
report = {"status": "PASS" if all(checks.values()) else "FAIL", "scope": "EXT-02 exact-set, artifact existence, action-boundary, and status checks only; not content correctness, currentness, applicability, or server acceptance.", "checks": checks, "status_counts": Counter(x["status"] for x in manifest), "quality_counts": Counter(x["quality_status"] for x in quality), "derived_file_count": sum(len(x["derived_outputs"]) for x in manifest), "command": r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/documents67/verify_documents67.py", "cwd": str(ROOT)}
(OUT / "CHECK_RESULTS.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2, default=dict))
raise SystemExit(0 if report["status"] == "PASS" else 1)
