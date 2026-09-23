#!/usr/bin/env python3
"""Build auditable PRODUCTS JSONL outputs from bounded official-source review."""
from __future__ import annotations

import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent


def write_jsonl(name, rows):
    with (ROOT / name).open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def fact(field, value, unit, condition, locator, qualifier="stated"):
    return {"field": field, "value": value, "unit": unit, "qualifier": qualifier,
            "condition": condition, "evidence_locator": locator}


def record(rid, manufacturer, label, kind, chemistry, form, level, refs, version,
           facts, limits, depth, status="LOCALLY_CHECKED_BOUNDED_FACTS", gaps=None, aliases=None):
    return {
        "record_id": rid, "manufacturer": manufacturer, "model_label": label,
        "identity_kind": kind, "canonical_identity": f"{manufacturer}::{label}",
        "aliases": aliases or [], "chemistry": chemistry, "form_factor": form,
        "system_level": level, "source_refs": refs, "document_version": version,
        "facts": facts, "conditions_and_limits": limits, "content_depth": depth,
        "use_status": status, "remaining_gaps": gaps or []
    }


targets = [
    {"target_id":"T-MOLICEL","manufacturer":"Molicel / E-One Moli Energy","targets":["INR-21700-P42A","INR21700-P45B"],"dimensions":["cylindrical","cell","chemistry declared at model level"],"result":"REUSED_OFFICIAL_EXACT_MODEL_MATERIAL_WITH_RESTRICTIONS"},
    {"target_id":"T-PANASONIC","manufacturer":"Panasonic Energy","targets":["NCR1865K","CGA103450A","UF103450PN","primary lithium examples"],"dimensions":["cylindrical","prismatic","cell","secondary/primary split"],"result":"CURRENT NCR PAGE AND 2026 OFFICIAL CATALOG WITH EXACT PRISMATIC MODELS ACQUIRED; EARLIER 2018 URL HTML FAILURE RETAINED"},
    {"target_id":"T-SAMSUNG","manufacturer":"Samsung SDI","targets":["21700 cells","M10023","M5194"],"dimensions":["cylindrical","prismatic","module/BMS"],"result":"EXACT_MODULE_MODELS_ACQUIRED; current exact cell model absent"},
    {"target_id":"T-LGES","manufacturer":"LG Energy Solution","targets":["E101A","E72B","E79","JP3","JF1","JF2","JH4","M50L","M52V"],"dimensions":["pouch","cylindrical","NCMA/NCM/LFP"],"result":"NINE_EXACT_CELL_MODELS_ACQUIRED"},
    {"target_id":"T-MURATA","manufacturer":"Murata","targets":["US18650VTC6","US18650VTC5A","US21700VTC6A","CR2032"],"dimensions":["cylindrical","coin","cell","NCA","primary lithium"],"result":"THREE RECHARGEABLE EXACT MODELS PLUS ONE PRIMARY CR2032 MODEL ACQUIRED"},
    {"target_id":"T-EVE","manufacturer":"EVE Energy","targets":["LF280K","LF105"],"dimensions":["LFP","prismatic","cell/system"],"result":"LF280K OFFICIAL MODEL/USE/CHEMISTRY; dimensions/operating limits unresolved"},
    {"target_id":"T-LISHEN","manufacturer":"Lishen","targets":["LR2170EA","LR1865EK","pouch/prismatic models"],"dimensions":["LFP","cylindrical","pouch","prismatic"],"result":"LR2170EA EXACT MODEL ACQUIRED; other shapes remain series-level"},
    {"target_id":"T-CATL","manufacturer":"CATL","targets":["280Ah LFP cell","M20280-E/P","R1720280-E/P"],"dimensions":["LFP","prismatic","module/rack/BMS"],"result":"EXACT MODULE/RACK MODELS AND FAMILY CELL DATA ACQUIRED"},
    {"target_id":"T-BYD","manufacturer":"BYD","targets":["Blade Battery"],"dimensions":["LFP","blade/prismatic-like","pack/system"],"result":"FAMILY_ONLY; no complete cell model designation"},
    {"target_id":"T-TOSHIBA","manufacturer":"Toshiba SCiB","targets":["2.9Ah/10Ah/20Ah/23Ah/26Ah cells","Type3/Type4 modules","Industrial Pack"],"dimensions":["LTO negative electrode","prismatic","cell/module/pack/BMU"],"result":"EXACT MODULE/PACK MODELS; capacity-labelled cells retained as FAMILY"},
    {"target_id":"T-A123","manufacturer":"A123 Systems","targets":["ANR26650M1-B","AMP20"],"dimensions":["LFP","cylindrical","pouch"],"result":"NO_DIRECT_CURRENT_OFFICIAL_SMALL_SOURCE_ACQUIRED"},
    {"target_id":"T-SAFT","manufacturer":"Saft","targets":["7s2p MP 176065 BLF","MP/VL exact chemistry candidates"],"dimensions":["LCO","pack","protection circuit"],"result":"EXACT LCO/GRAPHITE PACK DATASHEET ACQUIRED"},
    {"target_id":"T-GSYUASA","manufacturer":"GS Yuasa","targets":["LIM50EN-13","LIM50EN-14"],"dimensions":["LMO","module","monitoring/protection"],"result":"EXACT LIM50EN-13 MODULE ACQUIRED; Gr/LMO ROADMAP GROUPING UNLINKED TO EXACT MODULE AND NOT ASSIGNED"},
    {"target_id":"T-BOSCH","manufacturer":"Bosch Professional","targets":["ProCORE18V 8.0Ah","GAL 18V-160 C","official compatibility set"],"dimensions":["pack","charger","compatibility"],"result":"EXACT PACK-CHARGER STARTER SET ACQUIRED"},
]

