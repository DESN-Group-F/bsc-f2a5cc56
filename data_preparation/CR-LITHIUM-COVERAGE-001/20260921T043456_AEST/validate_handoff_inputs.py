"""Read-only integrity checks for this bounded preparation run; no source scan."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def obj(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))


def rows(relative):
    return [json.loads(s) for s in (ROOT / relative).read_text(encoding="utf-8-sig").splitlines() if s.strip()]


def main():
    checks = []

    def add(name, ok, details):
        checks.append({"check": name, "status": "PASS" if ok else "FAIL", "details": details})

    baseline = obj("BASELINE_INPUTS.json")
    results = [{"path": i["path"], "unchanged": Path(i["path"]).stat().st_size == i["bytes"] and sha(i["path"]) == i["sha256"]} for i in baseline["inputs"]]
    add("nine_pinned_previous_run_inputs_unchanged", len(results) == 9 and all(r["unchanged"] for r in results), results)

    current = rows("CURRENT_MODEL_INDEX.jsonl")
    counts = obj("CURRENT_COVERAGE_COUNTS.json")
    inputs = {"existing": rows("existing/MODEL_EVIDENCE.jsonl"), "products": rows("products/MODEL_FACTS.jsonl")}
    expected = Counter((lane, r["record_id"]) for lane, rr in inputs.items() for r in rr)
    actual = Counter((e["lane"], e["record_id"]) for r in current for e in r["evidence_records"])
    add("every_evidence_record_represented_once", actual == expected, {"input_records": sum(expected.values()), "pointer_records": sum(actual.values())})
    current_by_id = {(lane, r["record_id"]): r for lane, rr in inputs.items() for r in rr}
    kinds_ok = all(r["identity_kind"] == current_by_id[e["lane"], e["record_id"]]["identity_kind"] for r in current for e in r["evidence_records"])
    add("identity_roles_not_promoted_in_current_view", kinds_ok, dict(Counter(r["identity_kind"] for r in current)))
    hash_ok = counts["current_model_index_sha256"] == sha(ROOT / "CURRENT_MODEL_INDEX.jsonl") and all(sha(i["path"]) == i["sha256"] for i in counts["input_bindings"])
    add("current_view_input_and_output_hashes", hash_ok, counts["input_bindings"])
    exact = [r for r in current if r["identity_kind"] == "EXACT_MODEL"]
    add("exact_label_count_excludes_other_roles", len(exact) == counts["exact_product_labels_total"] and sum(r["manufacturer_identified"] for r in exact) == counts["exact_labels_with_manufacturer"], {"exact_labels": len(exact), "known_manufacturer_pairs": sum(r["manufacturer_identified"] for r in exact)})

    a = obj("audits/EXISTING_CHECK_RESULTS.json")
    ok = a["status"] == "PASSED" and a["input_sha256"] == sha(ROOT / "existing/MODEL_EVIDENCE.jsonl") and a["records_checked"] == len(inputs["existing"]) and a["records_failed"] == 0
    add("independent_existing_audit_complete_and_current", ok, {"status": a["status"], "records_checked": a["records_checked"], "input_sha256": a["input_sha256"]})
    a = obj("existing/PRODUCTS_INDEPENDENT_AUDIT.json")
    bound = a["input_bindings"]
    bindings = {k: sha(v["path"]) == v["sha256"] for k, v in bound.items() if isinstance(v, dict) and "path" in v and "sha256" in v}
    add("independent_product_audit_passed_and_current", a["status"] == "PASSED" and all(bindings.values()), {"status": a["status"], "bindings": bindings})
    a = obj("existing/CURRENT_VIEW_AUDIT.json")
    paths = {
        "existing_model_evidence_sha256": "existing/MODEL_EVIDENCE.jsonl",
        "products_model_facts_sha256": "products/MODEL_FACTS.jsonl",
        "current_model_index_sha256": "CURRENT_MODEL_INDEX.jsonl",
        "current_coverage_counts_sha256": "CURRENT_COVERAGE_COUNTS.json",
        "builder_sha256": "build_current_view.py",
    }
    matches = {key: a["input_bindings"].get(key) == sha(ROOT / path) for key, path in paths.items()}
    add("independent_current_view_audit_passed_and_current", a["status"] == "PASSED" and all(matches.values()), {"status": a["status"], "bindings": matches})

    requirements = rows("scope/REQUIREMENT_MATRIX.jsonl")
    statuses = rows("scope/REQUIREMENT_STATUS_MATRIX.jsonl")
    add("all_29_registered_requirements_accounted_for", len(requirements) == 29 and Counter(r["requirement_id"] for r in requirements) == Counter(r["requirement_id"] for r in statuses), {"requirements": len(requirements), "statuses": len(statuses)})
    missing = []
    for r in statuses:
        for field, lane in (("product_record_ids", "products"), ("existing_record_ids", "existing")):
            if field not in r:
                missing.append(f"{r['requirement_id']}: missing {field}")
            for record_id in r.get(field, []):
                if (lane, record_id) not in current_by_id:
                    missing.append(f"{r['requirement_id']}: {record_id}")
        if "BG-SYSTEM-02" in r.get("background_evidence", []):
            missing.append(f"{r['requirement_id']}: excluded ULRI evidence used")
    add("coverage_references_resolve_and_excluded_source_unused", not missing, missing)

    sources = rows("products/SOURCE_REGISTER.jsonl")
    acquired = [s for s in sources if str(s.get("status", "")).startswith("ACQUIRED")]
    source_results = [{"source_id": s["source_id"], "hash_matches": sha(s["local_path"]) == s["sha256"], "bytes_match": Path(s["local_path"]).stat().st_size == s["bytes"]} for s in acquired]
    add("new_product_source_versions_match_registry", len(source_results) > 0 and all(s["hash_matches"] and s["bytes_match"] for s in source_results), source_results)
    product_use = obj("audits/PRODUCT_CHECK_RESULTS.json")
    use_paths = {"model_facts_sha256": "products/MODEL_FACTS.jsonl", "source_register_sha256": "products/SOURCE_REGISTER.jsonl", "source_use_audit_sha256": "audits/PRODUCT_SOURCE_USE_AUDIT.jsonl"}
    use_matches = {key: product_use["input_bindings"].get(key) == sha(ROOT / path) for key, path in use_paths.items()}
    add("independent_product_source_action_audit_current", product_use["status"] == "PASSED" and product_use["records_checked"] == len(inputs["products"]) and all(use_matches.values()), use_matches)
    background_audit = obj("products/SCOPE_BACKGROUND_CROSS_AUDIT.json")
    background_bindings = [{"path": b["path"], "matches": sha(b["path"]) == b["sha256"]} for b in background_audit["input_bindings"]]
    add("independent_background_audit_current", background_audit["status"] == "PASS_WITH_EXPLICIT_EXCLUSION" and len(background_bindings) > 0 and all(b["matches"] for b in background_bindings), background_bindings)
    selection = obj("PRODUCT_FACT_SELECTION.json")
    prepared = rows("PREPARED_PRODUCT_FACTS.jsonl")
    selection_ids = {r["record_id"] for r in prepared}
    eligible = set(product_use["future_prepared_facts_eligible_records"])
    selection_current = sha(selection["output"]["path"]) == selection["output"]["sha256"] and all(sha(i["path"]) == i["sha256"] for i in selection["inputs"])
    add("prepared_selection_equals_independently_admitted_record_set", selection_current and selection_ids == eligible and len(selection_ids) == len(prepared), {"records": len(prepared), "fact_fields": sum(len(r["facts"]) for r in prepared), "exact_labels": sum(r["identity_kind"] == "EXACT_MODEL" for r in prepared)})
    prepared_audit = obj("existing/PREPARED_SELECTION_AUDIT.json")
    prepared_matches = [{"path": b["path"], "matches": sha(b["path"]) == b["sha256"]} for b in prepared_audit["input_bindings"]]
    add("independent_prepared_selection_audit_current", prepared_audit["status"] == "PASSED" and len(prepared_matches) > 0 and all(b["matches"] for b in prepared_matches), prepared_matches)
    incident = obj("audits/ULRI_ACTION_INCIDENT.json")
    snapshot = ROOT / incident["snapshot"]["path"]
    add("excluded_snapshot_retained_only_in_audit_quarantine", snapshot.is_file() and "quarantine" in snapshot.parts and sha(snapshot) == incident["snapshot"]["sha256"], {"path": str(snapshot), "status": incident["status"]})

    result = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "PASSED" if all(c["status"] == "PASS" for c in checks) else "FAILED",
        "scope": "Current pointers, independent content/source-action/background/selection audit freshness, 29 requirement references, new product object hashes and nine small prior-run input hashes. Not a content re-audit or model/server test.",
        "checks": checks,
    }
    (ROOT / "CHECK_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "checks": len(checks), "failed": [c["check"] for c in checks if c["status"] == "FAIL"]}))
    raise SystemExit(0 if result["status"] == "PASSED" else 1)


if __name__ == "__main__":
    main()
