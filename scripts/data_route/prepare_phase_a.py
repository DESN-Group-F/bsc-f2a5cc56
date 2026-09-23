#!/usr/bin/env python3
"""Prepare CR-DATA-ROUTE-001 Phase A artifacts from frozen audit metadata only.

Status: PREPARED_LOCALLY_UNVERIFIED.

This is a deterministic preparation utility, not a project test. It reads the
explicit EXT-AUDIT-01 metadata directory, performs lstat-only checks for the
300 allowlisted original paths, and never opens original file content.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import stat
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


ARTIFACT_STATUS = "PREPARED_LOCALLY_UNVERIFIED"
TEST_STATUS = "DEFINED_NOT_RUN"
EXPECTED_ORIGINALS = 300

AUDIT_INTERPRETED_INPUTS = {
    "AUDIT_REPORT.md",
    "FINAL_STATUS.md",
    "FINAL_STATUS.json",
    "SOURCE_DOCUMENT_FILE_MAP.csv",
    "FINDINGS.csv",
    "MANUAL_ACTIONS.csv",
    "AUTOMATIC_ACTIONS.csv",
    "MODULE_COVERAGE.md",
    "TEST_EXECUTION.json",
    "SNAPSHOT_MANIFEST.json",
    "SNAPSHOT_SHA256.csv",
    "CONTENT_SAMPLING.csv",
    "PRIOR_MANIFEST_COMPARISON.json",
}

DEV_KINDS = {
    "MODEL_METADATA",
    "SOFTWARE_REFERENCE",
    "ANALYSIS_SOFTWARE",
    "SIMULATION_SOFTWARE",
    "METHOD_PAPER",
    "DATA_ENGINEERING_REFERENCE",
}

DOC_KINDS = {
    "LOCAL_PUBLIC_GUIDANCE",
    "WORKPLACE_GUIDANCE",
    "EXTERNAL_EHS",
    "EXTERNAL_GOVERNANCE",
    "TRANSPORT_REFERENCE",
    "NSW_PUBLIC_GUIDANCE",
    "LOCAL_PUBLIC_GOVERNANCE",
    "LOCAL_PUBLIC_GOVERNANCE_HISTORICAL",
    "PRODUCT_REFERENCE",
}

DATA_REPRESENTATIONS = {
    "BINARY",
    "CSV",
    "JSON_METADATA",
    "JSON_WITH_BARE_IEEE_NONFINITE_VALUES",
    "MATLAB_DATA",
    "TAR_GZIP_ARCHIVE",
    "XLSX",
    "ZIP_ARCHIVE",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-workspace", required=True)
    parser.add_argument("--audit-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument("--project-root", required=True)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return sha256_bytes(payload)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_json(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            handle.write("\n")


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("x", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_text(path: Path, text: str) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(text.rstrip() + "\n")


def split_pipe(value: str | None) -> list[str]:
    if not value or value.strip() in {"", "UNKNOWN", "NONE"}:
        return []
    return [part.strip() for part in value.split("|") if part.strip()]


def assert_exact_path(actual: Path, expected: Path, label: str) -> None:
    if os.path.normcase(os.path.abspath(actual)) != os.path.normcase(
        os.path.abspath(expected)
    ):
        raise ValueError(f"{label} must be exactly {expected}; got {actual}")


def path_lstat_only(source_root: Path, relative_path: str, registered_size: int) -> dict[str, Any]:
    posix_path = PurePosixPath(relative_path)
    if posix_path.is_absolute() or ".." in posix_path.parts:
        return {
            "method": "LSTAT_ONLY_NO_CONTENT_READ",
            "state": "INVALID_RELATIVE_PATH",
            "exists": False,
            "size_matches_registered": False,
            "content_bytes_read": 0,
            "sha256_recomputed": False,
        }
    candidate = source_root.joinpath(*posix_path.parts)
    try:
        info = os.lstat(candidate)
    except FileNotFoundError:
        return {
            "method": "LSTAT_ONLY_NO_CONTENT_READ",
            "state": "MISSING_AT_PHASE_A_VIEW",
            "exists": False,
            "size_matches_registered": False,
            "content_bytes_read": 0,
            "sha256_recomputed": False,
        }
    file_attributes = getattr(info, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    is_reparse = bool(file_attributes & reparse_flag) if reparse_flag else False
    is_regular = stat.S_ISREG(info.st_mode)
    state = "PRESENT_REGULAR_FILE" if is_regular and not is_reparse else "NOT_FOLLOWED_REPARSE_OR_NONREGULAR"
    return {
        "method": "LSTAT_ONLY_NO_CONTENT_READ",
        "state": state,
        "exists": True,
        "is_regular_file": is_regular,
        "is_reparse_point": is_reparse,
        "byte_size_lstat": info.st_size,
        "byte_size_registered": registered_size,
        "size_matches_registered": is_regular and not is_reparse and info.st_size == registered_size,
        "content_bytes_read": 0,
        "sha256_recomputed": False,
    }


def classify_route(row: dict[str, str]) -> tuple[str, list[str], str]:
    kind = row["source_kind"]
    representation = row["representation"]

    if kind == "GENERAL_INSTRUCTION":
        return (
            "TRAIN_EVAL_ISOLATED",
            ["DEV_KNOWLEDGE"],
            "source_kind identifies general-instruction/training material; it is isolated from operational RAG",
        )
    if kind in DEV_KINDS:
        return (
            "DEV_KNOWLEDGE",
            [],
            "source_kind identifies model, software, method, or data-engineering support material",
        )
    if kind == "LOCAL_PUBLIC_TRAINING_ENTRY":
        return (
            "GOVERNANCE_AUDIT",
            ["TRAIN_EVAL_ISOLATED"],
            "source_kind identifies a training-entry/governance record rather than technical battery evidence",
        )
    if kind == "LOCAL_PUBLIC_TEMPLATE":
        return (
            "GOVERNANCE_AUDIT",
            ["OPERATIONAL_DATA"],
            "source_kind identifies a public governance template; it is not a current filled business record",
        )
    if kind in {"MANUFACTURER_REFERENCE", "OPEN_HARDWARE_REFERENCE"}:
        return (
            "SPEC_DB",
            ["DOC_RAG", "DEV_KNOWLEDGE"],
            "source_kind identifies product/platform reference material; exact parameter extraction remains separately gated",
        )
    if kind == "TIMESERIES":
        return (
            "EXPERIMENT_DATA",
            [],
            "source_kind identifies historical experimental/time-series material",
        )
    if kind == "SCIENCE_CATALOG":
        if representation in DATA_REPRESENTATIONS:
            return (
                "EXPERIMENT_DATA",
                ["DOC_RAG"],
                "science-catalog source plus data/container representation indicates an experiment-data candidate",
            )
        return (
            "DOC_RAG",
            ["EXPERIMENT_DATA"],
            "science-catalog source plus document representation indicates a catalog/document candidate",
        )
    if kind in DOC_KINDS:
        secondary = ["SPEC_DB"] if kind == "PRODUCT_REFERENCE" else []
        return (
            "DOC_RAG",
            secondary,
            "source_kind identifies guidance, governance, transport, EHS, or product-reference documentation",
        )
    return (
        "UNKNOWN",
        [],
        f"no metadata-only route rule exists for source_kind={kind!r}",
    )


def route_semantics(primary: str, row: dict[str, str]) -> tuple[list[str], str, list[str], str]:
    kind = row["source_kind"]
    if primary == "EXPERIMENT_DATA":
        return (
            ["STATE_EVIDENCE", "JUDGMENT_BASIS"],
            "HISTORICAL_EXPERIMENT",
            ["PHYS_CHEM", "ENGINEERING"],
            "Historical experiment evidence; not a current local battery measurement.",
        )
    if primary == "SPEC_DB":
        return (
            ["JUDGMENT_BASIS", "STRATEGY_BASIS"],
            "PRODUCT_REFERENCE",
            ["ENGINEERING"],
            "Reference product/platform material; not proof of a local asset or configuration.",
        )
    if primary == "DOC_RAG":
        if kind == "PRODUCT_REFERENCE":
            context = "PRODUCT_REFERENCE"
        elif kind in {"SCIENCE_CATALOG"}:
            context = "HISTORICAL_EXPERIMENT"
        else:
            context = "NORMATIVE_REFERENCE"
        capabilities = ["ENGINEERING", "GOVERNANCE"]
        if kind == "SCIENCE_CATALOG":
            capabilities = ["PHYS_CHEM", "ENGINEERING"]
        return (
            ["JUDGMENT_BASIS", "STRATEGY_BASIS"],
            context,
            capabilities,
            "Reference material only; applicability, local approval, and content use remain separate.",
        )
    if primary == "GOVERNANCE_AUDIT":
        return (
            ["SUPPORT_ONLY"],
            "SUPPORT",
            ["GOVERNANCE"],
            "Governance/support record; not a technical measurement or current approval.",
        )
    if primary in {"DEV_KNOWLEDGE", "TRAIN_EVAL_ISOLATED"}:
        return (
            ["SUPPORT_ONLY"],
            "SUPPORT",
            ["DEVELOPMENT_SUPPORT"],
            "Development/evaluation support only; excluded from operational battery evidence by route.",
        )
    if primary == "OPERATIONAL_DATA":
        return (
            ["STATE_EVIDENCE"],
            "CURRENT_CASE",
            ["GOVERNANCE", "ENGINEERING"],
            "Potential operational record; current-case status requires exact provenance and permission.",
        )
    return (["SUPPORT_ONLY"], "UNKNOWN", [], "Metadata is insufficient for a confirmed route.")


def purpose_rights(row: dict[str, str]) -> list[dict[str, Any]]:
    mapping = [
        ("local_storage", "storage_right"),
        ("new_parsing", "parsing_right"),
        ("ai_semantic_processing", "ai_semantic_processing_right"),
        ("external_service_transfer", "external_service_transfer_right"),
        ("document_rag_context_or_indexing", "rag_right"),
        ("training", "training_right"),
        ("redistribution", "redistribution_right"),
        ("derivative_publication", "derivative_publication_right"),
    ]
    entries: list[dict[str, Any]] = []
    for purpose_id, field in mapping:
        state = row[field]
        entries.append(
            {
                "purpose_id": purpose_id,
                "state": state,
                "source_field": field,
                "evidence_ref": row["effective_rights_id"],
                "binding": row["rights_linkage"],
                "reviewer_type": row["rights_reviewer_type"],
                "scope_note": (
                    "This state controls only the named purpose. DENIED is not a global deny; "
                    "absence of DENIED is not ALLOW."
                ),
            }
        )
    entries.append(
        {
            "purpose_id": "production_rag_admission",
            "state": row["rag_admission"],
            "source_field": "rag_admission",
            "evidence_ref": "SOURCE_DOCUMENT_FILE_MAP.csv",
            "binding": row["rights_linkage"],
            "reviewer_type": row["rights_reviewer_type"],
            "scope_note": "Admission is distinct from rights and parsing status.",
        }
    )
    entries.append(
        {
            "purpose_id": "training_admission",
            "state": row["training_admission"],
            "source_field": "training_admission",
            "evidence_ref": "SOURCE_DOCUMENT_FILE_MAP.csv",
            "binding": row["rights_linkage"],
            "reviewer_type": row["rights_reviewer_type"],
            "scope_note": "Training remains prohibited in the current stage regardless of this recorded state.",
        }
    )
    return entries


def action_output_gates(row: dict[str, str], primary_route: str) -> list[dict[str, Any]]:
    route_output = {
        "DOC_RAG": "portable_document_chunk_for_local_internal_staging",
        "SPEC_DB": "portable_specification_seed_for_local_internal_staging",
        "EXPERIMENT_DATA": "portable_experiment_subset_for_local_internal_staging",
    }.get(primary_route, "metadata_routing_record")
    gates = [
        {
            "action": "metadata_route",
            "output_purpose": "phase_a_governance_manifest",
            "decision": "ALLOW_WITHIN_PHASE_A",
            "basis": "ADR-EXEC-001 and CR-DATA-ROUTE-001 overlay explicitly allow metadata routing",
            "content_read": False,
        },
        {
            "action": "new_parse",
            "output_purpose": route_output,
            "decision": "BLOCKED_UNKNOWN_GATE",
            "controlling_states": {"parsing_right": row["parsing_right"]},
            "reason": "No new parsing is permitted while parsing_right is UNKNOWN.",
        },
        {
            "action": "reuse_existing_derivative",
            "output_purpose": route_output,
            "decision": "BLOCKED_UNKNOWN_GATE",
            "controlling_states": {
                "existing_parse_status": row["parse_status"],
                "existing_extraction_output": row["extraction_output"],
                "reuse_for_this_output_purpose": "UNKNOWN",
            },
            "reason": "Existing derivatives do not automatically grant reuse, AI processing, new derivative, or destination permission.",
        },
        {
            "action": "transfer",
            "output_purpose": "approved_server_bundle",
            "decision": "BLOCKED_UNKNOWN_GATE",
            "controlling_states": {
                "external_service_transfer_right": row["external_service_transfer_right"]
            },
            "reason": "No server connection or upload is allowed in Phase A.",
        },
        {
            "action": "publish_derivative",
            "output_purpose": "external_or_public_derivative",
            "decision": "BLOCKED_UNKNOWN_GATE",
            "controlling_states": {
                "derivative_publication_right": row["derivative_publication_right"]
            },
            "reason": "Derivative publication requires its own exact decision.",
        },
    ]
    rag_state = row["rag_right"]
    gates.append(
        {
            "action": "rag_index_or_context",
            "output_purpose": "document_rag",
            "decision": "DENIED_THIS_PURPOSE_ONLY" if rag_state == "DENIED" else "BLOCKED_PENDING_GATE",
            "controlling_states": {
                "rag_right": rag_state,
                "rag_admission": row["rag_admission"],
            },
            "reason": (
                "A RAG DENY applies only to document RAG and its direct derivatives; it is not a global deny."
                if rag_state == "DENIED"
                else "RAG is not allowed until a purpose-specific decision and admission exist."
            ),
        }
    )
    return gates


def candidate_record(row: dict[str, str], route: dict[str, Any], rank: int) -> dict[str, Any]:
    existing_derivative = row["parse_status"] == "COMPLETE" and row["extraction_output"] != "UNKNOWN"
    return {
        "rank": rank,
        "candidate_id": f"PILOT-CANDIDATE-{route['file_id']}",
        "source_id": row["source_id"],
        "file_id": row["file_id"],
        "document_version_id": row["document_version_id"],
        "relative_path": row["relative_path"],
        "sha256": row["sha256_registered"],
        "byte_size_registered": int(row["byte_size_registered"]),
        "representation": row["representation"],
        "primary_route": route["primary_route"],
        "classification_basis": "METADATA_ONLY",
        "selected_for_pilot": False,
        "eligibility": "NOT_ELIGIBLE_CURRENTLY",
        "gates": {
            "identity_version_hash_resolved": True,
            "historical_audit_integrity_receipt": "HISTORICAL_RECEIPT_REUSED_NOT_REHASHED_THIS_RUN",
            "direct_rights_binding": row["rights_linkage"] == "DIRECT_RIGHTS_RECORD_ID",
            "parsing_right": row["parsing_right"],
            "new_parse": "BLOCKED_UNKNOWN_PARSING_RIGHT",
            "existing_derivative_available": existing_derivative,
            "existing_derivative_reuse_for_proposed_output": "UNKNOWN_BLOCKED",
            "ai_semantic_processing_right": row["ai_semantic_processing_right"],
            "rag_right": row["rag_right"],
            "rag_admission": row["rag_admission"],
            "external_service_transfer_right": row["external_service_transfer_right"],
            "human_review_status": row["human_review_status"],
        },
        "blocking_reasons": [
            "parsing_right is UNKNOWN for any new parse",
            "existing derivative reuse for the proposed output purpose is not expressly decided",
            "external_service_transfer_right is UNKNOWN",
            "human review is NOT_REVIEWED",
        ],
    }


def choose_candidates(
    originals: list[dict[str, str]], routes_by_file: dict[str, dict[str, Any]], primary: str
) -> list[dict[str, Any]]:
    rows = [row for row in originals if routes_by_file[row["file_id"]]["primary_route"] == primary]
    if primary == "DOC_RAG":
        rows = [row for row in rows if row["rag_right"] != "DENIED"]
        preferred = {"PDF": 0, "HTML_SNAPSHOT": 1, "MARKDOWN": 2, "RESTRUCTUREDTEXT": 3}
    elif primary == "SPEC_DB":
        rows = [
            row
            for row in rows
            if row["source_id"] not in {"SRC-038", "SRC-041"}
            and row["ai_semantic_processing_right"] != "RESTRICTED"
        ]
        preferred = {"PDF": 0, "RESTRUCTUREDTEXT": 1, "MARKDOWN": 2, "HTML_SNAPSHOT": 3}
    else:
        rows = [row for row in rows if row["ai_semantic_processing_right"] != "RESTRICTED"]
        preferred = {
            "CSV": 0,
            "JSON_METADATA": 1,
            "JSON_WITH_BARE_IEEE_NONFINITE_VALUES": 2,
            "XLSX": 3,
            "MATLAB_DATA": 4,
            "ZIP_ARCHIVE": 5,
            "TAR_GZIP_ARCHIVE": 6,
        }

    def rank_key(row: dict[str, str]) -> tuple[Any, ...]:
        return (
            0 if row["rights_linkage"] == "DIRECT_RIGHTS_RECORD_ID" else 1,
            0 if row["parse_status"] == "COMPLETE" else 1,
            0 if row["storage_zone"] == "NORMAL" else 1,
            0 if row["ai_semantic_processing_right"] == "ALLOWED" else 1,
            preferred.get(row["representation"], 99),
            int(row["byte_size_registered"]),
            row["file_id"],
        )

    rows.sort(key=rank_key)
    return [candidate_record(row, routes_by_file[row["file_id"]], index + 1) for index, row in enumerate(rows[:5])]


def document_chunk_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "urn:bsc:cr-data-route-001:document-chunk:0.1-draft",
        "title": "PortableDocumentChunk",
        "description": "Draft only; creation requires exact action/output-purpose permission.",
        "type": "object",
        "additionalProperties": False,
        "required": [
            "artifact_status",
            "chunk_id",
            "source_id",
            "file_id",
            "document_version_id",
            "source_sha256",
            "text",
            "locator",
            "applicability",
            "rights_snapshot",
            "lineage",
        ],
        "properties": {
            "artifact_status": {"const": ARTIFACT_STATUS},
            "chunk_id": {"type": "string", "minLength": 1},
            "source_id": {"type": "string", "pattern": "^SRC-[0-9]{3}$"},
            "file_id": {"type": "string", "minLength": 1},
            "document_version_id": {"type": "string", "minLength": 1},
            "source_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
            "text": {"type": "string", "minLength": 1},
            "heading_path": {"type": "array", "items": {"type": "string"}},
            "locator": {
                "type": "object",
                "required": ["locator_type", "locator_value"],
                "properties": {
                    "locator_type": {"enum": ["PAGE", "SECTION", "TABLE", "PARAGRAPH", "ROW", "OTHER"]},
                    "locator_value": {"type": "string", "minLength": 1},
                    "parent_locator": {"type": ["string", "null"]},
                },
                "additionalProperties": False,
            },
            "conditions_and_exceptions": {"type": "array", "items": {"type": "string"}},
            "applicability": {
                "type": "object",
                "required": ["status", "scope_note"],
                "properties": {
                    "status": {"enum": ["UNKNOWN", "REFERENCE_ONLY", "CHECKED_FOR_SCOPE", "CONFLICTED"]},
                    "scope_note": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "rights_snapshot": {"$ref": "#/$defs/rightsSnapshot"},
            "lineage": {"$ref": "#/$defs/lineage"},
        },
        "$defs": {
            "rightsSnapshot": {
                "type": "object",
                "required": ["action", "output_purpose", "decision", "evidence_ref"],
                "properties": {
                    "action": {"type": "string"},
                    "output_purpose": {"type": "string"},
                    "decision": {"enum": ["ALLOW", "DENY", "UNKNOWN", "PENDING", "RESTRICTED"]},
                    "evidence_ref": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "lineage": {
                "type": "object",
                "required": ["run_id", "transform_id", "input_record_sha256"],
                "properties": {
                    "run_id": {"type": "string"},
                    "transform_id": {"type": "string"},
                    "input_record_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                },
                "additionalProperties": False,
            },
        },
    }


def specification_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "urn:bsc:cr-data-route-001:specification-record:0.1-draft",
        "title": "PortableSpecificationRecord",
        "description": "Draft only; no missing value may be guessed or borrowed from a nearby model.",
        "type": "object",
        "additionalProperties": False,
        "required": [
            "artifact_status",
            "record_id",
            "object_ref",
            "object_level",
            "parameter_name",
            "raw_text",
            "value_kind",
            "extraction_status",
            "evidence_ref",
            "source_sha256",
            "rights_snapshot",
        ],
        "properties": {
            "artifact_status": {"const": ARTIFACT_STATUS},
            "record_id": {"type": "string", "minLength": 1},
            "object_ref": {"type": "string", "minLength": 1},
            "object_version": {"type": ["string", "null"]},
            "object_level": {"enum": ["CELL", "PACK", "CHARGER", "BMS", "EQUIPMENT", "OTHER", "UNKNOWN"]},
            "parameter_name": {"type": "string", "minLength": 1},
            "raw_text": {"type": "string", "minLength": 1},
            "value": {"type": ["number", "string", "null"]},
            "unit": {"type": ["string", "null"]},
            "value_kind": {
                "enum": ["NOMINAL", "TYPICAL", "MIN", "MAX", "RECOMMENDED", "ABSOLUTE_LIMIT", "MEASURED", "OTHER", "UNKNOWN"]
            },
            "conditions": {"type": "array", "items": {"type": "string"}},
            "extraction_status": {"enum": ["EXTRACTED", "UNKNOWN", "CONFLICTED", "NOT_PRESENT"]},
            "evidence_ref": {
                "type": "object",
                "required": ["source_id", "file_id", "document_version_id", "locator"],
                "properties": {
                    "source_id": {"type": "string"},
                    "file_id": {"type": "string"},
                    "document_version_id": {"type": "string"},
                    "locator": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "source_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
            "rights_snapshot": {"type": "object"},
            "lineage": {"type": "object"},
        },
    }


def experiment_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "urn:bsc:cr-data-route-001:experiment-subset:0.1-draft",
        "title": "PortableExperimentSubset",
        "description": "Draft only; non-finite and missing values remain explicit and traceable.",
        "type": "object",
        "additionalProperties": False,
        "required": [
            "artifact_status",
            "subset_id",
            "source_identity",
            "experiment_identity",
            "time_basis",
            "channels",
            "selection",
            "data_character",
            "quality",
            "rights_snapshot",
            "lineage",
        ],
        "properties": {
            "artifact_status": {"const": ARTIFACT_STATUS},
            "subset_id": {"type": "string", "minLength": 1},
            "source_identity": {
                "type": "object",
                "required": ["source_id", "file_id", "document_version_id", "source_sha256", "locator"],
                "properties": {
                    "source_id": {"type": "string"},
                    "file_id": {"type": "string"},
                    "document_version_id": {"type": "string"},
                    "source_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    "locator": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "experiment_identity": {
                "type": "object",
                "properties": {
                    "dataset_id": {"type": ["string", "null"]},
                    "run_id": {"type": ["string", "null"]},
                    "cell_id": {"type": ["string", "null"]},
                    "batch_id": {"type": ["string", "null"]},
                    "protocol_id": {"type": ["string", "null"]},
                },
                "additionalProperties": False,
            },
            "time_basis": {
                "type": "object",
                "required": ["field", "unit", "timezone_or_origin"],
                "properties": {
                    "field": {"type": "string"},
                    "unit": {"type": ["string", "null"]},
                    "timezone_or_origin": {"type": ["string", "null"]},
                },
                "additionalProperties": False,
            },
            "channels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "unit", "sign_convention"],
                    "properties": {
                        "name": {"type": "string"},
                        "unit": {"type": ["string", "null"]},
                        "sign_convention": {"type": ["string", "null"]},
                    },
                    "additionalProperties": False,
                },
            },
            "selection": {
                "type": "object",
                "required": ["selection_kind", "locator", "completeness_claim"],
                "properties": {
                    "selection_kind": {"enum": ["COMPLETE_CYCLE", "COMPLETE_RUN", "BOUNDED_INTERVAL", "OTHER"]},
                    "locator": {"type": "string"},
                    "completeness_claim": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "data_character": {"enum": ["MEASURED", "SIMULATED", "MIXED", "UNKNOWN"]},
            "quality": {
                "type": "object",
                "required": ["missingness", "nonfinite_policy", "sampling_notes"],
                "properties": {
                    "missingness": {"type": "string"},
                    "nonfinite_policy": {"const": "PRESERVE_AND_ANNOTATE_NOT_COERCE_TO_ZERO"},
                    "sampling_notes": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "records": {"type": "array", "items": {"type": "object"}},
            "rights_snapshot": {"type": "object"},
            "lineage": {"type": "object"},
        },
    }


def server_test_definitions(run_id: str, created_at: str) -> dict[str, Any]:
    tests = [
        ("IMPORT-001", "IMPORT", "Approved manifest hashes are verified before any read", ["server configured", "approved allowlist exists"], ["mismatched hash is rejected", "raw receipt retained"]),
        ("IMPORT-002", "PERMISSION", "UNKNOWN action/output-purpose gate blocks import", ["synthetic UNKNOWN gate fixture"], ["import status is BLOCKED", "no source content opened"]),
        ("DOC-001", "DOCUMENT", "Allowed document query returns a located supporting span", ["future approved document fixture"], ["source/version/locator returned", "conditions and exceptions retained"]),
        ("DOC-002", "DOCUMENT", "No-answer document query returns insufficient evidence", ["future approved document fixture"], ["no fabricated page or span", "reason code distinguishes no answer from service error"]),
        ("DOC-003", "DOCUMENT", "External or old reference is not presented as current local procedure", ["versioned reference fixture"], ["applicability limitation returned", "local approval not inferred"]),
        ("SPEC-001", "SPECIFICATION", "Exact model/version parameter lookup preserves value, unit, kind, and conditions", ["future approved specification fixture"], ["exact object match only", "evidence locator returned"]),
        ("SPEC-002", "SPECIFICATION", "Unknown model or missing field is not approximately substituted", ["synthetic missing-model fixture"], ["NOT_FOUND or UNKNOWN returned", "no nearby-model fallback"]),
        ("SPEC-003", "SPECIFICATION", "Version/value-kind changes are not merged", ["synthetic multi-version fixture"], ["versions remain distinct", "nominal and absolute limit remain distinct"]),
        ("EXP-001", "EXPERIMENT", "Bounded experiment query returns records from the declared complete selection", ["future approved experiment fixture"], ["range and source locator returned", "independent reference result retained"]),
        ("EXP-002", "EXPERIMENT", "Unknown unit or sign convention blocks unsupported calculation", ["synthetic unknown-unit fixture"], ["calculation not executed", "missing premise named"]),
        ("EXP-003", "EXPERIMENT", "NaN/Infinity and missing values remain annotated", ["synthetic non-finite fixture"], ["not coerced to zero", "normalisation lineage retained"]),
        ("PERM-001", "PERMISSION", "Document RAG DENY blocks only RAG and direct derivatives", ["synthetic split-purpose fixture"], ["RAG action denied", "unrelated structured action remains separately UNKNOWN, not denied"]),
        ("PERM-002", "PERMISSION", "A purpose not marked DENY is not treated as ALLOW", ["synthetic missing-decision fixture"], ["action remains blocked", "no implicit grant"]),
        ("PERM-003", "PERMISSION", "Forged approval fields do not grant access", ["synthetic untrusted approval fixture"], ["trusted decision store required", "attempt logged"]),
        ("SOURCE-001", "INTEGRITY", "Source originals remain unchanged", ["server transfer receipt and approved source snapshot"], ["pre/post approved hashes agree", "source mount is read-only"]),
        ("LINEAGE-001", "LINEAGE", "Changed source reference invalidates prior derivative for current use", ["synthetic version-change fixture"], ["old derivative marked needs reevaluation", "no silent carry-forward"]),
        ("EVAL-001", "ISOLATION", "Private oracle cannot enter model or RAG context", ["separate public/private fixture roots"], ["oracle path inaccessible", "index manifest contains no oracle IDs"]),
        ("IDEMP-001", "IDEMPOTENCY", "A repeated run does not overwrite history or duplicate a success receipt", ["same request key fixture"], ["immutable prior run retained", "idempotent reference returned"]),
    ]
    return {
        "schema_version": "0.1-draft",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": run_id,
        "created_at": created_at,
        "artifact_status": TEST_STATUS,
        "execution_environment": "SERVER_ONLY",
        "project_test_execution_count_this_run": 0,
        "query_execution_count_this_run": 0,
        "fixtures": [
            {
                "fixture_id": "FIX-GATE-UNKNOWN",
                "kind": "SYNTHETIC_PERMISSION",
                "status": TEST_STATUS,
                "contains_source_content": False,
            },
            {
                "fixture_id": "FIX-DOC-FUTURE-APPROVED",
                "kind": "PLACEHOLDER_REAL_DOCUMENT",
                "status": "BLOCKED_UNTIL_EXACT_APPROVED_BUNDLE",
                "contains_source_content": False,
            },
            {
                "fixture_id": "FIX-SPEC-FUTURE-APPROVED",
                "kind": "PLACEHOLDER_REAL_SPECIFICATION",
                "status": "BLOCKED_UNTIL_EXACT_APPROVED_BUNDLE",
                "contains_source_content": False,
            },
            {
                "fixture_id": "FIX-EXP-FUTURE-APPROVED",
                "kind": "PLACEHOLDER_REAL_EXPERIMENT",
                "status": "BLOCKED_UNTIL_EXACT_APPROVED_BUNDLE",
                "contains_source_content": False,
            },
            {
                "fixture_id": "FIX-EVAL-ISOLATION",
                "kind": "SYNTHETIC_PATH_AND_ID_ONLY",
                "status": TEST_STATUS,
                "contains_private_oracle": False,
            },
        ],
        "definitions": [
            {
                "test_id": test_id,
                "category": category,
                "status": TEST_STATUS,
                "objective": objective,
                "preconditions": preconditions,
                "assertions": assertions,
                "required_evidence": [
                    "server run manifest",
                    "raw stdout/stderr",
                    "environment snapshot",
                    "input/output hashes",
                ],
            }
            for test_id, category, objective, preconditions, assertions in tests
        ],
    }


def main() -> int:
    args = parse_args()
    source_root = Path(args.source_workspace)
    audit_dir = Path(args.audit_dir)
    output_dir = Path(args.output_dir)
    project_root = Path(args.project_root)

    assert_exact_path(source_root, Path(r"E:\desn 2000\data\battery_data_workspace_v0_3"), "source workspace")
    assert_exact_path(
        audit_dir,
        Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\reports\audits\EXT-AUDIT-01_20260919T013447_AEST"),
        "audit directory",
    )
    assert_exact_path(project_root, Path(r"E:\desn 2000\bsc"), "project root")
    expected_output_root = project_root / "data_preparation" / "CR-DATA-ROUTE-001"
    if os.path.normcase(os.path.abspath(output_dir.parent)) != os.path.normcase(
        os.path.abspath(expected_output_root)
    ):
        raise ValueError(f"output directory must be a direct child of {expected_output_root}")
    if output_dir.name != args.run_id:
        raise ValueError("output directory name must equal run_id")
    if output_dir.exists():
        raise FileExistsError(f"refusing to overwrite existing run directory: {output_dir}")
    if not source_root.is_dir() or not audit_dir.is_dir() or not project_root.is_dir():
        raise FileNotFoundError("one or more required absolute directories do not exist")

    output_dir.mkdir(parents=True, exist_ok=False)
    schemas_dir = output_dir / "schemas"
    schemas_dir.mkdir(exist_ok=False)

    map_path = audit_dir / "SOURCE_DOCUMENT_FILE_MAP.csv"
    final_status_path = audit_dir / "FINAL_STATUS.json"
    snapshot_manifest_path = audit_dir / "SNAPSHOT_MANIFEST.json"
    findings_path = audit_dir / "FINDINGS.csv"
    manual_actions_path = audit_dir / "MANUAL_ACTIONS.csv"
    automatic_actions_path = audit_dir / "AUTOMATIC_ACTIONS.csv"

    mapping_rows = read_csv(map_path)
    originals = [row for row in mapping_rows if row["derivative_kind"] == "ORIGINAL"]
    if len(originals) != EXPECTED_ORIGINALS:
        raise ValueError(f"expected {EXPECTED_ORIGINALS} originals, found {len(originals)}")
    if len({row["file_id"] for row in originals}) != EXPECTED_ORIGINALS:
        raise ValueError("original file_id values are not unique")

    final_status = read_json(final_status_path)
    snapshot_manifest = read_json(snapshot_manifest_path)
    findings = read_csv(findings_path)
    manual_actions = read_csv(manual_actions_path)
    automatic_actions = read_csv(automatic_actions_path)

    audit_inventory = []
    for path in sorted(audit_dir.iterdir(), key=lambda value: value.name.lower()):
        if not path.is_file():
            continue
        audit_inventory.append(
            {
                "name": path.name,
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "input_use": "INTERPRETED" if path.name in AUDIT_INTERPRETED_INPUTS else "HASHED_IDENTITY_ONLY",
            }
        )

    control_paths = [
        project_root / "AGENTS.md",
        project_root / "config" / "execution_policy.json",
        project_root / "docs" / "LOCAL_SERVER_EXECUTION_BOUNDARY.md",
        project_root / "backlog" / "CR_DATA_ROUTE_001_EXECUTION_OVERLAY.md",
        project_root / "backlog" / "CR_DATA_ROUTE_001_STATUS.json",
        project_root / "backlog" / "local_preparation_tasks.json",
        Path(r"C:\Users\S.W\Downloads\CR_DATA_ROUTE_001_Codex_Task_Card.md"),
    ]
    control_inputs = [
        {
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in control_paths
    ]

    route_records: list[dict[str, Any]] = []
    route_csv_rows: list[dict[str, Any]] = []
    sidecars: list[dict[str, Any]] = []
    preparation_rows: list[dict[str, Any]] = []
    task_evidence_rows: list[dict[str, Any]] = []
    current_path_checks: dict[str, dict[str, Any]] = {}

    for row in originals:
        registered_size = int(row["byte_size_registered"])
        path_check = path_lstat_only(source_root, row["relative_path"], registered_size)
        current_path_checks[row["file_id"]] = path_check
        primary, secondary, reason = classify_route(row)
        roles, context, capabilities, interpretation_limit = route_semantics(primary, row)
        modules = split_pipe(row["module_ids"])
        input_record_sha256 = canonical_hash(row)
        routing_state = "NEEDS_CLASSIFICATION" if primary == "UNKNOWN" else "ROUTED"
        route = {
            "schema_version": "0.1",
            "run_id": args.run_id,
            "routing_id": f"ROUTE-{row['file_id']}",
            "source_id": row["source_id"],
            "source_title": row["source_title"],
            "source_kind": row["source_kind"],
            "file_id": row["file_id"],
            "document_family_id": row["document_family_id"],
            "document_version_id": row["document_version_id"],
            "is_original": True,
            "parent_ref": {
                "duplicate_of_file_id": row["duplicate_of_file_id"],
                "parent_document_hint": row["parent_document_hint"],
            },
            "relative_path": row["relative_path"],
            "sha256": row["sha256_registered"],
            "byte_size_registered": registered_size,
            "representation": row["representation"],
            "storage_zone": row["storage_zone"],
            "current_path_check": path_check,
            "primary_route": primary,
            "secondary_routes": secondary,
            "routing_state": routing_state,
            "objective_roles": roles,
            "evidence_context": context,
            "classification_basis": "METADATA_ONLY",
            "classification_evidence": {
                "fields": ["source_kind", "representation", "storage_zone", "relative_path", "module_ids"],
                "values": {
                    "source_kind": row["source_kind"],
                    "representation": row["representation"],
                    "storage_zone": row["storage_zone"],
                    "module_ids": modules,
                },
                "content_read_this_run": False,
                "existing_precheck_status_preserved_not_reperformed": row["precheck_status"],
            },
            "classification_reason": reason,
            "module_ids": modules,
            "capability_tags": capabilities,
            "scope": {
                "site": "UNKNOWN",
                "chemistry": "UNKNOWN",
                "object_level": "UNKNOWN",
                "activity": "UNKNOWN",
                "version_scope": row["document_version_id"],
                "scope_note": "Module/capability labels are routing tags, not an adequacy or applicability score.",
            },
            "rights_record": {
                "effective_rights_id": row["effective_rights_id"],
                "linkage": row["rights_linkage"],
                "reviewer_type": row["rights_reviewer_type"],
            },
            "processing_plan": {
                "selected_for_pilot": False,
                "proposed_tool": "portable_transform_draft.py after exact gate approval",
                "expected_artifact": {
                    "DOC_RAG": "PortableDocumentChunk",
                    "SPEC_DB": "PortableSpecificationRecord",
                    "EXPERIMENT_DATA": "PortableExperimentSubset",
                }.get(primary, "None in Phase A"),
                "blocked_reason": "ACTION_AND_OUTPUT_PURPOSE_GATES_UNRESOLVED",
                "priority": "CANDIDATE_REVIEW" if primary in {"DOC_RAG", "SPEC_DB", "EXPERIMENT_DATA"} else "NORMAL",
                "next_responsible_role": "Rights data steward and accountable purpose reviewer",
            },
            "actual_status": {
                "metadata_routing_state": "PREPARED",
                "content_preparation_state": "BLOCKED",
                "quality_state": "HUMAN_PENDING",
                "index_state": "NOT_ATTEMPTED",
                "query_verification": "NOT_RUN_SERVER_PENDING",
                "release_state": "NOT_REQUESTED",
            },
            "interpretation_limit": interpretation_limit,
            "lineage": {
                "input_record_sha256": input_record_sha256,
                "input_artifact": "SOURCE_DOCUMENT_FILE_MAP.csv",
                "input_artifact_sha256": sha256_file(map_path),
                "run_id": args.run_id,
                "transform_id": "prepare_phase_a.py:metadata-route:v0.1",
            },
        }
        route_records.append(route)
        route_csv_rows.append(
            {
                "routing_id": route["routing_id"],
                "run_id": args.run_id,
                "source_id": row["source_id"],
                "file_id": row["file_id"],
                "document_version_id": row["document_version_id"],
                "is_original": "true",
                "relative_path": row["relative_path"],
                "sha256": row["sha256_registered"],
                "byte_size_registered": registered_size,
                "representation": row["representation"],
                "primary_route": primary,
                "secondary_routes": " | ".join(secondary),
                "routing_state": routing_state,
                "objective_roles": " | ".join(roles),
                "evidence_context": context,
                "classification_basis": "METADATA_ONLY",
                "module_ids": " | ".join(modules),
                "capability_tags": " | ".join(capabilities),
                "rights_linkage": row["rights_linkage"],
                "parsing_right": row["parsing_right"],
                "external_service_transfer_right": row["external_service_transfer_right"],
                "rag_right": row["rag_right"],
                "training_right": row["training_right"],
                "metadata_routing_state": "PREPARED",
                "content_preparation_state": "BLOCKED",
                "selected_for_pilot": "false",
                "query_verification": "NOT_RUN_SERVER_PENDING",
                "input_record_sha256": input_record_sha256,
            }
        )
        binding_missing = row["rights_linkage"] != "DIRECT_RIGHTS_RECORD_ID"
        sidecars.append(
            {
                "schema_version": "0.1",
                "run_id": args.run_id,
                "sidecar_id": f"RIGHTS-PURPOSE-{row['file_id']}",
                "source_id": row["source_id"],
                "file_id": row["file_id"],
                "document_version_id": row["document_version_id"],
                "sha256": row["sha256_registered"],
                "binding_repair": {
                    "required": binding_missing,
                    "current_linkage": row["rights_linkage"],
                    "candidate_effective_rights_id": row["effective_rights_id"],
                    "candidate_scope": "EXACT_FILE_ID_AND_SHA256",
                    "candidate_status": "CANDIDATE_ONLY_NO_PERMISSION_UPGRADE" if binding_missing else "EXISTING_DIRECT_BINDING",
                    "decision_state": "UNKNOWN" if binding_missing else "PRESERVED_EXISTING_RECORD",
                },
                "purpose_rights": purpose_rights(row),
                "action_output_gates": action_output_gates(row, primary),
                "non_inference_rules": [
                    "document RAG DENY does not become a global deny for structured processing",
                    "not DENIED does not mean ALLOW",
                    "storage permission does not imply parsing, transfer, RAG, training, or publication permission",
                    "an existing derivative does not automatically gain a new reuse or output-purpose permission",
                ],
            }
        )
        blocked_reasons = [
            "NEW_PARSE_BLOCKED_PARSING_RIGHT_UNKNOWN",
            "EXISTING_DERIVATIVE_REUSE_PURPOSE_UNKNOWN",
            "SERVER_TRANSFER_BLOCKED_RIGHT_UNKNOWN",
        ]
        if row["rag_right"] == "DENIED":
            blocked_reasons.append("DOCUMENT_RAG_DENIED_THIS_PURPOSE_ONLY")
        preparation_rows.append(
            {
                "run_id": args.run_id,
                "source_id": row["source_id"],
                "file_id": row["file_id"],
                "routing_state": routing_state,
                "metadata_preparation_state": "PREPARED",
                "content_preparation_state": "BLOCKED",
                "quality_state": "HUMAN_PENDING",
                "purpose_decision": {
                    "parsing": row["parsing_right"],
                    "ai_semantic_processing": row["ai_semantic_processing_right"],
                    "external_service_transfer": row["external_service_transfer_right"],
                    "rag": row["rag_right"],
                    "training": row["training_right"],
                    "derivative_publication": row["derivative_publication_right"],
                },
                "index_state": "NOT_ATTEMPTED",
                "query_verification": "NOT_RUN_SERVER_PENDING",
                "release_state": "NOT_REQUESTED",
                "blocked_reasons": blocked_reasons,
                "next_responsible_role": "Rights data steward and accountable purpose reviewer",
            }
        )
        task_evidence_rows.append(
            {
                "routing_id": route["routing_id"],
                "source_id": row["source_id"],
                "file_id": row["file_id"],
                "document_version_id": row["document_version_id"],
                "primary_route": primary,
                "module_ids": " | ".join(modules),
                "capability_tags": " | ".join(capabilities),
                "objective_roles": " | ".join(roles),
                "evidence_context": context,
                "classification_basis": "METADATA_ONLY",
                "interpretation_limit": interpretation_limit,
                "current_case_status": (
                    "HISTORICAL_NOT_CURRENT_CASE" if context == "HISTORICAL_EXPERIMENT" else "NOT_ESTABLISHED"
                ),
                "purpose_gate_summary": "ROUTED_ONLY_CONTENT_USE_BLOCKED_OR_PENDING",
                "specific_gap": "Exact action/output-purpose permission and human review are unresolved.",
            }
        )

    routes_by_file = {record["file_id"]: record for record in route_records}
    route_counts = Counter(record["primary_route"] for record in route_records)
    routing_state_counts = Counter(record["routing_state"] for record in route_records)
    path_state_counts = Counter(check["state"] for check in current_path_checks.values())
    size_match_count = sum(1 for check in current_path_checks.values() if check.get("size_matches_registered"))

    finding_by_id = {row["finding_id"]: row for row in findings}
    conflict_sources = set(split_pipe(finding_by_id["EXT-F003"]["source_ids"]))
    source_routes: dict[str, Counter[str]] = defaultdict(Counter)
    for record in route_records:
        source_routes[record["source_id"]][record["primary_route"]] += 1

    current_sources = []
    for source in final_status["sources"]:
        source_id = source["source_id"]
        current_sources.append(
            {
                "source_id": source_id,
                "title": source["title"],
                "immutable_discovery_baseline": {
                    "status": "CONFLICT_REPORTED_BY_EXT_F003" if source_id in conflict_sources else "NO_CONFLICT_REPORTED_BY_EXT_F003",
                    "values_rewritten": False,
                    "evidence_ref": "FINDINGS.csv:EXT-F003" if source_id in conflict_sources else "FINDINGS.csv",
                },
                "later_receipt_and_ledger_layer": {
                    "outcome": source["outcome"],
                    "original_count": source["original_count"],
                    "independent_version_count": source["independent_version_count"],
                    "last_recorded_attempt_result": source["last_recorded_attempt_result"],
                    "next_action_from_ext_audit": source["next_action"],
                    "evidence_ref": "FINAL_STATUS.json:sources",
                },
                "phase_a_view": {
                    "route_counts": dict(sorted(source_routes[source_id].items())),
                    "view_basis": "FROZEN_AUDIT_METADATA_PLUS_EXACT_LSTAT_ONLY_PATH_CHECKS",
                    "content_read": False,
                    "post_cutoff_content_change": "NOT_HASH_CHECKED",
                    "permission_changed": False,
                },
                "precedence": (
                    "LATER_EXACT_RECEIPTS_AND_CURRENT_LEDGER_OVER_IMMUTABLE_DISCOVERY_BASELINE"
                    if source_id in conflict_sources
                    else "NO_REPORTED_BASELINE_CONFLICT; EXACT_VERSIONED_EVENTS_STILL_CONTROL"
                ),
            }
        )

    input_snapshot = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "phase": "A",
        "run_id": args.run_id,
        "created_at": args.created_at,
        "artifact_status": ARTIFACT_STATUS,
        "execution_boundary": "LOCAL_DATA_PREPARATION_ONLY",
        "source_workspace": {
            "path": str(source_root),
            "access": "READ_ONLY_INPUT",
            "recursive_scan_this_run": False,
            "original_content_files_opened_this_run": 0,
            "original_content_bytes_read_this_run": 0,
            "original_sha256_recomputed_this_run": 0,
            "exact_original_paths_lstat_checked": len(current_path_checks),
            "lstat_state_counts": dict(sorted(path_state_counts.items())),
            "lstat_size_matches_registered": size_match_count,
            "path_check_interpretation": "Static path/size metadata check only; not a content or integrity test.",
        },
        "ext_audit_snapshot": {
            "audit_id": snapshot_manifest["audit_id"],
            "audit_directory": str(audit_dir),
            "statistics_cutoff_utc": snapshot_manifest["statistics_cutoff_utc"],
            "file_count": snapshot_manifest["file_count"],
            "total_bytes": snapshot_manifest["total_bytes"],
            "aggregate_sha256": snapshot_manifest["aggregate_sha256"],
            "verification_basis": "HISTORICAL_RECEIPT_REUSED_NOT_REHASHED_THIS_RUN",
            "audit_directory_inventory": audit_inventory,
        },
        "control_inputs": control_inputs,
        "mapping_input": {
            "path": str(map_path),
            "sha256": sha256_file(map_path),
            "rows": len(mapping_rows),
            "original_rows": len(originals),
            "independent_document_versions_historical": final_status["counts"]["independent_document_versions"],
        },
        "read_scope": {
            "interpreted": sorted(AUDIT_INTERPRETED_INPUTS),
            "hash_identity_only": sorted(
                item["name"] for item in audit_inventory if item["input_use"] == "HASHED_IDENTITY_ONLY"
            ),
            "explicitly_excluded": [
                "all original file content",
                "locked evaluation answers",
                "private oracle",
                "directories outside the explicit source workspace, audit directory, and bsc project",
            ],
        },
        "historical_results_boundary": {
            "ext_audit_tests": "HISTORICAL_ONLY_NOT_EXECUTED_THIS_RUN",
            "historical_56_of_56": "NOT_A_CR_DATA_ROUTE_001_RESULT",
            "project_tests_run_this_run": 0,
        },
    }

    current_state_index = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": args.run_id,
        "created_at": args.created_at,
        "artifact_status": ARTIFACT_STATUS,
        "view_type": "DERIVED_FROM_FROZEN_AUDIT_METADATA_WITH_LSTAT_ONLY_CURRENT_PATH_CHECKS",
        "layers": [
            {
                "layer": "IMMUTABLE_DISCOVERY_BASELINE",
                "state": "PRESERVED_NOT_REWRITTEN",
                "evidence": "EXT-F003 and cited baseline registry paths",
            },
            {
                "layer": "LATER_RECEIPTS_AND_CURRENT_LEDGER_AT_AUDIT_CUTOFF",
                "state": "AUTHORITATIVE_FOR_RECORDED_ACQUISITION_EVENTS",
                "evidence": "FINAL_STATUS.json, SOURCE_DOCUMENT_FILE_MAP.csv, and EXT-AUDIT-01 receipts",
            },
            {
                "layer": "CR_DATA_ROUTE_001_PHASE_A_VIEW",
                "state": "METADATA_ROUTED_NO_PERMISSION_CHANGE",
                "evidence": "ROUTING_MANIFEST.jsonl and RIGHTS_PURPOSE_SIDECAR.jsonl",
            },
        ],
        "precedence_rule": "Use exact object/version/event evidence; later bound receipts may supersede baseline acquisition state without rewriting history. Do not use filename recency alone.",
        "summary": {
            "source_entries": len(current_sources),
            "sources_with_reported_baseline_conflict": len(conflict_sources),
            "originals": len(originals),
            "route_counts": dict(sorted(route_counts.items())),
            "routing_state_counts": dict(sorted(routing_state_counts.items())),
            "direct_rights_bindings": sum(1 for row in originals if row["rights_linkage"] == "DIRECT_RIGHTS_RECORD_ID"),
            "binding_repair_candidates": sum(1 for row in originals if row["rights_linkage"] != "DIRECT_RIGHTS_RECORD_ID"),
            "parsing_right_unknown": sum(1 for row in originals if row["parsing_right"] == "UNKNOWN"),
            "external_service_transfer_right_unknown": sum(
                1 for row in originals if row["external_service_transfer_right"] == "UNKNOWN"
            ),
            "rag_admission_pending": sum(1 for row in originals if row["rag_admission"] == "PENDING"),
            "rag_admission_denied": sum(1 for row in originals if row["rag_admission"] == "DENIED"),
            "human_not_reviewed": sum(1 for row in originals if row["human_review_status"] == "NOT_REVIEWED"),
            "post_cutoff_source_content_changes": "NOT_HASH_CHECKED",
        },
        "special_precedence_notes": [
            {
                "source_id": "SRC-017",
                "finding": "EXT-F010",
                "rule": "The earlier pre-authorisation README remains historical; later acquisition receipts control current acquisition state without rewriting the README.",
            }
        ],
        "sources": current_sources,
    }

    document_candidates = choose_candidates(originals, routes_by_file, "DOC_RAG")
    specification_candidates = choose_candidates(originals, routes_by_file, "SPEC_DB")
    experiment_candidates = choose_candidates(originals, routes_by_file, "EXPERIMENT_DATA")
    pilot_matrix = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": args.run_id,
        "created_at": args.created_at,
        "artifact_status": ARTIFACT_STATUS,
        "selection_result": "NO_PILOT_SELECTED_GATES_UNRESOLVED",
        "selection_policy": {
            "basis": "METADATA_ONLY",
            "new_parsing_rule": "BLOCK while parsing_right is UNKNOWN",
            "existing_derivative_rule": "Existing files require separate reuse, AI, derivative-output, and destination decisions",
            "rag_scope_rule": "RAG DENY controls RAG only and is not generalized to structured processing",
            "non_deny_rule": "Not DENIED never implies ALLOW",
        },
        "paths": [
            {
                "path_id": "DOCUMENT_RAG",
                "status": "BLOCKED_ACTION_SPECIFIC_RIGHTS",
                "shortlist": document_candidates,
                "candidate_filter_note": "Rows with explicit RAG DENY are excluded from this RAG shortlist only.",
                "proposed_limits": {
                    "status": "PROPOSED_NOT_APPROVED",
                    "max_bytes_read_per_candidate": 25_000_000,
                    "max_bytes_written_per_candidate": 25_000_000,
                    "timeout_seconds": 300,
                    "minimum_free_bytes": 1_000_000_000,
                },
            },
            {
                "path_id": "SPECIFICATION",
                "status": "BLOCKED_ACTION_SPECIFIC_RIGHTS",
                "shortlist": specification_candidates,
                "candidate_filter_note": "Restricted Molicel/TI materials are not forced into the shortlist; structured-use eligibility remains separate from RAG state.",
                "proposed_limits": {
                    "status": "PROPOSED_NOT_APPROVED",
                    "max_bytes_read_per_candidate": 25_000_000,
                    "max_bytes_written_per_candidate": 10_000_000,
                    "timeout_seconds": 300,
                    "minimum_free_bytes": 1_000_000_000,
                },
            },
            {
                "path_id": "EXPERIMENT",
                "status": "BLOCKED_ACTION_SPECIFIC_RIGHTS",
                "shortlist": experiment_candidates,
                "candidate_filter_note": "Structured experiment candidacy is evaluated separately from document-RAG DENY; no structured action is treated as allowed.",
                "proposed_limits": {
                    "status": "PROPOSED_NOT_APPROVED",
                    "max_bytes_read_per_candidate": 100_000_000,
                    "max_bytes_written_per_candidate": 50_000_000,
                    "timeout_seconds": 600,
                    "minimum_free_bytes": 2_000_000_000,
                },
            },
        ],
    }

    schema_catalog = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": args.run_id,
        "artifact_status": ARTIFACT_STATUS,
        "schemas": [
            {"path": "schemas/document_chunk.schema.json", "kind": "DOCUMENT_CHUNK", "status": ARTIFACT_STATUS},
            {"path": "schemas/specification_record.schema.json", "kind": "SPECIFICATION_RECORD", "status": ARTIFACT_STATUS},
            {"path": "schemas/experiment_subset.schema.json", "kind": "EXPERIMENT_SUBSET", "status": ARTIFACT_STATUS},
        ],
        "conversion_script": {
            "path": "scripts/data_route/portable_transform_draft.py",
            "status": ARTIFACT_STATUS,
            "executed_this_run": False,
            "gate_requirement": "Exact trusted ALLOW for action and output purpose; UNKNOWN/PENDING/RESTRICTED/DENY are rejected.",
        },
    }

    server_definitions = server_test_definitions(args.run_id, args.created_at)

    candidate_lines = []
    for path in pilot_matrix["paths"]:
        ids = ", ".join(candidate["file_id"] for candidate in path["shortlist"]) or "NONE"
        candidate_lines.append(f"- `{path['path_id']}`: {ids}; status `{path['status']}`.")

    server_plan = f"""# CR-DATA-ROUTE-001 Phase A — server import plan

