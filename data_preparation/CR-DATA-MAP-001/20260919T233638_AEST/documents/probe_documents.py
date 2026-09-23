"""MAP-01 bounded structure probe.

Reads the frozen scope and already-registered extraction text only. It never opens
an original source object, executes source code, or selects a processing tool.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

RUN = Path("data_preparation/CR-DATA-MAP-001/20260919T233638_AEST")
SCOPE = RUN / "INPUT_SCOPE.jsonl"
OUT = RUN / "documents" / "MAPPING_FRAGMENT.jsonl"
LOG = RUN / "documents" / "RUN_LOG.json"
RIGHTS_AUDIT = RUN / "documents" / "RIGHTS_BASIS_AUDIT.jsonl"
SOURCE_ROOT = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
SCOPE_ABS = Path(r"E:\desn 2000\bsc") / SCOPE


def semantic(row: dict) -> str:
    p = row["relative_path"].lower()
    title = row["prior_routing"].get("source_title", "").lower()
    sid = row["source_id"]
    if "license" in p:
        return "software_license_scope"
    if "changelog" in p:
        return "software_change_history"
    if "docs-index" in p:
        return "technical_documentation_index"
    if "state-diagram" in p:
        return "software_state_diagram"
    if "architecture" in p or "software-structure" in p:
        return "software_architecture_documentation"
    if "soa_" in p:
        return "battery_management_safety_limits_documentation"
    if "bms-overview" in p or "/bms_" in p:
        return "battery_management_software_documentation"
    if "parameter-values" in p or "parameter-sets" in p:
        return "battery_model_parameter_documentation"
    if p.endswith(".py"):
        return "battery_model_parameter_definition_source"
    if "data-formats" in p:
        return "battery_dataset_format_documentation"
    if "dataset_card" in p or "dataset_cards" in p:
        return "dataset_documentation"
    if "model_card" in p:
        return "model_documentation"
    if "paper" in p or "abstract" in p or "finetuning" in title or "optimization" in title:
        return "research_paper_or_abstract"
    if "manual" in p:
        return "product_manual"
    if "firmware" in p or "readme" in p:
        return "technical_project_readme"
    if "best_practice" in p:
        return "model_operation_best_practices"
    if "certificate" in p:
        return "product_conformity_certificate"
    if "sds" in p:
        return "safety_data_sheet"
    if "test_summary" in p:
        return "transport_test_summary"
    if "datasheet" in p or "product_page" in p:
        return "product_specification_reference"
    if "7_8_to_7_9_changes" in p:
        return "regulatory_change_notice"
    if "checklist" in title:
        return "safety_checklist"
    if sid == "SRC-044":
        return "risk_management_procedure"
    if sid in {"SRC-045", "SRC-046"}:
        return "risk_or_safe_work_guideline"
    if "landing" in p or "catalog" in p or "summaries" in p or "experimental-platform" in p:
        return "catalog_or_landing_page"
    if sid in {"SRC-001", "SRC-002", "SRC-003", "SRC-004", "SRC-006", "SRC-032", "SRC-036", "SRC-037", "SRC-043", "SRC-047", "SRC-048"} or "guide" in title or "guidance" in title or "safety" in title:
        return "guidance_or_safety_reference"
    if "safety_v" in p:
        return "software_safety_documentation"
    return "technical_documentation"


def profile_text(text: str, media: str) -> tuple[str, dict]:
    lines = text.splitlines()
    nonempty = [x for x in lines if x.strip()]
    md_headings = sum(bool(re.match(r"^\s{0,3}#{1,6}\s+", x)) for x in lines)
    rst_underlines = sum(bool(re.match(r"^\s*[=~`^\-:#\"'*+<>_]{3,}\s*$", x)) for x in lines)
    bullets = sum(bool(re.match(r"^\s*(?:[-*+] |\d+[.)]\s+)", x)) for x in lines)
    pipe_rows = sum(x.count("|") >= 2 for x in lines)
    grid_rows = sum(bool(re.match(r"^\s*\+(?:[-=]+\+)+\s*$", x)) for x in lines)
    directives = sum(bool(re.match(r"^\s*\.\.\s+\w+::", x)) for x in lines)
    xml_cells = len(re.findall(r"<mxCell\b", text)) if media == "application/xml" else 0
    python_defs = len(re.findall(r"^\s*(?:def|class)\s+\w+", text, re.M)) if media == "text/x-python" else 0
    fenced = sum(bool(re.match(r"^\s*```", x)) for x in lines)
    profile = {
        "registered_extraction_character_count": len(text),
        "line_count": len(lines),
        "nonempty_line_count": len(nonempty),
        "markdown_atx_heading_lines": md_headings,
        "rst_heading_underline_candidates": rst_underlines,
        "list_item_lines": bullets,
        "pipe_table_candidate_rows": pipe_rows,
        "grid_table_border_candidates": grid_rows,
        "rst_directive_lines": directives,
        "fenced_code_delimiters": fenced,
        "drawio_mxcell_elements": xml_cells,
        "python_def_or_class_lines": python_defs,
    }
    if media == "application/xml":
        variant = "drawio_xml_graph_structure"
    elif media == "text/x-python":
        variant = "python_parameter_definition_source_text"
    elif media == "application/pdf":
        variant = "pdf_with_page_text_extraction_only"
    elif md_headings or rst_underlines:
        variant = "hierarchical_text_with_optional_lists_tables_or_code"
    else:
        variant = "linear_extracted_text"
    return variant, profile


def resolve_local_basis(row: dict) -> dict:
    """Mirror the existing resolver using only rights records embedded in scope."""
    fid, sha, sid = row["file_id"], row["sha256_registered"], row["source_id"]
    records = row.get("existing_rights_records") or []
    exact = [r for r in records if r.get("file_id") == fid and r.get("file_sha256") == sha and r.get("ai_processing") == "ALLOWED"]
    if exact:
        r = exact[0]
        return {"verified": True, "decision": "ALLOW_LOCAL_PROCESSING", "binding": "EXACT_FILE_ID_AND_SHA256", "rights_id": r.get("rights_id"), "record_ref": f"{SCOPE_ABS}#file_id={fid}/existing_rights_records/rights_id={r.get('rights_id')}"}
    effective = (row.get("prior_routing") or {}).get("rights_record", {}).get("effective_rights_id")
    group = [r for r in records if not r.get("file_id") and r.get("source_id") == sid and r.get("rights_id") == effective and r.get("ai_processing") == "ALLOWED"]
    if group:
        r = group[0]
        return {"verified": True, "decision": "ALLOW_LOCAL_PROCESSING", "binding": "RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS", "rights_id": r.get("rights_id"), "record_ref": f"{SCOPE_ABS}#file_id={fid}/existing_rights_records/rights_id={r.get('rights_id')}"}
    return {"verified": False, "decision": "NO_MATCHING_LOCAL_PROCESSING_BASIS", "binding": None, "rights_id": None, "record_ref": None}


def stable_signature(media: str, variant: str, profile: dict) -> str:
    features = {
        "heading": bool(profile["markdown_atx_heading_lines"] or profile["rst_heading_underline_candidates"]),
        "list": bool(profile["list_item_lines"]),
        "table_syntax_candidate": bool(profile["pipe_table_candidate_rows"] or profile["grid_table_border_candidates"]),
        "code_or_directive": bool(profile["fenced_code_delimiters"] or profile["rst_directive_lines"]),
        "xml_graph": bool(profile["drawio_mxcell_elements"]),
        "python_definition": bool(profile["python_def_or_class_lines"]),
    }
    present = ",".join(k for k, v in features.items() if v) or "plain_text"
    return f"format={media};variant={variant};features={present}"


def main() -> None:
    reuse_observations = "--reuse-observations" in sys.argv
    previous = {}
    if reuse_observations and OUT.is_file():
        previous = {x["file_id"]: x for x in (json.loads(line) for line in OUT.open(encoding="utf-8") if line.strip())}
    rows = [json.loads(line) for line in SCOPE.open(encoding="utf-8") if line.strip()]
    rows = [r for r in rows if r["assigned_lane"] == "documents"]
    result = []
    for row in rows:
        inv = row["inventory"]
        exts = row.get("existing_extractions") or []
        permission = resolve_local_basis(row)
        refs = [f"{SCOPE_ABS}#file_id={row['file_id']}"]
        profile = None
        signature = None
        limitations = ["Structure mapping does not establish domain applicability, correctness, or downstream admission."]
        unknowns = []
        access = {
            "performed_this_run": False,
            "action": "none",
            "rights_basis_refs": [],
            "reason": "No original content access was needed or authorized for this mapping record.",
            "current_revision_content_read": False,
        }
        if exts:
            ext = exts[0]
            ep = SOURCE_ROOT / ext["output_path"]
            binding_ok = ext.get("input_file_id") == row["file_id"] and ext.get("input_sha256") == row["sha256_registered"]
            if permission["verified"] and binding_ok and (reuse_observations and row["file_id"] in previous):
                old = previous[row["file_id"]]
                profile, variant = old.get("profile"), old.get("structure_variant")
            elif permission["verified"] and binding_ok and ep.is_file() and not reuse_observations:
                text = ep.read_text(encoding="utf-8", errors="replace")
                variant, profile = profile_text(text, inv["media_type"])
            if permission["verified"] and binding_ok and profile:
                profile.update({
                    "evidence_method": ext["method"],
                    "registered_page_count": ext.get("page_count"),
                    "registered_replacement_character_count": ext.get("replacement_character_count"),
                })
                signature = stable_signature(inv["media_type"], variant, profile)
                refs += [
                    f"{SCOPE_ABS}#file_id={row['file_id']}/existing_extractions/{ext['extraction_id']}",
                    str(ep),
                ]
                basis = {"kind": "REUSED_EXISTING_EVIDENCE", "inspection_scope": "Entire registered derived UTF-8 text; deterministic structural marker counts only; original not opened."}
                status = "STRUCTURE_IDENTIFIED"
                access["action"] = "read_registered_derived_extraction_text"
                access["performed_this_run"] = True
                access["rights_basis_refs"] = [permission["record_ref"]]
                access["reason"] = "Registered derived extraction text was read earlier in this MAP-01 run after the extraction's input_file_id/input_sha256 binding; this revision verified the existing local-processing basis and did not reread content."
                if inv["media_type"] == "application/pdf":
                    limitations += ["Only registered PDF page-text extraction was inspected; original layout, scanning, images, figures, and table geometry were not verified."]
                    unknowns += ["Whether visual tables/figures or scanned regions exist in the original PDF."]
                elif inv["media_type"] == "text/html":
                    limitations += ["Registered main/article text omits DOM layout and may omit navigation, images, or embedded resources."]
                elif inv["media_type"] == "application/xml":
                    limitations += ["Element counts describe draw.io XML graph structure; diagram meaning and rendering were not visually verified."]
                elif inv["media_type"] == "text/x-python":
                    limitations += ["Source was treated as inert text and was not executed; values and relationships were not runtime-validated."]
            else:
                basis = {"kind": "REUSED_EXISTING_EVIDENCE", "inspection_scope": "Extraction registration only; registered derived file was unavailable."}
                status = "UNKNOWN_INSUFFICIENT_EVIDENCE"
                unknowns += ["No verified combination of local-processing basis, extraction file_id/hash binding, and retained observation was available for structural identification."]
                access["performed_this_run"] = bool(previous.get(row["file_id"], {}).get("content_access", {}).get("performed_this_run"))
                access["reason"] = "Historical access, if recorded, is retained; this revision did not reread derived content because the prerequisite checks were incomplete."
        else:
            prior = row.get("prior_processing") or {}
            explicitly_restricted = "EXPLICIT_AI_PROCESSING_RESTRICTION" in prior.get("status", "")
            status = "UNKNOWN_RESTRICTED" if explicitly_restricted else "PROVISIONAL_METADATA_ONLY"
            basis = {"kind": "METADATA_INFERENCE", "inspection_scope": "Frozen inventory, title, media type, relative filename, and prior processing status only; no content bytes read."}
            signature = None
            unknowns += ["Internal heading, list, table, image, and mixed-layout structure was not inspected."]
            if inv["media_type"] == "application/pdf":
                unknowns += ["Native-text versus scanned status, page count, and visual table/figure structure are unknown."]
            if explicitly_restricted:
                access["reason"] = "Existing processing record states an explicit AI-processing restriction; original remained unopened."
            else:
                access["reason"] = "Existing evidence did not establish permission for a new content probe for this exact mapping purpose; metadata was sufficient for a provisional record."

        result.append({
            "file_id": row["file_id"],
            "technical_format": inv["media_type"],
            "semantic_type": semantic(row),
            "semantic_basis": {"kind": "METADATA_INFERENCE", "fields": ["source_id", "relative_path", "prior_routing.source_title"], "confidence_limit": "Semantic role was not content-verified in this mapping run."},
            "structure_variant": variant if exts and profile else "internal_structure_uninspected",
            "structure_signature": signature,
            "mapping_status": status,
            "profile": profile,
            "evidence_refs": refs,
            "basis": basis,
            "limitations": limitations,
            "unknowns": unknowns,
            "content_access": access,
        })
        result[-1]["unknowns"].append("Semantic type is inferred from registered metadata and filename/title cues; content-level semantic verification was not performed.")
    if len(result) != 70 or len({r["file_id"] for r in result}) != 70:
        raise SystemExit("documents lane cardinality/uniqueness check failed")
    OUT.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in result), encoding="utf-8")
    audits = []
    for row in rows:
        if row.get("existing_extractions"):
            ext = row["existing_extractions"][0]
            p = resolve_local_basis(row)
            audits.append({"file_id": row["file_id"], "sha256_registered": row["sha256_registered"], "extraction_id": ext.get("extraction_id"), "extraction_input_file_id_matches": ext.get("input_file_id") == row["file_id"], "extraction_input_sha256_matches": ext.get("input_sha256") == row["sha256_registered"], "local_processing_basis": p, "content_reread_in_correction_revision": False})
    RIGHTS_AUDIT.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in audits), encoding="utf-8")
    summary = {
        "records": len(result),
        "mapping_status": Counter(r["mapping_status"] for r in result),
        "technical_format": Counter(r["technical_format"] for r in result),
        "semantic_type": Counter(r["semantic_type"] for r in result),
        "original_content_opened": 0,
        "historical_registered_derived_extractions_read_in_map_run": sum(r["content_access"]["action"] == "read_registered_derived_extraction_text" for r in result),
        "derived_content_reread_in_correction_revision": 0 if reuse_observations else sum(r["content_access"]["action"] == "read_registered_derived_extraction_text" for r in result),
        "rights_basis_verified_for_retained_observations": sum(resolve_local_basis(r)["verified"] for r in rows if r.get("existing_extractions")),
        "command": r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe -B data_preparation/CR-DATA-MAP-001/20260919T233638_AEST/documents/probe_documents.py" + (" --reuse-observations" if reuse_observations else ""),
        "cwd": r"E:\desn 2000\bsc",
        "scope_boundary": "Correction revision reused retained marker observations and read ledgers only; no original or derived content was reread." if reuse_observations else "Frozen documents lane and registered derived extraction text only; no originals opened.",
    }
    LOG.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    main()
