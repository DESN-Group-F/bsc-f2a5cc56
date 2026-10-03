"""Validate, rebuild and query the isolated product reference catalog (standard library only)."""
import argparse
import copy
import hashlib
import json
import math
import re
import sqlite3
import sys
import tempfile
from collections import Counter
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
BASE = Path(__file__).resolve().parent
CATALOG = BASE / "catalog.json"
DATABASE = BASE / "catalog.sqlite3"
CLASSIFICATION = BASE / "catalog-classification.json"
PLAN = BASE / "catalog-plan.json"


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(encode(value).encode("utf-8")).hexdigest()


def product_key(model):
    return (model["brand"].strip().casefold(), model["model"].strip().casefold())


def coverage_counts(models):
    """Count actual independent brand/model products separately from variant records and scalar kinds."""
    groups = {}
    capacity_fields = ("rated_capacity_mah", "minimum_capacity_mah", "typical_capacity_mah", "stated_capacity_mah")
    for model in models:
        key = product_key(model)
        groups.setdefault(key, []).append(model)
    criteria = {
        "brand_and_exact_model": lambda m: bool(m["brand"] and m["model"]),
        "chemistry": lambda m: bool(m["chemistry"]),
        "nominal_voltage": lambda m: m["nominal_voltage_v"] is not None,
        "capacity_scalar_with_original_kind": lambda m: any(m[field] is not None for field in capacity_fields),
        "editable_name_suggestion": lambda m: bool(m["suggested_display_name"]),
    }
    return {
        "independent_product_models": len(groups), "variant_records": len(models),
        "extra_variant_records": len(models) - len(groups),
        "verified_independent_product_models": sum(any(m["verification_status"] == "verified_core" for m in variants) for variants in groups.values()),
        "five_field_coverage_independent_models": {name: sum(any(check(m) for m in variants) for variants in groups.values()) for name, check in criteria.items()},
        "five_field_coverage_variant_records": {name: sum(check(m) for m in models) for name, check in criteria.items()},
        "capacity_kind_record_counts": {
            "rated": sum(m["rated_capacity_mah"] is not None and m["capacity_basis"] == "rated" for m in models),
            "nominal": sum(m["rated_capacity_mah"] is not None and m["capacity_basis"] == "nominal" for m in models),
            "minimum": sum(m["minimum_capacity_mah"] is not None for m in models),
            "typical": sum(m["typical_capacity_mah"] is not None for m in models),
            "stated": sum(m["stated_capacity_mah"] is not None for m in models),
        },
        "missing_capacity_scalar_catalog_ids": [m["catalog_id"] for m in models if not criteria["capacity_scalar_with_original_kind"](m)],
        "pending_confirmation_catalog_ids": [m["catalog_id"] for m in models if m["verification_status"] == "partial"],
        "counting_note": "Independent products use normalized brand plus exact model; aliases, packaging counts and repeated source pages do not increase the count. Capacity-kind counts may overlap.",
    }


def classify_models(data):
    """Assign one editorial research group without altering source-backed model objects."""
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    overrides = {}
    for filename, category in plan["fragment_primary_category_overrides"].items():
        fragment_path = BASE / "research" / filename
        if not fragment_path.exists():
            continue
        fragment = json.loads(fragment_path.read_text(encoding="utf-8-sig"))
        for model in fragment["models"]:
            key = model["catalog_id"]
            if key in overrides and overrides[key] != category:
                raise ValueError(f"Conflicting primary research category for {key}")
            overrides[key] = category
    assignments = {}
    lithium = {"lithium_ion", "lithium_ion_polymer", "lithium_iron_phosphate"}
    for model in data["models"]:
        key = model["catalog_id"]
        if key in overrides:
            category = overrides[key]
        elif model["chemistry"] in lithium:
            category = "general_finished_lithium_pack" if model["unit_kind"] == "pack" else "standalone_lithium_cell"
        else:
            category = "supplementary"
        if category not in plan["primary_category_priority"]:
            raise ValueError(f"Unknown research category {category}")
        assignments[key] = category
    # The research plan may include staged fragments awaiting review and assembly.
    return {"catalog_version": data["catalog_version"], "catalog_content_sha256": digest(data),
        "classification_kind": "editorial_mutually_exclusive_primary_research_category",
        "category_priority": plan["primary_category_priority"], "assignments": assignments,
        "limitations": "Public reference research grouping only; not school use, procurement or compatibility evidence."}


