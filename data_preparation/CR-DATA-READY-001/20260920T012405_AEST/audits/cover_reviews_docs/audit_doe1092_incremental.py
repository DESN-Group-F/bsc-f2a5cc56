import hashlib
import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")

def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

readiness = [r for r in rows(RUN / "documents/SUPPLEMENT_READINESS.jsonl") if "1092" in r.get("supplement_id", "")]
pages_path = RUN / "documents/derived/coverage_supplements/DOE_HDBK_1092_2013.pages.jsonl"
facts_path = RUN / "documents/derived/coverage_supplements/DOE_HDBK_1092_2013.facts.jsonl"
pages = rows(pages_path)
facts = rows(facts_path)
manifest = [r for r in rows(RUN / "coverage/SUPPLEMENT_MANIFEST.jsonl") if "1092" in r.get("supplement_id", "")]

page_keys = {(r.get("pdf_page"), r.get("source_sha256")) for r in pages}
fact_refs = []
for fact in facts:
    refs = fact.get("evidence_refs", fact.get("evidence_ref", []))
    if isinstance(refs, str): refs = [refs]
    fact_refs.extend(refs)
selector_hits = []
for ref in fact_refs:
    selector = ref.rsplit("#pdf_page=", 1)[-1]
    selector_hits.append(sum(str(r.get("pdf_page")) == selector for r in pages))

required_limits = ("Not an invoked standard", "UNSW", "must not be generalized")
checks = {
    "three_readiness_records": len(readiness) == 3,
    "twenty_one_unique_selected_pages": len(pages) == 21 and len({r.get("pdf_page") for r in pages}) == 21,
    "six_unique_bounded_facts": len(facts) == 6 and len({r.get("fact_id") for r in facts}) == 6,
    "readiness_hashes_match_payloads": all(Path(r["input_path"]).exists() and sha(Path(r["input_path"])) == r["input_sha256"] for r in readiness),
    "manifest_bindings_present": len(manifest) == 3,
    "all_facts_have_locator_refs": all((f.get("evidence_refs") or f.get("evidence_ref")) for f in facts),
    "fact_refs_target_page_artifact": all("DOE_HDBK_1092_2013.pages.jsonl" in ref for ref in fact_refs),
    "fact_page_selectors_resolve_exactly_once": bool(selector_hits) and all(hit == 1 for hit in selector_hits),
    "scope_boundaries_explicit": all(all(term in " ".join(r.get("limitations", [])) for term in required_limits) for r in readiness),
    "documents_do_not_self_admit_to_rag": all(r.get("rag_or_index_status") == "NOT_ADMITTED" for r in readiness),
    "document_checks_pass": json.loads((RUN / "documents/CHECK_RESULTS.json").read_text(encoding="utf-8")).get("overall") == "PASS",
}

result = {
    "status": "PASS_WITH_EXPLICIT_SCOPE_LIMITS" if all(checks.values()) else "FAIL",
    "review_scope": "Incremental independent review of DOE-HDBK-1092-2013 document contentization; no RAG build and no full-document rescan.",
    "checks": checks,
    "counts": {"readiness_records": len(readiness), "selected_pages": len(pages), "bounded_facts": len(facts), "manifest_records": len(manifest)},
    "conclusion": "The handbook is contentized with exact local bindings and bounded page/fact locators for external DOE research/test-facility comparison. It is not an UNSW procedure, activity approval, invoked standard, or chemistry-general operating rule. Documents keeps it NOT_ADMITTED; the separately reviewed current build-use overlay controls any later scoped retrieval action.",
    "unknowns": [],
}
out = RUN / "audits/cover_reviews_docs/DOE1092_INCREMENTAL_REVIEW.json"
out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=True))
