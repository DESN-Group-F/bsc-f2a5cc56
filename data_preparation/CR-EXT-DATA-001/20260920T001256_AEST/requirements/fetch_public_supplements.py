#!/usr/bin/env python3
"""Fetch the small, explicitly approved EXT-01 official public supplements."""
from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from pathlib import Path

RUN = Path(__file__).resolve().parents[1]
REQ = RUN / "requirements"
DEST = RUN / "public_supplements"
DEST.mkdir(parents=True, exist_ok=True)
MAX_TOTAL = 60 * 1024 * 1024
CHECKED = "2026-09-20"

ITEMS = [
    {"id":"PUBSUP-NIST-SP330-2019","name":"NIST_SP330_2019.pdf","url":"https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.330-2019.pdf","publisher":"NIST","edition":"NIST SP 330, 2019 edition; US version of SI Brochure 9th edition","purpose":"Current SI definitions and derived-unit reference for the bounded unit/electrical tools.","rights":"Official publication available free of charge; retain citation. Not a validation of project formulas."},
    {"id":"PUBSUP-BIPM-SI-9-4.01","name":"BIPM_SI_Brochure_9_v4.01.pdf","url":"https://www.bipm.org/documents/d/guest/si-brochure-9-pdf","publisher":"BIPM","edition":"SI Brochure, 9th edition, version 4.01","purpose":"Current international SI reference; supersedes treating older SP811 definitions as current.","rights":"Official public PDF; retain as bibliographic/reference original and cite version."},
    {"id":"PUBSUP-ADG-7.9","name":"ADG_Code_7.9_Vol_I_II.pdf","url":"https://www.ntc.gov.au/sites/default/files/assets/files/Australian%20Code%20for%20the%20Transport%20of%20Dangerous%20Goods%20by%20Road%20%26%20Rail%20-%20Edition%207.9%20%28Volume%20I%20%26%20II%29.pdf","publisher":"National Transport Commission","edition":"Australian Dangerous Goods Code, Edition 7.9 (2024); mandatory from 2025-10-01 subject to jurisdiction commencement","purpose":"Conditional road/rail reference baseline only when M08 road/rail transport is in scope.","rights":"Official public download. Keep original and bibliographic metadata; Appendix C copying restriction and jurisdictional law/competent-authority advice remain applicable.","no_text_derivative":True},
    {"id":"PUBSUP-IATA-2026","name":"IATA_Battery_Guidance_2026.pdf","url":"https://www.iata.org/contentassets/05e6d8742b0047259bf3a700bc9d42b9/lithium-battery-guidance-document.pdf","publisher":"IATA","edition":"Guidance Document for Lithium Batteries and Sodium Ion Batteries, 2026; dated 2026-01-01","purpose":"Conditional public air-transport guidance baseline; does not replace 2026 DGR or carrier rules.","rights":"Public guidance PDF. Commercial DGR was not downloaded; retain original and bibliographic metadata only.","no_text_derivative":True},
    {"id":"PUBSUP-UNECE-REV8","name":"UNECE_Manual_Tests_Criteria_Rev8.pdf","url":"https://unece.org/sites/default/files/2023-11/ST_SG_AC.10_11_Rev.8e_WEB.pdf","publisher":"UNECE","edition":"ST/SG/AC.10/11/Rev.8, 2023","purpose":"Conditional official UN test-framework reference including subsection 38.3; target manufacturer test summary remains required.","rights":"Free non-editable electronic consultation copy. Reproduction, republishing, mirroring or translation requires separate rights handling; no text derivative made.","no_text_derivative":True},
    {"id":"PUBSUP-UNECE-REV8-A1","name":"UNECE_Manual_Tests_Criteria_Rev8_Amend1.pdf","url":"https://unece.org/sites/default/files/2025-09/ST-SG-AC10-11-Rev8-Amend1e.pdf","publisher":"UNECE","edition":"ST/SG/AC.10/11/Rev.8/Amend.1, 2025","purpose":"Amendment 1 used together with Rev.8; includes changes affecting subsection 38.3.","rights":"Free non-editable electronic consultation copy; copyright and reproduction restrictions retained; no text derivative made.","no_text_derivative":True},
    {"id":"PUBSUP-IUPAC-CELL","name":"IUPAC_09058_electrochemical_cell.json","url":"https://goldbook.iupac.org/terms/view/09058/json","publisher":"IUPAC","edition":"Gold Book 5th ed., online version 5.0.0 (2025), term 09058","purpose":"Controlled definition of electrochemical cell.","rights":"Individual Gold Book term CC BY-SA 4.0; attribution/version required.","term":True},
    {"id":"PUBSUP-IUPAC-CURRENT","name":"IUPAC_E01927_electric_current.json","url":"https://goldbook.iupac.org/terms/view/E01927/json","publisher":"IUPAC","edition":"Gold Book 5th ed., online version 5.0.0 (2025), term E01927","purpose":"Controlled definition of electric current.","rights":"Individual Gold Book term CC BY-SA 4.0; attribution/version required.","term":True},
    {"id":"PUBSUP-IUPAC-POTENTIAL","name":"IUPAC_E01956_electrode_potential.json","url":"https://goldbook.iupac.org/terms/view/E01956/json","publisher":"IUPAC","edition":"Gold Book 5th ed., term E01956; check record status/version in downloaded JSON","purpose":"Controlled definition of electrode potential and its reference-electrode condition.","rights":"Individual Gold Book term CC BY-SA 4.0; attribution/version required.","term":True},
]


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fetch(item: dict, used: int) -> tuple[dict, int]:
    path = DEST / item["name"]
    req = urllib.request.Request(item["url"], headers={"User-Agent":"BatterySafetyCopilot-Research/0.1 (bounded official reference fetch)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            ctype = response.headers.get("Content-Type")
            declared = response.headers.get("Content-Length")
            if declared and used + int(declared) > MAX_TOTAL:
                raise RuntimeError("download budget would be exceeded")
            data = response.read(MAX_TOTAL - used + 1)
            final_url = response.geturl()
        if used + len(data) > MAX_TOTAL:
            raise RuntimeError("download budget exceeded")
        path.write_bytes(data)
        status, error = "DOWNLOADED", None
    except Exception as exc:
        data, final_url, ctype = b"", item["url"], None
        status, error = "NOT_ACQUIRED", f"{type(exc).__name__}: {exc}"
    record = {
        "supplement_id":item["id"], "publisher":item["publisher"], "title_or_edition":item["edition"],
        "requested_url":item["url"], "final_url":final_url, "checked_on":CHECKED,
        "status":status, "local_path":str(path.resolve()) if status == "DOWNLOADED" else None,
        "bytes":len(data) if status == "DOWNLOADED" else None,
        "sha256":sha(path) if status == "DOWNLOADED" else None,
        "content_type":ctype, "purpose":item["purpose"], "rights_and_access":item["rights"],
        "processing_scope":"ORIGINAL_AND_BIBLIOGRAPHIC_METADATA_ONLY" if item.get("no_text_derivative") else "BOUNDED_REFERENCE_EXTRACTION_ALLOWED",
        "limitations":["Not admitted to project Qwen/RAG/training by this action.", "Does not establish target-site or target-asset applicability."],
        "error":error,
    }
    return record, used + len(data)


def derive_terms(manifest: list[dict]) -> list[dict]:
    out = []
    for item in ITEMS:
        if not item.get("term"):
            continue
        rec = next(x for x in manifest if x["supplement_id"] == item["id"])
        if rec["status"] != "DOWNLOADED":
            continue
        raw = json.loads(Path(rec["local_path"]).read_text(encoding="utf-8"))
        # Preserve a small, inspectable subset; raw official JSON remains alongside it.
        definition = raw.get("definition") or raw.get("text") or raw.get("term")
        title = raw.get("title") or raw.get("name") or item["edition"]
        out.append({
            "supplement_id":item["id"], "title":title, "definition":definition,
            "doi":raw.get("doi"), "status":raw.get("status"), "source_url":item["url"],
            "raw_sha256":rec["sha256"], "license":"CC BY-SA 4.0 for individual Gold Book terms",
            "use_limit":"Terminology only; not a battery operating limit, model equation or validation result."
        })
    (DEST / "IUPAC_TERMS_DERIVED.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def derive_si_locators(manifest: list[dict]) -> list[dict]:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        return [{"status":"NOT_DERIVED", "reason":f"pypdf unavailable: {exc}"}]
    result = []
    for sid in ("PUBSUP-NIST-SP330-2019", "PUBSUP-BIPM-SI-9-4.01"):
        rec = next(x for x in manifest if x["supplement_id"] == sid)
        if rec["status"] != "DOWNLOADED":
            continue
        reader = PdfReader(rec["local_path"])
        matches = []
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            terms = sorted({t for t in ("ampere", "coulomb", "volt", "ohm", "watt", "joule", "kelvin") if re.search(rf"\b{t}\b", text, re.I)})
            if terms:
                matches.append({"page_1_based":index + 1, "matched_terms":terms})
        result.append({"supplement_id":sid, "pdf_pages":len(reader.pages), "term_locator_pages":matches,
                       "extraction_scope":"Page locators only; no full-text derivative retained.", "source_sha256":rec["sha256"]})
    (DEST / "SI_ELECTRICAL_TERM_LOCATORS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    used = 0
    manifest = []
    for item in ITEMS:
        rec, used = fetch(item, used)
        manifest.append(rec)
    terms = derive_terms(manifest)
    locators = derive_si_locators(manifest)
    with (REQ / "PUBLIC_SUPPLEMENT_MANIFEST.jsonl").open("w", encoding="utf-8", newline="\n") as fh:
        for row in manifest:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    decisions = []
    for rec in manifest:
        decisions.append({
            "supplement_id":rec["supplement_id"], "decision":"ACQUIRE_BOUNDED_OFFICIAL_PUBLIC_REFERENCE" if rec["status"] == "DOWNLOADED" else "RECORD_ACCESS_FAILURE",
            "user_authorization":"Complete the explicitly identified external public-data dependencies for UNSW course/noncommercial research.",
            "action_performed":"download official public original and record identity" if rec["status"] == "DOWNLOADED" else "attempt official public access; no file retained",
            "derivative_action":"bounded terminology normalization" if "IUPAC" in rec["supplement_id"] else "page-locator extraction only" if "SI" in rec["supplement_id"] or "NIST" in rec["supplement_id"] else "none; original/bibliographic record only",
            "not_authorized":["project Qwen/RAG ingestion", "training", "redistribution", "server transfer", "target-site approval"],
            "rights_and_access":rec["rights_and_access"], "manifest_ref":f"{(REQ/'PUBLIC_SUPPLEMENT_MANIFEST.jsonl').resolve()}#supplement_id={rec['supplement_id']}"
        })
    with (REQ / "LOCAL_ACTION_DECISIONS.jsonl").open("w", encoding="utf-8", newline="\n") as fh:
        for row in decisions:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    result = {"attempted":len(manifest), "downloaded":sum(x["status"] == "DOWNLOADED" for x in manifest),
              "failed":sum(x["status"] != "DOWNLOADED" for x in manifest), "downloaded_bytes":used,
              "budget_bytes":MAX_TOTAL, "iupac_terms_derived":len(terms), "si_locator_records":len(locators)}
    (REQ / "PUBLIC_SUPPLEMENT_CHECK_RESULTS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
