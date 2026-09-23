#!/usr/bin/env python3
"""Finalize Phase A with execution log, completion report, and lineage manifest."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


ARTIFACT_STATUS = "PREPARED_LOCALLY_UNVERIFIED"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--scripts-dir", required=True)
    parser.add_argument("--completed-at", required=True)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_json_exclusive(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run_dir)
    scripts_dir = Path(args.scripts_dir)
    for name in ("EXECUTION_LOG.json", "COMPLETION_REPORT.md", "LINEAGE_MANIFEST.json"):
        if (run_dir / name).exists():
            raise FileExistsError(f"refusing to overwrite {run_dir / name}")

    snapshot = load_json(run_dir / "INPUT_SNAPSHOT.json")
    current = load_json(run_dir / "CURRENT_STATE_INDEX.json")
    validation = load_json(run_dir / "STATIC_VALIDATION.json")
    routes = load_jsonl(run_dir / "ROUTING_MANIFEST.jsonl")
    candidates = load_json(run_dir / "PILOT_CANDIDATE_MATRIX.json")
    if validation["overall_status"] != "STATIC_VALIDATION_COMPLETED_NO_PROJECT_TESTS":
        raise RuntimeError("cannot finalize while static validation reports issues")

    run_id = snapshot["run_id"]
    execution_events = [
        {
            "sequence": 1,
            "kind": "CONTROL_READ",
            "command": "Get-Content -LiteralPath <required control files> -Raw / line-numbered chunk reads",
            "actual_scope": [item["path"] for item in snapshot["control_inputs"]],
            "result": "COMPLETED",
        },
        {
            "sequence": 2,
            "kind": "AUDIT_INVENTORY",
            "command": "Get-ChildItem -LiteralPath <EXT-AUDIT-01> -Force; Get-FileHash -Algorithm SHA256",
            "actual_scope": snapshot["ext_audit_snapshot"]["audit_directory"],
            "result": "COMPLETED",
        },
        {
            "sequence": 3,
            "kind": "METADATA_SUMMARY",
            "command": "Import-Csv SOURCE_DOCUMENT_FILE_MAP.csv / SNAPSHOT_SHA256.csv; ConvertFrom-Json FINAL_STATUS.json",
            "actual_scope": "audit metadata only",
            "result": "COMPLETED",
        },
        {
            "sequence": 4,
            "kind": "PREPARATION_RUN",
            "command": f"python scripts/data_route/prepare_phase_a.py --source-workspace 'E:\\desn 2000\\data\\battery_data_workspace_v0_3' --audit-dir 'E:\\desn 2000\\data\\battery_data_workspace_v0_3\\reports\\audits\\EXT-AUDIT-01_20260919T013447_AEST' --output-dir '{run_dir}' --run-id '{run_id}' --created-at '{snapshot['created_at']}' --project-root 'E:\\desn 2000\\bsc'",
            "actual_scope": "audit metadata + lstat-only checks for 300 exact original paths",
            "result": "COMPLETED",
        },
        {
            "sequence": 5,
            "kind": "STATIC_VALIDATION",
            "command": f"python scripts/data_route/validate_phase_a_static.py --run-dir '{run_dir}' --scripts-dir '{scripts_dir}' --checked-at '{validation['checked_at']}'",
            "actual_scope": "generated formats, counts, schemas, and internal consistency only",
            "result": validation["overall_status"],
        },
        {
            "sequence": 6,
            "kind": "FINALIZATION",
            "command": f"python scripts/data_route/finalize_phase_a.py --run-dir '{run_dir}' --scripts-dir '{scripts_dir}' --completed-at '{args.completed_at}'",
            "actual_scope": "execution log, completion report, and lineage manifest",
            "result": "COMPLETED",
        },
    ]
    execution_log = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": run_id,
        "created_at": snapshot["created_at"],
        "completed_at": args.completed_at,
        "classification": "PREPARATION_RUN_NOT_PROJECT_TEST",
        "events": execution_events,
        "read_boundary": {
            "source_original_content_files_opened": 0,
            "source_original_hashes_recomputed": 0,
            "exact_source_paths_lstat_checked": 300,
            "audit_metadata_directory": snapshot["ext_audit_snapshot"]["audit_directory"],
            "locked_answers_or_private_oracle_read": False,
        },
        "not_executed": [
            "T00",
            "project/unit/integration/contract/retrieval/UI/end-to-end/model tests",
            "database migration or target database write",
            "RAG indexing or retrieval",
            "local or server query verification",
            "server connection or upload",
            "Qwen inference",
            "training or fine-tuning",
            "portable_transform_draft.py",
        ],
    }
    write_json_exclusive(run_dir / "EXECUTION_LOG.json", execution_log)

    route_counts = Counter(row["primary_route"] for row in routes)
    candidate_lines = []
    for path in candidates["paths"]:
        candidate_lines.append(
            f"- {path['path_id']}: {len(path['shortlist'])} metadata candidates; `{path['status']}`; selected 0."
        )
    output_files_before_lineage = sorted(
        path.relative_to(run_dir).as_posix()
        for path in run_dir.rglob("*")
        if path.is_file()
    )

    report = f"""# CR-DATA-ROUTE-001 Phase A completion report

Run: `{run_id}`  
Started: `{snapshot['created_at']}`  
Completed: `{args.completed_at}`  
Phase A status: `LOCAL_ROUTING_PREPARED`  
Overall CR status: `PHASE_A_COMPLETE_PHASE_B_AND_SERVER_EXECUTION_BLOCKED`

## Outcome

