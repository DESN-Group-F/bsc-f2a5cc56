import io
import json
import tempfile
import zipfile
from pathlib import Path
import read_rda_member as reader

HERE = Path(__file__).parent
record = json.loads((HERE / "RDA_MEMBER_READINESS.jsonl").read_text(encoding="utf-8").splitlines()[0])
results = {}

def expect(name, exc, fn):
    try: fn(); results[name] = {"pass": False, "reason": "accepted"}
    except exc as error: results[name] = {"pass": True, "exception": type(error).__name__, "message": str(error)}

expect("negative_rows_rejected_before_io", reader.BudgetError,
       lambda: reader.read_bounded_numeric("missing.zip", "a.zip", "a.rda", max_rows=-1))
expect("illegal_selector_rejected_before_io", ValueError,
       lambda: reader.read_bounded_numeric("missing.zip", "../a.zip", "a.rda"))

with tempfile.TemporaryDirectory() as td:
    nested_buf = io.BytesIO()
    with zipfile.ZipFile(nested_buf, "w") as z: z.writestr("x.rda", b"not-rdata")
    outer = Path(td) / "outer.zip"
    with zipfile.ZipFile(outer, "w") as z: z.writestr("nested.zip", nested_buf.getvalue())
    expect("nested_cap_rejected_before_extraction", reader.BudgetError,
           lambda: reader.read_bounded_numeric(outer, "nested.zip", "x.rda", max_nested_bytes=1))
    expect("member_cap_rejected_before_decode", reader.BudgetError,
           lambda: reader.read_bounded_numeric(outer, "nested.zip", "x.rda", max_member_bytes=1))

actual = reader.read_bounded_numeric(record["outer_path"], record["nested_archive_member"], record["inner_member_path"],
                                     max_rows=1, fields=["voltage", "current"], max_numeric_elements=20, max_output_bytes=5000)
results["actual_bounded_read"] = {"pass": actual["returned_rows"] == 1 and actual["numeric_elements_returned"] <= 20 and actual["serialized_bytes_checked"] <= 5000,
                                  "returned_rows": actual["returned_rows"], "numeric_elements": actual["numeric_elements_returned"], "serialized_bytes": actual["serialized_bytes_checked"]}
expect("output_cap_rejected_before_return", reader.BudgetError,
       lambda: reader.read_bounded_numeric(record["outer_path"], record["nested_archive_member"], record["inner_member_path"],
                                           max_rows=1, fields=["voltage"], max_numeric_elements=10, max_output_bytes=1))
out = {"status": "PASS" if all(x["pass"] for x in results.values()) else "FAIL", "tests": results,
       "budgets": {"max_nested_bytes": reader.HARD_MAX_NESTED_BYTES, "max_member_bytes": reader.HARD_MAX_MEMBER_BYTES,
                   "max_rows": reader.HARD_MAX_ROWS, "max_fields": reader.HARD_MAX_FIELDS,
                   "max_numeric_elements": reader.HARD_MAX_NUMERIC_ELEMENTS, "max_output_bytes": reader.HARD_MAX_OUTPUT_BYTES}}
(HERE / "BOUNDED_READER_CHECK.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(out, ensure_ascii=True))
