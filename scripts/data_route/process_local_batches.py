#!/usr/bin/env python3
"""Process evidence-supported local document, specification, and experiment batches.

This is a local data-processing program, not T00, a model evaluation, a target
RAG/database build, or a server acceptance run. It resolves an existing exact
rights record before opening each source or reusable derivative.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


DOC_SOURCE_IDS = {"SRC-002", "SRC-009", "SRC-010", "SRC-032"}
SPEC_SOURCE_IDS = {"SRC-039", "SRC-040"}
EXPERIMENT_FILE_IDS = {
    "FILE-017-d658c98f59e5-8fc995",
    "FILE-017-cbcb1f5a4643-774f0e",
    "FILE-017-25944eb9eb56-a3a443",
    "FILE-017-35c6c6f0a697-0db5d2",
    "FILE-017-52b8706c7e1f-d201dd",
}

EXPERIMENT_REQUIRED_FIELDS = [
    "Data_Point",
    "Test_Time",
    "DateTime",
    "Step_Time",
    "Step_Index",
    "Cycle_Index",
    "Current",
    "Voltage",
    "Charge_Capacity",
    "Discharge_Capacity",
    "Charge_Energy",
    "Discharge_Energy",
    "dV/dt",
    "Internal_Resistance",
    "Temperature",
]

EXPERIMENT_FIELD_DICTIONARY = {
    "Data_Point": {"unit": None, "meaning": "source row/data-point index", "unit_basis": "dimensionless index"},
    "Test_Time": {"unit": "s", "meaning": "elapsed test time", "unit_basis": "BEEP Battery Archive format reference"},
    "DateTime": {"unit": "s_since_unix_epoch", "meaning": "numeric timestamp", "unit_basis": "value-format inference; needs source-owner confirmation"},
    "Step_Time": {"unit": "s", "meaning": "elapsed step time", "unit_basis": "field-name convention; needs source-owner confirmation"},
    "Step_Index": {"unit": None, "meaning": "cycler step index", "unit_basis": "dimensionless index"},
    "Cycle_Index": {"unit": None, "meaning": "cycler cycle index", "unit_basis": "BEEP Battery Archive format reference"},
    "Current": {"unit": "A", "meaning": "cell current", "unit_basis": "BEEP Battery Archive format reference"},
    "Voltage": {"unit": "V", "meaning": "cell voltage", "unit_basis": "BEEP Battery Archive format reference"},
    "Charge_Capacity": {"unit": "Ah", "meaning": "charge capacity", "unit_basis": "BEEP Battery Archive format reference"},
    "Discharge_Capacity": {"unit": "Ah", "meaning": "discharge capacity", "unit_basis": "BEEP Battery Archive format reference"},
    "Charge_Energy": {"unit": "Wh", "meaning": "charge energy", "unit_basis": "BEEP Battery Archive format reference"},
    "Discharge_Energy": {"unit": "Wh", "meaning": "discharge energy", "unit_basis": "BEEP Battery Archive format reference"},
    "dV/dt": {"unit": "V/s", "meaning": "voltage time derivative", "unit_basis": "field-name inference; needs source-owner confirmation"},
    "Internal_Resistance": {"unit": "ohm", "meaning": "reported internal resistance", "unit_basis": "field-name convention; needs source-owner confirmation"},
    "Temperature": {"unit": "degC", "meaning": "reported cell temperature", "unit_basis": "BEEP temperature convention; sensor reliability caveat in project metadata"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-root", default=r"E:\desn 2000\data\battery_data_workspace_v0_3")
    parser.add_argument(
        "--phase-a-run",
        default=r"E:\desn 2000\bsc\data_preparation\CR-DATA-ROUTE-001\20260919T185236_AEST_phase_a",
    )
    parser.add_argument(
        "--output-root",
        default=r"E:\desn 2000\bsc\data_preparation\CR-DATA-ROUTE-001",
    )
    parser.add_argument("--unit-test-result", choices=("PASSED", "FAILED", "NOT_RUN"), default="NOT_RUN")
    parser.add_argument("--unit-test-command", default="NOT_RUN")
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number} is not a JSON object")
            rows.append(value)
    return rows


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, allow_nan=False))
            handle.write("\n")
            count += 1
    return count


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(value)
        if value and not value.endswith("\n"):
            handle.write("\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_source_path(source_root: Path, relative_path: str) -> Path:
    rel = PurePosixPath(relative_path)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"unsafe source relative path: {relative_path}")
    root = source_root.resolve()
    candidate = root.joinpath(*rel.parts).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError(f"source path escapes registered root: {relative_path}")
    return candidate


def resolve_permission(route: dict[str, Any], rights_records: list[dict[str, Any]]) -> dict[str, Any]:
    """Resolve existing AI-processing evidence without opening source content."""

    file_id = route["file_id"]
    source_id = route["source_id"]
    sha256 = route["sha256"]
    effective_rights_id = route["rights_record"]["effective_rights_id"]
    exact = [
        row
        for row in rights_records
        if row.get("file_id") == file_id
        and row.get("file_sha256") == sha256
        and row.get("ai_processing") == "ALLOWED"
    ]
    if exact:
        row = exact[0]
        return {
            "decision": "ALLOW_LOCAL_PROCESSING",
            "binding": "EXACT_FILE_ID_AND_SHA256",
            "rights_id": row["rights_id"],
            "evidence_file_ids": row.get("evidence_file_ids") or [row.get("evidence_file_id")],
            "basis_summary": row.get("basis_summary"),
            "scope": row.get("scope"),
            "reviewer_type": row.get("reviewer_type"),
            "rag": row.get("rag"),
            "training": row.get("training"),
            "redistribution": row.get("redistribution"),
        }
    source_scope = [
        row
        for row in rights_records
        if not row.get("file_id")
        and row.get("source_id") == source_id
        and row.get("rights_id") == effective_rights_id
        and row.get("ai_processing") == "ALLOWED"
    ]
    if source_scope:
        row = source_scope[0]
        return {
            "decision": "ALLOW_LOCAL_PROCESSING",
            "binding": "RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS",
            "rights_id": row["rights_id"],
            "evidence_file_ids": row.get("evidence_file_ids") or [row.get("evidence_file_id")],
            "basis_summary": row.get("basis_summary"),
            "scope": row.get("scope"),
            "reviewer_type": row.get("reviewer_type"),
            "rag": row.get("rag"),
            "training": row.get("training"),
            "redistribution": row.get("redistribution"),
        }
    raise PermissionError(
        f"no existing AI-processing ALLOW binds {file_id}/{sha256}/{effective_rights_id}"
    )


def describe_permission_gap(route: dict[str, Any], rights_records: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe why an unselected object is not locally processable without opening it."""

    file_id = route["file_id"]
    source_id = route["source_id"]
    sha256 = route["sha256"]
    effective_rights_id = route["rights_record"]["effective_rights_id"]
    exact = [
        row
        for row in rights_records
        if row.get("file_id") == file_id and row.get("file_sha256") == sha256
    ]
    group = [
        row
        for row in rights_records
        if not row.get("file_id")
        and row.get("source_id") == source_id
        and row.get("rights_id") == effective_rights_id
    ]
    applicable = exact or group
    if not applicable:
        source_records = [row for row in rights_records if row.get("source_id") == source_id]
        return {
            "status": "BLOCKED_INSUFFICIENT_FILE_OR_GROUP_RIGHTS_BINDING",
            "basis_state": "FILE_ASSOCIATION_INSUFFICIENT" if source_records else "NO_SOURCE_RIGHTS_RECORD",
            "effective_rights_id": effective_rights_id,
            "recorded_ai_processing_values": sorted(
                {str(row.get("ai_processing", "UNMAPPED")) for row in source_records}
            ),
        }
    values = sorted({str(row.get("ai_processing", "UNMAPPED")) for row in applicable})
    if values == ["PENDING"]:
        status = "BLOCKED_AI_PROCESSING_PURPOSE_DECISION_PENDING"
        basis_state = "PURPOSE_MEANING_OR_DECISION_PENDING"
    elif "RESTRICTED" in values:
        status = "BLOCKED_EXPLICIT_AI_PROCESSING_RESTRICTION"
        basis_state = "EXPLICIT_RESTRICTION"
    else:
        status = "BLOCKED_AMBIGUOUS_AI_PROCESSING_DECISION"
        basis_state = "AMBIGUOUS_OR_UNMAPPED_DECISION"
    return {
        "status": status,
        "basis_state": basis_state,
        "effective_rights_id": effective_rights_id,
        "recorded_ai_processing_values": values,
        "applicable_rights_ids": sorted({str(row.get("rights_id")) for row in applicable}),
    }