Status: `{ARTIFACT_STATUS}`  
Run: `{args.run_id}`  
Execution: **not run; server not connected**

## Current bundle eligibility

| Bundle | Eligible real source records | State |
|---|---:|---|
| `code_bundle` | scripts/schemas only | PREPARED_LOCALLY_UNVERIFIED; transfer not performed |
| `rag_source_bundle` | 0 | BLOCKED: no RAG admission and exact transfer decision |
| `specification_seed_bundle` | 0 | BLOCKED: exact structured action/output-purpose decision absent |
| `experiment_subset_bundle` | 0 | BLOCKED: exact structured action/output-purpose decision absent |
| `eval_public_inputs` | 0 real-source fixtures | Definitions only; DEFINED_NOT_RUN |
| `eval_private_oracle` | 0 | Explicitly excluded from this run and ordinary application access |
| `training_candidate_bundle` | 0 | Creation and training prohibited in the current stage |

No source file is approved for transfer by this plan. A future manifest must list exact `source_id`, `file_id`, version, SHA-256, action, output purpose, destination bundle, retention, and accountable decision.

## Candidate handoff queue

{chr(10).join(candidate_lines)}

These are metadata shortlists, not selected samples and not transfer allowlists.

## Server import sequence (draft; not executed)

1. Configure the server, secrets, working directory, dependency policy, and result-return directory under ADR-EXEC-001.
2. Receive separate `code_bundle`, `rag_source_bundle`, `eval_public_inputs`, `eval_private_oracle`, and future `training_candidate_bundle` manifests. Never merge their roots or permissions.
3. Re-verify each approved transferred file hash against its exact manifest; retain raw stdout/stderr and a server run manifest.
4. Reject any record whose action/output-purpose decision is not trusted `ALLOW`, whose version/hash differs, or whose bundle class is inconsistent.
5. Import approved canonical seeds into a newly created server database/index. This local run does not create, migrate, or write that database.
6. Execute only the query and test definitions in `SERVER_TEST_DEFINITIONS.json`; preserve every non-run, blocked, error, and result record.
7. Return server evidence to the configured `outputs/server_runs/` location. Do not write results into the source workspace.

