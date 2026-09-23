import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")

def rows(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

target_path = RUN / "coverage/SOURCE_USE_FILE_BINDINGS.jsonl"
target = rows(target_path)
docs = rows(RUN / "documents/FILE_READINESS.jsonl")
data = rows(RUN / "datasets/FILE_READINESS.jsonl")
lane = {}
for record in docs:
    item = dict(record)
    item["_lane"] = "documents"
    if not item.get("actual_action"):
        item["actual_action"] = item.get("content_method") or "LOCAL_CONTENT_ENTRY_RECORDED_NO_ACTION_LABEL"
    lane[item["file_id"]] = item
for record in data:
    if record["file_id"] in lane:
        raise ValueError(f"duplicate lane file_id: {record['file_id']}")
    item = dict(record)
    item["_lane"] = "datasets"
    lane[item["file_id"]] = item

if len(target) != 300 or len(lane) != 300:
    raise ValueError(f"expected 300 target/lane rows, got {len(target)}/{len(lane)}")
if {x["file_id"] for x in target} != set(lane):
    raise ValueError("target/lane file_id sets differ")

updated = []
for binding in target:
    source = lane[binding["file_id"]]
    expected_hash = source.get("input_sha256")
    if expected_hash and binding.get("sha256") != expected_hash:
        raise ValueError(f"hash mismatch: {binding['file_id']}")
    if binding.get("current_run_lane") != source["_lane"]:
        raise ValueError(f"lane mismatch: {binding['file_id']}")
    out = dict(binding)
    out["current_run_actual_action"] = source.get("actual_action")
    out["current_run_readiness"] = source.get("readiness") or source.get("readiness_status") or "LOCAL_ENTRY_STATUS_RECORDED"
    out["current_run_artifact_refs"] = source.get("artifact_refs", [])
    updated.append(out)

target_path.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in updated), encoding="utf-8")
result = {
    "status": "PASS",
    "rows": len(updated),
    "document_rows": len(docs),
    "dataset_rows": len(data),
    "null_actual_action": sum(x.get("current_run_actual_action") is None for x in updated),
    "empty_artifact_refs": sum(not x.get("current_run_artifact_refs") for x in updated),
    "fields_updated_only": ["current_run_actual_action", "current_run_readiness", "current_run_artifact_refs"],
}
(RUN / "coverage/SOURCE_USE_FILE_BINDINGS_SYNC_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=True))
