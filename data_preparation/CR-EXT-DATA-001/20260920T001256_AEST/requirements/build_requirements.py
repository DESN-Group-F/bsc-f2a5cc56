#!/usr/bin/env python3
"""Build EXT-01 requirements, authority, coverage and gap records.

Reads only project documents, frozen mapping metadata and source registries.
It does not read original source bodies.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

RUN = Path(__file__).resolve().parents[1]
OUT = RUN / "requirements"
BSC = RUN.parents[2]
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
INPUT = RUN / "INPUT_SCOPE.jsonl"
REG1 = SOURCE / "registry" / "external_sources.json"
REG2 = SOURCE / "registry" / "public_sources_incremental.json"
PLAN = BSC / "IMPLEMENTATION_PLAN.md"
RAG = BSC / "docs" / "RAG_AND_DATA.md"
STATE = BSC / "docs" / "STATE_TOOLS_AND_PREDICTION.md"
CONTRACTS = BSC / "docs" / "CONTRACTS_AND_API.md"
BLUEPRINT = Path(r"E:\desn 2000\DATA_BLUEPRINT.md")
USER_SCOPE = RUN / "USER_SCOPE.json"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path):
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]


def write_jsonl(name: str, rows: list[dict]):
    with (OUT / name).open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def ref(path: Path, anchor: str) -> str:
    return f"{path.resolve()}#{anchor}"


MODULES = {
    "M01": ("识别追溯", "Identify batteries/equipment from labels, specifications and provenance; preserve unknown and conflicting fields."),
    "M02": ("采购引入", "Compare requirements with model-specific manufacturer evidence and receiving conditions."),
    "M03": ("储存", "Assess storage against chemistry/form factor, condition, manufacturer limits, facility controls and local procedure."),
    "M04": ("充电", "Match battery, charger, BMS, configuration, location, personnel and approved procedure."),
    "M05": ("使用检查维护", "Interpret inspections and measurements with model limits, calibration and maintenance records."),
    "M06": ("设计改装实验", "Review plans, configuration changes, equipment and activity-specific risk controls without treating reference designs as approval."),
    "M07": ("异常应急", "Present current site-approved emergency information independently of model/RAG and distinguish public guidance from local response."),
    "M08": ("运输移交处置", "Match battery state and route to applicable transport, receiver, waste and chain-of-custody requirements."),
    "M09": ("治理", "Maintain current procedures, competence, review, evidence, decisions, audit and withdrawal records."),
}

MODULE_DATA_DEPENDENCIES = {
    "M01": ["D05", "D06", "D07", "D14", "D23"],
    "M02": ["D05", "D07", "D08", "D19", "D23"],
    "M03": ["D02", "D05", "D07", "D08", "D10", "D23"],
    "M04": ["D02", "D05", "D07", "D08", "D09", "D10", "D23"],
    "M05": ["D02", "D05", "D07", "D09", "D10", "D15", "D23"],
    "M06": ["D02", "D05", "D08", "D09", "D11", "D15", "D19", "D23"],
    "M07": ["D02", "D08", "D09", "D10", "D12", "D23"],
    "M08": ["D04", "D05", "D07", "D10", "D13", "D19", "D23"],
    "M09": ["D01", "D02", "D06", "D07", "D08", "D09", "D10", "D11", "D12", "D13", "D19", "D22", "D23"],
}

DEPENDENCY_BUCKET = {
    "D01": "TARGET_SITE_OR_ASSET_INPUT", "D02": "TARGET_SITE_OR_ASSET_INPUT",
    "D03": "EXTERNAL_PUBLIC_EVIDENCE", "D04": "EXTERNAL_PUBLIC_EVIDENCE",
    "D05": "TARGET_SITE_OR_ASSET_INPUT", "D06": "EXTERNAL_PUBLIC_EVIDENCE",
    "D07": "TARGET_SITE_OR_ASSET_INPUT", "D08": "TARGET_SITE_OR_ASSET_INPUT",
    "D09": "TARGET_SITE_OR_ASSET_INPUT", "D10": "RUNTIME_OR_GOVERNANCE_DATA",
    "D11": "RUNTIME_OR_GOVERNANCE_DATA", "D12": "RUNTIME_OR_GOVERNANCE_DATA",
    "D13": "RUNTIME_OR_GOVERNANCE_DATA", "D14": "TARGET_SITE_OR_ASSET_INPUT",
    "D15": "EXTERNAL_PUBLIC_EVIDENCE", "D16": "EVALUATION_OR_FUTURE_TRAINING",
    "D17": "EVALUATION_OR_FUTURE_TRAINING", "D18": "EVALUATION_OR_FUTURE_TRAINING",
    "D19": "RUNTIME_OR_GOVERNANCE_DATA", "D20": "EVALUATION_OR_FUTURE_TRAINING",
    "D21": "RUNTIME_OR_GOVERNANCE_DATA", "D22": "RUNTIME_OR_GOVERNANCE_DATA",
    "D23": "RUNTIME_OR_GOVERNANCE_DATA", "D24": "EVALUATION_OR_FUTURE_TRAINING",
}

ASSETS = {
    "D01": ("范围与用户研究", "TARGET_SITE_INPUT", "Target users, activities, sites, observations/interviews and consented research responses."),
    "D02": ("本地有效程序", "TARGET_SITE_INPUT", "Current approved target-site RMF/SWP, applicability, versions, supersession and approval records."),
    "D03": ("外校/实验室管理资料", "EXTERNAL_PUBLIC_EVIDENCE", "Authoritative external institutional guidance for comparison, never automatic UNSW applicability."),
    "D04": ("标准与运输参考", "EXTERNAL_PUBLIC_EVIDENCE", "Exact identifiers, current versions, jurisdiction/application and authorized access to applicable transport/standard material."),
    "D05": ("厂商与设备资料", "MIXED_EXTERNAL_AND_TARGET", "Actual inventory model-specific battery, charger, BMS, SDS, recall and test documentation."),
    "D06": ("术语、分类与单位", "EXTERNAL_PUBLIC_EVIDENCE", "Controlled chemistry, form factor, state, activity, role, unit and synonym definitions with provenance."),
    "D07": ("电池资产与配置", "TARGET_SITE_INPUT", "Real asset IDs, provenance, evidenced ratings, ownership, location and configuration revision."),
    "D08": ("场所与设施", "TARGET_SITE_INPUT", "Target areas, activities, controls, inspection/acceptance, owners and confirmed emergency information."),
    "D09": ("人员与资格", "TARGET_SITE_INPUT", "Minimized identity keys, roles, training, authorization scope, validity and revocation."),
    "D10": ("日常作业与检查", "RUNTIME_OPERATIONAL_DATA", "Actual use/charge/inspection events, evidence, observations, anomalies and trusted receipts."),
    "D11": ("设计与实验变更", "RUNTIME_OPERATIONAL_DATA", "Plans, system diagrams, equipment/configuration deltas and task-specific assessment."),
    "D12": ("事件与整改", "RUNTIME_OPERATIONAL_DATA", "Reports, timelines, observations, investigation conclusions, actions and verification."),
    "D13": ("转移与退役", "RUNTIME_OPERATIONAL_DATA", "State, route, recipient, required documents and transfer/disposal receipts."),
    "D14": ("图像、视频和文档标注", "TARGET_SITE_INPUT", "Consented images with capture conditions, original/crop lineage and observable/illegible labels."),
    "D15": ("时序与分析", "MIXED_EXTERNAL_AND_TARGET", "Raw data plus operating conditions, units, sampling, calibration, missingness, code and validated applicability."),
    "D16": ("检索训练/评测", "EVALUATION_ASSET", "Queries, positive evidence, non-applicable negatives, version conflicts and no-answer cases, isolated from RAG answers."),
    "D17": ("SFT任务", "FUTURE_TRAINING_ASSET", "Reviewed tasks with visible evidence, tool contracts, expected output and prohibited behavior."),
    "D18": ("偏好与纠错", "FUTURE_TRAINING_ASSET", "Chosen/rejected pairs grounded in observed failures, reasons and adjudication."),
    "D19": ("审核与决定", "RUNTIME_GOVERNANCE_DATA", "Input snapshot, authorized role, checks, decision, basis, signature and expiry."),
    "D20": ("独立评测", "EVALUATION_ASSET", "Family-grouped inputs, hidden expectations, severity, model/system outputs and human scoring."),
    "D21": ("模型和训练运行", "RUNTIME_TECHNICAL_DATA", "Actual model/revision/template/dependencies/config/data manifest/seeds/output hashes."),
    "D22": ("审计与反馈", "RUNTIME_GOVERNANCE_DATA", "Actor, action, time, authorization, tool receipt, failure and correction without automatic training reuse."),
    "D23": ("权利、隐私与撤回", "CROSS_CUTTING_GOVERNANCE", "Purpose-specific rights, consent, sensitivity, access, retention and withdrawal/deletion lineage."),
    "D24": ("开发夹具", "DEVELOPMENT_ASSET", "Synthetic success/failure, denial, expiry, offline and concurrency fixtures, separate from real safety evidence."),
}

# Deliberately task-specific associations; module tags from registries are not used
# as proof of coverage.
LINKS = {
    "M01": ["SRC-036", "SRC-038", "SRC-039", "SRC-041"],
    "M02": ["SRC-002", "SRC-032", "SRC-036", "SRC-038", "SRC-042"],
    "M03": ["SRC-002", "SRC-031", "SRC-036", "SRC-037", "SRC-038"],
    "M04": ["SRC-002", "SRC-036", "SRC-038", "SRC-039", "SRC-040", "SRC-041", "SRC-042"],
    "M05": ["SRC-002", "SRC-006", "SRC-038", "SRC-039", "SRC-040", "SRC-041", "SRC-042"],
    "M06": ["SRC-036", "SRC-039", "SRC-040", "SRC-044", "SRC-045"],
    "M07": ["SRC-002", "SRC-031", "SRC-036", "SRC-037", "SRC-044", "SRC-047"],
    "M08": ["SRC-022", "SRC-023", "SRC-036", "SRC-037", "SRC-043"],
    "M09": ["SRC-024", "SRC-043", "SRC-044", "SRC-045", "SRC-046", "SRC-047"],
    "D01": [], "D02": ["SRC-044", "SRC-045", "SRC-046"],
    "D03": ["SRC-003", "SRC-004", "SRC-005", "SRC-006", "SRC-007", "SRC-008", "SRC-048"],
    "D04": ["SRC-022", "SRC-023", "SRC-024"],
    "D05": ["SRC-038", "SRC-039", "SRC-040", "SRC-041", "SRC-042"],
    "D06": ["SRC-002", "SRC-022", "SRC-023", "SRC-036"],
    "D07": [], "D08": ["SRC-044"], "D09": ["SRC-047"],
    "D10": [], "D11": ["SRC-039", "SRC-040", "SRC-044", "SRC-045"],
    "D12": ["SRC-009", "SRC-010"], "D13": ["SRC-022", "SRC-023", "SRC-037", "SRC-043"],
    "D14": [],
    "D15": ["SRC-009", "SRC-010", "SRC-011", "SRC-012", "SRC-013", "SRC-014", "SRC-015", "SRC-016", "SRC-017", "SRC-018", "SRC-019", "SRC-020", "SRC-021", "SRC-027", "SRC-028", "SRC-029"],
    "D16": [], "D17": [], "D18": [], "D19": ["SRC-044"], "D20": [],
    "D21": ["SRC-025", "SRC-026", "SRC-033", "SRC-034"], "D22": [],
    "D23": ["SRC-024", "SRC-035"], "D24": [],
}


def authority(source: dict) -> tuple[str, str]:
    kind, publisher = source["kind"], source["publisher"]
    if publisher.startswith("UNSW") or publisher == "UNSW":
        return "LOCAL_INSTITUTIONAL_PUBLIC", "Authoritative for the published UNSW document's stated scope; not evidence of target-lab adoption, activity approval or current internal procedure unless separately confirmed."
    if publisher in {"SafeWork NSW", "Fire and Rescue NSW", "NSW Environment Protection Authority", "NSW Fair Trading", "National Transport Commission"}:
        return "JURISDICTIONAL_OFFICIAL", "Official public guidance/catalog for its jurisdiction and stated subject; exact applicability still depends on activity, item, date and site."
    if publisher == "IATA":
        return "INDUSTRY_BODY_OFFICIAL", "Authoritative industry guidance entry for air cargo context; carrier, dangerous-goods classification and current edition still require confirmation."
    if publisher == "ISO":
        return "STANDARD_BODY_METADATA_ONLY", "Authoritative catalog/currentness metadata only; standard text is not acquired or admitted for AI use."
    if kind == "MANUFACTURER_REFERENCE":
        return "MANUFACTURER_OFFICIAL", "Authoritative for the named product/document only; no target asset match has been established."
    if kind in {"EXTERNAL_EHS", "EXTERNAL_GOVERNANCE"}:
        return "EXTERNAL_INSTITUTIONAL", "Institutional reference for that institution; not a UNSW rule or target-site approval."
    if kind in {"SCIENCE_CATALOG", "TIMESERIES"}:
        return "PRIMARY_SCIENCE_DATA_OR_CATALOG", "Primary dataset/catalog evidence within its recorded cells and experiments; not operational safety authority or target-device validation."
    if kind in {"OPEN_HARDWARE_REFERENCE", "PRODUCT_REFERENCE"}:
        return "TECHNICAL_REFERENCE", "Useful product/reference architecture evidence only within named versions; not target equipment approval."
    if kind in {"ANALYSIS_SOFTWARE", "SIMULATION_SOFTWARE", "SOFTWARE_REFERENCE", "MODEL_METADATA", "METHOD_PAPER", "GENERAL_INSTRUCTION", "DATA_ENGINEERING_REFERENCE"}:
        return "METHOD_OR_SOFTWARE", "Supports software/method design or reproducibility, not battery safety requirements or target-site applicability."
    return "PUBLIC_REFERENCE", "Reference authority limited to the publisher, version and recorded purpose."


CURRENT_CHECKS = {
    "SRC-024": {"checked_on": "2026-09-20", "url": "https://www.iso.org/standard/45001", "result": "ISO 45001:2018 remains current after confirmation in 2024, has Amendment 1:2024, and is marked to be revised/replaced by a draft; catalog metadata only. ISO page states AI/ML use restrictions for ISO content."},
    "SRC-036": {"checked_on": "2026-09-20", "url": "https://www.unsw.edu.au/content/dam/pdfs/planning-assurance/safety/alerts/2023-09-safety-alerts/2023-10-General-Lithium-Ion-Li-ion-battery-Safety-alert-September-2023.pdf", "result": "Official URL remains reachable; two-page Safety Alert dated September 2023. It directs research/testing to complete a Salus Risk Management Form but is not an activity-specific procedure."},
    "SRC-043": {"checked_on": "2026-09-20", "url": "https://www.sustainability.unsw.edu.au/media-605", "result": "Official UNSW Sustainability landing remains reachable and offers the 2024 HS014 battery-tubes spreadsheet; it is a blank template, not a completed transfer record."},
    "SRC-044": {"checked_on": "2026-09-20", "url": "https://www.unsw.edu.au/content/dam/pdfs/governance/policy/2022-01-policies/HS329.pdf", "result": "Official URL now serves HS329 Version 6, effective 22 October 2025, applying to UNSW activities. Target activity RMF/SWP and authorization are still separate inputs."},
    "SRC-045": {"checked_on": "2026-09-20", "url": "https://www.unsw.edu.au/content/dam/pdfs/planning-assurance/safety/resources/2023-00-hs-documents/2022-08-Writing-Safe-work-Procedures-Guideline-HS027.pdf", "result": "Official URL remains reachable; Version 5.0 effective 8 August 2022 and explicitly marked under review. It is a writing guideline, not a battery SWP."},
    "SRC-046": {"checked_on": "2026-09-20", "url": "https://www.unsw.edu.au/content/dam/pdfs/planning-assurance/safety/resources/2023-00-hs-documents/2016-03-HS017-1-Guide-to-Completing-Risk-Management-Form-1.pdf", "result": "Official URL remains reachable but contains a 2016 guide/example with a 2017 next-review date; it must not be treated as the current controlled RMF process."},
    "SRC-047": {"checked_on": "2026-09-20", "url": "https://www.making.unsw.edu.au/access/badges/b/high-voltage-li-ion-batteries-safety-induction-badge/", "result": "Public badge landing remains reachable. Public visibility does not establish completion, competence, authorization or access to restricted training modules."},
}

SPECIFIC_EXTERNAL_REQUIREMENTS = [
    ("ER-01", "Product identity and rated parameters", ["M01","M02","D05","D07"], "Model-specific manufacturer datasheet/SDS with revision, rated voltage/capacity/energy, chemistry/form factor and test conditions.", ["SRC-038","SRC-041"], "TARGET_SCOPE_REQUIRED", "References exist for example products, but no target asset/model match exists."),
    ("ER-02", "Charging limits and compatibility", ["M02","M04","D05"], "Exact battery/device/charger/BMS manuals covering charge voltage/current, temperature, configuration, protection and incompatibilities.", ["SRC-038","SRC-040","SRC-041","SRC-042"], "TARGET_SCOPE_REQUIRED", "Named reference platforms exist; they cannot support another model or a pack-level compatibility decision."),
    ("ER-03", "Storage and operating boundaries", ["M03","M05","D05"], "Model/chemistry-specific storage and operating temperature, state-of-charge, inspection, maintenance and retirement boundaries with conditions.", ["SRC-002","SRC-036","SRC-038"], "PARTIAL_PUBLIC_BASELINE", "Public guidance supplies general hazards; numeric/product boundaries still require target manufacturer evidence."),
    ("ER-04", "BMS and protection architecture", ["M01","M04","M05","M06"], "Versioned BMS/protection documentation and actual configuration; architecture examples must remain separate from installed settings.", ["SRC-039","SRC-040","SRC-041"], "TARGET_SCOPE_REQUIRED", "Reference architectures are available but no installed device/configuration is known."),
    ("ER-05", "Current UNSW governance", ["M06","M09","D02"], "Current UNSW risk-management framework and controlled-document route, with effective version and owner.", ["SRC-044","SRC-045","SRC-046"], "PUBLIC_BASELINE_SATISFIED_WITH_LIMITS", "HS329 Version 6 is current online; HS027 is under review and HS017-1 is historical, so activity documents must come from the target unit/Salus."),
    ("ER-06", "Activity-specific UNSW RMF/SWP", ["M03","M04","M05","M06","D02"], "Approved target activity/equipment RMF and SWP, applicability, signatures/owner, revision and supersession.", ["SRC-001","SRC-036","SRC-044"], "NOT_A_PUBLIC_COLLECTION_GAP", "Public sources establish that approved RMF/SWP may be required; the actual controlled records are target-site inputs."),
    ("ER-07", "Emergency reference and site card", ["M07","D08"], "Current public emergency baseline plus site-approved card, contacts, evacuation/notification chain and facility scope.", ["SRC-002","SRC-031","SRC-036","SRC-037"], "PUBLIC_BASELINE_SATISFIED_TARGET_CARD_MISSING", "Public/UNSW general guidance exists; site card and contacts cannot be inferred."),
    ("ER-08", "Road and rail transport", ["M08","D04","D13"], "Current applicable ADG edition, jurisdictional law/competent authority, battery classification, packaging/marking and receiver requirements.", ["SRC-022"], "CONDITIONAL_PUBLIC_BASELINE_GAP", "Existing source is relevant, but the current Edition 7.9 baseline and activity applicability must be fixed if road/rail transport is in scope."),
    ("ER-09", "Air transport", ["M08","D04","D13"], "Current IATA/ICAO battery guidance and applicable carrier rules, classification, state-of-charge, packing and documentation.", ["SRC-023"], "CONDITIONAL_PUBLIC_BASELINE_GAP", "The 2026 public battery guidance is available; full DGR and carrier requirements may require controlled/commercial access."),
    ("ER-10", "Disposal and waste transfer", ["M08","D13"], "Current NSW/UNSW waste baseline plus actual receiver acceptance criteria, battery state, forms and completed receipts.", ["SRC-037","SRC-043"], "PUBLIC_BASELINE_SATISFIED_TARGET_RECEIVER_MISSING", "Official public guidance and blank template exist; they are not receiver approval or a completed record."),
    ("ER-11", "Units, conversions and electrochemical terminology", ["M01","M05","M06","D06"], "Authoritative SI/unit conversions and controlled electrochemical terms; every dataset retains its own units and sign conventions.", [], "PUBLIC_BASELINE_GAP", "No registered NIST/IUPAC source is in the 48-source catalog; small official references can close this gap."),
    ("ER-12", "Bounded electrical calculations", ["M04","M05","M06"], "Method statement and independent tests for unit conversion, P=I^2R and time-series Ah/Wh integration; explicit rejection of temperature/SOH inference.", [], "PROJECT_METHOD_CONTRACT_PRESENT", "The project tool contract defines the bounded methods; NIST SI evidence supports units, while implementation tests provide arithmetic truth. No broad physics corpus is required."),
    ("ER-13", "Electrochemical and thermal model assumptions", ["M05","M06","D15"], "For each selected model: equations, parameter provenance, chemistry/geometry/thermal boundary assumptions and independent validation range.", ["SRC-028"], "DEFER_UNTIL_METHOD_SELECTED", "PyBaMM is a candidate only. Collect model-specific primary references after the actual P2 method is selected; do not gather all battery physics."),
    ("ER-14", "Experimental data conditions and schema", ["M05","M06","D15"], "Per file/cell: chemistry, geometry, protocol, units, sampling, temperature, calibration, missingness, code/version and physical-cell grouping.", ["SRC-012","SRC-013","SRC-017","SRC-018","SRC-019","SRC-020","SRC-021"], "PARTIAL_PUBLIC_BASELINE", "Several primary datasets exist, but coverage is protocol/cell-specific and ongoing preparation must preserve each source's conditions."),
    ("ER-15", "Failure and abnormal-event evidence", ["M05","M07","D12","D15"], "Observed failure/abuse data with setup, sensor/calibration, event definition, conditions and limitations; incidents are not universal action rules.", ["SRC-009","SRC-010","SRC-036"], "PARTIAL_PUBLIC_BASELINE", "Scientific failure repositories and an UNSW alert exist; target incident data and method applicability remain separate."),
    ("ER-16", "Prediction and probability validity", ["M05","M06","D15"], "Registered method/revision, matching device/conditions, calibration, independent validation, horizon and uncertainty before numerical probability or time-to-failure.", ["SRC-017","SRC-019","SRC-020","SRC-027","SRC-029"], "NOT_A_GENERIC_PUBLIC_COLLECTION_TARGET", "Public datasets/software support research only. Without a selected validated target method, predictor.run must return NOT_AVAILABLE."),
    ("ER-17", "Transport test evidence", ["M02","M08","D04","D05"], "Current UN Manual of Tests and Criteria 38.3 basis plus model-specific manufacturer test summary and revision/amendment reference.", ["SRC-022","SRC-038"], "CONDITIONAL_PUBLIC_BASELINE_GAP", "Official current Rev.8/Amendment 1 metadata is available; the target model's test summary is a manufacturer/asset input."),
    ("ER-18", "Purpose-specific rights and currentness", ["M09","D23"], "For each source/version: local reading, retrieval, training, evaluation, redistribution, retention and withdrawal separately recorded.", ["SRC-024","SRC-035"], "ONGOING_GOVERNANCE_REQUIREMENT", "Existing records support this process; user authorization for local research does not merge downstream permissions."),
]

PUBLIC_BASELINE_GAPS = [
    {"public_gap_id":"PUB-001","requirement_ids":["ER-11","ER-12"],"need":"Authoritative SI units/conversions and electrochemical terminology.","existing_sources_sufficient":False,"action":"Register and, subject to ordinary public-use terms, retain small official references rather than a broad physics corpus.","candidates":[{"publisher":"NIST","url":"https://physics.nist.gov/cuu/pdf/sp811.pdf","artifact":"PDF; size not checked in this metadata-only review","access_condition":"Public official PDF; verify current edition/terms before project ingestion."},{"publisher":"IUPAC","url":"https://goldbook.iupac.org/terms/view/09058","artifact":"Web term entry with DOI; small page","access_condition":"Public terminology entry; record citation/version and terms."}],"blocks_public_reference_baseline":True,"blocks_target_site_use":False},
    {"public_gap_id":"PUB-002","requirement_ids":["ER-08"],"need":"Current Australian road/rail dangerous-goods baseline if M08 road/rail transport is in first release.","existing_sources_sufficient":False,"action":"Use the official NTC Edition 7.9 package and jurisdictional competent-authority guidance; do not silently rely on 7.8 change material.","candidates":[{"publisher":"National Transport Commission","url":"https://www.ntc.gov.au/codes-and-guidelines/australian-dangerous-goods-code","artifact":"Edition 7.9 PDF, 21.92 MB; page also lists ANZ-ERG2024 9.39 MB","access_condition":"Official public download; Edition 7.9 mandatory from 1 October 2025 subject to jurisdiction commencement; Appendix C copying restriction noted."}],"blocks_public_reference_baseline":True,"blocks_target_site_use":True},
    {"public_gap_id":"PUB-003","requirement_ids":["ER-09"],"need":"Current public air-transport battery guidance if air transport is in first release.","existing_sources_sufficient":False,"action":"Register the official 2026 guidance; determine whether full DGR/carrier rules require purchase or controlled access.","candidates":[{"publisher":"IATA","url":"https://www.iata.org/contentassets/05e6d8742b0047259bf3a700bc9d42b9/lithium-battery-guidance-document.pdf","artifact":"2026 guidance PDF; size not returned by current metadata check","access_condition":"Public guidance PDF; 2026 DGR is a separate controlled/commercial publication and carrier rules remain separate."}],"blocks_public_reference_baseline":True,"blocks_target_site_use":True},
    {"public_gap_id":"PUB-004","requirement_ids":["ER-17"],"need":"Current official UN 38.3 test framework metadata and amendments if transport/product acceptance is in scope.","existing_sources_sufficient":False,"action":"Register Rev.8 plus Amendment 1 metadata and require the target model's manufacturer test summary; do not copy the manual into AI context without rights review.","candidates":[{"publisher":"UNECE","url":"https://unece.org/transport/standards/transport/dangerous-goods/un-manual-tests-and-criteria-rev8-2023","artifact":"Rev.8 electronic publication plus separate Amendment 1 (2025); size not reliably established in this review","access_condition":"Free non-editable consultation copy; reproduction/republishing requires separate rights handling."}],"blocks_public_reference_baseline":True,"blocks_target_site_use":True},
]


def requirement_status(req_id: str) -> tuple[str, str]:
    if req_id in {"D16", "D17", "D18", "D20", "D21", "D22", "D24"}:
        return "NOT_CURRENT_EXTERNAL_PUBLIC_DEPENDENCY", "This is an evaluation, future-training, runtime or development artifact; its absence is not a public-source acquisition gap in EXT-01."
    if req_id == "D03":
        return "REFERENCE_SCOPE_COVERED", "Multiple external institutional sources exist for comparison, with local-applicability limits retained."
    if req_id in {"D01", "D07", "D08", "D09", "D10", "D12", "D14", "D19"}:
        return "TARGET_OR_RUNTIME_INPUT_REQUIRED", "Public sources cannot supply the real target-site, asset, person, event or decision record."
    if req_id in {"D02", "D04", "D05", "D06", "D11", "D13", "D15", "D23"}:
        return "PARTIAL_WITH_SPECIFIC_GAPS", "Relevant references exist, but mandatory target-specific, authorized, current or task-matched evidence remains missing."
    if req_id in MODULES:
        return "PARTIAL_SCOPE_PENDING", "Relevant public/reference evidence exists, but chemistry, equipment and site scope are not fixed and target records remain required."
    return "PARTIAL_WITH_SPECIFIC_GAPS", "Some supporting evidence exists but does not satisfy the complete requirement."


def split_readiness(req_id: str) -> tuple[str, str]:
    module_public = {
        "M01":"PARTIAL_PRODUCT_AND_TERMINOLOGY_BASELINE", "M02":"PARTIAL_PRODUCT_ACCEPTANCE_BASELINE",
        "M03":"GENERAL_PUBLIC_BASELINE_PRESENT", "M04":"PARTIAL_PRODUCT_COMPATIBILITY_BASELINE",
        "M05":"PARTIAL_MEASUREMENT_AND_METHOD_BASELINE", "M06":"PARTIAL_METHOD_AND_GOVERNANCE_BASELINE",
        "M07":"GENERAL_PUBLIC_BASELINE_PRESENT", "M08":"CONDITIONAL_TRANSPORT_BASELINE_GAPS",
        "M09":"GENERAL_GOVERNANCE_BASELINE_PRESENT_WITH_CURRENTNESS_LIMITS",
    }
    if req_id in module_public:
        return module_public[req_id], "NOT_READY_SCOPE_AND_TARGET_RECORDS_REQUIRED"
    bucket = DEPENDENCY_BUCKET[req_id]
    if bucket == "EXTERNAL_PUBLIC_EVIDENCE":
        return ("PARTIAL_PUBLIC_BASELINE" if req_id in {"D04","D06","D15"} else "REFERENCE_BASELINE_PRESENT"), "TARGET_MATCH_REQUIRED_WHERE_USED"
    if bucket == "TARGET_SITE_OR_ASSET_INPUT":
        return "NOT_A_PUBLIC_COLLECTION_REQUIREMENT", "NOT_READY_TARGET_INPUT_REQUIRED"
    if bucket == "RUNTIME_OR_GOVERNANCE_DATA":
        return "NOT_A_PUBLIC_COLLECTION_REQUIREMENT", "NOT_READY_UNTIL_RUNTIME_OR_GOVERNANCE_RECORD_EXISTS"
    return "NOT_A_PUBLIC_COLLECTION_REQUIREMENT", "DEFERRED_TO_EVALUATION_OR_TRAINING_STAGE"


def main():
    scope = load_jsonl(INPUT)
    sources = load_json(REG1) + load_json(REG2)
    by_source_files = defaultdict(list)
    for row in scope:
        by_source_files[row["source_id"]].append(row)
    registry_refs = {s["source_id"]: ref(REG1 if i < 35 else REG2, f"source_id={s['source_id']}") for i, s in enumerate(sources)}

    requirements = []
    for mid, (name, text) in MODULES.items():
        requirements.append({
            "requirement_id": mid, "requirement_group": "LIFECYCLE_MODULE", "name": name,
            "dependency_class": "MIXED_EXTERNAL_AND_TARGET", "requirement": text,
            "required_data_asset_ids": MODULE_DATA_DEPENDENCIES[mid],
            "minimum_evidence_condition": "At least one task-applicable authoritative/reference source plus required target asset/site/runtime facts; module labels alone are not evidence.",
            "scope_dependency": "Target chemistry, equipment and site remain unanswered.",
            "evidence_refs": [ref(PLAN, f"2.2/{mid}"), ref(BLUEPRINT, f"5/{mid}"), ref(USER_SCOPE, "target_chemistries_equipment_and_site")],
        })
    for did, (name, klass, text) in ASSETS.items():
        requirements.append({
            "requirement_id": did, "requirement_group": "DATA_ASSET", "name": name,
            "dependency_class": klass, "requirement": text,
            "dependency_bucket": DEPENDENCY_BUCKET[did],
            "minimum_evidence_condition": "Evidence must match the named asset class, preserve version/provenance/purpose, and remain separate from unrelated public, runtime, evaluation and training data.",
            "scope_dependency": "Target scope required" if klass in {"TARGET_SITE_INPUT", "MIXED_EXTERNAL_AND_TARGET"} else None,
            "evidence_refs": [ref(BLUEPRINT, f"3/{did}"), ref(RAG, "data-boundaries"), ref(USER_SCOPE, "purpose_user_confirmed")],
        })

    authority_rows = []
    for source in sources:
        sid = source["source_id"]
        files = by_source_files.get(sid, [])
        tier, limit = authority(source)
        mappings = [x["mapping_v1"] for x in files]
        authority_rows.append({
            "source_id": sid, "title": source["title"], "publisher": source["publisher"],
            "canonical_url": source["url"], "kind": source["kind"], "priority": source["priority"],
            "dedup_key": {"source_id": sid, "normalized_url": source["url"].rstrip("/")},
            "dedup_status": "UNIQUE_ACROSS_48_SOURCE_REGISTRATIONS",
            "authority_class": tier, "authority_limit": limit,
            "registered_status": {k: source.get(k) for k in ("verification_status", "checked_on", "content_obtained", "content_scope_checked", "license_observed", "ai_retrieval_permission", "training_permission", "redistribution_permission", "project_approved", "risk_or_access_note")},
            "current_official_check": CURRENT_CHECKS.get(sid),
            "mapping_linkage": {
                "original_count": len(files),
                "document_family_count": len({x["inventory"].get("document_family_id") for x in files}),
                "document_version_label_count": len({x["inventory"].get("document_version_id") for x in files}),
                "structure_identified_count": sum(x.get("mapping_status") == "STRUCTURE_IDENTIFIED" for x in mappings),
                "pending67_count": sum(x.get("pending67") is True for x in files),
                "representative_file_ids": [x["file_id"] for x in files[:10]],
                "file_list_truncated": len(files) > 10,
            },
            "task_applicability": "REFERENCE_ONLY_UNTIL_TARGET_SCOPE_MATCHED" if tier not in {"METHOD_OR_SOFTWARE", "PRIMARY_SCIENCE_DATA_OR_CATALOG"} else "METHOD_OR_RESEARCH_SCOPE_ONLY",
            "evidence_refs": [registry_refs[sid], ref(INPUT, f"source_id={sid}")],
            "unknowns": (["No original among the frozen 300 is linked to this registered source."] if not files else []) + (["Target chemistry/equipment/site match is not established."] if source["kind"] in {"MANUFACTURER_REFERENCE", "OPEN_HARDWARE_REFERENCE", "PRODUCT_REFERENCE"} else []),
        })

    coverage = []
    for req in requirements:
        rid = req["requirement_id"]
        linked = LINKS[rid]
        status, reason = requirement_status(rid)
        public_status, target_status = split_readiness(rid)
        original_count = sum(len(by_source_files.get(s, [])) for s in linked)
        family_count = len({x["inventory"].get("document_family_id") for s in linked for x in by_source_files.get(s, [])})
        version_count = len({x["inventory"].get("document_version_id") for s in linked for x in by_source_files.get(s, [])})
        coverage.append({
            "requirement_id": rid, "coverage_status": status, "coverage_reason": reason,
            "public_reference_baseline_status": public_status,
            "target_site_use_status": target_status,
            "linked_source_ids": linked,
            "linked_registered_original_count": original_count,
            "linked_document_family_count": family_count,
            "linked_document_version_label_count": version_count,
            "coverage_basis": "Task-specific source role and mapped evidence; registry module_ids and file volume were not used as proof.",
            "scope_limit": "UNSW course/noncommercial research is confirmed; target chemistry, equipment and site remain unknown.",
            "evidence_refs": [ref(INPUT, f"linked_source_ids={','.join(linked) if linked else 'NONE'}")] + [registry_refs[s] for s in linked],
            "not_proven": ["Target-site approval", "Target asset/model match", "Full content correctness", "Permission for RAG/training/redistribution"],
        })

    gaps = [
        ("GAP-001", "P0", "TARGET_SCOPE", ["M01","M02","M03","M04","M05","M06","M07","M08","D01","D05","D07","D08","D09","D11","D15"], "Target chemistry families, form factors/energy ranges, actual equipment models, activities and sites are not fixed.", "Provide a bounded first-release list: chemistry/form factor, battery and charger/BMS/device models, energy/voltage range, activities, rooms/facilities and excluded scope."),
        ("GAP-002", "P0", "LOCAL_PROCEDURE", ["M03","M04","M05","M06","M07","M09","D02"], "No current activity-specific target-lab battery RMF/SWP and approval/applicability record is linked. HS329 is current governance; HS027 is under review; HS017-1 is historical.", "Provide the current approved RMF/SWP or confirm none exists, with owner, version, scope, approval and supersession status."),
        ("GAP-003", "P0", "SITE_EMERGENCY", ["M07","D08"], "No confirmed site emergency card, local contacts, evacuation/notification chain or facility-specific response scope is linked.", "Provide the current site-approved emergency card/contact configuration and responsible owner; do not infer contacts from public references."),
        ("GAP-004", "P0", "ASSET_AND_MANUFACTURER_MATCH", ["M01","M02","M03","M04","M05","D05","D07"], "Manufacturer/reference documents exist, but actual inventory model matches and corresponding battery/charger/BMS/device manuals, SDS and recall status are unknown.", "Provide a minimal asset/model list and the exact manufacturer documents/revisions for those models."),
        ("GAP-005", "P0", "FACILITY_CONTROLS", ["M03","M04","M06","M07","D08"], "Target storage/charging/test facility purpose, controls, inspection/acceptance and responsible owners are unknown.", "Provide facility/room list, allowed activities, relevant controls, inspection status and owner."),
        ("GAP-006", "P0", "COMPETENCE_AUTHORIZATION", ["M04","M05","M06","M07","M09","D09"], "A public training badge entry exists, but actual role, completion, competence, authorization scope, validity and revocation are unavailable.", "Provide role/competency requirements and a privacy-minimized authorization source; do not copy personal records into general RAG."),
        ("GAP-007", "P1", "OPERATIONAL_RECORDS", ["M03","M04","M05","D10","D11"], "No target operational inspections, charge/use sessions, maintenance, configuration changes or trusted receipts are supplied.", "Define the first-release runtime fields and provide a small de-identified representative set or explicitly keep these functions unavailable."),
        ("GAP-008", "P1", "INCIDENT_RECORDS", ["M07","M09","D12"], "Scientific failure databases and public alerts do not replace target incident timelines, findings and corrective-action verification.", "Provide de-identified target incident/correction examples if incident-learning functions are in first release; otherwise defer them."),
        ("GAP-009", "P0", "TRANSPORT_WASTE_RECEIVER", ["M08","D04","D13"], "ADG/IATA and a UNSW waste template are references, but actual route, classification, carrier/receiver requirements and current completed transfer evidence are absent.", "For in-scope transfer/disposal tasks, provide current route, battery state/classification, carrier/receiver rules and required forms/receipts."),
        ("GAP-010", "P1", "ANALYTICS_APPLICABILITY", ["M05","M06","D15"], "Many public time-series files cover specific research cells/protocols; they do not validate target-device prediction, units/conditions must remain file-specific, and 140 CSVs do not constitute breadth coverage.", "Define the analysis target and acceptance boundary; then select cell families/protocols and retain operating conditions, units, grouping and calibration/validation evidence."),
        ("GAP-011", "P0", "CURRENT_EXTERNAL_REQUIREMENTS", ["M08","M09","D04"], "Catalogs/entries exist, but exact applicable transport/standard editions and authorized text access are not fully established. ISO metadata is current but its text is not admitted for AI use.", "Identify applicable jurisdiction/mode and obtain authorized current requirements through the responsible UNSW/transport process; keep restricted standard text outside AI context."),
        ("GAP-012", "P1", "CONTROLLED_DOCUMENT_CURRENTNESS", ["M06","M09","D02"], "HS329 Version 6 is current online, while HS027 is marked under review and HS017-1 contains a stale example; public availability does not prove the target unit's controlled copy.", "Have the responsible UNSW owner confirm the controlled documents and any replacements used by the target unit."),
        ("GAP-013", "P2", "CONTROLLED_TERMINOLOGY", ["M01","M09","D06"], "Terms are dispersed across sources and datasets; no project-approved controlled vocabulary/version is fixed.", "Create a reviewed vocabulary only after first-release chemistry/equipment/activity scope is set."),
        ("GAP-014", "P1", "USER_RESEARCH_CONSENT", ["D01","D14","D23"], "Course/research purpose is known, but participant scope, consent, privacy, retention and withdrawal for user research/images are not supplied.", "Before collecting responses/images, define consent, minimization, retention and withdrawal; public documents cannot fill this gap."),
        ("GAP-015", "DEFERRED", "EVAL_TRAIN_RUNTIME", ["D16","D17","D18","D20","D21","D22","D24"], "These are evaluation, future training, runtime and development assets, not missing public battery sources. Current plans/fixtures are not real results or approved training data.", "Keep isolated and create only in their authorized stages after system/server evidence; do not count them as EXT public-source incompleteness."),
    ]
    gap_rows = [{
        "gap_id": gid, "priority": priority, "gap_type": kind, "affected_requirement_ids": reqs,
        "finding": finding, "minimum_resolution": resolution,
        "dependency_origin": {
            "GAP-007":"RUNTIME_GENERATED", "GAP-008":"RUNTIME_GENERATED", "GAP-011":"PUBLIC_EXTERNAL",
            "GAP-013":"PUBLIC_EXTERNAL", "GAP-015":"FUTURE_TRAINING"
        }.get(gid, "TARGET_SITE_INPUT"),
        "blocks_public_reference_baseline": gid in {"GAP-011", "GAP-013"},
        "blocks_target_site_use": gid not in {"GAP-013", "GAP-015"},
        "blocking_effect": ("EXTERNAL_DATA_READY" if priority == "P0" else "FEATURE_OR_QUALITY_SCOPE" if priority == "P1" else "NONE_CURRENT_STAGE"),
        "evidence_refs": [ref(USER_SCOPE, "target_chemistries_equipment_and_site"), ref(BLUEPRINT, "13/first-materials"), ref(INPUT, "mapping_v1")],
    } for gid, priority, kind, reqs, finding, resolution in gaps]

    specific_rows = []
    for rid, name, req_ids, need, linked, status, assessment in SPECIFIC_EXTERNAL_REQUIREMENTS:
        specific_rows.append({
            "external_requirement_id": rid, "name": name, "supports_requirement_ids": req_ids,
            "required_evidence": need, "linked_source_ids": linked,
            "public_baseline_status": status, "assessment": assessment,
            "first_stage_boundary": "Supports only the stated task and evidence scope; does not authorize operations or numerical prediction beyond a registered validated method.",
            "evidence_refs": [ref(STATE, "2/suggested-tools"), ref(INPUT, f"linked_source_ids={','.join(linked) if linked else 'NONE'}")] + [registry_refs[s] for s in linked],
        })

    public_gap_rows = []
    for row in PUBLIC_BASELINE_GAPS:
        public_gap_rows.append({
            **row,
            "dependency_origin": "PUBLIC_EXTERNAL",
            "checked_on": "2026-09-20",
            "evidence_refs": [ref(STATE, "2/suggested-tools"), ref(USER_SCOPE, "purpose_user_confirmed")],
            "not_authorized_by_this_record": ["automatic download", "RAG admission", "training", "redistribution", "target-site approval"],
        })

    write_jsonl("REQUIREMENTS.jsonl", requirements)
    write_jsonl("SOURCE_AUTHORITY.jsonl", authority_rows)
    write_jsonl("COVERAGE_MATRIX.jsonl", coverage)
    write_jsonl("GAPS.jsonl", gap_rows)
    write_jsonl("EXTERNAL_REQUIREMENT_MATRIX.jsonl", specific_rows)
    write_jsonl("PUBLIC_BASELINE_GAPS.jsonl", public_gap_rows)

    stats = {
        "requirements": len(requirements), "modules": len(MODULES), "data_assets": len(ASSETS),
        "registered_sources": len(sources), "unique_source_ids": len({x['source_id'] for x in sources}),
        "unique_urls": len({x['url'].rstrip('/') for x in sources}),
        "sources_linked_to_originals": sum(bool(by_source_files.get(x['source_id'])) for x in sources),
        "sources_without_frozen_original": sum(not by_source_files.get(x['source_id']) for x in sources),
        "source_ids_without_frozen_original": [x['source_id'] for x in sources if not by_source_files.get(x['source_id'])],
        "originals": len(scope), "source_ids_in_originals": len(by_source_files),
        "pending67": sum(x['pending67'] for x in scope),
        "coverage_statuses": dict(Counter(x['coverage_status'] for x in coverage)),
        "authority_classes": dict(Counter(x['authority_class'] for x in authority_rows)),
        "p0_gaps": sum(x['priority'] == 'P0' for x in gap_rows),
        "public_baseline_gaps": len(public_gap_rows),
        "specific_external_requirements": len(specific_rows),
    }
    report = f"""# EXT-01 需求—来源—权威性—覆盖报告

