"""Serve the CURRENT database through the retained 5 November storage-buildings predecessor application.

The schema and the 25 receipts are the same, so ordinary reads and writes stay available. The
web client returns to the storage-buildings version, which accepts NFC only in the Demonstration
inventory: records already made by NFC in the Working inventory stay readable with their full
evidence, but new Working NFC lookups and writes are refused (400 `native_nfc_demo_only` or 501),
so staff use manual selection there until `restore`. This release's gateway stays in front.
The predecessor's own older data directory is never served."""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parent / "upgrade-and-run.py"
spec = importlib.util.spec_from_file_location("release_launcher", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

if __name__ == "__main__": launcher.launch(rollback=True)
