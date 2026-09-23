#!/usr/bin/env python3
"""Build and check MAP-03 lineage from bounded, pre-existing metadata only.

This script never opens original content.  It reads INPUT_SCOPE.jsonl and the
small manifests named below, and uses lstat only for explicitly referenced
derivative paths.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter, defaultdict
from pathlib import Path


RUN = Path(__file__).resolve().parents[1]
OUT = RUN / "lineage"
BSC = RUN.parents[2]
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
PRIOR = BSC / "data_preparation" / "CR-DATA-ROUTE-001" / "20260919T200403_local_processing_05"
INPUT = RUN / "INPUT_SCOPE.jsonl"
PRIOR_MANIFEST = PRIOR / "PROCESSING_MANIFEST.jsonl"
ARTIFACT_INDEX = PRIOR / "ARTIFACT_INDEX.json"
RIGHTS_RESOLUTION = PRIOR / "RIGHTS_RESOLUTION.json"
DOC_SUMMARY = PRIOR / "documents" / "DOCUMENT_BATCH_SUMMARY.json"
EXP_SUMMARY = PRIOR / "experiments" / "src017_file_summaries.json"


def read_jsonl(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ref(path: Path, locator: str) -> str:
    return f"{path.resolve()}#{locator}"


def lstat_record(path: Path, expected_bytes=None, expected_sha=None) -> dict:
    try:
        st = path.lstat()
    except FileNotFoundError:
        return {"path": str(path), "exists": False, "is_regular_file": False}
    record = {
        "path": str(path),
        "exists": True,
        "is_regular_file": path.is_file() and not path.is_symlink(),
        "bytes_lstat": st.st_size,
        "expected_bytes": expected_bytes,
        "size_matches": expected_bytes is None or st.st_size == expected_bytes,
        "sha256_recomputed": False,
    }
    # These are bounded local derivatives, not originals. Hash only when an
    # existing artifact-index hash provides a concrete comparison target.
    if expected_sha and record["is_regular_file"]:
        record["sha256_recomputed"] = True
        record["sha256"] = sha256_file(path)
        record["expected_sha256"] = expected_sha
        record["sha256_matches"] = record["sha256"] == expected_sha
    return record


def main() -> None:
    rows = read_jsonl(INPUT)
    prior_rows = read_jsonl(PRIOR_MANIFEST)
    artifacts = json.loads(ARTIFACT_INDEX.read_text(encoding="utf-8"))
    rights_resolution = json.loads(RIGHTS_RESOLUTION.read_text(encoding="utf-8"))
    doc_summary = json.loads(DOC_SUMMARY.read_text(encoding="utf-8"))
    exp_summary = json.loads(EXP_SUMMARY.read_text(encoding="utf-8"))

    artifact_by_path = {a["path"]: a for a in artifacts}
    prior_by_file = {r["file_id"]: r for r in prior_rows}
    doc_by_file = {r["file_id"]: r for r in doc_summary}
    exp_by_file = {r["file_id"]: r for r in exp_summary}
    scope_ids = {r["file_id"] for r in rows}
    selected_rights_ids = {
        r["file_id"] for r in rights_resolution.get("records", [])
    }

    relations: list[dict] = []
    fragments: list[dict] = []
    derivative_checks: dict[str, dict] = {}
    relation_serial = 0

    def add_relation(file_id: str, kind: str, target: str, evidence: list[str], **extra) -> str:
        nonlocal relation_serial
        relation_serial += 1
        rid = f"REL-MAP03-{relation_serial:04d}"
        relations.append({
            "relation_id": rid,
            "source_file_id": file_id,
            "relation_type": kind,
            "target": target,
            "evidence_refs": evidence,
            **extra,
        })
        return rid

    for row in rows:
        fid = row["file_id"]
        inv = row["inventory"]
        routing = row["prior_routing"]
        processing = row.get("prior_processing") or {}
        selected = row.get("prior_selected_rights")
        existing_rights = row.get("existing_rights_records", [])
        extracts = row.get("existing_extractions", [])
        evidence = [
            ref(INPUT, f"file_id={fid}"),
            ref(INPUT, f"file_id={fid}/prior_routing/lineage/input_artifact={routing['lineage']['input_artifact']};input_record_sha256={routing['lineage']['input_record_sha256']}"),
            ref(INPUT, f"file_id={fid}/prior_routing/run_id={routing['lineage']['run_id']};routing_id={routing['routing_id']}"),
        ]
        unknowns: list[str] = []
        limitations = [
            "No original content was read and no original SHA-256 was recomputed in MAP-03.",
            "A shared source_id is only a grouping field and does not establish derivation, permission, or purpose.",
            "Parent-document and semantic-alias relationships were not inferred unless an explicit pointer or registered identical hash supplied evidence.",
        ]
        relation_ids: list[str] = []

        if inv.get("duplicate_of_file_id"):
            target = inv["duplicate_of_file_id"]
            relation_ids.append(add_relation(
                fid, "EXPLICIT_DUPLICATE_ALIAS_OF", target,
                [ref(INPUT, f"file_id={fid}/inventory/duplicate_of_file_id")],
                target_in_current_300=target in scope_ids,
                assertion_scope="EXPLICIT_INVENTORY_POINTER_ONLY",
            ))

        extraction_bindings = []
        for ex in extracts:
            out_path = SOURCE / ex["output_path"]
            check = lstat_record(out_path)
            derivative_checks[str(out_path)] = check
            exact_hash_binding = ex.get("input_sha256") == row["sha256_registered"]
            rid = add_relation(
                fid, "EXTRACTED_TO", str(out_path),
                [ref(INPUT, f"file_id={fid}/existing_extractions/extraction_id={ex['extraction_id']}")],
                relation_status=("BOUND_BY_INPUT_FILE_ID_AND_SHA256" if exact_hash_binding else "HASH_BINDING_MISMATCH"),
                input_sha256=ex.get("input_sha256"), output_sha256=ex.get("output_sha256"),
                derivative_lstat=check,
            )
            relation_ids.append(rid)
            extraction_bindings.append({
                "extraction_id": ex["extraction_id"], "relation_id": rid,
                "input_hash_matches_registered": exact_hash_binding,
                "output_path": ex["output_path"], "output_present_lstat": check["exists"],
            })
            if not exact_hash_binding:
                unknowns.append(f"Extraction {ex['extraction_id']} is not bound to the registered input SHA-256.")
            if not check["exists"]:
                unknowns.append(f"Extraction output is missing at recorded path: {ex['output_path']}")

        local_outputs = []
        manifest_record = prior_by_file.get(fid)
        if manifest_record != processing:
            unknowns.append("Embedded prior_processing does not exactly match the prior run manifest record.")
        for rel_path in processing.get("outputs", []):
            art = artifact_by_path.get(rel_path)
            out_path = PRIOR / rel_path
            check = lstat_record(out_path, art.get("bytes") if art else None, art.get("sha256") if art else None)
            derivative_checks[str(out_path)] = check
            refs = [ref(PRIOR_MANIFEST, f"file_id={fid}/outputs={rel_path}")]
            if art:
                refs.append(ref(ARTIFACT_INDEX, f"path={rel_path}"))
            if fid in doc_by_file:
                refs.append(ref(DOC_SUMMARY, f"file_id={fid}"))
            if fid in exp_by_file:
                refs.append(ref(EXP_SUMMARY, f"file_id={fid}"))
            status = "MANIFEST_AND_ARTIFACT_INDEX_BOUND"
            if not art:
                status = "MANIFEST_ONLY_NO_ARTIFACT_INDEX_ENTRY"
            elif not check.get("sha256_matches", False):
                status = "ARTIFACT_HASH_OR_PRESENCE_MISMATCH"
            rid = add_relation(
                fid, "LOCAL_PROCESSING_OUTPUT", str(out_path), refs,
                relation_status=status,
                processing_action=processing.get("processing_action"),
                output_purpose=processing.get("output_purpose"),
                derivative_lstat=check,
            )
            relation_ids.append(rid)
            local_outputs.append({"path": rel_path, "relation_id": rid, "binding_status": status})
            if status != "MANIFEST_AND_ARTIFACT_INDEX_BOUND":
                unknowns.append(f"Local output lacks a complete manifest/index/hash binding: {rel_path}")

        rights_bindings = []
        for rr in existing_rights:
            rights_bindings.append({
                "rights_id": rr.get("rights_id"),
                "linkage": routing.get("rights_record", {}).get("linkage", "UNSTATED"),
                "scope": rr.get("scope"),
                "evidence_file_ids": rr.get("evidence_file_ids", []),
                "ai_processing": rr.get("ai_processing"),
                "rag": rr.get("rag"), "training": rr.get("training"),
                "reviewer_type": rr.get("reviewer_type"),
                "evidence_ref": ref(INPUT, f"file_id={fid}/existing_rights_records/rights_id={rr.get('rights_id')}"),
            })
        if selected:
            permission = selected.get("permission", {})
            rights_bindings.append({
                "rights_id": permission.get("rights_id"),
                "linkage": permission.get("binding"),
                "scope": permission.get("scope"),
                "evidence_file_ids": permission.get("evidence_file_ids", []),
                "decision": permission.get("decision"),
                "external_transfer": selected.get("external_transfer"),
                "model_or_cloud_context": selected.get("model_or_cloud_context"),
                "evidence_ref": ref(RIGHTS_RESOLUTION, f"records/file_id={fid}"),
                "present_in_rights_resolution": fid in selected_rights_ids,
            })
            if fid not in selected_rights_ids:
                unknowns.append("Embedded selected-rights record is absent from RIGHTS_RESOLUTION selected_files.")
        else:
            effective_rights_id = routing.get("rights_record", {}).get("effective_rights_id")
            allowed_existing = [
                rr for rr in existing_rights
                if rr.get("ai_processing") == "ALLOWED"
                and rr.get("rights_id") == effective_rights_id
                and row["source_id"] in (rr.get("applies_to_source_ids") or [rr.get("source_id")])
            ]
            if not allowed_existing:
                unknowns.append("No selected prior local-processing decision and no linked existing rights record marked ALLOWED for local AI processing; the action/purpose basis remains unresolved or restricted as recorded.")

        status = "IDENTITY_METADATA_AND_RELATIONS_RECONCILED"
        if any("mismatch" in x.lower() or "missing at" in x.lower() or "lacks a complete" in x.lower() for x in unknowns):
            status = "RELATION_EVIDENCE_GAP"
        elif not relation_ids:
            status = "IDENTITY_METADATA_ONLY_NO_DERIVATIVE_RELATION"

        fragments.append({
            "file_id": fid,
            "source_id": row["source_id"],
            "original": {
                "relative_path": row["relative_path"], "sha256_registered": row["sha256_registered"],
                "bytes_registered": row["bytes_registered"], "derivative_kind": inv.get("derivative_kind"),
                "document_family_id": inv.get("document_family_id"),
                "document_version_id": inv.get("document_version_id"),
                "content_identity_group": inv.get("content_identity_group"),
                "phase_a_path_check": routing.get("current_path_check"),
            },
            "lineage_status": status,
            "relation_ids": relation_ids,
            "relations": {"explicit_relation_count": len(relation_ids), "extractions": extraction_bindings, "local_outputs": local_outputs},
            "derivative_record_status": (
                "RECORDED_RELATIONS_PRESENT" if extracts or processing.get("outputs")
                else "NO_EXTRACTION_OR_LOCAL_OUTPUT_RECORDED_IN_BOUNDED_INPUT"
            ),
            "rights_bindings": rights_bindings,
            "evidence_refs": evidence,
            "historical_evidence": {
                "phase_a_run_id": routing["lineage"]["run_id"],
                "phase_a_transform_id": routing["lineage"]["transform_id"],
                "prior_processing_run": "20260919T200403_local_processing_05",
                "prior_processing_status": processing.get("status"),
            },
            "this_run_metadata_checks": {
                "original_content_read": False, "original_sha256_recomputed": False,
                "embedded_file_id_consistent": fid == inv.get("file_id") == routing.get("file_id"),
                "embedded_sha256_consistent": row["sha256_registered"] == inv.get("sha256") == routing.get("sha256"),
                "embedded_relative_path_consistent": row["relative_path"] == inv.get("relative_path") == routing.get("relative_path"),
                "prior_manifest_record_exact_match": manifest_record == processing,
                "explicit_derivative_paths_lstat_checked": len(extracts) + len(processing.get("outputs", [])),
            },
            "limitations": limitations,
            "unknowns": unknowns,
        })

    write_jsonl(OUT / "LINEAGE_FRAGMENT.jsonl", fragments)
    write_jsonl(OUT / "RELATIONS.jsonl", relations)

    ids = [r["file_id"] for r in fragments]
    rel_ids = [r["relation_id"] for r in relations]
    bad_relation_refs = sorted({rid for f in fragments for rid in f["relation_ids"]} - set(rel_ids))
    original_hashes = Counter(r["sha256_registered"] for r in rows)
    shared_hash_groups = {k: [r["file_id"] for r in rows if r["sha256_registered"] == k] for k, n in original_hashes.items() if n > 1}
    unique_derivatives = {r["target"] for r in relations if r["relation_type"] in {"EXTRACTED_TO", "LOCAL_PROCESSING_OUTPUT"}}
    core_pass = (
        len(rows) == 300
        and len(ids) == len(set(ids)) == 300
        and len(rel_ids) == len(set(rel_ids))
        and not bad_relation_refs
        and all(v.get("exists") for v in derivative_checks.values())
        and all(v.get("sha256_matches", True) for v in derivative_checks.values())
        and all(f["this_run_metadata_checks"]["embedded_file_id_consistent"] for f in fragments)
        and all(f["this_run_metadata_checks"]["embedded_sha256_consistent"] for f in fragments)
        and all(f["this_run_metadata_checks"]["embedded_relative_path_consistent"] for f in fragments)
        and all(f["this_run_metadata_checks"]["prior_manifest_record_exact_match"] for f in fragments)
    )
    check_results = {
        "scope": "MAP-03 bounded metadata and explicitly referenced derivative checks; no original content read and no original hash recomputed",
        "status": "PASS" if core_pass else "FAIL",
        "checks": {
            "input_original_records": len(rows), "lineage_fragment_records": len(fragments),
            "unique_file_ids": len(set(ids)), "relation_records": len(relations),
            "unique_relation_ids": len(set(rel_ids)), "dangling_fragment_relation_ids": bad_relation_refs,
            "all_input_rows_inventory_original": all(r["inventory"].get("derivative_kind") == "ORIGINAL" for r in rows),
            "all_embedded_current_path_checks_present_regular": all(r["prior_routing"].get("current_path_check", {}).get("state") == "PRESENT_REGULAR_FILE" for r in rows),
            "all_embedded_current_path_sizes_match": all(r["prior_routing"].get("current_path_check", {}).get("size_matches_registered") is True for r in rows),
            "all_derivative_lstat_paths_present": all(v.get("exists") for v in derivative_checks.values()),
            "all_indexed_derivative_hashes_match": all(v.get("sha256_matches", True) for v in derivative_checks.values()),
        },
        "counts": {
            "originals": len(rows), "metadata_scope_rows": len(rows), "container_members_enumerated_this_task": 0,
            "historical_extraction_relation_edges": sum(r["relation_type"] == "EXTRACTED_TO" for r in relations),
            "prior_local_output_relation_edges": sum(r["relation_type"] == "LOCAL_PROCESSING_OUTPUT" for r in relations),
            "unique_referenced_derivative_artifacts": len(unique_derivatives),
            "explicit_duplicate_alias_edges": sum(r["relation_type"] == "EXPLICIT_DUPLICATE_ALIAS_OF" for r in relations),
            "unique_original_sha256": len(original_hashes), "shared_original_sha256_groups": len(shared_hash_groups),
            "document_families": len({r["inventory"].get("document_family_id") for r in rows}),
            "document_version_labels": len({r["inventory"].get("document_version_id") for r in rows}),
            "original_records_with_document_version_id": sum(bool(r["inventory"].get("document_version_id")) for r in rows),
            "selected_rights_records": sum(r.get("prior_selected_rights") is not None for r in rows),
            "source_level_rights_record_links": sum(len(r.get("existing_rights_records", [])) for r in rows),
        },
        "shared_hash_groups": shared_hash_groups,
        "derivative_checks": list(derivative_checks.values()),
    }
    (OUT / "CHECK_RESULTS.json").write_text(json.dumps(check_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts = check_results["counts"]
    statuses = Counter(f["lineage_status"] for f in fragments)
    notes = f"""# MAP-03 来源、派生与证据范围核对

