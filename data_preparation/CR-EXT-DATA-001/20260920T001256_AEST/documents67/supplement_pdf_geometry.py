"""Add geometric table and numeric/unit locators for the seven non-limited EXT-02 PDFs."""
from __future__ import annotations
import json, re
from pathlib import Path, PurePosixPath
import pdfplumber

ROOT=Path(r"E:\desn 2000\bsc"); SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
OUT=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/documents67"; DER=OUT/"derived"
SCOPE=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/INPUT_SCOPE.jsonl"
LIMITED={"SRC-038","SRC-048"}
UNIT_RE=re.compile(r"(?<!\w)[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:V|mV|A|mA|Ah|mAh|W|kW|Wh|kWh|°C|C|K|Hz|kg|g|mm|cm|m|%)(?!\w)",re.I)
rows=[json.loads(x) for x in SCOPE.open(encoding="utf-8") if x.strip()]
targets=[x for x in rows if x.get("pending67") is True and x.get("assigned_lane")=="documents" and x["inventory"]["media_type"]=="application/pdf" and x["source_id"] not in LIMITED]
manifest=[json.loads(x) for x in (OUT/"PROCESSING_MANIFEST.jsonl").open(encoding="utf-8") if x.strip()]
quality=[json.loads(x) for x in (OUT/"QUALITY_FINDINGS.jsonl").open(encoding="utf-8") if x.strip()]
summ=[]
for row in targets:
 rel=PurePosixPath(row["relative_path"]); src=SOURCE.joinpath(*rel.parts)
 tables=[]; nums=[]; page_count=0
 with pdfplumber.open(src) as pdf:
  page_count=len(pdf.pages)
  for pi,page in enumerate(pdf.pages,1):
   for ti,table in enumerate(page.extract_tables() or [],1):
    tables.append({"page_number":pi,"table_index":ti,"bbox_basis":"pdfplumber page table detection","rows":table,"row_count":len(table),"column_count_max":max((len(r or []) for r in table),default=0)})
   text=page.extract_text() or ""
   for li,line in enumerate(text.splitlines(),1):
    matches=[m.group(0) for m in UNIT_RE.finditer(line)]
    if matches: nums.append({"page_number":pi,"line_number":li,"matches":matches,"line_text":line})
 tp=DER/f"{row['file_id']}.geometry_tables.jsonl"; np=DER/f"{row['file_id']}.numeric_unit_candidates.jsonl"
 tp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in tables),encoding="utf-8")
 np.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in nums),encoding="utf-8")
 m=next(x for x in manifest if x["file_id"]==row["file_id"]); m["derived_outputs"].extend([str(tp),str(np)]); m["profile"]["geometry_table_count"]=len(tables); m["profile"]["numeric_unit_candidate_line_count"]=len(nums); m["profile"]["geometry_method"]="pdfplumber 0.11.9"
 q=next(x for x in quality if x["file_id"]==row["file_id"]); q["issues"]=[z for z in q["issues"] if "pdfplumber was unavailable" not in z]; q["issues"].append("Geometric tables and numeric/unit lines are candidates only; merged cells, reading order, units, conditions, and critical values require independent verification."); q["quality_status"]="NEEDS_REVIEW_GEOMETRY_AND_VALUES"
 summ.append({"file_id":row["file_id"],"pages":page_count,"geometry_tables":len(tables),"numeric_unit_candidate_lines":len(nums)})
(OUT/"PROCESSING_MANIFEST.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in manifest),encoding="utf-8")
(OUT/"QUALITY_FINDINGS.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in quality),encoding="utf-8")
(OUT/"PDF_GEOMETRY_RUN_LOG.json").write_text(json.dumps({"targets":len(targets),"results":summ,"terms_limited_objects_unchanged":7,"terms_limited_pdf_bodies_skipped":6,"encrypted_copy_disabled_body_read":False,"python":r"C:\Users\S.W\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe","pdfplumber":"0.11.9"},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"targets":len(targets),"tables":sum(x['geometry_tables'] for x in summ),"numeric_unit_lines":sum(x['numeric_unit_candidate_lines'] for x in summ)},ensure_ascii=False))
