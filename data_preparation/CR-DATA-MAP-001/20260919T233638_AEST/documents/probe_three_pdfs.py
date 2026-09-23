"""Bounded original-PDF supplement for the three already identified PDFs.

The script verifies exact file/hash ledger bindings, reads PDF structure dictionaries
for all pages, and extracts text only from pages 1, 2, and the final page. It does
not hash, render, OCR, or emit source text.
"""
from __future__ import annotations

import json
from pathlib import Path, PurePosixPath

from pypdf import PdfReader

ROOT = Path(r"E:\desn 2000\bsc")
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
RUN = ROOT / "data_preparation/CR-DATA-MAP-001/20260919T233638_AEST"
SCOPE = RUN / "INPUT_SCOPE.jsonl"
FRAGMENT = RUN / "documents/MAPPING_FRAGMENT.jsonl"
DETAIL = RUN / "documents/PDF_STRUCTURE_SUPPLEMENT.jsonl"
LOG = RUN / "documents/PDF_STRUCTURE_RUN_LOG.json"
TARGETS = {
    "FILE-033-33a4e757c19d-602c0c",
    "FILE-034-92cb3a2b7136-5d2d70",
    "FILE-040-74c92ba472d0-881681",
}


def local_basis(row: dict) -> tuple[dict, str] | None:
    for rec in row.get("existing_rights_records") or []:
        if rec.get("file_id") == row["file_id"] and rec.get("file_sha256") == row["sha256_registered"] and rec.get("ai_processing") == "ALLOWED":
            return rec, "EXACT_FILE_ID_AND_SHA256"
    effective = (row.get("prior_routing") or {}).get("rights_record", {}).get("effective_rights_id")
    for rec in row.get("existing_rights_records") or []:
        if not rec.get("file_id") and rec.get("source_id") == row["source_id"] and rec.get("rights_id") == effective and rec.get("ai_processing") == "ALLOWED":
            return rec, "RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS"
    return None


def has_image_resource(page) -> bool:
    try:
        resources = page.get("/Resources") or {}
        resources = resources.get_object() if hasattr(resources, "get_object") else resources
        xobjects = resources.get("/XObject") or {}
        xobjects = xobjects.get_object() if hasattr(xobjects, "get_object") else xobjects
        for obj in xobjects.values():
            obj = obj.get_object() if hasattr(obj, "get_object") else obj
            if obj.get("/Subtype") == "/Image":
                return True
    except Exception:
        return False
    return False


def safe_path(relative: str) -> Path:
    rel = PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("unsafe registered relative path")
    path = SOURCE.joinpath(*rel.parts).resolve()
    if not path.is_relative_to(SOURCE.resolve()):
        raise ValueError("registered path escapes source root")
    return path


