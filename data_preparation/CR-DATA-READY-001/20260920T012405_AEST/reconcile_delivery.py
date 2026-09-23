"""Reconcile delivered lane evidence. This does not grant semantic acceptance."""
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import unquote, parse_qsl

RUN = Path(__file__).resolve().parent
LOOKUP_FIELDS = {"file_id", "source_id", "fact_id", "contract_id", "supplement_id", "task_id", "domain_id", "issue_id", "record_id", "content_id", "container_file_id", "member_id", "public_gap_id", "external_requirement_id", "open_item_id", "locator", "member_path", "member_locator", "nested_archive_member", "mat_member", "decision_id"}


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def reference_check(reference, cache):
    if not isinstance(reference, str):
        return {"reference": reference, "check": "UNSUPPORTED_REFERENCE_TYPE"}
    if reference.startswith(("http://", "https://")):
        return {"reference": reference, "check": "WEB_NOT_RECHECKED_BY_LOCAL_RECONCILER"}
    head, _, fragment = reference.partition("#")
    path = Path(unquote(head))
    if not path.is_absolute():
        return {"reference": reference, "check": "NON_ABSOLUTE_REF"}
    if not path.is_file():
        return {"reference": reference, "check": "MISSING_FILE"}
    result = {"reference": reference, "check": "FILE_EXISTS_ONLY_LOCATOR_NOT_EVALUATED"}
    if not fragment:
        result["check"] = "FILE_EXISTS"
    elif path.suffix.lower() == ".jsonl" and "=" in fragment:
        pairs = parse_qsl(fragment, keep_blank_values=True)
        if pairs:
            if path not in cache:
                cache[path] = rows(path)
            count = sum(all(str(row.get(field)) == value for field, value in pairs) for row in cache[path])
            result.update(check="JSONL_SELECTOR_RESOLVES" if count else "JSONL_SELECTOR_MISSING", matching_records=count)
    elif path.suffix.lower() == ".json" and fragment and "=" not in fragment and "/" not in fragment:
        if path not in cache:
            cache[path] = json.loads(path.read_text(encoding="utf-8-sig"))
        data = cache[path]
        if isinstance(data, dict):
            result["check"] = "JSON_KEY_RESOLVES" if fragment in data else "JSON_KEY_MISSING"
    return result


def main():
    baseline = {row["file_id"]: row for row in rows(RUN / "SOURCE_OBJECTS.jsonl")}
    errors, inputs, outputs, seen, references, cache = [], [], [], set(), [], {}
    for lane, expected_count in (("documents", 70), ("datasets", 230)):
        path = RUN / lane / "FILE_READINESS.jsonl"
        if not path.is_file():
            errors.append({"kind": "LANE_NOT_DELIVERED", "lane": lane})
            continue
        records = rows(path)
        inputs.append({"path": path.as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "rows": len(records)})
        if len(records) != expected_count:
            errors.append({"kind": "LANE_COUNT_MISMATCH", "lane": lane, "count": len(records)})
        for record in records:
            file_id = record.get("file_id")
            original = baseline.get(file_id)
            if file_id in seen:
                errors.append({"kind": "DUPLICATE_ID", "file_id": file_id})
            seen.add(file_id)
            if not original or original["lane"] != lane:
                errors.append({"kind": "OUTSIDE_LANE", "file_id": file_id})
                continue
            declared_hash = record.get("input_sha256", record.get("registered_sha256", record.get("input_hash")))
            if declared_hash != original["registered_sha256"]:
                errors.append({"kind": "SOURCE_HASH_BINDING_MISMATCH", "file_id": file_id, "declared_hash": declared_hash})
            if record.get("source_id") != original["source_id"]:
                errors.append({"kind": "SOURCE_ID_MISMATCH", "file_id": file_id})
            declared_path = record.get("input_path")
            if not declared_path or Path(declared_path).resolve() != Path(original["input_path"]).resolve():
                errors.append({"kind": "SOURCE_PATH_MISMATCH", "file_id": file_id})
            for field in ("role", "readiness", "artifact_refs", "evidence_refs", "limitations", "blocking_items"):
                if field not in record:
                    errors.append({"kind": "MISSING_DELIVERY_FIELD", "file_id": file_id, "field": field})
            for field in ("artifact_refs", "evidence_refs"):
                for ref in record.get(field, []):
                    checked = reference_check(ref, cache)
                    references.append({"file_id": file_id, "field": field, **checked})
                    if checked["check"] in {"MISSING_FILE", "JSONL_SELECTOR_MISSING", "JSON_KEY_MISSING", "NON_ABSOLUTE_REF", "UNSUPPORTED_REFERENCE_TYPE"}:
                        errors.append({"kind": "REFERENCE_ERROR", "file_id": file_id, **checked})
            outputs.append({"file_id": file_id, "source_id": original["source_id"], "lane": lane,
                            "source_ref": f"{(RUN/'SOURCE_OBJECTS.jsonl').as_posix()}#file_id={file_id}",
                            "prepared_record_ref": f"{path.as_posix()}#file_id={file_id}",
                            "role": record.get("role"), "readiness": record.get("readiness"),
                            "technical_readiness_status": record.get("readiness_status", record.get("readiness")),
                            "original_registered_representation": original["representation"],
                            "prepared_representation": record.get("prepared_representation", record.get("format_family", record.get("content_method"))),
                            "actual_action": record.get("actual_action", record.get("content_method")),
                            "reader_entrypoint": record.get("reader_entrypoint"),
                            "use_decision_ref": f"{(RUN/'BUILD_USE_INDEX.jsonl').as_posix()}#file_id={file_id}",
                            "artifact_refs": record.get("artifact_refs", []),
                            "blocking_items": record.get("blocking_items", []),
                            "limitations": record.get("limitations", [])})
    missing_ids = sorted(set(baseline) - seen)
    if missing_ids:
        errors.append({"kind": "MISSING_SOURCE_OBJECTS", "count": len(missing_ids), "file_ids": missing_ids})
    result = {
        "status": "PASS" if not errors else "FAIL", "checked_at": datetime.now().astimezone().isoformat(),
        "scope": "Delivered record sets, fixed source binding and local references; not semantic readiness acceptance",
        "command": "bundled-python -B reconcile_delivery.py", "inputs": inputs,
        "delivered_count": len(outputs), "errors": errors,
        "readiness_counts": dict(Counter(str(row['readiness']) for row in outputs)),
        "role_counts": dict(Counter(str(row['role']) for row in outputs)),
        "reference_check_counts": dict(Counter(row['check'] for row in references)),
        "not_checked": ["domain sufficiency", "scientific correctness", "permission grants", "non-JSONL internal locators", "new deployment or upload"]}
    write_json(RUN / "RECONCILIATION_CHECK_RESULTS.json", result)
    (RUN / "REFERENCE_CHECKS.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in references), encoding="utf-8")
    (RUN / "BUILD_INPUT_INDEX.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in outputs), encoding="utf-8")
    print(json.dumps({"status": result['status'], "records": len(outputs), "error_count": len(errors)}))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