## Query contract drafts

```text
search_evidence(query, scope)
get_specification(object_ref, parameter)
describe_experiment(experiment_ref)
query_experiment(experiment_ref, selection)
```

Every result must include request ID, status, source/version/locator, configuration version, limits, synthetic flag, and whether historical verification was reused. No arbitrary SQL, shell, local path, or external URL execution is exposed.

## Evidence required before a server result can be called PASSED or FAILED

- server run manifest and environment snapshot;
- exact input/output hashes and bundle manifests;
- raw stdout/stderr and timestamps;
- model/index/tool versions where applicable;
- retained failure records and reason codes.

This file defines a handoff plan only. It is not an import receipt, query result, database validation, or RAG readiness claim.
"""

    blockers = f"""# CR-DATA-ROUTE-001 Phase A — blockers and next actions

Run: `{args.run_id}`  
Phase A outcome: `LOCAL_ROUTING_PREPARED`  
Content processing/server handoff: `BLOCKED_ACTION_SPECIFIC_RIGHTS`

## Concrete blockers

1. **New parsing — all 300 originals.** `parsing_right=UNKNOWN` for 300/300. No new document extraction, parameter extraction, dataset parsing, or archive unpacking was performed.
2. **Existing derivative reuse — candidate-specific.** A historical `parse_status=COMPLETE` or extraction path does not establish reuse, AI processing, new derivative output, or destination permission. Those decisions remain `UNKNOWN` for the proposed outputs.
3. **External server transfer — all 300 originals.** `external_service_transfer_right=UNKNOWN` for 300/300. No connection, upload, or transfer allowlist was created.
4. **Document RAG — purpose-specific.** RAG admission is 242 `PENDING` and 58 `DENIED`; zero are admitted. A DENY blocks only RAG and direct derivatives. It does not decide specification or experiment structuring.
5. **Direct rights binding — 101 originals.** These have only indirect source-level linkage. `RIGHTS_PURPOSE_SIDECAR.jsonl` records exact file/hash repair candidates without changing decisions.
6. **Human review — all 300 originals.** All remain `NOT_REVIEWED`; Phase A did not create approvals.
7. **Server execution gates.** Server configuration, approved bundles, transfer scope, dependency/network/compute policy, and result-return location remain unset. T00 remains `NOT_STARTED`.

