import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
OUT = RUN / "datasets67"

def read(name):
    return [json.loads(x) for x in (OUT / name).read_text(encoding="utf-8").splitlines() if x.strip()]

scope = [json.loads(x) for x in (RUN / "INPUT_SCOPE.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
expected = {x["file_id"] for x in scope if x.get("pending67") is True and x.get("assigned_lane") == "datasets"}
decisions = read("LOCAL_ACTION_DECISIONS.jsonl")
manifest = read("PROCESSING_MANIFEST.jsonl")
components = read("CONTAINER_COMPONENTS.jsonl")
schemas = read("SCHEMA_CATALOG.jsonl")
findings = read("QUALITY_FINDINGS.jsonl")
assert len(expected) == 35
assert len(decisions) == len({x["file_id"] for x in decisions}) == 35
assert len(manifest) == len({x["file_id"] for x in manifest}) == 35
assert {x["file_id"] for x in decisions} == expected == {x["file_id"] for x in manifest}
assert all(x["current_local_action_decision"] == "ALLOW_THIS_RUN_LOCAL_READ_AND_BOUNDED_STRUCTURE_PREPARATION" for x in decisions)
assert all("PARTIAL" not in x["processing_status"] and x["processing_status"] != "PREPARATION_FAILED" for x in manifest)
assert all(x["container_file_id"] in expected for x in components)
assert all(x["file_id"] in expected for x in schemas)
assert all(x["file_id"] in expected for x in findings)
assert all(x["rights_and_authorization_refs"] for x in manifest)
assert all("actual_local_action" in x and "representative_scope" in x and "quality_status" in x and "requirement_support" in x for x in manifest)
numeric = [x for x in manifest if x["technical_format"] == "NUMERIC_SUFFIX"]
assert len(numeric) == 7 and all(x["detail"]["multipart_relationship_established"] is False for x in numeric)
json_schemas = [x for x in schemas if x["structure"] == "json_full_stream"]
assert len(json_schemas) == 10 and all(x["nonstandard_constant_counts"].get("NaN", 0) > 0 for x in json_schemas)
xlsx = [x for x in schemas if x["structure"] == "xlsx_workbook"]
assert len(xlsx) == 1 and len(xlsx[0]["sheets"]) == 3
assert len([x for x in schemas if x["structure"] == "xlsx_full_cell_metadata_quality"]) == 1
full = read("FULL_SCAN_RESULTS.jsonl")
assert len(full) == 19 and all(x.get("complete") for x in full)
fixture=json.loads((OUT/"NORMALIZER_TEST.log").read_text(encoding="utf-8"))
assert fixture["status"]=="PASS"
checks={"exact_pending67_dataset_set":True,"one_decision_and_manifest_per_object":True,"no_partial_or_failed_status":True,"component_and_schema_parent_integrity":True,"action_and_scope_fields":True,"numeric_suffix_not_assumed_multipart":True,"ten_json_full_stream_nonstandard_constant_profiles":True,"xlsx_complete_metadata_quality":True,"normalizer_fixture":True}
result={"status":"PASS","checks":checks,"scope":{"objects":35,"full_scan_results":19,"source_values_retained":False},"remaining_unchecked":["Archive member bodies were not all semantically parsed.","Scientific applicability, units and operating conditions remain unverified unless explicit declarations are separately supported."],"command":"E:/desn 2000/data/battery_data_workspace_v0_3/.venv/Scripts/python.exe -B data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/datasets67/validate_outputs.py"}
(OUT/"CHECK_RESULTS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(result,ensure_ascii=False,indent=2))