## 结论

当前 48 条来源登记在 source_id 与规范化 URL 上均无重复；42 个来源关联冻结的 300 份原件，6 个仅有来源登记、没有冻结原件。数量不等于覆盖：SRC-017 的 150 份原件（其中 140 份 CSV）只代表特定研究电芯/协议与版本，不能替代本地程序、实际设备资料、现场记录或其他化学体系。

公共参考基线与目标现场使用已分开。现有资料足以支持多数外部研究/管理参考的分类；真正仍需补的公共基线只有 4 个小而明确的条目组，且运输三项取决于 M08 是否纳入首版。化学体系、设备型号、现场、人员、实际 RMF/SWP、应急卡与运行记录属于目标现场或运行时输入，不计为本轮公共资料收集失败。用户已确认用途限 UNSW 课程或非商业研究；这支持本轮具体本地处理，但不改变第三方条款，也不授权 RAG、训练、再分发或服务器传输。

## 可核对计数

- 需求记录：{stats['requirements']}（M01–M09 共 9，D01–D24 共 24）。
- 来源登记：{stats['registered_sources']}；唯一 source_id {stats['unique_source_ids']}；唯一规范化 URL {stats['unique_urls']}。
- 有冻结原件关联的来源：{stats['sources_linked_to_originals']}；只有登记、无冻结原件：{stats['sources_without_frozen_original']}（{', '.join(stats['source_ids_without_frozen_original'])}）。来源入口存在不等于全文/数据已取得。
- 冻结原件：{stats['originals']}，涉及 {stats['source_ids_in_originals']} 个 source_id；待本轮补处理：{stats['pending67']}。
- 覆盖状态：{stats['coverage_statuses']}。
- `COVERAGE_MATRIX.jsonl` 另有 `public_reference_baseline_status` 与 `target_site_use_status`：九模块虽因目标范围未定而保持综合 PARTIAL，但公共基线并不相同；M03/M07 有一般公共基线，M09 有带当前性限制的治理基线，M08 有条件运输缺口，其余按产品、术语、测量或方法范围分别部分覆盖。
- 具体首阶段外部需求：{stats['specific_external_requirements']}；公共参考基线候选缺口：{stats['public_baseline_gaps']}。
- 总体台账 P0 缺口：{stats['p0_gaps']}。其中多数来源于目标现场输入，并不阻断公共参考基线；`GAPS.jsonl` 的两个布尔字段分别说明影响。