raw_sources = [json.loads(x) for x in (ROOT / "SOURCE_REGISTER.raw.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
pdf_validation = json.loads((ROOT / "PDF_VALIDATION_RESULTS.json").read_text(encoding="utf-8"))
pdf_validation_by_id = {x["source_id"]: x for x in pdf_validation["pdf_candidates"]}
rights_review_notes = {
    "PROD-SRC-001": "Panasonic live model page and page footer reviewed; no source-specific AI/RAG/training or file-redistribution licence identified; separate site terms/robots legal analysis was outside this bounded product-fact pass.",
    "PROD-SRC-002": "Murata model datasheet body/version reviewed for factual extraction; no reusable AI/RAG/training grant identified in the document.",
    "PROD-SRC-003": "LG Energy Solution 2024 sheet and its reference-data caveat reviewed; no reusable AI/RAG/training grant identified in the sheet.",
    "PROD-SRC-004": "Toshiba 2025 catalog and its specifications-not-guaranteed notice reviewed; no reusable AI/RAG/training grant identified in the catalog.",
    "PROD-SRC-005": "Samsung SDI brochure and dated product tables reviewed; no reusable AI/RAG/training grant identified in the brochure.",
    "PROD-SRC-006": "CATL public brochure and product tables reviewed; no reusable AI/RAG/training grant identified in the brochure.",
    "PROD-SRC-007": "Lishen public model page reviewed after final hash binding; no source-specific AI/RAG/training or redistribution grant identified; separate site terms/robots review was not performed in this bounded pass.",
    "PROD-SRC-008": "EVE official application article reviewed; no source-specific AI/RAG/training or redistribution grant identified; separate site terms/robots review was not performed in this bounded pass.",
    "PROD-SRC-009": "BYD official media page reviewed after final hash binding; no source-specific AI/RAG/training or redistribution grant identified; separate site terms/robots review was not performed in this bounded pass.",
    "PROD-SRC-010": "Murata K70E catalog, relevant rechargeable and primary-battery pages, and reference-data caveats reviewed; no reusable AI/RAG/training grant identified in the catalog.",
    "PROD-SRC-011": "Acquisition failed: official URL returned an HTML landing/error representation, not the advertised PDF. It is excluded from product facts; no content-use decision is inferred from the filename.",
    "PROD-SRC-012": "GS Yuasa investor presentation and chemistry roadmap page reviewed; no reusable AI/RAG/training grant identified in the presentation.",
    "PROD-SRC-013": "Saft exact pack datasheet, revision, chemistry and subject-to-change notice reviewed; no reusable AI/RAG/training grant identified in the sheet.",
    "PROD-SRC-014": "Bosch Professional official starter-set page and included-item statements reviewed; no source-specific AI/RAG/training or redistribution grant identified; separate site terms/robots review was not performed in this bounded pass.",
    "PROD-SRC-015": "GS Yuasa official product release and its exact module profile reviewed; no source-specific AI/RAG/training or redistribution grant identified; separate site terms/robots review was not performed in this bounded pass.",
    "PROD-SRC-016": "Panasonic Energy 2026 official short-form catalog and download-page copyright notice reviewed: modification or website reposting requires permission. Current action is unmodified local review and nonverbatim fact structuring; RAG/training and file redistribution are not admitted.",
}
for s in raw_sources:
    s["evidence_refs"] = [f"{s['local_path']}#sha256={s['sha256']}"] if s["status"].startswith("ACQUIRED") else []
    s["rights_evidence"] = rights_review_notes[s["source_id"]]
    if not s["status"].startswith("ACQUIRED"):
        s["use_decision"] = {"public_read":"NOT_ESTABLISHED_FROM_FAILED_CAPTURE", "internal_nonverbatim_fact_structuring":"EXCLUDED_FROM_FACTS", "local_search_or_rag_ingestion":"NOT_ADMITTED", "model_training":"NOT_ADMITTED", "source_file_redistribution":"NOT_ADMITTED", "current_action":"RETAIN_ACQUISITION_FAILURE_EVIDENCE_ONLY"}
    if s["source_id"] in pdf_validation_by_id:
        s["pdf_validation"] = pdf_validation_by_id[s["source_id"]]

reused_sources = [
    {"source_id":"PROD-SRC-R01","url":"https://www.molicel.com/wp-content/uploads/INR21700P42A_1.7_Product-Data-Sheet-of-INR-21700-P42A-80092.pdf","publisher":"E-One Moli Energy / Molicel","acquired_at":"2026-09-17","local_path":"E:/desn 2000/data/battery_data_workspace_v0_3/collection/quarantine/raw/technical/SRC-038/datasheet_v1.7.pdf","sha256":"dca433d5bba5c3b10d157fc3ab22ddaaa1b9d4162de70c7d76a347d925fe4db5","bytes":178625,"version":"1.7","authority_basis":"DIRECT_OFFICIAL_PUBLISHER_URL; REUSED_READ_ONLY","use_decision":{"public_read":"ALLOWED_FOR_VIEWING","internal_nonverbatim_fact_structuring":"ALLOWED_FOR_CURRENT_BOUNDED_REVIEW","local_search_or_rag_ingestion":"DENIED_BY_EXISTING_EXACT_VERSION_DECISION","model_training":"DENIED_BY_EXISTING_EXACT_VERSION_DECISION","source_file_redistribution":"RESTRICTED_BY_EXISTING_EXACT_VERSION_DECISION","current_action":"REUSE_PRIOR_BOUNDED_REVIEW_FACTS_ONLY"},"rights_evidence":"Exact-version existing decision: manufacturer notice supports electronic copying for transmission/viewing only; reusable AI/RAG/training permission not found.","evidence_refs":["E:/desn 2000/bsc/data_preparation/CR-DATA-CANDIDATE-001/20260920T045258_AEST/rights_review/ACTION_REVIEW.json#file_id=FILE-038-dca433d5bba5-412af4","E:/desn 2000/bsc/data_preparation/CR-DATA-CANDIDATE-001/20260920T045258_AEST/review_restricted/REVIEW_RESULTS.jsonl#model=INR-21700-P42A"]},
    {"source_id":"PROD-SRC-R02","url":"https://www.molicel.com/product/inr-21700-p42a/","publisher":"E-One Moli Energy / Molicel","acquired_at":"2026-09-17","local_path":"E:/desn 2000/data/battery_data_workspace_v0_3/collection/quarantine/raw/technical/SRC-038/SDS_FSSF00058BJ.pdf","sha256":"5466376b6dad29c4a73b83b5cff2031a39dfaa74fec839ffba1b813bc84f33cb","bytes":554338,"version":"FSSF00058BJ / January 2025","authority_basis":"OFFICIAL_MANUFACTURER_SDS; REUSED_READ_ONLY","use_decision":{"public_read":"ALLOWED_FOR_VIEWING","internal_nonverbatim_fact_structuring":"ALLOWED_FOR_CURRENT_BOUNDED_REVIEW","local_search_or_rag_ingestion":"DENIED_BY_EXISTING_EXACT_VERSION_DECISION","model_training":"DENIED_BY_EXISTING_EXACT_VERSION_DECISION","source_file_redistribution":"RESTRICTED_BY_EXISTING_EXACT_VERSION_DECISION","current_action":"REUSE_PRIOR_BOUNDED_REVIEW_FACTS_ONLY"},"rights_evidence":"Exact-version existing decision: viewing/bounded review separated from persistent AI/RAG/training and redistribution.","evidence_refs":["E:/desn 2000/bsc/data_preparation/CR-DATA-CANDIDATE-001/20260920T045258_AEST/rights_review/ACTION_REVIEW.json#file_id=FILE-038-5466376b6dad-e6f834","E:/desn 2000/bsc/data_preparation/CR-DATA-CANDIDATE-001/20260920T045258_AEST/review_restricted/REVIEW_RESULTS.jsonl#fact_id=FILE-038-5466376b6dad-e6f834-A0043"]},
]

models = []
models.append(record("MF-001","Panasonic Energy","NCR1865K","EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"lithium-ion secondary battery"},"CYLINDRICAL","CELL",["PROD-SRC-001#product specifications"],"live page snapshot 2026-09-21",[
    fact("nominal_voltage",3.60,"V","manufacturer product specification","Specifications table"),fact("capacity_min",2980,"mAh","manufacturer product specification","Specifications table"),fact("capacity_typ",3100,"mAh","manufacturer product specification","Specifications table"),fact("diameter_max_with_tube",18.5,"mm","with tube","Specifications table"),fact("height_max_with_tube",65.3,"mm","with tube","Specifications table"),fact("weight_max",47.5,"g","manufacturer product specification","Specifications table")], ["Model page does not state cathode/anode chemistry or full charge/discharge limits."],"MODEL_PAGE_CORE_SPEC"))
models.append(record("MF-002","Murata","US18650VTC6","EXACT_MODEL",{"positive":"NCA","negative":"Gr, SiO","declared_system":"NCA / Gr, SiO"},"CYLINDRICAL","CELL",["PROD-SRC-002#page=1","PROD-SRC-010#printed_page=89&pdf_page=91&table=Cylindrical_Type_Lithium_Ion"],"Datasheet Version 001; K70E catalog page marker Jan. 6, 2021",[
    fact("nominal_capacity",3120,"mAh","CCCV 3.0A to 4.2V for 2.5h at 23C; discharge 0.2ItA/600mA to 2.0V at 23C","page 1 Specifications"),fact("rated_capacity_min",3000,"mAh","same stated charge/discharge condition","page 1 Specifications"),fact("nominal_voltage",3.6,"V","stated","page 1 Specifications"),fact("weight_typ",46.6,"g","typical","page 1 Specifications"),fact("diameter_max",18.5,"mm","with tube","page 1 Dimensions"),fact("height_max",65.2,"mm","with tube","page 1 Dimensions")], ["Typical-only datasheet; manufacturer directs purchaser to approval sheet. Cathode chemistry not stated."],"DATASHEET_CORE_SPEC_AND_CURVES"))

lg_rows = [
    ("E101A","NCMA","Graphite","POUCH",101.8,3.67,374),("E72B","NCMA","Graphite+SiO","POUCH",72.2,3.67,264),("E79","NCMA","Graphite","POUCH",78.0,3.69,287),
    ("JP3","NCM","Graphite","POUCH",62.4,3.68,229.6),("JF1","LFP","Graphite","POUCH",56.6,3.22,182.25),("JF2","LFP","Graphite","POUCH",159.2,3.0,509.4),("JH4","NCM","Graphite","POUCH",70.6,4.0,266),
    ("M50L","NCMA","Graphite","CYLINDRICAL_2170",4.93,3.69,18.2),("M52V","NCMA","Graphite","CYLINDRICAL_2170",5.07,3.69,18.73),
]
for n,(label,pos,neg,form,cap,volt,energy) in enumerate(lg_rows,3):
    cap_cond = "minimum at 25C, 0.3C" if label in {"E101A","E72B","E79"} else ("minimum at 0.5C" if label=="JP3" else ("nominal at 0.2C; reference value" if label in {"M50L","M52V"} else "minimum at 25C, 0.3C"))
    energy_cond = "minimum" if label == "JP3" else ("nominal" if label in {"JH4","M50L","M52V"} else "energy cell has no minimum/nominal qualifier")
    models.append(record(f"MF-{n:03d}","LG Energy Solution",label,"EXACT_MODEL",{"positive":pos,"negative":neg,"declared_system":f"{pos}/{neg}"},form,"CELL",["PROD-SRC-003#page=1&table=Cell_Solutions"],"2024",[
        fact("capacity",cap,"Ah",cap_cond,"page 1 model column"),fact("nominal_voltage",volt,"Vdc","stated nominal","page 1 model column"),fact("energy",energy,"Wh",energy_cond,"page 1 model column")],
        ["Sheet states data are reference cell-level values and may be modified by system specification/derating/cooling; it is not a full operating manual."],"ONE_PAGE_COMPARATIVE_CELL_SPEC"))

models.append(record("MF-012","Lishen","LR2170EA","EXACT_MODEL",{"positive":"LFP","negative":"C","declared_system":"LFP/C"},"CYLINDRICAL_21700","CELL",["PROD-SRC-007#Product Parameters"],"live page snapshot 2026-09-21",[
    fact("nominal_capacity",2.50,"Ah","0.2C","Product Parameters table"),fact("energy_density_gravimetric",143,"Wh/kg","stated","Product Parameters table"),fact("energy_density_volumetric",322,"Wh/L","stated","Product Parameters table"),fact("voltage_range","2.0-3.65","V","stated","Product Parameters table"),fact("standard_voltage",3.20,"V","stated","Product Parameters table"),fact("max_charge_rate",1,"C","stated maximum","Product Parameters table"),fact("max_discharge_rate",3,"C","stated maximum","Product Parameters table")], ["Public page does not state temperature, cycle-life condition, or detailed charge termination."],"MODEL_PAGE_PARAMETER_TABLE"))
models.append(record("MF-013","EVE Energy","LF280K","EXACT_MODEL",{"positive":"LFP","negative":"UNKNOWN","declared_system":"long-cycle lithium iron phosphate"},"UNKNOWN","CELL_IN_MARINE_SYSTEM",["PROD-SRC-008#article-body"],"2023-09-27",[
    fact("vessel_system_energy",559.104,"kWh","whole-vessel system for two named 28m cruise ships","article body"),fact("pack_ingress_protection","IP67",None,"project pack enclosure","article body")], ["Article identifies LF280K and LFP but does not provide cell dimensions, nominal voltage/capacity, charge limits, or confirm form factor."],"OFFICIAL_APPLICATION_CASE",gaps=["MODEL_SPECIFICATION_SHEET","FORM_FACTOR"]))
models.append(record("MF-014","BYD","Blade Battery","FAMILY",{"positive":"LFP","negative":"UNKNOWN","declared_system":"lithium iron phosphate"},"BLADE_CELL_IN_PACK","PACK_TECHNOLOGY_FAMILY",["PROD-SRC-009#article-body"],"2026 media page",[
    fact("warranty_duration",8,"years","specific Blade Battery warranty in Europe","article body"),fact("warranty_distance",250000,"km","specific Blade Battery warranty in Europe","article body"),fact("warranty_soh_floor",70,"%","guaranteed minimum state of health during warranty","article body")], ["Blade Battery is a technology/family label, not a complete cell model; warranty is market/product-policy evidence, not a cell operating limit."],"FAMILY_AND_WARRANTY_PAGE",gaps=["COMPLETE_CELL_MODEL","CELL_SPECIFICATION"] ))

tos_cells=[("20Ah cell",20,2.3,515),("23Ah cell",23,2.3,550),("26Ah cell",26,2.3,560),("20Ah-HP cell",20,2.3,545),("10Ah cell",10,2.4,510),("2.9Ah cell",2.9,2.4,150)]
for idx,(label,cap,volt,weight) in enumerate(tos_cells,15):
    models.append(record(f"MF-{idx:03d}","Toshiba",label,"FAMILY",{"positive":"UNKNOWN","negative":"LTO","declared_system":"SCiB lithium-ion; lithium titanium oxide negative electrode"},"UNKNOWN","CELL",["PROD-SRC-004#page=4&table=Cell"],"2025-04 catalog",[
        fact("rated_capacity",cap,"Ah","catalog stated; specifications not guaranteed","page 4 Cell table"),fact("nominal_voltage",volt,"V","catalog stated","page 4 Cell table"),fact("weight_approx",weight,"g","approximate","page 4 Cell table")], ["Capacity-based product name is retained as FAMILY, not EXACT_MODEL; positive-electrode chemistry is not stated. Values are subject to change and performance depends on usage conditions."],"CATALOGUE_CELL_ROW"))

tos_modules=[("Type3-20","FM01202CCA04A",40,1104),("Type3-20HP","FM01202CCE01A",39,1076),("Type3-23","FM01202CCB01A",45,1242),("Type3-26","FM01202CCF01A",51.1,1410),("Type4-23","FM01202CCB04A",45,1242)]
for idx,(prod,model,cap,energy) in enumerate(tos_modules,21):
    models.append(record(f"MF-{idx:03d}","Toshiba",model,"EXACT_MODEL",{"positive":"UNKNOWN","negative":"LTO","declared_system":"SCiB lithium-ion; LTO negative electrode at family level"},"MODULE","MODULE",["PROD-SRC-004#page=4&table=Module_Pack"],"2025-04 catalog",[
        fact("product_name",prod,None,"catalog product name","page 4 module table"),fact("rated_capacity",cap,"Ah","2P12S industrial battery module","page 4 module table"),fact("nominal_energy",energy,"Wh","2P12S industrial battery module","page 4 module table")], ["Catalogue specification is not guaranteed; detailed cell chemistry and full operating manual are absent."],"CATALOGUE_MODULE_ROW"))

sam_rows=[("M10023","CYLINDRICAL_21700",2.3,2.0,"84-112",20,-10,60,4000),("M5194","PRISMATIC_94Ah",4.84,4.84,"44.8-58.1",40,-10,50,5000)]
for idx,(label,form,rated,usable,vrange,weight,tmin,tmax,cycles) in enumerate(sam_rows,26):
    models.append(record(f"MF-{idx:03d}","Samsung SDI",label,"EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"lithium-ion chemistry not stated for model"},form,"MODULE_WITH_BMS",["PROD-SRC-005#page=5&table=100V_48V_Solution"],"2016 brochure",[
        fact("energy_rated",rated,"kWh","module","page 5 specification table"),fact("energy_usable",usable,"kWh","module","page 5 specification table"),fact("operating_voltage_range",vrange,"V","module","page 5 specification table"),fact("weight",weight,"kg","module","page 5 specification table"),fact("operating_temperature_min",tmin,"°C","module","page 5 specification table"),fact("operating_temperature_max",tmax,"°C","module","page 5 specification table"),fact("life_cycle",cycles,"cycles","25°C, EOL 80%","page 5 footnote")], ["Brochure is dated 2016; current availability and model-level chemistry are not established."],"BROCHURE_MODULE_SPEC"))

