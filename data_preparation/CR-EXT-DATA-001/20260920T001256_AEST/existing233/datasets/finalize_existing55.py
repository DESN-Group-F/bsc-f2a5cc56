import json
from collections import Counter
from pathlib import Path

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST");OUT=RUN/"existing233"/"datasets"
OLD=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST\datasets\MAT_SUPPLEMENT.jsonl")
def jl(p):return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
def dump(p,r):p.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in r),encoding="utf-8")
manifest=jl(OUT/"PREPARATION_MANIFEST.jsonl");schemas=jl(OUT/"SCHEMA_CATALOG.jsonl");findings=jl(OUT/"QUALITY_FINDINGS.jsonl");decls=jl(OUT/"SRC017_ARCHIVE_DECLARATIONS.jsonl");old={x["file_id"]:x for x in jl(OLD)}
level5={fid for fid,x in old.items() if x["profile"].get("mat_generation")=="MATLAB_LEVEL_5"}
schemas=[x for x in schemas if x["file_id"] not in level5]
for fid in sorted(level5):
    p=old[fid]["profile"]; entries=[{"name":x.get("name"),"class_id":x.get("class_id"),"metadata_complete":False,"shape_status":"OLD_DECODE_INVALID_NOT_USABLE"} for x in p.get("variable_directory",[])]
    schemas.append({"file_id":fid,"structure":"mat5_top_level_elements_opaque_mcos_unresolved","top_level_elements_observed":len(entries),"element_descriptors":entries,"old_mapping_evidence_ref":f"{OLD}#file_id={fid}","old_shape_values_usable":False,"array_values_read":False,"units_verified":False,"conditions_verified":False,"remaining_unknown":"MCOS/class_id 17 and opaque object layout require a trustworthy MATLAB-object-aware parser; no object code or deserialization was executed."})
    findings.append({"file_id":fid,"severity":"LIMITATION","code":"OPAQUE_MCOS_SCHEMA_UNRESOLVED","detail":"Old bounded Level-5 parser output contained incomplete MCOS metadata or implausible dimensions. Those shape values are invalid for use; only top-level element/class observations are retained."})
for m in manifest:
    m["action_basis_refs"]=[m["evidence_refs"][0],"E:/desn 2000/bsc/backlog/CR_EXT_DATA_001_TASK_CARDS.md#processing-authorization-boundary"]
    m["units_verified"]=False;m["conditions_verified"]=False
    if m["file_id"] in level5:
        m["processing_status"]="PREPARED_TOP_LEVEL_ELEMENTS_OPAQUE_SCHEMA_UNRESOLVED";m["actual_local_action"]="REUSED_BOUNDED_MAT5_TOP_LEVEL_ELEMENTS_WITH_CORRECTION";m["limitations"].append("OPAQUE_MCOS_SCHEMA_UNRESOLVED; old implausible shapes are explicitly invalidated.")
review=[]
scope={x["file_id"]:x for x in jl(RUN/"INPUT_SCOPE.jsonl")}
for fid in ["FILE-017-348626d881c2-87e51f","FILE-017-af4e7ee540be-9057bf"]:
    row=scope[fid]; ds=[x for x in decls if x["file_id"]==fid]
    review.append({"file_id":fid,"relative_path":row["relative_path"],"documentation_files_extracted":len(ds),"declaration_evidence_refs":[x["derived_local_path"] for x in ds],"explicit_unit_protocol_or_cell_grouping_claim_confirmed":False,"result":"No small README/protocol declaration member found in the data archive." if not ds else "Small documentation was indexed by line/keyword; it does not explicitly establish all field units, protocol semantics, or independence of file/channel as cell identity."})
dump(OUT/"PREPARATION_MANIFEST.jsonl",manifest);dump(OUT/"SCHEMA_CATALOG.jsonl",schemas);dump(OUT/"QUALITY_FINDINGS.jsonl",findings);dump(OUT/"SRC017_ARCHIVE_REVIEW.jsonl",review)
result={"objects":len(manifest),"status_counts":dict(Counter(x["processing_status"] for x in manifest)),"format_counts":dict(Counter(x["technical_format"] for x in manifest)),"schema_rows":len(schemas),"quality_findings":len(findings),"src017_archives_reviewed":len(review),"level5_opaque_unresolved":len(level5)};(OUT/"RUN_RESULTS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8");print(json.dumps(result,ensure_ascii=False,indent=2))
