import json
from pathlib import Path

RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-LITHIUM-COVERAGE-001\20260921T043456_AEST")
OUT = RUN / "scope" / "REQUIREMENT_STATUS_MATRIX.jsonl"

def row(rid, bg_status, bg, product_status, capability, gaps, products=None, existing=None, excluded=None):
    d = {
        "requirement_id": rid,
        "background_status": bg_status,
        "background_evidence": bg,
        "product_or_system_status": product_status,
        "capability": capability,
        "product_record_ids": products or [],
        "existing_record_ids": existing or [],
        "remaining_conditions": gaps,
    }
    if excluded:
        d["excluded_evidence"] = excluded
    return d

R = []
R += [
row("CHEM-CATHODE-LCO","SATISFIED_OVERVIEW",["BG-CHEM-01"],"LIMITED_EXACT_PACK_DATASHEET","可解释LCO分类，并查询一个Saft精确保护电池包的LCO/石墨声明及有限运行参数；不代表方形单体或市场覆盖。",["更多当前产品与完整运行条件","不得把包级证据转成单体形态证据"],["MF-040"],["EXIST-CALCE-CALCE-CS2","EXIST-CALCE-CALCE-CX2","EXIST-CALCE-CALCE-PL","EXIST-ARCHIVE-SEGMENT-24"]),
row("CHEM-CATHODE-NMC","SATISFIED_OVERVIEW",["BG-CHEM-01"],"LIMITED_EXACT_CELL_SHEET","有LGES精确NCM软包型号的容量/电压/能量列，并有研究队列；仅支持这些列及表内条件。",["完整充放电窗口与批准文件","成分版本/比例若任务需要"],["MF-006","MF-009"],["EXIST-CALCE-INR-18650-20R","EXIST-ARCHIVE-SEGMENT-20","EXIST-ARCHIVE-SEGMENT-32","EXIST-ARCHIVE-SEGMENT-33"]),
row("CHEM-CATHODE-NCA","SATISFIED_OVERVIEW",["BG-CHEM-01"],"LIMITED_EXACT_CELL_CATALOGUE","有Murata两个精确圆柱型号的NCA/负极材料目录行和有限参数。",["当前供货确认","完整型号批准书和运行条件"],["MF-035","MF-036"],["EXIST-ARCHIVE-SEGMENT-29","EXIST-ARCHIVE-SEGMENT-30","EXIST-ARCHIVE-SEGMENT-26"]),
row("CHEM-CATHODE-LFP","SATISFIED_OVERVIEW",["BG-CHEM-01"],"LIMITED_EXACT_CELLS_AND_SYSTEMS","有LGES、Lishen精确LFP单体，另有EVE/BYD/CATL系统或家族证据；各层级不互相替代。",["完整单体运行条件","实际pack/BMS/charger配置","当前产品状态"],["MF-007","MF-008","MF-012","MF-013","MF-014","MF-028","MF-029","MF-030","MF-031","MF-032"],["EXIST-CALCE-CALCE-A123-BATTERY","EXIST-ARCHIVE-SEGMENT-22","EXIST-ARCHIVE-SEGMENT-26","EXIST-ARCHIVE-SEGMENT-27"]),
row("CHEM-CATHODE-LMO","SATISFIED_OVERVIEW",["BG-CHEM-01"],"NO_EXACT_PRODUCT_CHEMISTRY","DOE及研究混合队列可解释LMO；GS路线图只到LIM家族，不能绑定精确LIM50EN-13。",["厂家明确的精确LMO型号","型号参数与运行条件"],[],["EXIST-ARCHIVE-SEGMENT-22","EXIST-ARCHIVE-SEGMENT-27"]),
row("CHEM-ANODE-LTO","SATISFIED_OVERVIEW",["BG-CHEM-01"],"FAMILY_CHEMISTRY_WITH_EXACT_MODULES","Toshiba官方将SCiB家族描述为LTO负极，并给出精确模组；单体仅为容量命名家族。",["精确单体型号和正极配对","保证值/批准规格"],["MF-015","MF-016","MF-017","MF-018","MF-019","MF-020","MF-021","MF-022","MF-023","MF-024","MF-025"],[]),
row("CHEM-PRIMARY","OPEN_BACKGROUND","", "LIMITED_EXACT_PRIMARY_PRODUCT","有Murata CR2032一次锂锰二氧化物纽扣单体及目录参数；不得迁移可充电锂离子充电指导。",["权威一次锂总览","实际设备/更换/处置条件","其他一次锂体系按任务另选"],["MF-043"],[]),
row("CHEM-SPECIAL","OPEN",[],"OPEN_SEPARATE_TRACK","未选择固态、可充锂金属等特殊体系。",["明确特殊体系和用途后另取化学专属证据"],[],[]),
]
# Fix the one deliberately empty background list supplied above.
R[-2]["background_evidence"] = []