catl=[("M20280-E",17.9,"MODULE"),("M20280-P",17.9,"MODULE"),("R1720280-E",304.6,"RACK"),("R1720280-P",304.6,"RACK")]
for idx,(label,energy,level) in enumerate(catl,28):
    duration = "h>=2" if label.endswith("-E") else "1<=h<2"
    dimension = "950×516×234" if level == "MODULE" else "1200×1000×2300"
    models.append(record(f"MF-{idx:03d}","CATL",label,"EXACT_MODEL",{"positive":"LFP","negative":"UNKNOWN","declared_system":"280Ah LFP cell used by product table"},"PRISMATIC_CELL_BASED",level,["PROD-SRC-006#page=2&table=Air_Cooling_Solution"],"2020-10 URL/version context",[
        fact("duration",duration,"h","product-table duration class","page 2 Air Cooling Solution table"),fact("nominal_capacity",energy,"kWh","air-cooled product table","page 2 Air Cooling Solution table"),fact("dimension",dimension,"mm","L×W×H","page 2 Air Cooling Solution table"),fact("cooling","Air",None,"stated cooling method","page 2 Air Cooling Solution table")], ["Brochure supplies product-table data but not complete operating/installation limits; current availability not established."],"BROCHURE_PRODUCT_ROW"))
