"""EXT-04 preparation audit for the 38 previously identified documents."""
from __future__ import annotations
import json,re
from collections import Counter
from pathlib import Path,PurePosixPath
import pdfplumber

ROOT=Path(r"E:\desn 2000\bsc"); SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
RUN=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"; OUT=RUN/"existing233/documents"; DER=OUT/"derived"
SCOPE=RUN/"INPUT_SCOPE.jsonl"; USER=RUN/"USER_SCOPE.json"; REQS=RUN/"requirements/REQUIREMENTS.jsonl"
UNIT_RE=re.compile(r"(?<!\w)[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:V|mV|A|mA|Ah|mAh|W|kW|Wh|kWh|°C|C|K|Hz|kg|g|mm|cm|m|%|Pa|bar|s|min|h)(?!\w)",re.I)

def rights_basis(row):
 p=row.get("prior_selected_rights") or {}; perm=p.get("permission") or {}
 if p.get("file_id")==row["file_id"] and p.get("sha256_registered")==row["sha256_registered"] and perm.get("decision")=="ALLOW_LOCAL_PROCESSING": return {"verified":True,"binding":perm.get("binding"),"rights_id":perm.get("rights_id"),"ref":f"{SCOPE}#file_id={row['file_id']}/prior_selected_rights"}
 for r in row.get("existing_rights_records") or []:
  if r.get("file_id")==row["file_id"] and r.get("file_sha256")==row["sha256_registered"] and r.get("ai_processing")=="ALLOWED": return {"verified":True,"binding":"EXACT_FILE_ID_AND_SHA256","rights_id":r.get("rights_id"),"ref":f"{SCOPE}#file_id={row['file_id']}/existing_rights_records/rights_id={r.get('rights_id')}"}
 effective=(row.get("prior_routing") or {}).get("rights_record",{}).get("effective_rights_id")
 for r in row.get("existing_rights_records") or []:
  if not r.get("file_id") and r.get("source_id")==row["source_id"] and r.get("rights_id")==effective and r.get("ai_processing")=="ALLOWED": return {"verified":True,"binding":"RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS","rights_id":r.get("rights_id"),"ref":f"{SCOPE}#file_id={row['file_id']}/existing_rights_records/rights_id={r.get('rights_id')}"}
 return {"verified":False,"binding":None,"rights_id":None,"ref":None}

def reqs_for(semantic,source):
 if source in {"SRC-002","SRC-032"}: return ["M03","M04","M07","M08","M09","D03"]
 if source in {"SRC-009","SRC-010"}: return ["M05","D15"]
 if source in {"SRC-033","SRC-034"}: return ["D20","D21"]
 if source=="SRC-035": return ["D16","D17","D18","D23"]
 if source in {"SRC-025","SRC-026"}: return ["D20","D21","D23"]
 if source in {"SRC-027","SRC-028","SRC-029"}: return ["M05","M06","D15","D21"]
 if source=="SRC-039": return ["M04","M05","M06","D11","D21"]
 if source=="SRC-040": return ["M01","M02","M03","M04","M05","M06","D05","D07","D11"]
 return []

def locators(text,media):
 out=[]
 for n,line in enumerate(text.splitlines(),1):
  s=line.strip()
  if not s: continue
  kind=None
  if re.match(r"^#{1,6}\s+",s): kind="heading"
  elif media=="text/x-rst" and re.match(r"^[=~`^\-:#\"'*+<>_]{3,}$",s): kind="rst_heading_underline"
  elif re.match(r"^(?:[-*+] |\d+[.)]\s+)",s): kind="list_item"
  elif s.count("|")>=2 or re.search(r"\t|\s{2,}",s): kind="table_or_multicolumn_candidate"
  units=[m.group(0) for m in UNIT_RE.finditer(s)]
  if kind or units: out.append({"line_number":n,"kind":kind or "numeric_unit_candidate","numeric_unit_matches":units,"line_text":line})
 return out

