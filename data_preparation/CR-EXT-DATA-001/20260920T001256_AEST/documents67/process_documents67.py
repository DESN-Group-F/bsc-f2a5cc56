"""EXT-02 local document preparation for the frozen 32-object scope."""
from __future__ import annotations

import html
import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

from pypdf import PdfReader

ROOT = Path(r"E:\desn 2000\bsc")
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
RUN = ROOT / "data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"
OUT = RUN / "documents67"
DERIVED = OUT / "derived"
SCOPE = RUN / "INPUT_SCOPE.jsonl"
LIMITED_SOURCES = {"SRC-038", "SRC-048"}
SEMANTIC_ROLES = {
    "SRC-001": "institutional_battery_safety_communication", "SRC-003": "external_ehs_landing_page", "SRC-004": "external_battery_safety_guidance", "SRC-005": "external_battery_safety_checklist", "SRC-006": "electrical_safety_program_reference", "SRC-011": "research_dataset_catalog", "SRC-014": "research_dataset_landing_page", "SRC-015": "battery_study_summary_catalog", "SRC-016": "experimental_dataset_platform_documentation", "SRC-019": "research_dataset_landing_page", "SRC-020": "research_dataset_landing_page", "SRC-021": "research_dataset_landing_page", "SRC-022": "dangerous_goods_code_change_or_landing_reference", "SRC-023": "air_cargo_battery_guidance_or_landing_reference", "SRC-030": "machine_learning_dataset_card", "SRC-036": "institutional_battery_safety_alert", "SRC-037": "government_battery_disposal_guidance", "SRC-038": "manufacturer_product_safety_conformity_or_specification_reference", "SRC-043": "institutional_form_landing_page", "SRC-044": "institutional_risk_management_procedure", "SRC-045": "institutional_safe_work_procedure_writing_guideline", "SRC-046": "institutional_risk_management_form_guide", "SRC-047": "institutional_training_badge_landing_page", "SRC-048": "external_illustrated_battery_safety_reference",
}


