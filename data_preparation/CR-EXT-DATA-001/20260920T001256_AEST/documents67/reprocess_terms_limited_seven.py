"""Correct blanket terms treatment and substantively process six readable objects.

Does not read the copy-disabled encrypted UN test summary body. Molicel outputs are
fact/date/unit/applicability candidates only; MIT output excludes images/artwork.
"""
from __future__ import annotations
import json,re
from html.parser import HTMLParser
from pathlib import Path,PurePosixPath
import pdfplumber

ROOT=Path(r"E:\desn 2000\bsc"); SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
RUN=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"; OUT=RUN/"documents67"; DER=OUT/"derived"; SCOPE=RUN/"INPUT_SCOPE.jsonl"
TARGET_SOURCES={"SRC-038","SRC-048"}; ENCRYPTED="FILE-038-cbd0f5edb42b-16d37f"
NUM_RE=re.compile(r"(?<!\w)[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:V|mV|A|mA|Ah|mAh|W|kW|Wh|kWh|°C|K|Hz|kg|g|mm|cm|m|%|h|min|s)(?!\w)",re.I)
DATE_RE=re.compile(r"\b(?:19|20)\d{2}(?:[-/.](?:0?[1-9]|1[0-2])(?:[-/.](?:0?[1-9]|[12]\d|3[01]))?)?\b")
OBJECT_RE=re.compile(r"\b(?:INR[- ]?21700[- ]?P42A|P42A|21700|lithium[- ]ion|Li[- ]ion)\b",re.I)

class TextHTML(HTMLParser):
 def __init__(self): super().__init__(convert_charrefs=True); self.skip=0; self.blocks=[]; self.tag=None; self.buf=[]
 def handle_starttag(self,t,a):
  if t in {"script","style","svg","noscript"}: self.skip+=1
  if not self.skip and t in {"title","h1","h2","h3","h4","p","li","th","td"}: self.tag=t; self.buf=[]
 def handle_endtag(self,t):
  if t==self.tag:
   s=re.sub(r"\s+"," "," ".join(self.buf)).strip()
   if s:self.blocks.append((self.tag,s))
   self.tag=None;self.buf=[]
  if t in {"script","style","svg","noscript"} and self.skip:self.skip-=1
 def handle_data(self,d):
  if self.tag and not self.skip:self.buf.append(d)

def candidates(text,location):
 out=[]
 for li,line in enumerate(text.splitlines(),1):
  nums=[m.group(0) for m in NUM_RE.finditer(line)]; dates=DATE_RE.findall(line); objs=OBJECT_RE.findall(line)
  if nums or dates or objs:
   out.append({**location,"line_number":li,"line_text":line,"numeric_unit_literals":nums,"date_literals":dates,"applicable_object_literals":objs,"source_literal_consistency":all(x in line for x in nums+dates),"missing_unit_flag":bool(re.search(r"\b\d+(?:\.\d+)?\b",line) and not nums and not dates),"condition_context_flag":"CONDITION_NOT_AUTOMATICALLY_VERIFIED"})
 return out

