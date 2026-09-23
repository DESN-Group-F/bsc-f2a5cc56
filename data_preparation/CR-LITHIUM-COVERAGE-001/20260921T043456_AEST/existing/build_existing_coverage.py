from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


RUN = Path(r"E:\desn 2000\bsc\data_preparation\CR-LITHIUM-COVERAGE-001\20260921T043456_AEST")
OUT = RUN / "existing"
READY = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
CANDIDATE = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")

MIN_FIELDS = {
    "record_id", "manufacturer", "model_label", "identity_kind", "canonical_identity",
    "aliases", "chemistry", "form_factor", "system_level", "source_refs",
    "document_version", "facts", "conditions_and_limits", "content_depth",
    "use_status", "remaining_gaps",
}


def load_jsonl(path: Path):
    with path.open("r", encoding="utf-8-sig") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def ref(path: Path, fragment: str) -> str:
    return f"{path}#{fragment}"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def source_index():
    source_path = READY / "SOURCE_OBJECTS.jsonl"
    build_path = READY / "BUILD_USE_INDEX.jsonl"
    sources = {o["file_id"]: o for o in load_jsonl(source_path)}
    uses = {o["file_id"]: o for o in load_jsonl(build_path)}
    return sources, uses


def make_record(**kwargs):
    rec = {
        "record_id": kwargs["record_id"],
        "manufacturer": kwargs.get("manufacturer", "UNKNOWN"),
        "model_label": kwargs["model_label"],
        "identity_kind": kwargs["identity_kind"],
        "canonical_identity": kwargs["canonical_identity"],
        "aliases": kwargs.get("aliases", []),
        "chemistry": kwargs.get("chemistry", "UNKNOWN"),
        "form_factor": kwargs.get("form_factor", "UNKNOWN"),
        "system_level": kwargs.get("system_level", "CELL"),
        "source_refs": kwargs["source_refs"],
        "document_version": kwargs.get("document_version", "UNKNOWN"),
        "facts": kwargs.get("facts", []),
        "conditions_and_limits": kwargs.get("conditions_and_limits", []),
        "content_depth": kwargs["content_depth"],
        "use_status": kwargs["use_status"],
        "remaining_gaps": kwargs.get("remaining_gaps", []),
    }
    rec.update(kwargs.get("extra", {}))
    return rec


def sds_fact_fields(quantities):
    by_unit = defaultdict(list)
    for q in quantities:
        by_unit[q.get("unit", "UNKNOWN")].append(q)
    result = []
    labels = {
        "V": ["nominal_voltage"],
        "Ah": ["typical_capacity", "minimum_capacity"],
        "Wh": ["typical_energy", "minimum_energy"],
        "g": ["equivalent_lithium_content", "cell_or_pack_weight"],
    }
    continuation_minimum_energy = set(by_unit) == {"Wh"} and len(by_unit["Wh"]) == 1
    for unit in ("V", "Ah", "Wh", "g"):
        for idx, q in enumerate(by_unit.get(unit, [])):
            names = labels[unit]
            if unit == "Wh" and continuation_minimum_energy:
                field = "minimum_energy"
            else:
                field = names[idx] if idx < len(names) else f"unresolved_{unit}_{idx + 1}"
            result.append({
                "field": field,
                "value": q.get("value_text", q.get("value", "UNKNOWN")),
                "unit": unit,
                "comparator_or_range": "EXACT_AS_TABLE_CELL",
                "condition": q.get("binding", "Table 6 column context"),
            })
    return result


def molicel_records(sources, uses):
    review_path = CANDIDATE / "review_restricted" / "REVIEW_RESULTS.jsonl"
    rows = [o for o in load_jsonl(review_path) if o.get("source_id") == "SRC-038"]
    sds = [o for o in rows if o.get("semantic_role") == "SDS_MODEL_SPECIFICATION_TABLE_ROW"]
    datasheet = [o for o in rows if o.get("semantic_role") == "P42A_V1_7_DATASHEET_PARAMETER"]
    grouped = defaultdict(list)
    for row in sds:
        label = row["source_entity_and_version"]["model"]
        canonical = "INR-21700-P42A" if label == "INR21700-P42A" else label
        grouped[canonical].append(row)
    grouped["INR-21700-P42A"].extend(datasheet)

    records = []
    for canonical, model_rows in sorted(grouped.items()):
        labels = sorted({r["source_entity_and_version"].get("model", canonical) for r in model_rows})
        identity_kind = "FAMILY" if "/" in canonical else "EXACT_MODEL"
        facts = []
        source_refs = []
        limits = []
        versions = []
        for row in model_rows:
            source_refs.extend(row.get("evidence_refs", []))
            limits.extend(row.get("conditions_and_exceptions", []))
            entity = row.get("source_entity_and_version", {})
            versions.append(entity.get("document_version") or entity.get("registered_document_version_id") or "UNKNOWN")
            if row["semantic_role"] == "SDS_MODEL_SPECIFICATION_TABLE_ROW":
                row_facts = sds_fact_fields(row.get("quantity_bindings", []))
            else:
                row_facts = []
                for q in row.get("quantity_bindings", []):
                    row_facts.append({
                        "field": q.get("entity", "UNKNOWN"),
                        "value": q.get("value_text", "UNKNOWN"),
                        "unit": q.get("unit", "UNKNOWN"),
                        "comparator_or_range": "EXACT_AS_SOURCE",
                        "condition": q.get("qualifier") or "SOURCE_CONTEXT",
                    })
            for fact in row_facts:
                fact["evidence_location"] = f"{review_path}#fact_id={row['fact_id']}"
                facts.append(fact)
        # Deduplicate facts created by SDS continuation rows while retaining page-bound evidence.
        seen = set()
        unique_facts = []
        for fact in facts:
            key = (fact["field"], str(fact["value"]), fact["unit"], fact["condition"])
            if key not in seen:
                seen.add(key)
                unique_facts.append(fact)
        is_p42a = canonical == "INR-21700-P42A"
        aliases = sorted(set(labels + (["INR21700-P42A"] if is_p42a else [])) - {canonical})
        records.append(make_record(
            record_id="EXIST-MOLI-" + re.sub(r"[^A-Z0-9]+", "-", canonical.upper()).strip("-"),
            manufacturer="E-One Moli Energy / Molicel",
            model_label=canonical,
            identity_kind=identity_kind,
            canonical_identity=canonical,
            aliases=aliases,
            chemistry="UNKNOWN",
            form_factor="UNKNOWN",
            system_level="UNKNOWN" if canonical.startswith(("MCR", "ME")) else "CELL",
            source_refs=sorted(set(source_refs)),
            document_version="; ".join(sorted(set(versions))),
            facts=unique_facts,
            conditions_and_limits=sorted(set(limits + [
                "Existing manufacturer-derived review is reused only as source-bound fact verification.",
                "Do not infer chemistry or form factor from the model prefix or dimensions.",
                "NOT_ALLOWED_FOR_LOCAL_RAG remains unchanged; no restricted source text is copied into a RAG corpus.",
            ])),
            content_depth="PRODUCT_DATASHEET_PLUS_SDS_ROW" if is_p42a else "SDS_MODEL_TABLE_ROW_ONLY",
            use_status="NOT_ALLOWED_FOR_LOCAL_RAG__FACT_INVENTORY_ONLY",
            remaining_gaps=(
                ["chemistry not explicitly established", "form factor not explicitly established", "current availability not established"]
                if identity_kind == "EXACT_MODEL" else
                ["slash-group may represent multiple variants; do not count as an exact model", "variant-level identity unresolved", "chemistry unknown", "form factor unknown"]
            ),
            extra={
                "alias_basis": "Same SRC-038 manufacturer evidence set and matching P42A token" if is_p42a else "NO_ADDITIONAL_ALIAS_ASSERTED",
                "review_rows_merged": sorted({r["fact_id"] for r in model_rows}),
            },
        ))
    return records