## 范围与方法

- 输入是 `INPUT_SCOPE.jsonl` 的 {len(rows)} 条原件记录；本轮未读取原始正文、未重算原件 SHA-256、未重建全量文件台账或授权表。
- 本轮只读取 INPUT_SCOPE 及上一轮 `20260919T200403_local_processing_05` 的小型 manifest/index/summary，并对其中明确列出的派生路径执行 lstat；仅对已有 `ARTIFACT_INDEX.json` 哈希的本地派生产物重算哈希以核对记录。
- `source_id` 只作为来源分组字段，未用来证明派生、用途或权限关系。派生关系只在 file_id、input SHA-256、processing manifest 或 artifact index 提供具体绑定时建立。

## 分开计数

- 原件：{counts['originals']}；INPUT_SCOPE 元数据行：{counts['metadata_scope_rows']}；本任务新枚举容器成员：{counts['container_members_enumerated_this_task']}。
- 原件唯一 SHA-256：{counts['unique_original_sha256']}；共享哈希组：{counts['shared_original_sha256_groups']}；显式 duplicate/alias 边：{counts['explicit_duplicate_alias_edges']}。
- 历史 extraction 派生边：{counts['historical_extraction_relation_edges']}；上一轮本地输出派生边：{counts['prior_local_output_relation_edges']}；两类引用的唯一派生文件：{counts['unique_referenced_derivative_artifacts']}。
- 文档 family 标签数：{counts['document_families']}；300 条中有 version 字段的原件：{counts['original_records_with_document_version_id']}；version 标签唯一值：{counts['document_version_labels']}。标签计数不是独立内容版本的重新审计结论。
- 既有 source-level rights 记录链接：{counts['source_level_rights_record_links']}；上一轮选定 exact/group rights 记录：{counts['selected_rights_records']}。两者不等价，且均不授权外传、模型上下文或训练。
- lineage 状态：{dict(statuses)}。