def category_distribution(models, assignments):
    categories = json.loads(PLAN.read_text(encoding="utf-8"))["primary_category_priority"]
    result = {}
    for category in categories:
        selected = [model for model in models if assignments[model["catalog_id"]] == category]
        result[category] = {"variant_records": len(selected),
            "independent_products": len({product_key(model) for model in selected}),
            "verified_independent_products": len({product_key(model) for model in selected if model["verification_status"] == "verified_core"})}
    return result



def local_output(path):
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(BASE):
        raise ValueError("Output must remain inside data/battery-catalog; application databases are excluded.")
    return resolved


def read_catalog():
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def schema_errors(value, spec, root, path="$", errors=None):
    """Validate the deliberately small JSON Schema vocabulary used by catalog.schema.json."""
    if errors is None:
        errors = []
    if "$ref" in spec:
        target = root
        for part in spec["$ref"].removeprefix("#/").split("/"):
            target = target[part]
        return schema_errors(value, target, root, path, errors)
    types = spec.get("type", [])
    types = [types] if isinstance(types, str) else types
    checks = {
        "null": value is None, "boolean": type(value) is bool,
        "integer": type(value) is int, "number": type(value) in (int, float) and math.isfinite(value),
        "string": isinstance(value, str), "array": isinstance(value, list), "object": isinstance(value, dict),
    }
    if types and not any(checks[t] for t in types):
        errors.append(f"{path}: expected {types}")
        return errors
    if "enum" in spec and value not in spec["enum"]:
        errors.append(f"{path}: value outside enum")
    if isinstance(value, str):
        if len(value) < spec.get("minLength", 0):
            errors.append(f"{path}: empty string")
        if "pattern" in spec and not re.search(spec["pattern"], value):
            errors.append(f"{path}: invalid pattern")
        if spec.get("format") == "date":
            try:
                if date.fromisoformat(value).isoformat() != value:
                    raise ValueError()
            except ValueError:
                errors.append(f"{path}: invalid date")
        if spec.get("format") == "uri" and (urlparse(value).scheme != "https" or not urlparse(value).netloc):
            errors.append(f"{path}: expected an HTTPS source URL")
    if type(value) in (int, float):
        if "exclusiveMinimum" in spec and value <= spec["exclusiveMinimum"]:
            errors.append(f"{path}: value must exceed {spec['exclusiveMinimum']}")
        if "maximum" in spec and value > spec["maximum"]:
            errors.append(f"{path}: value exceeds {spec['maximum']}")
    if isinstance(value, list):
        if len(value) < spec.get("minItems", 0):
            errors.append(f"{path}: too few items")
        if spec.get("uniqueItems") and len({encode(v) for v in value}) != len(value):
            errors.append(f"{path}: duplicate array items")
        for i, item in enumerate(value):
            schema_errors(item, spec.get("items", {}), root, f"{path}[{i}]", errors)
    if isinstance(value, dict):
        properties = spec.get("properties", {})
        for key in spec.get("required", []):
            if key not in value:
                errors.append(f"{path}.{key}: missing required field")
        for key, item in value.items():
            if key in properties:
                schema_errors(item, properties[key], root, f"{path}.{key}", errors)
            elif spec.get("additionalProperties") is False:
                errors.append(f"{path}.{key}: unsupported field")
            elif isinstance(spec.get("additionalProperties"), dict):
                schema_errors(item, spec["additionalProperties"], root, f"{path}.{key}", errors)
    return errors


def pointer(record, path):
    value = record
    for part in path.removeprefix("/").split("/"):
        token = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", token):
                raise KeyError(token)
            value = value[int(token)]
        else:
            value = value[token]
    return value


