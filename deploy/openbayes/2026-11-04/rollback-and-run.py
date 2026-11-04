"""Serve maintenance reads from the retained predecessor build against the CURRENT database."""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parent / "upgrade-and-run.py"
spec = importlib.util.spec_from_file_location("release_launcher", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

if __name__ == "__main__": launcher.launch(rollback=True)
