import collections, json, pathlib, sys

ROOT = pathlib.Path(__file__).parent

def load(name):
    return [json.loads(line) for line in (ROOT / name).read_text(encoding="utf-8-sig").splitlines() if line.strip()]

profiles = load("CONTAINER_WORKBOOK_PROFILES.jsonl")
contracts = load("CONTAINER_WORKBOOK_CONTRACTS.jsonl")
profile_sheets = {(r["container_file_id"], r["member_path"], s["sheet"]): s for r in profiles for s in r["sheets"]}
contract_keys = [(r["container_file_id"], r["member_path"], r["sheet"]) for r in contracts]
issues = []
if len(profiles) != 91: issues.append(f"expected 91 workbook members, found {len(profiles)}")
if len(contracts) != 449: issues.append(f"expected 449 sheet contracts, found {len(contracts)}")
if len(set(contract_keys)) != len(contract_keys): issues.append("duplicate sheet contract keys")
if set(contract_keys) != set(profile_sheets): issues.append("contract/profile sheet-key sets differ")
for row, key in zip(contracts, contract_keys):
    sheet = profile_sheets.get(key, {})
    if row.get("formula_count") != sheet.get("formula_count"): issues.append(f"formula count mismatch: {key}")
    if row.get("contract_status") == "HEADER_SELECTED":
        fields = [x for x in (row.get("selected_fields") or []) if x not in (None, "")]
        if len(fields) < 2: issues.append(f"selected header has fewer than two fields: {key}")
    if "&sheet=" in row.get("candidate_grid_ref", ""): issues.append(f"non-top-level sheet selector in candidate_grid_ref: {key}")
conductivity = [r for r in contracts if r["sheet"].lower() == "electric conductivity"]
if len(conductivity) != 6: issues.append(f"expected 6 conductivity sheets, found {len(conductivity)}")
for row in conductivity:
    if row.get("selected_header_rows") != [3, 5] or row.get("selected_fields") != ["Material", "Cathode electronic conductivity (S/m)", "Anode electronic conductivity (S/m)"]:
        issues.append(f"conductivity multirow header mismatch: {(row['container_file_id'], row['member_path'])}")
status_counts = dict(collections.Counter(r["contract_status"] for r in contracts))
result = {
    "status": "PASS" if not issues else "FAIL",
    "checks": {
        "workbook_members_91": len(profiles) == 91,
        "sheet_contracts_449": len(contracts) == 449,
        "unique_and_exact_sheet_set": len(set(contract_keys)) == len(contract_keys) and set(contract_keys) == set(profile_sheets),
        "formula_counts_match_full_used_sheet_scan": not any(x.startswith("formula count mismatch") for x in issues),
        "conductivity_multirow_headers_6": len(conductivity) == 6 and not any(x.startswith("conductivity") for x in issues),
        "candidate_grid_refs_are_container_member_selectors": not any("candidate_grid_ref" in x for x in issues),
    },
    "status_counts": status_counts,
    "formula_cells_total": sum(r.get("formula_count", 0) for r in contracts),
    "issues": issues,
    "scope": "All 91 container workbook members and all 449 worksheets; formula counts cover every used cell loaded read-only/data_only=False.",
    "not_checked": ["Formula evaluation", "external-link execution", "scientific validity of workbook calculations"],
}
(ROOT / "WORKBOOK_SCHEMA_CHECKS.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
sys.exit(0 if not issues else 1)