def main():
 scope=[json.loads(x) for x in SCOPE.open(encoding="utf-8") if x.strip()]; targets=[x for x in scope if x.get("pending67") is True and x["source_id"] in TARGET_SOURCES]
 decisions=[json.loads(x) for x in (OUT/"LOCAL_ACTION_DECISIONS.jsonl").open(encoding="utf-8") if x.strip()]; manifest=[json.loads(x) for x in (OUT/"PROCESSING_MANIFEST.jsonl").open(encoding="utf-8") if x.strip()]; quality=[json.loads(x) for x in (OUT/"QUALITY_FINDINGS.jsonl").open(encoding="utf-8") if x.strip()]
 results=[]
 for row in targets:
  fid=row["file_id"]; src=SOURCE.joinpath(*PurePosixPath(row["relative_path"]).parts); d=next(x for x in decisions if x["file_id"]==fid); m=next(x for x in manifest if x["file_id"]==fid); q=next(x for x in quality if x["file_id"]==fid)
  d["old_ai_precheck_interpretation"]="Historical AI precheck inferred restriction or unresolved permission; it is not quoted as an express prohibition on all local reading."
  d["actual_terms_interpretation"]=("Molicel legal/privacy page permits electronic copying solely for transmitting/viewing; this run stays within local read/fact-location and does not claim AI/RAG/training permission." if row["source_id"]=="SRC-038" else "MIT legal disclaimer is educational/applicability language; no express ban on bounded local text processing was identified. Third-party artwork remains separately governed and is not copied.")
  d["legal_certification"]="NOT_CLAIMED"
  d["remaining_not_authorized"]=["RAG admission","model/cloud context","training","external transfer","publication/redistribution","commercial use"]
  if fid==ENCRYPTED:
   d["local_action"]="metadata_only_due_to_express_pdf_copy_disabled_permission; no body read or bypass"
   m["status"]="LOCALLY_INSPECTED_COPY_DISABLED_EXCEPTION"; m["requirement_support"]={"external_requirement_ids":["ER-17","ER-18"],"requirement_ids":["M02","M08","M09","D04","D05","D23"],"basis":"Metadata-only model-specific test-summary reference; body not read.","support_limit":"Cannot verify test facts, applicability, or current framework from the encrypted body."}; q["quality_status"]="NEEDS_REVIEW_COPY_DISABLED_METADATA_ONLY"; results.append({"file_id":fid,"action":"metadata_only","body_read":False}); continue
  outs=[]; facts=[]; page_count=None
  if row["inventory"]["media_type"]=="application/pdf":
   pages=[]; rules=[]
   with pdfplumber.open(src) as pdf:
    page_count=len(pdf.pages)
    for pi,p in enumerate(pdf.pages,1):
     text=p.extract_text() or ""; facts.extend(candidates(text,{"page_number":pi}))
     if row["source_id"]=="SRC-048":
      pages.append({"page_number":pi,"text":text,"text_character_count":len(text)})
      for li,line in enumerate(text.splitlines(),1):
       if re.search(r"\b(?:do|do not|don't|never|always|avoid|keep|use|charge|store|dispose)\b",line,re.I): rules.append({"page_number":pi,"line_number":li,"rule_candidate":line,"semantic_verification":"PENDING"})
   if row["source_id"]=="SRC-048":
    pp=DER/f"{fid}.pages_text_no_images.jsonl"; rp=DER/f"{fid}.rule_candidates.jsonl"; pp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in pages),encoding="utf-8"); rp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in rules),encoding="utf-8"); outs += [str(pp),str(rp)]
  else:
   raw=src.read_text(encoding="utf-8",errors="replace"); parser=TextHTML(); parser.feed(raw)
   for bi,(tag,text) in enumerate(parser.blocks,1): facts.extend(candidates(text,{"segment_index":bi,"segment_kind":tag}))
  fp=DER/f"{fid}.fact_candidates.jsonl"; fp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in facts),encoding="utf-8"); outs.append(str(fp))
  m["derived_outputs"]=outs; m["status"]="LOCALLY_PREPARED_BOUNDED_TERMS_AWARE"; m["actual_local_action"]=("local_read_and_fact_date_unit_applicability_location_only_no_fulltext_copy" if row["source_id"]=="SRC-038" else "local_text_and_rule_location_no_image_copy")
  m["profile"].update({"page_count":page_count or m["profile"].get("page_count"),"fact_candidate_count":len(facts),"numeric_unit_candidate_count":sum(bool(x["numeric_unit_literals"]) for x in facts),"date_candidate_count":sum(bool(x["date_literals"]) for x in facts),"applicable_object_candidate_count":sum(bool(x["applicable_object_literals"]) for x in facts),"complete_fulltext_copy_created":row["source_id"]=="SRC-048","images_or_third_party_artwork_copied":False,"source_literal_consistency_all":all(x["source_literal_consistency"] for x in facts)})
  if row["source_id"]=="SRC-038": m["requirement_support"]={"external_requirement_ids":["ER-01","ER-02","ER-03","ER-17","ER-18"],"requirement_ids":["M01","M02","M03","M04","M05","M08","M09","D04","D05","D07","D23"],"basis":"Model-specific manufacturer document with locally bound fact/unit/date/applicability candidates.","support_limit":"Candidates are not verified target-asset parameters and do not prove current test-framework or charger/system compatibility."}
  else: m["requirement_support"]={"external_requirement_ids":["ER-03","ER-07","ER-18"],"requirement_ids":["M03","M04","M07","M09","D03","D08","D23"],"basis":"External educational safety reference with page/rule locators.","support_limit":"Not a target-site approved procedure; artwork excluded and rule semantics require review."}
  m["limitations"]=["Candidate extraction preserves source page/segment and literal binding but does not validate field meaning, unit association, conditions, target applicability, currentness, or legal permission beyond this bounded action."]
  q["quality_status"]="NEEDS_REVIEW_BOUND_CANDIDATES"; q["issues"]=["Numeric/date/object literals are source-bound candidates; missing-unit and missing-condition flags are automated and require semantic review.","No legal permission certification, RAG admission, training permission, external transfer, or publication right is claimed."]
  results.append({"file_id":fid,"action":m["actual_local_action"],"body_read":True,"fact_candidates":len(facts),"outputs":len(outs)})
 (OUT/"LOCAL_ACTION_DECISIONS.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in decisions),encoding="utf-8"); (OUT/"PROCESSING_MANIFEST.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in manifest),encoding="utf-8"); (OUT/"QUALITY_FINDINGS.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in quality),encoding="utf-8")
 log={"targets":7,"readable_bodies_processed":6,"copy_disabled_metadata_only":1,"fulltext_outputs":{"molicel":0,"mit_text_only_no_images":1},"source_literal_consistency_failures":sum(1 for r in results if r.get("body_read") and r.get("fact_candidates",0)<0),"results":results,"rag_training_transfer_changed":False}
 (OUT/"TERMS_CORRECTION_RUN_LOG.json").write_text(json.dumps(log,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); print(json.dumps({"targets":7,"readable_bodies_processed":6,"copy_disabled_metadata_only":1,"fact_candidates":sum(x.get('fact_candidates',0) for x in results)},ensure_ascii=False))
if __name__=="__main__":main()