def content_records(sources, uses):
    content_index_path = READY / "documents" / "CONTENT_INDEX.jsonl"
    content_index = list(load_jsonl(content_index_path))
    locators = defaultdict(set)
    artifact_paths = {}
    for item in content_index:
        locators[item["file_id"]].add(item["locator"])
        artifact_paths[item["file_id"]] = Path(item["artifact_ref"].split("#", 1)[0])
    calce_id = "FILE-014-3c2dd9d0c5f4-d765af"
    calce_path = artifact_paths[calce_id]
    segments = {o["locator"]: o for o in load_jsonl(calce_path)}
    build_status = uses[calce_id]["build_use_status"]
    src_ref = ref(READY / "SOURCE_OBJECTS.jsonl", f"file_id={calce_id}")
    index_ref = ref(content_index_path, f"file_id={calce_id}")

    definitions = [
        ("INR 18650-20R Battery", "EXACT_MODEL", "INR 18650-20R", "LiNiMnCo/Graphite", "CYLINDRICAL", "segment:89", [("rated_capacity", "2000", "mAh", "segment:93"), ("cell_chemistry", "LiNiMnCo/Graphite", "TEXT", "segment:95"), ("weight_without_safety_circuit", "45", "g", "segment:97"), ("diameter", "18.33 +/- 0.07", "mm", "segment:99"), ("length", "64.85 +/- 0.15", "mm", "segment:101")]),
        ("A123 Battery", "FAMILY", "CALCE A123 battery", "LiFePO4", "CYLINDRICAL", "segment:170", [("rated_capacity", "1100", "mAh", "segment:174"), ("cell_chemistry", "LiFePO4", "TEXT", "segment:176"), ("diameter", "25.4", "mm", "segment:178"), ("length", "65", "mm", "segment:180")]),
        ("CS2 Battery", "SERIES", "CALCE CS2", "LiCoO2 cathode; trace manganese reported by EDS", "PRISMATIC", "segment:217", [("rated_capacity", "1100", "mAh", "segment:221"), ("cell_chemistry", "LiCoO2 cathode; trace manganese by EDS", "TEXT", "segment:223"), ("dimensions", "5.4 x 33.6 x 50.6", "mm", "segment:227")]),
        ("CX2 Battery", "SERIES", "CALCE CX2", "LiCoO2 cathode; trace manganese reported by EDS", "PRISMATIC", "segment:257", [("rated_capacity", "1350", "mAh", "segment:261"), ("cell_chemistry", "LiCoO2 cathode; trace manganese by EDS", "TEXT", "segment:263"), ("dimensions", "6.6 x 33.8 x 50", "mm", "segment:267")]),
        ("PL Sample", "SERIES", "CALCE PL", "Graphite/LiCoO2", "POUCH", "segment:293", [("rated_capacity", "1500", "mAh", "segment:297"), ("cell_chemistry", "Graphite/LiCoO2", "TEXT", "segment:299"), ("dimensions", "3.4 x 84.4 x 50.1", "mm", "segment:303")]),
    ]
    records = []
    for label, kind, canonical, chemistry, form, identity_locator, facts in definitions:
        records.append(make_record(
            record_id="EXIST-CALCE-" + re.sub(r"[^A-Z0-9]+", "-", canonical.upper()).strip("-"),
            manufacturer="UNKNOWN" if label != "A123 Battery" else "A123 (brand-level label only)",
            model_label=label,
            identity_kind=kind,
            canonical_identity=canonical,
            chemistry=chemistry,
            form_factor=form,
            system_level="CELL",
            source_refs=[src_ref, index_ref, ref(calce_path, identity_locator)],
            document_version=sources[calce_id]["document_version_id"],
            facts=[{
                "field": field, "value": value, "unit": unit,
                "comparator_or_range": (
                    "SOURCE_BOUND_EQUIVALENT_REPRESENTATION"
                    if canonical == "INR 18650-20R" and field in {"diameter", "length"}
                    else "SOURCE_BOUND_PARAPHRASE"
                    if canonical in {"CALCE CS2", "CALCE CX2"} and field == "cell_chemistry"
                    else "EXACT_AS_SOURCE"
                ),
                "condition": "CALCE battery description",
                "evidence_location": ref(calce_path, locator),
            } for field, value, unit, locator in facts],
            conditions_and_limits=[
                "Source is a CALCE research-data landing description, not a manufacturer datasheet.",
                "NOT_SELECTED_FOR_MINIMUM_BUILD_SET is preserved; this inventory does not upgrade build-use permission.",
            ],
            content_depth="RESEARCH_LANDING_PRODUCT_OR_SERIES_DESCRIPTION",
            use_status=build_status,
            remaining_gaps=(
                ["manufacturer not stated in the captured description", "manufacturer datasheet/version absent", "alias verification absent"]
                if kind == "EXACT_MODEL" else
                ["complete commercial model not stated", "manufacturer datasheet/version absent", "series/sample IDs must not be counted as product models"]
            ),
        ))

    # Explicit CALCE experimental sample IDs. They remain attached to the research series, never product models.
    text = "\n".join(o.get("text", "") for o in segments.values())
    raw_samples = set(re.findall(r"\b(?:CS2[_-]\d+|CX2[_-]\d+|PL\s+\d+)\b", text, flags=re.I))
    samples = {}
    for raw in sorted(raw_samples):
        norm = re.sub(r"\s+", "-", raw.upper()).replace("_", "-")
        samples.setdefault(norm, raw)
    for norm, raw in sorted(samples.items(), key=lambda x: (re.sub(r"\d+", "", x[0]), int(re.search(r"\d+", x[0]).group()))):
        series = "CALCE CS2" if norm.startswith("CS2") else "CALCE CX2" if norm.startswith("CX2") else "CALCE PL"
        records.append(make_record(
            record_id="EXIST-CALCE-SAMPLE-" + norm,
            manufacturer="UNKNOWN",
            model_label=raw,
            identity_kind="SAMPLE_ID",
            canonical_identity=f"{series}/{norm}",
            source_refs=[src_ref, index_ref, ref(calce_path, "sample-id-occurrence")],
            document_version=sources[calce_id]["document_version_id"],
            facts=[],
            conditions_and_limits=["Experimental sample identifier extracted from the CALCE captured description; not a commercial model."],
            content_depth="RESEARCH_SAMPLE_IDENTIFIER",
            use_status=build_status,
            remaining_gaps=["sample-specific product model and manufacturer not established"],
            extra={"parent_series": series},
        ))

    archive_id = "FILE-015-abdc6da9a59e-5ae7f3"
    archive_path = artifact_paths[archive_id]
    archive_segments = {o["locator"]: o for o in load_jsonl(archive_path)}
    archive_defs = [
        ("segment:18", "HNEI commercial 18650 variability cohort", "graphite / blended NMC+LCO positive", "CYLINDRICAL", "CELL"),
        ("segment:20", "238 commercial 502030 lifetime cohort", "graphite / NMC positive", "POUCH", "CELL"),
        ("segment:22", "ORNL indentation thermal-runaway cohort", "mixed NMC, LCO, LFP, NMC-LMO, LMO-LNO", "POUCH", "CELL"),
        ("segment:24", "Oxford Battery Degradation Dataset 1 cohort", "LCO", "POUCH", "CELL"),
        ("segment:26", "Sandia commercial degradation cohort", "mixed NCA, NMC, LFP", "CYLINDRICAL", "CELL"),
        ("segment:27", "Sandia indentation thermal-runaway cohort", "mixed NMC-LMO, LMO-LNO, NMC, LFP, LCO", "POUCH", "CELL"),
        ("segment:29", "Degradation-Safety Analytics Part I cohort", "graphite / NCA positive", "CYLINDRICAL", "CELL"),
        ("segment:30", "Degradation-Safety Analytics Part III cohort", "graphite / NCA positive", "POUCH", "MIXED_CELL_MODULE"),
        ("segment:32", "University of Michigan expansion cohort", "graphite / NMC111 positive", "UNKNOWN", "CELL"),
        ("segment:33", "University of Michigan formation cohort", "graphite / NMC positive", "UNKNOWN", "CELL"),
    ]
    for locator, label, chemistry, form, level in archive_defs:
        source_text = archive_segments[locator]["text"]
        count_match = re.search(r"\b(\d+)\s+(?:commercial\s+)?(?:[0-9]+\s+)?(?:pouch\s+)?cells\b", source_text, flags=re.I)
        facts = []
        if count_match:
            facts.append({
                "field": "reported_cell_count", "value": count_match.group(1), "unit": "cells",
                "comparator_or_range": "EXACT_AS_SOURCE", "condition": "study cohort summary",
                "evidence_location": ref(archive_path, locator),
            })
        records.append(make_record(
            record_id="EXIST-ARCHIVE-" + locator.replace(":", "-").upper(),
            manufacturer="UNKNOWN",
            model_label=label,
            identity_kind="SERIES",
            canonical_identity=f"BatteryArchive/{label}",
            chemistry=chemistry,
            form_factor=form,
            system_level=level,
            source_refs=[ref(READY / "SOURCE_OBJECTS.jsonl", f"file_id={archive_id}"), ref(content_index_path, f"file_id={archive_id}"), ref(archive_path, locator)],
            document_version=sources[archive_id]["document_version_id"],
            facts=facts,
            conditions_and_limits=[
                "Battery Archive landing-page study summary, not a manufacturer product specification.",
                "Cohort chemistry/form statements cannot be assigned to a commercial model without an explicit sample-to-product binding.",
                "NOT_SELECTED_FOR_MINIMUM_BUILD_SET remains unchanged.",
            ],
            content_depth="RESEARCH_COHORT_SUMMARY",
            use_status=uses[archive_id]["build_use_status"],
            remaining_gaps=["commercial models not stated", "manufacturers not stated", "sample-level bindings absent"],
        ))
    return records


