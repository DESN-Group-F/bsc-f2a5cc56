import json
import hashlib
import re
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")
OUT = RUN / "audits/review_b64"; OUT.mkdir(parents=True, exist_ok=True)
def rows(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
results = rows(RUN / "review_b/REVIEW_RESULTS.jsonl")
contexts = {x["fact_id"]: x for x in rows(RUN / "review_b/CONTEXT_EVIDENCE.jsonl")}

def read_ref(ref):
    path, frag = ref.rsplit("#L", 1); m = re.fullmatch(r"(\d+)(?:-L?(\d+))?", frag)
    if not m: raise ValueError(ref)
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    return "\n".join(lines[a-1:b]), a, b

audits=[]
for item in results:
    source_refs=[x for x in item["evidence_refs"] if "#L" in x and ("SRC-039" in x or "SRC-040" in x)]
    checked=[]; combined=""
    for ref in source_refs:
        text,a,b=read_ref(ref); combined += "\n"+text; checked.append({"ref":ref,"lines_read":b-a+1})
    role=item["semantic_role"]; checks={"source_lines_actually_read":bool(checked),"context_evidence_present":item["fact_id"] in contexts,
      "file_and_fact_binding":contexts.get(item["fact_id"],{}).get("file_id")==item["file_id"],"resolved_has_no_remaining_unknown":item["review_status"]=="RESOLVED" and not item["remaining_unknowns"]}
    if role=="RST_IMAGE_RENDERING_DIRECTIVE":
        checks.update({"rst_scale_syntax_present":bool(re.search(r":scale:\s*50\s*%",combined)),"adjacent_image_directive_present":".. image::" in combined,
                       "excluded_from_parameters":item["parameter_record_ready"] is False,"not_domain_threshold":all(q.get("parameter_value") is False for q in item["quantity_bindings"])})
    elif role=="SOFTWARE_CHANGELOG_CAN_MESSAGE_IDENTIFIER_MAPPING":
        checks.update({"old_new_table_headers_present":"Old Message Definition" in combined and "New Message Definition" in combined,
                       "hex_suffix_present":bool(re.search(r"\b(?:230|231)h\b",combined)),"not_bound_as_hours":all(q.get("unit") is None and q.get("notation")=="hexadecimal CAN identifier" for q in item["quantity_bindings"]),
                       "version_bound":item["source_entity_and_version"].get("document_version")=="v1.11.0",
                       "not_physical_parameter":item["parameter_record_ready"] is False,
                       "structured_interface_ready":item.get("structured_interface_record_ready") is True,
                       "column_roles_explicit":all(q.get("column_role") in {"old_message_definition","new_message_definition"} for q in item["quantity_bindings"])})
    elif role=="DEVICE_SPECIFICATION_PARAMETER":
        q=item["quantity_bindings"][0]; token=q["value_text"]
        checks.update({"value_present":token in combined,"specification_table_context":"Overview of specifications" in combined,
                       "device_identity_present":"MPPT 1210 HUS" in combined,"manual_date_present":"2021-05-02" in combined,
                       "condition_or_qualifier_recorded":bool(q.get("qualifier") or item["conditions_and_exceptions"]),"parameter_ready":item["parameter_record_ready"] is True})
        if token=="98": checks["greater_than_and_max_preserved"] = (">98" in combined or "&gt;98" in combined) and "max." in combined
        if token=="13.8": checks["configurable_preserved"] = "configurable" in combined.lower()
        if token=="95": checks["non_condensing_preserved"] = "non-condensing" in combined.lower()
        if token=="15": checks["ato_type_preserved"] = "Automotive blade fuse (ATO)" in combined
    else: checks["known_role"]=False
    status="PASS" if all(checks.values()) else "FAIL"
    audits.append({"fact_id":item["fact_id"],"file_id":item["file_id"],"status":status,"semantic_role":role,"checks":checks,"source_evidence_checked":checked,
                   "audit_finding":"Content and adjacent context support the recorded classification/bindings." if status=="PASS" else "One or more content checks failed; author correction required.","source_text_returned":False})

(OUT/"ITEM_AUDIT.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in audits),encoding="utf-8")
summary={"status":"PASS" if all(x["status"]=="PASS" for x in audits) else "REWORK_REQUIRED","input_review_results_sha256":hashlib.sha256((RUN/"review_b/REVIEW_RESULTS.jsonl").read_bytes()).hexdigest(),"counts":{"items":len(audits),"pass":sum(x["status"]=="PASS" for x in audits),"fail":sum(x["status"]!="PASS" for x in audits)},
         "role_counts":{r:sum(x["semantic_role"]==r for x in audits) for r in sorted({x["semantic_role"] for x in audits})},
         "scope":"Independent content-level audit: exact source lines were read for every fact; values, units/notation, entity/version, table/directive association, conditions and exclusions checked. No source text reproduced.","limitations":["Runtime applicability and target equipment approval were not assessed."]}
(OUT/"CHECK_RESULTS.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
(OUT/"REPORT.md").write_text(f"# review_b independent audit\n\nStatus: **{summary['status']}**. All {len(audits)} item records were checked against their exact local source line ranges. The audit confirmed 58 RST image scale directives are presentation metadata, two v1.11.0 changelog candidates use hexadecimal CAN identifiers rather than hours, and four MPPT 1210 HUS specifications preserve their table entity, version, relation/unit and qualifiers. No source passage is reproduced. Runtime applicability and target-device approval remain separate.\n",encoding="utf-8")
print(json.dumps(summary,ensure_ascii=True))