class StructuredHTML(HTMLParser):
    BLOCKS = {"title", "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "th", "td"}
    SKIP = {"script", "style", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.current_tag: str | None = None
        self.buf: list[str] = []
        self.records: list[dict] = []
        self.table_index = 0
        self.row_index = 0
        self.in_table = False

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)
        if tag == "table":
            self.table_index += 1
            self.row_index = 0
            self.in_table = True
        elif tag == "tr" and self.in_table:
            self.row_index += 1
        if tag in self.BLOCKS:
            self.current_tag, self.buf = tag, []

    def handle_endtag(self, tag):
        if tag == self.current_tag:
            text = re.sub(r"\s+", " ", html.unescape(" ".join(self.buf))).strip()
            if text:
                self.records.append({"segment_index": len(self.records) + 1, "kind": tag, "text": text, "table_index": self.table_index if self.in_table and tag in {"th", "td"} else None, "row_index": self.row_index if self.in_table and tag in {"th", "td"} else None})
            self.current_tag, self.buf = None, []
        if tag == "table":
            self.in_table = False
        if tag in self.stack:
            while self.stack:
                popped = self.stack.pop()
                if popped == tag:
                    break

    def handle_data(self, data):
        if self.current_tag and not any(x in self.SKIP for x in self.stack):
            self.buf.append(data)


def safe_path(relative: str) -> Path:
    rel = PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("unsafe registered relative path")
    p = SOURCE.joinpath(*rel.parts).resolve()
    if not p.is_relative_to(SOURCE.resolve()):
        raise ValueError("registered path escapes source root")
    return p


def known_terms(row: dict) -> list[dict]:
    return [{k: r.get(k) for k in ("rights_id", "ai_processing", "storage", "scope", "basis_summary", "reviewer_type") if r.get(k) is not None} for r in row.get("existing_rights_records") or []]


def decision(row: dict) -> dict:
    limited = row["source_id"] in LIMITED_SOURCES
    return {
        "file_id": row["file_id"],
        "source_id": row["source_id"],
        "registered_sha256": row["sha256_registered"],
        "relative_path": row["relative_path"],
        "old_precheck_status": (row.get("prior_processing") or {}).get("status"),
        "old_ai_processing_values": sorted({str(x.get("ai_processing")) for x in row.get("existing_rights_records") or []}),
        "user_local_authorization": {"decision": "AUTHORIZED_FOR_THIS_LOCAL_ACTION", "purpose": "UNSW coursework or non-commercial research", "authority_ref": str(RUN / "USER_SCOPE.json"), "does_not_modify_third_party_terms": True},
        "known_terms_and_conditions": known_terms(row),
        "local_action": "local_read_and_structure_quality_check_only" if limited else "local_read_structure_text_and_table_candidate_extraction",
        "action_reason": "User explicitly authorized bounded local preparation for the frozen 60+7 set for UNSW coursework/non-commercial research; old generic AI precheck is retained as history rather than treated as a blanket local-read prohibition.",
        "remaining_not_authorized": ["RAG admission", "model or cloud context", "training", "external transfer", "publication or redistribution", "commercial use"],
        "special_limit": "Local structure/quality inspection only; no full-text derived artifact and no licence-pass claim." if limited else None,
    }


def currentness(row: dict) -> dict:
    path = row["relative_path"].lower()
    sid = row["source_id"]
    cues = []
    for token in re.findall(r"(?:19|20)\d{2}(?:[-_]\d{2}(?:[-_]\d{2})?)?", path):
        cues.append(f"filename_date_or_year={token}")
    if "rev" in path or "v1" in path or "v5" in path:
        cues.append("filename_contains_revision_or_version_cue")
    if sid == "SRC-036":
        status = "DATED_2023_SAFETY_ALERT_CURRENT_APPLICABILITY_NOT_VERIFIED"
    elif sid in {"SRC-044", "SRC-045", "SRC-046"}:
        status = "REGISTERED_INSTITUTIONAL_PROCEDURE_OR_GUIDE_VERSION_CURRENTNESS_NOT_EXTERNALLY_VERIFIED"
    elif sid in {"SRC-001", "SRC-043", "SRC-047"}:
        status = "REGISTERED_UNSW_WEB_SNAPSHOT_CURRENTNESS_NOT_EXTERNALLY_VERIFIED"
    elif sid == "SRC-006":
        status = "REGISTERED_2026_REVISION_CURRENTNESS_NOT_EXTERNALLY_VERIFIED"
    elif sid == "SRC-022" and path.endswith(".pdf"):
        status = "TRANSITION_CHANGE_DOCUMENT_NOT_THE_FULL_CURRENT_CODE"
    else:
        status = "REGISTERED_SNAPSHOT_OR_VERSION_CURRENTNESS_NOT_EXTERNALLY_VERIFIED"
    return {"status": status, "cues": cues, "official_live_version_check": "NOT_PERFORMED"}


def image_count(page) -> int:
    try:
        resources = page.get("/Resources") or {}
        resources = resources.get_object() if hasattr(resources, "get_object") else resources
        xobjects = resources.get("/XObject") or {}
        xobjects = xobjects.get_object() if hasattr(xobjects, "get_object") else xobjects
        return sum(1 for x in xobjects.values() if (x.get_object() if hasattr(x, "get_object") else x).get("/Subtype") == "/Image")
    except Exception:
        return 0


def process_html(row: dict, source_path: Path, limited: bool) -> tuple[dict, list[str], list[str]]:
    raw = source_path.read_text(encoding="utf-8", errors="replace")
    parser = StructuredHTML()
    parser.feed(raw)
    records = parser.records
    counts = Counter(x["kind"] for x in records)
    replacement = raw.count("\ufffd")
    issues = []
    if not records:
        issues.append("No title/heading/paragraph/list/table-cell segments were captured.")
    if replacement:
        issues.append(f"Decoded HTML contains {replacement} replacement characters.")
    outputs = []
    if not limited:
        target = DERIVED / f"{row['file_id']}.segments.jsonl"
        target.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in records), encoding="utf-8")
        outputs.append(str(target))
    profile = {"html_segment_count": len(records), "segment_kind_counts": dict(counts), "table_count": parser.table_index, "replacement_character_count_in_source_decode": replacement, "full_text_derived": not limited}
    return profile, outputs, issues


