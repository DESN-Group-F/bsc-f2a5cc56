import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "data_route" / "process_local_batches.py"
SPEC = importlib.util.spec_from_file_location("process_local_batches", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class LocalDataProcessingTests(unittest.TestCase):
    def test_permission_requires_exact_record_or_matching_group(self):
        route = {
            "file_id": "FILE-1",
            "source_id": "SRC-1",
            "sha256": "abc",
            "rights_record": {"effective_rights_id": "RIGHTS-1"},
        }
        group = {
            "source_id": "SRC-1",
            "rights_id": "RIGHTS-1",
            "ai_processing": "ALLOWED",
            "scope": "exact acquired representations",
        }
        decision = MODULE.resolve_permission(route, [group])
        self.assertEqual(decision["decision"], "ALLOW_LOCAL_PROCESSING")
        self.assertEqual(decision["binding"], "RECORDED_GROUP_SCOPE_FOR_EXACT_ACQUIRED_REPRESENTATIONS")

    def test_permission_rejects_mismatched_group(self):
        route = {
            "file_id": "FILE-1",
            "source_id": "SRC-1",
            "sha256": "abc",
            "rights_record": {"effective_rights_id": "RIGHTS-COMPONENT"},
        }
        group = {"source_id": "SRC-1", "rights_id": "RIGHTS-DATA", "ai_processing": "ALLOWED"}
        with self.assertRaises(PermissionError):
            MODULE.resolve_permission(route, [group])

    def test_permission_gap_distinguishes_pending_purpose_decision(self):
        route = {
            "file_id": "FILE-1",
            "source_id": "SRC-1",
            "sha256": "abc",
            "rights_record": {"effective_rights_id": "RIGHTS-1"},
        }
        group = {
            "source_id": "SRC-1",
            "rights_id": "RIGHTS-1",
            "ai_processing": "PENDING",
        }
        gap = MODULE.describe_permission_gap(route, [group])
        self.assertEqual(gap["basis_state"], "PURPOSE_MEANING_OR_DECISION_PENDING")

    def test_permission_gap_distinguishes_file_binding_shortfall(self):
        route = {
            "file_id": "FILE-1",
            "source_id": "SRC-1",
            "sha256": "abc",
            "rights_record": {"effective_rights_id": "RIGHTS-COMPONENT"},
        }
        unrelated = {
            "source_id": "SRC-1",
            "rights_id": "RIGHTS-DATA",
            "ai_processing": "ALLOWED",
        }
        gap = MODULE.describe_permission_gap(route, [unrelated])
        self.assertEqual(gap["basis_state"], "FILE_ASSOCIATION_INSUFFICIENT")

    def test_html_extraction_preserves_heading_table_and_line(self):
        value = """<html><main><h1>Specifications</h1><p>Device text.</p><table><tr><th>Feature</th><th>Value</th></tr><tr><td><strong>Battery</strong></td><td></td></tr><tr><td>Voltage</td><td>12 V</td></tr></table></main></html>"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.html"
            path.write_text(value, encoding="utf-8")
            items, info = MODULE.extract_html_items(path)
        self.assertEqual(info["scope"], "MAIN_OR_ARTICLE")
        self.assertTrue(any(item["kind"] == "heading" and item["text"] == "Specifications" for item in items))
        row = next(item for item in items if item["kind"] == "table_row" and item["cells"][0] == "Voltage")
        self.assertEqual(row["cells"][1], "12 V")
        self.assertGreaterEqual(row["source_locator"]["html_line"], 1)
        category = next(item for item in items if item["kind"] == "table_row" and item["cells"][0] == "Battery")
        self.assertTrue(category["cell_emphasis"][0])

    def test_parameter_value_contract(self):
        self.assertEqual(MODULE.parse_parameter_value("< 10 mA")["relation"], "UPPER_BOUND_EXCLUSIVE")
        self.assertEqual(MODULE.parse_parameter_value("36 to 48")["values"], [36.0, 48.0])
        self.assertEqual(MODULE.parse_parameter_value("-10 °C to +50 °C")["unit"], "degC")
        self.assertEqual(MODULE.parse_parameter_value("")["relation"], "UNSPECIFIED_IN_CAPTURED_HTML")

    def test_experiment_csv_outputs_real_records_and_statistics(self):
        csv_text = (
            "Data_Point,Test_Time,DateTime,Step_Time,Step_Index,Cycle_Index,Current,Voltage,Charge_Capacity,Discharge_Capacity,Charge_Energy,Discharge_Energy,dV/dt,Internal_Resistance,Temperature\n"
            "0,0,1498880750,0,1,1,1.0,3.1,0.1,0,0.3,0,0.01,0.02,25\n"
            "1,1,1498880751,1,1,1,1.1,3.2,0.2,0,0.6,0,0.02,0.02,26\n"
            "2,2,1498880752,2,1,1,1.2,3.3,0.3,0,0.9,0,0.03,,27\n"
        )
        route = {
            "source_id": "SRC-17",
            "file_id": "FILE-17",
            "document_version_id": "v1",
            "relative_path": "sample.csv",
            "sha256": "registered",
            "byte_size_registered": len(csv_text.encode("utf-8")),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sample.csv"
            source.write_text(csv_text, encoding="utf-8")
            out = root / "out"
            out.mkdir()
            summary, count = MODULE.process_experiment_csv(
                route, source, out, {"rights_id": "RIGHTS-17"}
            )
            rows = MODULE.read_jsonl(out / "FILE-17_selected_records.jsonl")
        self.assertEqual(summary["row_count"], 3)
        self.assertEqual(summary["numeric_statistics"]["Voltage"]["max"], 3.3)
        self.assertEqual(summary["numeric_statistics"]["Internal_Resistance"]["missing"], 1)
        self.assertEqual(summary["missing_value_examples"]["Internal_Resistance"][0]["source_row"], 4)
        self.assertEqual(summary["processing_status"], "LOCALLY_CHECKED_WITH_SOURCE_MISSING_VALUES_NEEDS_REVIEW")
        self.assertEqual(count, 3)
        self.assertEqual(rows[0]["values"]["Current"], 1.0)
        self.assertIsNone(rows[2]["values"]["Internal_Resistance"])


if __name__ == "__main__":
    unittest.main()
