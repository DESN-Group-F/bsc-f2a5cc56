"""Freeze the coordinator's scoped data-preparation decision after final audits.

This checks receipts and exact sets, not scientific applicability or a deployed system.
Run only after the authors and independent reviewers have frozen their outputs.
"""
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

RUN = Path(__file__).resolve().parent


def obj(name):
    return json.loads((RUN / name).read_text(encoding="utf-8-sig"))


def rows(name):
    return [json.loads(line) for line in (RUN / name).read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def write(name, data):
    (RUN / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    receipts = [
        "INPUT_CHECK_RESULTS.json", "documents/CHECK_RESULTS.json", "datasets/CHECK_RESULTS.json",
        "coverage/CHECK_RESULTS.json", "coverage/SOURCE_USE_FILE_BINDINGS_SYNC_RESULTS.json",
        "audits/doc_reviews_data/CHECK_RESULTS.json", "audits/data_reviews_coverage/CHECK_RESULTS.json",
        "audits/doc_reviews_data/TAR_CSV_SECTION_REVIEW.json",
        "audits/cover_reviews_docs/ROUND1.json", "audits/cover_reviews_docs/DOE1092_INCREMENTAL_REVIEW.json",
        "audits/final_build_usability/CHECK_RESULTS.json", "audits/final_build_usability/BUILD_USE_VALIDATION.json",
        "datasets/CONTAINER_JSON_SCHEMA_CHECKS.json", "datasets/TAR_JSON_GZ_SCHEMA_CHECKS.json",
        "datasets/TAR_CSV_STRUCTURE_CHECKS.json", "datasets/TAR_CSV_SECTION_CHECKS.json",
        "datasets/TAR_CSV_READER_CHECKS.json",
        "datasets/WORKBOOK_SCHEMA_CHECKS.json",
        "datasets/MAT_SCHEMA_CHECKS.json", "datasets/HDF5_READER_CHECK_RESULTS.json",
        "datasets/rda_supplement/FINAL_CHECK_RESULTS.json", "datasets/image_supplement/CHECK_RESULTS.json",
        "datasets/image_supplement/READER_CHECK_RESULTS.json",
        "SOURCE_ENVIRONMENT_RECHECK.json",
        "RECONCILIATION_CHECK_RESULTS.json", "BUILD_USE_INDEX_CHECK_RESULTS.json",
    ]
    evidence, errors = [], []
    for name in receipts:
        data = obj(name)
        status = data.get("status", data.get("overall", ""))
        accepted = str(status).startswith("PASS") and not any(word in str(status) for word in ("DEFERRED", "PENDING", "FAIL"))
        if name == "datasets/TAR_CSV_STRUCTURE_CHECKS.json" and status == "HISTORICAL_PASS":
            accepted = True  # Only legacy record counts; current section/reader/audit receipts are mandatory above.
        if not accepted:
            errors.append({"receipt": name, "status": status})
        receipt = {"path": name, "status": status, "sha256": hashlib.sha256((RUN / name).read_bytes()).hexdigest()}
        if name == "datasets/TAR_CSV_STRUCTURE_CHECKS.json":
            receipt["accepted_scope"] = "Historical full CSV record/width scan only. Its first-row header label does not identify the data header; the section contracts supersede that interpretation."
        evidence.append(receipt)

    source = rows("SOURCE_OBJECTS.jsonl")
    docs, data = rows("documents/FILE_READINESS.jsonl"), rows("datasets/FILE_READINESS.jsonl")
    delivered = {x["file_id"]: x for x in docs + data}
    bindings = rows("coverage/SOURCE_USE_FILE_BINDINGS.jsonl")
    source_ids = {x["file_id"] for x in source}
    if len(source) != 300 or len(delivered) != 300 or set(delivered) != source_ids:
        errors.append({"kind": "EXACT_300_OBJECT_SET_FAILED"})
    freeze = obj("datasets/DELIVERY_FREEZE.json")
    if freeze.get("status") != "FROZEN" or freeze.get("collected_source_files_mutated") is not False or freeze.get("source_workspace_environment_mutated_during_run") is not True:
        errors.append({"kind": "AUTHOR_FREEZE_OR_INCIDENT_SCOPE_UNRESOLVED"})
    for name, expected_hash in freeze.get("frozen_artifact_sha256", {}).items():
        path = RUN / "datasets" / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected_hash:
            errors.append({"kind": "AUTHOR_FROZEN_ARTIFACT_CHANGED", "path": str(path)})
    for binding in bindings:
        current = delivered[binding["file_id"]]
        if binding["current_run_readiness"] != current["readiness"] or binding["current_run_artifact_refs"] != current["artifact_refs"]:
            errors.append({"kind": "STALE_CURRENT_BINDING", "file_id": binding["file_id"]})
    domains = rows("coverage/DOMAIN_COVERAGE.jsonl")
    if len(domains) != 9 or any(x.get("required_gaps") for x in domains):
        errors.append({"kind": "REQUIRED_DOMAIN_GAP"})
    if any(x.get("blocking_general_preparation") for x in rows("coverage/OPEN_ITEMS.jsonl")):
        errors.append({"kind": "GENERAL_PREPARATION_BLOCKER"})
    workbook_profiles = rows("datasets/CONTAINER_WORKBOOK_PROFILES.jsonl")
    workbook_contracts = rows("datasets/CONTAINER_WORKBOOK_CONTRACTS.jsonl")
    expected_sheets = Counter((x["container_file_id"], x["member_path"], sheet["sheet"])
                              for x in workbook_profiles for sheet in x["sheets"])
    actual_sheets = Counter((x["container_file_id"], x["member_path"], x["sheet"]) for x in workbook_contracts)
    if expected_sheets != actual_sheets or any(n != 1 for n in actual_sheets.values()) or any(not x["sheets"] for x in workbook_profiles):
        errors.append({"kind": "WORKBOOK_PROFILE_CONTRACT_EXACT_SET_FAILED"})
    members = rows("datasets/MEMBER_READINESS.jsonl")
    member_keys = Counter((x["container_file_id"], x["member_path"]) for x in members)
    if len(members) != 2271 or any(n != 1 for n in member_keys.values()):
        errors.append({"kind": "COMPLETE_CANONICAL_MEMBER_IDENTITY_FAILED"})
    unresolved = [x["member_id"] for x in members if x.get("error") or not x.get("evidence_refs")
                  or any(marker in x["readiness_status"] for marker in ("PENDING", "UNSUPPORTED", "DIRECTORY_METADATA_ONLY", "CLASSIFIED_BY_SUFFIX"))
                  or (x["member_path"].lower().endswith(".json.gz") and "FULL" not in x["readiness_status"]
                      and not x["readiness_status"].startswith("EXCLUDED_"))]
    if unresolved:
        errors.append({"kind": "UNRESOLVED_MEMBER_CURRENT_STATE", "member_ids": unresolved})
    csv_profiles = rows("datasets/TAR_CSV_FULL_STRUCTURE.jsonl")
    csv_contracts = rows("datasets/TAR_CSV_SECTION_CONTRACTS.jsonl")
    csv_keys = Counter((x["container_file_id"], x["member_path"]) for x in csv_contracts)
    if len(csv_contracts) != 182 or csv_keys != Counter((x["container_file_id"], x["member_path"]) for x in csv_profiles) or any(n != 1 for n in csv_keys.values()):
        errors.append({"kind": "TAR_CSV_CONTRACT_EXACT_SET_FAILED"})
    for contract in csv_contracts:
        if contract.get("error") or contract.get("status") != "SECTION_CONTRACT_READY" or not contract.get("data_header_fields") or contract.get("data_header_fields") == ["[Summary]"] or not contract.get("data_start_row") or contract["data_start_row"] <= contract["data_header_row"]:
            errors.append({"kind": "TAR_CSV_REAL_HEADER_UNRESOLVED", "member_path": contract["member_path"]})
    counts = {
        "original_objects": len(source), "distinct_registered_hashes": len({x["registered_sha256"] for x in source}),
        "document_objects": len(docs), "data_objects": len(data),
        "document_content_objects": len({x["file_id"] for x in rows("documents/CONTENT_INDEX.jsonl")}),
        "document_source_assertions_checked": len(rows("documents/VERIFIED_FACTS.jsonl")),
        "document_candidates_not_admitted_as_parameters": len(rows("documents/FACT_CANDIDATES.jsonl")),
        "member_readiness_rows": len(rows("datasets/MEMBER_READINESS.jsonl")),
        "full_stream_json_members": len(rows("datasets/CONTAINER_JSON_FULL_SCHEMAS.jsonl")),
        "full_stream_json_bytes": obj("datasets/CONTAINER_JSON_SCHEMA_CHECKS.json")["counts"]["bytes_read"],
        "full_stream_tar_gzip_json_members": len(rows("datasets/TAR_JSON_GZ_FULL_SCHEMAS.jsonl")),
        "full_stream_tar_gzip_json_decompressed_bytes": obj("datasets/TAR_JSON_GZ_SCHEMA_CHECKS.json")["counts"]["decompressed_json_bytes"],
        "full_structure_tar_csv_members": len(rows("datasets/TAR_CSV_FULL_STRUCTURE.jsonl")),
        "full_structure_tar_csv_bytes": obj("datasets/TAR_CSV_STRUCTURE_CHECKS.json")["counts"]["bytes"],
        "tar_csv_rows_including_metadata_and_headers": obj("datasets/TAR_CSV_STRUCTURE_CHECKS.json")["counts"]["rows_including_headers"],
        "tar_csv_section_contracts": len(csv_contracts),
        "tar_csv_measurement_rows": sum(x["data_row_count"] for x in csv_contracts),
        "container_workbooks": len(rows("datasets/CONTAINER_WORKBOOK_PROFILES.jsonl")),
        "container_sheet_contracts": len(rows("datasets/CONTAINER_WORKBOOK_CONTRACTS.jsonl")),
        "nested_mat_schema_records": len(rows("datasets/NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl")),
        "mcos_table_contracts": len(rows("datasets/MCOS_TABLE_CONTRACTS.jsonl")),
        "hdf5_batch_contracts": len(rows("datasets/HDF5_BATCH_CONTRACTS.jsonl")),
        "background_domains_including_cross_domain_reference": len(domains),
        "task_coverage_records": len(rows("coverage/TASK_COVERAGE.jsonl")),
        "supplement_logical_records": len(rows("coverage/SUPPLEMENT_MANIFEST.jsonl")),
        "supplement_document_preparation_records": len(rows("documents/SUPPLEMENT_READINESS.jsonl")),
        "build_use_status_counts": dict(Counter(x["build_use_status"] for x in rows("BUILD_USE_INDEX.jsonl"))),
    }
    unprepared = [x["file_id"] for x in docs + data if str(x["readiness"]).startswith("NOT_PREPARED")]
    if unprepared != ["FILE-038-cbd0f5edb42b-16d37f"]:
        errors.append({"kind": "UNEXPECTED_UNPREPARED_SET", "file_ids": unprepared})
    prior67 = [x for x in source if x.get("previously_pending67")]
    counts["prior_pending67_objects"] = len(prior67)
    counts["prior_pending67_readiness_counts"] = dict(Counter(delivered[x["file_id"]]["readiness"] for x in prior67))
    gate = {"status": "PASS" if not errors else "FAIL", "checked_at": datetime.now().astimezone().isoformat(),
            "scope": "Receipt freeze, exact object/coverage sets and current binding consistency; coordinator applicability judgment is recorded separately below.",
            "evidence_receipts": evidence, "counts": counts, "errors": errors}
    write("ROOT_GATE_CHECK_RESULTS.json", gate)
    if errors:
        raise SystemExit("Root freeze gate failed; no completion decision written.")

    criteria = [
        {"id": 1, "judgment": "PASS_WITH_EXPLICIT_COPY_CONTROL_EXCEPTION", "basis": "300 originals have exact identity, purpose, output/reader or explicit unavailable-content status; supplements remain separate. One copy-controlled test summary is not falsely claimed parsed."},
        {"id": 2, "judgment": "PASS_FOR_SCOPED_USE", "basis": "69 document content entries, 230 data/native-reader entries and bounded supplements have executed checks. Unknown fields are retained and affected calculations disabled; source assertions are distinct from candidate parameters."},
        {"id": 3, "judgment": "PASS_FOR_CONFIRMED_FIRST_VERSION", "basis": "Eight background domains plus cross-domain reference are mapped to 18 tasks. The current eligible minimum set covers those tasks, including external research/testing-facility practice. No fixed-product catalogue or universal scenario coverage is claimed."},
        {"id": 4, "judgment": "PASS_WITH_PARAMETER_LIMITS", "basis": "466 checked source assertions and 207 candidates remain separate. Exact units/conditions/versions and missing context are recorded; unknown-unit MCOS/raw fields do not become callable physical parameters."},
        {"id": 5, "judgment": "PASS_FOR_FORMAT_SPECIFIC_PREPARATION", "basis": "Complete container inventory, full JSON path/type streaming, workbook sheet/header/formula contracts and all-element MAT struct schemas replace representative-only claims. Numeric arrays may remain native. Numerical scientific quality is not globally certified."},
        {"id": 6, "judgment": "ACCEPTED_WITH_DISCLOSED_EXECUTION_INCIDENTS", "basis": "Original data files were read without modification; passive parsers did not invoke source code, macros or object methods. SRC038 extra page renders were disclosed and cleared. An RDA worker violated the source-environment boundary by installing packages into its .venv, then removed the seven packages pip reported installed and moved the parser to an isolated run environment. Observed pre-incident package versions match, but there was no complete environment snapshot and full restoration cannot be proved. Both incident records remain attached; data-preparation acceptance does not erase them."},
        {"id": 7, "judgment": "PASS", "basis": "Sol authors underwent non-author cross-audits, corrections and rechecks; the coordinator additionally checked source sets, readers, selectors, HDF5 and the exact eligible-use set. Historical rejected results are retained and superseded."},
        {"id": 8, "judgment": "PASS_FOR_CONFIRMED_FIRST_VERSION", "basis": "No unresolved mandatory general-preparation gap remains. Product/site case inputs, conditional transport rules and excluded source-specific functionality stay explicit; these are not silently claimed covered."},
    ]
    limitations = [
        {"id": "LIMIT-01", "item": "One copy-controlled Molicel UN test summary remains unprepared; five other product documents are only partial alternatives.", "impact": "No claim to that product's unique test results or universal product certification.", "evidence": "documents/FILE_READINESS.jsonl#file_id=FILE-038-cbd0f5edb42b-16d37f"},
        {"id": "LIMIT-02", "item": "Some units, sign conventions, conditions and calibration metadata remain undeclared; 207 document candidates are not verified operating parameters.", "impact": "Use only exactly supported field contracts; disable affected unit-dependent calculations until case/source evidence supplies missing information.", "evidence": "documents/OPEN_ITEMS.jsonl; datasets/FIELD_CONTRACTS.jsonl; datasets/DATA_CONTRACTS.jsonl"},
        {"id": "LIMIT-03", "item": "214 originals have conditional allowed actions, two NASA archives have an action split, six are excluded from local LLM/RAG use, and 78 are prepared but not selected for the minimum build set.", "impact": "No bulk folder ingestion. NASA numeric/field facts do not authorize README prose retrieval; OpenStax restrictions remain. Unselected does not mean denied.", "evidence": "BUILD_USE_INDEX.jsonl; SUPPLEMENT_USE_INDEX.jsonl; ATTRIBUTION_AND_USE.md"},
        {"id": "LIMIT-04", "item": "Product manuals/configuration, activity RMF/SWP, site owner/contact and conditional commercial transport rules require case-time matching.", "impact": "External laboratory practice is comparative evidence, not UNSW approval. No coverage of all products or scenarios is claimed.", "evidence": "coverage/OPEN_ITEMS.jsonl; coverage/TASK_COVERAGE.jsonl"},
        {"id": "LIMIT-05", "item": "Structural preparation and bounded numerical fidelity do not establish every experiment's scientific validity or any model/tool performance.", "impact": "Future implementation and scientific applicability require their own validation. Reused full CSV statistics and historical hashes are identified as reused.", "evidence": "HANDOFF_GUIDE.md; datasets/REPORT.md"},
        {"id": "LIMIT-06", "item": "The source Python environment was mistakenly modified by an RDA dependency installation, contrary to the declared boundary.", "impact": "The seven reported installed packages were removed and moved to a run-isolated environment. Known pre-incident package observations match after correction; six packages had no independent prior observation, so complete or byte-for-byte environment restoration is not claimed. Original collected data files were not installation targets. Both full 28-member parsing runs occurred in the mistakenly modified environment; the isolated environment ran the bounded reader and six fixtures, not a complete 28-member reproduction.", "evidence": "datasets/rda_supplement/SOURCE_ENVIRONMENT_CORRECTION.json; PREPARATION_ENVIRONMENT.before_rda_incident.json; SOURCE_ENVIRONMENT_RECHECK.json; datasets/rda_supplement/REPORT.md"},
    ]
    decision = {"decision_id": "ROOT-CR-DATA-READY-001-FINAL", "decided_at": gate["checked_at"],
                "status": "ACCEPTED_FOR_CONFIRMED_DATA_PREPARATION_SCOPE", "decider": "root coordinator",
                "scope": "UNSW coursework/noncommercial research; general analysis plus case-time product/site inputs; eight background domains and cross-domain practice reference.",
                "meaning": "Required building data are prepared for their recorded uses. This is not a claim that all 300 originals are fully extracted, all fields scientifically verified, or every file eligible for LLM/RAG.",
                "mandatory_general_preparation_gaps_remaining": 0, "unprepared_originals": unprepared,
                "acceptance_criteria": criteria, "counts": counts, "limitations_and_disabled_uses": limitations,
                "evidence_receipts": evidence, "root_gate": "ROOT_GATE_CHECK_RESULTS.json",
                "not_performed": ["RAG construction", "target database construction", "model inference or evaluation", "fine-tuning", "server connection or upload", "production deployment"],
                "source_integrity_basis": "The 300 original data files were read-only inputs, bound by fixed registered hashes and current identity/size checks; no repeat hash of 112 GB payloads. The distinct source .venv installation violation and limited restoration evidence are disclosed in LIMIT-06.",
                "retained_history": "Earlier rejected audits, prefix profiles and interrupted shards remain historical evidence. Current FILE_READINESS/BUILD_INPUT_INDEX and final receipts determine prepared content; ARTIFACT_INDEX is not an ingestion allowlist.",
                "next_stage": "Use HANDOFF_GUIDE and exact BUILD_USE_INDEX actions as implementation inputs; next-stage construction was not started in this run."}
    write("ROOT_DECISION.json", decision)
    readme = f"""# 数据准备交付包 · CR-DATA-READY-001

总控结论：**已通过约定范围的数据准备验收**。用途为 UNSW 课程或非商业研究，产品路线为通用分析＋当次产品/现场输入。已完成 Sol 分工、非原作者交叉审计、问题修正与总控复核。本轮没有搭建 RAG、目标数据库或模型服务。

“准备好”表示对应用途有实际内容或经过检查的原生读取入口，并保留来源、条件和限制。300 份原件全部有处置结果；其中 1 份受复制控制的测试摘要仍未准备正文，不能声称 300 份都已完整提取或都可进入模型。

## 从这里使用

- [使用说明与实际类型—读取入口—验证对应表](HANDOFF_GUIDE.md)
- [总控验收决定与八条验收依据](ROOT_DECISION.json)
- [原件身份清单](SOURCE_OBJECTS.jsonl) → [内容与读取入口](BUILD_INPUT_INDEX.jsonl) → [逐原件使用决定](BUILD_USE_INDEX.jsonl)
- [补充材料使用决定](SUPPLEMENT_USE_INDEX.jsonl)；[来源署名和完整 notice](ATTRIBUTION_AND_USE.md)
- [背景域覆盖](coverage/DOMAIN_COVERAGE.jsonl)；[18 项任务的内容依据](coverage/TASK_COVERAGE.jsonl)

不能把整个目录批量导入：当前索引同时保留了许可证据、被否决的历史结果、候选参数和人工参考材料。

## 已完成的准备

|范围|交付结果|检查范围|
|---|---|---|
|300 份原件|70 份文档记录、230 份数据记录；299 个不同注册哈希|来源、版本、路径、大小及交付集合对账；没有重复散列 112 GB 原件|
|原先未处理的 60＋7|67 份逐件有处理或限制结论；66 份已有内容/读取入口，1 份测试摘要受复制控制|不把受限原件计为正文已准备|
|文档|69 份内容入口；466 条已检查来源断言，207 条候选单列|来源断言检查不等于产品适用性、操作阈值或现场批准|
|140 个 CSV|复用 125,792,633 行的完整质量扫描与当前读取入口|保留缺失、时间回退和实验边界；未重复扫描约 19 GB|
|3 份特殊 MAT|已被动解码，11 张数值表可读取|独立核对 30 列的数值、类型、顺序；未声明单位仍未知|
|10 份 HDF5 MAT|422 个 batch cell 的字段/引用合同和数值读取入口|60 次实际值对比，独立读取器边界检查；未复制全部数组|
|48 个容器|2,271 个唯一成员的目录、状态和准备证据|91 个工作簿、{counts['container_sheet_contracts']} 张工作表合同；66 条嵌套 MAT 全结构记录|
|容器内 JSON|{counts['full_stream_json_members']} 个 ZIP JSON 和 {counts['full_stream_tar_gzip_json_members']} 个 TAR gzip JSON 已完整结构扫描|分别遍历 {counts['full_stream_json_bytes']:,} 与 {counts['full_stream_tar_gzip_json_decompressed_bytes']:,} 字节的解压后 JSON；不把前缀探测当全文件验证|
|容器内分段 CSV|{counts['full_structure_tar_csv_members']} 个文件的完整行结构和分段读取合同|{counts['full_structure_tar_csv_bytes']:,} 字节、{counts['tar_csv_rows_including_metadata_and_headers']:,} 个 CSV 记录，其中 {counts['tar_csv_measurement_rows']:,} 行位于测量数据区；其他为说明和表头|
|补充实际类型|28 个嵌套 RData、62 个科学图像均有真实结构与读取入口|RData 有界数值读取；图像 31,187 帧元数据、184 帧解码；26 个源码/说明文件惰性读取，4 个作者模型权重明确排除|
|背景与补充|八个背景域＋跨域实践参考，关联 18 项任务|23 条逻辑补充记录、21 条文档准备记录，计数对象不同；部分仅为定位/事实记录|

## 构建用途与保留限制

逐原件用途分区为 **214 份有条件可用、2 份按动作拆分、6 份不允许用于本地 LLM/RAG、78 份未选入当前构建集合**。未选不等于禁止。另有 10 个允许用途的补充载荷和 2 个明确受限载荷；每项均绑定实际路径/哈希，不能用此数量代替整个补充目录的准入决定。

- 受复制控制的 Molicel 测试摘要没有正文入口；其他资料不能替代其独有试验结果。
- 207 条候选以及缺单位、条件、符号或校准证据的字段，不作为可直接调用的操作参数；依赖这些信息的计算保持不可用。
- NASA PCoE 数值与客观字段事实的内部分析，与 README 表达性原文进入 LLM/RAG 分开处理。OpenStax 和仅供查看的制造商资料保留原限制。
- 当次产品型号/配置、现场 RMF/SWP、责任人/应急卡以及条件触发的运输规则，需要按案例匹配。外部实验室实践仅作比较参考，不能代替 UNSW 批准。
- 数据量、格式检查和有限数值对比不证明全部产品/场景覆盖，也不证明模型或分析工具有效。

## 审计与复查

[文档审计](audits/cover_reviews_docs/ROUND1.json)、[数据审计](audits/doc_reviews_data/CHECK_RESULTS.json)、[覆盖审计](audits/data_reviews_coverage/CHECK_RESULTS.json)及[构建用途审计](audits/final_build_usability/CHECK_RESULTS.json)共同支持本次决定；[总控检查](ROOT_GATE_CHECK_RESULTS.json)固定最终检查结果及哈希。

审计中发现并修正了数值/语义误分类、代表性 JSON 与 MAT 检查遗漏、成员引用歧义及 Strict OOXML 工作表遗漏等问题。旧失败结果保留为历史，当前入口与最终检查为准。SRC038 页面渲染范围错误的披露与纠正见 [修正记录](documents/SRC038_RENDER_CORRECTION.json)。

另有一次执行边界违规：RData 依赖误装进源工作区 `.venv`，随后移除了 pip 报告安装的七个包，并迁到本轮隔离环境。原始资料文件未作为安装目标；已观察的事前依赖版本与纠正后一致，但没有完整事前快照，不能保证环境完整或逐字节复原。28 成员的完整解析发生在误改环境；迁移后运行了有界读取与 6 项检查，没有在隔离环境全量重跑 28 项。见 [事故与纠正记录](datasets/rda_supplement/SOURCE_ENVIRONMENT_CORRECTION.json)和[总控环境复核](SOURCE_ENVIRONMENT_RECHECK.json)。

[运行环境](PREPARATION_ENVIRONMENT.json)记录实际解析版本。[产物索引](ARTIFACT_INDEX.jsonl)供本地复查，不是上传或模型入库清单。[未来工具验证输入](METHOD_ACCEPTANCE_INPUTS.json)已准备，工具实现与运行仍属于下一阶段。
"""
    (RUN / "README.md").write_text(readme, encoding="utf-8")
    status = f"""# 数据准备看板

最终状态：**约定范围验收通过**。决定时间：{gate['checked_at']}。权威入口：[README](README.md)与[ROOT_DECISION](ROOT_DECISION.json)。

|任务|执行与审计|最终状态|
|---|---|---|
|数据解码、容器与读取|DATA Sol；DOC 独审；总控 HDF/读取补充|通过所记录的准备范围，单位与科学适用性限制保留|
|文档及补充内容|DOC Sol；COVER 独审|69 份内容入口；1 份复制受限原件没有正文|
|八域及跨域覆盖|COVER Sol；DATA 独审；总控用途核查|18 项任务均有实际内容依据，必需通用准备缺口为 0|
|独立交叉审计|非原作者审计、作者修正、审计复核|最终检查通过；历史失败结果保留|
|汇总与总控验收|总控|300 对象集合、引用、用途分区和交付范围对齐|

保留限制详见交付入口；本轮未开始 RAG、目标数据库、模型运行、微调或服务器传输。
"""
    (RUN / "STATUS.md").write_text(status, encoding="utf-8")
    print(json.dumps({"status": decision["status"], "originals": len(source), "mandatory_general_preparation_gaps": 0, "explicit_unprepared_originals": len(unprepared)}))


if __name__ == "__main__":
    main()
