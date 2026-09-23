#!/usr/bin/env python3
"""Prepare the bounded ER-12 method-reference and acceptance-criteria package."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

RUN = Path(__file__).resolve().parents[1]
REQ = RUN / "requirements"
SUP = RUN / "public_supplements"
CHECKED = "2026-09-20"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in rows), encoding="utf-8")


sources = [
    {
        "method_source_id":"ER12-OPENSTAX-9.1", "title":"University Physics Volume 2, §9.1 Electrical Current",
        "authors":["Samuel J. Ling", "William Moebs", "Jeff Sanny"], "publisher":"OpenStax, Rice University",
        "publication_date":"2016-10-06", "url":"https://openstax.org/books/university-physics-volume-2/pages/9-1-electrical-current",
        "checked_on":CHECKED, "locator":"Defining Current and the Ampere; equations 9.1–9.3",
        "formula_facts":["I_avg = ΔQ/Δt", "I = dQ/dt", "1 A = 1 C/s"],
        "supports":["charge integration", "ampere/coulomb/second relationship"],
    },
    {
        "method_source_id":"ER12-OPENSTAX-9.5", "title":"University Physics Volume 2, §9.5 Electrical Energy and Power",
        "authors":["Samuel J. Ling", "William Moebs", "Jeff Sanny"], "publisher":"OpenStax, Rice University",
        "publication_date":"2016-10-06", "url":"https://openstax.org/books/university-physics-volume-2/pages/9-5-electrical-energy-and-power",
        "checked_on":CHECKED, "locator":"Power in Electric Circuits, equations 9.12–9.13; The Cost of Electricity",
        "formula_facts":["P = IV", "for an ohmic resistor with V = IR: P = I²R = V²/R", "P = dE/dt", "E = ∫P dt"],
        "supports":["electrical power", "ohmic-resistor dissipation", "energy integration"],
    },
]
common = {
    "license":"CC BY-NC-SA 4.0 as stated by the current section pages; OpenStax attribution required.",
    "ai_use_notice":"Current page also states that the book may not be used to train or otherwise be ingested into LLM/generative-AI offerings without OpenStax permission.",
    "retention_scope":"Bibliographic locator and formula facts only. No page HTML, images, worked examples or prose copied; not admitted to project Qwen/RAG/training.",
}
for row in sources:
    row.update(common)

source_path = SUP / "ER12_OPENSTAX_METHOD_REFERENCES.json"
source_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

criteria = {
    "package_id":"ER12-METHOD-REFERENCE-V1", "requirement_id":"ER-12", "prepared_on":CHECKED,
    "scope":"Reference and acceptance criteria only; no tool implementation or execution is claimed.",
    "units_and_assumptions": {
        "current":"A; positive direction/sign convention must be supplied by the caller.",
        "resistance":"ohm; P=I²R acceptance case applies only to an ohmic resistive element with R applicable at the stated condition.",
        "power":"W; P=VI uses consistent voltage polarity and current direction.",
        "charge":"Ah or C; 1 Ah = 3600 C. Signed net charge and throughput must be named separately.",
        "energy":"Wh or J; 1 Wh = 3600 J. Energy requires voltage/power, not current alone.",
        "temperature":"Absolute temperature uses K. Celsius-to-kelvin absolute conversion adds 273.15; temperature intervals satisfy 1 K = 1 °C in magnitude and must not receive that offset.",
    },
    "independent_analytic_cases":[
        {"case_id":"OHMIC-01", "inputs":{"I_A":2.0,"R_ohm":3.0}, "expected":{"P_W":12.0}, "derivation":"I²R = 2²×3"},
        {"case_id":"CHARGE-CONSTANT-01", "signal":{"duration_h":1.0,"I_A":2.0}, "expected":{"signed_charge_Ah":2.0,"signed_charge_C":7200.0}, "derivation":"∫I dt for constant I"},
        {"case_id":"ENERGY-CONSTANT-01", "signal":{"duration_h":0.5,"V_V":12.0,"I_A":2.0}, "expected":{"energy_Wh":12.0,"energy_J":43200.0}, "derivation":"∫VI dt for constant V and I"},
        {"case_id":"CHARGE-PIECEWISE-LINEAR-01", "signal":{"time_h":[0.0,1.0,2.0],"I_A":[0.0,2.0,0.0]}, "expected":{"signed_charge_Ah":2.0}, "derivation":"two triangular areas, exact for piecewise-linear I"},
        {"case_id":"ENERGY-PIECEWISE-LINEAR-01", "signal":{"time_h":[0.0,1.0,2.0],"V_V":[10.0,10.0,10.0],"I_A":[0.0,2.0,0.0]}, "expected":{"energy_Wh":20.0}, "derivation":"V constant; exact integral of piecewise-linear I"},
        {"case_id":"TEMP-ABS-01", "inputs":{"temperature_C":0.0}, "expected":{"temperature_K":273.15}},
        {"case_id":"TEMP-DELTA-01", "inputs":{"delta_temperature_C":10.0}, "expected":{"delta_temperature_K":10.0}},
    ],
    "mandatory_rejections":[
        {"condition":"fewer than two valid time samples for an integration interval", "result":"REJECT_INSUFFICIENT_SAMPLES"},
        {"condition":"timestamps repeat or decrease", "result":"REJECT_NON_MONOTONIC_TIME"},
        {"condition":"required sample is missing, non-finite, or has unknown unit", "result":"REJECT_INVALID_SAMPLE"},
        {"condition":"gap exceeds a declared maximum or gap policy is absent", "result":"REJECT_UNDECLARED_GAP_POLICY"},
        {"condition":"current direction, voltage polarity, or charge/energy sign convention is not declared", "result":"REJECT_UNDECLARED_SIGN_CONVENTION"},
        {"condition":"absolute temperature and temperature difference are not distinguished", "result":"REJECT_TEMPERATURE_QUANTITY_AMBIGUITY"},
        {"condition":"requested result labels signed/net integrated charge as battery capacity or SOH", "result":"REJECT_UNSUPPORTED_CAPACITY_OR_SOH_INFERENCE"},
    ],
    "semantic_limits":[
        "Ah is charge; Wh is energy.",
        "Signed net charge may cancel charge and discharge and is not charge throughput.",
        "Integrated net charge, throughput, or energy does not by itself establish rated capacity, usable capacity, state of charge, state of health, degradation, or safety.",
        "Piecewise-linear acceptance cases do not authorize interpolation across missing or invalid data.",
    ],
    "source_refs":[f"{source_path.resolve()}#method_source_id=ER12-OPENSTAX-9.1", f"{source_path.resolve()}#method_source_id=ER12-OPENSTAX-9.5", f"{(REQ/'PUBLIC_SUPPLEMENT_MANIFEST.jsonl').resolve()}#supplement_id=PUBSUP-NIST-SP330-2019", f"{(REQ/'PUBLIC_SUPPLEMENT_MANIFEST.jsonl').resolve()}#supplement_id=PUBSUP-BIPM-SI-9-4.01"],
}
criteria_path = SUP / "ER12_METHOD_ACCEPTANCE_CRITERIA.json"
criteria_path.write_text(json.dumps(criteria, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

manifest_path = REQ / "PUBLIC_SUPPLEMENT_MANIFEST.jsonl"
manifest = [x for x in read_jsonl(manifest_path) if not x["supplement_id"].startswith("PUBSUP-OPENSTAX-")]
for source in sources:
    sid = "PUBSUP-OPENSTAX-9.1" if source["method_source_id"].endswith("9.1") else "PUBSUP-OPENSTAX-9.5"
    manifest.append({
        "supplement_id":sid, "publisher":"OpenStax, Rice University", "title_or_edition":source["title"],
        "requested_url":source["url"], "final_url":source["url"], "checked_on":CHECKED,
        "status":"OFFICIAL_SECTION_VERIFIED_FACT_LOCATOR_ONLY", "local_path":None, "bytes":None, "sha256":None,
        "derived_record_path":str(source_path.resolve()), "derived_record_sha256":sha(source_path),
        "content_type":"text/html (official page; not retained)", "purpose":"External method basis for ER-12 bounded electrical calculations.",
        "rights_and_access":common["license"] + " " + common["ai_use_notice"],
        "processing_scope":common["retention_scope"],
        "limitations":["Not a validation of project code.", "Ohmic power identity requires the stated resistor/Ohm-law assumptions.", "No target-asset applicability is established."],
        "error":None,
    })
write_jsonl(manifest_path, manifest)

decisions_path = REQ / "LOCAL_ACTION_DECISIONS.jsonl"
decisions = [x for x in read_jsonl(decisions_path) if not x["supplement_id"].startswith("PUBSUP-OPENSTAX-")]
for source in sources:
    sid = "PUBSUP-OPENSTAX-9.1" if source["method_source_id"].endswith("9.1") else "PUBSUP-OPENSTAX-9.5"
    decisions.append({
        "supplement_id":sid, "decision":"RETAIN_BIBLIOGRAPHIC_LOCATOR_AND_FORMULA_FACTS_ONLY", "checked_on":CHECKED,
        "user_authorization":"Close the ER-12 external method basis using two official OpenStax sections without downloading the whole textbook.",
        "action_performed":"Verified the official section, attribution, formula locators and current licence/AI-use notice; retained no page HTML or prose.",
        "derivative_action":"Small attributed formula-fact locator and independently authored acceptance criteria.",
        "not_authorized":["page or book ingestion into project Qwen/RAG", "training", "redistribution", "server transfer", "tool validation claim"],
        "rights_and_access":common["license"] + " " + common["ai_use_notice"],
        "manifest_ref":f"{manifest_path.resolve()}#supplement_id={sid}",
    })
write_jsonl(decisions_path, decisions)

methods = [
    {"method_id":"units.convert", "requirement_id":"ER-12", "external_reference_status":"COMPLETE_FOR_BOUNDED_SCOPE", "implementation_status":"NOT_IMPLEMENTED_OR_TESTED_IN_EXT_01", "principle_basis":["PUBSUP-NIST-SP330-2019","PUBSUP-BIPM-SI-9-4.01"], "acceptance_criteria_ref":str(criteria_path.resolve()), "remaining_external_data_gap":None, "remaining_work":"Implement and run the recorded conversion and rejection cases."},
    {"method_id":"electric.ohmic_power", "requirement_id":"ER-12", "external_reference_status":"COMPLETE_FOR_BOUNDED_OHMIC_SCOPE", "implementation_status":"NOT_IMPLEMENTED_OR_TESTED_IN_EXT_01", "principle_basis":["PUBSUP-OPENSTAX-9.5"], "assumption":"P=I²R only for an ohmic resistive element with applicable R; otherwise use P=VI with declared polarity/sign.", "acceptance_criteria_ref":str(criteria_path.resolve()), "remaining_external_data_gap":None, "remaining_work":"Implement and run OHMIC-01 plus error and unit cases."},
    {"method_id":"series.integrate", "requirement_id":"ER-12", "external_reference_status":"COMPLETE_FOR_DEFINITION_AND_BOUNDED_ACCEPTANCE_SCOPE", "implementation_status":"NOT_IMPLEMENTED_OR_TESTED_IN_EXT_01", "principle_basis":["PUBSUP-OPENSTAX-9.1","PUBSUP-OPENSTAX-9.5"], "assumption":"Acceptance cases define constant and piecewise-linear signals only; real gaps require an explicit maximum-gap policy and must not be silently interpolated.", "acceptance_criteria_ref":str(criteria_path.resolve()), "remaining_external_data_gap":None, "remaining_work":"Implement the declared numerical and rejection behavior and run all integration cases."},
]
write_jsonl(REQ / "METHOD_REFERENCE_STATUS.jsonl", methods)

matrix_path = REQ / "EXTERNAL_REQUIREMENT_MATRIX.jsonl"
matrix = read_jsonl(matrix_path)
for row in matrix:
    if row["external_requirement_id"] == "ER-12":
        row["assessment"] = "External references and bounded acceptance criteria are prepared for SI conversion, P=IV, ohmic P=I²R, I=dQ/dt and P=dE/dt. The actual tools remain unimplemented/untested in EXT-01; that is implementation work, not a missing external-data dependency."
        row["public_baseline_status"] = "EXTERNAL_METHOD_BASIS_COMPLETE_IMPLEMENTATION_NOT_TESTED"
        row["evidence_refs"] = [str((REQ / "METHOD_REFERENCE_STATUS.jsonl").resolve()), str(criteria_path.resolve()), str(source_path.resolve())]
write_jsonl(matrix_path, matrix)

gap_path = REQ / "PUBLIC_BASELINE_GAPS.jsonl"
gaps = read_jsonl(gap_path)
for row in gaps:
    if row["public_gap_id"] == "PUB-001":
        row["status"] = "PREPARED_FOR_BOUNDED_SCOPE"
        row["existing_sources_sufficient"] = True
        row["resolution_note"] = "NIST/BIPM SI, selected IUPAC terminology, and OpenStax §§9.1/9.5 formula locators plus independent acceptance criteria complete the bounded ER-11/ER-12 external reference baseline. Tool implementation/testing remains separate."
        row["evidence_refs"] = list(dict.fromkeys(row["evidence_refs"] + [f"{manifest_path.resolve()}#supplement_id=PUBSUP-OPENSTAX-9.1", f"{manifest_path.resolve()}#supplement_id=PUBSUP-OPENSTAX-9.5", str(criteria_path.resolve())]))
write_jsonl(gap_path, gaps)

check_path = REQ / "PUBLIC_SUPPLEMENT_CHECK_RESULTS.json"
check = json.loads(check_path.read_text(encoding="utf-8"))
check.update(manifest_records=len(manifest), method_source_locator_records=2, method_acceptance_cases=len(criteria["independent_analytic_cases"]), method_rejection_conditions=len(criteria["mandatory_rejections"]), er12_external_method_basis="COMPLETE_FOR_BOUNDED_SCOPE", er12_implementation="NOT_IMPLEMENTED_OR_TESTED")
check_path.write_text(json.dumps(check, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

report_path = REQ / "REPORT.md"
report = report_path.read_text(encoding="utf-8")
old = "ER-12 已在 `METHOD_REFERENCE_STATUS.jsonl` 分层。SI 手册支持单位定义和量纲一致性，但不证明 P=I²R，也不验证代码。`electric.ohmic_power` 仍缺可引用的方法依据、适用假设、独立算例和实现测试；`series.integrate` 仍缺积分规则、时间戳/缺口/符号策略及不规则采样测试；`units.convert` 仍需独立转换向量与边界测试。当前状态不声称任何实现已经验证，也不要求无限收集物理化学资料。"
new = "ER-12 已在 `METHOD_REFERENCE_STATUS.jsonl` 分层。OpenStax/Rice University Physics Volume 2 §9.1 与 §9.5 提供 I=dQ/dt、P=IV、欧姆电阻条件下 P=I²R、P=dE/dt 与积分定义；NIST/BIPM 提供单位依据。`ER12_METHOD_ACCEPTANCE_CRITERIA.json` 已登记恒定和分段线性信号的 7 个独立解析算例、7 个强制拒绝条件、温度绝对值/温差、Ah/Wh、净电荷与容量/SOH 的语义边界。ER-12 的限定外部方法依据现已齐备；实际工具仍未实现或测试，这属于后续实现验收工作，不再列为缺外部资料。"
if old in report:
    report = report.replace(old, new)
elif new not in report:
    raise RuntimeError("expected ER-12 report paragraph not found")
report = report.replace("- `METHOD_REFERENCE_STATUS.jsonl`：ER-12 的单位依据、公式依据和实现验证缺项。", "- `METHOD_REFERENCE_STATUS.jsonl`：ER-12 的外部依据完成状态与尚未执行的实现验收。\n- `../public_supplements/ER12_OPENSTAX_METHOD_REFERENCES.json`：两节官方来源的署名、许可、定位和公式事实。\n- `../public_supplements/ER12_METHOD_ACCEPTANCE_CRITERIA.json`：独立解析算例、拒绝条件与语义边界。")
report_path.write_text(report, encoding="utf-8")
print(json.dumps({"manifest_records":len(manifest), "method_sources":len(sources), "analytic_cases":len(criteria["independent_analytic_cases"]), "rejections":len(criteria["mandatory_rejections"])}, ensure_ascii=False))