def lightweight_model_recheck(sources, uses):
    """Target already-prepared readable text for missed explicit product labels.

    This deliberately skips every NOT_ALLOWED_FOR_LOCAL_RAG artifact and does
    not open raw originals.  The scan only locates bounded brand/model tokens;
    candidates are then adjudicated at their small prepared-text locators.
    """
    content_index_path = READY / "documents" / "CONTENT_INDEX.jsonl"
    content_index = list(load_jsonl(content_index_path))
    artifacts = {}
    for item in content_index:
        artifacts[item["file_id"]] = Path(item["artifact_ref"].split("#", 1)[0])
    brand_pattern = re.compile(r"(?<![A-Za-z])(?:Panasonic|Samsung|LG(?:\s+Chem|\s+Energy)?|Murata|Sony|Kokam|A123|Molicel|CATL|BYD|Lishen)(?![A-Za-z])", re.I)
    model_pattern = re.compile(r"\b(?:NCR|INR|ICR|IMR|IFR|US|UR|ANR|APR|LIR|LR)\s*[-_]?\s*\d{4,5}(?:[-_][A-Za-z0-9]+|[A-Za-z][A-Za-z0-9]*)?\b|\bSLPB\d{6,12}[A-Za-z]?\b")
    hits = []
    scanned = []
    skipped = []
    for fid, path in sorted(artifacts.items()):
        if uses[fid]["build_use_status"] == "NOT_ALLOWED_FOR_LOCAL_RAG":
            skipped.append(fid)
            continue
        scanned.append(fid)
        for obj in load_jsonl(path):
            text = obj.get("text", "")
            brands = sorted({m.group(0) for m in brand_pattern.finditer(text)}, key=str.lower)
            models = sorted({m.group(0) for m in model_pattern.finditer(text)})
            if brands or models:
                hits.append({"file_id": fid, "locator": obj.get("locator"), "brand_tokens": brands, "model_tokens": models})

    kokam_id = "FILE-028-deece5b1db57-95e105"
    kokam_path = artifacts[kokam_id]
    kokam_segments = {o["locator"]: o for o in load_jsonl(kokam_path)}
    assert "Kokam SLPB78205130H cell" in kokam_segments["paragraph:57"]["text"]
    assert "does not claim to be representative of the true parameter" in kokam_segments["paragraph:59"]["text"]
    parameter_text = kokam_segments["paragraph:60"]["text"]
    expected = {
        "Nominal cell capacity [A.h]": "0.680616",
        "Lower voltage cut-off [V]": "3.105",
        "Upper voltage cut-off [V]": "4.1",
    }
    for field, value in expected.items():
        assert f'"{field}": {value}' in parameter_text
    record = make_record(
        record_id="EXIST-KOKAM-SLPB78205130H",
        manufacturer="Kokam",
        model_label="SLPB78205130H",
        identity_kind="EXACT_MODEL",
        canonical_identity="Kokam/SLPB78205130H",
        chemistry="lithium_ion (parameter-set label only)",
        form_factor="UNKNOWN",
        system_level="CELL",
        source_refs=[
            ref(READY / "SOURCE_OBJECTS.jsonl", f"file_id={kokam_id}"),
            ref(content_index_path, f"file_id={kokam_id}"),
            ref(kokam_path, "paragraph:57"), ref(kokam_path, "paragraph:59"), ref(kokam_path, "paragraph:60"),
        ],
        document_version=sources[kokam_id]["document_version_id"],
        facts=[
            {"field": "nominal_cell_capacity", "value": "0.680616", "unit": "A.h", "comparator_or_range": "EXACT_AS_PARAMETER_SET", "condition": "PyBaMM Marquis2019 parameter set; explicitly not claimed representative of true parameter values", "evidence_location": ref(kokam_path, "paragraph:60")},
            {"field": "lower_voltage_cutoff", "value": "3.105", "unit": "V", "comparator_or_range": "EXACT_AS_PARAMETER_SET", "condition": "PyBaMM Marquis2019 parameter set; explicitly not claimed representative of true parameter values", "evidence_location": ref(kokam_path, "paragraph:60")},
            {"field": "upper_voltage_cutoff", "value": "4.1", "unit": "V", "comparator_or_range": "EXACT_AS_PARAMETER_SET", "condition": "PyBaMM Marquis2019 parameter set; explicitly not claimed representative of true parameter values", "evidence_location": ref(kokam_path, "paragraph:60")},
        ],
        conditions_and_limits=[
            "Identity comes from an existing PyBaMM source parameter-set description, not a manufacturer datasheet.",
            "The source explicitly says the parameter set does not claim to represent the true parameter values; facts must retain that condition.",
            "Form factor is not inferred from SLPB or numeric tokens.",
            "NOT_SELECTED_FOR_MINIMUM_BUILD_SET remains unchanged.",
        ],
        content_depth="THIRD_PARTY_MODEL_PARAMETER_SET_WITH_NONREPRESENTATIVE_WARNING",
        use_status=uses[kokam_id]["build_use_status"],
        remaining_gaps=["manufacturer-primary identity/specification absent", "form factor not explicitly established", "true product operating limits not established", "current availability not established"],
    )
    audit = {
        "status": "PASSED_WITH_ONE_MISSED_EXACT_MODEL_ADDED",
        "scope": "Targeted token scan of existing CONTENT_INDEX-referenced prepared text only; raw originals, numeric arrays and NOT_ALLOWED_FOR_LOCAL_RAG artifacts were not read.",
        "prepared_artifacts_scanned": len(scanned),
        "restricted_artifacts_skipped": skipped,
        "target_brands": ["Panasonic", "Samsung", "LG/LG Chem/LG Energy", "Murata", "Sony", "Kokam", "A123", "Molicel", "CATL", "BYD", "Lishen"],
        "candidate_hits": hits,
        "adjudication": [
            {"candidate": "Kokam SLPB78205130H", "decision": "ADD_EXACT_MODEL", "reason": "Prepared source explicitly binds manufacturer name, complete model label and cell identity; parameter values retain the source's nonrepresentative warning."},
            {"candidate": "A123 Battery", "decision": "KEEP_FAMILY", "reason": "Prepared CALCE description states only the brand-level A123 Battery label and no complete commercial model."},
            {"candidate": "INR 18650-20R", "decision": "ALREADY_PRESENT", "reason": "Existing CALCE exact-label record already covers this token with manufacturer UNKNOWN."},
            {"candidate": "Panasonic/Samsung/LG/Murata/Sony/CATL/BYD/Lishen", "decision": "NO_EXISTING_EXACT_MODEL_FOUND", "reason": "No complete product-model binding for these target brands was found in the permitted prepared-text scan."},
        ],
        "non_claim": "This targeted scan is not an exhaustive census of all original corpus content or the market.",
    }
    return [record], audit, kokam_path