models.append(record("MF-032","CATL","280Ah LFP cell","FAMILY",{"positive":"LFP","negative":"UNKNOWN","declared_system":"LFP"},"PRISMATIC","CELL",["PROD-SRC-006#page=2&table=Air_Cooling_Solution"],"2020-10 URL/version context",[
    fact("cell_capacity",280,"Ah","air-cooled product table","page 2 table"),fact("dimension","173.9×71.7×207.2","mm","L×W×H","page 2 table"),fact("cycle_life_at_0.5P",8000,"cycles","25°C, 70% retention; 0.5P charge/0.5P discharge","page 2 table"),fact("cycle_life_at_1P",8000,"cycles","25°C, 70% retention; 1P charge/1P discharge","page 2 table")], ["Capacity label is not a complete cell model; use only as family/product-row evidence."],"CATALOGUE_CELL_ROW"))

models.append(record("MF-033","E-One Moli Energy / Molicel","INR-21700-P42A","EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"lithium-ion; model-level chemistry not stated in reviewed evidence"},"UNKNOWN","CELL",["PROD-SRC-R01#page=1"],"Product data sheet 1.7",[
    fact("energy_typ",15.5,"Wh","typical","page 1 characteristics"),fact("energy_min",14.7,"Wh","minimum","page 1 characteristics"),fact("dc_impedance",16,"mΩ","measured at 10A for 1s","page 1 characteristics"),fact("diameter_max",21.55,"mm","maximum","page 1 characteristics"),fact("height_max",70.15,"mm","maximum","page 1 characteristics")], ["Reference-only, subject to change; retained use restriction bars RAG/training/redistribution."],"DATASHEET_BOUNDED_FACTS",status="BOUNDED_FACT_REVIEW_ONLY_NOT_RAG"))
