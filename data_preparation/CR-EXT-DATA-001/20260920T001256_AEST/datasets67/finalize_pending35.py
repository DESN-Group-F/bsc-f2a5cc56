import json
from collections import Counter
from pathlib import Path
import openpyxl

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
OUT=RUN/"datasets67"; SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
def jl(p):return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
def dump(p,r):p.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in r),encoding="utf-8")

manifest=jl(OUT/"PROCESSING_MANIFEST.jsonl"); decisions=jl(OUT/"LOCAL_ACTION_DECISIONS.jsonl"); schemas=jl(OUT/"SCHEMA_CATALOG.jsonl"); findings=jl(OUT/"QUALITY_FINDINGS.jsonl"); full=jl(OUT/"FULL_SCAN_RESULTS.jsonl")
complete={(x["file_id"],x["kind"]) for x in full if x.get("complete")}
resolved_codes=set()
if any(k=="FULL_TAR_DIRECTORY" for _,k in complete):resolved_codes.add("TAR_STREAM_BOUNDED_PREFIX_ONLY")
if any(k=="FULL_NESTED_ZIP_DIRECTORIES" for _,k in complete):resolved_codes.add("NESTED_ZIP_REPRESENTATIVE_ONLY")
findings=[x for x in findings if x.get("code") not in resolved_codes]
scope={x["file_id"]:x for x in jl(RUN/"INPUT_SCOPE.jsonl")}
for m in manifest:
    fid=m["file_id"]
    m["rights_and_authorization_refs"]=[x.split("#",1)[0]+"#processing-authorization-boundary" if "CR_EXT_DATA_001_TASK_CARDS.md" in x else x for x in m["rights_and_authorization_refs"]]
    m["observed_declarations"]={"field_names_observed":m.get("fields_confirmed",False),"unit_or_quantity_words_observed":False,"condition_words_observed":m.get("conditions_confirmed",False)}
    m["units_confirmed"]=False;m["conditions_confirmed"]=False
    if (fid,"FULL_JSON_STREAM") in complete:m["processing_status"]="PREPARED_FULL_STRUCTURE";m["representative_scope"]=["complete JSON stream; values counted by type but not retained"]
    elif (fid,"FULL_TEXT_SCAN") in complete:m["processing_status"]="PREPARED_FULL_STRUCTURE_AND_QUALITY";m["representative_scope"]=["complete text file line/field/type scan; values not retained"]
    elif (fid,"FULL_TAR_DIRECTORY") in complete:m["processing_status"]="PREPARED_FULL_CONTAINER_DIRECTORY";m["representative_scope"]=["complete tar member directory stream; member bodies not extracted"]
    elif m["technical_format"]=="ZIP":m["processing_status"]="PREPARED_FULL_CONTAINER_DIRECTORY_WITH_REPRESENTATIVE_SCHEMA";m["representative_scope"]=["complete outer central directory; all valid nested ZIP directories where present; bounded one-per-format member schema"]
    elif m["technical_format"]=="NUMERIC_SUFFIX" and m["registered_bytes"]<=16:m["processing_status"]="PREPARED_FULL_STRUCTURE";m["representative_scope"]=["complete short numeric scalar text object"]
    if m["technical_format"]=="XLSX":
        schemas=[s for s in schemas if not(s.get("file_id")==fid and s.get("schema_id")==fid+"#workbook-full-quality")]
        path=SOURCE/Path(m["relative_path"]); wb=openpyxl.load_workbook(path,read_only=True,data_only=False,keep_links=False); sheet_quality=[]
        try:
            for ws in wb.worksheets:
                rows=nonempty=formulas=errors=0; max_cols=0
                for row in ws.iter_rows():
                    rows+=1; max_cols=max(max_cols,len(row)); vals=[c.value for c in row]
                    nonempty+=sum(v is not None for v in vals); formulas+=sum(isinstance(v,str) and v.startswith("=") for v in vals); errors+=sum(isinstance(v,str) and v.startswith("#") for v in vals)
                sheet_quality.append({"sheet_name":ws.title,"rows_iterated":rows,"max_columns_iterated":max_cols,"nonempty_cells":nonempty,"formula_cells":formulas,"error_like_string_cells":errors})
        finally:wb.close()
        schemas.append({"file_id":fid,"schema_id":fid+"#workbook-full-quality","locator":m["relative_path"],"structure":"xlsx_full_cell_metadata_quality","sheets":sheet_quality,"values_retained":False,"formulas_evaluated":False,"representative_scope":"complete workbook cell metadata iteration"})
        m["detail"]["full_workbook_quality"]=sheet_quality;m["processing_status"]="PREPARED_FULL_STRUCTURE_AND_QUALITY";m["representative_scope"]=["complete workbook cell metadata; field names retained, row values not retained, formulas not evaluated"]
for s in schemas:
    if s.get("structure") in {"delimited_or_labelled_text"} and any(x.get("file_id")==s.get("file_id") and x.get("kind")=="FULL_TEXT_SCAN" and x.get("complete") for x in full):
        s["evidence_status"]="SUPERSEDED_PREFIX_OBSERVATION";s["superseded_by_schema_id"]=s["file_id"]+"#full-text-quality"
    if s.get("conditions_confirmed"):
        s["condition_words_observed"]=True;s["conditions_confirmed"]=False
for d in decisions:d["authorization_ref"]="E:/desn 2000/bsc/backlog/CR_EXT_DATA_001_TASK_CARDS.md#processing-authorization-boundary"
dump(OUT/"LOCAL_ACTION_DECISIONS.jsonl",decisions);dump(OUT/"PROCESSING_MANIFEST.jsonl",manifest);dump(OUT/"SCHEMA_CATALOG.jsonl",schemas);dump(OUT/"QUALITY_FINDINGS.jsonl",findings)
cfg=json.loads((OUT/"FULL_SCAN_CONFIG.json").read_text(encoding="utf-8"));cfg.update({"memory_limit_enforcement":"NOT_HARD_MONITORED; external process observation during run was approximately 42 MiB working set","output_limit_enforcement":"CHECKED_AT_END_NOT_STREAMING_HARD_STOP","checkpointing":"NO_PER_FILE_CHECKPOINT_IN_THIS_COMPLETED_RUN; all results committed after successful 553-second run","limits_exceeded":cfg["output_bytes"]>cfg["metadata_output_limit_bytes"]});(OUT/"FULL_SCAN_CONFIG.json").write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
summary={"objects":len(manifest),"status_counts":dict(Counter(x["processing_status"] for x in manifest)),"format_counts":dict(Counter(x["technical_format"] for x in manifest)),"component_rows":len(jl(OUT/"CONTAINER_COMPONENTS.jsonl")),"schema_rows":len(schemas),"quality_findings":len(findings),"full_scan_elapsed_seconds":cfg["actual_elapsed_seconds"],"full_scan_incomplete":cfg["incomplete_results"]};(OUT/"FINAL_RESULTS.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8");(OUT/"RUN_RESULTS.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8");print(json.dumps(summary,ensure_ascii=False,indent=2))
