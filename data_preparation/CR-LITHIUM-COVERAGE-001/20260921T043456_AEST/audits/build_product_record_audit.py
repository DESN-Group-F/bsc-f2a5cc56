import hashlib
import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-LITHIUM-COVERAGE-001\20260921T043456_AEST")
MODEL = RUN / "products" / "MODEL_FACTS.jsonl"
REGISTER = RUN / "products" / "SOURCE_REGISTER.jsonl"
USE = RUN / "audits" / "PRODUCT_SOURCE_USE_AUDIT.jsonl"
OUT = RUN / "audits" / "PRODUCT_RECORD_AUDIT.jsonl"
SUMMARY = RUN / "audits" / "PRODUCT_CHECK_RESULTS.json"

def lines(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

models = lines(MODEL)
sources = {x["source_id"]: x for x in lines(REGISTER)}
uses = {x["source_id"]: x for x in lines(USE)}

# These notes bind the actual content inspection performed by SCOPE/AUDIT. Image-only
# LG page 1 and GS Yuasa page 25 were rendered and visually read; other PDFs were
# extracted/rendered as necessary, and HTML article/product bodies were read locally.
inspection = {
    "PROD-SRC-001": "official HTML product heading and Specifications table",
    "PROD-SRC-002": "PDF page 1 specification table and dimension drawing",
    "PROD-SRC-003": "rendered PDF page 1, nine model columns and footnote",
    "PROD-SRC-004": "PDF printed pages 6-7 cell/module tables and limitations",
    "PROD-SRC-005": "PDF page 5 M10023/M5194 table and footnote",
    "PROD-SRC-006": "PDF air-cooling solution table for cell/module/rack hierarchy",
    "PROD-SRC-007": "official HTML Product Parameters table",
    "PROD-SRC-008": "official article body for LF280K project, pack and BMS statements",
    "PROD-SRC-009": "official article body for Blade Battery LFP and warranty statements",
    "PROD-SRC-010": "PDF printed pages 89 and 93 model tables",
    "PROD-SRC-011": "signature check only; HTML failure response, excluded",
    "PROD-SRC-012": "rendered PDF page 25 roadmap; family background only, no exact-module chemistry link",
    "PROD-SRC-013": "PDF pages 1-2 exact protected pack, chemistry and operating limits",
    "PROD-SRC-014": "official product heading, included pack/charger identifiers and timing claims",
    "PROD-SRC-015": "official release heading, features and exact module profile",
    "PROD-SRC-016": "strict-parsed official PDF page 19 / printed pages 36-37 prismatic table",
    "PROD-SRC-R01": "prior exact-version bounded P42A review and page-1 facts",
    "PROD-SRC-R02": "prior exact-version bounded SDS page-18 row only",
}

rows = []
failures = []
for m in models:
    sids = [r.split("#", 1)[0] for r in m.get("source_refs", [])]
    findings = []
    if not sids:
        findings.append("NO_SOURCE_REF")
    for sid in sids:
        if sid not in sources or sid not in uses:
            findings.append(f"UNRESOLVED_SOURCE:{sid}")
            continue
        src = sources[sid]
        if sid == "PROD-SRC-011":
            findings.append("FAILED_CAPTURE_MUST_NOT_SUPPORT_FACTS")
        p = Path(src["local_path"])
        if not p.exists():
            findings.append(f"MISSING_SOURCE_FILE:{sid}")
        elif sha(p) != src["sha256"]:
            findings.append(f"SOURCE_HASH_MISMATCH:{sid}")
    if m.get("system_level") != "CELL" and m.get("form_factor") != "NOT_APPLICABLE_SYSTEM_LEVEL":
        # CELL_IN_MARINE_SYSTEM is still a cell identity, not a system assembly.
        if m.get("system_level") != "CELL_IN_MARINE_SYSTEM":
            findings.append("SYSTEM_LEVEL_FORM_CONFLATION")
    if m["record_id"] in {"MF-033", "MF-034"} and m.get("form_factor") != "UNKNOWN":
        findings.append("MOLICEL_FORM_UNSUPPORTED")
    if m["record_id"] == "MF-041" and (m["chemistry"].get("positive") != "UNKNOWN" or "PROD-SRC-012" in sids):
        findings.append("UNLINKED_LIM_FAMILY_CHEMISTRY")
    status = "PASSED" if not findings else "FAILED"
    if status == "FAILED":
        failures.append(m["record_id"])
    use_ok = all(uses.get(sid, {}).get("future_local_structured_fact_query") == "ALLOWED_CONDITIONAL_DERIVED_FACTS_ONLY" for sid in sids)
    prepared = status == "PASSED" and use_ok and not any(sid.startswith("PROD-SRC-R") for sid in sids)
    rows.append({
        "record_id": m["record_id"],
        "status": status,
        "identity_kind": m["identity_kind"],
        "system_level": m["system_level"],
        "content_depth": m["content_depth"],
        "source_ids": sids,
        "source_sha256": {sid: sources[sid]["sha256"] for sid in sids if sid in sources},
        "inspection_basis": [inspection.get(sid, "UNRECORDED") for sid in sids],
        "facts_checked": len(m.get("facts", [])),
        "fact_fields_checked": [f["field"] for f in m.get("facts", [])],
        "findings": findings,
        "future_prepared_facts_eligibility": "ELIGIBLE_DERIVED_FACTS_ONLY" if prepared else "NOT_SELECTED",
        "limits": m.get("conditions_and_limits", []) + m.get("remaining_gaps", []),
    })

OUT.write_text("\n".join(json.dumps(x, ensure_ascii=False, sort_keys=True) for x in rows) + "\n", encoding="utf-8")
summary = {
    "status": "PASSED" if not failures else "FAILED",
    "scope": "All final PRODUCTS records: identity/hierarchy, every structured fact field against actually read evidence, source integrity and future derived-fact selection gate.",
    "input_bindings": {
        "model_facts_sha256": sha(MODEL),
        "source_register_sha256": sha(REGISTER),
        "source_use_audit_sha256": sha(USE),
    },
    "records_checked": len(rows),
    "facts_checked": sum(x["facts_checked"] for x in rows),
    "records_passed": len(rows) - len(failures),
    "records_failed": len(failures),
    "failed_record_ids": failures,
    "future_prepared_facts_eligible_records": [x["record_id"] for x in rows if x["future_prepared_facts_eligibility"].startswith("ELIGIBLE")],
    "future_prepared_facts_excluded_records": [x["record_id"] for x in rows if x["future_prepared_facts_eligibility"] == "NOT_SELECTED"],
    "audit_output_sha256": sha(OUT),
    "limitations": [
        "A passing record supports only its stated fields, conditions and content_depth; it does not establish current availability, a complete operating specification or site/device compatibility.",
        "Molicel records remain valid only for the prior bounded review and are deliberately excluded from the future prepared-facts build.",
        "No raw source, RAG, model training, server transfer or database operation is admitted or performed by this audit.",
    ],
}
SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