models.append(record("MF-034","E-One Moli Energy / Molicel","INR21700-P45B","EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"lithium-ion; model-level chemistry not stated in reviewed evidence"},"UNKNOWN","CELL",["PROD-SRC-R02#page=18&table=6"],"SDS FSSF00058BJ / January 2025",[
    fact("nominal_voltage",3.60,"V","Table 6","page 18 table 6"),fact("capacity_typ",4.40,"Ah","Table 6 typical","page 18 table 6"),fact("capacity_min",4.35,"Ah","Table 6 minimum","page 18 table 6"),fact("energy_typ",15.84,"Wh","Table 6","page 18 table 6"),fact("weight",70.0,"g","Table 6","page 18 table 6")], ["SDS table is not a full product operating specification or proof of availability; retained restriction bars RAG/training/redistribution."],"SDS_MODEL_TABLE_ROW",status="BOUNDED_FACT_REVIEW_ONLY_NOT_RAG"))

models.append(record("MF-035","Murata","US18650VTC5A","EXACT_MODEL",{"positive":"NCA","negative":"Gr, SiO","declared_system":"NCA / Gr, SiO"},"CYLINDRICAL","CELL",["PROD-SRC-010#printed_page=89&pdf_page=91&table=Cylindrical_Type_Lithium_Ion"],"K70E catalog; Jan. 6, 2021 page marker",[
    fact("nominal_capacity",2600,"mAh","catalogue row","printed page 89 (PDF page 91) table"),fact("nominal_voltage",3.6,"V","catalogue row","printed page 89 (PDF page 91) table"),fact("weight",47.1,"g","catalogue row","printed page 89 (PDF page 91) table"),fact("diameter",18,"mm","catalogue row","printed page 89 (PDF page 91) table"),fact("height",65,"mm","catalogue row","printed page 89 (PDF page 91) table"),fact("continuous_max_discharge_current",35,"A","catalogue row","printed page 89 (PDF page 91) table")], ["Catalogue row is not a full charge/operation specification; current availability requires confirmation."],"CATALOGUE_MODEL_ROW"))