def normalise_space(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


class TraceHTMLParser(HTMLParser):
    """Extract visible blocks and table rows with source-line locators."""

    ignored_tags = {"script", "style", "noscript", "svg", "nav", "header", "footer"}
    block_tags = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self, has_scoped_content: bool) -> None:
        super().__init__(convert_charrefs=True)
        self.has_scoped_content = has_scoped_content
        self.scope_depth = 0
        self.ignore_depth = 0
        self.current_block: dict[str, Any] | None = None
        self.current_cell: dict[str, Any] | None = None
        self.current_row: dict[str, Any] | None = None
        self.table_index = 0
        self.row_index = 0
        self.section_levels: dict[int, str] = {}
        self.items: list[dict[str, Any]] = []

    def enabled(self) -> bool:
        return self.ignore_depth == 0 and (not self.has_scoped_content or self.scope_depth > 0)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"main", "article"}:
            self.scope_depth += 1
        if tag in self.ignored_tags:
            self.ignore_depth += 1
            return
        if not self.enabled():
            return
        if tag == "table":
            self.table_index += 1
            self.row_index = 0
        elif tag == "tr":
            self.row_index += 1
            self.current_row = {"line": self.getpos()[0], "cells": [], "cell_emphasis": []}
        elif tag in {"td", "th"} and self.current_row is not None:
            self.current_cell = {
                "tag": tag,
                "line": self.getpos()[0],
                "parts": [],
                "emphasized": tag == "th",
            }
        elif tag in {"strong", "b"} and self.current_cell is not None:
            self.current_cell["emphasized"] = True
        elif tag in self.block_tags and self.current_cell is None:
            self._finish_block()
            self.current_block = {"tag": tag, "line": self.getpos()[0], "parts": []}

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.ignored_tags:
            if self.ignore_depth:
                self.ignore_depth -= 1
            return
        if self.enabled():
            if tag in {"td", "th"} and self.current_cell is not None:
                cell = normalise_space("".join(self.current_cell["parts"]))
                self.current_row["cells"].append(cell)
                self.current_row["cell_emphasis"].append(self.current_cell["emphasized"])
                self.current_cell = None
            elif tag == "tr" and self.current_row is not None:
                cells = self.current_row["cells"]
                if any(cells):
                    self.items.append(
                        {
                            "kind": "table_row",
                            "table_index": self.table_index,
                            "row_index": self.row_index,
                            "cells": cells,
                            "cell_emphasis": self.current_row["cell_emphasis"],
                            "source_locator": {"html_line": self.current_row["line"], "tag": "tr"},
                            "section_path": self._section_path(),
                        }
                    )
                self.current_row = None
            elif tag in self.block_tags:
                self._finish_block()
        if tag in {"main", "article"} and self.scope_depth:
            self.scope_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.enabled():
            return
        if self.current_cell is not None:
            self.current_cell["parts"].append(data)
        elif self.current_block is not None:
            self.current_block["parts"].append(data)

    def close(self) -> None:
        self._finish_block()
        super().close()

    def _section_path(self) -> list[str]:
        return [self.section_levels[level] for level in sorted(self.section_levels)]

    def _finish_block(self) -> None:
        if self.current_block is None:
            return
        tag = self.current_block["tag"]
        text = normalise_space("".join(self.current_block["parts"]))
        if text:
            if tag.startswith("h") and tag[1:].isdigit():
                level = int(tag[1:])
                self.section_levels = {k: v for k, v in self.section_levels.items() if k < level}
                self.section_levels[level] = text
                kind = "heading"
            else:
                kind = "list_item" if tag == "li" else "paragraph"
            self.items.append(
                {
                    "kind": kind,
                    "text": text,
                    "source_locator": {"html_line": self.current_block["line"], "tag": tag},
                    "section_path": self._section_path(),
                }
            )
        self.current_block = None


