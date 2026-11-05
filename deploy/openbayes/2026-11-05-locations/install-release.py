"""Install a checksum-pinned GitHub release without replacing server business data."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import time
import urllib.parse
import urllib.request
import uuid
import zipfile

DEPLOYMENT = "2026-11-05-locations-1.0.0"
VERSION = "1.0.0"
PREVIOUS_DEPLOYMENT = "2026-11-05-teams-embedding-1.0.0"
PREVIOUS_COMMIT = "02189d14e6a6bd704ae83c78fdcbd521cf387929"
PREVIOUS_MIGRATIONS = 25
MIGRATIONS = 25
PUBLIC_ORIGIN = "https://zztv-battery.gear-c1.openbayes.net"
RELEASE_URL = "https://github.com/DESN-Group-F/bsc-f2a5cc56/releases/download/battery-inventory-v1.0.0-locations-20261105/release.zip"
DOWNLOAD_HOSTS = {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
MAX_DOWNLOAD = 60_000_000
MAX_EXPANDED = 100_000_000
ADAPTERS = {"runtime.mjs", "runtime-owner.mjs", "upgrade-and-run.py", "rollback-and-run.py", "preservation.py", "http-gateway.mjs", "install-release.py", "qualify-linux.py", "qualification-fixture.mjs", "test-launcher.py", "cutover.py", "README.md", "migration-compatibility.json"}
REQUIRED = ADAPTERS | {"dist/server/index.js", "drizzle/meta/_journal.json"}
BUILD_METADATA = {"dist/client/.assetsignore", "dist/client/.vite/manifest.json", "dist/server/.vite/manifest.json"}


def checked_url(url, initial=False):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in DOWNLOAD_HOSTS
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.fragment or (initial and url != RELEASE_URL)):
        raise RuntimeError("The download must use the reviewed HTTPS GitHub release.")
    return url


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        checked_url(newurl)
        return super().redirect_request(request, response, code, message, headers, newurl)


def download(url, expected_sha256):
    checked_url(url, initial=True)
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise RuntimeError("The reviewed archive SHA-256 is required.")
    opener = urllib.request.build_opener(GitHubRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": "Battery-Inventory-Release/1.0"})
    with opener.open(request, timeout=60) as response:
        checked_url(response.url)
        payload = response.read(MAX_DOWNLOAD + 1)
    if len(payload) > MAX_DOWNLOAD or hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise RuntimeError("The downloaded release does not match its reviewed checksum.")
    return payload


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError("Duplicate manifest keys are not allowed.")
        result[key] = value
    return result


def safe_name(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and bool(path.parts) and ".." not in path.parts
            and "\\" not in name and ":" not in name and "\x00" not in name
            and str(path) == name and all(part not in ("", ".") for part in path.parts))


def allowed_file(name):
    if name in BUILD_METADATA:
        return True
    return (name in ADAPTERS or name.startswith(("dist/server/", "dist/client/", "drizzle/", "migrations/"))) and not any(
        part.startswith(".") or part in ("node_modules", "mobile", "desktop", "work")
        or part.endswith((".sqlite", ".sqlite3", ".db")) for part in PurePosixPath(name).parts)


def verified_archive(payload, expected_sha256, source_commit):
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise RuntimeError("The reviewed immutable Git source commit is required.")
    if len(payload) > MAX_DOWNLOAD or hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise RuntimeError("The archive checksum does not match the reviewed release.")
    records = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > 10_000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED:
            raise RuntimeError("The release archive has an unexpected size.")
        for entry in entries:
            if (not safe_name(entry.filename) or entry.filename in records or entry.is_dir()
                    or (entry.external_attr >> 16) & 0o170000 != 0o100000
                    or (entry.filename != "deployment.json" and not allowed_file(entry.filename))):
                raise RuntimeError("Unsafe or unexpected release archive entry.")
            records[entry.filename] = archive.read(entry)
    if "deployment.json" not in records:
        raise RuntimeError("The release manifest is missing.")
    manifest = json.loads(records["deployment.json"], object_pairs_hook=strict_object)
    if (manifest.get("deploymentName") != DEPLOYMENT or manifest.get("applicationVersion") != VERSION
            or manifest.get("sourceCommit") != source_commit or manifest.get("mobilePrototypeIncluded") is not False
            or manifest.get("sealedSource") is not True or manifest.get("publicOrigin") != PUBLIC_ORIGIN
            or manifest.get("previousDeploymentName") != PREVIOUS_DEPLOYMENT or manifest.get("previousSourceCommit") != PREVIOUS_COMMIT
            or manifest.get("sourceManifestScope") != "complete-sealed-git-source"
            or not isinstance(manifest.get("files"), list)):
        raise RuntimeError("The manifest does not identify the reviewed application release.")
    names = set()
    for record in manifest["files"]:
        name, digest = record.get("path"), record.get("sha256")
        if (not isinstance(name, str) or not safe_name(name) or not allowed_file(name)
                or name in names or name not in records or not isinstance(digest, str)
                or hashlib.sha256(records[name]).hexdigest() != digest):
            raise RuntimeError("The archive does not match its exact file manifest.")
        names.add(name)
    if names != set(records) - {"deployment.json"} or not REQUIRED.issubset(names):
        raise RuntimeError("The release manifest omits or invents application files.")
    journal = json.loads(records["drizzle/meta/_journal.json"])
    migrations = [entry["tag"] + ".sql" for entry in journal["entries"]]
    supplied = {name.removeprefix("drizzle/") for name in names if name.startswith("drizzle/") and name.endswith(".sql")}
    if (len(migrations) != MIGRATIONS or len(set(migrations)) != MIGRATIONS or set(migrations) != supplied
            or [name[:4] for name in migrations] != [f"{number:04d}" for number in range(MIGRATIONS)]):
        raise RuntimeError("The update must include exactly the twenty-five accepted migrations.")
    compatibility = json.loads(records["migration-compatibility.json"], object_pairs_hook=strict_object)
    if compatibility.get("deploymentName") != DEPLOYMENT or compatibility.get("previousDeploymentName") != PREVIOUS_DEPLOYMENT or compatibility.get("previousSourceCommit") != PREVIOUS_COMMIT or len(compatibility.get("entries", [])) != MIGRATIONS or records.get("migrations/meta/_journal.json") != records["drizzle/meta/_journal.json"]:
        raise RuntimeError("The release migration compatibility identity differs.")
    for index, (entry, record) in enumerate(zip(journal["entries"], compatibility["entries"])):
        name = entry["tag"]
        if entry["idx"] != index or record["name"] != name or record.get("previouslyApplied") is not True or hashlib.sha256(records[f"drizzle/{name}.sql"]).hexdigest() != record["sourceSha256"] or hashlib.sha256(records[f"migrations/{name}.sql"]).hexdigest() != record["sha256"]:
            raise RuntimeError("The accepted source or applied migration byte hash differs.")
    source_records = manifest.get("sourceFiles", [])
    if not source_records or hashlib.sha256(json.dumps(source_records, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest() != manifest.get("sourceSnapshotSha256"):
        raise RuntimeError("The complete sealed source identity changed.")
    return records


def install(project, payload, expected_sha256, source_commit):
    records = verified_archive(payload, expected_sha256, source_commit)
    project = project.resolve(strict=True)
    releases = project / "releases"
    release = releases / DEPLOYMENT
    if releases.is_symlink() or release.is_symlink():
        raise RuntimeError("Linked release directories cannot be overwritten.")
    if release.exists():
        for name, content in records.items():
            file = release / name
            internal = (parent for parent in (file, *file.parents) if parent == release or parent.is_relative_to(release))
            if any(parent.is_symlink() for parent in internal) or not file.is_file() or file.read_bytes() != content:
                raise RuntimeError("An existing release differs; it will not be overwritten.")
    else:
        releases.mkdir(exist_ok=True)
        pending = releases / (".download-" + uuid.uuid4().hex)
        pending.mkdir(mode=0o700)
        for name, content in records.items():
            file = pending / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
            file.chmod(0o600)
        for attempt in range(10):
            try:
                pending.rename(release)
                break
            except PermissionError:
                if release.exists() or attempt == 9: raise
                time.sleep(0.2)
    print(json.dumps({"event": "github_release_verified", "deploymentName": DEPLOYMENT,
                      "sourceCommit": source_commit, "sha256": expected_sha256, "files": len(records)}), flush=True)
    return release


def reviewed_project():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("This installer is for the existing Linux server.")
    expected = os.environ.get("INVENTORY_EXPECTED_SAVED_HOME_EXECUTION")
    if not expected or expected != os.environ.get("INVENTORY_RESTORED_FROM_EXECUTION"):
        raise RuntimeError("The latest server saved home must be explicitly reviewed.")
    project = Path("/openbayes/home/battery-inventory").resolve(strict=True)
    previous = project / ("data-" + PREVIOUS_DEPLOYMENT)
    if previous.is_symlink() or not previous.is_dir() or not (project / "releases" / PREVIOUS_DEPLOYMENT).is_dir():
        raise RuntimeError("The current 5 November Teams embedding release and its business database are missing.")
    return project


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=RELEASE_URL)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--install-only", action="store_true", required=True, help="Verify and stage the update while the existing application keeps serving; cutover.py starts it.")
    args = parser.parse_args()
    project = reviewed_project()
    payload = download(args.url, args.sha256)
    install(project, payload, args.sha256, args.source_commit)
    print(json.dumps({"event": "release_staged_only", "deploymentName": DEPLOYMENT, "sourceCommit": args.source_commit, "businessDatabaseOpened": False, "runtimeStarted": False}), flush=True)


if __name__ == "__main__":
    main()
