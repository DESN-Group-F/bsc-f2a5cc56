"""Create a local unpublished candidate archive; never upload, install or launch it."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile
from preservation import NAME, PREVIOUS, PREVIOUS_COMMIT, PUBLIC_ORIGIN, MIGRATIONS, canonical, digest, verify_bundle

ROOT = Path(__file__).resolve().parent
ADAPTERS = ("runtime.mjs", "runtime-owner.mjs", "launch.py", "preservation.py", "README.md")
BUILD_METADATA = {"dist/client/.assetsignore", "dist/client/.vite/manifest.json", "dist/server/.vite/manifest.json"}


def allowed_archive_path(name):
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name or str(relative) != name:
        raise RuntimeError("Unsafe archive path.")
    if any(part.startswith(".") for part in relative.parts) and name not in BUILD_METADATA:
        raise RuntimeError("Unexpected hidden build content.")
    if any(part in {"node_modules", "work", "mobile", "desktop", "credentials"} for part in relative.parts) or relative.suffix.lower() in {".sqlite", ".db", ".pem", ".key", ".pfx", ".env", ".log"} or any(word in relative.name.lower() for word in ("credential", "password", "bootstrap")):
        raise RuntimeError("Private or unrelated content cannot enter the candidate.")
    if not (name.startswith(("dist/server/", "dist/client/", "drizzle/", "migrations/")) or name in {*ADAPTERS, "http-gateway.mjs", "source-manifest.mjs", "migration-compatibility.json", "candidate.json"}):
        raise RuntimeError("Unexpected candidate archive content.")


def verify_archive(payload, sha256):
    if digest(payload) != sha256: raise RuntimeError("The candidate archive checksum changed.")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        records = {}
        for entry in archive.infolist():
            allowed_archive_path(entry.filename)
            if entry.is_dir() or entry.filename in records or (entry.external_attr >> 16) & 0o170000 != 0o100000:
                raise RuntimeError("Duplicate, nonregular or directory archive content.")
            records[entry.filename] = archive.read(entry)
        manifest = json.loads(records["candidate.json"])
        if manifest.get("localOnly") is not True or manifest.get("unsealed") is not True or manifest.get("sourceCommit") is not None:
            raise RuntimeError("A candidate must not claim a sealed published source commit.")
        expected = {record["path"]: record["sha256"] for record in manifest["files"]}
        if len(expected) != len(manifest["files"]) or set(records) != {*expected, "candidate.json"}:
            raise RuntimeError("The complete archive file manifest differs.")
        if any(digest(records[name]) != sha256 for name, sha256 in expected.items()):
            raise RuntimeError("Archive content does not match its exact manifest.")
        return manifest


def package(source, output, node="node"):
    source, output = source.resolve(), output.resolve()
    if not output.is_relative_to(source / "work"):
        raise RuntimeError("Candidate outputs must stay under the selected source's ignored work directory.")
    helper = source / "deploy/integration/source-manifest.mjs"
    program = "import {pathToFileURL} from 'node:url'; const helper=await import(pathToFileURL(process.argv[1]).href); process.stdout.write(JSON.stringify(await helper.collectIntegrationSourceManifest(process.argv[2])));"
    identity = json.loads(subprocess.check_output([node, "--input-type=module", "-e", program, str(helper), str(source)], text=True, encoding="utf-8"))
    if digest(canonical(identity["files"])) != identity["sourceSnapshotSha256"]:
        raise RuntimeError("The shared integration source identity differs.")
    if json.loads((source / "package.json").read_text(encoding="utf-8"))["version"] != "1.0.0":
        raise RuntimeError("The accepted application version must remain 1.0.0.")
    records = {}
    for folder in ("dist/server", "dist/client", "drizzle"):
        root = source / folder
        if not root.is_dir() or root.is_symlink(): raise RuntimeError("Required unlinked candidate build content is unavailable.")
        for file in sorted(root.rglob("*")):
            if file.is_symlink(): raise RuntimeError("Linked build or migration content is not allowed.")
            if file.is_file():
                name = file.relative_to(source).as_posix(); allowed_archive_path(name); records[name] = file.read_bytes()
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
    records["migration-compatibility.json"] = (json.dumps({"candidateName": NAME, "previousDeploymentName": PREVIOUS, "previousSourceCommit": PREVIOUS_COMMIT, "entries": migration_records}, indent=2) + "\n").encode("utf-8")
    for name in ADAPTERS: records[name] = (ROOT / name).read_bytes()
    for name in ("http-gateway.mjs", "source-manifest.mjs"): records[name] = (source / "deploy/integration" / name).read_bytes()
    files = [{"path": name, "sha256": digest(content)} for name, content in sorted(records.items())]
    build = [record for record in files if record["path"].startswith("dist/")]
    adapters = [{"path": "deploy/openbayes/integration-candidate/" + name, "sha256": digest((ROOT / name).read_bytes())} for name in (*ADAPTERS, "package-candidate.py")]
    manifest = {"candidateName": NAME, "applicationVersion": "1.0.0", "localOnly": True, "unsealed": True, "sourceCommit": None, "acceptedBaseCommit": PREVIOUS_COMMIT, "previousDeploymentName": PREVIOUS, "previousSourceCommit": PREVIOUS_COMMIT, "targetPublicOrigin": PUBLIC_ORIGIN, "migrationCount": MIGRATIONS, "newMigrationCount": 0, "mobilePrototypeIncluded": False, "runtimeDependenciesVendored": False, "sourceSnapshotSha256": identity["sourceSnapshotSha256"], "sourceFiles": identity["files"], "adapterSnapshotSha256": digest(canonical(adapters)), "adapterSourceFiles": adapters, "buildSnapshotSha256": digest(canonical(build)), "buildAssociation": "Captured alongside the current unsealed source after a caller-owned local production build.", "gatewaySha256": digest(records["http-gateway.mjs"]), "files": files}
    records["candidate.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(records.items()):
            allowed_archive_path(name)
            entry = zipfile.ZipInfo(name, (2026, 10, 13, 0, 0, 0)); entry.compress_type = zipfile.ZIP_DEFLATED; entry.external_attr = 0o100644 << 16; archive.writestr(entry, content)
    payload = buffer.getvalue(); sha256 = digest(payload); verify_archive(payload, sha256)
    output.mkdir(parents=True, exist_ok=True)
    (output / "candidate.zip").write_bytes(payload)
    (output / "candidate.zip.sha256").write_text(sha256 + "  candidate.zip\n", encoding="utf-8")
    result = {"candidateName": NAME, "localOnly": True, "unsealed": True, "sourceCommit": None, "archiveSha256": sha256, "sourceSnapshotSha256": manifest["sourceSnapshotSha256"], "buildSnapshotSha256": manifest["buildSnapshotSha256"], "gatewaySha256": manifest["gatewaySha256"], "migrationCount": MIGRATIONS, "files": len(records), "archiveBytes": len(payload)}
    (output / "package-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=ROOT.parents[2], type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    print(json.dumps(package(args.source, args.output, args.node), indent=2))