def extract_html_items(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    has_scope = bool(re.search(r"<(main|article)(\s|>)", raw, flags=re.IGNORECASE))
    parser = TraceHTMLParser(has_scope)
    parser.feed(raw)
    parser.close()
    return parser.items, {
        "input_characters": len(raw),
        "replacement_characters": raw.count("\ufffd"),
        "scope": "MAIN_OR_ARTICLE" if has_scope else "VISIBLE_BODY_EXCLUDING_NAV_HEADER_FOOTER",
    }


def readable_html_text(items: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for item in items:
        if item["kind"] == "heading":
            lines.append(f"\n## {item['text']}\n")
        elif item["kind"] == "table_row":
            lines.append(" | ".join(item["cells"]))
        elif item["kind"] == "list_item":
            lines.append(f"- {item['text']}")
        else:
            lines.append(item["text"])
    return "\n".join(lines).strip()


def parse_text_sections(text: str, representation: str, source_file: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    sections: list[dict[str, Any]] = []
    headings: list[str] = []
    paragraph: list[tuple[int, str]] = []

    def flush() -> None:
        nonlocal paragraph
        value = normalise_space(" ".join(part for _, part in paragraph))
        if value:
            sections.append(
                {
                    "kind": "paragraph",
                    "text": value,
                    "section_path": list(headings),
                    "source_locator": {"file": source_file, "line": paragraph[0][0]},
                    "representation": representation,
                }
            )
        paragraph = []

    index = 0
    while index < len(lines):
        raw = lines[index]
        stripped = raw.strip()
        next_line = lines[index + 1].strip() if index + 1 < len(lines) else ""
        markdown_heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        rst_heading = bool(stripped and re.fullmatch(r"[=\-\^#*~]{3,}", next_line))
        if markdown_heading:
            flush()
            level = len(markdown_heading.group(1))
            headings[:] = headings[: level - 1]
            headings.append(markdown_heading.group(2).strip())
            sections.append(
                {
                    "kind": "heading",
                    "text": markdown_heading.group(2).strip(),
                    "section_path": list(headings),
                    "source_locator": {"file": source_file, "line": index + 1},
                    "representation": representation,
                }
            )
        elif rst_heading:
            flush()
            marker = next_line[0]
            level = {"=": 1, "#": 1, "-": 2, "^": 3, "*": 3, "~": 4}.get(marker, 4)
            headings[:] = headings[: level - 1]
            headings.append(stripped)
            sections.append(
                {
                    "kind": "heading",
                    "text": stripped,
                    "section_path": list(headings),
                    "source_locator": {"file": source_file, "line": index + 1},
                    "representation": representation,
                }
            )
            index += 1
        elif not stripped:
            flush()
        elif stripped.startswith(".. include::"):
            flush()
        else:
            paragraph.append((index + 1, stripped))
        index += 1
    flush()
    return sections


def extract_drawio_nodes(text: str, source_file: str) -> list[dict[str, Any]]:
    root = ET.fromstring(text)
    nodes: list[dict[str, Any]] = []
    for cell in root.iter("mxCell"):
        value = cell.attrib.get("value")
        if not value:
            continue
        clean = normalise_space(re.sub(r"<[^>]+>", " ", html.unescape(value)))
        if clean:
            nodes.append(
                {
                    "kind": "diagram_node",
                    "text": clean,
                    "source_locator": {"file": source_file, "xml_cell_id": cell.attrib.get("id")},
                    "representation": "DRAWIO_XML_SOURCE",
                }
            )
    return nodes


def parse_parameter_value(raw_value: str) -> dict[str, Any]:
    numbers = [float(x) for x in re.findall(r"[-+]?\d+(?:\.\d+)?", raw_value)]
    lower = raw_value.lower().strip()
    if " to " in lower and len(numbers) >= 2:
        relation = "RANGE_INCLUSIVE_UNQUALIFIED"
    elif lower.startswith("<"):
        relation = "UPPER_BOUND_EXCLUSIVE"
    elif lower.startswith(">"):
        relation = "LOWER_BOUND_EXCLUSIVE"
    elif numbers:
        relation = "STATED_VALUE"
    elif lower:
        relation = "TEXT"
    else:
        relation = "UNSPECIFIED_IN_CAPTURED_HTML"
    unit = None
    for pattern, normalized in (
        (r"mV/K/cell", "mV/K/cell"),
        (r"mm²", "mm2"),
        (r"°C", "degC"),
        (r"mA\b", "mA"),
        (r"\bA\b", "A"),
        (r"\bV\b", "V"),
        (r"\bW\b", "W"),
        (r"%", "%"),
    ):
        if re.search(pattern, raw_value):
            unit = normalized
            break
    return {"values": numbers, "unit": unit, "relation": relation}


def make_document_records(route: dict[str, Any], items: list[dict[str, Any]], permission: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for ordinal, item in enumerate(items, 1):
        records.append(
            {
                "record_id": f"DOC-{route['file_id']}-{ordinal:05d}",
                "source_id": route["source_id"],
                "file_id": route["file_id"],
                "document_version_id": route["document_version_id"],
                "source_sha256_registered": route["sha256"],
                "source_title": route["source_title"],
                "content": item,
                "processing_action": "new_parse_local_text_and_table_extraction",
                "output_purpose": "local_traceable_document_extraction_draft",
                "rights_id": permission["rights_id"],
                "rag_admission": "PENDING_NOT_INDEXED",
                "attribution_required": True,
                "applicability": "REFERENCE_ONLY_PENDING_DOMAIN_REVIEW",
            }
        )
    return records


def process_experiment_csv(
    route: dict[str, Any],
    source_path: Path,
    output_dir: Path,
    permission: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    stats = {
        field: {"min": None, "max": None, "missing": 0, "nonfinite": 0}
        for field in EXPERIMENT_REQUIRED_FIELDS
    }
    missing_examples: dict[str, list[dict[str, Any]]] = {
        field: [] for field in EXPERIMENT_REQUIRED_FIELDS
    }
    nonfinite_examples: dict[str, list[dict[str, Any]]] = {
        field: [] for field in EXPERIMENT_REQUIRED_FIELDS
    }
    cycle_values: set[int | float] = set()
    step_values: set[int | float] = set()
    sampled_cycles: OrderedDict[int | float, list[dict[str, Any]]] = OrderedDict()
    row_count = 0
    malformed_rows = 0
    data_point_resets = 0
    test_time_resets = 0
    previous_data_point: float | None = None
    previous_test_time: float | None = None
    header: list[str] = []

    with source_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        missing_fields = [field for field in EXPERIMENT_REQUIRED_FIELDS if field not in header]
        if missing_fields:
            raise ValueError(f"{route['file_id']} missing required fields: {missing_fields}")
        for row_number, row in enumerate(reader, 2):
            row_count += 1
            if None in row:
                malformed_rows += 1
            converted: dict[str, Any] = {}
            for field in EXPERIMENT_REQUIRED_FIELDS:
                raw = (row.get(field) or "").strip()
                if raw == "":
                    stats[field]["missing"] += 1
                    if len(missing_examples[field]) < 5:
                        missing_examples[field].append(
                            {
                                "source_row": row_number,
                                "data_point_raw": row.get("Data_Point"),
                                "test_time_raw": row.get("Test_Time"),
                                "step_index_raw": row.get("Step_Index"),
                                "cycle_index_raw": row.get("Cycle_Index"),
                            }
                        )
                    converted[field] = None
                    continue
                try:
                    number = float(raw)
                except ValueError:
                    stats[field]["nonfinite"] += 1
                    if len(nonfinite_examples[field]) < 5:
                        nonfinite_examples[field].append(
                            {"source_row": row_number, "raw_value": raw}
                        )
                    converted[field] = None
                    continue
                if not math.isfinite(number):
                    stats[field]["nonfinite"] += 1
                    if len(nonfinite_examples[field]) < 5:
                        nonfinite_examples[field].append(
                            {"source_row": row_number, "raw_value": raw}
                        )
                    converted[field] = None
                    continue
                if field in {"Data_Point", "Step_Index", "Cycle_Index"} and number.is_integer():
                    converted[field] = int(number)
                else:
                    converted[field] = number
                current_min = stats[field]["min"]
                current_max = stats[field]["max"]
                stats[field]["min"] = number if current_min is None else min(current_min, number)
                stats[field]["max"] = number if current_max is None else max(current_max, number)

            data_point = converted.get("Data_Point")
            test_time = converted.get("Test_Time")
            if isinstance(data_point, (int, float)):
                if previous_data_point is not None and data_point < previous_data_point:
                    data_point_resets += 1
                previous_data_point = float(data_point)
            if isinstance(test_time, (int, float)):
                if previous_test_time is not None and test_time < previous_test_time:
                    test_time_resets += 1
                previous_test_time = float(test_time)

            cycle = converted.get("Cycle_Index")
            step = converted.get("Step_Index")
            if isinstance(cycle, (int, float)):
                cycle_values.add(cycle)
                if cycle not in sampled_cycles and len(sampled_cycles) < 5:
                    sampled_cycles[cycle] = []
                if cycle in sampled_cycles and len(sampled_cycles[cycle]) < 200:
                    sample = {
                        "record_id": f"EXP-{route['file_id']}-{row_number:09d}",
                        "source_id": route["source_id"],
                        "file_id": route["file_id"],
                        "document_version_id": route["document_version_id"],
                        "source_row": row_number,
                        "values": converted,
                        "rights_id": permission["rights_id"],
                        "output_purpose": "bounded_local_experiment_format_adapter_and_quality_profile",
                        "training_admission": "NOT_APPROVED",
                    }
                    timestamp = converted.get("DateTime")
                    if isinstance(timestamp, (int, float)) and 0 <= timestamp <= 4_102_444_800:
                        sample["datetime_utc_inferred"] = datetime.fromtimestamp(
                            timestamp, tz=timezone.utc
                        ).isoformat()
                    sampled_cycles[cycle].append(sample)
            if isinstance(step, (int, float)):
                step_values.add(step)

    subset_rows = [record for records in sampled_cycles.values() for record in records]
    subset_path = output_dir / f"{route['file_id']}_selected_records.jsonl"
    subset_count = write_jsonl(subset_path, subset_rows)
    summary = {
        "source_id": route["source_id"],
        "file_id": route["file_id"],
        "document_version_id": route["document_version_id"],
        "relative_path": route["relative_path"],
        "source_sha256_registered_not_recomputed": route["sha256"],
        "source_bytes_registered": route["byte_size_registered"],
        "header": header,
        "row_count": row_count,
        "malformed_rows": malformed_rows,
        "cycle_count": len(cycle_values),
        "cycle_min": min(cycle_values) if cycle_values else None,
        "cycle_max": max(cycle_values) if cycle_values else None,
        "step_count": len(step_values),
        "data_point_resets": data_point_resets,
        "test_time_resets": test_time_resets,
        "numeric_statistics": stats,
        "missing_value_examples": {
            field: examples for field, examples in missing_examples.items() if examples
        },
        "nonfinite_value_examples": {
            field: examples for field, examples in nonfinite_examples.items() if examples
        },
        "selected_cycle_values": list(sampled_cycles),
        "selected_record_count": subset_count,
        "selected_records_path": subset_path.name,
        "rights_id": permission["rights_id"],
        "processing_status": "LOCALLY_CHECKED_WITH_SOURCE_MISSING_VALUES_NEEDS_REVIEW"
        if any(field_stats["missing"] for field_stats in stats.values())
        else "LOCALLY_CHECKED_BOUNDED_REAL_DATA_SUBSET",
        "scope_note": "Full selected CSV was streamed for statistics; only a bounded first-200-record sample from each of the first five encountered cycles was retained.",
    }
    return summary, subset_count


def output_artifact_index(run_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted(p for p in run_dir.rglob("*") if p.is_file()):
        if path.name == "ARTIFACT_INDEX.json":
            continue
        rows.append(
            {
                "path": path.relative_to(run_dir).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return rows


def main() -> int:
    args = parse_args()
    source_root = Path(args.source_root)
    phase_a_run = Path(args.phase_a_run)
    run_dir = Path(args.output_root) / args.run_id
    if run_dir.exists():
        raise FileExistsError(f"refusing to overwrite existing run directory: {run_dir}")
    run_dir.mkdir(parents=True)
    documents_dir = run_dir / "documents"
    specifications_dir = run_dir / "specifications"
    experiments_dir = run_dir / "experiments"
    checks_dir = run_dir / "temporary_checks"
    for directory in (documents_dir, specifications_dir, experiments_dir, checks_dir):
        directory.mkdir()

    routes = read_jsonl(phase_a_run / "ROUTING_MANIFEST.jsonl")
    rights_records = read_jsonl(source_root / "collection" / "public_collection" / "rights_inventory.jsonl")
    extraction_records = read_jsonl(
        source_root / "collection" / "public_collection" / "extraction_inventory.jsonl"
    )
    routes_by_id = {row["file_id"]: row for row in routes}
    extraction_by_input = {row["input_file_id"]: row for row in extraction_records}

    doc_routes = [
        row for row in routes if row["primary_route"] == "DOC_RAG" and row["source_id"] in DOC_SOURCE_IDS
    ]
    spec_routes = [
        row for row in routes if row["primary_route"] == "SPEC_DB" and row["source_id"] in SPEC_SOURCE_IDS
    ]
    experiment_routes = [routes_by_id[file_id] for file_id in sorted(EXPERIMENT_FILE_IDS)]
    selected_routes = doc_routes + spec_routes + experiment_routes

    permissions: dict[str, dict[str, Any]] = {}
    for route in selected_routes:
        permissions[route["file_id"]] = resolve_permission(route, rights_records)
    rights_resolution = {
        "run_id": args.run_id,
        "decision_scope": "THIS_SELECTED_LOCAL_PROCESSING_RUN_ONLY",
        "selected_objects": len(selected_routes),
        "grouped_existing_decisions": sorted(
            {
                permission["rights_id"]
                for permission in permissions.values()
            }
        ),
        "records": [
            {
                "file_id": route["file_id"],
                "source_id": route["source_id"],
                "document_version_id": route["document_version_id"],
                "sha256_registered": route["sha256"],
                "route": route["primary_route"],
                "permission": permissions[route["file_id"]],
                "external_transfer": "NOT_AUTHORIZED_NOT_ATTEMPTED",
                "model_or_cloud_context": "NOT_AUTHORIZED_NOT_ATTEMPTED",
            }
            for route in selected_routes
        ],
        "interpretation": "Existing AI-processing ALLOW records are linked to this run; RAG, training, redistribution, external transfer, and site applicability remain separate.",
    }
    write_json(run_dir / "RIGHTS_RESOLUTION.json", rights_resolution)

    manifest: list[dict[str, Any]] = []
    document_summaries: list[dict[str, Any]] = []
    document_record_count = 0
    for route in sorted(doc_routes, key=lambda row: row["file_id"]):
        permission = permissions[route["file_id"]]
        source_path = safe_source_path(source_root, route["relative_path"])
        observed_size = source_path.stat().st_size
        if observed_size != route["byte_size_registered"]:
            raise ValueError(f"size changed for {route['file_id']}: {observed_size}")
        items, extraction_info = extract_html_items(source_path)
        records = make_document_records(route, items, permission)
        jsonl_path = documents_dir / f"{route['file_id']}.jsonl"
        text_path = documents_dir / f"{route['file_id']}.txt"
        count = write_jsonl(jsonl_path, records)
        write_text(text_path, readable_html_text(items))
        existing = extraction_by_input.get(route["file_id"])
        existing_characters = None
        if existing:
            existing_path = safe_source_path(source_root, existing["output_path"])
            existing_characters = len(existing_path.read_text(encoding="utf-8-sig", errors="replace"))
        kinds = Counter(item["kind"] for item in items)
        document_summaries.append(
            {
                "file_id": route["file_id"],
                "source_id": route["source_id"],
                "records": count,
                "kinds": dict(sorted(kinds.items())),
                "new_extraction_characters": len(readable_html_text(items)),
                "existing_derivative_characters": existing_characters,
                "replacement_characters": extraction_info["replacement_characters"],
                "scope": extraction_info["scope"],
            }
        )
        document_record_count += count
        manifest.append(
            {
                "file_id": route["file_id"],
                "source_id": route["source_id"],
                "input": route["relative_path"],
                "route_before": "DOC_RAG",
                "processing_action": "new_parse_local_text_and_table_extraction",
                "output_purpose": "local_traceable_document_extraction_draft",
                "rights_id": permission["rights_id"],
                "status": "LOCALLY_CHECKED_RAG_NOT_ADMITTED",
                "outputs": [jsonl_path.relative_to(run_dir).as_posix(), text_path.relative_to(run_dir).as_posix()],
            }
        )
    write_json(documents_dir / "DOCUMENT_BATCH_SUMMARY.json", document_summaries)

    foxbms_sections: list[dict[str, Any]] = []
    route_adjustments: list[dict[str, Any]] = []
    spec_parameters: list[dict[str, Any]] = []
    mppt_html_route: dict[str, Any] | None = None
    for route in sorted(spec_routes, key=lambda row: row["relative_path"]):
        permission = permissions[route["file_id"]]
        source_path = safe_source_path(source_root, route["relative_path"])
        if source_path.stat().st_size != route["byte_size_registered"]:
            raise ValueError(f"size changed for {route['file_id']}")
        suffix = source_path.suffix.lower()
        if route["source_id"] == "SRC-039":
            if suffix == ".drawio":
                content = source_path.read_text(encoding="utf-8-sig", errors="replace")
                sections = extract_drawio_nodes(content, route["relative_path"])
            else:
                content = source_path.read_text(encoding="utf-8-sig", errors="replace")
                sections = parse_text_sections(content, route["representation"], route["relative_path"])
            for ordinal, section in enumerate(sections, 1):
                foxbms_sections.append(
                    {
                        "record_id": f"REF-{route['file_id']}-{ordinal:05d}",
                        "source_id": route["source_id"],
                        "file_id": route["file_id"],
                        "document_version_id": route["document_version_id"],
                        "source_sha256_registered": route["sha256"],
                        "content": section,
                        "rights_id": permission["rights_id"],
                        "applicability": "REFERENCE_ARCHITECTURE_NOT_LOCAL_ASSET",
                    }
                )
            route_adjustments.append(
                {
                    "file_id": route["file_id"],
                    "source_id": route["source_id"],
                    "route_before": "SPEC_DB",
                    "route_after_content_review": "REFERENCE_ARCHITECTURE_OR_PROJECT_DOCUMENTATION",
                    "reason": "Content describes architecture, software, safety, change history, or licence scope rather than an asset-bound numeric specification.",
                    "status": "INCREMENTAL_CORRECTION",
                }
            )
            manifest.append(
                {
                    "file_id": route["file_id"],
                    "source_id": route["source_id"],
                    "input": route["relative_path"],
                    "route_before": "SPEC_DB",
                    "processing_action": "local_reference_content_structuring",
                    "output_purpose": "traceable_reference_architecture_records",
                    "rights_id": permission["rights_id"],
                    "status": "LOCALLY_CHECKED_ROUTE_CORRECTED",
                    "outputs": ["specifications/foxbms_reference_sections.jsonl", "specifications/ROUTE_ADJUSTMENTS.jsonl"],
                }
            )
        elif route["source_id"] == "SRC-040" and source_path.name == "mppt1210_hus_manual.html":
            mppt_html_route = route
            items, _ = extract_html_items(source_path)
            category = "UNSCOPED"
            for item in items:
                if item["kind"] != "table_row":
                    continue
                cells = (item["cells"] + ["", ""])[:3]
                emphasis = (item.get("cell_emphasis", []) + [False, False, False])[:3]
                feature, raw_value, comment = cells
                if feature.lower() == "feature" and raw_value.lower() == "value":
                    continue
                if feature and emphasis[0] and not raw_value and not comment:
                    category = feature
                    continue
                if not feature:
                    continue
                parsed = parse_parameter_value(raw_value)
                spec_parameters.append(
                    {
                        "parameter_id": f"SPEC-MPPT1210-{len(spec_parameters)+1:04d}",
                        "source_id": route["source_id"],
                        "file_id": route["file_id"],
                        "document_version_id": route["document_version_id"],
                        "source_sha256_registered": route["sha256"],
                        "manufacturer_or_project": "Libre Solar",
                        "model": "MPPT 1210 HUS",
                        "category": category,
                        "parameter": feature,
                        "raw_value": raw_value,
                        "value_status": "STATED" if raw_value else "NOT_STATED_IN_SOURCE_TABLE",
                        "numeric_values": parsed["values"],
                        "unit": parsed["unit"],
                        "relation": parsed["relation"],
                        "condition_or_comment": comment or None,
                        "parameter_nature": "REFERENCE_MANUAL_STATEMENT",
                        "applicability": "REFERENCE_ONLY_NOT_LOCAL_ASSET",
                        "source_locator": item["source_locator"],
                        "rights_id": permission["rights_id"],
                    }
                )
            manifest.append(
                {
                    "file_id": route["file_id"],
                    "source_id": route["source_id"],
                    "input": route["relative_path"],
                    "route_before": "SPEC_DB",
                    "processing_action": "new_parse_html_specification_table",
                    "output_purpose": "local_traceable_reference_parameter_records",
                    "rights_id": permission["rights_id"],
                    "status": "LOCALLY_CHECKED_REFERENCE_PARAMETERS",
                    "outputs": ["specifications/mppt1210_hus_parameters.jsonl"],
                }
            )
        elif route["source_id"] == "SRC-040" and suffix == ".pdf":
            existing = extraction_by_input.get(route["file_id"])
            quality = "NO_EXISTING_DERIVATIVE"
            token_artifacts = None
            if existing:
                derivative_path = safe_source_path(source_root, existing["output_path"])
                derivative_text = derivative_path.read_text(encoding="utf-8-sig", errors="replace")
                token_artifacts = derivative_text.count(".pnum")
                quality = "NOT_REUSED_TOKEN_CORRUPTION" if token_artifacts else "REUSABLE"
            manifest.append(
                {
                    "file_id": route["file_id"],
                    "source_id": route["source_id"],
                    "input": route["relative_path"],
                    "route_before": "SPEC_DB",
                    "processing_action": "existing_derivative_quality_review",
                    "output_purpose": "avoid_duplicate_or_lower_quality_parameter_extraction",
                    "rights_id": permission["rights_id"],
                    "status": quality,
                    "observed_pnum_token_artifacts": token_artifacts,
                    "outputs": ["specifications/mppt1210_hus_parameters.jsonl"] if mppt_html_route else [],
                }
            )
        else:
            content = source_path.read_text(encoding="utf-8-sig", errors="replace")
            sections = parse_text_sections(content, route["representation"], route["relative_path"])
            write_jsonl(
                specifications_dir / "libresolar_firmware_reference_sections.jsonl",
                [
                    {
                        "record_id": f"REF-{route['file_id']}-{index:05d}",
                        "source_id": route["source_id"],
                        "file_id": route["file_id"],
                        "document_version_id": route["document_version_id"],
                        "content": section,
                        "rights_id": permission["rights_id"],
                        "applicability": "REFERENCE_ONLY_NOT_LOCAL_ASSET",
                    }
                    for index, section in enumerate(sections, 1)
                ],
            )
            route_adjustments.append(
                {
                    "file_id": route["file_id"],
                    "source_id": route["source_id"],
                    "route_before": "SPEC_DB",
                    "route_after_content_review": "REFERENCE_FIRMWARE_METADATA",
                    "reason": "README describes firmware project/release process and is not a device parameter table.",
                    "status": "INCREMENTAL_CORRECTION",
                }
            )
            manifest.append(
                {
                    "file_id": route["file_id"],
                    "source_id": route["source_id"],
                    "input": route["relative_path"],
                    "route_before": "SPEC_DB",
                    "processing_action": "local_reference_content_structuring",
                    "output_purpose": "traceable_firmware_reference_metadata",
                    "rights_id": permission["rights_id"],
                    "status": "LOCALLY_CHECKED_ROUTE_CORRECTED",
                    "outputs": ["specifications/libresolar_firmware_reference_sections.jsonl", "specifications/ROUTE_ADJUSTMENTS.jsonl"],
                }
            )

    write_jsonl(specifications_dir / "foxbms_reference_sections.jsonl", foxbms_sections)
    write_jsonl(specifications_dir / "ROUTE_ADJUSTMENTS.jsonl", route_adjustments)
    write_jsonl(specifications_dir / "mppt1210_hus_parameters.jsonl", spec_parameters)

    experiment_summaries: list[dict[str, Any]] = []
    experiment_subset_count = 0
    for route in experiment_routes:
        permission = permissions[route["file_id"]]
        source_path = safe_source_path(source_root, route["relative_path"])
        if source_path.stat().st_size != route["byte_size_registered"]:
            raise ValueError(f"size changed for {route['file_id']}")
        summary, subset_count = process_experiment_csv(route, source_path, experiments_dir, permission)
        experiment_summaries.append(summary)
        experiment_subset_count += subset_count
        manifest.append(
            {
                "file_id": route["file_id"],
                "source_id": route["source_id"],
                "input": route["relative_path"],
                "route_before": "EXPERIMENT_DATA",
                "processing_action": "stream_full_selected_csv_and_retain_bounded_cycle_samples",
                "output_purpose": "local_experiment_format_adapter_and_quality_profile",
                "rights_id": permission["rights_id"],
                "status": summary["processing_status"],
                "outputs": [f"experiments/{route['file_id']}_selected_records.jsonl", "experiments/src017_file_summaries.json"],
            }
        )
    write_json(experiments_dir / "src017_file_summaries.json", experiment_summaries)
    write_json(
        experiments_dir / "FIELD_DICTIONARY.json",
        {
            "source_id": "SRC-017",
            "fields": EXPERIMENT_FIELD_DICTIONARY,
            "reference": "collection/raw/technical/SRC-029/data-formats_v2026.2.7.md#Battery-Archive",
            "warning": "Units marked as inference require source-owner confirmation; temperature reliability caveat is retained from SRC-017 project metadata.",
        },
    )

    processed_file_ids = [row["file_id"] for row in manifest]
    if len(processed_file_ids) != len(set(processed_file_ids)):
        raise ValueError("processing manifest contains duplicate selected file IDs")
    processed_file_id_set = set(processed_file_ids)
    batch_routes = {"DOC_RAG", "SPEC_DB", "EXPERIMENT_DATA"}
    for route in sorted(routes, key=lambda row: row["file_id"]):
        if route["file_id"] in processed_file_id_set:
            continue
        base = {
            "file_id": route["file_id"],
            "source_id": route["source_id"],
            "input": route["relative_path"],
            "route_before": route["primary_route"],
            "content_opened_this_run": False,
            "outputs": [],
        }
        if route["primary_route"] not in batch_routes:
            manifest.append(
                {
                    **base,
                    "status": "NOT_IN_THIS_BATCH_ROUTE_RETAINED_SEPARATE",
                    "reason": "Development, governance, and training/evaluation material remains on its independent route.",
                }
            )
            continue
        try:
            permission = resolve_permission(route, rights_records)
        except PermissionError:
            manifest.append(
                {
                    **base,
                    **describe_permission_gap(route, rights_records),
                    "reason": "No existing evidence authorizes this exact local AI-processing action; no content was opened.",
                }
            )
            continue
        manifest.append(
            {
                **base,
                "status": "DEFERRED_ELIGIBLE_NOT_REQUIRED_FOR_SELECTED_EXPERIMENT_ANALYSIS"
                if route["primary_route"] == "EXPERIMENT_DATA"
                else "DEFERRED_ELIGIBLE_NOT_SELECTED_FOR_THIS_BATCH",
                "reason": "Existing local AI-processing basis was found, but this object was outside the bounded selected analysis batch.",
                "rights_id": permission["rights_id"],
            }
        )

    manifest_status_counts = dict(sorted(Counter(row["status"] for row in manifest).items()))
    pending_by_source = dict(
        sorted(
            Counter(
                row["source_id"]
                for row in manifest
                if row["status"] == "BLOCKED_AI_PROCESSING_PURPOSE_DECISION_PENDING"
            ).items()
        )
    )
    restricted_by_source = dict(
        sorted(
            Counter(
                row["source_id"]
                for row in manifest
                if row["status"] == "BLOCKED_EXPLICIT_AI_PROCESSING_RESTRICTION"
            ).items()
        )
    )
    unexpected_eligible_doc_spec = [
        row
        for row in manifest
        if row["status"] == "DEFERRED_ELIGIBLE_NOT_SELECTED_FOR_THIS_BATCH"
        and row["route_before"] in {"DOC_RAG", "SPEC_DB"}
    ]
    experiment_total_rows = sum(row["row_count"] for row in experiment_summaries)
    experiment_total_registered_bytes = sum(row["source_bytes_registered"] for row in experiment_summaries)
    experiment_malformed_rows = sum(row["malformed_rows"] for row in experiment_summaries)
    experiment_missing_values = sum(
        stats["missing"]
        for row in experiment_summaries
        for stats in row["numeric_statistics"].values()
    )
    experiment_nonfinite_values = sum(
        stats["nonfinite"]
        for row in experiment_summaries
        for stats in row["numeric_statistics"].values()
    )
    experiment_test_time_resets = sum(row["test_time_resets"] for row in experiment_summaries)
    experiment_missing_by_file = {
        row["file_id"]: {
            field: stats["missing"]
            for field, stats in row["numeric_statistics"].items()
            if stats["missing"]
        }
        for row in experiment_summaries
        if any(stats["missing"] for stats in row["numeric_statistics"].values())
    }
    experiment_missing_examples_recorded = all(
        stats["missing"] == 0 or row["missing_value_examples"].get(field)
        for row in experiment_summaries
        for field, stats in row["numeric_statistics"].items()
    )
    experiment_statistics_consistent = all(
        stats["min"] is not None
        and stats["max"] is not None
        and stats["min"] <= stats["max"]
        for row in experiment_summaries
        for stats in row["numeric_statistics"].values()
    )

    db_path = checks_dir / "local_check.sqlite"
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "CREATE TABLE spec_parameters (parameter_id TEXT PRIMARY KEY, model TEXT, version TEXT, category TEXT, parameter TEXT, raw_value TEXT, value_status TEXT, condition_or_comment TEXT, unit TEXT, applicability TEXT)"
        )
        connection.executemany(
            "INSERT INTO spec_parameters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    row["parameter_id"],
                    row["model"],
                    row["document_version_id"],
                    row["category"],
                    row["parameter"],
                    row["raw_value"],
                    row["value_status"],
                    row["condition_or_comment"],
                    row["unit"],
                    row["applicability"],
                )
                for row in spec_parameters
            ],
        )
        connection.execute(
            "CREATE TABLE experiment_file_summary (file_id TEXT PRIMARY KEY, row_count INTEGER, cycle_count INTEGER, voltage_min REAL, voltage_max REAL, temperature_min REAL, temperature_max REAL, test_time_resets INTEGER)"
        )
        connection.executemany(
            "INSERT INTO experiment_file_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    row["file_id"],
                    row["row_count"],
                    row["cycle_count"],
                    row["numeric_statistics"]["Voltage"]["min"],
                    row["numeric_statistics"]["Voltage"]["max"],
                    row["numeric_statistics"]["Temperature"]["min"],
                    row["numeric_statistics"]["Temperature"]["max"],
                    row["test_time_resets"],
                )
                for row in experiment_summaries
            ],
        )
        connection.commit()
        query_results = {
            "classification": "TEMPORARY_LOCAL_QUERY_CHECK_NOT_AUTHORITY_DATABASE",
            "queries": [
                {
                    "sql": "SELECT category, parameter, raw_value, value_status, condition_or_comment, unit FROM spec_parameters WHERE model = ? AND version = ? ORDER BY category, parameter",
                    "parameters": ["MPPT 1210 HUS", "2021-05-02"],
                    "rows": [
                        dict(zip(("category", "parameter", "raw_value", "value_status", "condition_or_comment", "unit"), row))
                        for row in connection.execute(
                            "SELECT category, parameter, raw_value, value_status, condition_or_comment, unit FROM spec_parameters WHERE model = ? AND version = ? ORDER BY category, parameter",
                            ("MPPT 1210 HUS", "2021-05-02"),
                        )
                    ],
                },
                {
                    "sql": "SELECT file_id, row_count, cycle_count, voltage_min, voltage_max, temperature_min, temperature_max, test_time_resets FROM experiment_file_summary ORDER BY file_id",
                    "parameters": [],
                    "rows": [
                        dict(
                            zip(
                                (
                                    "file_id",
                                    "row_count",
                                    "cycle_count",
                                    "voltage_min",
                                    "voltage_max",
                                    "temperature_min",
                                    "temperature_max",
                                    "test_time_resets",
                                ),
                                row,
                            )
                        )
                        for row in connection.execute(
                            "SELECT file_id, row_count, cycle_count, voltage_min, voltage_max, temperature_min, temperature_max, test_time_resets FROM experiment_file_summary ORDER BY file_id"
                        )
                    ],
                },
            ],
        }
    finally:
        connection.close()
    write_json(checks_dir / "QUERY_RESULTS.json", query_results)

    unstated_parameters = [row for row in spec_parameters if not row["raw_value"]]
    protection_parameters = [row for row in spec_parameters if row["category"] == "Protection"]
    checks = [
        {
            "check": "selected_rights_resolved_before_content_open",
            "result": "PASSED" if len(permissions) == len(selected_routes) else "FAILED",
            "observed": len(permissions),
            "expected": len(selected_routes),
        },
        {
            "check": "processing_manifest_covers_all_phase_a_routes_once",
            "result": "PASSED"
            if len(manifest) == len(routes) and len({row["file_id"] for row in manifest}) == len(routes)
            else "FAILED",
            "observed": {"manifest_records": len(manifest), "unique_file_ids": len({row["file_id"] for row in manifest})},
            "expected": len(routes),
        },
        {
            "check": "all_existing_allow_doc_and_spec_objects_included",
            "result": "PASSED" if not unexpected_eligible_doc_spec else "FAILED",
            "observed": [row["file_id"] for row in unexpected_eligible_doc_spec],
            "expected": [],
        },
        {
            "check": "document_batch_count",
            "result": "PASSED" if len(document_summaries) == 4 else "FAILED",
            "observed": len(document_summaries),
            "expected": 4,
        },
        {
            "check": "document_real_content_records",
            "result": "PASSED" if document_record_count > 0 else "FAILED",
            "observed": document_record_count,
            "expected": ">0",
        },
        {
            "check": "mppt_parameter_records",
            "result": "PASSED" if len(spec_parameters) >= 20 else "FAILED",
            "observed": len(spec_parameters),
            "expected": ">=20",
        },
        {
            "check": "mppt_unstated_values_explicitly_flagged_not_invented",
            "result": "PASSED"
            if unstated_parameters
            and all(
                row["value_status"] == "NOT_STATED_IN_SOURCE_TABLE"
                and row["relation"] == "UNSPECIFIED_IN_CAPTURED_HTML"
                and not row["numeric_values"]
                for row in unstated_parameters
            )
            else "FAILED",
            "observed": [row["parameter"] for row in unstated_parameters],
            "expected": "every blank source value remains blank and is explicitly flagged",
        },
        {
            "check": "mppt_protection_rows_preserved_under_protection_category",
            "result": "PASSED" if len(protection_parameters) == 6 else "FAILED",
            "observed": [row["parameter"] for row in protection_parameters],
            "expected": [
                "Overvoltage",
                "Undervoltage",
                "Overcurrent",
                "PV short circuit",
                "PV reverse polarity",
                "Battery reverse polarity",
            ],
        },
        {
            "check": "foxbms_route_corrections",
            "result": "PASSED" if len([r for r in route_adjustments if r["source_id"] == "SRC-039"]) == 12 else "FAILED",
            "observed": len([r for r in route_adjustments if r["source_id"] == "SRC-039"]),
            "expected": 12,
        },
        {
            "check": "experiment_files_streamed",
            "result": "PASSED" if len(experiment_summaries) == 5 else "FAILED",
            "observed": len(experiment_summaries),
            "expected": 5,
        },
        {
            "check": "experiment_rows_streamed_and_numeric_statistics_consistent",
            "result": "PASSED"
            if experiment_total_rows > 0
            and experiment_statistics_consistent
            and experiment_malformed_rows == 0
            and experiment_nonfinite_values == 0
            else "FAILED",
            "observed": {
                "rows": experiment_total_rows,
                "registered_input_bytes": experiment_total_registered_bytes,
                "malformed_rows": experiment_malformed_rows,
                "missing_required_numeric_values": experiment_missing_values,
                "nonfinite_required_numeric_values": experiment_nonfinite_values,
            },
            "expected": "rows > 0, min <= max, and zero malformed/nonfinite required numeric values; source blanks are separately profiled",
        },
        {
            "check": "experiment_source_missing_values_preserved_and_profiled",
            "result": "PASSED" if experiment_missing_examples_recorded else "FAILED",
            "observed": {
                "missing_values": experiment_missing_values,
                "by_file_and_field": experiment_missing_by_file,
            },
            "expected": "source blanks remain null, are counted, and have bounded source-row examples",
        },
        {
            "check": "experiment_test_time_resets_detected_not_normalized",
            "result": "PASSED",
            "observed": experiment_test_time_resets,
            "expected": "record observed resets for review; do not silently rewrite source time",
        },
        {
            "check": "experiment_required_fields",
            "result": "PASSED"
            if all(not [f for f in EXPERIMENT_REQUIRED_FIELDS if f not in row["header"]] for row in experiment_summaries)
            else "FAILED",
            "observed": [row["header"] for row in experiment_summaries],
            "expected": EXPERIMENT_REQUIRED_FIELDS,
        },
        {
            "check": "experiment_selected_real_records",
            "result": "PASSED" if experiment_subset_count > 0 else "FAILED",
            "observed": experiment_subset_count,
            "expected": ">0",
        },
        {
            "check": "temporary_spec_query_returned_rows",
            "result": "PASSED" if query_results["queries"][0]["rows"] else "FAILED",
            "observed": len(query_results["queries"][0]["rows"]),
            "expected": ">0",
        },
        {
            "check": "focused_parser_unit_tests",
            "result": args.unit_test_result,
            "command": args.unit_test_command,
        },
    ]
    failed = [check for check in checks if check["result"] == "FAILED"]
    local_check_results = {
        "run_id": args.run_id,
        "classification": "LOCAL_DATA_PROCESSING_CHECKS_NOT_SERVER_ACCEPTANCE",
        "checks": checks,
        "passed": sum(check["result"] == "PASSED" for check in checks),
        "failed": len(failed),
        "not_run": sum(check["result"] == "NOT_RUN" for check in checks),
        "scope": "Selected local parsing, field contracts, numerical summaries, and temporary queries only",
        "server_acceptance": "NOT_RUN",
        "model_evaluation": "NOT_RUN",
        "t00": "NOT_STARTED",
    }
    write_json(run_dir / "LOCAL_CHECK_RESULTS.json", local_check_results)
    write_jsonl(run_dir / "PROCESSING_MANIFEST.jsonl", manifest)

    summary_lines = [
        "# CR-DATA-ROUTE-001 本地实际加工汇总",
        "",
        f"Run: `{args.run_id}`",
        "",
        f"- 权限：复用现有记录，处理前完成 {len(permissions)}/{len(selected_routes)} 个选定对象的本地AI处理依据关联；RAG、训练、外传未获准也未执行。",
        f"- 文档：{len(document_summaries)}份HTML，生成{document_record_count}条带原始行定位的正文/列表/表格记录。",
        f"- 参数：MPPT 1210 HUS生成{len(spec_parameters)}条真实表格参数；原表未声明值的{len(unstated_parameters)}条保持空值并显式标记，未臆造为支持/正常；foxBMS 12份内容增量纠正为参考架构/项目文档。",
        f"- 实验：完整流式读取5份选定SRC-017 CSV的{experiment_total_rows}行（登记输入{experiment_total_registered_bytes} bytes）进行统计，输出{experiment_subset_count}条真实限定记录；检测到{experiment_test_time_resets}次`Test_Time`回退及{experiment_missing_values}个源空值，均保留并记录待复核位置，未擅自改写或补零。",
        f"- 实验空值分布：`{json.dumps(experiment_missing_by_file, ensure_ascii=False, sort_keys=True)}`。这是一项数据质量待解释事项，不是格式转换失败。",
        f"- 范围处置：沿用同一`PROCESSING_MANIFEST.jsonl`覆盖Phase A的{len(manifest)}/{len(routes)}个对象；状态计数为`{json.dumps(manifest_status_counts, ensure_ascii=False, sort_keys=True)}`。未处理对象未在本轮打开正文。",
        f"- 临时查询：规格和实验摘要已写入`temporary_checks/local_check.sqlite`并实际查询；不是权威数据库。",
        f"- 本地检查：{local_check_results['passed']} PASSED，{local_check_results['failed']} FAILED，{local_check_results['not_run']} NOT_RUN。",
        "- 未执行：T00、正式RAG/数据库、服务器连接或传输、Qwen/模型评测、embedding/reranker、训练/微调。",
        "",
        "主要路径：",
        "",
        "- `documents/`：真实文档记录和可读文本。",
        "- `specifications/mppt1210_hus_parameters.jsonl`：真实参数记录。",
        "- `specifications/foxbms_reference_sections.jsonl`：实际参考架构内容。",
        "- `experiments/*_selected_records.jsonl`：真实实验记录子集。",
        "- `experiments/src017_file_summaries.json`：五个完整CSV的数值与一致性摘要。",
        "- `temporary_checks/QUERY_RESULTS.json`：按型号/版本和实验文件查询的实际结果。",
        "",
        "剩余决定请求（合并为一项，不逐文件重复）：如需扩展到当前受阻对象，请责任人按下列精确来源组/既有版本确认本地`ai_processing`用途，或指定替代来源：",
        "",
        f"- 用途决定待定（共{sum(pending_by_source.values())}个）：`{json.dumps(pending_by_source, ensure_ascii=False, sort_keys=True)}`。该决定不是RAG、外传、训练或发布许可。",
        f"- 已有明确限制（共{sum(restricted_by_source.values())}个）：`{json.dumps(restricted_by_source, ensure_ascii=False, sort_keys=True)}`。本轮不请求自动放行；若内容必需，请提供可用替代来源或另行作出明确决定。",
        "",
        "文档RAG准入、外部传输、专业适用性和服务器验收仍需独立决定；上述待定项不阻止继续处理已有依据覆盖的189个实验对象。",
    ]
    write_text(run_dir / "SUMMARY.md", "\n".join(summary_lines))
    write_json(run_dir / "ARTIFACT_INDEX.json", output_artifact_index(run_dir))

    print(
        json.dumps(
            {
                "run_dir": str(run_dir),
                "selected_objects": len(selected_routes),
                "document_records": document_record_count,
                "spec_parameters": len(spec_parameters),
                "experiment_files": len(experiment_summaries),
                "experiment_selected_records": experiment_subset_count,
                "checks_failed": len(failed),
                "status": "COMPLETED" if not failed else "COMPLETED_WITH_FAILED_LOCAL_CHECKS",
            },
            ensure_ascii=False,
        )
    )
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
