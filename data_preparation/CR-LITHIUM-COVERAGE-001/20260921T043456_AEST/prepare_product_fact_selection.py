"""Prepare source-reviewed factual rows, without database/RAG ingestion."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALLOWED = "ALLOWED_CONDITIONAL_DERIVED_FACTS_ONLY"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_rows(path):
    return [json.loads(s) for s in path.read_text(encoding="utf-8-sig").splitlines() if s.strip()]


def main():
    model_file = ROOT / "products/MODEL_FACTS.jsonl"
    source_file = ROOT / "products/SOURCE_REGISTER.jsonl"
    use_file = ROOT / "audits/PRODUCT_SOURCE_USE_AUDIT.jsonl"
    audit_file = ROOT / "existing/PRODUCTS_INDEPENDENT_AUDIT.json"
    models = read_rows(model_file)
    sources = {r["source_id"]: r for r in read_rows(source_file)}
    uses = {r["source_id"]: r for r in read_rows(use_file)}
    audit = json.loads(audit_file.read_text(encoding="utf-8-sig"))
    assert audit["status"] == "PASSED", "Product content audit not passed"
    for key in ("model_facts", "source_register"):
        binding = audit["input_bindings"][key]
        assert digest(Path(binding["path"])) == binding["sha256"], f"Stale content audit: {key}"
    assert set(uses) == set(sources), "Source-use audit does not account for all registered product sources"
    for source_id, source in sources.items():
        assert uses[source_id]["source_sha256"] == source["sha256"], f"Stale source-use audit: {source_id}"

    selected, excluded = [], []
    for row in models:
        source_ids = sorted({s.split("#", 1)[0] for s in row["source_refs"]})
        assert source_ids and all(s in sources for s in source_ids), f"Unresolved source on {row['record_id']}"
        denied = [s for s in source_ids if uses[s]["future_local_structured_fact_query"] != ALLOWED]
        if denied:
            excluded.append({"record_id": row["record_id"], "model_label": row["model_label"], "reason": "NOT_ADMITTED_FOR_THIS_SPECIFIC_ACTION", "sources": [{"source_id": s, "action_status": uses[s]["future_local_structured_fact_query"]} for s in denied]})
            continue
        prepared = deepcopy(row)
        prepared["preparation_binding"] = {
            "status": "PREPARED_NOT_INGESTED",
            "permitted_future_action": "CONDITIONAL_LOCAL_STRUCTURED_FACT_QUERY_ONLY",
            "model_record_file_sha256": digest(model_file),
            "content_audit_sha256": digest(audit_file),
            "source_use_audit_sha256": digest(use_file),
            "source_conditions": [{"source_id": s, "sha256": sources[s]["sha256"], "action_status": uses[s]["future_local_structured_fact_query"], "limits": uses[s].get("limits", [])} for s in source_ids],
            "other_actions": "Raw source/text RAG, training, redistribution and server transfer are not authorized by this selection.",
        }
        selected.append(prepared)
    output = ROOT / "PREPARED_PRODUCT_FACTS.jsonl"
    output.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in selected), encoding="utf-8")
    selection = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "PREPARED_NOT_INGESTED",
        "action": "FUTURE_LOCAL_STRUCTURED_FACT_QUERY_WITH_SOURCE_CONDITIONS",
        "inputs": [{"path": str(p), "sha256": digest(p)} for p in (model_file, source_file, use_file, audit_file)],
        "output": {"path": str(output), "sha256": digest(output)},
        "input_records": len(models),
        "selected_records": len(selected),
        "selected_exact_labels": sum(r["identity_kind"] == "EXACT_MODEL" for r in selected),
        "selected_family_records": sum(r["identity_kind"] == "FAMILY" for r in selected),
        "selected_fact_fields": sum(len(r["facts"]) for r in selected),
        "excluded_records": excluded,
        "limits": ["Source-limited prepared facts are not complete operating profiles.", "This selection does not select old inventory records or change previous grants.", "No raw source material, database, retrieval index or training set is built here."],
    }
    (ROOT / "PRODUCT_FACT_SELECTION.json").write_text(json.dumps(selection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: selection[k] for k in ("selected_records", "selected_exact_labels", "selected_family_records", "selected_fact_fields")}))


if __name__ == "__main__":
    main()
