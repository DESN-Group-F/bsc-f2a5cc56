"""Record the coordinator's bounded acceptance and manifest after final checks."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))


def json_rows(name):
    return [json.loads(s) for s in (ROOT / name).read_text(encoding="utf-8-sig").splitlines() if s.strip()]


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def bind(name):
    p = ROOT / name
    return {"path": str(p), "sha256": sha(p), "bytes": p.stat().st_size}


def main():
    checked = read("CHECK_RESULTS.json")
    assert checked["status"] == "PASSED" and len(checked["checks"]) == 16
    counts = read("CURRENT_COVERAGE_COUNTS.json")
    selection = read("PRODUCT_FACT_SELECTION.json")
    matrix = json_rows("scope/REQUIREMENT_STATUS_MATRIX.jsonl")
    assert len(matrix) == 29
    charging = next(r for r in matrix if r["requirement_id"] == "LIFE-CHARGE")
    assert not set(charging["product_record_ids"]) & {"MF-001", "MF-010", "MF-011", "MF-026", "MF-027"}
    audit_paths = [
        "audits/EXISTING_CHECK_RESULTS.json", "existing/PRODUCTS_INDEPENDENT_AUDIT.json",
        "audits/PRODUCT_CHECK_RESULTS.json", "products/SCOPE_BACKGROUND_CROSS_AUDIT.json",
        "existing/CURRENT_VIEW_AUDIT.json", "existing/PREPARED_SELECTION_AUDIT.json",
        "audits/CHECK_RESULTS.json", "CHECK_RESULTS.json",
    ]
    now = datetime.now(timezone.utc).isoformat()
    review = {
        "reviewer": "ROOT_COORDINATOR_NONAUTHOR_OF_SCOPE_MATRIX",
        "reviewed_at_utc": now,
        "status": "ACCEPTED_WITH_EXPLICIT_OPEN_COVERAGE_GAPS",
        "scope": "Read all 29 final requirement rows against the independently audited identity/fact outputs; inspect the capability and layer distinctions, not a new source-by-source fact audit.",
        "input_bindings": [bind(n) for n in ("scope/REQUIREMENT_MATRIX.jsonl", "scope/REQUIREMENT_STATUS_MATRIX.jsonl", "scope/REPORT.md", "products/MODEL_FACTS.jsonl", "existing/MODEL_EVIDENCE.jsonl")],
        "requirements_reviewed": [r["requirement_id"] for r in matrix],
        "decisions": [
            "Keep background taxonomy, exact product facts, family information and case/site applicability as different evidence levels.",
            "LCO is supported at exact Saft pack level; it does not establish the chemistry of Panasonic prismatic cells.",
            "LMO remains without an exact product chemistry link; source-family name similarity is insufficient.",
            "LTO remains the stated negative-electrode family dimension, not a cathode family or an automatically identified cell model.",
            "Primary CR2032 is separate from rechargeable LMO and rechargeable charging guidance.",
            "Three cell shapes are supported by explicit products; internal cell shape is not system enclosure shape.",
            "BMS presence does not establish its thresholds, logic, firmware or actual fault cause.",
            "Requested LIFE-CHARGE correction removed records containing only nominal/core ratings or general operating ranges; capacity-test CCCV conditions are now explicitly distinguished from recommended charging limits.",
            "Legacy restricted or unselected inventory evidence stays inventory evidence; selected build facts use their independent action-specific allowlist.",
            "Public-source gaps, product depth/currentness gaps and required case/site inputs stay open; no 29/29 market or engineering completeness claim.",
        ],
    }
    write("ROOT_COVERAGE_REVIEW.json", review)
    decision = {
        "decision_id": "ROOT-LITHIUM-COVERAGE-20260921",
        "decided_at_utc": now,
        "bounded_preparation_status": "ACCEPTED",
        "expanded_coverage_status": "PARTIALLY_MET_WITH_EXPLICIT_OPEN_GAPS",
        "all_lithium_data_ready_claim": False,
        "decision": "接收本轮明确范围的盘点、实际补充、条件化事实准备与独立审计；不把有限数据增量当作全型号、全场景或完整操作档案。",
        "accepted_counts": {
            "existing_records": 297, "existing_exact_labels": 34,
            "product_records": selection["input_records"], "product_fact_fields_reviewed": 174,
            "new_valid_official_product_objects": 15, "new_valid_product_bytes": 55779260,
            "new_admitted_background_objects": 1,
            "current_exact_product_labels": counts["exact_product_labels_total"],
            "current_exact_labels_with_manufacturer": counts["exact_labels_with_manufacturer"],
            "product_exact_labels_added_to_existing": counts["new_exact_labels_from_products"],
            "prepared_query_records": selection["selected_records"],
            "prepared_query_exact_labels": selection["selected_exact_labels"],
            "prepared_query_family_records": selection["selected_family_records"],
            "prepared_query_fact_fields": selection["selected_fact_fields"],
            "requirements_mapped_not_completeness_score": len(matrix),
        },
        "prepared_action": "Conditional future local structured-fact query; data files prepared only, no query database or retrieval system constructed.",
        "primary_deliverables": [bind(n) for n in ("PREPARED_PRODUCT_FACTS.jsonl", "PRODUCT_FACT_SELECTION.json", "CURRENT_MODEL_INDEX.jsonl", "CURRENT_COVERAGE_COUNTS.json", "scope/REQUIREMENT_STATUS_MATRIX.jsonl", "audits/PRODUCT_SOURCE_USE_AUDIT.jsonl", "background/SOURCE_REGISTER.jsonl", "background/BACKGROUND_FACTS.jsonl", "ROOT_COVERAGE_REVIEW.json")],
        "audit_evidence": [bind(n) for n in audit_paths],
        "open_gaps": [
            "LMO lacks an official exact-product chemistry binding; background/family evidence only.",
            "Named light-mobility pack/charger systems and broader primary-lithium coverage remain incomplete.",
            "Special lithium chemistries remain a separate unselected track.",
            "A123 official documents, current Samsung cell identities, BYD exact cell identities and full EVE LF280K specifications were not resolved.",
            "Many product records lack full operating/storage/maintenance constraints and current availability proof.",
            "Real devices require case-specific product versions, pack/BMS/charger configuration and applicable UNSW/site procedures and contacts.",
        ],
        "exclusions_and_limits": [
            "Molicel MF-033/034 excluded from new prepared query facts; inherited restrictions stay unchanged.",
            "ULRI snapshot quarantined, and failed Panasonic SRC-011 response excluded from accepted evidence.",
            "Product/source read and fact-check actions do not grant raw-text RAG, training, redistribution or server transfer.",
            "All exact-label counts mix explicitly stated cell/module/system product levels; sample IDs and families are excluded.",
            "Old 207-record review remains accepted for its exact scope; 466 other legacy assertions were not comprehensively reaudited here.",
            "Existing undeclared MAT units, historical rights limits and prior-run incidents remain as previously reported.",
        ],
        "execution_notes": bind("EXECUTION_NOTES.md"),
        "verification_scope": "16 final local integration checks plus independent per-record audits; nine small previous-run input hashes unchanged. No new full scan/hash of 112 GB payloads, physical experiment, model test or server acceptance.",
        "not_performed": ["RAG construction", "target database ingestion", "Qwen inference", "server connection or upload", "training"],
        "scope_of_next_work": "Use HANDOFF_GUIDE and exact source-action decisions for later design/build discussion. Do not automatically advance stages or declare open coverage gaps closed.",
    }
    write("ROOT_DECISION.json", decision)
    (ROOT / "STATUS.md").write_text("""# 锂电池资料准备状态