def main() -> None:
    scope_rows = [json.loads(x) for x in SCOPE.open(encoding="utf-8") if x.strip()]
    by_id = {x["file_id"]: x for x in scope_rows}
    fragment = [json.loads(x) for x in FRAGMENT.open(encoding="utf-8") if x.strip()]
    prior_details = {}
    if DETAIL.is_file():
        prior_details = {x["file_id"]: x for x in (json.loads(line) for line in DETAIL.open(encoding="utf-8") if line.strip()) if x.get("status") == "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED"}
    details = []
    newly_read = 0
    for fid in sorted(TARGETS):
        row = by_id[fid]
        resolved = local_basis(row)
        if resolved is None:
            details.append({"file_id": fid, "status": "NOT_PROBED_NO_LOCAL_BASIS", "error": "No resolver-compatible AI-processing ALLOWED record matched exact file/hash or recorded group scope for the exact acquired representation."})
            continue
        rec, binding = resolved
        if fid in prior_details:
            details.append(prior_details[fid])
            continue
        path = safe_path(row["relative_path"])
        try:
            newly_read += 1
            reader = PdfReader(path)
            page_count = len(reader.pages)
            selected = sorted({i for i in (0, 1, page_count - 1) if 0 <= i < page_count})
            pages = []
            for i, page in enumerate(reader.pages):
                entry = {
                    "page_number_1_based": i + 1,
                    "content_stream_present": page.get("/Contents") is not None,
                    "image_xobject_present": has_image_resource(page),
                    "text_layer_character_count": None,
                    "text_layer_checked": i in selected,
                }
                if i in selected:
                    entry["text_layer_character_count"] = len(page.extract_text() or "")
                pages.append(entry)
            detail = {
                "file_id": fid,
                "status": "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED",
                "registered_sha256": row["sha256_registered"],
                "rights_binding": binding,
                "rights_id": rec["rights_id"],
                "rights_ref": f"{SCOPE}#file_id={fid}/existing_rights_records/rights_id={rec['rights_id']}",
                "source_path": str(path),
                "page_count": page_count,
                "text_layer_pages_checked_1_based": [i + 1 for i in selected],
                "read_budget": "All page dictionaries: /Contents presence and direct /Image XObject presence; extract_text only on first two and final page; no OCR/render/hash.",
                "pages": pages,
                "limitations": ["Image check covers direct page /XObject resources only; nested form images may be missed.", "Selected-page text counts do not establish text-layer availability across every page.", "No visual layout, scan completeness, figure meaning, or table geometry/correctness was verified."],
            }
        except Exception as exc:
            detail = {"file_id": fid, "status": "PDF_STRUCTURE_PROBE_FAILED", "registered_sha256": row["sha256_registered"], "rights_binding": binding, "rights_id": rec["rights_id"], "source_path": str(path), "error_type": type(exc).__name__, "error": str(exc)}
        details.append(detail)

    detail_by_id = {x["file_id"]: x for x in details}
    for item in fragment:
        if item["file_id"] not in TARGETS:
            continue
        d = detail_by_id[item["file_id"]]
        if item.get("profile", {}).get("original_pdf_bounded_probe") and d["status"] == "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED":
            continue
        item["content_access"]["current_revision_content_read"] = d["status"] == "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED"
        item["content_access"]["action"] = "historical_derived_text_read_plus_bounded_original_pdf_structure_probe"
        item["content_access"]["reason"] = "Earlier derived text access was retained; this supplement used an exact file_id/registered-sha256 rights binding before bounded original-PDF structure inspection."
        if d["status"] == "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED":
            item["content_access"]["rights_basis_refs"] = [d["rights_ref"]]
            item["evidence_refs"].append(f"{DETAIL}#file_id={item['file_id']}")
            item["basis"] = {"kind": "OBSERVED_THIS_RUN", "inspection_scope": "Mixed evidence: full registered derived text marker counts plus bounded original PDF check of page count and per-page /Contents/direct-image-resource presence; text extraction only on first two and final page."}
            item["profile"]["original_pdf_bounded_probe"] = {"page_count": d["page_count"], "text_layer_pages_checked_1_based": d["text_layer_pages_checked_1_based"], "selected_page_text_character_counts": {str(p["page_number_1_based"]): p["text_layer_character_count"] for p in d["pages"] if p["text_layer_checked"]}, "pages_with_content_stream": sum(p["content_stream_present"] for p in d["pages"]), "pages_with_direct_image_xobject": sum(p["image_xobject_present"] for p in d["pages"]), "all_pages_resource_flags_recorded": True}
            item["limitations"] = [x for x in item["limitations"] if "original layout, scanning, images" not in x]
            item["limitations"].extend(d["limitations"])
            item["unknowns"] = [x for x in item["unknowns"] if "Whether visual tables/figures" not in x]
            item["unknowns"].extend(["Text-layer status of unselected pages was not tested by text extraction.", "Nested form image resources may exist beyond the direct page image-resource check."])
        else:
            item["unknowns"].append(f"Bounded original PDF probe failed: {d.get('error_type', d['status'])}: {d.get('error', '')}")

    DETAIL.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in details), encoding="utf-8")
    FRAGMENT.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in fragment), encoding="utf-8")
    summary = {"targets": 3, "success": sum(x["status"] == "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED" for x in details), "failed_or_not_probed": sum(x["status"] != "BOUNDED_ORIGINAL_PDF_STRUCTURE_OBSERVED" for x in details), "original_pdfs_read_this_invocation": newly_read, "previous_successes_reused_without_reread": len(prior_details), "other_objects_read": 0, "derived_extractions_reread": 0, "original_hashes_recomputed": 0, "command": r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation/CR-DATA-MAP-001/20260919T233638_AEST/documents/probe_three_pdfs.py", "cwd": str(ROOT)}
    LOG.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
