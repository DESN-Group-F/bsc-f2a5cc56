"""Contract and coverage checks for the MAP-01 document fragment."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

RUN = Path("data_preparation/CR-DATA-MAP-001/20260919T233638_AEST")
scope = [json.loads(x) for x in (RUN / "INPUT_SCOPE.jsonl").open(encoding="utf-8") if x.strip()]
expected = {x["file_id"] for x in scope if x["assigned_lane"] == "documents"}
rows = [json.loads(x) for x in (RUN / "documents/MAPPING_FRAGMENT.jsonl").open(encoding="utf-8") if x.strip()]
actual = [x["file_id"] for x in rows]
required = {"file_id", "technical_format", "semantic_type", "semantic_basis", "structure_variant", "structure_signature", "mapping_status", "profile", "evidence_refs", "basis", "limitations", "unknowns", "content_access"}
allowed = {"STRUCTURE_IDENTIFIED", "PROVISIONAL_METADATA_ONLY", "UNKNOWN_RESTRICTED", "UNKNOWN_INSUFFICIENT_EVIDENCE"}
audits = [json.loads(x) for x in (RUN / "documents/RIGHTS_BASIS_AUDIT.jsonl").open(encoding="utf-8") if x.strip()]
pdf_supplement = [json.loads(x) for x in (RUN / "documents/PDF_STRUCTURE_SUPPLEMENT.jsonl").open(encoding="utf-8") if x.strip()]
checks = {
    "record_count_70": len(rows) == 70,
    "file_ids_unique": len(actual) == len(set(actual)),
    "file_id_set_exact": set(actual) == expected,
    "required_fields_present": all(required <= set(x) for x in rows),
    "mapping_status_valid": all(x["mapping_status"] in allowed for x in rows),
    "evidence_refs_absolute": all(x["evidence_refs"] and all(Path(ref.split("#", 1)[0]).is_absolute() for ref in x["evidence_refs"]) for x in rows),
    "identified_has_signature_and_profile": all(x["structure_signature"] and x["profile"] for x in rows if x["mapping_status"] == "STRUCTURE_IDENTIFIED"),
    "metadata_only_has_unknowns": all(x["unknowns"] for x in rows if x["mapping_status"] != "STRUCTURE_IDENTIFIED"),
    "pdf_text_evidence_has_layout_limit": all(any("layout" in z for z in x["limitations"]) for x in rows if x["technical_format"] == "application/pdf" and x["mapping_status"] == "STRUCTURE_IDENTIFIED"),
    "semantic_basis_is_metadata_inference": all(x["semantic_basis"]["kind"] == "METADATA_INFERENCE" for x in rows),
    "semantic_uncertainty_explicit": all(any("Semantic type is inferred" in z for z in x["unknowns"]) for x in rows),
    "signature_has_no_observation_counts": all(not any(ch.isdigit() for ch in x["structure_signature"]) for x in rows if x["structure_signature"]),
    "rights_audit_covers_38_historical_reads": len(audits) == 38 and len({x["file_id"] for x in audits}) == 38,
    "rights_and_extraction_binding_verified": all(x["local_processing_basis"]["verified"] and x["extraction_input_file_id_matches"] and x["extraction_input_sha256_matches"] for x in audits),
    "correction_revision_did_not_reread_content": all(x["content_reread_in_correction_revision"] is False for x in audits),
    "bounded_pdf_supplement_exactly_three": len(pdf_supplement) == 3 and all(x["status"] == "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED" for x in pdf_supplement),
    "bounded_pdf_text_pages_within_budget": all(len(x["text_layer_pages_checked_1_based"]) <= 3 and x["text_layer_pages_checked_1_based"] == sorted({1, 2, x["page_count"]}) for x in pdf_supplement),
    "bounded_pdf_profiles_attached": all(any(r["file_id"] == x["file_id"] and r.get("profile", {}).get("original_pdf_bounded_probe") for r in rows) for x in pdf_supplement),
}
report = {
    "scope": "MAP-01 fragment contract and exact file_id coverage only; not content correctness, applicability, parser fitness, or server acceptance.",
    "checks": checks,
    "status": "PASS" if all(checks.values()) else "FAIL",
    "records": len(rows),
    "status_counts": Counter(x["mapping_status"] for x in rows),
    "command": r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation/CR-DATA-MAP-001/20260919T233638_AEST/documents/verify_mapping.py",
    "cwd": r"E:\desn 2000\bsc",
}
(RUN / "documents/CHECK_RESULTS.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2, default=dict))
raise SystemExit(0 if report["status"] == "PASS" else 1)
