"""Aggregate candidate flags without rereading source content."""
import json
from pathlib import Path
ROOT=Path(r"E:\desn 2000\bsc"); OUT=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/documents67"
mp=OUT/"PROCESSING_MANIFEST.jsonl"; rows=[json.loads(x) for x in mp.open(encoding="utf-8") if x.strip()]
for row in rows:
 if row["status"]!="LOCALLY_PREPARED_BOUNDED_TERMS_AWARE": continue
 fp=OUT/"derived"/f"{row['file_id']}.fact_candidates.jsonl"; cs=[json.loads(x) for x in fp.open(encoding="utf-8") if x.strip()]
 row["profile"]["source_literal_consistency_failure_count"]=sum(not x["source_literal_consistency"] for x in cs)
 row["profile"]["missing_unit_flag_count"]=sum(x["missing_unit_flag"] for x in cs)
 row["profile"]["condition_not_automatically_verified_count"]=sum(x["condition_context_flag"]=="CONDITION_NOT_AUTOMATICALLY_VERIFIED" for x in cs)
mp.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in rows),encoding="utf-8")
print(json.dumps({"objects":sum(x['status']=="LOCALLY_PREPARED_BOUNDED_TERMS_AWARE" for x in rows),"source_literal_consistency_failures":sum(x.get('profile',{}).get('source_literal_consistency_failure_count',0) for x in rows),"missing_unit_flags":sum(x.get('profile',{}).get('missing_unit_flag_count',0) for x in rows),"conditions_pending":sum(x.get('profile',{}).get('condition_not_automatically_verified_count',0) for x in rows)}))
