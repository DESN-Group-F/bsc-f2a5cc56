#!/usr/bin/env python3
"""Build READY-COVER content/task coverage from retained, content-located evidence."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RUN = Path(__file__).resolve().parents[1]
COV = RUN / "coverage"
SUP = COV / "suppl"
EXT = ROOT / "data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"
SRC = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
COV.mkdir(parents=True, exist_ok=True)
SUP.mkdir(parents=True, exist_ok=True)


def write_jsonl(name: str, rows: list[dict]) -> None:
    (COV / name).write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in rows), encoding="utf-8")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ev(path: Path, locator: str | None = None) -> str:
    return str(path.resolve()) + (f"#{locator}" if locator else "")


doe = {
    "supplement_id":"READY-SUP-DOE-BATTERY-BASICS", "title":"DOE Explains...Batteries",
    "publisher":"U.S. Department of Energy, Office of Science", "url":"https://www.energy.gov/science/doe-explainsbatteries",
    "checked_on":"2026-09-20", "status":"OFFICIAL_WEB_FACT_RECORD_ONLY",
    "facts":[
        {"fact_id":"DOE-BAT-01", "statement":"A battery stores chemical potential energy and exchanges electrical energy through an external circuit."},
        {"fact_id":"DOE-BAT-02", "statement":"A cell has two terminals/electrodes separated by electrolyte; electrons move through the external circuit while ions move through the electrolyte."},
        {"fact_id":"DOE-BAT-03", "statement":"Rechargeable operation reverses electron and ion movement between charge and discharge, but real battery processes are not perfectly reversible."},
    ],
    "retention_scope":"Short paraphrased fact record and official URL only; no page HTML or images retained.",
    "use":"General battery electrochemistry orientation; not chemistry-specific limits, product instructions, failure thresholds or site procedure.",
    "rights_note":"Federal publisher page. No third-party images or page layout retained; attribution and URL preserved.",
}
doe_path = SUP / "DOE_BATTERY_BASICS_FACTS.json"
doe_path.write_text(json.dumps(doe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

manifest = [json.loads(x) for x in (EXT / "requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl").read_text(encoding="utf-8").splitlines() if x]
supplements = [{
    "supplement_id":x["supplement_id"], "origin_run":"CR-EXT-DATA-001/20260920T001256_AEST",
    "status":x["status"], "title_or_edition":x["title_or_edition"], "publisher":x["publisher"],
    "url":x["final_url"], "local_path":x.get("local_path"), "sha256":x.get("sha256"), "bytes":x.get("bytes"),
    "use":x["purpose"], "limitations":x["limitations"],
    "evidence_refs":[ev(EXT / "requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl", f"supplement_id={x['supplement_id']}")],
} for x in manifest]
supplements.append({
    "supplement_id":doe["supplement_id"], "origin_run":"CR-DATA-READY-001/20260920T012405_AEST",
    "status":doe["status"], "title_or_edition":doe["title"], "publisher":doe["publisher"], "url":doe["url"],
    "local_path":str(doe_path.resolve()), "sha256":sha(doe_path), "bytes":doe_path.stat().st_size,
    "use":doe["use"], "limitations":[doe["retention_scope"], "Not a detailed electrochemistry textbook or operational authority."],
    "evidence_refs":[ev(doe_path, "facts")],
})
write_jsonl("SUPPLEMENT_MANIFEST.jsonl", supplements)

src17_meta = SRC / "collection/raw/science/SRC-017/project_metadata.json"
src18_meta = SRC / "collection/raw/science/SRC-018/project_metadata.json"
nist = EXT / "public_supplements/NIST_SP330_2019.pdf"
bipm = EXT / "public_supplements/BIPM_SI_Brochure_9_v4.01.pdf"
method = EXT / "public_supplements/ER12_METHOD_ACCEPTANCE_CRITERIA.json"
docs67 = EXT / "documents67/PROCESSING_MANIFEST.jsonl"
docs38 = EXT / "existing233/documents/PROCESSING_MANIFEST.jsonl"
data_manifest = EXT / "PREPARATION_MANIFEST.jsonl"

domains = [
    {"domain_id":"DOM-01", "name":"Physical and chemical foundations", "coverage_status":"PREPARED_FOR_GENERAL_ANALYSIS", "required_scope":"SI quantities, electrical power/energy/charge, battery components and reversible electrochemical orientation; chemistry-specific limits remain source/case bound.", "content_evidence":[ev(nist),ev(bipm),ev(method),ev(doe_path,"facts"),ev(EXT/'public_supplements/IUPAC_TERMS_DERIVED.json')], "supported_tasks":["TASK-01","TASK-06"], "limitations":["Does not supply arbitrary chemistry parameters, reaction kinetics or product limits.","Actual tool implementation is not tested by reference preparation."], "required_gaps":[]},
    {"domain_id":"DOM-02", "name":"Battery and system engineering", "coverage_status":"PREPARED_WITH_CASE_MATCHING", "required_scope":"Cell identity/specification examples, BMS/protection/charger reference architectures and case-time manufacturer matching.", "content_evidence":[ev(docs67,"source_id=SRC-038"),ev(docs67,"source_id=SRC-039"),ev(docs67,"source_id=SRC-040"),ev(docs67,"source_id=SRC-041"),ev(docs67,"source_id=SRC-042")], "supported_tasks":["TASK-02","TASK-03","TASK-04"], "limitations":["Reference products/platforms do not establish another product or installed configuration."], "required_gaps":[]},
    {"domain_id":"DOM-03", "name":"Measurement and analysis", "coverage_status":"PREPARED_WITH_DATA_CONTRACT_LIMITS", "required_scope":"Time series, voltage/current/temperature/capacity/resistance interpretation, units, missingness, time resets and bounded computations.", "content_evidence":[ev(src17_meta,"objective"),ev(src18_meta,"objective"),ev(EXT/'existing233/CSV_PREPARATION_MANIFEST.jsonl'),ev(method)], "supported_tasks":["TASK-05","TASK-06","TASK-16"], "limitations":["Dataset-specific units/sign/sampling must be resolved by its contract; headers alone are insufficient."], "required_gaps":[]},
    {"domain_id":"DOM-04", "name":"Abnormality and failure evidence", "coverage_status":"PREPARED_AS_REFERENCE_EVIDENCE", "required_scope":"Observable abnormal conditions, incident/failure databases, uncertainty and distinction between evidence, hypothesis and target-site decision.", "content_evidence":[ev(docs38,"source_id=SRC-009"),ev(docs38,"source_id=SRC-010"),ev(docs67,"source_id=SRC-036"),ev(docs67,"source_id=SRC-048")], "supported_tasks":["TASK-07","TASK-08","TASK-15"], "limitations":["Failure databases and educational guidance do not prove causation in a new case or provide a risk probability."], "required_gaps":[]},
    {"domain_id":"DOM-05", "name":"Lifecycle practices", "coverage_status":"PREPARED_WITH_CONDITIONAL_TRANSPORT_AND_CASE_INPUT", "required_scope":"Procurement, storage, charging/use, maintenance, modification, transport and disposal as general reference plus case-time product/site facts.", "content_evidence":[ev(docs67,"source_id=SRC-038"),ev(docs67,"source_id=SRC-043"),ev(docs67,"source_id=SRC-048"),ev(EXT/'requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl',"supplement_id=PUBSUP-ADG-7.9"),ev(EXT/'requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl',"supplement_id=PUBSUP-IATA-2026")], "supported_tasks":["TASK-09","TASK-10","TASK-11","TASK-12","TASK-13"], "limitations":["Transport mode and receiver trigger applicable rules; local receipts and asset condition are runtime inputs."], "required_gaps":[]},
    {"domain_id":"DOM-06", "name":"Institutional and standards material", "coverage_status":"PREPARED_WITH_APPLICABILITY_BOUNDARIES", "required_scope":"Current UNSW governance routes, historical/current distinction, external institutional comparison and conditional standards/transport identifiers.", "content_evidence":[ev(docs67,"source_id=SRC-044"),ev(docs67,"source_id=SRC-045"),ev(docs67,"source_id=SRC-046"),ev(docs38,"source_id=SRC-002"),ev(EXT/'requirements/SOURCE_AUTHORITY.jsonl',"source_id=SRC-024")], "supported_tasks":["TASK-10","TASK-11","TASK-12","TASK-14","TASK-18"], "limitations":["External institutions are comparative references; ISO catalogue metadata is not ISO full text; target activity approvals are case/site inputs."], "required_gaps":[]},
    {"domain_id":"DOM-07", "name":"Emergency and escalation reference", "coverage_status":"PREPARED_GENERAL_REFERENCE_SITE_INPUT_AT_USE", "required_scope":"General immediate hazard/escalation guidance available independently; target-site contacts/card supplied at deployment or case time.", "content_evidence":[ev(docs38,"source_id=SRC-002"),ev(docs67,"source_id=SRC-036"),ev(docs67,"source_id=SRC-037"),ev(docs67,"source_id=SRC-048")], "supported_tasks":["TASK-15"], "limitations":["No invented UNSW/local contact, evacuation route or facility instruction."], "required_gaps":[]},
    {"domain_id":"DOM-08", "name":"Experimental and method-validation evidence", "coverage_status":"PREPARED_WITH_PER_DATASET_LIMITS", "required_scope":"Traceable experimental protocols, batch/cell grouping, data quality and bounded method acceptance evidence.", "content_evidence":[ev(src17_meta,"objective"),ev(src18_meta,"objective"),ev(data_manifest),ev(method),ev(EXT/'requirements/METHOD_REFERENCE_STATUS.jsonl')], "supported_tasks":["TASK-05","TASK-06","TASK-16","TASK-17"], "limitations":["A dataset supports only its cells/protocol/conditions; file volume is not breadth, and predictors are unavailable outside validated scope."], "required_gaps":[]},
    {"domain_id":"DOM-X", "name":"Cross-domain external laboratory, industry, case and research workflow references", "coverage_status":"PREPARED_AS_NON_APPLICABLE_REFERENCE_LAYER", "required_scope":"Comparison and method context without automatic UNSW/product applicability.", "content_evidence":[ev(docs38),ev(docs67),ev(EXT/'requirements/SOURCE_AUTHORITY.jsonl')], "supported_tasks":["TASK-08","TASK-17","TASK-18"], "limitations":["Reference value is retained separately from direct applicability and approval."], "required_gaps":[]},
]
write_jsonl("DOMAIN_COVERAGE.jsonl", domains)

task_specs = [
    ("TASK-01","Explain battery/electrical foundations","READY",["DOM-01"],"General explanation with source scope; chemistry/product specifics remain conditional."),
    ("TASK-02","Identify a case battery or product from supplied labels/specifications","READY_WITH_CASE_INPUT",["DOM-02"],"At-use product upload or accurately matched existing record required; no fixed inventory gate."),
    ("TASK-03","Compare case product operating/charging/storage limits","READY_WITH_CASE_INPUT",["DOM-02","DOM-05"],"Use exact model/revision and conditions; examples cannot be transferred."),
    ("TASK-04","Discuss BMS, charger and protection architecture","READY_REFERENCE_ONLY",["DOM-02"],"Architecture reference; installed settings/compatibility require case configuration."),
    ("TASK-05","Interpret experimental measurements and quality","READY_WITH_DATASET_CONTRACT",["DOM-03","DOM-08"],"Units, sign, time segmentation, missingness and protocol must resolve per dataset."),
    ("TASK-06","Perform bounded unit, power, charge and energy calculations","REFERENCE_AND_ACCEPTANCE_READY_IMPLEMENTATION_UNTESTED",["DOM-01","DOM-03","DOM-08"],"External method basis is complete; no claim that tools are implemented or tested."),
    ("TASK-07","Recognize and describe abnormal observations","READY_REFERENCE_ONLY",["DOM-04"],"Preserve observation/report/hypothesis; no unsupported cause or probability."),
    ("TASK-08","Compare a case with failure/case/research evidence","READY_WITH_APPLICABILITY_CHECK",["DOM-04","DOM-X"],"Similarity does not establish causation or validated action."),
    ("TASK-09","Give general storage/charging/use/maintenance guidance","READY_GENERAL_REFERENCE",["DOM-05"],"Numeric boundaries require matched product/chemistry and conditions."),
    ("TASK-10","Review procurement, commissioning or modification plan","READY_WITH_CASE_INPUT",["DOM-02","DOM-05","DOM-06"],"Plan/configuration and responsible local process supplied per case."),
    ("TASK-11","Road/rail transport analysis","CONDITIONAL_READY",["DOM-05","DOM-06"],"ADG 7.9 prepared; jurisdiction, classification, package, route and receiver supplied when selected."),
    ("TASK-12","Air transport analysis","CONDITIONAL_READY",["DOM-05","DOM-06"],"IATA public guidance prepared; applicable commercial DGR/carrier rules required when selected."),
    ("TASK-13","Disposal/transfer analysis","CONDITIONAL_READY",["DOM-05"],"Actual recipient criteria, battery state and receipts are runtime inputs."),
    ("TASK-14","Explain UNSW risk/SWP governance route","READY_WITH_CURRENTNESS_LIMITS",["DOM-06"],"HS329 current; HS027 under review and HS017-1 historical; actual approved RMF/SWP is case/site input."),
    ("TASK-15","Present emergency/escalation reference","READY_GENERAL_SITE_CARD_AT_USE",["DOM-04","DOM-07"],"General reference is available; local contacts/card cannot be inferred."),
    ("TASK-16","Select and describe an experimental dataset","READY_WITH_PER_SOURCE_LIMITS",["DOM-03","DOM-08"],"Use protocol/cell/batch/representation evidence; do not count representations as independent experiments."),
    ("TASK-17","Assess model/method applicability and uncertainty","READY_REFERENCE_ONLY",["DOM-08","DOM-X"],"No prediction outside a registered applicable validated method."),
    ("TASK-18","Compare UNSW with external laboratory/industry practice","READY_COMPARATIVE",["DOM-06","DOM-X"],"External practice is comparative, never automatic UNSW applicability."),
]
tasks=[]
for tid,name,status,dids,boundary in task_specs:
    refs=[]
    for did in dids:
        refs.extend(next(x["content_evidence"] for x in domains if x["domain_id"]==did)[:2])
    tasks.append({"task_id":tid,"name":name,"coverage_status":status,"domain_ids":dids,"evidence_refs":list(dict.fromkeys(refs)),"use_boundary":boundary,"required_public_gap":None,"case_or_runtime_inputs":boundary if "input" in status.lower() or "AT_USE" in status else None})
write_jsonl("TASK_COVERAGE.jsonl", tasks)

authority = [json.loads(x) for x in (EXT / "requirements/SOURCE_AUTHORITY.jsonl").read_text(encoding="utf-8").splitlines() if x]
primary = {"SRC-002","SRC-009","SRC-010","SRC-017","SRC-018","SRC-022","SRC-023","SRC-036","SRC-037","SRC-038","SRC-039","SRC-040","SRC-041","SRC-042","SRC-043","SRC-044","SRC-045","SRC-046","SRC-047","SRC-048"}
research = {"SRC-011","SRC-012","SRC-013","SRC-014","SRC-015","SRC-016","SRC-019","SRC-020","SRC-021","SRC-027","SRC-028","SRC-029"}
development = {"SRC-025","SRC-026","SRC-030","SRC-033","SRC-034","SRC-035"}
conditional = {"SRC-022","SRC-023","SRC-024"}
decisions=[]
for row in authority:
    sid=row["source_id"]
    if sid in development:
        status,role="EXCLUDED_FROM_BATTERY_BACKGROUND_EVIDENCE","Development/model/evaluation method material only"
    elif sid in conditional:
        status,role="CONDITIONAL_USE","Use only when the corresponding standard/transport task is selected; catalogue metadata is not full text"
    elif sid in primary:
        status,role="USED_CONTENT_LOCATED_REFERENCE","Supports the bounded content role shown in domain/task matrices"
    elif sid in research:
        status,role="USED_RESEARCH_OR_EXPERIMENT_REFERENCE","Supports experimental/method context within exact protocol and data limits"
    else:
        status,role="USED_COMPARATIVE_REFERENCE","External institution/industry reference; no automatic UNSW applicability"
    refs=[ev(EXT/'requirements/SOURCE_AUTHORITY.jsonl',f"source_id={sid}")]
    if sid=="SRC-017": refs.append(ev(src17_meta,"objective"))
    if sid=="SRC-018": refs.append(ev(src18_meta,"objective"))
    decisions.append({"source_id":sid,"decision":status,"use_role":role,"local_processing":"Concrete bounded local preparation may proceed when exact-file/purpose basis is present; legacy generic AI precheck alone is not treated as a blanket prohibition.","future_ai_or_index_use":"SEPARATE_PURPOSE_DECISION_REQUIRED_UNLESS_EXPLICIT_OPEN_USE_BASIS_IS_RECORDED","training_use":"NOT_AUTHORIZED_BY_READY_COVER","evidence_refs":refs,"limitations":["Authority and applicability depend on the stated task, version and case match."]})
write_jsonl("SOURCE_USE_DECISIONS.jsonl", decisions)

open_items = [
    {"open_item_id":"OPEN-01","type":"CASE_INPUT","blocking_general_preparation":False,"trigger":"A product-specific answer is requested","item":"Obtain the supplied product label/manual/SDS or match it exactly to an existing versioned record.","evidence_refs":[ev(docs67,"source_id=SRC-038")]},
    {"open_item_id":"OPEN-02","type":"SITE_INPUT","blocking_general_preparation":False,"trigger":"A target-site procedure, authorization or emergency answer is requested","item":"Obtain the current applicable RMF/SWP, facility scope, responsible owner and emergency contact/card.","evidence_refs":[ev(docs67,"source_id=SRC-044"),ev(docs67,"source_id=SRC-047")]},
    {"open_item_id":"OPEN-03","type":"CONDITIONAL_RULE_ACCESS","blocking_general_preparation":False,"trigger":"Air transport is selected","item":"Use applicable current commercial DGR and carrier requirements in addition to the retained public IATA guidance.","evidence_refs":[ev(EXT/'requirements/PUBLIC_BASELINE_GAPS.jsonl',"public_gap_id=PUB-003")]},
    {"open_item_id":"OPEN-04","type":"CONDITIONAL_RULE_ACCESS","blocking_general_preparation":False,"trigger":"UN 38.3/product acceptance is selected","item":"Acquire UNECE Rev.8/Amendment 1 through ordinary access and obtain the exact manufacturer's test summary.","evidence_refs":[ev(EXT/'requirements/PUBLIC_BASELINE_GAPS.jsonl',"public_gap_id=PUB-004")]},
    {"open_item_id":"OPEN-05","type":"DATASET_CONTRACT","blocking_general_preparation":False,"trigger":"A dataset other than one with resolved protocol/unit evidence is selected","item":"Resolve exact units, sign, sampling, calibration, physical-cell grouping and protocol from that source; never infer them from field names alone.","evidence_refs":[ev(EXT/'requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl',"external_requirement_id=ER-14")]},
    {"open_item_id":"OPEN-06","type":"IMPLEMENTATION_VALIDATION","blocking_general_preparation":False,"trigger":"Bounded calculation tools are implemented","item":"Run the prepared ER-12 analytic and rejection cases; reference preparation is not implementation validation.","evidence_refs":[ev(method),ev(EXT/'requirements/METHOD_REFERENCE_STATUS.jsonl')]},
    {"open_item_id":"OPEN-07","type":"PURPOSE_ADMISSION","blocking_general_preparation":False,"trigger":"A future RAG/index, server transfer or training bundle is proposed","item":"Make purpose-specific admission decisions and include only explicitly supported files/derivatives; READY-COVER does not create blanket admission.","evidence_refs":[ev(ROOT/'docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md',"5")]}]
write_jsonl("OPEN_ITEMS.jsonl",open_items)

report = f"""# READY-COVER 内容覆盖报告

