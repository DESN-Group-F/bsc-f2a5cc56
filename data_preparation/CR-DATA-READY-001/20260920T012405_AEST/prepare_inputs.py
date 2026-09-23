"""Bind the fixed 300 input records without rereading large source payloads."""
import collections
import datetime
import hashlib
import json
from pathlib import Path

RUN = Path(__file__).resolve().parent
PRIOR = RUN.parents[1] / "CR-EXT-DATA-001" / "20260920T001256_AEST"
SOURCE = Path("E:/desn 2000/data/battery_data_workspace_v0_3")


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    scope = PRIOR / "INPUT_SCOPE.jsonl"
    rows = read_rows(scope)
    ids = [row["file_id"] for row in rows]
    assert len(ids) == 300 and len(set(ids)) == 300
    output, anomalies = [], []
    for row in rows:
        source_path = SOURCE / row["relative_path"]
        if not source_path.resolve().is_relative_to(SOURCE.resolve()):
            raise ValueError(f"Outside fixed source root: {row['file_id']}")
        stat = source_path.lstat()
        reparse = bool(getattr(stat, "st_file_attributes", 0) & 0x400)
        registered = row["bytes_registered"]
        if reparse or stat.st_size != registered or not source_path.is_file():
            anomalies.append({"file_id": row["file_id"], "size_matches": stat.st_size == registered,
                              "is_reparse_point": reparse, "is_file": source_path.is_file()})
        inv = row["inventory"]
        output.append({
            "file_id": row["file_id"], "source_id": row["source_id"],
            "lane": row["assigned_lane"], "input_path": source_path.as_posix(),
            "source_relative_path": row["relative_path"],
            "registered_sha256": row["sha256_registered"],
            "content_identity": "sha256:" + row["sha256_registered"],
            "logical_locator": {"root": "SOURCE_WORKSPACE", "path": row["relative_path"]},
            "registered_bytes": registered, "observed_bytes": stat.st_size,
            "representation": inv.get("representation"), "media_type": inv.get("media_type"),
            "original_url": inv.get("original_url"), "publisher": inv.get("publisher"),
            "acquired_at": inv.get("acquired_at"),
            "document_family_id": inv.get("document_family_id"),
            "document_version_id": inv.get("document_version_id"),
            "previously_pending67": row["pending67"],
            "historical_binding_ref": f"{scope.as_posix()}#file_id={row['file_id']}",
            "check": "LSTAT_SIZE_AND_FILE_TYPE_ONLY_NO_PAYLOAD_REHASH",
            "source_unmodified_by_this_script": True,
        })
    (RUN / "SOURCE_OBJECTS.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in output), encoding="utf-8")
    write_json(RUN / "INPUT_CHECK_RESULTS.json", {
        "status": "PASS" if not anomalies else "FAIL", "checked_at": datetime.datetime.now().astimezone().isoformat(),
        "command": "bundled-python -B prepare_inputs.py", "scope": "Fixed input binding and stat checks only",
        "original_count": len(output), "source_count": len({r['source_id'] for r in output}),
        "lane_counts": dict(collections.Counter(r['lane'] for r in output)),
        "registered_bytes": sum(r['registered_bytes'] for r in output),
        "distinct_registered_sha256": len({r['registered_sha256'] for r in output}),
        "prior_scope_sha256": hashlib.sha256(scope.read_bytes()).hexdigest(),
        "anomalies": anomalies, "not_checked": ["source payload hashes recomputation", "content accuracy", "readiness", "source-use permission"]})
    print(json.dumps({"files": len(output), "anomalies": len(anomalies)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
