#!/usr/bin/env python3
"""Reconcile bounded official supplements after targeted acquisition attempts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

RUN = Path(__file__).resolve().parents[1]
REQ = RUN / "requirements"
SUP = RUN / "public_supplements"
CHECKED = "2026-09-20"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


manifest_path = REQ / "PUBLIC_SUPPLEMENT_MANIFEST.jsonl"
manifest = read_jsonl(manifest_path)
by_id = {row["supplement_id"]: row for row in manifest}

# The NTC endpoint timed out in urllib but completed normally with curl using the same public URL.
adg = SUP / "ADG_Code_7.9_Vol_I_II.pdf"
row = by_id["PUBSUP-ADG-7.9"]
row.update(status="DOWNLOADED", local_path=str(adg.resolve()), bytes=adg.stat().st_size,
           sha256=digest(adg), content_type="application/pdf", error=None,
           acquisition_note="Initial urllib request timed out; same official public URL downloaded successfully with curl -L. No access control was bypassed.")

# Direct automated retrieval was refused. Keep precise official metadata and access condition; do not work around it.
for sid in ("PUBSUP-UNECE-REV8", "PUBSUP-UNECE-REV8-A1"):
    by_id[sid].update(
        status="METADATA_VERIFIED_ORIGINAL_NOT_ACQUIRED",
        acquisition_note="Official catalogue/document metadata verified on 2026-09-20; direct automated PDF request returned HTTP 403. No bypass attempted.",
        local_path=None, bytes=None, sha256=None,
    )

# Gold Book term pages were verified individually, but JSON endpoints rejected automated retrieval.
term_rows = [
    {"term_id":"09058", "term":"electrochemical cell", "doi":"10.1351/goldbook.09058", "source_url":"https://goldbook.iupac.org/terms/view/09058", "relevance":"Defines the cell concept used in chemistry and device descriptions."},
    {"term_id":"E01927", "term":"electric current", "doi":"10.1351/goldbook.E01927", "source_url":"https://goldbook.iupac.org/terms/view/E01927", "relevance":"Controls the electrical quantity name used by current and power calculations."},
    {"term_id":"E01956", "term":"electrode potential", "doi":"10.1351/goldbook.E01956", "source_url":"https://goldbook.iupac.org/terms/view/E01956", "relevance":"Controls terminology for potentials that require a stated reference electrode."},
]
for term in term_rows:
    term.update(edition="IUPAC Gold Book, 5th edition, online version 5.0.0 (2025)", checked_on=CHECKED,
                acquisition_mode="MANUAL_OFFICIAL_WEB_VERIFICATION",
                license="Individual term record: CC BY-SA 4.0; attribution and share-alike apply.",
                use_limit="Terminology locator only; no operating limit, model equation, or implementation validation.")
terms_path = SUP / "IUPAC_TERMS_DERIVED.json"
terms_path.write_text(json.dumps(term_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for sid in ("PUBSUP-IUPAC-CELL", "PUBSUP-IUPAC-CURRENT", "PUBSUP-IUPAC-POTENTIAL"):
    by_id[sid].update(
        status="OFFICIAL_TERM_VERIFIED_DERIVED_RECORD_ONLY",
        acquisition_note="Official term page, identifier, edition and licence verified; JSON endpoint returned HTTP 403, so no raw term file was acquired and no bypass was attempted.",
        local_path=None, bytes=None, sha256=None,
        derived_record_path=str(terms_path.resolve()), derived_record_sha256=digest(terms_path),
    )

write_jsonl(manifest_path, manifest)

decisions = []
for rec in manifest:
    if rec["status"] == "DOWNLOADED":
        decision, action = "ACQUIRE_BOUNDED_OFFICIAL_PUBLIC_REFERENCE", "downloaded official public original and recorded identity"
    elif rec["status"] == "OFFICIAL_TERM_VERIFIED_DERIVED_RECORD_ONLY":
        decision, action = "RETAIN_BOUNDED_VERIFIED_TERM_METADATA", "verified official term page and retained a small attributed locator record; raw JSON was not acquired"
    else:
        decision, action = "RETAIN_OFFICIAL_METADATA_AND_ACCESS_CONDITION", "recorded verified edition metadata and automated-access refusal; no local original retained"
    decisions.append({
        "supplement_id": rec["supplement_id"], "decision": decision, "checked_on": CHECKED,
        "user_authorization": "Complete the explicitly identified external public-data dependencies for UNSW course/noncommercial research.",
        "action_performed": action,
        "derivative_action": "bounded attributed term locator" if "IUPAC" in rec["supplement_id"] else "page-locator extraction only" if rec["supplement_id"] in ("PUBSUP-NIST-SP330-2019", "PUBSUP-BIPM-SI-9-4.01") else "none; original/bibliographic record only",
        "not_authorized": ["project Qwen/RAG ingestion", "training", "redistribution", "server transfer", "target-site approval"],
        "rights_and_access": rec["rights_and_access"],
        "manifest_ref": f"{manifest_path.resolve()}#supplement_id={rec['supplement_id']}",
    })
write_jsonl(REQ / "LOCAL_ACTION_DECISIONS.jsonl", decisions)

method_rows = [
    {"method_id":"units.convert", "requirement_id":"ER-12", "status":"REFERENCE_BASIS_PREPARED_IMPLEMENTATION_NOT_VALIDATED", "principle_basis":["PUBSUP-NIST-SP330-2019", "PUBSUP-BIPM-SI-9-4.01"], "basis_scope":"SI definitions, prefixes, named derived units and dimensional consistency.", "missing_before_validation":"Independent conversion vectors, boundary/error cases and implementation test results.", "explicit_nonclaim":"The SI brochures do not validate project code."},
    {"method_id":"electric.ohmic_power", "requirement_id":"ER-12", "status":"PROJECT_FORMULA_DECLARED_EXTERNAL_METHOD_SOURCE_AND_TESTS_MISSING", "principle_basis":[], "basis_scope":"Project contract declares P=I^2R; SI references support only units for ampere, ohm and watt.", "missing_before_validation":"Citable method derivation/source, assumptions (resistive element, RMS/DC interpretation), independent reference cases and implementation test results.", "explicit_nonclaim":"SI unit references alone do not establish or validate P=I^2R."},
    {"method_id":"series.integrate", "requirement_id":"ER-12", "status":"METHOD_POLICY_AND_TESTS_MISSING", "principle_basis":[], "basis_scope":"Project contract names Ah/Wh integration, but the numerical rule and data-quality policy are not fixed here.", "missing_before_validation":"Integration rule, timestamp ordering, interval/gap policy, sign convention, unit normalization and independent irregular-sampling tests.", "explicit_nonclaim":"No external public corpus or SI handbook validates the future integration implementation."},
]
write_jsonl(REQ / "METHOD_REFERENCE_STATUS.jsonl", method_rows)

gaps = read_jsonl(REQ / "PUBLIC_BASELINE_GAPS.jsonl")
states = {
    "PUB-001": ("PREPARED_WITH_EXPLICIT_METHOD_GAPS", False, False, "NIST SP330 2019 and BIPM SI v4.01 are local; three relevant IUPAC terms have attributed official-page locator records. ER12 implementation validation remains separate."),
    "PUB-002": ("CONDITIONALLY_PREPARED_LOCAL_ORIGINAL", False, False, "ADG 7.9 local original is prepared; it becomes applicable only if road/rail transport enters scope and still requires jurisdiction/competent-authority checks."),
    "PUB-003": ("CONDITIONALLY_PREPARED_LOCAL_GUIDANCE", False, False, "IATA 2026 public guidance is local; commercial DGR and carrier rules remain required only if air transport enters scope."),
    "PUB-004": ("CONDITIONAL_METADATA_PREPARED_ORIGINAL_NOT_ACQUIRED", False, False, "Rev.8 and Amendment 1 metadata are verified; automated official PDF access returned 403. Acquire through ordinary human access if transport/product acceptance enters scope, plus the target manufacturer's UN 38.3 summary."),
}
gap_supplements = {
    "PUB-001": ["PUBSUP-NIST-SP330-2019", "PUBSUP-BIPM-SI-9-4.01", "PUBSUP-IUPAC-CELL", "PUBSUP-IUPAC-CURRENT", "PUBSUP-IUPAC-POTENTIAL"],
    "PUB-002": ["PUBSUP-ADG-7.9"],
    "PUB-003": ["PUBSUP-IATA-2026"],
    "PUB-004": ["PUBSUP-UNECE-REV8", "PUBSUP-UNECE-REV8-A1"],
}
for gap in gaps:
    status, public_block, target_block, note = states[gap["public_gap_id"]]
    gap.update(status=status, blocks_public_reference_baseline=public_block, blocks_target_site_use=target_block,
               resolution_note=note,
               evidence_refs=[str(manifest_path.resolve()) + f"#supplement_id={sid}" for sid in gap_supplements[gap["public_gap_id"]]] + [str((REQ / "LOCAL_ACTION_DECISIONS.jsonl").resolve())])
    if gap["public_gap_id"] in ("PUB-002", "PUB-003", "PUB-004"):
        gap["conditional_trigger"] = "Only if the corresponding transport mode or product-acceptance task is selected for the release."
    if gap["public_gap_id"] == "PUB-001":
        gap["candidates"] = [
            {"publisher":"NIST", "url":"https://www.nist.gov/pml/special-publication-330/sp-330-section-2", "artifact":"NIST SP 330, 2019 edition", "access_condition":"Official current US SI publication; local PDF acquired."},
            {"publisher":"BIPM", "url":"https://www.bipm.org/en/publications/si-brochure", "artifact":"SI Brochure, 9th edition, version 4.01", "access_condition":"Official current international SI publication; local PDF acquired."},
            {"publisher":"IUPAC", "url":"https://goldbook.iupac.org/", "artifact":"Three selected Gold Book 5th-edition term records", "access_condition":"Individual term pages verified; attributed locator derivative retained; JSON endpoint refused automated access."},
        ]
write_jsonl(REQ / "PUBLIC_BASELINE_GAPS.jsonl", gaps)

matrix_path = REQ / "EXTERNAL_REQUIREMENT_MATRIX.jsonl"
matrix = read_jsonl(matrix_path)
for rec in matrix:
    if rec["external_requirement_id"] == "ER-12":
        rec["assessment"] = "Current SI references now support unit definitions only. The project contract declares P=I^2R and Ah/Wh integration, but independent method provenance, assumptions, numerical policy and implementation tests remain missing as detailed in METHOD_REFERENCE_STATUS.jsonl."
        rec["public_baseline_status"] = "SI_REFERENCE_PREPARED_METHOD_AND_IMPLEMENTATION_GAPS_EXPLICIT"
        rec["evidence_refs"] = [str((REQ / "METHOD_REFERENCE_STATUS.jsonl").resolve()), str(manifest_path.resolve()) + "#supplement_id=PUBSUP-NIST-SP330-2019", str(manifest_path.resolve()) + "#supplement_id=PUBSUP-BIPM-SI-9-4.01"]
write_jsonl(matrix_path, matrix)

downloaded = [r for r in manifest if r["status"] == "DOWNLOADED"]
result = {
    "manifest_records": len(manifest), "local_originals": len(downloaded),
    "local_original_bytes": sum(r["bytes"] for r in downloaded),
    "verified_term_locator_records": len(term_rows),
    "metadata_only_access_limited": sum(r["status"] == "METADATA_VERIFIED_ORIGINAL_NOT_ACQUIRED" for r in manifest),
    "method_status_records": len(method_rows), "budget_bytes": 60 * 1024 * 1024,
    "budget_pass": sum(r["bytes"] for r in downloaded) <= 60 * 1024 * 1024,
}
(REQ / "PUBLIC_SUPPLEMENT_CHECK_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