def validate_data(data):
    schema = json.loads((BASE / "catalog.schema.json").read_text(encoding="utf-8"))
    errors = schema_errors(data, schema, schema)
    if errors:
        return errors
    sources = {s["source_id"]: s for s in data["sources"]}
    if len(sources) != len(data["sources"]):
        errors.append("Duplicate source IDs")
    if data["units"] != {"capacity": "mAh", "voltage": "V", "energy": "Wh", "dimensions": "mm", "mass": "g"}:
        errors.append("Catalog units differ from the declared contract")
    identities, ids = set(), set()
    needed = ["brand", "model", "variant_description", "chemistry", "rechargeable", "unit_kind", "form_factor",
              "manufacturer", "rated_capacity_mah", "typical_capacity_mah", "minimum_capacity_mah",
              "nominal_voltage_v", "energy_wh", "dimensions_mm", "mass_g", "connector", "maintenance_notes",
              "capacity_test_conditions", "stated_capacity_mah", "stated_capacity_label", "aliases"]
    for model in data["models"]:
        label = model["catalog_id"]
        identity = tuple(model[k].strip().casefold() for k in ("brand", "model", "variant_key"))
        if label in ids or identity in identities:
            errors.append(f"{label}: duplicate catalog ID or brand/model/variant")
        ids.add(label)
        identities.add(identity)
        refs = set(model["source_ids"])
        if not refs or not refs <= sources.keys():
            errors.append(f"{label}: absent or dangling source reference")
        evidence = model["field_evidence"]
        for path, observations in evidence.items():
            try:
                if not path.startswith("/"):
                    raise KeyError()
                pointer(model, path)
            except (KeyError, TypeError, IndexError):
                errors.append(f"{label}: evidence points to absent field {path}")
            for observation in observations:
                if observation["source_id"] not in refs:
                    errors.append(f"{label}: evidence source not attached to model: {path}")
        for field in needed:
            value = model[field]
            if value is not None and not evidence.get("/" + field):
                leaves = ["/" + field + "/" + key for key, item in value.items() if item is not None] if isinstance(value, dict) else []
                if not leaves or not all(evidence.get(leaf) for leaf in leaves):
                    errors.append(f"{label}: populated field without evidence: {field}")
        for field in ("series", "parallel"):
            if model["configuration"][field] is not None and not (evidence.get("/configuration") or evidence.get("/configuration/" + field)):
                errors.append(f"{label}: unevidenced cell configuration")
        rating = model["rated_capacity_mah"]
        if (rating is None) != (model["capacity_basis"] == "not_stated"):
            errors.append(f"{label}: capacity value and basis disagree")
        if rating is not None and not evidence.get("/capacity_basis"):
            errors.append(f"{label}: capacity basis not evidenced")
        if model["minimum_capacity_mah"] is not None and model["typical_capacity_mah"] is not None:
            if model["minimum_capacity_mah"] > model["typical_capacity_mah"]:
                errors.append(f"{label}: minimum capacity exceeds typical")
        if (model["stated_capacity_mah"] is None) != (model["stated_capacity_label"] is None):
            errors.append(f"{label}: unqualified capacity value and source label disagree")
        if (model["energy_wh"] is None) != (model["energy_basis"] is None):
            errors.append(f"{label}: energy value and basis disagree")
        if model["energy_basis"] is not None and not evidence.get("/energy_basis"):
            errors.append(f"{label}: energy basis not evidenced")
        if model["verification_status"] == "verified_core" and (not model["nominal_voltage_v"] or model["rechargeable"] is None):
            errors.append(f"{label}: verified_core lacks core facts")
        if not model["unknowns"] and any(model[field] is None for field in needed):
            errors.append(f"{label}: unexplained unknown fields")
        for source_id in refs & sources.keys():
            source = sources[source_id]
            if source["accessed_on"] > data["published_on"]:
                errors.append(f"{label}: source date later than catalog release")
        alias_keys = set()
        for alias in model["aliases"]:
            alias_key = (alias["value"].casefold(), alias["kind"])
            if alias_key in alias_keys:
                errors.append(f"{label}: duplicate alias value/kind")
            alias_keys.add(alias_key)
            if alias["kind"] == "search_term" and alias["match_policy"] != "search_only":
                errors.append(f"{label}: generic search term cannot establish exact identity")
    used = {sid for model in data["models"] for sid in model["source_ids"]}
    if used != sources.keys():
        errors.append("Catalog contains orphan sources")
    return errors