## D01–D24 的正确归类

- 外部公共依据为主：D03、D04、D06；D05、D15 同时需要目标设备/工况匹配。
- 目标现场/资产输入：D01、D02、D07–D09、D14；公共来源不能制造这些事实。
- 运行时/治理数据：D10–D13、D19、D22；缺少它们意味着相应功能不可用或保持模拟，不是公共资料收集失败。
- 评测、未来训练、运行复现与开发：D16–D18、D20–D21、D24；必须隔离并在后续授权阶段产生，不能混入安全依据层。
- D23 是跨通道治理要求，每项资料都要分别记录本地阅读、AI 检索、训练、评测、再分发和撤回；课程/非商业用途不能自动合并这些许可。

## 权威性与适用性

权威性按发布主体和文档角色判断：UNSW 公开文件、NSW/运输官方条目、标准目录、厂商资料、外校 EHS、科学数据、软件/方法分别记录。权威发布者不等于已适用于目标实验室；产品资料也只有在实际型号匹配后才支持设备判断。软件、模型卡、训练方法和数据工程资料不充当电池安全依据。

本轮针对 7 个 P0 官方入口做了 2026-09-20 当前状态核查：HS329 在线文件为 Version 6、2025-10-22 生效；HS027 Version 5.0 仍明确标注 under review；HS017-1 URL 仍含 2016 示例及 2017 review date；UNSW 2023 电池警示、2024 HS014 模板和高压电池培训 badge 入口可访问；ISO 45001:2018 仍 current、含 2024 amendment 且处于待修订状态，ISO 页面继续明确限制 ISO 内容用于 AI/ML。具体 URL、日期与结论逐条保存在 `SOURCE_AUTHORITY.jsonl`；这些观察不是法律批准。

