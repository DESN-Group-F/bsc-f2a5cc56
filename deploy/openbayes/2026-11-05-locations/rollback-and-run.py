"""Serve the CURRENT database through the retained 5 November Teams embedding predecessor application.

The schema and the 25 receipts are the same, so ordinary reads and writes stay available. The
web client returns to the Teams embedding version, which accepts only J18 for storage: records
already stored in E10 or G17 stay readable (shown as unavailable locations), but saving ANY
change to such a battery from that client moves its storage to J18, so leave them unedited until
`restore`. This release's gateway stays in front.
The predecessor's own older data directory is never served."""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parent / "upgrade-and-run.py"
spec = importlib.util.spec_from_file_location("release_launcher", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

if __name__ == "__main__": launcher.launch(rollback=True)