models.append(record("MF-036","Murata","US21700VTC6A","EXACT_MODEL",{"positive":"NCA","negative":"Gr, SiO","declared_system":"NCA / Gr, SiO"},"CYLINDRICAL","CELL",["PROD-SRC-010#printed_page=89&pdf_page=91&table=Cylindrical_Type_Lithium_Ion"],"K70E catalog; Jan. 6, 2021 page marker",[
    fact("nominal_capacity",4100,"mAh","catalogue row","printed page 89 (PDF page 91) table"),fact("nominal_voltage",3.6,"V","catalogue row","printed page 89 (PDF page 91) table"),fact("weight",67.5,"g","catalogue row","printed page 89 (PDF page 91) table"),fact("diameter",21,"mm","catalogue row","printed page 89 (PDF page 91) table"),fact("height",70,"mm","catalogue row","printed page 89 (PDF page 91) table"),fact("continuous_max_discharge_current",40,"A","catalogue row","printed page 89 (PDF page 91) table")], ["Catalogue row is not a full charge/operation specification; current availability requires confirmation."],"CATALOGUE_MODEL_ROW"))

pan_prismatic=[("MF-044","CGA103450A",1950,3.7,33.80,10.50,48.75,39.2),("MF-045","UF103450PN",2000,3.7,33.80,10.50,48.80,38.5)]
for rid,label,cap,volt,width,thick,height,weight in pan_prismatic:
    models.append(record(rid,"Panasonic Energy",label,"EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"lithium-ion chemistry not stated for model"},"PRISMATIC","CELL",["PROD-SRC-016#printed_pages=36-37&pdf_page=19&table=PRISMATIC_SINGLE_CELL"],"2026 catalog metadata (created 2026-04-21; modified 2026-04-27)",[
        fact("typical_capacity",cap,"mAh","4.20V charge","printed pages 36-37 (PDF page 19) table and footnote"),fact("nominal_voltage",volt,"V","catalog row","printed pages 36-37 (PDF page 19) table"),fact("width",width,"mm","catalog row","printed pages 36-37 (PDF page 19) table"),fact("thickness",thick,"mm","catalog row","printed pages 36-37 (PDF page 19) table"),fact("total_height",height,"mm","catalog row; asterisked height includes bottom lead plate when shown","printed pages 36-37 (PDF page 19) table and note"),fact("weight",weight,"g","catalog row","printed pages 36-37 (PDF page 19) table")], ["The 2026 catalog identifies an exact prismatic lithium-ion model but does not declare its cathode/anode chemistry or full operating limits; values are reference catalog data and product approval documentation remains controlling."],"CURRENT_CATALOG_EXACT_PRISMATIC_CELL_ROW"))

models.append(record("MF-040","Saft","7s2p MP 176065 BLF","EXACT_MODEL",{"positive":"Lithium cobalt oxide-based","negative":"Graphite-based","declared_system":"LCO / graphite"},"BATTERY_PACK","PACK_WITH_PROTECTION_CIRCUIT",["PROD-SRC-013#pages=1-2"],"Doc. 54063-2-0212 / February 2012",[
    fact("nominal_voltage",25.20,"V","2.8A rate at 20°C","page 1 Electrical characteristics"),fact("typical_capacity",12.2,"Ah","under 2.8A at 20°C, 19V cut-off","page 1 Electrical characteristics"),fact("max_recommended_charge_current",10.0,"A","at 20°C","page 1 Operating conditions"),fact("charge_voltage",28.70,"V","±1%","page 1 Operating conditions"),fact("max_recommended_continuous_discharge_current",13,"A","at 20°C","page 1 Operating conditions"),fact("discharge_cutoff_voltage",19,"V","stated","page 1 Operating conditions")], ["Historical 2012 sheet; information is subject to change and contractual only after written Saft confirmation."],"PACK_DATASHEET_WITH_CHEMISTRY_AND_LIMITS"))

