"""Independent structural and semantic audit of the root current pointer view."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXISTING = ROOT / "existing/MODEL_EVIDENCE.jsonl"
PRODUCTS = ROOT / "products/MODEL_FACTS.jsonl"
INDEX = ROOT / "CURRENT_MODEL_INDEX.jsonl"
COUNTS = ROOT / "CURRENT_COVERAGE_COUNTS.json"
BUILDER = ROOT / "build_current_view.py"
OUT = Path(__file__).resolve().parent / "CURRENT_VIEW_AUDIT.json"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rows(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8-sig").splitlines() if x.strip()]


def main() -> None:
    existing, products, index = rows(EXISTING), rows(PRODUCTS), rows(INDEX)
    counts = json.loads(COUNTS.read_text(encoding="utf-8-sig"))
    checks = []
    def check(name: str, ok: bool, evidence: object) -> None:
        checks.append({"check": name, "status": "PASS" if ok else "FAIL", "evidence": evidence})

    bindings = {x["lane"]: x for x in counts["input_bindings"]}
    check("input_hash_bindings_current",
          bindings["existing"]["sha256"] == sha(EXISTING) and bindings["products"]["sha256"] == sha(PRODUCTS),
          {"existing": sha(EXISTING), "products": sha(PRODUCTS)})
    check("output_hash_binding_current", counts["current_model_index_sha256"] == sha(INDEX), sha(INDEX))
    check("only_two_explicit_cross_lane_joins", counts["explicit_cross_lane_joins"] == 2 and sum(len(x["evidence_records"]) == 2 for x in index) == 2,
          [x["model_label"] for x in index if len(x["evidence_records"]) == 2])
    joined = {x["model_label"]: x for x in index if len(x["evidence_records"]) == 2}
    check("joins_limited_to_same_manufacturer_complete_label",
          set(joined) == {"INR-21700-P42A", "INR21700-P45B"} and all(x["manufacturer"] == "E-One Moli Energy / Molicel" for x in joined.values()),
          {k: [(e["lane"], e["record_id"]) for e in v["evidence_records"]] for k, v in joined.items()})
    check("no_values_or_versions_selected_or_merged",
          all("facts" not in x and all("fact_count" in e and "document_version" in e for e in x["evidence_records"]) for x in index),
          "Index keeps per-evidence document_version/fact_count pointers and contains no selected fact payload.")
    check("use_not_upgraded",
          all(x["use_policy"].startswith("RESOLVE_EACH_EVIDENCE_SOURCE_AND_ACTION") and all("use_status_as_recorded" in e for e in x["evidence_records"]) for x in index),
          "Every group retains source-record use status and pointer-only policy.")
    sample_groups = [x for x in index if x["identity_kind"] == "SAMPLE_ID"]
    check("research_samples_excluded_from_exact_count", len(sample_groups) == 248 and counts["exact_product_labels_total"] == sum(x["identity_kind"] == "EXACT_MODEL" for x in index),
          {"sample_groups": len(sample_groups), "exact_groups": counts["exact_product_labels_total"]})
    unknown = [x for x in index if x["identity_kind"] == "EXACT_MODEL" and not x["manufacturer_identified"]]
    check("unknown_manufacturer_remains_separate", len(unknown) == 1 and len(unknown[0]["evidence_records"]) == 1,
          [(x["model_label"], x["identity_id"]) for x in unknown])
    check("all_nonjoined_records_remain_separate",
          len(index) == len(existing) + len(products) - 2 and sum(len(x["evidence_records"]) for x in index) == len(existing) + len(products),
          {"groups": len(index), "evidence_records": sum(len(x["evidence_records"]) for x in index)})
    check("module_and_rack_labels_not_misrepresented_as_cell_models",
          "Exact labels include cells, modules and system products; they are not all cell models." in counts["limits"],
          counts["limits"][0])

    status = "PASSED" if all(x["status"] == "PASS" for x in checks) else "FAILED"
    result = {
        "audit": "CURRENT_POINTER_VIEW_INDEPENDENT_AUDIT",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "conclusion": "The merge is limited to the two explicit same-manufacturer, same-complete-label Molicel links. It preserves source versions, facts, use statuses and unknown-manufacturer separation; SAMPLE_ID records remain outside exact-model counts.",
        "input_bindings": {
            "existing_model_evidence_sha256": sha(EXISTING),
            "products_model_facts_sha256": sha(PRODUCTS),
            "current_model_index_sha256": sha(INDEX),
            "current_coverage_counts_sha256": sha(COUNTS),
            "builder_sha256": sha(BUILDER),
        },
        "checks": checks,
        "limits": [
            "This audit validates explicit identity-pointer grouping, not market completeness.",
            "Exact groups include module and rack product codes as well as cell models.",
            "A joined identity does not combine operating values, document versions or permissions.",
        ],
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": status, "checks": len(checks), "failed": sum(x["status"] == "FAIL" for x in checks)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
