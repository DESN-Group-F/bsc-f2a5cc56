#!/usr/bin/env python3
"""Permission-gated portable transformation draft.

Status: PREPARED_LOCALLY_UNVERIFIED. This script is intentionally not run in
CR-DATA-ROUTE-001 Phase A. It accepts only already-authorized structured input
and refuses any gate state other than a trusted exact ALLOW.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


ARTIFACT_STATUS = "PREPARED_LOCALLY_UNVERIFIED"
MODES = {
    "document": ("document_chunk", "new_parse_or_reuse_existing_derivative"),
    "specification": ("specification_seed", "new_parse_or_reuse_existing_derivative"),
    "experiment": ("experiment_subset", "new_parse_or_reuse_existing_derivative"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=sorted(MODES), required=True)
    parser.add_argument("--input", required=True, help="Approved structured JSON or CSV input")
    parser.add_argument("--input-file-id", required=True)
    parser.add_argument("--input-sha256", required=True)
    parser.add_argument("--gate", required=True, help="Trusted action/output-purpose decision JSON")
    parser.add_argument("--output", required=True)
    parser.add_argument("--run-id", required=True)
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


def verify_gate(gate: dict[str, Any], *, mode: str, file_id: str, sha256: str) -> None:
    expected_purpose, expected_action_family = MODES[mode]
    required = {
        "trusted_record": True,
        "decision": "ALLOW",
        "file_id": file_id,
        "sha256": sha256,
        "output_purpose": expected_purpose,
        "action_family": expected_action_family,
    }
    mismatches = {key: {"expected": value, "observed": gate.get(key)} for key, value in required.items() if gate.get(key) != value}
    for authority_field in ("decision_id", "decided_by", "decided_at", "evidence_ref"):
        if not gate.get(authority_field):
            mismatches[authority_field] = {"expected": "non-empty trusted value", "observed": gate.get(authority_field)}
    if mismatches:
        raise PermissionError(f"exact action/output-purpose gate not satisfied: {json.dumps(mismatches, sort_keys=True)}")


def read_records(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        value = load_json(path)
        if isinstance(value, dict) and isinstance(value.get("records"), list):
            value = value["records"]
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise ValueError("JSON input must be an array of objects or an object with a records array")
        return value
    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))
    raise ValueError("draft accepts only structured .json or .csv input; it is not a PDF/archive parser")


def transformed_records(mode: str, records: list[dict[str, Any]], gate: dict[str, Any], run_id: str) -> Iterable[dict[str, Any]]:
    for index, record in enumerate(records, 1):
        yield {
            "artifact_status": ARTIFACT_STATUS,
            "portable_mode": mode,
            "portable_record_id": f"{mode.upper()}-{index:06d}",
            "payload": record,
            "rights_snapshot": {
                "decision_id": gate["decision_id"],
                "action_family": gate["action_family"],
                "output_purpose": gate["output_purpose"],
                "decision": gate["decision"],
                "evidence_ref": gate["evidence_ref"],
            },
            "lineage": {
                "run_id": run_id,
                "source_file_id": gate["file_id"],
                "source_sha256": gate["sha256"],
                "transform": "portable_transform_draft.py:0.1",
            },
        }


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    gate_path = Path(args.gate)
    output_path = Path(args.output)
    if output_path.exists():
        raise FileExistsError(f"refusing to overwrite {output_path}")
    observed_sha256 = sha256_file(input_path)
    if observed_sha256 != args.input_sha256:
        raise ValueError("input SHA-256 does not match the exact approved hash")
    gate = load_json(gate_path)
    verify_gate(gate, mode=args.mode, file_id=args.input_file_id, sha256=args.input_sha256)
    records = read_records(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf-8", newline="\n") as handle:
        for row in transformed_records(args.mode, records, gate, args.run_id):
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    print(json.dumps({"output": str(output_path), "records": len(records), "status": ARTIFACT_STATUS}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
