import html
import hashlib
import json
import re
from pathlib import Path

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")
READY=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
OUT=RUN/"audits/review_a85"; OUT.mkdir(parents=True,exist_ok=True)
def rows(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
results=rows(RUN/"review_a/REVIEW_RESULTS.jsonl")
candidates={x["fact_id"]:x for x in rows(READY/"documents/FACT_CANDIDATES.jsonl")}
scope={x["file_id"]:x["source"] for x in rows(RUN/"SOURCE_SCOPE.jsonl")}

def canon(s):
    s=html.unescape(re.sub(r"<[^>]+>"," ",str(s)))
    return re.sub(r"[^a-z0-9]+","",s.lower())
def payload(item):
    for ref in item["evidence_refs"]:
        if ".pages.jsonl#page_number=" in ref:
            p,n=ref.split("#page_number="); a=[x for x in rows(Path(p)) if str(x.get("page_number"))==n]
            if len(a)!=1: raise ValueError(ref)
            return json.dumps(a[0],ensure_ascii=False),ref
        if ".segments.jsonl#segment_index=" in ref:
            p,n=ref.split("#segment_index="); allrows=rows(Path(p)); hit=[i for i,x in enumerate(allrows) if str(x.get("segment_index"))==n]
            if len(hit)!=1: raise ValueError(ref)
            i=hit[0]; return "\n".join(json.dumps(x,ensure_ascii=False) for x in allrows[max(0,i-2):i+3]),ref
    p=Path(scope[item["file_id"]]["input_path"])
    return p.read_text(encoding="utf-8",errors="replace"),str(p)

audits=[]
for item in results:
    cand=candidates[item["fact_id"]]; text,eref=payload(item); ctext=canon(text); literal=canon(cand.get("source_literal",""))
    role=item["semantic_role"]
    literal_match = cand.get("source_literal","") in text if cand.get("source_literal","").lstrip().startswith("<") else bool(literal and literal in ctext)
    mentions=[m for m in cand.get("numeric_unit_mentions",[]) if m.get("value_text")]
    numeric_match = bool(mentions) and all(canon(m.get("value_text","")) in ctext for m in mentions)
    checks={"frozen_candidate_exact":item["fact_id"] in candidates,"actual_content_read":bool(text),
            "literal_or_numeric_content_match":bool(literal_match or numeric_match),
            "entity_version_bound":bool(item.get("source_entity_and_version")),"conditions_recorded":bool(item.get("conditions_and_exceptions")),
            "resolved_unknowns_consistent":item["review_status"]=="RESOLVED" and not item["remaining_unknowns"]}
    ctx=item.get("context_findings",{})
    if isinstance(ctx,dict) and ctx.get("structure")=="native_html_table_row":
        cells=ctx.get("headers",[])+ctx.get("row",[])
        raw_text=Path(scope[item["file_id"]]["input_path"]).read_text(encoding="utf-8",errors="replace")
        checks["native_table_headers_and_row_matched"] = all(canon(x) in canon(raw_text) for x in cells if canon(x))
    if item["source_id"]=="SRC-006" and isinstance(ctx,dict) and ctx.get("table_index_zero_based")==4:
        checks["lbnl_table4_entity_and_joint_thresholds"] = bool(ctx.get("headers")==["Source","Includes","Hazard Thresholds"] and len(item["quantity_bindings"])>=1 and all(q.get("comparator") in {"≥","lower inclusive","upper inclusive"} for q in item["quantity_bindings"]))
        encoding_note=ctx.get("raw_source_encoding_check","")
        checks["lbnl_utf8_source_not_misreported_corrupt"] = "preserve U+2265" in encoding_note and "source defect" in encoding_note
    if item["source_id"]=="SRC-006" and role=="SOURCE_TRAINING_CATALOG_ENTRY":
        checks["catalog_not_engineering_parameter"] = item["parameter_record_ready"] is False
    if item["source_id"]=="SRC-014" and role=="SOURCE_EXPERIMENT_CONDITION":
        checks["experiment_condition_has_bound_field_and_value"] = bool(item["quantity_bindings"] and isinstance(ctx,dict) and ctx.get("row"))
        joined=" ".join(item["conditions_and_exceptions"]).lower()
        checks["pl_population_soc_allocation_bound"] = all(token in joined for token in ["144","0%","50%","100%","12 cells per temperature","4 cells"])
        checks["pl_schedule_and_workflow_bound"] = all(token in joined for token in ["48 cells","3 weeks","3 months","6 months","pln_51","cccv","c/2"])
        checks["pl_individual_schedule_mapping_limit_explicit"] = "does not identify which individual file/cell" in joined
        checks["pl_context_range_evidence_bound"] = any("#segment_index=338-342" in x for x in item["evidence_refs"])
    if item["source_id"]=="SRC-023":
        checks["iata_page_context_and_conditions"] = bool(ctx.get("page") and len(item["conditions_and_exceptions"])>=3 and item["quantity_bindings"])
        if item["fact_id"].endswith("A0086"):
            checks["iata_dual_trigger_and_approval"] = len(item["quantity_bindings"])==2 and all(q.get("comparator")==">" for q in item["quantity_bindings"]) and any("approval" in x.lower() for x in item["conditions_and_exceptions"])
        if item["fact_id"].endswith("A0126"):
            checks["iata_multi_chemistry_branches_preserved"] = len(item["quantity_bindings"])==4 and any("sodium" in x.lower() for x in item["conditions_and_exceptions"])
    if role in {"IDENTIFIER_NOT_QUANTITY","HTML_PRESENTATION_METADATA_FALSE_POSITIVE","DATASET_CARD_METADATA","SOFTWARE_TRAINING_EXAMPLE_METADATA","NAVIGATION_LABEL_FALSE_NUMERIC","PROJECT_NAME_FALSE_NUMERIC"}:
        checks["non_parameter_class_not_admitted"] = item["parameter_record_ready"] is False
    status="PASS" if all(checks.values()) else "FAIL"
    audits.append({"fact_id":item["fact_id"],"file_id":item["file_id"],"source_id":item["source_id"],"status":status,"semantic_role":role,
                   "checks":checks,"actual_content_evidence_checked":eref,"source_text_returned":False,
                   "finding":"Content/context and parameter-readiness classification supported." if status=="PASS" else "Author correction required for failed content or parameter-readiness check."})

(OUT/"ITEM_AUDIT.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in audits),encoding="utf-8")
fails=[x for x in audits if x["status"]!="PASS"]
summary={"status":"PASS" if not fails else "REWORK_REQUIRED","input_review_results_sha256":hashlib.sha256((RUN/"review_a/REVIEW_RESULTS.jsonl").read_bytes()).hexdigest(),"counts":{"items":len(audits),"pass":len(audits)-len(fails),"fail":len(fails)},
         "failed_fact_ids":[x["fact_id"] for x in fails],"scope":"Independent item-level content review using exact frozen candidates and local segment/page/raw context. Values, units/comparators, entities/versions, conditions, exceptions and parameter readiness checked; source text not reproduced.",
         "audit_corrections":["A prior console print rendered U+2265 as replacement glyphs because of the terminal encoding; direct codepoint inspection confirmed the reviewed file contains U+2265 and no U+FFFD in the checked comparator fields.","CSS table markup false positives have no quantity binding; their exact raw markup was checked directly rather than inventing a numeric quantity."],
         "limitations":["No target-case applicability, UNSW adoption, or current transport-rule completeness was inferred."]}
(OUT/"CHECK_RESULTS.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
(OUT/"REPORT.md").write_text(f"# review_a independent audit\n\nStatus: **{summary['status']}**. {len(audits)} facts received item-level local content checks; {len(fails)} require author correction. Training catalog entries are reference/catalog descriptions and are not engineering parameter records. Source-specific rules, specifications and experiment conditions remain bounded to their recorded entity, version and conditions. No source passage is reproduced.\n",encoding="utf-8")
print(json.dumps(summary,ensure_ascii=True))