def dataset_sample_records(sources, uses):
    records = []
    decl_path = READY / "datasets" / "CONTAINER_DECLARATIONS.jsonl"
    gap_path = READY / "datasets" / "CONTAINER_GAP_RESOLUTIONS.jsonl"
    dataset_text = []
    for path in (decl_path, gap_path):
        for obj in load_jsonl(path):
            fid = obj.get("container_file_id", "")
            if fid.startswith(("FILE-012-", "FILE-013-")):
                dataset_text.append((fid, path, json.dumps(obj, ensure_ascii=False)))
    nasa_ids = defaultdict(set)
    for fid, path, text in dataset_text:
        for match in re.findall(r"\bB\d{4}\b", text):
            nasa_ids[fid].add(match)
        for match in re.findall(r"\bRW\d{1,2}\b", text):
            nasa_ids[fid].add(match)
    for fid, ids in nasa_ids.items():
        for sample in sorted(ids, key=lambda x: (x[:2] if x.startswith("RW") else x[:1], int(re.search(r"\d+", x).group()))):
            records.append(make_record(
                record_id=f"EXIST-NASA-SAMPLE-{sample}",
                manufacturer="UNKNOWN",
                model_label=sample,
                identity_kind="SAMPLE_ID",
                canonical_identity=f"NASA-PCoE/{sample}",
                chemistry="Lithium-ion (only at dataset cohort level)",
                form_factor="18650" if sample.startswith("RW") else "UNKNOWN",
                system_level="CELL",
                source_refs=[ref(READY / "SOURCE_OBJECTS.jsonl", f"file_id={fid}"), ref(decl_path, f"container_file_id={fid}"), ref(gap_path, f"container_file_id={fid}")],
                document_version=sources[fid]["document_version_id"],
                facts=[],
                conditions_and_limits=[
                    "Research sample ID from existing NASA declaration/member metadata; not a product model.",
                    "The 18650 form is assigned only to RW IDs because the existing declaration explicitly calls those batteries 18650.",
                    "PARTIAL_ACTION_SPLIT remains in force; no RAG/training/publication/server-transfer permission is inferred.",
                ],
                content_depth="RESEARCH_SAMPLE_METADATA_AND_PROTOCOL_DECLARATION",
                use_status=uses[fid]["build_use_status"],
                remaining_gaps=["manufacturer unknown", "commercial model unknown", "chemistry subtype unknown"],
                extra={"parent_dataset": sources[fid]["document_family_id"]},
            ))

    # SRC-017 names are registered raw-cell objects. Preserve IDs as research samples without opening CSV payloads.
    for fid, src in sorted(sources.items()):
        if src["source_id"] != "SRC-017" or src["lane"] != "datasets":
            continue
        stem = Path(src["source_relative_path"]).stem
        object_id = stem.split("__", 1)[0]
        label = stem.split("__", 1)[-1]
        records.append(make_record(
            record_id=f"EXIST-TRI017-SAMPLE-{object_id.upper()}",
            manufacturer="UNKNOWN",
            model_label=label,
            identity_kind="SAMPLE_ID",
            canonical_identity=f"SRC-017/{object_id}",
            source_refs=[ref(READY / "SOURCE_OBJECTS.jsonl", f"file_id={fid}"), ref(READY / "BUILD_USE_INDEX.jsonl", f"file_id={fid}")],
            document_version=src["document_version_id"],
            facts=[],
            conditions_and_limits=["Registered raw-cell object/file identity only; CSV payload was not read by this run.", "Do not infer commercial model, chemistry, or manufacturer from protocol/channel filename."],
            content_depth="REGISTERED_RESEARCH_CELL_FILE_METADATA",
            use_status=uses[fid]["build_use_status"],
            remaining_gaps=["commercial model unknown", "manufacturer unknown", "chemistry unknown", "sample-to-product mapping absent"],
            extra={"registered_file_id": fid, "protocol_filename": label},
        ))

    # Opaque SRC-020 diagnostic IDs in registered filenames remain SAMPLE_ID records.
    for fid, src in sorted(sources.items()):
        if src["source_id"] != "SRC-020" or src["lane"] != "datasets":
            continue
        found = re.search(r"((?:PreDiag|PredictionDiagnostics)_\d+_\w+)", src["source_relative_path"])
        if not found:
            continue
        sample = found.group(1)
        records.append(make_record(
            record_id="EXIST-TRI020-SAMPLE-" + sample.upper(),
            manufacturer="UNKNOWN",
            model_label=sample,
            identity_kind="SAMPLE_ID",
            canonical_identity=f"SRC-020/{sample}",
            source_refs=[ref(READY / "SOURCE_OBJECTS.jsonl", f"file_id={fid}"), ref(READY / "BUILD_USE_INDEX.jsonl", f"file_id={fid}")],
            document_version=src["document_version_id"],
            facts=[],
            conditions_and_limits=["Opaque diagnostic sample/file ID from registered metadata; not a product model.", "No large numeric source payload was opened."],
            content_depth="REGISTERED_RESEARCH_SAMPLE_FILE_METADATA",
            use_status=uses[fid]["build_use_status"],
            remaining_gaps=["commercial model unknown", "manufacturer unknown", "chemistry unknown", "form factor unknown"],
        ))
    # Exact duplicate sample identities can occur as raw and structured representations.
    by_identity = {}
    for rec in records:
        key = rec["canonical_identity"]
        if key not in by_identity:
            by_identity[key] = rec
        else:
            old = by_identity[key]
            old["source_refs"] = sorted(set(old["source_refs"] + rec["source_refs"]))
            old.setdefault("representation_records_merged", 1)
            old["representation_records_merged"] += 1
    return list(by_identity.values())


