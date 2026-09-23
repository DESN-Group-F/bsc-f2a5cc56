import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
OUT = RUN / "audits/final_build_usability"

def rows(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

decisions = rows(OUT / "BUILD_USE_DECISIONS.jsonl")
not_selected = rows(OUT / "NOT_SELECTED_BUILD_INPUTS.jsonl")
readiness = rows(RUN / "documents/SUPPLEMENT_READINESS.jsonl")
allowed = [d for d in decisions if d.get("status") == "ALLOWED_CONDITIONAL"]
partial = [d for d in decisions if d.get("status") == "PARTIAL_ACTION_SPLIT"]
denied = [d for d in decisions if d.get("status") == "NOT_ALLOWED_FOR_LOCAL_RAG"]

def unique_payload(group, field):
    return {(x.get("file_id") or x.get("supplement_id"), x.get("sha256") or x.get("input_sha256"))
            for d in group for x in d.get(field, [])}

af, pf, df = (unique_payload(g, "exact_files") for g in (allowed, partial, denied))
asup, dsup = (unique_payload(g, "exact_supplements") for g in (allowed, denied))
counts = {
    "domains": 9,
    "build_use_decisions": len(decisions),
    "domains_with_minimum_set": 9,
    "explicit_restriction_decisions": len(denied),
    "allowed_exact_files": len(af),
    "partial_action_exact_files": len(pf),
    "denied_exact_files": len(df),
    "not_selected_files": len(not_selected),
    "not_selected_blocking_candidates": sum(bool(x.get("blocking")) for x in not_selected),
    "all_exact_file_bindings_including_denied": len(af | pf | df),
    "selected_exact_file_bindings_allowed_or_partial": len(af | pf),
    "allowed_exact_supplements": len(asup),
    "denied_exact_supplements": len(dsup),
    "all_exact_supplement_bindings_including_denied": len(asup | dsup),
    "document_supplement_readiness_objects": len(readiness),
}
checks = {
    "original_partition_is_300": counts["allowed_exact_files"] + counts["partial_action_exact_files"] + counts["denied_exact_files"] + counts["not_selected_files"] == 300,
    "file_decision_sets_disjoint": not (af & pf or af & df or pf & df),
    "supplement_allow_deny_disjoint": not (asup & dsup),
    "no_not_selected_blocker": counts["not_selected_blocking_candidates"] == 0,
    "document_readiness_is_21": len(readiness) == 21,
}
check_path = OUT / "CHECK_RESULTS.json"
result = json.loads(check_path.read_text(encoding="utf-8"))
result["counts"] = counts
result["final_count_checks"] = checks
result["status"] = "PASS_WITH_CONDITIONS" if all(checks.values()) else "FAIL"
result["recompute_command"] = str(Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe")) + " -B " + str(Path(__file__))
check_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": result["status"], "counts": counts, "checks": checks}, ensure_ascii=True))
