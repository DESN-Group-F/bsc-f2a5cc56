"""Independent regression probes for fidelity and explicit truncation."""
import importlib.util
import json
from pathlib import Path
import h5py
import numpy as np

ROOT = Path(__file__).resolve().parent
RUN = ROOT.parent
fixture = ROOT / "root_reader_fixtures"
fixture.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location("prepared_reader", RUN / "datasets" / "read_ready_data.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
json_path = fixture / "nonfinite_collision.json"
json_path.write_text('{"a":NaN,"b":"__IEEE_NAN__","c":1}', encoding="utf-8")
full = reader.json_tagged_events(json_path, 10)
limited = reader.json_tagged_events(json_path, 1)
events = full["events"]
a = next(x for x in events if x['path'] == 'a')
b = next(x for x in events if x['path'] == 'b')
mat = fixture / "matrix.h5"
with h5py.File(mat, "w") as handle:
    handle.create_dataset("matrix", data=np.arange(15).reshape(3, 5))
mat_result = reader.mat73_slice(mat, "matrix", start=0, count=1)
negative_rejected = False
try:
    reader.bounded_member(fixture / "not_opened.zip", "x", -1)
except ValueError:
    negative_rejected = True
except (FileNotFoundError, OSError):
    pass
result = {
    "scope": "Synthetic values only; no original payload access",
    "checks": [
        {"id": "RR-01", "pass": (a['type'], a['value']) != (b['type'], b['value']),
         "assertion": "Bare NaN and a genuine string matching the implementation sentinel remain distinguishable", "observed": [a, b]},
        {"id": "RR-02", "pass": limited.get('complete') is False,
         "assertion": "A limit of one returned scalar for a three-scalar input reports incomplete output", "observed": limited},
        {"id": "RR-03", "pass": np.asarray(mat_result['values']).size <= 1,
         "assertion": "A generic bounded-slice count must not silently expand over all trailing dimensions unless an explicit row-count/byte-budget contract is provided",
         "observed": {"source_shape": mat_result['source_shape'], "requested_count": 1, "returned_elements": int(np.asarray(mat_result['values']).size)}},
        {"id": "RR-04", "pass": negative_rejected,
         "assertion": "Negative byte budgets are rejected before opening an archive (read(-1) would be unbounded)"},
    ]}
result['status'] = 'PASS' if all(x['pass'] for x in result['checks']) else 'REWORK_REQUIRED'
(ROOT / "root_reader_edges.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': result['status'], 'checks': [{'id': x['id'], 'pass': x['pass']} for x in result['checks']]}))