def findings(records):
    kinds = Counter(r["identity_kind"] for r in records)
    exact = [r for r in records if r["identity_kind"] == "EXACT_MODEL"]
    manufacturers = Counter(r["manufacturer"] for r in exact)
    chemistry = Counter(r["chemistry"] for r in exact)
    form = Counter(r["form_factor"] for r in exact)
    levels = Counter(r["system_level"] for r in exact)
    return {
        "scope": "EXISTING_REGISTERED_SMALL_METADATA_AND_REVIEW_ARTIFACTS_ONLY",
        "counting_rule": "Counts unique canonical EXACT_MODEL records only; aliases, continuation rows, families, series, dimensions, brands, and research sample IDs are excluded.",
        "counts": {
            "records_total": len(records),
            "exact_product_models": len(exact),
            "identity_kind": dict(sorted(kinds.items())),
            "exact_model_manufacturers": dict(sorted(manufacturers.items())),
            "exact_model_chemistry": dict(sorted(chemistry.items())),
            "exact_model_form_factor": dict(sorted(form.items())),
            "exact_model_system_level": dict(sorted(levels.items())),
            "restricted_fact_inventory_records": sum("NOT_ALLOWED_FOR_LOCAL_RAG" in r["use_status"] for r in records),
        },
        "effective_coverage": {
            "manufacturer_product_depth": [
                {"manufacturer": "E-One Moli Energy / Molicel", "coverage": "32 exact labels plus one unresolved slash-group; P42A has datasheet-level parameters; other exact labels have SDS-row identity/basic ratings only."},
                {"manufacturer": "Kokam", "coverage": "One exact label (SLPB78205130H) in a third-party PyBaMM parameter set whose source explicitly warns that parameter values are not claimed representative of true values."},
                {"manufacturer": "UNKNOWN", "coverage": "CALCE INR 18650-20R is an exact product label but manufacturer is not stated in the captured evidence."},
            ],
            "research_coverage": "CALCE series/sample IDs, Battery Archive study cohorts, NASA B/RW sample IDs, TRI SRC-017 raw-cell object IDs, and SRC-020 diagnostic IDs are inventoried separately and excluded from product counts.",
            "content_depth_limit": "Most existing manufacturer model labels are SDS table rows, not complete operating parameter profiles.",
        },
        "valid_gaps": [
            {"priority": "P0", "gap": "Cross-manufacturer manufacturer-primary exact-product evidence", "reason": "Existing exact models remain dominated by Molicel; Kokam appears only in a third-party parameter set and CALCE 20R lacks manufacturer evidence in the captured source."},
            {"priority": "P0", "gap": "Explicit chemistry and form factor for manufacturer product records", "reason": "Do not derive either field from ICR/INR/ICP prefixes, numeric size tokens, or dimensions."},
            {"priority": "P0", "gap": "Prismatic and pouch exact commercial models with manufacturer datasheets", "reason": "Existing prismatic/pouch evidence is research series or SDS labels with form factor not explicitly established."},
            {"priority": "P0", "gap": "LFP, NMC, NCA, LCO and LTO exact-model product coverage", "reason": "Research cohort chemistry does not establish product-model chemistry; LTO is a negative-electrode dimension and must be tracked separately."},
            {"priority": "P1", "gap": "Pack/system exact model coverage", "reason": "MCR/ME labels have basic SDS ratings but their cell/pack/system identity is not explicit enough to classify."},
            {"priority": "P1", "gap": "Operating limits and lifecycle-task depth", "reason": "SDS row identity/basic ratings do not support charge/discharge limits, degradation diagnosis, safety control, or current market availability."},
            {"priority": "P1", "gap": "Research sample to commercial product mapping", "reason": "NASA/TRI/CALCE sample IDs must remain separate unless a source explicitly binds them to a complete commercial model."},
            {"priority": "P1", "gap": "Usable rights path for SRC-038", "reason": "Existing restriction remains NOT_ALLOWED_FOR_LOCAL_RAG; facts may be inventoried for audit but source content cannot be promoted into local RAG."},
        ],
        "non_claims": [
            "This is not a market census or market coverage percentage.",
            "This does not establish that every listed SDS label is currently sold.",
            "This does not authorize RAG, training, redistribution, or server transfer beyond existing action decisions.",
            "This does not establish diagnostic capability for any listed product.",
        ],
    }