def process_markdown(row: dict, source_path: Path) -> tuple[dict, list[str], list[str]]:
    text = source_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    records, para = [], []
    def flush():
        if para:
            records.append({"segment_index": len(records) + 1, "kind": "paragraph", "line_start": para[0][0], "line_end": para[-1][0], "text": " ".join(x[1].strip() for x in para).strip()})
            para.clear()
    for no, line in enumerate(lines, 1):
        m = re.match(r"^\s{0,3}(#{1,6})\s+(.*)$", line)
        if m:
            flush(); records.append({"segment_index": len(records) + 1, "kind": "heading", "level": len(m.group(1)), "line_start": no, "line_end": no, "text": m.group(2).strip()})
        elif re.match(r"^\s*(?:[-*+] |\d+[.)]\s+)", line):
            flush(); records.append({"segment_index": len(records) + 1, "kind": "list_item", "line_start": no, "line_end": no, "text": line.strip()})
        elif line.strip():
            para.append((no, line))
        else:
            flush()
    flush()
    target = DERIVED / f"{row['file_id']}.segments.jsonl"
    target.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in records), encoding="utf-8")
    return {"line_count": len(lines), "segment_count": len(records), "heading_count": sum(x["kind"] == "heading" for x in records), "list_item_count": sum(x["kind"] == "list_item" for x in records), "replacement_character_count": text.count("\ufffd"), "full_text_derived": True}, [str(target)], []