## 证据层级

- 历史证据：Phase A 的来源记录 SHA、路由 ID、当时的 LSTAT_ONLY_NO_CONTENT_READ；上一轮 processing manifest、rights resolution、结构摘要与 artifact index。
- 本轮核对：300 条嵌入字段的一致性、processing manifest 精确匹配、明确派生路径存在性，以及 artifact index 已登记派生文件的大小/哈希匹配。
- `file_inventory` 1186 条与 `extraction_inventory` 289 条含非原件，未用来推算本轮 300 原件的内容覆盖率。历史“271 独立版本”也未被本轮重新审计；本轮直接可数的是 270 个 family 标签、115 个 version 标签与 299 个唯一原件哈希，口径不同，不能互相替代。

## 记录状态、具体缺口与限制

- {sum(not f['relations']['extractions'] and not f['relations']['local_outputs'] for f in fragments)} 个原件没有记录到既有 extraction 或上一轮本地输出；这是派生登记状态，不自动构成权限或 lineage 缺口，也不表示没有任何外部或未登记派生物。
- 只有 1 条显式 duplicate pointer；共享 SHA-256 可确认字节身份，但本轮不据此补造所有 alias/版本语义。
- 容器成员未在 MAP-03 新枚举；成员计数应取 MAP-02 的独立清单，不能混入 300 原件或派生文件计数。
- source-level rights 链接与上一轮 selected decision 是不同口径；`RIGHTS_RESOLUTION.json` 中 24 个对象有该轮选定的 exact/group 本地处理决定。没有进入这 24 个不等于权限有缺口：若 INPUT_SCOPE 已链接 `ai_processing=ALLOWED` 的具体组件或组范围记录，本轮保留其已有范围；只有既无 selected decision、又无 ALLOWED 记录的对象才保留动作/用途依据未知或受限项。
- 本轮没有核实派生文本/数据的语义正确性，也没有把局部转换检查升级为服务器验收、RAG 可用性、模型成绩或现场适用性。

## 核对结果

`CHECK_RESULTS.json` 状态为 `{check_results['status']}`。该 PASS 仅表示本脚本声明的集合、引用完整性及有限派生文件存在/哈希检查通过。
"""
    (OUT / "NOTES.md").write_text(notes, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