## 关键缺口与最小补充

`GAPS.jsonl` 给出 15 类总体缺口，并以 `dependency_origin` 区分 PUBLIC_EXTERNAL、TARGET_SITE_INPUT、RUNTIME_GENERATED 与 FUTURE_TRAINING。`blocks_public_reference_baseline` 与 `blocks_target_site_use` 分开，避免把部署/当次用户输入算作公共资料失败。

公共资料最小补充清单见 `PUBLIC_BASELINE_GAPS.jsonl`：NIST SI/IUPAC 术语是当前轻量基线缺口；ADG 7.9、IATA 2026 guidance、UNECE Rev.8+Amendment 1 仅在对应运输任务进入首版时需要。候选官方 URL、已知大小或访问条件均已记录。本轮不建议无目标收集完整物理化学知识；P=I²R、单位换算、Ah/Wh 积分按项目受限工具合同和独立测试实现，电化学/热模型只在选定具体 P2 方法后补其参数与验证出处，P3 未匹配验证时保持 NOT_AVAILABLE。

目标现场使用仍优先需要：

1. 首版 chemistry/form factor、能量/电压范围、实际 battery/charger/BMS/device 型号、活动、场所及排除范围。
2. 目标实验室现行、获批且有适用边界的电池 RMF/SWP；若没有，明确记录不存在及责任人。
3. 现场应急卡、有效联系/通知链与设施责任人。
4. 最小资产清单及逐型号厂商手册/SDS/召回或变更资料。
5. 储存、充电和测试设施的允许活动、控制、检查/验收与负责人。
6. 对首版运输/处置功能，明确运输模式、分类、承运/接收方要求及现行表单/回执。

