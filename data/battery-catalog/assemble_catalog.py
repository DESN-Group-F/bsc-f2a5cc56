"""Assemble reviewed research fragments without inventing product specifications."""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True
from catalog_tool import BASE, CATALOG, CLASSIFICATION, classify_models, encode, require_valid

INPUTS = (
    "primary-cells.json", "rechargeable-cells.json", "battery-packs.json",
    "batch2-lithium-cells.json", "batch2-lithium-packs.json", "batch2-standard-cells.json",
    "batch2-lifepo4-cells.json",
    "batch3-tool-packs.json", "batch3-prototype-eemb.json", "batch3-prototype-other.json",
    "batch4-standalone-cells.json", "batch4-prototype-eemb.json", "batch4-prototype-jauch.json",
    "batch5-tool-packs-a.json", "batch5-tool-packs-b.json",
    "batch5-prototype-jauch.json", "batch5-prototype-mixed.json", "batch5-general-packs-root.json",
    "batch6-general-packs-jauch.json", "batch6-general-packs-mixed.json", "batch6-supplementary-root.json",
)


def assemble(version, published_on):
    sources, models = {}, []
    for filename in INPUTS:
        fragment = json.loads((BASE / "research" / filename).read_text(encoding="utf-8-sig"))
        for source in fragment["sources"]:
            key = source["source_id"]
            if key in sources and sources[key] != source:
                raise ValueError(f"Conflicting definitions of source {key}")
            sources[key] = source
        for model in fragment["models"]:
            model.setdefault("stated_capacity_mah", None)
            model.setdefault("stated_capacity_label", None)
            model["variant_key"] = re.sub(r"[^a-z0-9]+", "-", model["variant_key"].casefold()).strip("-")
            model.setdefault("suggested_display_name", f"{model['brand']} {model['model']}")
            evidence = model["field_evidence"]
            # Parent citations retain the same observations as their populated leaf citations.
            # Display descriptions and alias policies are editorial classifications, not new specifications.
            for parent in ("aliases", "form_factor", "dimensions_mm", "connector"):
                path = "/" + parent
                if model[parent] is None or evidence.get(path):
                    continue
                entries = [entry for key, items in evidence.items() if key.startswith(path + "/") for entry in items]
                unique = {encode(entry): entry for entry in entries}
                if unique:
                    evidence[path] = [unique[key] for key in sorted(unique)]
            models.append(model)
    data = {
        "schema_version": "1.1.0", "catalog_version": version, "published_on": published_on,
        "scope": "public_product_references_not_school_inventory",
        "units": {"capacity": "mAh", "voltage": "V", "energy": "Wh", "dimensions": "mm", "mass": "g"},
        "display_name_template": "{brand} {model}",
        "sources": sorted(sources.values(), key=lambda item: item["source_id"]),
        "models": sorted(models, key=lambda item: item["catalog_id"]),
    }
    require_valid(data)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="2026.10.03.4")
    parser.add_argument("--published-on", default="2026-10-03")
    parser.add_argument("--replace-draft", action="store_true", help="Explicitly replace a changed, unreleased same-version local draft")
    args = parser.parse_args()
    try:
        date.fromisoformat(args.published_on)
        data = assemble(args.version, args.published_on)
        for original_path in sorted((BASE / "releases").glob("*/catalog.json")):
            original = json.loads(original_path.read_text(encoding="utf-8"))
            for kind, identity in (("models", "catalog_id"), ("sources", "source_id")):
                current = {item[identity]: item for item in data[kind]}
                if any(current.get(item[identity]) != item for item in original[kind]):
                    raise ValueError(f"Assembly must preserve every model/source record from release {original['catalog_version']} exactly")
        if CATALOG.exists():
            old = json.loads(CATALOG.read_text(encoding="utf-8"))
            if old != data and old.get("catalog_version") == args.version and not args.replace_draft:
                raise ValueError("Changed catalog content requires a new version; --replace-draft is only for unreleased local drafts")
        classification = classify_models(data)
        CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        CLASSIFICATION.write_text(json.dumps(classification, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "assembled", "catalog_version": args.version, "models": len(data["models"]), "sources": len(data["sources"])}))
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
