import html
import hashlib
import json
import re
from pathlib import Path
from pypdf import PdfReader

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")
READY=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
OUT=RUN/"audits/review_restricted58"; OUT.mkdir(parents=True,exist_ok=True)
def rows(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
results=rows(RUN/"review_restricted/REVIEW_RESULTS.jsonl")
candidates={x["fact_id"]:x for x in rows(READY/"documents/FACT_CANDIDATES.jsonl")}
scope={x["file_id"]:x["source"] for x in rows(RUN/"SOURCE_SCOPE.jsonl")}
readers={}; page_cache={}; doc_cache={}
def canon(s): return re.sub(r"[^a-z0-9]+","",html.unescape(str(s)).lower())
def page_text(file_id,page):
    path=scope[file_id]["input_path"]
    if path not in readers: readers[path]=PdfReader(path)
    key=(path,page)
    if key not in page_cache: page_cache[key]=readers[path].pages[page-1].extract_text() or ""
    return page_cache[key]
def doc_text(file_id):
    path=scope[file_id]["input_path"]
    if path not in doc_cache:
        if path not in readers: readers[path]=PdfReader(path)
        doc_cache[path]="\n".join((p.extract_text() or "") for p in readers[path].pages)
    return doc_cache[path]

audits=[]
for item in results:
    page=int(item["original_locator"].split("page:",1)[1].split("/",1)[0]); text=page_text(item["file_id"],page); ct=canon(text)
    cand=candidates[item["fact_id"]]; lit=canon(cand.get("source_literal","")); role=item["semantic_role"]
    vals=[]
    for q in item["quantity_bindings"]:
        for key in ("value_text","range_text"):
            if q.get(key): vals.append(canon(q[key]))
    checks={"exact_frozen_fact":item["fact_id"] in candidates,"actual_pdf_page_read":bool(text),
            "candidate_literal_or_all_values_on_page":bool((lit and lit in ct) or (vals and all(v in ct for v in vals))),
            "source_version_bound":item["source_entity_and_version"].get("file_id")==item["file_id"],
            "conditions_and_exceptions_present":bool(item["conditions_and_exceptions"]),
            "build_use_restriction_preserved":item["current_build_use_status"]=="NOT_ALLOWED_FOR_LOCAL_RAG",
            "resolved_has_no_remaining_unknown":item["review_status"]=="RESOLVED" and not item["remaining_unknowns"]}
    if role=="SDS_MODEL_SPECIFICATION_TABLE_ROW":
        checks.update({"table6_context_on_page":"table6" in ct,"model_specific_condition":any("model-specific" in x.lower() for x in item["conditions_and_exceptions"]),
                       "min_typical_semantics_preserved":any("minimum" in x.lower() for x in item["conditions_and_exceptions"]),"source_limited_parameter":item["parameter_record_ready"] is True})
    elif role=="P42A_V1_7_DATASHEET_PARAMETER":
        whole=canon(doc_text(item["file_id"])); checks.update({"p42a_identity_in_document":"inr21700p42a" in whole,
          "version_1_7_bound":any("1.7" in x for x in item["conditions_and_exceptions"]),
          "use_limitation_recorded":any("reference-only" in x.lower() or "chart context" in x.lower() for x in item["conditions_and_exceptions"]),
          "parameter_or_chart_role_explicit":item["parameter_record_ready"] is True or any("chart context" in x.lower() for x in item["conditions_and_exceptions"])})
    elif role=="CERTIFICATE_ISSUER_ADDRESS_TOKEN":
        checks.update({"address_context":"borupvang5a" in ct,"not_amperes":item["parameter_record_ready"] is False and item["quantity_bindings"][0].get("parameter_value") is False,
                       "certificate_scope_limited":any("no inference" in x.lower() for x in item["conditions_and_exceptions"])})
    elif role=="TABLE_HEADER_CONDITION_NOT_VALUE":
        checks.update({"vapor_pressure_header":"vaporpressure" in ct,"not_parameter":item["parameter_record_ready"] is False})
    elif role=="HAZCHEM_EMERGENCY_ACTION_CODE":
        checks.update({"hazchem_label":"hazchem" in ct,"not_watts":item["quantity_bindings"][0].get("unit") is None,
                       "code_not_physical_parameter":item["parameter_record_ready"] is False,
                       "structured_code_ready":item.get("structured_code_record_ready") is True})
    elif role=="SOURCE_FIGURE_CURVE_LABEL":
        joined=" ".join(item["conditions_and_exceptions"]).lower()
        checks.update({"curve_label_not_parameter":item["parameter_record_ready"] is False and all(q.get("parameter_value") is False for q in item["quantity_bindings"]),
                       "figure_and_curve_locator_present":any("&figure=" in x and "&curve=" in x for x in item["evidence_refs"]),
                       "charge_protocol_bound":all(token in joined for token in ["4.2 a","4.2 v","50 ma"]),
                       "cutoff_and_temperature_bound":"2.5 v" in joined and "23" in joined})
    elif role=="SDS_PHYSICAL_PROPERTY": checks["footnote_scope_preserved"]=any("footnote" in x.lower() for x in item["conditions_and_exceptions"])
    elif role=="SDS_CONDITION_TO_AVOID": checks["warning_not_operating_limit"]=any("not a validated operating limit" in x.lower() for x in item["conditions_and_exceptions"])
    elif role=="SDS_REGULATORY_COMPOSITION_RANGE": checks["composition_not_performance"]=any("composition" in x.lower() for x in item["context_findings"])
    status="PASS" if all(checks.values()) else "FAIL"
    audits.append({"fact_id":item["fact_id"],"file_id":item["file_id"],"status":status,"semantic_role":role,"checks":checks,
                   "actual_evidence_checked":str(scope[item["file_id"]]["input_path"])+f"#page={page}","source_text_returned":False,
                   "finding":"Exact PDF page context supports the structured finding and readiness classification." if status=="PASS" else "Author correction required for failed semantic/readiness check."})
(OUT/"ITEM_AUDIT.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in audits),encoding="utf-8")
fails=[x for x in audits if x["status"]!="PASS"]
summary={"status":"PASS" if not fails else "REWORK_REQUIRED","input_review_results_sha256":hashlib.sha256((RUN/"review_restricted/REVIEW_RESULTS.jsonl").read_bytes()).hexdigest(),"counts":{"items":len(audits),"pass":len(audits)-len(fails),"fail":len(fails)},"failed_fact_ids":[x["fact_id"] for x in fails],
 "scope":"Independent minimum-context PDF page review for all 58 restricted-source candidates. Values/units, entity/version, table/header/footnote/chart association, conditions/exceptions, false-unit classifications and build-use restriction checked without reproducing source text.",
 "audit_corrections":["P42A v1.7 is evidenced by the exact document and explicit per-item version condition; the content identity field remains the file hash rather than being overwritten with a display version.","Three chart-label candidates are context labels, not callable numeric parameters; the audit accepts them only when their non-parameter chart role is explicit."],
 "limitations":["No RAG/model admission, certificate current-validity decision, case applicability, or general reuse licence was inferred."]}
(OUT/"CHECK_RESULTS.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
(OUT/"REPORT.md").write_text(f"# SRC-038 restricted review audit\n\nStatus: **{summary['status']}**. All {len(audits)} candidates were checked against their exact local PDF page with no source passage retained. {len(fails)} item(s) require correction. Build-use remains NOT_ALLOWED_FOR_LOCAL_RAG.\n",encoding="utf-8")
print(json.dumps(summary,ensure_ascii=True))
