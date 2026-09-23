"""Independently verify the prepared product-fact selection is pointer-bound and narrow."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = {
    "preparation_script": ROOT / "prepare_product_fact_selection.py",
    "prepared_facts": ROOT / "PREPARED_PRODUCT_FACTS.jsonl",
    "selection_manifest": ROOT / "PRODUCT_FACT_SELECTION.json",
    "model_facts": ROOT / "products/MODEL_FACTS.jsonl",
    "source_register": ROOT / "products/SOURCE_REGISTER.jsonl",
    "source_use_audit": ROOT / "audits/PRODUCT_SOURCE_USE_AUDIT.jsonl",
    "content_audit": ROOT / "existing/PRODUCTS_INDEPENDENT_AUDIT.json",
}
OUT = Path(__file__).resolve().parent / "PREPARED_SELECTION_AUDIT.json"
ALLOWED = "ALLOWED_CONDITIONAL_DERIVED_FACTS_ONLY"
BANNED_SOURCE_IDS = {"PROD-SRC-011", "PROD-SRC-R01", "PROD-SRC-R02"}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8-sig").splitlines() if x.strip()]


def main() -> None:
    prepared = jsonl(PATHS["prepared_facts"])
    models = jsonl(PATHS["model_facts"])
    sources = {x["source_id"]: x for x in jsonl(PATHS["source_register"])}
    uses = {x["source_id"]: x for x in jsonl(PATHS["source_use_audit"])}
    selection = json.loads(PATHS["selection_manifest"].read_text(encoding="utf-8-sig"))
    content_audit = json.loads(PATHS["content_audit"].read_text(encoding="utf-8-sig"))
    checks = []

    def check(name: str, passed: bool, evidence: object) -> None:
        checks.append({"check": name, "status": "PASS" if passed else "FAIL", "evidence": evidence})

    model_by_id = {x["record_id"]: x for x in models}
    prepared_by_id = {x["record_id"]: x for x in prepared}
    selected_ids = set(prepared_by_id)
    expected_ids = set(model_by_id) - {"MF-033", "MF-034"}
    check("record_selection_exact", selected_ids == expected_ids and len(prepared) == len(prepared_by_id) == 40,
          {"selected": len(prepared), "missing": sorted(expected_ids - selected_ids), "unexpected": sorted(selected_ids - expected_ids)})

    unequal = []
    extra_keys = []
    fact_mismatch = []
    for rid, row in prepared_by_id.items():
        stripped = dict(row)
        stripped.pop("preparation_binding", None)
        if stripped != model_by_id[rid]:
            unequal.append(rid)
        added = set(row) - set(model_by_id[rid])
        if added != {"preparation_binding"}:
            extra_keys.append({"record_id": rid, "added": sorted(added)})
        if row["facts"] != model_by_id[rid]["facts"]:
            fact_mismatch.append(rid)
    check("source_record_equality_except_preparation_binding", not unequal and not extra_keys,
          {"unequal_records": unequal, "unexpected_top_level_changes": extra_keys})
    check("all_fact_arrays_exactly_equal", not fact_mismatch,
          {"records_checked": len(prepared), "fact_fields": sum(len(x["facts"]) for x in prepared), "mismatches": fact_mismatch})

    check("counts_match_contract",
          len(prepared) == 40 and sum(x["identity_kind"] == "EXACT_MODEL" for x in prepared) == 32 and
          sum(x["identity_kind"] == "FAMILY" for x in prepared) == 8 and sum(len(x["facts"]) for x in prepared) == 164,
          {"records": len(prepared), "exact": sum(x["identity_kind"] == "EXACT_MODEL" for x in prepared),
           "family": sum(x["identity_kind"] == "FAMILY" for x in prepared), "facts": sum(len(x["facts"]) for x in prepared)})

    referenced = sorted({ref.split("#", 1)[0] for row in prepared for ref in row["source_refs"]})
    serialized = PATHS["prepared_facts"].read_text(encoding="utf-8-sig")
    check("restricted_and_failed_sources_absent",
          not (set(referenced) & BANNED_SOURCE_IDS) and "ULRI" not in serialized.upper() and "MOLICEL" not in serialized.upper(),
          {"referenced_sources": referenced, "banned_present": sorted(set(referenced) & BANNED_SOURCE_IDS),
           "ulri_present": "ULRI" in serialized.upper(), "molicel_present": "MOLICEL" in serialized.upper()})

    source_binding_failures = []
    for row in prepared:
        b = row["preparation_binding"]
        expected_source_ids = sorted({x.split("#", 1)[0] for x in row["source_refs"]})
        bound = {x["source_id"]: x for x in b["source_conditions"]}
        if sorted(bound) != expected_source_ids:
            source_binding_failures.append({"record_id": row["record_id"], "issue": "source_set", "expected": expected_source_ids, "actual": sorted(bound)})
        for sid in expected_source_ids:
            if (bound[sid]["action_status"] != ALLOWED or uses[sid]["future_local_structured_fact_query"] != ALLOWED or
                    bound[sid]["sha256"] != sources[sid]["sha256"] or sha(Path(sources[sid]["local_path"])) != sources[sid]["sha256"]):
                source_binding_failures.append({"record_id": row["record_id"], "source_id": sid, "issue": "status_or_hash"})
    check("every_selected_source_allowed_and_hash_current", not source_binding_failures,
          {"selected_source_count": len(referenced), "required_status": ALLOWED, "failures": source_binding_failures})

    binding_failures = []
    for row in prepared:
        b = row["preparation_binding"]
        if not (b["status"] == "PREPARED_NOT_INGESTED" and
                b["permitted_future_action"] == "CONDITIONAL_LOCAL_STRUCTURED_FACT_QUERY_ONLY" and
                b["model_record_file_sha256"] == sha(PATHS["model_facts"]) and
                b["content_audit_sha256"] == sha(PATHS["content_audit"]) and
                b["source_use_audit_sha256"] == sha(PATHS["source_use_audit"]) and
                "not authorized" in b["other_actions"].lower() and
                all(term in b["other_actions"].lower() for term in ("rag", "training", "server transfer"))):
            binding_failures.append(row["record_id"])
    check("preparation_does_not_upgrade_other_permissions", not binding_failures,
          {"failures": binding_failures, "permitted_action": "CONDITIONAL_LOCAL_STRUCTURED_FACT_QUERY_ONLY"})

    source_policy_failures = []
    for sid in referenced:
        u = uses[sid]
        raw_status = u.get("raw_text_rag", "").upper()
        training_status = u.get("training", "").upper()
        if not any(term in raw_status for term in ("NOT_AUTHORIZED", "NOT_ADMITTED", "BLOCKED", "DENIED")) or raw_status.startswith("ALLOWED"):
            source_policy_failures.append({"source_id": sid, "field": "raw_text_rag", "value": u.get("raw_text_rag")})
        if not any(term in training_status for term in ("NOT_AUTHORIZED", "NOT_ADMITTED", "BLOCKED", "DENIED", "PROHIBITED")) or training_status.startswith("ALLOWED"):
            source_policy_failures.append({"source_id": sid, "field": "training", "value": u.get("training")})
    check("source_use_rows_do_not_authorize_rag_or_training", not source_policy_failures, source_policy_failures)

    manifest_inputs = {str(Path(x["path"])): x["sha256"] for x in selection["inputs"]}
    manifest_ok = all(sha(Path(p)) == h for p, h in manifest_inputs.items()) and selection["output"]["sha256"] == sha(PATHS["prepared_facts"])
    excluded = {x["record_id"] for x in selection["excluded_records"]}
    check("selection_manifest_hashes_and_exclusions_current",
          manifest_ok and excluded == {"MF-033", "MF-034"} and selection["status"] == "PREPARED_NOT_INGESTED",
          {"manifest_hashes_current": manifest_ok, "excluded": sorted(excluded), "status": selection["status"]})
    check("content_audit_binding_current_and_passed",
          content_audit["status"] == "PASSED" and sha(PATHS["content_audit"]) == prepared[0]["preparation_binding"]["content_audit_sha256"],
          {"status": content_audit["status"], "sha256": sha(PATHS["content_audit"])})

    status = "PASSED" if all(x["status"] == "PASS" for x in checks) else "FAILED"
    output = {
        "audit": "PREPARED_PRODUCT_FACT_SELECTION_INDEPENDENT_AUDIT",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "input_bindings": [{"path": str(path.resolve()), "sha256": sha(path)} for path in PATHS.values()],
        "counts": {"input_records": len(models), "selected_records": len(prepared),
                   "selected_exact_labels": sum(x["identity_kind"] == "EXACT_MODEL" for x in prepared),
                   "selected_family_records": sum(x["identity_kind"] == "FAMILY" for x in prepared),
                   "selected_fact_fields": sum(len(x["facts"]) for x in prepared),
                   "selected_sources": len(referenced)},
        "checks": checks,
        "conclusion": "Prepared rows equal the independently audited product records except for preparation_binding; only conditional local structured-fact query is prepared, with no raw-text RAG, training, redistribution or server-transfer grant.",
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": status, "checks": len(checks), **output["counts"]}, ensure_ascii=False))
    if status != "PASSED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
