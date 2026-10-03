"""Refresh current catalog statistics while retaining historical and future-design prose."""
import json
import re
import sys

sys.dont_write_bytecode = True
from assemble_catalog import INPUTS
from catalog_tool import BASE, CATALOG, PLAN, digest

DOCUMENT = BASE.parents[1] / "docs" / "battery-catalog.md"


def main():
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    report = json.loads((BASE / "validation-report.json").read_text(encoding="utf-8"))
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    if (report["status"] != "pass" or report["catalog_version"] != data["catalog_version"]
            or report["content_sha256"] != digest(data)):
        raise ValueError("Document requires passing validation of the current release")
    text = DOCUMENT.read_text(encoding="utf-8")
    version, c, f = data["catalog_version"], report["counts"], report["coverage"]
    text = re.sub(r"^Release `[^`]+` contains .*?$", f"Release `{version}` contains {f['independent_product_models']} independent product models and {f['variant_records']} variant records across {len(c['chemistries'])} chemistries, with {c['sources']} source records representing {c['unique_source_urls']} distinct opened URLs and {c['evidence_rows']} field-evidence rows. {f['verified_independent_product_models']} independent models are `verified_core`; {len(f['pending_confirmation_catalog_ids'])} remain `partial`. Source consultation dates are retained per source. This is public product research, not school inventory or a procurement list; actual school coverage remains unknown. This release changes data only and implements no application functionality.", text, flags=re.M)
    text = text.replace("The current published baseline is release", "The starting published baseline was release")
    text = re.sub(r"Reproducible assembly of (?:seven|\d+) explicitly named research fragments", f"Reproducible assembly of {len(INPUTS)} explicitly named research fragments", text)
    text = re.sub(r"(?:Seven|\d+) reviewed input fragments plus clearly named independent audit records", f"{len(INPUTS)} reviewed input fragments plus clearly named independent audit records", text)
    text = text.replace("### Second-batch expansion and five-field coverage", "### Archived second-batch expansion and five-field coverage")
    text = text.replace("| Entire release | 44 |", "| Archived release 2026.10.02.2 | 44 |")
    text = text.replace("Entire release / 44", "Archived release / 44")
    text = text.replace("The current dataset has 2 rated", "Archived release `2026.10.02.2` has 2 rated")
    legal_null = sum(m["manufacturer"] is None for m in data["models"])
    conflict_records = sum(bool(m["conflicts"]) for m in data["models"])
    text = re.sub(r"(?:Eleven|\d+) records contain conflict notes; this does not mean (?:eleven|\d+) models are pending\.", f"{conflict_records} records contain conflict notes; this does not mean {conflict_records} models are pending.", text)
    if plan["status"] == "user_approved_completed":
        text = text.replace("## Active research plan: 200 verified independent products", "## Completed research plan: 200 verified independent products")
        text = text.replace("**Status: user-approved work plan; in progress.**", "**Status: user-approved work plan; completed.**")
    text = re.sub(r"Future separate field; \d+ legal-manufacturer values remain null", f"Future separate field; {legal_null} legal-manufacturer values remain null", text)
    text = re.sub(r"Manufacturer legal entity is not established for \d+ records\. Brand is independently populated for all \d+ records;", f"Manufacturer legal entity is not established for {legal_null} records. Brand is independently populated for all {len(data['models'])} records;", text)
    ids = {m["catalog_id"] for m in data["models"]}
    qualifications = []
    if "tenergy-31003-protected-pack" in ids:
        qualifications.append("Tenergy 31003 has conflicting 3 A and 4 A current-limit text. Its directly labelled nominal voltage is 7.4 V and its generic capacity is stored as stated 2200 mAh; no discharge-current limit is curated. Tenergy 31001 retains an erroneous generic parallel-module voltage claim, while its exact base-product nominal field supports 3.7 V. Tenergy 31012's application text mentions 10.8 V while its exact heading and nominal field state 11.1 V. These discrepancies remain visible, and no module-assembly procedure or application compatibility is accepted.")
    if "jauch-lp503759ju-246517" in ids:
        qualifications.append("Jauch LP503759JU's family link tooltip names another model, but the exact family row and retrieved PDF body agree on LP503759JU / 246517. DEWALT DCBP320 has one alternate-image label for a two-pack; its selected SKU, included quantity and manual identify the single battery. EEMB LP583759's PDF prints the invalid date 2019-8-50, which is retained literally. These metadata limits were independently reopened without inventing corrections.")
    if "inspired-energy-nh2057hd34-standard-assembly" in ids:
        qualifications.append("Inspired Energy NH2057HD34 revision 2.0 prints issue date 2/17/23 in headers and 2/17/22 in its revision history; the discrepancy is recorded. RRC and Inspired Energy capacity lower bounds retain their original >= labels in stated-capacity labels, evidence and notes. A numeric threshold is not an exact measured capacity. Initial rated, nominal, typical and minimum observations remain separate, and the complete structured record must be reviewed before applying a scalar from the candidate prefill view.")
    if "duracell-mn1500-us-flat-cell" in ids:
        qualifications.append("The five Duracell major/specialty cells have no selected capacity scalar: delivered capacity depends on load, temperature and cutoff, and plotted curves were not digitized. Their chemical evidence includes the exact sheets and the alkaline AIS family scope; specialty AAAA supports MX2500 independently of the major-size sub-brand list. Power-Sonic nominal capacities retain their explicit 20-hour rate and terminal option. School procurement coverage remains unknown.")
    limits_block = "<!-- later-source-limits:start -->\n" + "\n\n".join(qualifications) + "\n<!-- later-source-limits:end -->\n\n"
    limits_pattern = r"<!-- later-source-limits:start -->.*?<!-- later-source-limits:end -->\n*"
    if re.search(limits_pattern, text, flags=re.S):
        text = re.sub(limits_pattern, lambda _: limits_block, text, flags=re.S)
    else:
        text = text.replace("Manufacturer legal entity is not established", limits_block + "Manufacturer legal entity is not established", 1)
    text = re.sub(r"Curated release version, currently `[^`]+`", f"Curated release version, currently `{version}`", text)
    text = re.sub(r"^Assembly reads (?:only|the) .*?$", f"Assembly reads the {len(INPUTS)} files explicitly named in `assemble_catalog.py` INPUTS; staged fragments and audit records are excluded. It adds null defaults, preserves or supplies an editable display suggestion, normalizes variant-key punctuation and combines existing evidence without inventing specifications. Changed released content requires a new version and date; `--replace-draft` is restricted to unreleased drafts. Assembly rejects changes to any archived model/source objects. Canonical JSON is the SQLite build input. `catalog-plan.json` records the target and category allocation; `catalog-classification.json` assigns one editorial research category per record without altering factual model objects.", text, flags=re.M)
    text = re.sub(r"^Actual validation passed all .*?$", f"Actual validation passed all {len(report['checks'])} recorded checks for `{version}`: schema/semantics, identities, units, evidence references, JSON/SQLite and numeric/null equality, capacity qualifications, content hash, reproducible database builds, read-only queries, negative-input guards, unique primary categories and archived model/source/file preservation. All {c['null_rated_capacities']} null rated/nominal values remain null in the prefill view. The recorded independent sample meets the planned minimum; that check verifies identifiers and sample size, not scientific accuracy. See `validation-report.json` for actual time and results. No D1 integration or application efficiency measurements are claimed.", text, flags=re.M)
    text = text.replace("No part of this workflow is implemented by the second-batch data expansion.", "No part of this workflow is implemented by catalog data expansion.")
    text = re.sub(r"^(?:The first release is archived|Published artifacts are preserved) .*?$", f"Published artifacts are preserved under `data/battery-catalog/releases/<version>/`, each with raw-file SHA-256 manifest. Current release `{version}` uses schema `{data['schema_version']}` and preserves every archived model/source object. The plan, editorial classification and source-review log are separate data artifacts; they do not add application functions.", text, flags=re.M)
    lines = ["<!-- current-catalog-status:start -->", "### Current checkpoint", "", f"Current release `{version}`: {f['verified_independent_product_models']}/{plan['target_verified_independent_products']} verified independent products; {f['variant_records']} records; {f['extra_variant_records']} extra variants. The latest batch adds {report['latest_batch']['coverage']['verified_independent_product_models']} verified products. Work status: {plan['status']}.", "", "| Primary research category | Independent products | Verified | Target |", "| --- | ---: | ---: | ---: |"]
    for key, stats in report["primary_category_distribution"].items():
        lines.append(f"| {key} | {stats['independent_products']} | {stats['verified_independent_products']} | {plan['planned_verified_products_by_primary_category'][key]} |")
    lines.extend(["", "Five-field coverage (independent products): " + "; ".join(f"{k}: {v}/{f['independent_product_models']}" for k, v in f["five_field_coverage_independent_models"].items()) + ".", "", "Capacity observations by original kind: " + "; ".join(f"{k}: {v}" for k, v in f["capacity_kind_record_counts"].items()) + ". Kinds overlap. Missing all scalar capacity: " + (", ".join(f["missing_capacity_scalar_catalog_ids"]) or "none") + ". Pending: " + (", ".join(f["pending_confirmation_catalog_ids"]) or "none") + ".", "", "Brands (record counts): " + "; ".join(f"{k}: {v}" for k, v in report["brand_distribution"].items()) + ".", "", f"Independent source review for the latest batch: {report['independent_source_review']['independently_reviewed_new_verified_products']}/{report['independent_source_review']['new_verified_independent_products']} newly verified products (minimum {report['independent_source_review']['minimum_sample_required']}). Actual audit files and source-access limitations are recorded in `catalog-review-log.json` and its linked research audits. Automated validation does not re-fetch sources.", "", "| Release | Verified independent products | Records | Sources |", "| --- | ---: | ---: | ---: |"])
    histories = {p.parent.name: json.loads(p.read_text(encoding="utf-8")) for p in (BASE / "releases").glob("*/catalog.json")}
    histories[version] = data
    for key, old in sorted(histories.items()):
        verified = len({(m["brand"].casefold(), m["model"].casefold()) for m in old["models"] if m["verification_status"] == "verified_core"})
        lines.append(f"| {key} | {verified} | {len(old['models'])} | {len(old['sources'])} |")
    lines.extend(["", "<!-- current-catalog-status:end -->", ""])
    block = "\n".join(lines)
    pattern = r"<!-- current-catalog-status:start -->.*?<!-- current-catalog-status:end -->\n?"
    if re.search(pattern, text, flags=re.S):
        text = re.sub(pattern, lambda _: block, text, flags=re.S)
    else:
        text = text.replace("## Model coverage\n", "## Model coverage\n\n" + block)
    DOCUMENT.write_text(text, encoding="utf-8")
    print(json.dumps({"status": "updated", "catalog_version": version, "document": str(DOCUMENT)}))


if __name__ == "__main__":
    main()