R += [
row("FORM-CYL","NOT_REQUIRED_FOR_FORM_IDENTITY",[],"SATISFIED_LIMITED_EXACT_MODELS","多个官方精确圆柱单体有形态/尺寸证据；不代表其化学或完整运行条件均齐全。",["目标设备的实际尺寸、公差、端子与保护要求"],["MF-001","MF-002","MF-010","MF-011","MF-012","MF-035","MF-036"],["EXIST-CALCE-INR-18650-20R"]),
row("FORM-PRISM","NOT_REQUIRED_FOR_FORM_IDENTITY",[],"SATISFIED_LIMITED_EXACT_MODELS","Panasonic 2026目录给出两个精确方形单体和尺寸；化学仍UNKNOWN。",["型号化学和完整运行条件","当前采购批准"],["MF-044","MF-045"],["EXIST-CALCE-CALCE-CS2","EXIST-CALCE-CALCE-CX2"]),
row("FORM-POUCH","NOT_REQUIRED_FOR_FORM_IDENTITY",[],"SATISFIED_LIMITED_EXACT_MODELS","LGES一页表给出多个精确软包型号和有限参数。",["完整运行/机械约束","具体设备配置"],["MF-003","MF-004","MF-005","MF-006","MF-007","MF-008","MF-009"],["EXIST-CALCE-CALCE-PL","EXIST-ARCHIVE-SEGMENT-24"]),
row("LEVEL-CELL","SATISFIED_OVERVIEW",["BG-SYSTEM-01"],"SATISFIED_LIMITED_MULTI_MODEL","有精确单体、家族单体和研究样本，身份层级已分开；只按各记录深度查询。",["目标单体批准书","完整运行条件和当前供货"],["MF-001","MF-002","MF-003","MF-004","MF-005","MF-006","MF-007","MF-008","MF-009","MF-010","MF-011","MF-012","MF-013","MF-035","MF-036","MF-043","MF-044","MF-045"],["EXIST-CALCE-INR-18650-20R","EXIST-MOLI-INR-21700-P42A","EXIST-MOLI-INR21700-P45B","EXIST-KOKAM-SLPB78205130H"],["BG-SYSTEM-02: terms/action conflict"]),
row("LEVEL-MODULE","SATISFIED_OVERVIEW",["BG-SYSTEM-01"],"SATISFIED_LIMITED_EXACT_MODULES","Toshiba、Samsung、CATL、GS Yuasa有精确模组记录；内部单体形态与模组形态已分开。",["目标模组完整接线/冷却/保护手册","实际系统配置和版本"],["MF-021","MF-022","MF-023","MF-024","MF-025","MF-026","MF-027","MF-028","MF-029","MF-041"],[]),
row("LEVEL-PACK","SATISFIED_OVERVIEW",["BG-SYSTEM-01"],"SATISFIED_LIMITED_EXACT_PACK","Saft精确保护包和Bosch精确pack/charger套装支持有限查询；BYD仍为家族技术。",["目标pack配置、BMS阈值和设备接口","现场批准与当前版本"],["MF-014","MF-040","MF-042"],[],["BG-SYSTEM-02: terms/action conflict"]),
row("LEVEL-BMS","SATISFIED_OVERVIEW",["BG-SYSTEM-01"],"SATISFIED_FUNCTION_PRESENCE_ONLY","Samsung模组+BMS、GS Yuasa监控保护、Saft保护电路可证明功能存在；多数阈值/逻辑未公开。",["目标系统BMS阈值、固件、接口和故障响应","pack级验证"],["MF-026","MF-027","MF-040","MF-041"],[],["BG-SYSTEM-02: terms/action conflict"]),
row("LEVEL-CHARGER","PARTIAL_GENERAL_GUIDANCE",["BG-UNSW-LIFE-01","BG-NSW-FAIL-01"],"SATISFIED_ONE_EXACT_COMPATIBILITY_SET","Bosch官方精确套装将ProCORE18V 8.0Ah与GAL 18V-160 C绑定并给出两档时间。",["其他pack的批准充电器","现场供电、温度和模式配置"],["MF-042"],[]),
row("SCENE-UNSW-LAB","PARTIAL_PUBLIC_GUIDANCE",["BG-UNSW-LIFE-01","BG-UNSW-EOL-01","BG-NSW-TRANSPORT-01"],"CASE_INPUT_REQUIRED","可支持公开治理与风险计划，不构成课程实验活动批准。",["活动RMF/SWP","实验室批准","目标资产清单","当前联系人/应急卡"],[],[]),
row("SCENE-PORTABLE","PARTIAL_GENERAL_GUIDANCE",["BG-UNSW-LIFE-01","BG-NSW-FAIL-01"],"PARTIAL_CELL_EXAMPLES_ONLY","有圆柱/软包/方形单体例子，但缺目标便携设备pack、BMS和charger组合。",["具体设备型号和电池包","兼容充电器与生命周期资料"],["MF-001","MF-002","MF-003","MF-010","MF-044","MF-045"],[]),
row("SCENE-TOOLS","OPEN_BACKGROUND",[],"SATISFIED_ONE_EXACT_TOOL_SET","Bosch官方套装给出工具电池包与充电器兼容；Murata NCA圆柱单体仅作高功率单体例子。",["目标工具/电池/充电器代号匹配","BMS/温度/存放条件","其他品牌不可迁移"],["MF-035","MF-036","MF-042"],[]),
row("SCENE-LIGHT-MOBILITY","PARTIAL_PUBLIC_GUIDANCE",["BG-UNSW-LIFE-01","BG-NSW-FAIL-01"],"OPEN_NAMED_LIGHT_MOBILITY_SYSTEM","现有BYD汽车家族和EVE船舶均不能满足轻型交通工具精确pack/charger验收。",["命名轻型交通工具pack/system","批准充电器","存放与异常处置资料"],[],[]),
row("SCENE-STORAGE","SATISFIED_STATIONARY_OVERVIEW",["BG-SYSTEM-01"],"SATISFIED_LIMITED_NAMED_SYSTEMS","Samsung/CATL/GS Yuasa提供命名模组或机架及有限配置参数。",["现场设计、并机、消防/电气控制","目标系统完整手册和现行标准"],["MF-026","MF-027","MF-028","MF-029","MF-030","MF-031","MF-041"],[]),
row("LIFE-PROCURE","PARTIAL_GENERAL_GUIDANCE",["BG-NSW-FAIL-01"],"SATISFIED_IDENTITY_RECORDS_ONLY","多厂家精确型号/版本/来源可用于身份核对；目录不证明在售或相互兼容。",["当前供货/真伪和批准书","目标系统兼容性","采购渠道"],["MF-001","MF-002","MF-003","MF-012","MF-021","MF-026","MF-028","MF-040","MF-042","MF-043","MF-044"],["EXIST-MOLI-INR-21700-P42A","EXIST-KOKAM-SLPB78205130H"],["BG-SYSTEM-02: terms/action conflict"]),
row("LIFE-CHARGE","PARTIAL_GENERAL_GUIDANCE",["BG-UNSW-LIFE-01","BG-NSW-FAIL-01"],"PARTIAL_MODEL_LIMITS_ONE_COMPATIBILITY_SET","Lishen、Saft、GS Yuasa有部分充电电流/电压/温度条件，Bosch仅对一个精确套装证明充电器兼容。MF-002 的CCCV值只是容量试验条件，不是自动推荐的充电上限。Samsung模组的一般运行电压范围未计作专门充电范围。",["每个目标型号完整充放电窗口","批准充电器/BMS关系","现场模式和温度"],["MF-002","MF-012","MF-040","MF-041","MF-042"],["EXIST-MOLI-INR-21700-P42A"]),
row("LIFE-STORAGE","PARTIAL_GENERAL_GUIDANCE",["BG-NSW-FAIL-01"],"PRODUCT_SPECIFIC_GAP","本轮产品结构化事实没有形成可通用于目标资产的SOC/温度/时长存放条件。",["目标产品存放SOC、温度、时长","现场隔离/库存控制"],[],[]),
row("LIFE-USE-MAINT","PARTIAL_PUBLIC_GUIDANCE",["BG-UNSW-LIFE-01","BG-NSW-FAIL-01"],"CASE_AND_PRODUCT_MANUAL_REQUIRED","可说明外观检查和停用升级；缺目标产品维护手册与实际状态。",["目标型号维护/检查手册","实际观察记录"],[],[]),
row("LIFE-AGE-DIAG","NO_GENERAL_BACKGROUND_SELECTED",[],"SATISFIED_EXISTING_DATASET_METHODS_WITH_LIMITS","既有NASA/CALCE/TRI数据记录和协议可支持条件化分析；产品循环寿命只在其声明条件下使用。",["按数据集保留采样、单位、基线和不确定性","不得宣称通用SOH估计器"],["MF-026","MF-027","MF-032"],["EXIST-NASA-SAMPLE-B0025","EXIST-CALCE-SAMPLE-CS2-21","EXIST-TRI017-SAMPLE-5C86BD6CFA2EDE00015DDBBC","EXIST-TRI020-SAMPLE-PREDIAG_000208_000206","EXIST-ARCHIVE-SEGMENT-20","EXIST-ARCHIVE-SEGMENT-26"]),
row("LIFE-MOVE","PARTIAL_JURISDICTIONAL_GUIDANCE",["BG-NSW-TRANSPORT-01"],"RULE_AND_CASE_INPUT_REQUIRED","可区分现场搬运、道路运输和航空/承运人分支；不能签发运输批准。",["现行ADG/IATA/承运人规则","电池状态、数量、包装和路线"],[],[]),
row("LIFE-EOL","PARTIAL_PUBLIC_GUIDANCE",["BG-UNSW-EOL-01","BG-NSW-TRANSPORT-01"],"SITE_ROUTE_REQUIRED","可区分完好小电池与受损/大批量路径；实际路线仍需当前校园/辖区确认。",["当前校园/辖区处置点与联系人","实际状态和数量"],[],[]),
row("LIFE-ABNORMAL","PARTIAL_PUBLIC_GUIDANCE",["BG-UNSW-LIFE-01","BG-UNSW-EOL-01","BG-NSW-FAIL-01","BG-NSW-TRANSPORT-01"],"SITE_AND_CASE_INPUT_REQUIRED","可识别公开指导中的警示征兆并升级；保护功能存在不等于已知阈值或故障原因。",["当前现场应急计划/联系人","实际观察","专家诊断和目标BMS阈值"],["MF-026","MF-027","MF-040","MF-041"],[]),
]

OUT.write_text("\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in R) + "\n", encoding="utf-8")
print(json.dumps({"rows": len(R), "ids": [x["requirement_id"] for x in R]}, ensure_ascii=False))
