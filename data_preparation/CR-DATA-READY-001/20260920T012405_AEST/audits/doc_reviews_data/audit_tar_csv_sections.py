import csv, hashlib, importlib.util, io, json, pathlib, tarfile

RUN = pathlib.Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
DS = RUN / "datasets"
OUT = RUN / "audits" / "doc_reviews_data" / "TAR_CSV_SECTION_REVIEW.json"

def load_jsonl(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8-sig").splitlines() if x]

contracts = load_jsonl(DS / "TAR_CSV_SECTION_CONTRACTS.jsonl")
old = load_jsonl(DS / "TAR_CSV_FULL_STRUCTURE.jsonl")
targets = {(x["container_file_id"], x["member_path"]) for x in old}
keys = [(x["container_file_id"], x["member_path"]) for x in contracts]

spec = importlib.util.spec_from_file_location("section_reader", DS / "read_sectioned_tar_csv.py")
reader_mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader_mod)
c = max(contracts, key=lambda x: x["member_bytes"])
start = min(22000, c["data_row_count"] - 2)
got = reader_mod.read_rows(c["container_file_id"], c["member_path"], row_limit=2, row_start=start)

source = next(x for x in load_jsonl(RUN / "SOURCE_OBJECTS.jsonl") if x["file_id"] == c["container_file_id"])
direct_rows = []
record_offsets = []
with tarfile.open(source["input_path"], "r:*") as tf:
    raw = tf.extractfile(c["member_path"])
    pos = 0
    for record_no, line in enumerate(raw, 1):
        if record_no in got["source_record_numbers"]:
            record_offsets.append(pos)
            direct_rows.append(next(csv.reader([line.decode(c["encoding"])])))
        pos += len(line)
        if len(direct_rows) == 2:
            break

def digest(obj):
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

def rejected(**kwargs):
    try:
        reader_mod.read_rows(c["container_file_id"], c["member_path"], **kwargs)
        return False
    except ValueError:
        return True

degree_ok = all("Â°C" not in json.dumps(x, ensure_ascii=False) and "�" not in json.dumps(x, ensure_ascii=False) for x in contracts)
width_ok = all(set(map(int, x["data_column_count_distribution"].keys())) == {len(x["data_header_fields"])} for x in contracts)
result_bytes = len(json.dumps(got, ensure_ascii=False, separators=(",", ":")).encode())
checks = {
    "contracts_182_exact_unique": len(contracts) == len(keys) == len(set(keys)) == 182 and set(keys) == targets,
    "all_ready_and_explicit_encoding": all(x["status"] == "SECTION_CONTRACT_READY" and x.get("encoding") for x in contracts),
    "headers_are_data_headers": all(x["data_header_fields"] and x["data_header_fields"] != ["[Summary]"] for x in contracts),
    "degree_units_preserved": degree_ok,
    "all_widths_match_headers": width_ok,
    "no_low_numeric_or_malformed_rows": sum(x.get("low_numeric_ratio_rows", 0) for x in contracts) == 0 and not any(x.get("malformed_record_row_numbers") for x in contracts),
    "data_row_total_6297413": sum(x["data_row_count"] for x in contracts) == 6297413,
    "literal_units_all_182": sum(bool(x.get("embedded_unit_declarations")) for x in contracts) == 182,
    "independent_nonzero_rows_equal_raw": digest(got["rows"]) == digest(direct_rows),
    "independent_rows_beyond_1mib": len(record_offsets) == 2 and min(record_offsets) > 1048576,
    "source_record_numbers_preserved": len(got["source_record_numbers"]) == 2,
    "exact_serialized_size_within_budget": result_bytes < 1_000_000,
    "negative_start_rejected": rejected(row_start=-1),
    "past_end_rejected": rejected(row_start=c["data_row_count"] + 1),
    "member_bound_rejected": rejected(row_start=0, max_member_bytes=c["member_bytes"] - 1),
    "output_bound_rejected": rejected(row_start=start, row_limit=2, max_output_bytes=result_bytes - 1),
}
review = {
    "status": "PASS_WITH_SCOPE_LIMITS" if all(checks.values()) else "REWORK_REQUIRED",
    "checks": checks,
    "counts": {"contracts": len(contracts), "data_records": sum(x["data_row_count"] for x in contracts), "physical_records_historical": sum(x.get("row_count_including_header", 0) for x in old)},
    "actual_value_probe": {"container_file_id": c["container_file_id"], "member_path": c["member_path"], "row_start": start, "source_record_numbers": got["source_record_numbers"], "source_byte_offsets": record_offsets, "row_hash_matches_direct_raw": digest(got["rows"]) == digest(direct_rows), "values_stored": False},
    "limits": ["Contracts verify section boundaries, literal headers/units and bounded source-value access; they do not validate scientific meaning or measurement quality.", "The historical 6,307,995 physical-record count includes metadata and headers; 6,297,413 is the contract count for Data-section records."],
}
OUT.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(review["status"], json.dumps(checks, sort_keys=True))