在上述范围未答前，M01–M09 只能保持“部分参考覆盖，目标适用性待定”。这不会阻止 EXT-02/03 对现有 67 份资料做已授权的本地处理。

## 文件说明

- `REQUIREMENTS.jsonl`：33 条需求及最低证据条件。
- `SOURCE_AUTHORITY.jsonl`：48 条去重来源、权威层级、原件/family/version 关联及 P0 当前状态核查。
- `COVERAGE_MATRIX.jsonl`：需求级覆盖，不用 module_ids 或文件数量代替内容证据。
- `GAPS.jsonl`：具体缺项、影响与最小补充要求。
- `EXTERNAL_REQUIREMENT_MATRIX.jsonl`：18 项首阶段具体外部证据需求与工具/预测边界。
- `PUBLIC_BASELINE_GAPS.jsonl`：只列真正公共外部补充项、官方候选入口、大小/访问条件和双重阻断状态。

本轮未下载大数据、未读取新增原件正文、未修改源工作区，也未向项目 Qwen、正式 RAG 或服务器传输原件。官方网页元数据和少量页面文字用于当前 Codex 助手的针对性核查；当前性核查范围仅限报告列明的官方入口。
"""
    (OUT / "REPORT.md").write_text(report, encoding="utf-8", newline="\n")
    print(json.dumps(stats, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