def validate(records, coverage, input_paths):
    checks = []
    def add(name, passed, detail):
        checks.append({"check": name, "status": "PASSED" if passed else "FAILED", "detail": detail})

    add("minimum_schema", all(MIN_FIELDS <= set(r) for r in records), "Every MODEL_EVIDENCE row contains the common minimum fields.")
    record_ids = [r["record_id"] for r in records]
    add("record_id_unique", len(record_ids) == len(set(record_ids)), f"{len(record_ids)} rows; {len(set(record_ids))} unique record IDs.")
    canonical_exact = [r["canonical_identity"] for r in records if r["identity_kind"] == "EXACT_MODEL"]
    add("exact_identity_dedup", len(canonical_exact) == len(set(canonical_exact)), f"{len(canonical_exact)} exact models; aliases/continuation rows excluded.")
    add("slash_group_not_exact", all(r["identity_kind"] != "EXACT_MODEL" for r in records if "/" in r["model_label"]), "Slash-group IBR18650B/BB/BC remains FAMILY.")
    add("sample_ids_not_exact", all(r["identity_kind"] == "SAMPLE_ID" for r in records if r["record_id"].find("SAMPLE") >= 0), "Research samples are not counted as products.")
    src038 = [r for r in records if r["manufacturer"] == "E-One Moli Energy / Molicel"]
    add("src038_use_not_upgraded", all("NOT_ALLOWED_FOR_LOCAL_RAG" in r["use_status"] for r in src038), f"{len(src038)} unique SRC-038 labels retain the restriction.")
    add("src038_chemistry_not_inferred", all(r["chemistry"] == "UNKNOWN" for r in src038), "No chemistry was derived from manufacturer model prefixes.")
    add("src038_form_not_inferred", all(r["form_factor"] == "UNKNOWN" for r in src038), "No form factor was derived from size tokens or dimensions.")
    add("exact_count_matches_findings", len(canonical_exact) == coverage["counts"]["exact_product_models"], str(len(canonical_exact)))
    add("required_inputs_exist", all(p.exists() for p in input_paths), "; ".join(str(p) for p in input_paths))
    missing_ref_targets = []
    for row in records:
        for item in row["source_refs"]:
            target = Path(item.split("#", 1)[0])
            if target.is_absolute() and not target.exists():
                missing_ref_targets.append(str(target))
    add("reference_targets_exist", not missing_ref_targets, f"missing={len(set(missing_ref_targets))}")
    expected_moli = 33
    add("molicel_unique_label_consolidation", len(src038) == expected_moli, f"38 SDS review rows consolidate to {len(src038)} unique labels; duplicate continuation rows merged.")
    exact_moli = sum(r["identity_kind"] == "EXACT_MODEL" for r in src038)
    add("molicel_exact_model_count", exact_moli == 32, f"{exact_moli} exact labels; one slash-group excluded.")
    continuation_models = {"INR18650-P28A", "INR18650-P28B", "INR18650-M35A", "INR21700-P45B", "INR21700-M50A"}
    continuation_ok = True
    for row in src038:
        if row["canonical_identity"] in continuation_models:
            continuation_ok &= any(f["field"] == "minimum_energy" for f in row["facts"])
    add("sds_continuation_minimum_energy", continuation_ok, "Five duplicate SDS continuation rows are merged as minimum_energy facts, not additional models or typical-energy facts.")
    record_by_id = {r["record_id"]: r for r in records}
    calce_representation_expectations = {
        ("EXIST-CALCE-INR-18650-20R", "diameter"): "SOURCE_BOUND_EQUIVALENT_REPRESENTATION",
        ("EXIST-CALCE-INR-18650-20R", "length"): "SOURCE_BOUND_EQUIVALENT_REPRESENTATION",
        ("EXIST-CALCE-CALCE-CS2", "cell_chemistry"): "SOURCE_BOUND_PARAPHRASE",
        ("EXIST-CALCE-CALCE-CX2", "cell_chemistry"): "SOURCE_BOUND_PARAPHRASE",
    }
    representation_ok = True
    for (record_id, field), expected in calce_representation_expectations.items():
        matches = [f for f in record_by_id[record_id]["facts"] if f["field"] == field]
        representation_ok &= len(matches) == 1 and matches[0]["comparator_or_range"] == expected
    add("calce_equivalent_and_paraphrase_labels", representation_ok, "Two normalized ± dimensions and two summarized chemistry statements use non-literal representation labels.")
    kokam = record_by_id.get("EXIST-KOKAM-SLPB78205130H", {})
    add("kokam_parameter_set_scope",
        kokam.get("identity_kind") == "EXACT_MODEL" and kokam.get("form_factor") == "UNKNOWN" and
        any("does not claim" in x for x in kokam.get("conditions_and_limits", [])) and
        all("not claimed representative" in f.get("condition", "") for f in kokam.get("facts", [])),
        "Kokam SLPB78205130H is counted from an explicit prepared-text binding while form remains UNKNOWN and every parameter keeps the nonrepresentative-values warning.")
    overall = "PASSED" if all(c["status"] == "PASSED" for c in checks) else "FAILED"
    return {
        "status": overall,
        "executed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "execution_scope": "Local deterministic metadata/review consolidation only; no source-workspace scan, numeric array read, model inference, network, install, or server action.",
        "checks": checks,
        "input_hashes": {str(p): digest(p) for p in input_paths},
    }


