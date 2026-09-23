import json
from pathlib import Path

HERE = Path(__file__).parent
rows = [json.loads(x) for x in (HERE / "RDA_MEMBER_READINESS.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
reader = json.loads((HERE / "BOUNDED_READER_CHECK.json").read_text(encoding="utf-8"))
checks = {
    "exactly_28": len(rows) == 28,
    "unique_three_level_selectors": len({(x["outer_file_id"], x["nested_archive_member"], x["inner_member_path"]) for x in rows}) == 28,
    "all_src013_outer": {x["outer_file_id"] for x in rows} == {"FILE-013-c3743204a076-b42702"},
    "all_ready": all(x["status"] == "LOCALLY_CHECKED_RDA_READY" for x in rows),
    "all_numeric_verified": all(x["numeric_read_verified"] for x in rows),
    "all_have_steps_schema": all(any(o.get("object_name") == "steps" and o.get("shape") and o.get("numeric_checks") for o in x["objects"]) for x in rows),
    "all_hashes_and_entrypoints": all(len(x["inner_sha256"]) == 64 and Path(x["reader_entrypoint"]).exists() for x in rows),
    "bounded_reader_actual_and_rejection_fixtures": reader.get("status") == "PASS" and all(x.get("pass") for x in reader.get("tests", {}).values()),
    "no_mat_equivalence_claim": True,
}
out = {"status": "PASS" if all(checks.values()) else "FAIL", "checks": checks,
       "counts": {"members": len(rows), "nested_archives": len({x["nested_archive_member"] for x in rows}), "numeric_ready": sum(x["numeric_read_verified"] for x in rows)},
       "limitations": ["RDA is retained as its own representation; MAT equivalence was not asserted.", "Units and protocol meaning require bound README/source context.", "No R code, model, RAG, or scientific validation ran."]}
(HERE / "FINAL_CHECK_RESULTS.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(out, ensure_ascii=True))
