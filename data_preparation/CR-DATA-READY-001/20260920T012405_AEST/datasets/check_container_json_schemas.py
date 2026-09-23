import json, pathlib, sys

R = pathlib.Path(__file__).parent
def load(p): return [json.loads(x) for x in p.read_text(encoding="utf-8-sig").splitlines() if x.strip()]

targets={(x["container_file_id"],x["member_path"]):x for x in load(R/"CONTAINER_MEMBER_SCHEMAS.jsonl") if x.get("read_status")=="BOUNDED_STREAM_SCHEMA_READ" and x.get("suffix")==".json"}
rows=load(R/"CONTAINER_JSON_FULL_SCHEMAS.jsonl")
keys=[(x["container_file_id"],x["member_path"]) for x in rows]
synthetic=[k for x in rows for k in list(x.get("field_names",[]))+list(x.get("path_types",{})) if "__reader_nonfinite__" in k]
known=[x for x in rows if x["container_file_id"].startswith("FILE-017-c5af") and x["member_path"].endswith("FastCharge_000049_CH37_structure.json")]
known_required={"current","diagnostic_interpolated","diagnostic_summary","internal_resistance","step_type","temperature","@version"}
known_fields=set(known[0]["field_names"]) if len(known)==1 else set()
checks={
 "target_count_229":len(targets)==229,
 "row_count_229":len(rows)==229,
 "unique_exact_target_set":len(set(keys))==len(keys) and set(keys)==set(targets),
 "all_complete":all(x.get("complete") and not x.get("error") for x in rows),
 "all_bytes_consumed":all(x.get("bytes_read")==x.get("member_bytes") for x in rows),
 "all_have_path_types":all(bool(x.get("path_types")) for x in rows),
 "parser_version_and_policy":all(x.get("parser_code_version")=="container-json-schema-v2-local-normalizer-no-injected-fields" and x.get("normalization_policy") for x in rows),
 "no_synthetic_reader_fields":not synthetic,
 "known_tail_fields_present":len(known)==1 and known_required <= known_fields,
}
result={"status":"PASS" if all(checks.values()) else "FAIL","checks":checks,"counts":{"targets":len(targets),"rows":len(rows),"unique":len(set(keys)),"bytes_read":sum(x.get("bytes_read",0) for x in rows),"paths":sum(len(x.get("path_types",{})) for x in rows)},"known_member_field_count":len(known_fields),"synthetic_hits":synthetic[:10],"scope":"Full sequential parse of all 229 targeted JSON archive members; records complete source paths and parser-view event types without returning values.","normalization_limit":"Bare non-finite tokens are counted and mapped to null only for structural parsing. Use the typed JSON reader for value semantics; null path types alone do not distinguish source null from non-finite tokens.","not_checked":["Scientific validity of values","unit semantics absent an authoritative field contract"],"command":f"python -B {__file__}"}
(R/"CONTAINER_JSON_SCHEMA_CHECKS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(result,ensure_ascii=False));sys.exit(0 if result["status"]=="PASS" else 1)
