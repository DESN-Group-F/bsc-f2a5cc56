#!/usr/bin/env python3
"""Perform static format/count/consistency checks for Phase A artifacts.

This is not a project test and must not be reported as PASS/FAIL. It does not
open source originals, execute queries, connect to a server, or run models.
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
from pathlib import Path
from typing import Any


EXPECTED_ORIGINALS = 300


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--scripts-dir", required=True)
    parser.add_argument("--checked-at", required=True)
    return parser.parse_args()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"{path}:{line_number} is not a JSON object")
                rows.append(value)
    return rows


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run_dir)
    scripts_dir = Path(args.scripts_dir)
    output_path = run_dir / "STATIC_VALIDATION.json"
    if output_path.exists():
        raise FileExistsError(f"refusing to overwrite {output_path}")

    checks: list[dict[str, Any]] = []

    def check(check_id: str, condition: bool, observed: Any, expected: Any) -> None:
        checks.append(
            {
                "check_id": check_id,
                "result": "SATISFIED" if condition else "ISSUE",
                "observed": observed,
                "expected": expected,
            }
        )

    required_core = [
        "INPUT_SNAPSHOT.json",
        "CURRENT_STATE_INDEX.json",
        "ROUTING_MANIFEST.jsonl",
        "ROUTING_MANIFEST.csv",
        "RIGHTS_PURPOSE_SIDECAR.jsonl",
        "TASK_EVIDENCE_MAP.csv",
        "PILOT_CANDIDATE_MATRIX.json",
        "PREPARATION_STATUS.jsonl",
        "SERVER_IMPORT_PLAN.md",
        "SERVER_TEST_DEFINITIONS.json",
        "BLOCKERS_AND_NEXT_ACTIONS.md",
        "SCHEMA_CATALOG.json",
        "PORTABLE_SCHEMA_README.md",
        "schemas/document_chunk.schema.json",
        "schemas/specification_record.schema.json",
        "schemas/experiment_subset.schema.json",
    ]
    missing = [name for name in required_core if not (run_dir / name).is_file()]
    check("required_core_artifacts_exist", not missing, missing, [])

    input_snapshot = load_json(run_dir / "INPUT_SNAPSHOT.json")
    current_state = load_json(run_dir / "CURRENT_STATE_INDEX.json")
    routes = load_jsonl(run_dir / "ROUTING_MANIFEST.jsonl")
    route_csv = load_csv(run_dir / "ROUTING_MANIFEST.csv")
    rights = load_jsonl(run_dir / "RIGHTS_PURPOSE_SIDECAR.jsonl")
    evidence = load_csv(run_dir / "TASK_EVIDENCE_MAP.csv")
    candidates = load_json(run_dir / "PILOT_CANDIDATE_MATRIX.json")
    preparation = load_jsonl(run_dir / "PREPARATION_STATUS.jsonl")
    server_tests = load_json(run_dir / "SERVER_TEST_DEFINITIONS.json")

    check("routing_jsonl_count", len(routes) == EXPECTED_ORIGINALS, len(routes), EXPECTED_ORIGINALS)
    check("routing_csv_count", len(route_csv) == EXPECTED_ORIGINALS, len(route_csv), EXPECTED_ORIGINALS)
    check("rights_sidecar_count", len(rights) == EXPECTED_ORIGINALS, len(rights), EXPECTED_ORIGINALS)
    check("task_evidence_count", len(evidence) == EXPECTED_ORIGINALS, len(evidence), EXPECTED_ORIGINALS)
    check("preparation_status_count", len(preparation) == EXPECTED_ORIGINALS, len(preparation), EXPECTED_ORIGINALS)

    route_ids = [row["file_id"] for row in routes]
    csv_ids = [row["file_id"] for row in route_csv]
    rights_ids = [row["file_id"] for row in rights]
    prep_ids = [row["file_id"] for row in preparation]
    check("unique_route_file_ids", len(set(route_ids)) == EXPECTED_ORIGINALS, len(set(route_ids)), EXPECTED_ORIGINALS)
    check("cross_artifact_file_id_sets", set(route_ids) == set(csv_ids) == set(rights_ids) == set(prep_ids), "set comparison", "all equal")
    check("all_original_flags", all(row["is_original"] is True for row in routes), sum(row["is_original"] is True for row in routes), EXPECTED_ORIGINALS)
    check("classification_basis_metadata_only", all(row["classification_basis"] == "METADATA_ONLY" for row in routes), "all rows", "METADATA_ONLY")
    check("no_content_read_in_classification", all(not row["classification_evidence"]["content_read_this_run"] for row in routes), "all rows", False)
    check("all_have_route_or_needs_classification", all(row["primary_route"] != "" and row["routing_state"] in {"ROUTED", "NEEDS_CLASSIFICATION"} for row in routes), "all rows", "route or needs classification")
    check("parsing_unknown_all", all(row["purpose_decision"]["parsing"] == "UNKNOWN" for row in preparation), sum(row["purpose_decision"]["parsing"] == "UNKNOWN" for row in preparation), EXPECTED_ORIGINALS)
    check("query_not_run_all", all(row["query_verification"] == "NOT_RUN_SERVER_PENDING" for row in preparation), "all rows", "NOT_RUN_SERVER_PENDING")
    check("content_preparation_blocked_all", all(row["content_preparation_state"] == "BLOCKED" for row in preparation), "all rows", "BLOCKED")

    required_purposes = {
        "local_storage",
        "new_parsing",
        "ai_semantic_processing",
        "external_service_transfer",
        "document_rag_context_or_indexing",
        "training",
        "redistribution",
        "derivative_publication",
        "production_rag_admission",
        "training_admission",
    }
    purpose_ok = all({item["purpose_id"] for item in row["purpose_rights"]} == required_purposes for row in rights)
    check("rights_purpose_dimensions_complete", purpose_ok, "all sidecars", sorted(required_purposes))
    new_parse_blocked = all(
        next(item for item in row["action_output_gates"] if item["action"] == "new_parse")["decision"] == "BLOCKED_UNKNOWN_GATE"
        for row in rights
    )
    check("new_parse_blocked", new_parse_blocked, "all sidecars", "BLOCKED_UNKNOWN_GATE")
    check("binding_repair_candidates", sum(row["binding_repair"]["required"] for row in rights) == 101, sum(row["binding_repair"]["required"] for row in rights), 101)

    selected = [
        candidate
        for path in candidates["paths"]
        for candidate in path["shortlist"]
        if candidate["selected_for_pilot"]
    ]
    eligible = [
        candidate
        for path in candidates["paths"]
        for candidate in path["shortlist"]
        if candidate["eligibility"] != "NOT_ELIGIBLE_CURRENTLY"
    ]
    check("no_pilot_selected", not selected, len(selected), 0)
    check("no_candidate_marked_eligible", not eligible, len(eligible), 0)

    check("server_tests_defined_not_run", all(item["status"] == "DEFINED_NOT_RUN" for item in server_tests["definitions"]), "all definitions", "DEFINED_NOT_RUN")
    check("server_execution_count_zero", server_tests["project_test_execution_count_this_run"] == 0 and server_tests["query_execution_count_this_run"] == 0, {"project_tests": server_tests["project_test_execution_count_this_run"], "queries": server_tests["query_execution_count_this_run"]}, {"project_tests": 0, "queries": 0})
    check("no_local_test_execution_artifact", not (run_dir / "TEST_EXECUTION.json").exists(), (run_dir / "TEST_EXECUTION.json").exists(), False)

    path_summary = input_snapshot["source_workspace"]
    check("lstat_only_300_paths", path_summary["exact_original_paths_lstat_checked"] == EXPECTED_ORIGINALS, path_summary["exact_original_paths_lstat_checked"], EXPECTED_ORIGINALS)
    check("zero_original_content_opened", path_summary["original_content_files_opened_this_run"] == 0 and path_summary["original_content_bytes_read_this_run"] == 0, {"files": path_summary["original_content_files_opened_this_run"], "bytes": path_summary["original_content_bytes_read_this_run"]}, {"files": 0, "bytes": 0})
    check("zero_original_rehash", path_summary["original_sha256_recomputed_this_run"] == 0, path_summary["original_sha256_recomputed_this_run"], 0)
    check("current_state_source_count", current_state["summary"]["source_entries"] == 48, current_state["summary"]["source_entries"], 48)
    check("current_state_original_count", current_state["summary"]["originals"] == EXPECTED_ORIGINALS, current_state["summary"]["originals"], EXPECTED_ORIGINALS)
    check("current_state_conflict_count", current_state["summary"]["sources_with_reported_baseline_conflict"] == 31, current_state["summary"]["sources_with_reported_baseline_conflict"], 31)
    check("rag_counts", current_state["summary"]["rag_admission_pending"] == 242 and current_state["summary"]["rag_admission_denied"] == 58, {"pending": current_state["summary"]["rag_admission_pending"], "denied": current_state["summary"]["rag_admission_denied"]}, {"pending": 242, "denied": 58})

    schema_paths = [
        run_dir / "schemas" / "document_chunk.schema.json",
        run_dir / "schemas" / "specification_record.schema.json",
        run_dir / "schemas" / "experiment_subset.schema.json",
    ]
    schema_values = [load_json(path) for path in schema_paths]
    check("schemas_parse_as_json", all(value.get("$schema") == "https://json-schema.org/draft/2020-12/schema" for value in schema_values), "all three", "draft 2020-12 declarations")

    script_paths = sorted(scripts_dir.glob("*.py"))
    syntax_issues = []
    for script_path in script_paths:
        try:
            ast.parse(script_path.read_text(encoding="utf-8"), filename=str(script_path))
        except SyntaxError as exc:
            syntax_issues.append({"path": str(script_path), "error": str(exc)})
    check("python_ast_static_parse", not syntax_issues, syntax_issues, [])

    issue_count = sum(item["result"] == "ISSUE" for item in checks)
    result = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": input_snapshot["run_id"],
        "checked_at": args.checked_at,
        "classification": "STATIC_VALIDATION_ONLY",
        "overall_status": "STATIC_VALIDATION_COMPLETED_NO_PROJECT_TESTS" if issue_count == 0 else "STATIC_VALIDATION_ISSUES_FOUND",
        "project_tests_run": 0,
        "queries_run": 0,
        "models_invoked": 0,
        "server_connections": 0,
        "source_content_files_opened": 0,
        "checks_satisfied": len(checks) - issue_count,
        "issues_found": issue_count,
        "checks": checks,
        "interpretation": "Satisfied checks establish format/count/internal consistency only. They do not validate RAG, database, query, model, domain correctness, permissions, or server readiness.",
    }
    with output_path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({"output": str(output_path), "overall_status": result["overall_status"], "checks_satisfied": result["checks_satisfied"], "issues_found": issue_count}, ensure_ascii=False, indent=2))
    return 0 if issue_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