## Minimal human decisions to unblock only the three pilots

For one exact candidate in each path, an accountable reviewer must record:

- exact `file_id`, `document_version_id`, SHA-256, and component/member scope;
- action (`new_parse` or `reuse_existing_derivative`);
- exact output purpose (`document_chunk`, `specification_seed`, or `experiment_subset`);
- allowed local processing, AI handling, new derivative creation, retention, and destination;
- a separate external-service transfer decision for the named server bundle;
- for document RAG only, an explicit RAG context/index decision and admission scope;
- reviewer authority, evidence reference, conditions, validity, and revocation handling.

No blanket decision over a source family is requested unless the authority and evidence genuinely cover every listed file/version/action/purpose.

## Metadata shortlists awaiting those decisions

{chr(10).join(candidate_lines)}

## Safe next step

Review `PILOT_CANDIDATE_MATRIX.json` and choose at most one exact candidate per path. Record the decisions above in a trusted, file/hash-bound rights record. Only then schedule a separate Phase B run. Other metadata and governance work may continue while a single path remains blocked.
"""

    portable_readme = f"""# Portable schemas and conversion draft

Status: `{ARTIFACT_STATUS}`  
Run: `{args.run_id}`

The three JSON Schemas describe portable document chunks, specification records, and experiment subsets. They contain no source content. The companion script `scripts/data_route/portable_transform_draft.py` was authored but not executed.