def main():
 OUT.mkdir(parents=True,exist_ok=True); DER.mkdir(parents=True,exist_ok=True)
 rows=[json.loads(x) for x in SCOPE.open(encoding="utf-8") if x.strip()]; rows=[x for x in rows if x.get("pending67") is False and x.get("assigned_lane")=="documents"]
 if len(rows)!=38 or len({x['file_id'] for x in rows})!=38: raise SystemExit("existing documents scope is not 38 unique files")
 valid_req={x["requirement_id"] for x in map(json.loads,REQS.open(encoding="utf-8"))}
 previous_manifest={}
 previous_quality={}
 if (OUT/"PROCESSING_MANIFEST.jsonl").is_file(): previous_manifest={x["file_id"]:x for x in (json.loads(z) for z in (OUT/"PROCESSING_MANIFEST.jsonl").open(encoding="utf-8") if z.strip()) if x.get("status")=="LOCALLY_PREPARED_WITH_REUSED_EXTRACTION"}
 if (OUT/"QUALITY_FINDINGS.jsonl").is_file(): previous_quality={x["file_id"]:x for x in (json.loads(z) for z in (OUT/"QUALITY_FINDINGS.jsonl").open(encoding="utf-8") if z.strip())}
 decisions=[]; manifests=[]; findings=[]
 for row in rows:
  basis=rights_basis(row); ext=(row.get("existing_extractions") or [None])[0]; binding=bool(ext and ext.get("input_file_id")==row["file_id"] and ext.get("input_sha256")==row["sha256_registered"])
  decisions.append({"file_id":row["file_id"],"local_action":"reuse_hash_bound_extraction_and_create_locators; original PDF geometry probe only for three PDFs","basis":basis,"extraction_binding_verified":binding,"user_authorization_ref":str(USER),"purpose":"UNSW coursework or non-commercial research","not_authorized":["RAG admission","training","external transfer","publication","commercial use"],"source_code_execution":False})
  if row["file_id"] in previous_manifest:
   manifests.append(previous_manifest[row["file_id"]]); findings.append(previous_quality[row["file_id"]]); continue
  sem=row["mapping_v1"].get("semantic_type"); media=row["inventory"]["media_type"]; outputs=[]; issues=[]; profile={}; status="PREPARATION_FAILED"
  if not basis["verified"] or not binding:
   issues.append("Missing verified local-processing basis or exact extraction input file/hash binding; content was not read.")
  else:
   ep=SOURCE/ext["output_path"]
   try:
    text=ep.read_text(encoding="utf-8",errors="replace")
    loc=locators(text,media); lp=DER/f"{row['file_id']}.locators.jsonl"; lp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in loc),encoding="utf-8"); outputs.append(str(lp))
    profile={"reused_extraction_path":str(ep),"reused_extraction_id":ext.get("extraction_id"),"locator_count":len(loc),"numeric_unit_locator_count":sum(bool(x["numeric_unit_matches"]) for x in loc),"table_or_multicolumn_candidate_count":sum(x["kind"]=="table_or_multicolumn_candidate" for x in loc),"full_text_not_duplicated":True}
    if media=="application/pdf":
     rel=PurePosixPath(row["relative_path"]); src=SOURCE.joinpath(*rel.parts); tables=[]; nums=[]
     with pdfplumber.open(src) as pdf:
      for pi,page in enumerate(pdf.pages,1):
       for ti,table in enumerate(page.extract_tables() or [],1): tables.append({"page_number":pi,"table_index":ti,"rows":table,"row_count":len(table),"column_count_max":max((len(r or []) for r in table),default=0)})
       for li,line in enumerate((page.extract_text() or "").splitlines(),1):
        ms=[m.group(0) for m in UNIT_RE.finditer(line)]
        if ms: nums.append({"page_number":pi,"line_number":li,"matches":ms,"line_text":line})
     tp=DER/f"{row['file_id']}.geometry_tables.jsonl"; np=DER/f"{row['file_id']}.numeric_unit_candidates.jsonl"; tp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in tables),encoding="utf-8"); np.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in nums),encoding="utf-8"); outputs.extend([str(tp),str(np)]); profile.update({"geometry_table_count":len(tables),"page_numeric_unit_candidate_count":len(nums),"geometry_method":"pdfplumber 0.11.9"}); issues.append("PDF tables and numeric/unit lines are candidates; layout, merged cells, conditions, and critical values require verification.")
    if media in {"application/xml","text/x-python"}: issues.append("Object was read as inert text only; diagram rendering or source execution/runtime validation was not performed.")
    status="LOCALLY_PREPARED_WITH_REUSED_EXTRACTION"
   except Exception as exc: issues.append(f"Preparation failed: {type(exc).__name__}: {exc}")
  req_ids=[x for x in reqs_for(sem,row["source_id"]) if x in valid_req]
  safety_limit="Research/software/model material is method or implementation evidence, not authoritative battery safety guidance or target-site approval." if row["source_id"] not in {"SRC-002","SRC-032","SRC-040"} else "Reference evidence only; target asset/site applicability and approval remain unverified."
  manifests.append({"file_id":row["file_id"],"source_id":row["source_id"],"document_family_id":row["inventory"].get("document_family_id"),"document_version_id":row["inventory"].get("document_version_id"),"semantic_role":sem,"technical_format":media,"status":status,"decision_ref":f"{OUT/'LOCAL_ACTION_DECISIONS.jsonl'}#file_id={row['file_id']}","derived_outputs":outputs,"profile":profile,"requirement_support":{"requirement_ids":req_ids,"basis":"Semantic role plus local locator evidence; module_ids were not used as proof.","support_limit":safety_limit},"limitations":[safety_limit,"Locator/candidate generation does not validate semantic completeness, scientific correctness, currentness, or critical values."],"rag_status":"NOT_ADMITTED","training_status":"NOT_AUTHORIZED","external_transfer":"NOT_AUTHORIZED_NOT_ATTEMPTED"})
  findings.append({"file_id":row["file_id"],"quality_status":"NEEDS_REVIEW" if issues else "LOCATORS_CHECKED","issues":issues,"critical_value_validation":"NOT_PERFORMED","semantic_verification":"PARTIAL_ROLE_LEVEL_ONLY"})
 (OUT/"LOCAL_ACTION_DECISIONS.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in decisions),encoding="utf-8")
 (OUT/"PROCESSING_MANIFEST.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in manifests),encoding="utf-8")
 (OUT/"QUALITY_FINDINGS.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in findings),encoding="utf-8")
 log={"objects":len(rows),"status_counts":Counter(x["status"] for x in manifests),"derived_file_count":sum(len(x["derived_outputs"]) for x in manifests),"previous_successes_reused_without_reread":len(previous_manifest),"processed_this_invocation":len(rows)-len(previous_manifest),"source_code_executed":False,"full_text_duplicated":False,"python":r"C:\Users\S.W\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe","network_used":False,"model_used":False}
 (OUT/"RUN_LOG.json").write_text(json.dumps(log,ensure_ascii=False,indent=2,default=dict)+"\n",encoding="utf-8"); print(json.dumps(log,ensure_ascii=False,indent=2,default=dict))
if __name__=="__main__": main()
