"""Serve the CURRENT database through the retained 4 November predecessor application.

Both applications have the same server code, schema and 25 receipts, so ordinary reads and
writes stay available; only the web client returns to the 4 November version. The
predecessor's own older data directory is never served."""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parent / "upgrade-and-run.py"
spec = importlib.util.spec_from_file_location("release_launcher", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

if __name__ == "__main__": launcher.launch(rollback=True)
