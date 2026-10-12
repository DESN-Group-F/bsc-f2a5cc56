"""Package complete sealed Git source and its reviewed web build for pinned GitHub distribution."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile
import re
import importlib.util
from preservation import NAME, PREVIOUS, PREVIOUS_COMMIT, PUBLIC_ORIGIN, MIGRATIONS, canonical, digest, safe_file

ROOT = Path(__file__).resolve().parent
ADAPTERS = ("runtime.mjs", "runtime-owner.mjs", "upgrade-and-run.py", "rollback-and-run.py", "rollback-gateway.mjs", "preservation.py", "install-release.py", "qualify-linux.py", "qualification-fixture.mjs", "README.md")
BUILD_METADATA = {"dist/client/.assetsignore", "dist/client/.vite/manifest.json", "dist/server/.vite/manifest.json"}


def allowed_archive_path(name):
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name or str(relative) != name:
        raise RuntimeError("Unsafe archive path.")
    if any(part.startswith(".") for part in relative.parts) and name not in BUILD_METADATA:
        raise RuntimeError("Unexpected hidden build content.")
    if any(part in {"node_modules", "work", "mobile", "desktop", "credentials"} for part in relative.parts) or relative.suffix.lower() in {".sqlite", ".db", ".pem", ".key", ".pfx", ".env", ".log"} or any(word in relative.name.lower() for word in ("credential", "password", "bootstrap")):
        raise RuntimeError("Private or unrelated content cannot enter the candidate.")
    if not (name.startswith(("dist/server/", "dist/client/", "drizzle/", "migrations/")) or name in {*ADAPTERS, "http-gateway.mjs", "migration-compatibility.json", "deployment.json"}):
        raise RuntimeError("Unexpected candidate archive content.")


def installer():
    spec = importlib.util.spec_from_file_location("release_installer", ROOT / "install-release.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def package(source_commit, source, source_manifest_path, output, build=None):
    source, output = source.resolve(), output.resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit): raise RuntimeError("Supply the sealed and reviewed immutable source commit.")
    build = (build or source).resolve()
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    if source_manifest.get("sourceCommit", source_commit) != source_commit: raise RuntimeError("The reviewed source manifest identifies another commit.")
    source_records, source_names = [], set()
    for record in source_manifest["records"]:
        name = record["path"]
        if name in source_names or digest(safe_file(source, name).read_bytes()) != record["sha256"]:
            raise RuntimeError("Reviewed sealed source bytes changed or contain a duplicate path.")
        source_names.add(name); source_records.append({"path": name, "sha256": record["sha256"]})
    tree = subprocess.check_output(["git", "-C", str(source), "ls-tree", "-r", "--full-tree", "-z", source_commit])
    git_records = {}
    for entry in tree.split(b"\0"):
        if not entry: continue
        metadata, encoded_name = entry.split(b"\t", 1)
        mode, kind, object_id = metadata.decode("ascii").split(" ")
        name = encoded_name.decode("utf-8")
        if mode not in ("100644", "100755") or kind != "blob": raise RuntimeError("The sealed source contains linked or nonregular content.")
        git_records[name] = object_id
    if not git_records or source_names != set(git_records):
        raise RuntimeError("The source manifest must contain every published sealed Git source file, including vendor and catalog inputs.")
    for name, object_id in git_records.items():
        content = safe_file(source, name).read_bytes()
        if hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest() != object_id:
            raise RuntimeError("The exported source bytes differ from their sealed Git object: " + name)
    source_records.sort(key=lambda record: record["path"])
    for name in (*ADAPTERS, "package-release.py", "qualify-linux.py"):
        relative = "deploy/openbayes/2026-10-13/" + name
        if relative not in source_names or safe_file(source, relative).read_bytes() != (ROOT / name).read_bytes():
            raise RuntimeError("An adapter differs from the same sealed source snapshot.")
    if json.loads((source / "package.json").read_text(encoding="utf-8"))["version"] != "1.0.0":
        raise RuntimeError("The accepted application version must remain 1.0.0.")
    records = {}
    for folder in ("dist/server", "dist/client", "drizzle"):
        selected_root = source if folder == "drizzle" else build
        root = selected_root / folder
        if not root.is_dir() or root.is_symlink(): raise RuntimeError("Required unlinked candidate build content is unavailable.")
        for file in sorted(root.rglob("*")):
            if file.is_symlink(): raise RuntimeError("Linked build or migration content is not allowed.")
            if file.is_file():
                name = file.relative_to(selected_root).as_posix(); allowed_archive_path(name); records[name] = file.read_bytes()
    if not BUILD_METADATA.issubset(records) or "dist/server/index.js" not in records:
        raise RuntimeError("The complete production build and exact Vite metadata are required.")
    journal = json.loads(records["drizzle/meta/_journal.json"])
    old_compatibility = json.loads((source / "deploy/openbayes/2026-10-12/migration-compatibility.json").read_text(encoding="utf-8"))
    if len(journal["entries"]) != MIGRATIONS or len(old_compatibility["entries"]) != MIGRATIONS:
        raise RuntimeError("Exactly the accepted 23 migrations are required.")
    migration_records = []
    for index, (entry, previous) in enumerate(zip(journal["entries"], old_compatibility["entries"])):
        name = entry["tag"]
        if entry["idx"] != index or name != previous["name"] or name[:4] != f"{index:04d}": raise RuntimeError("The accepted migration journal changed.")
        original = records[f"drizzle/{name}.sql"]
        # Windows checks out 0000 as the already-applied CRLF bytes. Preserve that input
        # unchanged, and archive the separately hash-verified accepted LF source form.
        source_content = original
        if digest(original) != previous["sourceSha256"]:
            if not previous["lineEndingOnlyDifference"] or digest(original) != previous["sha256"] or digest(original.replace(b"\r\n", b"\n")) != previous["sourceSha256"]:
                raise RuntimeError("An accepted migration source changed.")
            source_content = original.replace(b"\r\n", b"\n")
            records[f"drizzle/{name}.sql"] = source_content
        applied = source_content.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n") if previous["lineEndingOnlyDifference"] else source_content
        if digest(applied) != previous["sha256"]: raise RuntimeError("An accepted applied migration byte hash changed.")
        records[f"migrations/{name}.sql"] = applied
        migration_records.append({"name": name, "sha256": previous["sha256"], "sourceSha256": previous["sourceSha256"], "inputCheckoutSha256": digest(original), "previouslyApplied": True, "lineEndingOnlyDifference": previous["lineEndingOnlyDifference"]})
    if len([name for name in records if name.startswith("drizzle/") and name.endswith(".sql")]) != MIGRATIONS:
        raise RuntimeError("Unexpected migration SQL cannot enter the candidate.")
    records["migrations/meta/_journal.json"] = records["drizzle/meta/_journal.json"]
    records["migration-compatibility.json"] = (json.dumps({"deploymentName": NAME, "previousDeploymentName": PREVIOUS, "previousSourceCommit": PREVIOUS_COMMIT, "entries": migration_records}, indent=2) + "\n").encode("utf-8")
    for name in ADAPTERS: records[name] = (ROOT / name).read_bytes()
    records["http-gateway.mjs"] = safe_file(source, "deploy/integration/http-gateway.mjs").read_bytes()
    if "deploy/integration/http-gateway.mjs" not in source_names: raise RuntimeError("The gateway is absent from the complete sealed source manifest.")
    files = [{"path": name, "sha256": digest(content)} for name, content in sorted(records.items())]
    build = [record for record in files if record["path"].startswith("dist/")]
    manifest = {"deploymentName": NAME, "applicationVersion": "1.0.0", "sealedSource": True, "sourceCommit": source_commit, "sourceRepository": "https://github.com/DESN-Group-F/bsc-f2a5cc56", "previousDeploymentName": PREVIOUS, "previousSourceCommit": PREVIOUS_COMMIT, "publicOrigin": PUBLIC_ORIGIN, "migrationCount": MIGRATIONS, "newMigrationCount": 0, "mobilePrototypeIncluded": False, "runtimeDependenciesVendored": False, "sourceSnapshotSha256": digest(canonical(source_records)), "sourceFiles": source_records, "sourceManifestScope": "complete-sealed-git-source", "buildSnapshotSha256": digest(canonical(build)), "buildAssociation": "The caller supplies the separately reviewed production build for this sealed source.", "gatewaySha256": digest(records["http-gateway.mjs"]), "files": files}
    records["deployment.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(records.items()):
            allowed_archive_path(name)
            entry = zipfile.ZipInfo(name, (2026, 10, 13, 0, 0, 0)); entry.compress_type = zipfile.ZIP_DEFLATED; entry.external_attr = 0o100644 << 16; archive.writestr(entry, content)
    payload = buffer.getvalue(); sha256 = digest(payload); validator = installer(); validator.verified_archive(payload, sha256, source_commit)
    output.mkdir(parents=True, exist_ok=True)
    (output / "release.zip").write_bytes(payload)
    (output / "release.zip.sha256").write_text(sha256 + "  release.zip\n", encoding="utf-8")
    result = {"deploymentName": NAME, "sourceCommit": source_commit, "archiveSha256": sha256, "sourceSnapshotSha256": manifest["sourceSnapshotSha256"], "buildSnapshotSha256": manifest["buildSnapshotSha256"], "gatewaySha256": manifest["gatewaySha256"], "migrationCount": MIGRATIONS, "files": len(records), "archiveBytes": len(payload), "downloadUrl": validator.RELEASE_URL, "installerSha256": digest((ROOT / "install-release.py").read_bytes())}
    (output / "package-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source", default=ROOT.parents[2], type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build", type=Path)
    args = parser.parse_args()
    print(json.dumps(package(args.source_commit, args.source, args.source_manifest, args.output, args.build), indent=2))