def require_valid(data):
    errors = validate_data(data)
    if errors:
        raise ValueError("\n".join(errors))


def build_database(data, destination):
    require_valid(data)
    destination = local_output(destination)
    if destination.suffix != ".sqlite3":
        raise ValueError("Reference database output must use the .sqlite3 extension")
    if destination.exists():
        with closing(sqlite3.connect(f"{destination.as_uri()}?mode=ro", uri=True)) as existing:
            row = existing.execute("SELECT value FROM catalog_meta WHERE key='kind'").fetchone()
            if row != ("battery_model_catalog",):
                raise ValueError("Refusing to replace an unrecognized database")
    with tempfile.TemporaryDirectory(prefix="catalog-build-", dir=BASE) as task_dir:
        temporary = Path(task_dir) / "reference.sqlite3"
        with closing(sqlite3.connect(temporary)) as db:
            db.executescript((BASE / "sqlite-schema.sql").read_text(encoding="utf-8"))
            meta = {"kind": "battery_model_catalog", "schema_version": data["schema_version"],
                    "catalog_version": data["catalog_version"], "published_on": data["published_on"],
                    "content_sha256": digest(data), "units": encode(data["units"])}
            db.executemany("INSERT INTO catalog_meta VALUES(?,?)", sorted(meta.items()))
            for source in sorted(data["sources"], key=lambda s: s["source_id"]):
                db.execute("INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)", tuple(source[k] for k in
                    ("source_id", "url", "title", "publisher", "source_type", "document_version", "accessed_on")) + (encode(source),))
            for model in sorted(data["models"], key=lambda m: m["catalog_id"]):
                fields = ["catalog_id", "brand", "manufacturer", "model", "variant_key", "variant_description",
                          "chemistry", "rechargeable", "unit_kind"]
                values = [model[k] for k in fields] + [model["form_factor"]["code"]]
                values += [model[k] for k in ("rated_capacity_mah", "capacity_basis", "typical_capacity_mah",
                           "minimum_capacity_mah", "stated_capacity_mah", "stated_capacity_label", "nominal_voltage_v", "energy_wh", "verification_status")]
                search = " ".join([model["brand"], model["manufacturer"] or "", model["model"],
                    model["variant_description"], model["chemistry"], model["form_factor"]["code"]] +
                    [alias["value"] for alias in model["aliases"]]).casefold()
                db.execute("INSERT INTO models VALUES(" + ",".join(["?"] * 21) + ")", values + [search, encode(model)])
                db.executemany("INSERT INTO aliases VALUES(?,?,?,?)", [(model["catalog_id"], a["value"], a["kind"], a["match_policy"])
                    for a in sorted(model["aliases"], key=lambda a: (a["value"], a["kind"]))])
                db.executemany("INSERT INTO model_sources VALUES(?,?)", [(model["catalog_id"], sid) for sid in sorted(model["source_ids"])])
                for path, entries in sorted(model["field_evidence"].items()):
                    for item in sorted(entries, key=lambda e: (e["source_id"], e["locator"])):
                        db.execute("INSERT INTO field_evidence VALUES(?,?,?,?,?)", (model["catalog_id"], path,
                            item["source_id"], item["locator"], item["observation"]))
            db.commit()
            db.execute("VACUUM")
        temporary.replace(destination)
    return destination


