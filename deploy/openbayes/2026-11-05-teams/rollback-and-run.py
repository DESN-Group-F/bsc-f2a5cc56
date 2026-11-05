"""Serve the CURRENT database through the retained 5 November wrap-up predecessor application.

The schema and the 25 receipts are the same, so ordinary reads and writes stay available. The
web client returns to the wrap-up version, and a sign-in inside a Teams frame gets the ordinary
session cookie again (it then works only in the browser). This release's gateway stays in front.
The predecessor's own older data directory is never served."""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parent / "upgrade-and-run.py"
spec = importlib.util.spec_from_file_location("release_launcher", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

if __name__ == "__main__": launcher.launch(rollback=True)