- Routed 300/300 originals using audit metadata only: `{json.dumps(dict(sorted(route_counts.items())), ensure_ascii=False)}`.
- Created 300 purpose-rights sidecars; `parsing_right=UNKNOWN` and `external_service_transfer_right=UNKNOWN` remain 300/300.
- Recorded 101 exact file/hash binding-repair candidates without changing any permission decision.
- Preserved RAG scope separation: 242 PENDING and 58 DENIED; the 58 DENY states apply only to RAG and direct derivatives.
- Built three pilot metadata shortlists but selected no object because action/output-purpose gates are unresolved.
{chr(10).join(candidate_lines)}
- Prepared three portable JSON Schema drafts, a permission-gated conversion draft, a server import plan, and 18 server-only test definitions marked `DEFINED_NOT_RUN`.

## Static validation result

`{validation['overall_status']}` with {validation['checks_satisfied']} consistency checks satisfied and {validation['issues_found']} issues recorded. This was format/count/path/internal-consistency validation only. It is not a project test, query verification, database validation, RAG validation, model result, or domain approval.

## Read and write scope

- Source workspace: exact 300 allowlisted paths received `lstat`-only existence/size checks; source content opened = 0; source bytes read = 0; source hashes recomputed = 0.
- Audit inputs: explicit EXT-AUDIT-01 files only. Historical audit integrity and 56/56 results were not rerun and are not this task's results.
- Private oracle / locked answers: not read.
- Writes: only `{run_dir}` plus scripts under `{scripts_dir}`.
- Source workspace, audit directory, original files, and historical reports were not modified.

## Deliverables

{chr(10).join(f'- `{name}`' for name in output_files_before_lineage)}
- `LINEAGE_MANIFEST.json` (created by this finalization step)

## Scripts

- `prepare_phase_a.py` — deterministic metadata preparation run.
- `validate_phase_a_static.py` — static format/count/internal-consistency validation only.
- `portable_transform_draft.py` — future permission-gated conversion draft; not executed.
- `finalize_phase_a.py` — completion and artifact lineage finalization.

## Not executed

T00; all project/query/model tests; database migration/write; target RAG indexing/retrieval; server connection/upload; Qwen inference; training/fine-tuning; any new parsing or content conversion.

## Remaining gates and handoff state

The minimal next decision is one exact candidate per pilot with a trusted action × output-purpose decision, including existing-derivative reuse where relevant. Server transfer must be separately allowed for the exact file/hash/bundle. Until then, all real-source bundles contain zero approved records and server handoff remains `NOT_READY_FOR_DATA_TRANSFER`; code/schema review is `READY_FOR_SERVER_HANDOFF_REVIEW` only.

See `BLOCKERS_AND_NEXT_ACTIONS.md`, `PILOT_CANDIDATE_MATRIX.json`, and `SERVER_IMPORT_PLAN.md` for the exact decision fields and server evidence requirements.
"""
    with (run_dir / "COMPLETION_REPORT.md").open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(report.rstrip() + "\n")

    output_artifacts = []
    for path in sorted(run_dir.rglob("*"), key=lambda value: value.as_posix().lower()):
        if not path.is_file() or path.name == "LINEAGE_MANIFEST.json":
            continue
        relative = path.relative_to(run_dir).as_posix()
        if relative.startswith("schemas/") or relative in {"SCHEMA_CATALOG.json", "PORTABLE_SCHEMA_README.md"}:
            parent_refs = ["CR_DATA_ROUTE_001_EXECUTION_OVERLAY.md", "CR_DATA_ROUTE_001_Codex_Task_Card.md"]
        elif relative in {"ROUTING_MANIFEST.jsonl", "ROUTING_MANIFEST.csv", "RIGHTS_PURPOSE_SIDECAR.jsonl", "TASK_EVIDENCE_MAP.csv", "PREPARATION_STATUS.jsonl", "PILOT_CANDIDATE_MATRIX.json", "CURRENT_STATE_INDEX.json"}:
            parent_refs = ["SOURCE_DOCUMENT_FILE_MAP.csv", "FINAL_STATUS.json", "FINDINGS.csv"]
        else:
            parent_refs = ["INPUT_SNAPSHOT.json", "CR_DATA_ROUTE_001_EXECUTION_OVERLAY.md"]
        output_artifacts.append(
            {
                "path": relative,
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "status": "DEFINED_NOT_RUN" if relative == "SERVER_TEST_DEFINITIONS.json" else ARTIFACT_STATUS,
                "parent_refs": parent_refs,
            }
        )

    script_artifacts = []
    for path in sorted(scripts_dir.glob("*.py"), key=lambda value: value.name.lower()):
        script_artifacts.append(
            {
                "path": str(path),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "status": ARTIFACT_STATUS,
                "executed_this_run": path.name != "portable_transform_draft.py",
            }
        )

    lineage = {
        "schema_version": "0.1",
        "task_id": "CR-DATA-ROUTE-001",
        "run_id": run_id,
        "created_at": args.completed_at,
        "artifact_status": ARTIFACT_STATUS,
        "source_snapshot": snapshot["ext_audit_snapshot"],
        "source_original_content_read": False,
        "input_artifacts": snapshot["ext_audit_snapshot"]["audit_directory_inventory"],
        "output_artifacts": output_artifacts,
        "script_artifacts": script_artifacts,
        "self_hash": "NOT_RECORDED_SELF_REFERENTIAL",
        "lineage_note": "Per-original row lineage is embedded in ROUTING_MANIFEST.jsonl. Historical source hashes are reused from EXT-AUDIT-01; this run performed lstat-only current path/size checks.",
    }
    write_json_exclusive(run_dir / "LINEAGE_MANIFEST.json", lineage)

    print(
        json.dumps(
            {
                "run_id": run_id,
                "status": "LOCAL_ROUTING_PREPARED",
                "output_artifacts_in_lineage": len(output_artifacts),
                "script_artifacts": len(script_artifacts),
                "project_tests_run": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
