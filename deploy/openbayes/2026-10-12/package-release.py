"""Package a reviewed web source commit for checksum-pinned GitHub distribution."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import runpy
import zipfile

ROOT = Path(__file__).resolve().parent
INSTALLER = ROOT / "install-release.py"
NAME = "2026-10-12-workspace-1.0.0"


def package(source_commit, source, source_manifest_path, output, adapters=ROOT):
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise RuntimeError("Supply the sealed and reviewed immutable Git source commit.")
    records = {}
    for folder in ("dist/server", "dist/client", "drizzle"):
        root = source / folder
        if not root.is_dir() or root.is_symlink():
            raise RuntimeError("A required reviewed build directory is missing or linked.")
        for file in sorted(root.rglob("*")):
            if file.is_symlink():
                raise RuntimeError("Linked build content cannot be uploaded.")
            if file.is_file():
                records[file.relative_to(source).as_posix()] = file.read_bytes()
    for name in ("runtime.mjs", "upgrade-and-run.py", "migration-compatibility.json"):
        records[name] = (adapters / name).read_bytes()
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    source_records = []
    source_paths = set()
    for record in source_manifest["records"]:
        if record["path"] in source_paths:
            raise RuntimeError("The reviewed source manifest has duplicate paths.")
        source_paths.add(record["path"])
        content = (source / record["path"]).read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if digest != record["sha256"]:
            raise RuntimeError("Reviewed source files changed after their source manifest was written.")
        source_records.append({"path": record["path"], "sha256": digest})
    for name in ("runtime.mjs", "upgrade-and-run.py", "migration-compatibility.json", "install-release.py"):
        reviewed_path = "deploy/openbayes/2026-10-12/" + name
        actual = INSTALLER.read_bytes() if name == "install-release.py" else records[name]
        if reviewed_path not in source_paths or (source / reviewed_path).read_bytes() != actual:
            raise RuntimeError("A deployment adapter differs from the reviewed source snapshot.")
    source_digest = hashlib.sha256(json.dumps(source_records, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    manifest = {
        "deploymentName": NAME,
        "applicationVersion": "1.0.0",
        "sourceCommit": source_commit,
        "sourceRepository": "https://github.com/DESN-Group-F/bsc-f2a5cc56",
        "sourceSnapshotSha256": source_digest,
        "mobilePrototypeIncluded": False,
        "files": [{"path": name, "sha256": hashlib.sha256(content).hexdigest()} for name, content in sorted(records.items())],
    }
    records["deployment.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(records.items()):
            entry = zipfile.ZipInfo(name, (2026, 10, 12, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content)
    payload = buffer.getvalue()
    digest = hashlib.sha256(payload).hexdigest()
    installer = runpy.run_path(str(INSTALLER), run_name="package_validation")
    installer["verified_archive"](payload, digest, source_commit)
    output.mkdir(parents=True, exist_ok=True)
    (output / "release.zip").write_bytes(payload)
    (output / "release.zip.sha256").write_text(digest + "  release.zip\n", encoding="utf-8")
    result = {"deploymentName": NAME, "sourceCommit": source_commit, "files": len(records),
              "uncompressedBytes": sum(map(len, records.values())), "zipBytes": len(payload), "zipSha256": digest,
              "installerSha256": hashlib.sha256(INSTALLER.read_bytes()).hexdigest(),
              "sourceSnapshotSha256": source_digest, "downloadUrl": installer["RELEASE_URL"]}
    (output / "package-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--adapters", default=ROOT, type=Path)
    args = parser.parse_args()
    package(args.source_commit, args.source.resolve(), args.source_manifest.resolve(), args.output.resolve(), args.adapters.resolve())