The draft script requires an exact trusted gate document with `decision=ALLOW`, a matching file ID/hash, a named action, and a named output purpose. It rejects `UNKNOWN`, `PENDING`, `RESTRICTED`, and `DENY`. Schema shape cannot grant permission or prove scientific correctness.

No project test, query, database import, RAG indexing, model inference, or content conversion was run locally.
"""

    write_json(output_dir / "INPUT_SNAPSHOT.json", input_snapshot)
    write_json(output_dir / "CURRENT_STATE_INDEX.json", current_state_index)
    write_jsonl(output_dir / "ROUTING_MANIFEST.jsonl", route_records)
    write_csv(
        output_dir / "ROUTING_MANIFEST.csv",
        route_csv_rows,
        [
            "routing_id",
            "run_id",
            "source_id",
            "file_id",
            "document_version_id",
            "is_original",
            "relative_path",
            "sha256",
            "byte_size_registered",
            "representation",
            "primary_route",
            "secondary_routes",
            "routing_state",
            "objective_roles",
            "evidence_context",
            "classification_basis",
            "module_ids",
            "capability_tags",
            "rights_linkage",
            "parsing_right",
            "external_service_transfer_right",
            "rag_right",
            "training_right",
            "metadata_routing_state",
            "content_preparation_state",
            "selected_for_pilot",
            "query_verification",
            "input_record_sha256",
        ],
    )
    write_jsonl(output_dir / "RIGHTS_PURPOSE_SIDECAR.jsonl", sidecars)
    write_csv(
        output_dir / "TASK_EVIDENCE_MAP.csv",
        task_evidence_rows,
        [
            "routing_id",
            "source_id",
            "file_id",
            "document_version_id",
            "primary_route",
            "module_ids",
            "capability_tags",
            "objective_roles",
            "evidence_context",
            "classification_basis",
            "interpretation_limit",
            "current_case_status",
            "purpose_gate_summary",
            "specific_gap",
        ],
    )
    write_json(output_dir / "PILOT_CANDIDATE_MATRIX.json", pilot_matrix)
    write_jsonl(output_dir / "PREPARATION_STATUS.jsonl", preparation_rows)
    write_text(output_dir / "SERVER_IMPORT_PLAN.md", server_plan)
    write_json(output_dir / "SERVER_TEST_DEFINITIONS.json", server_definitions)
    write_text(output_dir / "BLOCKERS_AND_NEXT_ACTIONS.md", blockers)
    write_json(schemas_dir / "document_chunk.schema.json", document_chunk_schema())
    write_json(schemas_dir / "specification_record.schema.json", specification_schema())
    write_json(schemas_dir / "experiment_subset.schema.json", experiment_schema())
    write_json(output_dir / "SCHEMA_CATALOG.json", schema_catalog)
    write_text(output_dir / "PORTABLE_SCHEMA_README.md", portable_readme)

    summary = {
        "run_id": args.run_id,
        "output_dir": str(output_dir),
        "originals": len(originals),
        "route_counts": dict(sorted(route_counts.items())),
        "routing_state_counts": dict(sorted(routing_state_counts.items())),
        "binding_repair_candidates": sum(1 for row in originals if row["rights_linkage"] != "DIRECT_RIGHTS_RECORD_ID"),
        "source_content_files_opened": 0,
        "project_tests_run": 0,
        "status": "CORE_PHASE_A_ARTIFACTS_WRITTEN_AWAITING_STATIC_VALIDATION_AND_FINALIZATION",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