def process_pdf(row: dict, source_path: Path, limited: bool) -> tuple[dict, list[str], list[str]]:
    reader = PdfReader(source_path)
    pages, issues, outputs = [], [], []
    text_records, table_records = [], []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        repl = text.count("\ufffd")
        pinfo = {"page_number": i + 1, "content_stream_present": page.get("/Contents") is not None, "direct_image_xobject_count": image_count(page), "text_character_count": len(text), "replacement_character_count": repl}
        pages.append(pinfo)
        if not limited:
            text_records.append({"page_number": i + 1, "text": text, "text_character_count": len(text), "replacement_character_count": repl})
            candidates = []
            for line_no, line in enumerate(text.splitlines(), 1):
                cells = [x.strip() for x in re.split(r"\t+|\s{2,}", line.strip()) if x.strip()]
                if len(cells) >= 2:
                    candidates.append({"line_number": line_no, "cells": cells})
            if candidates:
                table_records.append({"page_number": i + 1, "candidate_method": "text_line_split_on_tab_or_two_plus_spaces", "candidate_line_count": len(candidates), "lines": candidates})
    if any(p["replacement_character_count"] for p in pages):
        issues.append("One or more page text streams contain replacement characters.")
    if any(p["text_character_count"] == 0 for p in pages):
        issues.append("One or more pages returned no extracted text; scan/image-only or extraction failure remains possible for those pages.")
    if not limited:
        text_target = DERIVED / f"{row['file_id']}.pages.jsonl"
        table_target = DERIVED / f"{row['file_id']}.table_candidates.jsonl"
        text_target.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in text_records), encoding="utf-8")
        table_target.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in table_records), encoding="utf-8")
        outputs.extend([str(text_target), str(table_target)])
    profile = {"page_count": len(pages), "pages_with_content_stream": sum(p["content_stream_present"] for p in pages), "pages_with_extracted_text": sum(p["text_character_count"] > 0 for p in pages), "pages_with_direct_image_xobject": sum(p["direct_image_xobject_count"] > 0 for p in pages), "page_profiles": pages, "table_candidate_page_count": len(table_records) if not limited else None, "table_candidate_method": "text_line_split_on_tab_or_two_plus_spaces; not geometric table reconstruction" if not limited else None, "full_text_derived": not limited, "visual_render_performed": False}
    if not limited:
        issues.append("pdfplumber was unavailable and installation was prohibited; table candidates use a text-spacing heuristic and require independent verification.")
    if limited:
        issues.append("Terms-limited object: only local structure/quality profile retained; no full-text or table-value derived artifact created.")
    return profile, outputs, issues


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    DERIVED.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(x) for x in SCOPE.open(encoding="utf-8") if x.strip()]
    rows = [x for x in rows if x.get("pending67") is True and x.get("assigned_lane") == "documents"]
    if len(rows) != 32 or len({x["file_id"] for x in rows}) != 32:
        raise SystemExit("frozen EXT-02 scope must contain 32 unique objects")
    decisions = [decision(x) for x in rows]
    (OUT / "LOCAL_ACTION_DECISIONS.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in decisions), encoding="utf-8")
    manifests, findings = [], []
    for row in rows:
        limited = row["source_id"] in LIMITED_SOURCES
        path = safe_path(row["relative_path"])
        media = row["inventory"]["media_type"]
        try:
            if media == "text/html":
                profile, outputs, issues = process_html(row, path, limited)
            elif media == "application/pdf":
                profile, outputs, issues = process_pdf(row, path, limited)
            elif media == "text/markdown":
                profile, outputs, issues = process_markdown(row, path)
            else:
                raise ValueError(f"unsupported media type in frozen scope: {media}")
            status = "LOCALLY_PREPARED" if not limited else "LOCALLY_INSPECTED_TERMS_LIMITED"
        except Exception as exc:
            profile, outputs = None, []
            issues = [f"Processing failed: {type(exc).__name__}: {exc}"]
            status = "PREPARATION_FAILED"
        manifests.append({"file_id": row["file_id"], "source_id": row["source_id"], "document_family_id": row["inventory"].get("document_family_id"), "document_version_id": row["inventory"].get("document_version_id"), "registered_sha256": row["sha256_registered"], "relative_path": row["relative_path"], "technical_format": media, "semantic_role": SEMANTIC_ROLES.get(row["source_id"], "unclassified_document_reference"), "semantic_role_basis": "REGISTERED_SOURCE_ID_TITLE_AND_FILENAME; content-level applicability review remains pending", "currentness": currentness(row), "status": status, "actual_local_action": decision(row)["local_action"], "local_action_decision_ref": f"{OUT / 'LOCAL_ACTION_DECISIONS.jsonl'}#file_id={row['file_id']}", "user_authorization_ref": str(RUN / "USER_SCOPE.json"), "profile": profile, "derived_outputs": outputs, "requirement_support": {"status": "NOT_ASSESSED_REQUIREMENT_IDS_UNAVAILABLE_AT_PROCESSING_TIME", "requirement_ids": []}, "source_modified": False, "rag_status": "NOT_DECIDED_NOT_ADMITTED", "training_status": "NOT_AUTHORIZED", "external_transfer": "NOT_AUTHORIZED_NOT_ATTEMPTED", "limitations": ["Successful parsing does not validate scientific applicability, critical numeric values, table reconstruction, or current local procedure status."]})
        findings.append({"file_id": row["file_id"], "quality_status": "NEEDS_REVIEW" if issues else "STRUCTURE_AND_EXTRACTION_CHECKED", "issues": issues, "critical_value_validation": "NOT_PERFORMED", "table_candidate_interpretation": "Candidates are retained locally and are not asserted to be correct reconstructed tables.", "visual_layout_validation": "NOT_PERFORMED"})
    (OUT / "PROCESSING_MANIFEST.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in manifests), encoding="utf-8")
    (OUT / "QUALITY_FINDINGS.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in findings), encoding="utf-8")
    summary = {"input_objects": len(rows), "format_counts": Counter(x["inventory"]["media_type"] for x in rows), "status_counts": Counter(x["status"] for x in manifests), "derived_file_count": sum(len(x["derived_outputs"]) for x in manifests), "terms_limited_objects": sum(x["source_id"] in LIMITED_SOURCES for x in rows), "failed_objects": sum(x["status"] == "PREPARATION_FAILED" for x in manifests), "command": r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/documents67/process_documents67.py", "cwd": str(ROOT), "network_used": False, "model_used": False, "server_used": False, "source_hashes_recomputed": False}
    (OUT / "RUN_LOG.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    main()
