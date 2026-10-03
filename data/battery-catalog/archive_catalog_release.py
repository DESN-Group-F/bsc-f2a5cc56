"""Freeze a validated catalog release without changing existing archives."""
import hashlib
import json
import shutil
import sys

sys.dont_write_bytecode = True
from assemble_catalog import INPUTS
from catalog_tool import BASE, CATALOG, digest


def main():
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    report = json.loads((BASE / "validation-report.json").read_text(encoding="utf-8"))
    if report["status"] != "pass" or report["content_sha256"] != digest(data):
        raise ValueError("Only the current validated content can be archived")
    target = BASE / "releases" / data["catalog_version"]
    if target.exists():
        raise ValueError("Released artifacts are immutable; archive already exists")
    paths = ["catalog.json", "catalog.sqlite3", "catalog.schema.json", "sqlite-schema.sql",
             "validation-report.json", "assemble_catalog.py", "catalog_tool.py", "catalog-plan.json",
             "catalog-classification.json", "catalog-review-log.json", "update_catalog_document.py",
             "archive_catalog_release.py"] + ["research/" + name for name in INPUTS]
    reviews = json.loads((BASE / "catalog-review-log.json").read_text(encoding="utf-8"))
    paths.extend(name for entry in reviews["releases"] for name in entry["audit_files"])
    paths.extend("research/" + p.name for p in (BASE / "research").glob("batch2-audit-*.json"))
    paths.append("research/batch3-scope-evidence.json")
    sources = [(name, BASE / name) for name in sorted(set(paths))]
    sources.append(("battery-catalog.md", BASE.parents[1] / "docs" / "battery-catalog.md"))
    for _, source in sources:
        if not source.is_file():
            raise ValueError(f"Missing release artifact: {source}")
    target.mkdir(parents=True)
    manifest = {}
    for name, source in sources:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        manifest[name] = hashlib.sha256(destination.read_bytes()).hexdigest()
    (target / "artifact-sha256.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "archived", "catalog_version": data["catalog_version"], "artifacts": len(manifest)}))


if __name__ == "__main__":
    main()
