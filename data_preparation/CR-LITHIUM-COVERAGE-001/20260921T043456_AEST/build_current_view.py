"""Build a pointer-only current lithium identity view from audited lane outputs.

No raw payload access, networking, model invocation or database ingestion.
Records keep source-specific facts/limits in the author files. A joined identity
does not imply that facts, versions, applicability or source-use grants merge.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INPUTS = {
    "existing": ROOT / "existing/MODEL_EVIDENCE.jsonl",
    "products": ROOT / "products/MODEL_FACTS.jsonl",
}
# Reviewed, explicit joins; do not fuzzy-match model prefixes, capacities,
# sample IDs, company successors or punctuation across arbitrary products.
JOINS = {
    ("products", "MF-033"): ("existing", "EXIST-MOLI-INR-21700-P42A"),
    ("products", "MF-034"): ("existing", "EXIST-MOLI-INR21700-P45B"),
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build() -> None:
    inputs, records, by_id = [], [], {}
    for lane, path in INPUTS.items():
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
        inputs.append({"lane": lane, "path": str(path), "sha256": sha(path), "records": len(rows)})
        for row in rows:
            key = (lane, row["record_id"])
            assert key not in by_id, f"Duplicate evidence ID: {key}"
            by_id[key] = row
            records.append((key, row))

    for child, parent in JOINS.items():
        assert child in by_id and parent in by_id, f"Missing explicit join: {child}, {parent}"
        a, b = by_id[child], by_id[parent]
        assert a["manufacturer"] == b["manufacturer"], "Explicit join manufacturer mismatch"
        assert a["identity_kind"] == b["identity_kind"] == "EXACT_MODEL"
        assert a["model_label"] == b["model_label"], "Explicit join labels changed: review required"

    groups = {}
    for key, row in records:
        parent = JOINS.get(key, key)
        identity = by_id[parent]
        group = groups.setdefault(parent, {
            "identity_id": f"LITHIUM::{parent[0]}::{parent[1]}",
            "manufacturer": identity["manufacturer"],
            "model_label": identity["model_label"],
            "identity_kind": identity["identity_kind"],
            "canonical_identity_as_recorded": identity["canonical_identity"],
            "manufacturer_identified": identity["manufacturer"] not in ("UNKNOWN", "", None),
            "identity_join_basis": "EXPLICIT_SAME_MANUFACTURER_AND_COMPLETE_LABEL" if parent in JOINS.values() else "NO_CROSS_RECORD_ALIAS_MERGE",
            "evidence_records": [],
            "use_policy": "RESOLVE_EACH_EVIDENCE_SOURCE_AND_ACTION; THIS_IDENTITY_INDEX_IS_NOT_AN_INGESTION_ALLOWLIST",
        })
        group["evidence_records"].append({
            "lane": key[0], "record_id": key[1],
            "record_ref": f"{INPUTS[key[0]]}#record_id={key[1]}",
            "input_sha256": next(i["sha256"] for i in inputs if i["lane"] == key[0]),
            "document_version": row["document_version"],
            "chemistry_as_recorded": row["chemistry"],
            "form_factor_as_recorded": row["form_factor"],
            "system_level_as_recorded": row["system_level"],
            "content_depth": row["content_depth"],
            "fact_count": len(row["facts"]),
            "use_status_as_recorded": row["use_status"],
            "conditions_and_limits": row["conditions_and_limits"],
            "remaining_gaps": row["remaining_gaps"],
            "source_refs": row["source_refs"],
        })

    view = sorted(groups.values(), key=lambda r: (r["identity_kind"], r["manufacturer"], r["model_label"]))
    exact = [r for r in view if r["identity_kind"] == "EXACT_MODEL"]
    new_exact = [r for r in exact if all(e["lane"] == "products" for e in r["evidence_records"])]
    exact_known = [r for r in exact if r["manufacturer_identified"]]
    old_rows = [r for (lane, _), r in records if lane == "existing"]
    product_rows = [r for (lane, _), r in records if lane == "products"]
    stats = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "input_bindings": inputs,
        "status": "CURRENT_POINTER_VIEW; FINAL_ACCEPTANCE_REQUIRES_ROOT_DECISION_AND_MATCHING_AUDITS",
        "evidence_records": len(records),
        "identity_groups": len(view),
        "groups_by_identity_kind": dict(sorted(Counter(r["identity_kind"] for r in view).items())),
        "explicit_cross_lane_joins": len(JOINS),
        "exact_product_labels_total": len(exact),
        "exact_labels_with_manufacturer": len(exact_known),
        "exact_labels_unknown_manufacturer": len(exact) - len(exact_known),
        "known_manufacturers_with_exact_labels": sorted({r["manufacturer"] for r in exact_known}),
        "new_exact_labels_from_products": len(new_exact),
        "existing_identity_kinds": dict(sorted(Counter(r["identity_kind"] for r in old_rows).items())),
        "products_identity_kinds": dict(sorted(Counter(r["identity_kind"] for r in product_rows).items())),
        "exact_labels_by_manufacturer": dict(sorted(Counter(r["manufacturer"] for r in exact).items())),
        "limits": [
            "Exact labels include cells, modules and system products; they are not all cell models.",
            "Manufacturer UNKNOWN is not a fully identified manufacturer/model pair.",
            "Manufacturer labels are preserved as stated by sources, not deduplicated corporate groups or legal entities.",
            "SAMPLE_ID, SERIES and FAMILY are excluded from the exact-label count.",
            "Source-specific fact counts are not a deduplicated measurement or parameter total.",
            "No market denominator, current availability or market coverage percentage is established.",
            "The merged identity view neither upgrades use grants nor selects a current operating limit.",
        ],
    }
    output = ROOT / "CURRENT_MODEL_INDEX.jsonl"
    output.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in view), encoding="utf-8")
    stats["current_model_index_sha256"] = sha(output)
    write_json(ROOT / "CURRENT_COVERAGE_COUNTS.json", stats)
    print(json.dumps({k: stats[k] for k in ("evidence_records", "identity_groups", "exact_product_labels_total", "exact_labels_with_manufacturer", "new_exact_labels_from_products")}, ensure_ascii=False))


if __name__ == "__main__":
    build()
