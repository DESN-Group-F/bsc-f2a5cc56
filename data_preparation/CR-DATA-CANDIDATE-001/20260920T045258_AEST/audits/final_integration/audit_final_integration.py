import hashlib
import json
from pathlib import Path

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")
READY=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
OUT=RUN/"audits/final_integration"; OUT.mkdir(parents=True,exist_ok=True)
def rows(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

scope=rows(RUN/"CANDIDATE_SCOPE.jsonl"); review_index=rows(RUN/"CANDIDATE_REVIEW_INDEX.jsonl"); current=rows(RUN/"CURRENT_FACT_INDEX.jsonl")
legacy=rows(READY/"documents/VERIFIED_FACTS.jsonl")
root=json.loads((RUN/"ROOT_CHECK_RESULTS.json").read_text(encoding="utf-8"))
decision=json.loads((RUN/"ROOT_DECISION.json").read_text(encoding="utf-8"))
identity=rows(RUN/"SOURCE_IDENTITY_CHECKS.jsonl")
lanes={
 "review_a":(RUN/"review_a/REVIEW_RESULTS.jsonl",RUN/"audits/review_a85/ITEM_AUDIT.jsonl",RUN/"audits/review_a85/CHECK_RESULTS.json"),
 "review_b":(RUN/"review_b/REVIEW_RESULTS.jsonl",RUN/"audits/review_b64/ITEM_AUDIT.jsonl",RUN/"audits/review_b64/CHECK_RESULTS.json"),
 "review_restricted":(RUN/"review_restricted/REVIEW_RESULTS.jsonl",RUN/"audits/review_restricted58/ITEM_AUDIT.jsonl",RUN/"audits/review_restricted58/CHECK_RESULTS.json")}
lane_details={}
all_results={}; all_audits={}
for name,(rp,ap,cp) in lanes.items():
    rr=rows(rp); aa=rows(ap); cc=json.loads(cp.read_text(encoding="utf-8")); lane_details[name]={"review_sha256":sha(rp),"audit_recorded_input_sha256":cc.get("input_review_results_sha256"),"review_items":len(rr),"audit_items":len(aa),"audit_status":cc.get("status")}
    all_results.update({x["fact_id"]:x for x in rr}); all_audits.update({x["fact_id"]:x for x in aa})
scope_ids={x["fact_id"] for x in scope}; review_ids={x["fact_id"] for x in review_index}; current_ids={x["fact_id"] for x in current}; legacy_ids={x["fact_id"] for x in legacy}
parameter=[x for x in review_index if x["parameter_record_ready"]]
def exact_fact_ref(ref):
    path, fact_id=ref.rsplit("#fact_id=",1)
    return sum(x.get("fact_id")==fact_id for x in rows(Path(path)))==1
use_counts={k:sum(x["current_build_use_status"]==k for x in review_index) for k in ["ALLOWED_CONDITIONAL","NOT_SELECTED_FOR_MINIMUM_BUILD_SET","NOT_ALLOWED_FOR_LOCAL_RAG"]}
parameter_use_counts={k:sum(x["current_build_use_status"]==k for x in parameter) for k in use_counts}
checks={
 "root_check_pass":root.get("status")=="PASS",
 "scope_review_audit_exact_207":len(scope_ids)==len(review_ids)==len(all_results)==len(all_audits)==207 and scope_ids==review_ids==set(all_results)==set(all_audits),
 "lane_shas_bound_to_audits":all(x["review_sha256"]==x["audit_recorded_input_sha256"] for x in lane_details.values()),
 "all_item_audits_pass":all(x.get("status")=="PASS" for x in all_audits.values()),
 "review_index_matches_lane_semantics":all(x["semantic_role"]==all_results[x["fact_id"]]["semantic_role"] and x["parameter_record_ready"]==all_results[x["fact_id"]]["parameter_record_ready"] and x["current_build_use_status"]==all_results[x["fact_id"]]["current_build_use_status"] for x in review_index),
 "legacy_and_review_form_exact_673":len(legacy_ids)==466 and not (legacy_ids&review_ids) and len(current_ids)==673 and current_ids==legacy_ids|review_ids,
 "all_207_resolved_no_unknowns":all(x["current_review_status"]=="RESOLVED" and not x["remaining_unknowns"] for x in review_index),
 "parameter_records_count_92":len(parameter)==92,
 "catalog_not_parameter":all(not x["parameter_record_ready"] and x["structured_reference_record_ready"] for x in review_index if x["semantic_role"]=="SOURCE_TRAINING_CATALOG_ENTRY"),
 "can_ids_interface_not_parameter":all(not x["parameter_record_ready"] and x["structured_interface_record_ready"] for x in review_index if x["semantic_role"]=="SOFTWARE_CHANGELOG_CAN_MESSAGE_IDENTIFIER_MAPPING"),
 "hazchem_codes_not_parameter":all(not x["parameter_record_ready"] and x["structured_code_record_ready"] for x in review_index if x["semantic_role"]=="HAZCHEM_EMERGENCY_ACTION_CODE"),
 "figure_labels_not_parameter":all(not x["parameter_record_ready"] for x in review_index if x["semantic_role"]=="SOURCE_FIGURE_CURVE_LABEL"),
 "restricted_58_stays_not_rag":sum(x["current_build_use_status"]=="NOT_ALLOWED_FOR_LOCAL_RAG" for x in review_index)==58 and all(x["current_build_use_status"]=="NOT_ALLOWED_FOR_LOCAL_RAG" for x in review_index if x["lane"]=="review_restricted"),
 "unresolved_file_empty":(RUN/"UNRESOLVED_CANDIDATES.jsonl").stat().st_size==0,
 "candidate_review_and_audit_locators_exact":all(exact_fact_ref(x["review_ref"]) and exact_fact_ref(x["independent_audit_ref"]) and exact_fact_ref(x["original_candidate_ref"]) for x in review_index),
 "current_index_locators_exact":all(exact_fact_ref(x["review_ref"]) for x in current),
 "source_identity_16_all_match":len(identity)==16 and sum(x["observed_bytes"] for x in identity)==3631613 and all(x["matches_registered_sha256"] for x in identity),
 "source_use_counts_65_84_58":use_counts=={"ALLOWED_CONDITIONAL":65,"NOT_SELECTED_FOR_MINIMUM_BUILD_SET":84,"NOT_ALLOWED_FOR_LOCAL_RAG":58},
 "parameter_use_counts_4_37_51":parameter_use_counts=={"ALLOWED_CONDITIONAL":4,"NOT_SELECTED_FOR_MINIMUM_BUILD_SET":37,"NOT_ALLOWED_FOR_LOCAL_RAG":51},
 "reviewed_207_precedence_only":decision.get("precedence","").startswith("For exactly these 207 IDs") and sum(x["reviewed_in_this_run"] for x in current)==207,
 "legacy_466_marked_not_reaudited":sum(x["current_review_status"]=="LEGACY_SOURCE_ASSERTION_CHECKED_NOT_REAUDITED_THIS_RUN" for x in current)==466,
 "permissions_not_upgraded":decision.get("source_use_not_changed")==use_counts and all(x["current_build_use_status"]==all_results[x["fact_id"]]["current_build_use_status"] for x in review_index),
 "external_limits_retained":all(any(token in claim.lower() for claim in decision.get("not_claimed",[])) for token in ["copy-controlled","target case","certification validity","rag/training","466 legacy"]),
 "root_decision_waits_for_this_audit":decision.get("status")=="PENDING_FINAL_INTEGRATION_AUDIT",
}
key_paths=[RUN/"build_current_index.py",RUN/"CANDIDATE_REVIEW_INDEX.jsonl",RUN/"CURRENT_FACT_INDEX.jsonl",RUN/"ROOT_CHECK_RESULTS.json",RUN/"SOURCE_IDENTITY_CHECKS.jsonl",RUN/"ROOT_TARGETED_REGRESSION.json",RUN/"README.md",RUN/"ROOT_DECISION.json",RUN/"audits/review_a85/CHECK_RESULTS.json",RUN/"audits/review_b64/CHECK_RESULTS.json",RUN/"audits/review_restricted58/CHECK_RESULTS.json"]
result={"status":"PASS_WITH_EXPLICIT_USE_LIMITS" if all(checks.values()) else "FAIL","checks":checks,"counts":{"reviewed_candidates":len(review_ids),"legacy_not_reaudited":len(legacy_ids),"current_fact_index":len(current_ids),"parameter_or_rule_records":len(parameter),"other_semantic_roles":len(review_index)-len(parameter),"source_use":use_counts,"parameter_or_rule_by_source_use":parameter_use_counts,"source_identity_files":len(identity),"source_identity_bytes":sum(x["observed_bytes"] for x in identity)},"lane_inputs":lane_details,
 "key_artifact_sha256":{str(p):sha(p) for p in key_paths},
 "evidence_scope":"This integration audit checks exact set joins, lane result/audit hash binding, per-item PASS records, status/role/readiness propagation, build-use preservation, and the 466+207=673 current index. It relies on the three completed content-level item audits and does not reread all source content again.",
 "use_limits":["Resolved means the candidate's source context and semantic role were resolved; it does not make every record a callable engineering parameter.","parameter_record_ready remains subordinate to current_build_use_status, source/version conditions and target-case applicability.","The 58 SRC-038 records remain NOT_ALLOWED_FOR_LOCAL_RAG.","The 466 legacy checked assertions were not semantically reaudited in this run; only two known parser-error patterns received the recorded targeted regression.","No RAG, database, model, current certification decision, UNSW adoption or case approval was performed."]}
(OUT/"FINAL_AUDIT.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
(OUT/"CHECK_RESULTS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
(OUT/"REPORT.md").write_text(f"# Final candidate integration audit\n\nStatus: **{result['status']}**. The exact 207 candidate set is covered by 207 PASS item audits and joins disjointly with 466 legacy source-assertion records to form the 673-record current index. Ninety-two records are source-bound parameter/rule candidates and 115 have other semantic roles. Catalog entries, CAN identifiers, Hazchem codes and figure labels are kept outside the physical parameter set. All 58 SRC-038 records remain excluded from local RAG. The 466 legacy records were not fully semantically reaudited.\n",encoding="utf-8")
print(json.dumps(result,ensure_ascii=True))