def write_outputs(records, coverage, checks, recheck):
    OUT.mkdir(parents=True, exist_ok=True)
    model_path = OUT / "MODEL_EVIDENCE.jsonl"
    with model_path.open("w", encoding="utf-8", newline="\n") as fh:
        for row in sorted(records, key=lambda r: (r["identity_kind"], r["canonical_identity"], r["record_id"])):
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    (OUT / "COVERAGE_FINDINGS.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "CHECK_RESULTS.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "EXISTING_LIGHTWEIGHT_MODEL_RECHECK.json").write_text(json.dumps(recheck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    exact = [r for r in records if r["identity_kind"] == "EXACT_MODEL"]
    moli = [r["canonical_identity"] for r in exact if r["manufacturer"] == "E-One Moli Energy / Molicel"]
    other = [r["model_label"] for r in exact if r["manufacturer"] != "E-One Moli Energy / Molicel"]
    kind_counts = coverage["counts"]["identity_kind"]
    report = f"""# Existing lithium identity and evidence inventory

Status: **{checks['status']} — LOCALLY_CHECKED_WITH_SCOPE**

## Data-basis issues applied before counting

- A brand, dimensional token, series, or research sample ID is not a complete commercial model. Only unique `EXACT_MODEL` canonical identities count.
- The 38 SRC-038 manufacturer SDS review rows contain five continuation-row duplicates, producing 33 unique labels. `IBR18650B/BB/BC` remains one unresolved `FAMILY` label and is excluded from the exact-model count.
- `INR21700-P42A` (SDS typography) and `INR-21700-P42A` (v1.7 datasheet typography) are consolidated as one canonical identity. The evidence rows and alias basis remain visible.
- Chemistry and form factor are not inferred from ICR/INR/ICP prefixes, numeric size tokens, brand, sample ID, or physical dimensions.
- SRC-038 remains `NOT_ALLOWED_FOR_LOCAL_RAG`. Its prior review is reused only for this source-bound fact inventory; this run did not reopen or enlarge access to the restricted originals.
- CALCE, Battery Archive and PyBaMM prepared descriptions are useful inventory evidence, but their `NOT_SELECTED_FOR_MINIMUM_BUILD_SET` status is not upgraded.
- A targeted scan of 64 non-restricted, `CONTENT_INDEX`-referenced prepared artifacts found one previously omitted exact identity: `Kokam SLPB78205130H`. Its parameter values remain qualified by the source's explicit warning that they are not claimed representative of true values.

## Concrete product-model list

The existing evidence supports **{len(exact)} unique exact product labels**: **{len(moli)} Molicel labels** plus **{len(other)} other prepared-source labels**.

Molicel exact labels ({len(moli)}): {', '.join(moli)}.

Other exact labels ({len(other)}): {', '.join(other)}. `SLPB78205130H` is bound to Kokam by a third-party parameter-set description; `INR 18650-20R` remains manufacturer-unknown in the captured CALCE evidence.

The separate unresolved manufacturer family label is `IBR18650B/BB/BC`. It may denote multiple variants, but this evidence does not justify splitting or counting them as exact models.

Only `INR-21700-P42A` has datasheet-level existing parameters in addition to the SDS row. The remaining Molicel labels have SDS-table identity/basic rating depth only; they are not complete operating profiles and do not prove current availability.

## Research identities kept separate

The inventory contains {kind_counts.get('SAMPLE_ID', 0)} `SAMPLE_ID` records, {kind_counts.get('SERIES', 0)} `SERIES` records, and {kind_counts.get('FAMILY', 0)} `FAMILY` records. These cover explicit CALCE CS2/CX2/PL samples, Battery Archive study cohorts, NASA B/RW samples, TRI SRC-017 registered raw-cell objects, and SRC-020 diagnostic IDs. None contributes to the exact-product count.

CALCE evidence separately establishes cylindrical, prismatic, and pouch research descriptions and LFP/NMC/LCO-related chemistries, but it does not turn the series or sample IDs into commercial models. NASA declarations establish lithium-ion cohort context and explicitly call RW samples 18650; they do not state manufacturer, complete model, or chemistry subtype.

## Effective gaps for directed product work

1. Add manufacturer-primary exact-model evidence beyond Molicel. The current inventory is strongly single-manufacturer.
2. Add explicit chemistry and explicit form-factor evidence for exact products; do not backfill from naming conventions.
3. Add prismatic and pouch exact commercial models with manufacturer datasheets.
4. Add exact-model coverage for LFP, NMC, NCA, LCO and other major rechargeable chemistries. Track LTO separately as an anode-system dimension.
5. Add pack/system identities and operating limits. Existing MCR/ME rows are insufficient to classify their level safely.
6. Preserve research-sample/product separation unless a source explicitly binds a sample to a complete product model.
7. Obtain a permitted content path before any SRC-038 text is considered for local RAG; this inventory does not supply one.

## Scope and reproducibility

Inputs were the registered `SOURCE_OBJECTS`, `BUILD_USE_INDEX`, `documents/CONTENT_INDEX`, index-referenced prepared text, small dataset declarations/contracts, and the three candidate-review lanes. The supplemental search was a targeted brand/model-token scan of 64 small prepared artifacts and skipped all five `NOT_ALLOWED_FOR_LOCAL_RAG` prepared artifacts. The script did not scan the 112 GB source workspace, read large numeric arrays, install dependencies, execute downloaded code, change historical artifacts, or run model inference. `CHECK_RESULTS.json` records the actual local checks and input hashes. This is an existing-evidence inventory, not an exhaustive census of all original corpus content, a market census, coverage percentage, server acceptance, or product diagnostic capability claim.
"""
    (OUT / "REPORT.md").write_text(report, encoding="utf-8")
    audit_request = {
        "requested_auditor": "PRODUCTS (non-author)",
        "status": "READY_FOR_INDEPENDENT_AUDIT",
        "author_scope": "EXISTING",
        "artifacts": ["MODEL_EVIDENCE.jsonl", "COVERAGE_FINDINGS.json", "REPORT.md", "CHECK_RESULTS.json", "build_existing_coverage.py"],
        "required_checks": [
            "Recompute 38 SDS review rows -> 33 unique labels -> 32 exact Molicel labels plus one FAMILY slash-group.",
            "Verify P42A alias/continuation merging does not inflate the exact-model count.",
            "Verify every accepted quantitative fact against its cited review fact_id or CALCE locator.",
            "Verify SAMPLE_ID, SERIES, FAMILY, brand labels, and dimensions are excluded from exact-product counts.",
            "Verify SRC-038 remains NOT_ALLOWED_FOR_LOCAL_RAG and no restricted source text was promoted.",
            "Verify chemistry/form factor were not inferred from manufacturer prefixes, sizes, or sample IDs.",
            "Review all 34 exact model records, not a sample, and record per-record acceptance/rejection.",
        ],
        "known_focus_items": [
            "IBR18650B/BB/BC is intentionally unresolved and excluded from exact models.",
            "INR21700-P42A and INR-21700-P42A are consolidated with an explicit alias basis.",
            "INR 18650-20R is exact-label evidence with manufacturer UNKNOWN because the captured CALCE source does not state it.",
            "MCR1821J, ME202CJ, and ME202EK retain UNKNOWN system level pending explicit source evidence.",
            "Kokam SLPB78205130H comes from a third-party parameter set; retain the explicit nonrepresentative-values warning.",
        ],
    }
    (OUT / "PRODUCTS_AUDIT_REQUEST.json").write_text(json.dumps(audit_request, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    sources, uses = source_index()
    records = molicel_records(sources, uses)
    records.extend(content_records(sources, uses))
    recheck_records, recheck, kokam_path = lightweight_model_recheck(sources, uses)
    records.extend(recheck_records)
    records.extend(dataset_sample_records(sources, uses))
    coverage = findings(records)
    inputs = [
        READY / "SOURCE_OBJECTS.jsonl",
        READY / "BUILD_USE_INDEX.jsonl",
        READY / "documents" / "CONTENT_INDEX.jsonl",
        READY / "datasets" / "CONTAINER_DECLARATIONS.jsonl",
        READY / "datasets" / "CONTAINER_GAP_RESOLUTIONS.jsonl",
        CANDIDATE / "review_a" / "REVIEW_RESULTS.jsonl",
        CANDIDATE / "review_b" / "REVIEW_RESULTS.jsonl",
        CANDIDATE / "review_restricted" / "REVIEW_RESULTS.jsonl",
        READY / "documents" / "derived" / "FILE-014-3c2dd9d0c5f4-d765af.content.jsonl",
        READY / "documents" / "derived" / "FILE-015-abdc6da9a59e-5ae7f3.content.jsonl",
        kokam_path,
    ]
    checks = validate(records, coverage, inputs)
    write_outputs(records, coverage, checks, recheck)
    print(json.dumps({"status": checks["status"], **coverage["counts"]}, ensure_ascii=False))
    if checks["status"] != "PASSED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
