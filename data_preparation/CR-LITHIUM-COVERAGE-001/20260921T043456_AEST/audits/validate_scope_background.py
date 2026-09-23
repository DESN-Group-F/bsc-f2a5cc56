import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rows(rel):
    path = ROOT / rel
    out = []
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                out.append(json.loads(line))
            except Exception as exc:
                raise AssertionError(f"{rel}:{no}: {exc}") from exc
    return out


requirements = rows("scope/REQUIREMENT_MATRIX.jsonl")
sources = rows("background/SOURCE_REGISTER.jsonl")
facts = rows("background/BACKGROUND_FACTS.jsonl")
statuses = rows("scope/REQUIREMENT_STATUS_MATRIX.jsonl")
product_records = rows("products/MODEL_FACTS.jsonl")
existing_records = rows("existing/MODEL_EVIDENCE.jsonl")

requirement_ids = [r["requirement_id"] for r in requirements]
source_ids = [s["source_id"] for s in sources]
fact_ids = [f["fact_id"] for f in facts]

assert len(requirements) == 29
assert len(requirement_ids) == len(set(requirement_ids))
assert len(source_ids) == len(set(source_ids))
assert len(fact_ids) == len(set(fact_ids))
assert set(a for f in facts for a in f["applies_to"]) <= set(requirement_ids)
assert set(f["source_id"] for f in facts) <= set(source_ids)
assert [r["requirement_id"] for r in statuses] == requirement_ids
assert all("product_record_ids" in r and "existing_record_ids" in r for r in statuses)
product_ids = {r["record_id"] for r in product_records}
existing_ids = {r["record_id"] for r in existing_records}
assert {x for r in statuses for x in r["product_record_ids"]} <= product_ids
assert {x for r in statuses for x in r["existing_record_ids"]} <= existing_ids

hash_checks = []
for source in sources:
    checks = []
    if "local_path" in source:
        checks.append((source["local_path"], source["sha256"], source["bytes"], "accepted_local_source"))
    if "quarantine_path" in source:
        checks.append((source["quarantine_path"], source["sha256"], source["bytes"], "quarantine_audit_only"))
    if "raw_source_path" in source:
        checks.append((source["raw_source_path"], source["raw_source_sha256"], source["raw_source_bytes"], "reused_raw_source"))
    if "extracted_artifact_path" in source:
        checks.append((source["extracted_artifact_path"], source["extracted_artifact_sha256"], source["extracted_artifact_bytes"], "reused_extraction"))
    for local, expected, expected_bytes, object_kind in checks:
        p = Path(local)
        path = p if p.is_absolute() else ROOT / p
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        passed = actual == expected and path.stat().st_size == expected_bytes
        hash_checks.append({"source_id": source["source_id"], "object_kind": object_kind, "path": str(path), "expected": expected, "actual": actual, "bytes": path.stat().st_size, "passed": passed})
        assert passed

result = {
    "status": "PASSED",
    "scope": "JSONL parsing, fixed 29-ID order, status record-ID fields, fact references, and hash/byte verification for every background raw/extracted/quarantine object",
    "requirement_count": len(requirements),
    "source_count": len(sources),
    "fact_count": len(facts),
    "status_count": len(statuses),
    "status_product_record_references_resolved": len({x for r in statuses for x in r["product_record_ids"]}),
    "status_existing_record_references_resolved": len({x for r in statuses for x in r["existing_record_ids"]}),
    "background_object_hash_checks": hash_checks,
    "limitations": [
        "PRODUCTS and EXISTING content audits are reported separately with their own input hashes.",
        "This does not constitute scientific fitness, current site approval, RAG admission, model validation or server acceptance.",
    ],
}
result_path = ROOT / "audits" / "CHECK_RESULTS.json"
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