本轮按真实内容定位重建了八个背景域和跨域参考层。结论是：通用分析所需的公共背景已经准备到可进入后续搭建审查的程度；产品、现场、人员和运行记录按案例提供，不再被误列为必须预先收齐的固定清单。道路/铁路、航空和 UN 38.3 是范围触发的条件功能，不是通用背景缺口。

## 实质修正

- ER-11 已由 NIST SP330 (2019)、BIPM SI Brochure v4.01、三个 IUPAC 术语和 ER-12 OpenStax 方法定位支持，不再是公共缺口。
- ER-12 的外部方法依据和验收判据已准备；工具仍未实现或测试，这属于实现状态，不是缺外部资料。
- SRC-017/018 的本地官方项目元数据已给出电芯、化学体系、额定量、试验温度、协议、截止电压、测量方法、批次和可靠性限制。单位、符号和采样仍须按表示/字段合同核对，不能从 CSV 列名推断。
- 一般分析采用“通用背景＋当次产品资料或准确匹配既有记录”，不要求固定设备清单或覆盖所有型号。
- 旧 `rag=PENDING` 或泛化 AI 预审不自动禁止有具体依据的本地解析；同时，本轮没有把本地准备升级为全部 RAG、训练、传输或再分发许可。

## 覆盖计数