models.append(record("MF-041","GS Yuasa","LIM50EN-13","EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"lithium-ion"},"MODULE","MODULE_WITH_MONITORING_PROTECTION",["PROD-SRC-015#product-profile"],"2018-01-16 official release",[
    fact("cell_count",13,"cells","module","official release product profile"),fact("rated_capacity",47.5,"Ah","module; parallel expansion up to 1520Ah","official release product profile"),fact("nominal_voltage",48.1,"V","module","official release product profile"),fact("charge_temperature_range","-20 to 50","°C","charge current must be controlled by module temperature","official release footnote"),fact("discharge_temperature_range","-20 to 50","°C","module","official release product profile"),fact("mass_max",32.5,"kg","maximum","official release product profile")], ["FY2017 presentation page 25 places the LIM/LIM50EN family label in a Gr/LMO roadmap area, but it does not explicitly link that family chemistry to exact module LIM50EN-13; family-level chemistry is therefore not assigned to this exact module."],"EXACT_MODULE_PROFILE_WITH_UNLINKED_FAMILY_CHEMISTRY_REFERENCE",gaps=["EXACT_MODULE_CHEMISTRY_LINK"]))

models.append(record("MF-042","Bosch Professional","1 600 A01 6GT","EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"Li-ion battery packs"},"BATTERY_PACK_STARTER_SET","PACK_AND_CHARGER_COMPATIBILITY_SET",["PROD-SRC-014#product-page"],"live official product page snapshot 2026-09-21",[
    fact("included_battery","ProCORE18V 8.0Ah",None,"two battery packs included; battery order number 1 600 A01 6GM","Included in this variant"),fact("included_charger","GAL 18V-160 C Professional",None,"charger order number 1 600 A01 9SB","Included in this variant"),fact("charge_to_50_percent",15,"min","Power Boost mode","product highlights"),fact("charge_to_80_percent",26,"min","Power Boost mode","product highlights")], ["Compatibility applies to the named official starter set and Bosch Professional 18V System/AMPShare statement; cell chemistry and cell model are not disclosed."],"EXACT_PACK_CHARGER_COMPATIBILITY"))

models.append(record("MF-043","Murata","CR2032","EXACT_MODEL",{"positive":"UNKNOWN","negative":"UNKNOWN","declared_system":"Coin Manganese Dioxide Lithium Batteries; primary battery"},"COIN","CELL",["PROD-SRC-010#printed_page=93&pdf_page=95&table=Coin_Manganese_Dioxide_Lithium_Batteries"],"K70E catalog; Jan. 6, 2021 page marker",[
    fact("nominal_voltage",3,"V","primary coin battery catalogue row","printed page 93 (PDF page 95) table"),fact("nominal_capacity",220,"mAh","duration until 2.0V at nominal discharge current, 23°C","printed page 93 (PDF page 95) table and note"),fact("standard_discharge_current",0.2,"mA","at 23°C for nominal-capacity definition","printed page 93 (PDF page 95) table and note"),fact("diameter",20.0,"mm","catalogue row","printed page 93 (PDF page 95) table"),fact("height",3.2,"mm","catalogue row","printed page 93 (PDF page 95) table"),fact("weight",3.1,"g","catalogue row","printed page 93 (PDF page 95) table")], ["Primary, non-rechargeable chemistry: rechargeable lithium-ion charge/discharge conditions and chargers must not be applied. Catalogue states data are reference-only and not guaranteed."],"PRIMARY_COIN_CATALOGUE_MODEL_ROW"))

# form_factor describes the product record itself. Internal cell form, when explicitly stated,
# is kept separately for system-level records so it cannot be mistaken for module/rack geometry.
system_cell_forms = {
    "MF-014": "BLADE_CELL",
    "MF-021": "UNKNOWN", "MF-022": "UNKNOWN", "MF-023": "UNKNOWN",
    "MF-024": "UNKNOWN", "MF-025": "UNKNOWN",
    "MF-026": "CYLINDRICAL_21700", "MF-027": "PRISMATIC_94Ah",
    "MF-028": "PRISMATIC", "MF-029": "PRISMATIC",
    "MF-030": "PRISMATIC", "MF-031": "PRISMATIC",
    "MF-040": "UNKNOWN", "MF-041": "UNKNOWN", "MF-042": "UNKNOWN",
}
for model in models:
    if model["record_id"] in system_cell_forms:
        model["contained_cell_form_factor"] = system_cell_forms[model["record_id"]]
        model["form_factor"] = "NOT_APPLICABLE_SYSTEM_LEVEL"

gaps = [
    {"gap_id":"G-002","dimension":"CHEMISTRY","target":"model-specific LMO","status":"OPEN","reason":"GS Yuasa roadmap places LIM/LIM50EN family labeling in a Gr/LMO area, but does not explicitly link exact module LIM50EN-13 to that chemistry; no exact-model assignment is made."},
    {"gap_id":"G-004","dimension":"FORM_FACTOR","target":"A123 AMP20 pouch","status":"OPEN","reason":"No directly accessible current official small source found; third-party mirrors were not accepted."},
    {"gap_id":"G-005","dimension":"MANUFACTURER","target":"A123 ANR26650M1-B","status":"OPEN","reason":"No directly accessible current official small source found; third-party mirrors were not accepted."},
    {"gap_id":"G-006","dimension":"MANUFACTURER","target":"Samsung exact current cell model","status":"OPEN","reason":"Official brochure provided exact module models and internal cell form/capacity, not a complete cell model designation."},
    {"gap_id":"G-007","dimension":"MANUFACTURER","target":"BYD complete cell model","status":"OPEN","reason":"Official source uses Blade Battery technology/family label; no complete cell model designation."},
    {"gap_id":"G-008","dimension":"MANUFACTURER","target":"EVE LF280K operating specification","status":"OPEN","reason":"Official application case confirms name and LFP use but lacks model-level electrical/dimensional limits."},
    {"gap_id":"G-010","dimension":"USE_RIGHTS","target":"Molicel reusable RAG corpus","status":"BLOCKED","reason":"Existing exact-version decision permits bounded review only and retains RAG/training/redistribution restrictions."},
    {"gap_id":"G-011","dimension":"PANASONIC","target":"model-level LCO declaration for current prismatic cells","status":"DEGRADED","reason":"The 2026 official catalog supplies exact prismatic models but does not declare LCO at model level. The earlier 2018 URL returned HTML and remains an excluded failed attempt."},
    {"gap_id":"G-012","dimension":"CURRENTNESS","target":"Saft LCO pack and GS Yuasa LMO module","status":"DEGRADED","reason":"Official exact-model evidence is historical (2012 and 2017/2018); present availability requires manufacturer confirmation."},
]

