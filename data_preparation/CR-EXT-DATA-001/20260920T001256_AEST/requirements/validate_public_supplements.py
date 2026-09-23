#!/usr/bin/env python3
"""Validate the finalized EXT-01 public supplement and ER-12 metadata package."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RUN = Path(__file__).resolve().parents[1]
REQ = RUN / "requirements"
SUP = RUN / "public_supplements"
COMMAND = r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/requirements/validate_public_supplements.py"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


manifest = load_jsonl(REQ / "PUBLIC_SUPPLEMENT_MANIFEST.jsonl")
methods = load_jsonl(REQ / "METHOD_REFERENCE_STATUS.jsonl")
criteria_path = SUP / "ER12_METHOD_ACCEPTANCE_CRITERIA.json"
criteria = json.loads(criteria_path.read_text(encoding="utf-8"))
ids = [x["supplement_id"] for x in manifest]
downloaded = [x for x in manifest if x["status"] == "DOWNLOADED"]
errors: list[str] = []

checks: dict[str, dict] = {}

unique_ok = len(ids) == 11 and len(set(ids)) == 11
checks["manifest_11_unique_supplement_ids"] = {"pass":unique_ok, "observed_records":len(ids), "observed_unique":len(set(ids))}
if not unique_ok:
    errors.append("manifest does not contain exactly 11 unique supplement IDs")

file_details = []
files_ok = len(downloaded) == 4
for row in downloaded:
    path = Path(row["local_path"])
    exists = path.is_file()
    actual_bytes = path.stat().st_size if exists else None
    header_ok = exists and path.read_bytes()[:4] == b"%PDF"
    actual_sha = digest(path) if exists else None
    bytes_ok = exists and actual_bytes == row["bytes"]
    hash_ok = exists and actual_sha == row["sha256"]
    files_ok = files_ok and header_ok and bytes_ok and hash_ok
    file_details.append({"supplement_id":row["supplement_id"], "exists":exists, "pdf_header_pass":header_ok, "bytes_pass":bytes_ok, "sha256_pass":hash_ok, "actual_bytes":actual_bytes, "actual_sha256":actual_sha})
checks["four_local_pdf_originals_identity"] = {"pass":files_ok, "details":file_details}
if not files_ok:
    errors.append("one or more local PDF originals failed existence/header/bytes/hash validation")

total_bytes = sum(x["bytes"] for x in downloaded)
budget_ok = total_bytes <= 60 * 1024 * 1024
checks["download_budget_60_mib"] = {"pass":budget_ok, "actual_bytes":total_bytes, "limit_bytes":60 * 1024 * 1024}
if not budget_ok:
    errors.append("local originals exceed 60 MiB")

method_ids = {x["method_id"] for x in methods}
principle_ids = {sid for x in methods for sid in x["principle_basis"]}
principle_ok = method_ids == {"units.convert", "electric.ohmic_power", "series.integrate"} and principle_ids.issubset(set(ids)) and all(x.get("remaining_external_data_gap") is None for x in methods)
checks["er12_principle_references_resolve"] = {"pass":principle_ok, "method_ids":sorted(method_ids), "referenced_supplement_ids":sorted(principle_ids), "missing_supplement_ids":sorted(principle_ids - set(ids))}
if not principle_ok:
    errors.append("ER-12 method or principle supplement references are incomplete")

criterion_ids = {x["case_id"] for x in criteria["independent_analytic_cases"]}
rejection_results = {x["result"] for x in criteria["mandatory_rejections"]}
criteria_ok = len(criterion_ids) == 7 and len(rejection_results) == 7 and all(Path(x["acceptance_criteria_ref"]).resolve() == criteria_path.resolve() for x in methods)
checks["er12_acceptance_criteria_ids_and_refs"] = {"pass":criteria_ok, "analytic_case_ids":sorted(criterion_ids), "rejection_result_ids":sorted(rejection_results), "method_reference_count":len(methods)}
if not criteria_ok:
    errors.append("ER-12 acceptance case/rejection IDs or method references are incomplete")

semantic = criteria["units_and_assumptions"]
semantic_ok = all(k in semantic for k in ("temperature", "charge", "energy")) and any("capacity" in x.lower() and "state of health" in x.lower() for x in criteria["semantic_limits"])
checks["er12_required_semantic_boundaries_present"] = {"pass":semantic_ok, "required_quantity_keys":["temperature", "charge", "energy"], "semantic_limit_count":len(criteria["semantic_limits"])}
if not semantic_ok:
    errors.append("ER-12 required temperature/Ah/Wh/capacity-SOH semantic boundary is missing")

result = {
    "status":"PASS" if not errors else "FAIL", "executed_on":"2026-09-20", "execution_command":COMMAND,
    "manifest_records":len(manifest), "local_originals":len(downloaded), "local_original_bytes":total_bytes,
    "verified_term_locator_records":3, "metadata_only_access_limited":2,
    "method_source_locator_records":2, "method_status_records":len(methods),
    "method_acceptance_cases":len(criteria["independent_analytic_cases"]), "method_rejection_conditions":len(criteria["mandatory_rejections"]),
    "budget_bytes":60 * 1024 * 1024, "checks":checks, "errors":errors,
    "not_checked":["PDF content correctness beyond the file header", "tool implementation", "tool runtime outputs", "target-site or target-asset applicability", "legal approval"],
}
(REQ / "PUBLIC_SUPPLEMENT_CHECK_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status":result["status"], "checks":len(checks), "errors":len(errors)}, ensure_ascii=False))
sys.exit(0 if not errors else 1)
