"""Build metadata-only current indexes; preserve every frozen input and source.

This checks integration/provenance, not scientific or case applicability.
Only the exact 16 reviewed source files are rehashed. No dataset archive is read.
"""
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OLD = ROOT.parent.parent / "CR-DATA-READY-001" / "20260920T012405_AEST"
LANES = {"review_a": "review_a85", "review_b": "review_b64", "review_restricted": "review_restricted58"}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def save_json(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save_rows(name, rows):
    (ROOT / name).write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows), encoding="utf-8")


def ref(path, key, value):
    return path.as_posix() + "#" + key + "=" + value


def main():
    scope = read_rows(ROOT / "CANDIDATE_SCOPE.jsonl")
    sources = read_rows(ROOT / "SOURCE_SCOPE.jsonl")
    frozen = read_rows(OLD / "documents" / "FACT_CANDIDATES.jsonl")
    prior = read_rows(OLD / "documents" / "VERIFIED_FACTS.jsonl")
    original_all = read_rows(OLD / "documents" / "REVIEWED_FACT_ASSERTIONS.jsonl")
    build = {x["file_id"]: x for x in read_rows(OLD / "BUILD_USE_INDEX.jsonl")}
    sources_by_id = {x["file_id"]: x for x in sources}
    scope_by_id = {x["fact_id"]: x for x in scope}
    frozen_by_id = {x["fact_id"]: x for x in frozen}
    prior_by_id = {x["fact_id"]: x for x in prior}
    checks = {}
    checks["frozen_207_input_unchanged"] = sha(OLD / "documents" / "FACT_CANDIDATES.jsonl") == read_json(ROOT / "SCOPE.json")["original_candidate_sha256"]
    checks["exact_scope_207_from_16_files"] = len(scope) == len(scope_by_id) == 207 and len(sources_by_id) == len(sources) == 16 and set(scope_by_id) == set(frozen_by_id)
    checks["prior_466_and_207_are_disjoint_complete_673"] = len(prior) == len(prior_by_id) == 466 and not set(prior_by_id) & set(frozen_by_id) and len(original_all) == 673 and set(prior_by_id) | set(frozen_by_id) == {x["fact_id"] for x in original_all}

    source_checks = []
    for s in sources:
        source = s["source"]
        path = Path(source["input_path"])
        observed_sha = sha(path)
        source_checks.append({"file_id": s["file_id"], "input_path": path.as_posix(), "registered_sha256": source["registered_sha256"], "observed_sha256": observed_sha, "observed_bytes": path.stat().st_size, "matches_registered_sha256": observed_sha == source["registered_sha256"], "scope": "Only this exact registered file was read; no source writes."})
    checks["all_16_source_identities_match"] = all(x["matches_registered_sha256"] for x in source_checks)
    save_rows("SOURCE_IDENTITY_CHECKS.jsonl", source_checks)

    new_index = []
    audit_info = {}
    for lane, audit_name in LANES.items():
        result_path = ROOT / lane / "REVIEW_RESULTS.jsonl"
        rows = read_rows(result_path)
        own_check = read_json(ROOT / lane / "CHECK_RESULTS.json")
        audit_path = ROOT / "audits" / audit_name
        audit = read_json(audit_path / "CHECK_RESULTS.json")
        audited = read_rows(audit_path / "ITEM_AUDIT.jsonl")
        expected_ids = {x["fact_id"] for x in scope if x["lane"] == lane}
        result_sha = sha(result_path)
        audit_info[lane] = {"review_results_sha256": result_sha, "audit_input_sha256": audit.get("input_review_results_sha256"), "audit_status": audit["status"], "items": len(rows), "audit_ref": (audit_path / "CHECK_RESULTS.json").as_posix()}
        checks[lane + "_exact_unique_ids"] = len(rows) == len(expected_ids) and {x["fact_id"] for x in rows} == expected_ids
        checks[lane + "_author_check_pass"] = own_check["status"] == "PASS"
        checks[lane + "_independent_audit_exact_ids"] = len(audited) == len(expected_ids) and {x["fact_id"] for x in audited} == expected_ids
        checks[lane + "_independent_audit_pass_on_current_bytes"] = audit["status"] == "PASS" and audit.get("input_review_results_sha256") == result_sha and all(x["status"] == "PASS" for x in audited)
        checks[lane + "_bindings_and_use_preserved"] = all(
            x["file_id"] == frozen_by_id[x["fact_id"]]["file_id"]
            and x["source_id"] == frozen_by_id[x["fact_id"]]["source_id"]
            and x["original_locator"] == frozen_by_id[x["fact_id"]]["locator"]
            and x["current_build_use_status"] == sources_by_id[x["file_id"]]["build_use"]["build_use_status"]
            for x in rows
        )
        checks[lane + "_no_empty_resolution"] = all(x.get("evidence_refs") and x.get("reason") and x.get("context_findings") and x.get("original_unknown_resolution") and x["review_status"] in ["RESOLVED", "UNRESOLVED"] and (x["review_status"] != "RESOLVED" or not x["remaining_unknowns"]) for x in rows)
        missing_refs = []
        for x in rows:
            for evidence in x["evidence_refs"]:
                base = evidence.split("#", 1)[0]
                if not Path(base).is_file():
                    missing_refs.append({"fact_id": x["fact_id"], "ref": evidence})
            ready = x["parameter_record_ready"]
            new_index.append({
                "fact_id": x["fact_id"], "file_id": x["file_id"], "source_id": x["source_id"],
                "original_locator": x["original_locator"], "lane": lane,
                "original_unknowns": frozen_by_id[x["fact_id"]]["unknowns"],
                "current_review_status": x["review_status"], "semantic_role": x["semantic_role"],
                "parameter_record_ready": ready,
                "structured_interface_record_ready": x.get("structured_interface_record_ready", False),
                "structured_reference_record_ready": x.get("structured_reference_record_ready", False),
                "structured_code_record_ready": x.get("structured_code_record_ready", False),
                "current_build_use_status": x["current_build_use_status"],
                "record_use_note": "Source/context completeness only; use authorization and target-case applicability remain separate.",
                "source_registered_sha256": sources_by_id[x["file_id"]]["source"]["registered_sha256"],
                "review_ref": ref(result_path, "fact_id", x["fact_id"]),
                "independent_audit_ref": ref(audit_path / "ITEM_AUDIT.jsonl", "fact_id", x["fact_id"]),
                "original_candidate_ref": ref(OLD / "documents" / "FACT_CANDIDATES.jsonl", "fact_id", x["fact_id"]),
                "remaining_unknowns": x["remaining_unknowns"],
            })
        checks[lane + "_evidence_file_paths_exist"] = not missing_refs
        audit_info[lane]["missing_evidence_refs"] = missing_refs

    new_index.sort(key=lambda x: x["fact_id"])
    checks["207_final_index_exact_unique_ids"] = len(new_index) == 207 and {x["fact_id"] for x in new_index} == set(frozen_by_id)
    save_rows("CANDIDATE_REVIEW_INDEX.jsonl", new_index)
    save_rows("UNRESOLVED_CANDIDATES.jsonl", [x for x in new_index if x["current_review_status"] != "RESOLVED"])
    by_id = {x["fact_id"]: x for x in new_index}
    current = []
    for original in original_all:
        fact_id = original["fact_id"]
        if fact_id in by_id:
            row = dict(by_id[fact_id])
            row["reviewed_in_this_run"] = True
        else:
            row = {
                "fact_id": fact_id, "file_id": original["file_id"], "source_id": original["source_id"],
                "original_locator": original["locator"],
                "current_review_status": "LEGACY_SOURCE_ASSERTION_CHECKED_NOT_REAUDITED_THIS_RUN",
                "legacy_verification_status": original["verification_status"],
                "semantic_role": original["semantic_class"], "parameter_record_ready": None,
                "current_build_use_status": build[original["file_id"]]["build_use_status"],
                "reviewed_in_this_run": False,
                "review_ref": ref(OLD / "documents" / "VERIFIED_FACTS.jsonl", "fact_id", fact_id),
                "record_use_note": "Preserves previous source-assertion review. This run does not certify these 466 as engineering parameters or perform full semantic re-audit.",
            }
        current.append(row)
    save_rows("CURRENT_FACT_INDEX.jsonl", current)

    # Narrow regression for the two newly confirmed parser-error families only.
    patterns = {"rst_scale_percent": r":scale:\s*\d+(?:\.\d+)?\s*%", "can_hex_230h_231h": r"\b(?:230h|231h)\b"}
    regression = {name: [x["fact_id"] for x in prior if re.search(pattern, x.get("source_literal", ""), re.I)] for name, pattern in patterns.items()}
    save_json("ROOT_TARGETED_REGRESSION.json", {"status": "NO_MATCHES_IN_LIMITED_CHECK" if not any(regression.values()) else "MATCHES_REQUIRE_REVIEW", "input": (OLD / "documents" / "VERIFIED_FACTS.jsonl").as_posix(), "records": 466, "patterns": patterns, "matching_fact_ids": regression, "limitation": "Two known parser-error families only; not a full content, unit, table, or semantic re-audit of the 466 prior records."})
    checks["targeted_legacy_regression_no_matches"] = not any(regression.values())

    counts = {
        "original_files_not_records": 300, "numeric_assertion_records": len(original_all),
        "legacy_records_not_reaudited_this_run": len(prior), "candidate_records_reviewed": len(new_index),
        "resolved": sum(x["current_review_status"] == "RESOLVED" for x in new_index),
        "unresolved": sum(x["current_review_status"] != "RESOLVED" for x in new_index),
        "source_bound_parameter_or_rule_records": sum(x["parameter_record_ready"] for x in new_index),
        "other_semantic_roles": sum(not x["parameter_record_ready"] for x in new_index),
        "by_role": dict(Counter(x["semantic_role"] for x in new_index)),
        "by_build_use": dict(Counter(x["current_build_use_status"] for x in new_index)),
        "parameter_or_rule_records_by_build_use": dict(Counter(x["current_build_use_status"] for x in new_index if x["parameter_record_ready"])),
        "source_identity_files_checked": len(source_checks),
        "source_identity_bytes_read": sum(x["observed_bytes"] for x in source_checks),
    }
    inputs = [ROOT / "CANDIDATE_SCOPE.jsonl", ROOT / "SOURCE_SCOPE.jsonl", OLD / "documents" / "FACT_CANDIDATES.jsonl", OLD / "documents" / "VERIFIED_FACTS.jsonl", OLD / "documents" / "REVIEWED_FACT_ASSERTIONS.jsonl", OLD / "BUILD_USE_INDEX.jsonl"]
    result = {"status": "PASS" if all(checks.values()) else "FAIL", "generated_at_utc": datetime.now(timezone.utc).isoformat(), "checks": checks, "counts": counts, "lane_audits": audit_info, "input_hashes": {x.as_posix(): sha(x) for x in inputs}, "command": "python -B " + str(Path(__file__).resolve()), "acceptance_status": "ROOT_DECISION_REQUIRED_AFTER_INDEPENDENT_INTEGRATION_AUDIT", "not_claimed": ["All 673 are usable numerical parameters", "All 207 may enter RAG", "Current transport/certification validity", "Applicability to a target case or UNSW", "Completion of the separate copy-controlled source summary", "RAG/database/model implementation"]}
    save_json("ROOT_CHECK_RESULTS.json", result)
    print(json.dumps({"status": result["status"], "counts": counts, "failed_checks": [k for k, v in checks.items() if not v]}, ensure_ascii=True))
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