本轮限定范围的数据扩充、加工、交叉审计和交接已完成，总控已接收；扩大后的锂电覆盖要求仍有明确缺口。

|任务|最终结果|
|---|---|
|EXISTING Sol|297 条身份/证据记录；297/297 记录、222/222 事实字段独立核对通过|
|PRODUCTS Sol|15 个新有效厂家对象；42/42 产品记录、174/174 事实字段独立核对通过|
|SCOPE/AUDIT Sol|29 项需求逐项映射；来源具体动作、背景、产品及已有记录审查完成|
|总控|339 条证据合并为 337 身份组；66 个精确产品标签；40 条/164 字段查询准备件经独立审计；16 项最终交接检查通过|

详见 README.md、ROOT_DECISION.json 和 scope/REPORT.md。66 个标签不等于 66 份完整电芯档案；LMO 精确产品、轻型交通配套、特殊体系和完整运行条件等仍开放。未构建数据库/RAG，也未连接 Qwen/服务器。

执行问题完整披露于 EXECUTION_NOTES.md；ULRI 快照隔离，失败 PDF 响应排除，策略拒绝清理的临时渲染文件保留。旧 207 条修正与大规模实验读取成果继续按原范围有效。
""", encoding="utf-8")
    files = []
    for directory, dirs, names in os.walk(ROOT, followlinks=False):
        parent = Path(directory)
        dirs[:] = [d for d in dirs if not (parent / d).is_symlink() and not (parent / d).is_junction()]
        for name in sorted(names):
            path = parent / name
            if name == "ARTIFACT_MANIFEST.json" or path.is_symlink():
                continue
            assert path.resolve().is_relative_to(ROOT)
            rel = path.relative_to(ROOT).as_posix()
            role = "METADATA_OR_AUDIT_NOT_AN_INGESTION_ALLOWLIST"
            if rel == "PREPARED_PRODUCT_FACTS.jsonl":
                role = "CONDITIONAL_STRUCTURED_FACT_PREPARATION"
            elif "quarantine/" in rel or "/tmp/" in rel or "failed_response" in rel:
                role = "AUDIT_ONLY_EXCLUDED_FROM_BUILD_INPUTS"
            elif "/sources/" in rel:
                role = "CAPTURED_SOURCE_USE_REQUIRES_ACTION_SPECIFIC_REVIEW"
            files.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha(path), "role": role})
    notes = ["AGENTS.md", "README.md", "data_preparation/README.md", "backlog/CR_LITHIUM_COVERAGE_001_SCOPE.md", "backlog/CR_LITHIUM_COVERAGE_001_TASK_CARDS.md"]
    manifest = {
        "generated_at_utc": now, "root": str(ROOT), "not_a_transfer_or_ingestion_allowlist": True,
        "self_excluded": "ARTIFACT_MANIFEST.json", "files": sorted(files, key=lambda f: f["path"]),
        "project_notes": [{"path": str(PROJECT / p), "sha256": sha(PROJECT / p)} for p in notes],
    }
    write("ARTIFACT_MANIFEST.json", manifest)
    # Verify the completed manifest once; do not modify bound artifacts afterward.
    mismatches = [r["path"] for r in manifest["files"] if sha(ROOT / r["path"]) != r["sha256"]]
    assert not mismatches, mismatches
    print(json.dumps({"decision": decision["bounded_preparation_status"], "coverage": decision["expanded_coverage_status"], "prepared_records": selection["selected_records"], "manifest_files": len(files), "manifest_verified": True}))


if __name__ == "__main__":
    main()