write_jsonl("SEARCH_TARGETS.jsonl", targets)
write_jsonl("SOURCE_REGISTER.jsonl", raw_sources + reused_sources)
write_jsonl("MODEL_FACTS.jsonl", models)
write_jsonl("OPEN_GAPS.jsonl", gaps)

checks=[]
ids=[m["record_id"] for m in models]
checks.append({"check":"unique_record_id","status":"PASS" if len(ids)==len(set(ids)) else "FAIL","count":len(ids)})
canon=[m["canonical_identity"] for m in models]
checks.append({"check":"unique_canonical_identity","status":"PASS" if len(canon)==len(set(canon)) else "FAIL","count":len(canon)})
required={"record_id","manufacturer","model_label","identity_kind","canonical_identity","aliases","chemistry","form_factor","system_level","source_refs","document_version","facts","conditions_and_limits","content_depth","use_status","remaining_gaps"}
bad=[m["record_id"] for m in models if not required.issubset(m)]
checks.append({"check":"required_fields","status":"PASS" if not bad else "FAIL","failures":bad})
badfacts=[m["record_id"] for m in models if any(not {"field","value","unit","qualifier","condition","evidence_locator"}.issubset(f) for f in m["facts"])]
checks.append({"check":"fact_contract","status":"PASS" if not badfacts else "FAIL","failures":badfacts})
src_ids={s["source_id"] for s in raw_sources+reused_sources}
badrefs=[m["record_id"] for m in models if any(ref.split("#")[0] not in src_ids for ref in m["source_refs"])]
checks.append({"check":"source_references_resolve","status":"PASS" if not badrefs else "FAIL","failures":badrefs})
failed_src_ids={s["source_id"] for s in raw_sources if not s["status"].startswith("ACQUIRED")}
failed_refs=[m["record_id"] for m in models if any(ref.split("#")[0] in failed_src_ids for ref in m["source_refs"])]
checks.append({"check":"facts_do_not_reference_failed_sources","status":"PASS" if not failed_refs else "FAIL","failures":failed_refs,"failed_source_ids":sorted(failed_src_ids)})
checks.append({"check":"pdf_signature_and_parse","status":"PASS" if pdf_validation["status"]=="PASS" else "FAIL","validated_pdf_count":sum(x["status"]=="PASS" for x in pdf_validation["pdf_candidates"]),"excluded_non_pdf_count":sum(x["status"]=="EXPECTED_EXCLUDED_NON_PDF" for x in pdf_validation["pdf_candidates"])})
badfiles=[s["source_id"] for s in raw_sources if s["status"].startswith("ACQUIRED") and (not pathlib.Path(s["local_path"]).exists() or hashlib.sha256(pathlib.Path(s["local_path"]).read_bytes()).hexdigest()!=s["sha256"])]
checks.append({"check":"acquired_source_hashes","status":"PASS" if not badfiles else "FAIL","failures":badfiles,"scope":"newly acquired PRODUCTS sources only"})
checks.append({"check":"identity_kind_not_inferred_from_capacity_label","status":"PASS" if all(m["identity_kind"]!="EXACT_MODEL" for m in models if m["manufacturer"]=="Toshiba" and m["model_label"].endswith("cell")) else "FAIL"})
system_levels={"MODULE","MODULE_WITH_BMS","PACK_TECHNOLOGY_FAMILY","PACK_WITH_PROTECTION_CIRCUIT","MODULE_WITH_MONITORING_PROTECTION","PACK_AND_CHARGER_COMPATIBILITY_SET","RACK"}
bad_system_forms=[m["record_id"] for m in models if m["system_level"] in system_levels and m["form_factor"]!="NOT_APPLICABLE_SYSTEM_LEVEL"]
checks.append({"check":"system_form_factor_semantics","status":"PASS" if not bad_system_forms else "FAIL","failures":bad_system_forms})
serialized_models="\n".join(json.dumps(m,ensure_ascii=False) for m in models)
checks.append({"check":"utf8_symbols_intact","status":"PASS" if "\ufffd" not in serialized_models else "FAIL","forbidden_codepoint":"U+FFFD replacement character"})
result={"status":"PASSED" if all(c["status"]=="PASS" for c in checks) else "FAILED","scope":"local schema, identity, reference and hash checks only; not server/RAG/model acceptance","checks":checks,"counts":{"targets":len(targets),"sources":len(raw_sources)+len(reused_sources),"new_sources_acquired":sum(s["status"].startswith("ACQUIRED") for s in raw_sources),"model_records":len(models),"exact_models":sum(m["identity_kind"]=="EXACT_MODEL" for m in models),"families":sum(m["identity_kind"]=="FAMILY" for m in models),"open_gaps":len(gaps)}}
(ROOT/"CHECK_RESULTS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(result["counts"]))

if result["status"] != "PASSED":
    raise SystemExit(1)
