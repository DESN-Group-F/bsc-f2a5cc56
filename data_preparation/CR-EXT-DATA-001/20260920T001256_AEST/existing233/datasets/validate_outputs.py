import json
from pathlib import Path
RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST");OUT=RUN/"existing233"/"datasets"
def jl(p):return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
scope=[x for x in jl(RUN/"INPUT_SCOPE.jsonl") if x.get("assigned_lane")=="datasets" and not x.get("pending67") and Path(x["relative_path"]).suffix.lower()!=".csv"]
expected={x["file_id"] for x in scope};m=jl(OUT/"PREPARATION_MANIFEST.jsonl");s=jl(OUT/"SCHEMA_CATALOG.jsonl");q=jl(OUT/"QUALITY_FINDINGS.jsonl");r=jl(OUT/"SRC017_ARCHIVE_REVIEW.jsonl")
checks={}
checks["exact_55_non_csv_dataset_set"]=len(expected)==55 and len(m)==55 and {x["file_id"] for x in m}==expected
checks["format_partition"]=sum(x["technical_format"]=="XLSX" for x in m)==10 and sum(x["technical_format"]=="JSON" for x in m)==1 and sum(x["technical_format"]=="MAT" for x in m)==13 and sum(x["technical_format"]=="ZIP" for x in m)==31
checks["hdf5_complete_directory_10"]=len([x for x in s if x["structure"]=="mat73_hdf5_complete_directory_aggregate" and x["complete_directory_enumeration"]])==10
checks["mat5_opaque_correction_3"]=len([x for x in s if x["structure"]=="mat5_top_level_elements_opaque_mcos_unresolved" and x["old_shape_values_usable"] is False])==3
checks["xlsx_full_metadata_10"]=len([x for x in s if x["structure"]=="xlsx_complete_cell_metadata"])==10
checks["zip_contract_31"]=len([x for x in s if x["structure"]=="zip_complete_central_directory_contract"])==31
checks["unit_condition_not_overclaimed"]=all(x["units_verified"] is False and x["conditions_verified"] is False for x in m)
checks["action_basis_present"]=all(any("CR_EXT_DATA_001_TASK_CARDS.md" in y for y in x["action_basis_refs"]) for x in m)
checks["src017_two_archives_reviewed"]=len(r)==2 and {x["file_id"] for x in r}=={"FILE-017-348626d881c2-87e51f","FILE-017-af4e7ee540be-9057bf"}
result={"status":"PASS" if all(checks.values()) else "FAIL","checks":checks,"scope":{"objects":55,"excluded":"140 CSV handled by root lane","array_values_read":False,"workbook_row_values_retained":False},"remaining_unchecked":["Three MAT Level-5 MCOS/object schemas remain opaque; old shapes invalidated.","Units, conditions, chemistry/device match and scientific applicability remain unverified unless explicit source statements are separately reviewed."],"command":"E:/desn 2000/data/battery_data_workspace_v0_3/.venv/Scripts/python.exe -B data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/existing233/datasets/validate_outputs.py"}
(OUT/"CHECK_RESULTS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8");print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result["status"]=="PASS" else 1)