- 背景域：8；跨域参考层：1。
- 任务情景：{len(tasks)}。
- 来源用途决定：{len(decisions)}（覆盖全部登记来源）。
- 补充资料记录：{len(supplements)}（复用 EXT 11 项，新增 DOE 官方基础事实定位 1 项）。
- 开放事项：{len(open_items)}，均为案例/现场/条件规则/实现验证/未来用途触发，不阻断通用背景准备。

## 边界

`DOMAIN_COVERAGE.jsonl` 和 `TASK_COVERAGE.jsonl` 的 READY 表示相应参考内容与定位已经准备，不表示现场批准、产品适配、模型预测有效或工具已经实现。外校、实验室、行业和工程案例保留比较与研究价值，但不自动成为 UNSW 程序。ISO 目录条目未被当作标准全文；IATA 公共 guidance 未被当作商业 DGR；UNECE 自动访问 403 的原件未声称已经取得。

新增 DOE 条目只保存短事实记录和官方 URL，没有保存网页、图片或大材料。本轮未建 RAG/数据库，未运行模型，未连接服务器。
"""
(COV / "REPORT.md").write_text(report,encoding="utf-8")

print(json.dumps({"domains":len(domains),"tasks":len(tasks),"sources":len(decisions),"supplements":len(supplements),"open_items":len(open_items)},ensure_ascii=False))
