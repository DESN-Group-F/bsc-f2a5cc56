import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")
READY = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
scope = [json.loads(x) for x in (RUN / "SOURCE_SCOPE.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
src = [x for x in scope if x["source"]["source_id"] == "SRC-038"]
records = []
for item in src:
    s = item["source"]
    records.append({
        "file_id": s["file_id"], "source_id": "SRC-038", "registered_sha256": s["registered_sha256"],
        "candidate_count": item["candidate_count"], "document_family_id": s["document_family_id"],
        "document_version_id": s["document_version_id"], "input_path": s["input_path"],
        "review_decision": "LOCAL_BOUNDED_CONTEXT_AND_SEMANTIC_REVIEW_ALLOWED_WITH_RESTRICTIONS",
        "action_permissions": {
            "local_human_viewing_of_registered_copy": "AVAILABLE_IF_PERFORMED_BUT_NOT_CLAIMED_BY_THIS_AI_REVIEW",
            "local_deterministic_or_manual_context_inspection": "ALLOWED_FOR_THIS_REVIEW",
            "bounded_ai_assisted_semantic_inspection_in_current_task": "ALLOWED_AS_MINIMUM_NECESSARY_SUBSCOPE_OF_USER_AUTHORIZED_207_CANDIDATE_COMPLETION",
            "bounded_fact_locator_and_nonverbatim_semantic_findings": "ALLOWED_FOR_THIS_REVIEW",
            "condition_table_header_footnote_negation_exception_check": "ALLOWED_FOR_THIS_REVIEW",
            "retain_small_review_metadata_without_restricted_verbatim_text": "ALLOWED_FOR_THIS_REVIEW",
            "local_search_or_rag_ingestion": "NOT_ALLOWED",
            "persistent_model_or_llm_corpus_ingestion": "NOT_ALLOWED",
            "training": "NOT_ALLOWED",
            "public_or_third_party_redistribution": "NOT_ALLOWED",
            "commercial_reuse": "NOT_ALLOWED",
            "copy_control_or_access_control_bypass": "NOT_ALLOWED"
        },
        "conditions": [
            "Use only the three exact registered local files and the 58 frozen candidate IDs.",
            "AI-assisted inspection is limited to the minimum candidate-adjacent page/text/table context needed for this one review and must not create a reusable source corpus.",
            "Do not emit or persist restricted source passages; record locators, structured bindings, short nonverbatim findings, and unresolved limitations.",
            "Do not modify source files, old snapshots, or the source workspace Python environment.",
            "This review action does not change the current NOT_ALLOWED_FOR_LOCAL_RAG build-use decision or create a reuse licence.",
            "Manufacturer statements remain product/version-specific and do not become UNSW rules, approvals, or general battery limits."
        ],
        "evidence_refs": [
            str(RUN / "SOURCE_SCOPE.jsonl") + "#file_id=" + s["file_id"],
            str(RUN / "CANDIDATE_SCOPE.jsonl") + "#file_id=" + s["file_id"],
            str(Path(r"E:\desn 2000\bsc\backlog\CR_DATA_CANDIDATE_001_TASK_CARDS.md")) + "#SRC-038",
            str(READY / "audits/final_build_usability/BUILD_USE_DECISIONS.jsonl") + "#decision_id=BUILD-EXPLICIT-RESTRICTIONS",
            item["build_use"]["local_preparation_ref"]
        ],
        "rights_interpretation_limit": "Operational review decision for the user-authorized internal noncommercial research task; not legal approval and not permission for downstream model/RAG use."
    })

result = {
    "status": "ALLOWED_WITH_RESTRICTIONS_FOR_EXACT_LOCAL_REVIEW_ACTION",
    "scope": "SRC-038 candidate context/semantic review only",
    "counts": {"files": len(records), "candidates": sum(x["candidate_count"] for x in records)},
    "files": records,
    "current_build_use_unchanged": "NOT_ALLOWED_FOR_LOCAL_RAG",
    "decision_summary": "The user's existing authorization covers completion of the full 207-candidate batch; coordinator assignment identifies these 58 SRC-038 candidates as a minimum necessary sub-scope. It was not a separate SRC-038 permission and does not create third-party rights. Exact-candidate, minimum-context AI-assisted review and nonverbatim findings are treated as the bounded review action needed for that task, distinct from persistent model corpus or RAG ingestion. The old generic AI/RAG restriction does not bar all local inspection, but it still bars reusable model/RAG ingestion, training, redistribution, commercial reuse, and access-control bypass. Human viewing is an available action, not an action claimed as performed by the AI agent.",
    "revision_history": [
        {"revision": 1, "correction": "Separated bounded local review from downstream RAG/model admission."},
        {"revision": 2, "correction": "Removed any implication that human review was performed by the AI agent and distinguished transient minimum-context AI review from persistent corpus ingestion."},
        {"revision": 3, "correction": "Clarified that authorization is for the full 207-candidate completion; SRC-038 is a coordinator-assigned sub-scope, not a separate user grant or third-party licence."}
    ],
    "unknowns": ["No general manufacturer reuse licence was established; outputs must remain bounded and nonverbatim."]
}
(RUN / "rights_review").mkdir(parents=True, exist_ok=True)
(RUN / "rights_review/ACTION_REVIEW.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["counts"]))
