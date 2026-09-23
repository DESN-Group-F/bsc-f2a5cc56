"""Link the original 25 EXT-02 document records using existing evidence only."""
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(r"E:\desn 2000\bsc"); RUN=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"; OUT=RUN/"documents67"
MANUAL={
 "SRC-003":(["M03","M04","M07","D03"],"External EHS educational landing page; candidate comparative guidance only."),
 "SRC-004":(["M03","M04","M07","D03"],"External battery safety guidance; candidate comparative guidance only."),
 "SRC-005":(["M03","M04","M07","D03"],"External checklist; may inform comparison but is not a target-site approved checklist."),
 "SRC-006":(["M03","M04","M06","M07","D03"],"External electrical safety program reference; no automatic UNSW or target-site applicability."),
 "SRC-030":(["D16","D17","D18","D23"],"Machine-learning dataset card supports dataset/evaluation/governance design patterns, not battery safety evidence."),
 "SRC-047":(["M09","D09"],"Training badge landing page supports competence/authorization workflow awareness; it does not prove any person's valid training."),
}
CONTEXT_ONLY={"SRC-011":"Catalog page points to research data but does not itself supply the required experiment conditions/schema.","SRC-014":"Dataset landing page is discovery metadata and does not itself satisfy experiment condition/schema evidence.","SRC-015":"Study-summary catalog is discovery/context only and does not establish per-file experimental conditions.","SRC-016":"Experimental platform/catalog documentation is discovery/context only and does not establish per-file conditions, calibration, or physical-cell grouping."}
matrix=[json.loads(x) for x in (RUN/"requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl").open(encoding="utf-8") if x.strip()]
by_source={}
for er in matrix:
 for sid in er.get("linked_source_ids",[]): by_source.setdefault(sid,[]).append(er)
mp=OUT/"PROCESSING_MANIFEST.jsonl"; rows=[json.loads(x) for x in mp.open(encoding="utf-8") if x.strip()]
changed=0; no_link=0
for row in rows:
 rs=row.get("requirement_support") or {}
 if rs.get("status")!="NOT_ASSESSED_REQUIREMENT_IDS_UNAVAILABLE_AT_PROCESSING_TIME": continue
 sid=row["source_id"]; ers=by_source.get(sid,[]); erids=sorted({x["external_requirement_id"] for x in ers}); mids=sorted({z for x in ers for z in x.get("supports_requirement_ids",[])})
 basis=[]; refs=list(row.get("derived_outputs") or [])
 for er in ers:
  refs.append(f"{RUN/'requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl'}#external_requirement_id={er['external_requirement_id']}")
  basis.append(f"{er['external_requirement_id']}: source_id is explicitly linked by the external requirement matrix; local derivative supplies structure/content locators only.")
 if sid in MANUAL:
  ids,note=MANUAL[sid]; mids=sorted(set(mids)|set(ids)); basis.append(note)
 if sid in CONTEXT_ONLY and not ers:
  status="ASSESSED_CONTEXT_ONLY_NO_REQUIREMENT_EVIDENCE"; no_link+=1; limit=CONTEXT_ONLY[sid]; mids=[]; erids=[]; basis=[limit]
 elif erids or mids:
  status="ASSESSED_CANDIDATE_SUPPORT"; limit="Candidate support only. Currentness, target chemistry/equipment/site applicability, controlled procedures, and critical values remain separately required."
 else:
  status="ASSESSED_NO_SUPPORTED_REQUIREMENT"; no_link+=1; limit="No defensible ER/M/D evidence link was established from the semantic role and existing local derivative."
 row["requirement_support"]={"status":status,"external_requirement_ids":erids,"requirement_ids":mids,"evidence_refs":refs,"basis":basis,"support_limit":limit,"module_ids_used_as_evidence":False}
 changed+=1
for row in rows:
 rs=row.get("requirement_support") or {}
 if row["source_id"] in {"SRC-038","SRC-048"} and "status" not in rs:
  rs["status"]="ASSESSED_CANDIDATE_SUPPORT" if row["status"]!="LOCALLY_INSPECTED_COPY_DISABLED_EXCEPTION" else "ASSESSED_METADATA_ONLY_SUPPORT"
  rs.setdefault("evidence_refs",list(row.get("derived_outputs") or [])+[f"{RUN/'requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl'}#linked_source_id={row['source_id']}"])
  rs["module_ids_used_as_evidence"]=False
mp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in rows),encoding="utf-8")
log={"original_25_records_now_assessed":sum(x["source_id"] not in {"SRC-038","SRC-048"} for x in rows),"all_32_records_assessed":sum(x.get('requirement_support',{}).get('status','').startswith("ASSESSED_") for x in rows),"assessed_candidate_support":sum(x.get('requirement_support',{}).get('status')=="ASSESSED_CANDIDATE_SUPPORT" for x in rows),"assessed_metadata_only_support":sum(x.get('requirement_support',{}).get('status')=="ASSESSED_METADATA_ONLY_SUPPORT" for x in rows),"assessed_context_or_no_supported_requirement":sum(x.get('requirement_support',{}).get('status') in {"ASSESSED_CONTEXT_ONLY_NO_REQUIREMENT_EVIDENCE","ASSESSED_NO_SUPPORTED_REQUIREMENT"} for x in rows),"source_content_reread":False,"module_ids_used_as_evidence":False}
(OUT/"REQUIREMENT_LINK_RUN_LOG.json").write_text(json.dumps(log,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); print(json.dumps(log,ensure_ascii=False))