def query_database(search=None, catalog_id=None, exact_model=None, brand=None, database=DATABASE):
    with closing(sqlite3.connect(f"{Path(database).resolve().as_uri()}?mode=ro", uri=True)) as db:
        meta = dict(db.execute("SELECT key,value FROM catalog_meta"))
        clauses, values = [], []
        if catalog_id:
            clauses.append("m.catalog_id=?")
            values.append(catalog_id)
        if brand:
            clauses.append("m.brand=? COLLATE NOCASE")
            values.append(brand.strip())
        if exact_model:
            clauses.append("(m.model=? COLLATE NOCASE OR EXISTS(SELECT 1 FROM aliases a WHERE a.catalog_id=m.catalog_id AND a.match_policy='exact_candidate' AND a.value=? COLLATE NOCASE))")
            values.extend([exact_model.strip(), exact_model.strip()])
        if search:
            for token in search.casefold().split():
                clauses.append("m.search_text LIKE ? ESCAPE '\\'")
                values.append("%" + token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        sql = "SELECT m.record_json FROM models m" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY m.brand,m.model,m.variant_key"
        records = [json.loads(row[0]) for row in db.execute(sql, values)]
        return {"catalog_version": meta["catalog_version"], "content_sha256": meta["content_sha256"],
                "requires_variant_confirmation": True, "count": len(records), "models": records}


def run_validation(data):
    require_valid(data)
    with closing(sqlite3.connect(f"{DATABASE.as_uri()}?mode=ro", uri=True)) as db:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = db.execute("PRAGMA foreign_key_check").fetchall()
        stored = {row[0]: json.loads(row[1]) for row in db.execute("SELECT catalog_id,record_json FROM models")}
        model_roundtrip = stored == {m["catalog_id"]: m for m in data["models"]}
        source_roundtrip = {row[0]: json.loads(row[1]) for row in db.execute("SELECT source_id,record_json FROM sources")} == {s["source_id"]: s for s in data["sources"]}
        meta = dict(db.execute("SELECT key,value FROM catalog_meta"))
        evidence_count = db.execute("SELECT COUNT(*) FROM field_evidence").fetchone()[0]
        numeric_rows = db.execute("SELECT catalog_id,rated_capacity_mah,typical_capacity_mah,minimum_capacity_mah,stated_capacity_mah,nominal_voltage_v,energy_wh FROM models").fetchall()
        numeric_roundtrip = all(list(row[1:]) == [stored[row[0]][k] for k in ("rated_capacity_mah", "typical_capacity_mah", "minimum_capacity_mah", "stated_capacity_mah", "nominal_voltage_v", "energy_wh")] for row in numeric_rows)
        prefill_rows = db.execute("SELECT catalog_id,capacityMah,voltage FROM inventory_prefill").fetchall()
        prefill_nulls = all(row[1] == stored[row[0]]["rated_capacity_mah"] and row[2] == stored[row[0]]["nominal_voltage_v"] for row in prefill_rows)
        capacity_rows = db.execute("SELECT catalog_id,value_mah,kind FROM catalog_capacities").fetchall()
        expected_capacity_rows = []
        for model in data["models"]:
            if model["rated_capacity_mah"] is not None:
                expected_capacity_rows.append((model["catalog_id"], model["rated_capacity_mah"], model["capacity_basis"]))
            for field, kind in (("minimum_capacity_mah", "minimum"), ("typical_capacity_mah", "typical"), ("stated_capacity_mah", "stated")):
                if model[field] is not None:
                    expected_capacity_rows.append((model["catalog_id"], model[field], kind))
        qualified_capacities = sorted(capacity_rows) == sorted(expected_capacity_rows)
    negative_checks = {}
    bad = copy.deepcopy(data)
    bad["models"].append(copy.deepcopy(bad["models"][0]))
    negative_checks["reject_duplicate_variant"] = bool(validate_data(bad))
    bad = copy.deepcopy(data)
    bad["models"][0]["nominal_voltage_v"] = -1
    negative_checks["reject_negative_voltage"] = bool(validate_data(bad))
    bad = copy.deepcopy(data)
    bad["units"]["capacity"] = "Ah"
    negative_checks["reject_unit_change"] = bool(validate_data(bad))
    bad = copy.deepcopy(data)
    bad["models"][0]["field_evidence"].pop("/model", None)
    negative_checks["reject_missing_model_evidence"] = bool(validate_data(bad))
    bad = copy.deepcopy(data)
    bad["models"][0]["source_ids"].append("missing-source")
    negative_checks["reject_dangling_source"] = bool(validate_data(bad))
    bad = copy.deepcopy(data)
    bad["models"][0]["aliases"].append({"value": "AA", "kind": "search_term", "match_policy": "exact_candidate"})
    negative_checks["reject_shape_as_identity"] = bool(validate_data(bad))
    bad = copy.deepcopy(data)
    aliased_model = next(m for m in bad["models"] if m["aliases"])
    duplicate_alias = copy.deepcopy(aliased_model["aliases"][0])
    duplicate_alias["match_policy"] = "search_only"
    aliased_model["aliases"].append(duplicate_alias)
    negative_checks["reject_duplicate_alias_key"] = bool(validate_data(bad))
    with tempfile.TemporaryDirectory(prefix="catalog-verify-", dir=BASE) as task_dir:
        a = build_database(data, Path(task_dir) / "a.sqlite3")
        b = build_database(data, Path(task_dir) / "b.sqlite3")
        reproducible = a.read_bytes() == b.read_bytes() == DATABASE.read_bytes()
    def expected_exact_ids(value, brand):
        # A search-only term may also be a real model or another exact candidate.
        # It must not introduce matches beyond those independently exact identities.
        return {m["catalog_id"] for m in data["models"]
                if m["brand"].casefold() == brand.casefold()
                and (m["model"].casefold() == value.strip().casefold()
                     or any(a["match_policy"] == "exact_candidate"
                            and a["value"].casefold() == value.strip().casefold()
                            for a in m["aliases"]))}

    query_checks = {
        "every_id_retrievable": all(query_database(catalog_id=m["catalog_id"])["models"] == [m] for m in data["models"]),
        "every_exact_brand_model_retrievable": all(m in query_database(exact_model=m["model"], brand=m["brand"])["models"] for m in data["models"]),
        "search_only_alias_not_exact": all(
            {result["catalog_id"] for result in query_database(exact_model=a["value"], brand=m["brand"])["models"]}
            == expected_exact_ids(a["value"], m["brand"])
            for m in data["models"] for a in m["aliases"] if a["match_policy"] == "search_only"),
        "literal_sql_input_returns_no_match": query_database(search="' OR 1=1 --")["count"] == 0,
        "wildcards_are_literal": query_database(search="%_")["count"] == 0,
    }
    checks = {"schema_and_semantic_validation": True, "sqlite_integrity": integrity == "ok",
        "sqlite_foreign_keys": not foreign_keys, "model_json_roundtrip": model_roundtrip,
        "source_json_roundtrip": source_roundtrip, "numeric_and_null_roundtrip": numeric_roundtrip,
        "prefill_preserves_unknown_capacity": prefill_nulls, "content_hash_matches": meta.get("content_sha256") == digest(data),
        "byte_identical_rebuilds_same_runtime": reproducible,
        "all_scalar_capacity_kinds_preserved": qualified_capacities, **negative_checks, **query_checks}
    baseline_path = BASE / "releases" / "2026.10.02.1" / "catalog.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else None
    added_models = []
    if baseline is not None:
        by_id = {m["catalog_id"]: m for m in data["models"]}
        by_source = {s["source_id"]: s for s in data["sources"]}
        checks["original_model_records_unchanged"] = all(by_id.get(m["catalog_id"]) == m for m in baseline["models"])
        checks["original_source_records_unchanged"] = all(by_source.get(s["source_id"]) == s for s in baseline["sources"])
        original_products = {product_key(m) for m in baseline["models"]}
        added_models = [m for m in data["models"] if product_key(m) not in original_products]
        manifest_path = baseline_path.parent / "artifact-sha256.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            checks["original_release_artifact_hashes_unchanged"] = all(
                hashlib.sha256((baseline_path.parent / name).read_bytes()).hexdigest() == expected
                for name, expected in manifest.items())
    classifications = classify_models(data)
    classification_file = json.loads(CLASSIFICATION.read_text(encoding="utf-8")) if CLASSIFICATION.exists() else None
    checks["primary_classification_matches_catalog"] = classification_file == classifications
    checks["independent_products_have_one_primary_category"] = all(
        len({classifications["assignments"][m["catalog_id"]] for m in data["models"] if product_key(m) == key}) == 1
        for key in {product_key(m) for m in data["models"]})
    by_id = {m["catalog_id"]: m for m in data["models"]}
    by_source = {s["source_id"]: s for s in data["sources"]}
    histories = []
    for path in sorted((BASE / "releases").glob("*/catalog.json")):
        prior = json.loads(path.read_text(encoding="utf-8"))
        prefix = "release_" + prior["catalog_version"].replace(".", "_")
        checks[prefix + "_model_records_unchanged"] = all(by_id.get(m["catalog_id"]) == m for m in prior["models"])
        checks[prefix + "_source_records_unchanged"] = all(by_source.get(s["source_id"]) == s for s in prior["sources"])
        manifest = json.loads((path.parent / "artifact-sha256.json").read_text(encoding="utf-8"))
        checks[prefix + "_artifact_hashes_unchanged"] = all(
            hashlib.sha256((path.parent / name).read_bytes()).hexdigest() == expected for name, expected in manifest.items())
        histories.append(prior)
    histories.sort(key=lambda prior: tuple(int(part) for part in prior["catalog_version"].split(".")))
    earlier_histories = [prior for prior in histories if prior["catalog_version"] != data["catalog_version"]]
    latest_baseline = earlier_histories[-1] if earlier_histories else None
    prior_products = {product_key(m) for m in latest_baseline["models"]} if latest_baseline else set()
    latest_added = [m for m in data["models"] if product_key(m) not in prior_products]
    second_release = next((prior for prior in histories if prior["catalog_version"] == "2026.10.02.2"), None)
    if second_release is not None and baseline is not None:
        original_products = {product_key(m) for m in baseline["models"]}
        added_models = [m for m in second_release["models"] if product_key(m) not in original_products]
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    distribution = category_distribution(data["models"], classifications["assignments"])
    checks["planned_category_allocation_matches_target"] = sum(plan["planned_verified_products_by_primary_category"].values()) == plan["target_verified_independent_products"]
    checks["completed_plan_matches_verified_products"] = plan["status"] != "user_approved_completed" or (
        coverage_counts(data["models"])["verified_independent_product_models"] == plan["target_verified_independent_products"]
        and all(distribution[key]["verified_independent_products"] == target
                for key, target in plan["planned_verified_products_by_primary_category"].items()))
    review_log_path = BASE / "catalog-review-log.json"
    review_log = json.loads(review_log_path.read_text(encoding="utf-8")) if review_log_path.exists() else {"releases": []}
    review = next((entry for entry in review_log["releases"] if entry["catalog_version"] == data["catalog_version"]), None)
    new_verified_keys = {product_key(m) for m in latest_added if m["verification_status"] == "verified_core"}
    required_sample = math.ceil(len(new_verified_keys) * plan["independent_sampling"]["minimum_fraction_new_verified"])
    sampled_ids = review["independently_reviewed_catalog_ids"] if review else []
    sampled_keys = {product_key(by_id[key]) for key in sampled_ids if key in by_id and product_key(by_id[key]) in new_verified_keys}
    checks["independent_sample_record_meets_planned_minimum"] = len(sampled_keys) >= required_sample
    checks["independent_sample_ids_exist_in_catalog"] = all(key in by_id for key in sampled_ids)
    audit_paths = [BASE / name for name in review.get("audit_files", [])] if review else []
    checks["independent_audit_files_exist"] = bool(audit_paths) and all(path.is_file() for path in audit_paths)
    audits = [json.loads(path.read_text(encoding="utf-8")) for path in audit_paths if path.is_file()]
    audit_ids = {key for audit in audits for key in audit.get("independently_reviewed_catalog_ids", [])}
    # Earlier audit records identify their full-core reviews by exact model and attached source.
    audit_ids.update(model["catalog_id"] for audit in audits for item in audit.get("model_checks", [])
                     if item.get("selected_core_fields_match") is True
                     for model in data["models"]
                     if model["model"].strip().casefold() == item.get("model", "").strip().casefold()
                     and item.get("source_id") in model["source_ids"])
    checks["independent_sample_ids_match_audit_records"] = set(sampled_ids) <= audit_ids and len(sampled_ids) == len(set(sampled_ids))
    return {"status": "pass" if all(checks.values()) else "fail", "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "catalog_version": data["catalog_version"], "content_sha256": digest(data),
        "runtime": {"python": sys.version.split()[0], "sqlite": sqlite3.sqlite_version},
        "counts": {"models": len(data["models"]), "sources": len(data["sources"]),
            "unique_source_urls": len({s["url"] for s in data["sources"]}), "evidence_rows": evidence_count,
            "chemistries": dict(sorted(Counter(m["chemistry"] for m in data["models"]).items())),
            "null_rated_capacities": sum(m["rated_capacity_mah"] is None for m in data["models"]),
            "models_with_conflict_notes": sum(bool(m["conflicts"]) for m in data["models"])},
        "coverage": coverage_counts(data["models"]),
        "primary_category_distribution": category_distribution(data["models"], classifications["assignments"]),
        "brand_distribution": dict(sorted(Counter(m["brand"] for m in data["models"]).items())),
        "research_plan": {"target_verified_independent_products": plan["target_verified_independent_products"],
            "planned_category_allocation": plan["planned_verified_products_by_primary_category"],
            "remaining_verified_independent_products": max(0, plan["target_verified_independent_products"] - coverage_counts(data["models"])["verified_independent_product_models"])},
        "latest_batch": {"baseline_version": latest_baseline["catalog_version"] if latest_baseline else None,
            "coverage": coverage_counts(latest_added),
            "primary_category_distribution": category_distribution(latest_added, classifications["assignments"]),
            "brand_distribution": dict(sorted(Counter(m["brand"] for m in latest_added).items()))},
        "independent_source_review": {"new_verified_independent_products": len(new_verified_keys),
            "minimum_sample_required": required_sample, "independently_reviewed_new_verified_products": len(sampled_keys),
            "review_record": review,
            "qualification": "Checks confirm a recorded sample and identifiers, not the scientific accuracy of source interpretation."},
        "second_batch": {
            "baseline_version": baseline["catalog_version"] if baseline else None,
            "coverage": coverage_counts(added_models),
            "verified_rechargeable_lithium_independent_models": len({product_key(m) for m in added_models
                if m["rechargeable"] is True and m["chemistry"] in ("lithium_ion", "lithium_ion_polymer", "lithium_iron_phosphate") and m["verification_status"] == "verified_core"}),
            "school_procurement_coverage": "unknown; no actual school purchasing list was supplied",
        },
        "checks": checks, "network_rechecked_by_validation_script": False,
        "limitations": ["Sources were opened during research on accessed_on; scripts do not re-fetch them.",
            "Evidence presence is validated; scientific accuracy still requires human source review.",
            "Database rebuild byte equality is only asserted for the recorded runtime.",
            "Application integration and D1 workflow tests have not been performed."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="Validate canonical JSON and replace only the isolated reference database")
    build.add_argument("--output", type=Path, default=DATABASE)
    validate = sub.add_parser("validate", help="Check JSON, evidence, nulls, database, queries and deterministic rebuilds")
    validate.add_argument("--report", type=Path)
    query = sub.add_parser("query", help="Read reference candidates; never creates inventory assets")
    query.add_argument("--search")
    query.add_argument("--id", dest="catalog_id")
    query.add_argument("--exact-model")
    query.add_argument("--brand")
    args = parser.parse_args()
    try:
        if args.command == "build":
            path = build_database(read_catalog(), args.output)
            result = {"status": "built", "path": str(path), "content_sha256": digest(read_catalog())}
        elif args.command == "validate":
            result = run_validation(read_catalog())
            if args.report:
                report_path = local_output(args.report)
                if not re.fullmatch(r"validation-report(?:-[A-Za-z0-9_-]+)?\.json", report_path.name):
                    raise ValueError("Report filename must be validation-report.json or validation-report-<name>.json")
                report_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        else:
            result = query_database(args.search, args.catalog_id, args.exact_model, args.brand)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        if result.get("status") == "fail":
            return 1
    except (ValueError, OSError, sqlite3.Error, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
