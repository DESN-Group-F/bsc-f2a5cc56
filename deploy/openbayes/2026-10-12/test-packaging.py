"""Exercise GitHub release installer guards using only isolated local fixtures."""

from contextlib import redirect_stdout
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parent
INSTALLER = ROOT / "install-release.py"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True, type=Path)
parser.add_argument("--build-source", type=Path)
args = parser.parse_args()
OUTPUT = args.output.resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
module = runpy.run_path(str(INSTALLER), run_name="installer_fixture")
SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
report = {"checks": []}


def passed(name):
    report["checks"].append(name)


def rejects(call):
    try:
        call()
    except (RuntimeError, ValueError, zipfile.BadZipFile):
        return
    raise AssertionError("An unsafe fixture was accepted.")


def fixture_records():
    records = {name: b"fixture" for name in module["REQUIRED"]}
    journal = {"entries": [{"tag": f"{number:04d}_fixture"} for number in range(23)]}
    records["drizzle/meta/_journal.json"] = json.dumps(journal).encode()
    for entry in journal["entries"]:
        records["drizzle/" + entry["tag"] + ".sql"] = b"SELECT 1;\n"
    records["dist/client/assets/application.js"] = b"console.log('Fixture');\n"
    records["dist/client/.assetsignore"] = b"wrangler.json\n.dev.vars\n.vite\n"
    records["dist/client/.vite/manifest.json"] = b"{}\n"
    records["dist/server/.vite/manifest.json"] = b"{}\n"
    return records


def archive(records, manifest_change=None, extra_entry=None):
    manifest = {"deploymentName": module["DEPLOYMENT"], "applicationVersion": "1.0.0",
                "sourceCommit": SOURCE_COMMIT, "mobilePrototypeIncluded": False,
                "files": [{"path": name, "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(records.items())]}
    if manifest_change:
        manifest_change(manifest)
    body = {**records, "deployment.json": json.dumps(manifest).encode()}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as result:
        for name, data in body.items():
            entry = zipfile.ZipInfo(name)
            entry.external_attr = 0o100644 << 16
            result.writestr(entry, data)
        if extra_entry:
            name, mode = extra_entry
            entry = zipfile.ZipInfo(name)
            entry.external_attr = mode << 16
            result.writestr(entry, b"fixture")
    payload = stream.getvalue()
    return payload, hashlib.sha256(payload).hexdigest()


records = fixture_records()
payload, digest = archive(records)
verified = module["verified_archive"](payload, digest, SOURCE_COMMIT)
assert set(verified) == set(records) | {"deployment.json"}
passed("checksum, source commit, file hashes and all twenty-three migration entries are verified")

fixture_parent = OUTPUT / "packaging-fixtures"
fixture_parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=fixture_parent) as fixture_dir:
    project = Path(fixture_dir)
    with redirect_stdout(io.StringIO()):
        release = module["install"](project, payload, digest, SOURCE_COMMIT)
        before = {name: (release / name).read_bytes() for name in verified}
        assert module["install"](project, payload, digest, SOURCE_COMMIT) == release
    assert all((release / name).read_bytes() == data for name, data in before.items())
    passed("initial install and identical retry preserve every installed byte")
    changed = release / "runtime.mjs"
    changed.write_bytes(b"modified")
    rejects(lambda: module["install"](project, payload, digest, SOURCE_COMMIT))
    assert changed.read_bytes() == b"modified"
    passed("different existing release is rejected without replacing it")

rejects(lambda: module["verified_archive"](payload + b"changed", digest, SOURCE_COMMIT))
rejects(lambda: module["verified_archive"](payload, digest, "f" * 40))
passed("archive corruption and a different source commit are rejected")

for name, mode in (("../outside.txt", 0o100644), ("/outside.txt", 0o100644),
                   ("dist/client/../../outside.txt", 0o100644), ("dist\\outside.txt", 0o100644),
                   ("dist/client/link", 0o120777), ("C:/outside.txt", 0o100644),
                   ("dist/client/.env", 0o100644), ("dist/server/data.sqlite", 0o100644)):
    unsafe, unsafe_hash = archive(records, extra_entry=(name, mode))
    rejects(lambda: module["verified_archive"](unsafe, unsafe_hash, SOURCE_COMMIT))
passed("traversal, absolute paths, links, credentials and databases are rejected before extraction")
for name in ("dist/client/.vite/.env", "dist/server/.vite/secret.json", "dist/client/.assetsignore.bak", "dist/server/.assetsignore"):
    unsafe, unsafe_hash = archive(records, extra_entry=(name, 0o100644))
    rejects(lambda: module["verified_archive"](unsafe, unsafe_hash, SOURCE_COMMIT))
assert all(module["allowed_file"](name) for name in module["BUILD_METADATA"])
passed("only the three exact generated metadata paths are allowed; adjacent hidden files remain rejected")

for change in (lambda manifest: manifest["files"].pop(),
               lambda manifest: manifest["files"].append(manifest["files"][0]),
               lambda manifest: manifest["files"][0].update(sha256="0" * 64),
               lambda manifest: manifest.update(applicationVersion="0.7.0"),
               lambda manifest: manifest.update(mobilePrototypeIncluded=True)):
    unsafe, unsafe_hash = archive(records, manifest_change=change)
    rejects(lambda: module["verified_archive"](unsafe, unsafe_hash, SOURCE_COMMIT))
passed("missing, duplicate or wrong file hashes and incompatible manifest identity fail")

incomplete = {name: data for name, data in records.items() if name != "drizzle/0022_fixture.sql"}
unsafe, unsafe_hash = archive(incomplete)
rejects(lambda: module["verified_archive"](unsafe, unsafe_hash, SOURCE_COMMIT))
passed("a matching file manifest cannot omit a journal migration")

for url in ("http://github.com/file", "https://example.com/file", "https://github.com.attacker.invalid/file",
            "https://github.com@attacker.invalid/file", "https://github.com:8443/file", "https://github.com/file#fragment"):
    rejects(lambda: module["checked_url"](url))
rejects(lambda: module["checked_url"]("https://github.com/other/repo/releases/download/tag/release.zip", initial=True))
assert module["checked_url"](module["RELEASE_URL"], initial=True) == module["RELEASE_URL"]
assert module["checked_url"]("https://release-assets.githubusercontent.com/file?token=fixture")
passed("initial downloads pin the repository and tag; redirects accept only HTTPS GitHub asset hosts")

redirect = module["GitHubRedirect"]()
rejects(lambda: redirect.redirect_request(None, None, 302, "Found", {}, "https://example.com/file"))
passed("redirect host validation happens before any redirected request")

class FakeResponse:
    url = "https://release-assets.githubusercontent.com/fixture"
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False
    def read(self, limit):
        assert limit == module["MAX_DOWNLOAD"] + 1
        return payload


class FakeOpener:
    def open(self, request, timeout):
        assert request.full_url == module["RELEASE_URL"] and timeout == 60
        return FakeResponse()


with patch("urllib.request.build_opener", return_value=FakeOpener()):
    assert module["download"](module["RELEASE_URL"], digest) == payload
    rejects(lambda: module["download"](module["RELEASE_URL"], "0" * 64))
passed("downloaded bytes are bounded and verified against the separately reviewed SHA-256")

with patch.dict(os.environ, {}, clear=True), patch("platform.system", return_value="Linux"), patch("platform.machine", return_value="x86_64"):
    rejects(module["reviewed_project"])
    with patch.dict(os.environ, {"INVENTORY_EXPECTED_SAVED_HOME_EXECUTION": "reviewed", "INVENTORY_RESTORED_FROM_EXECUTION": "different"}):
        rejects(module["reviewed_project"])
passed("missing or conflicting saved-home restoration evidence blocks server startup")

packager = runpy.run_path(str(ROOT / "package-release.py"), run_name="packager_fixture")
with tempfile.TemporaryDirectory(dir=fixture_parent) as fixture_dir:
    fixture = Path(fixture_dir)
    source = fixture / "source"
    adapters = fixture / "adapters"
    output = fixture / "output"
    source.mkdir()
    adapters.mkdir()
    for name, data in records.items():
        target = adapters / name if name in module["ADAPTERS"] else source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    app_source = source / "application.ts"
    app_source.write_bytes(b"export const version = '1.0.0';\n")
    reviewed_adapters = source / "deploy/openbayes/2026-10-12"
    reviewed_adapters.mkdir(parents=True)
    for name in (*module["ADAPTERS"], "install-release.py"):
        content = INSTALLER.read_bytes() if name == "install-release.py" else records[name]
        (reviewed_adapters / name).write_bytes(content)
    source_manifest = fixture / "source-manifest.json"
    reviewed_files = [app_source, *sorted(reviewed_adapters.iterdir())]
    source_manifest.write_text(json.dumps({"records": [{"path": file.relative_to(source).as_posix(), "sha256": hashlib.sha256(file.read_bytes()).hexdigest()} for file in reviewed_files]}))
    with redirect_stdout(io.StringIO()):
        first = packager["package"](SOURCE_COMMIT, source, source_manifest, output, adapters)
        first_zip = (output / "release.zip").read_bytes()
        second = packager["package"](SOURCE_COMMIT, source, source_manifest, output, adapters)
    assert first == second and first_zip == (output / "release.zip").read_bytes()
    module["verified_archive"](first_zip, first["zipSha256"], SOURCE_COMMIT)
    passed("the reusable packager produces deterministic archives accepted by the server installer")
    app_source.write_bytes(b"changed source")
    rejects(lambda: packager["package"](SOURCE_COMMIT, source, source_manifest, output, adapters))
    assert (output / "release.zip").read_bytes() == first_zip
    passed("source bytes changed after review are rejected without replacing the prior package")
    app_source.write_bytes(b"export const version = '1.0.0';\n")
    injected = source / "dist/server/local.sqlite"
    injected.write_bytes(b"database fixture")
    rejects(lambda: packager["package"](SOURCE_COMMIT, source, source_manifest, output, adapters))
    assert (output / "release.zip").read_bytes() == first_zip
    passed("unexpected database content in a build cannot enter the published package")
    injected.unlink()
    (adapters / "runtime.mjs").write_bytes(b"changed adapter")
    rejects(lambda: packager["package"](SOURCE_COMMIT, source, source_manifest, output, adapters))
    assert (output / "release.zip").read_bytes() == first_zip
    passed("deployment adapters must match the same reviewed source snapshot")

actual_zip = OUTPUT / "release.zip"
if args.build_source:
    actual_records = {}
    build_source = args.build_source.resolve()
    for folder in ("dist/server", "dist/client", "drizzle"):
        root = build_source / folder
        assert root.is_dir() and not root.is_symlink()
        for file in root.rglob("*"):
            assert not file.is_symlink()
            if file.is_file():
                actual_records[file.relative_to(build_source).as_posix()] = file.read_bytes()
    for name in module["ADAPTERS"]:
        actual_records[name] = (ROOT / name).read_bytes()
    actual_layout, actual_layout_hash = archive(actual_records)
    module["verified_archive"](actual_layout, actual_layout_hash, SOURCE_COMMIT)
    assert module["BUILD_METADATA"].issubset(actual_records)
    passed("the actual production build layout, including Vite manifests and asset exclusions, passes archive verification")
if actual_zip.exists():
    actual_result = json.loads((OUTPUT / "package-result.json").read_text())
    module["verified_archive"](actual_zip.read_bytes(), actual_result["zipSha256"], actual_result["sourceCommit"])
    passed("the actual packaged web release passes the same installer verification")

report.update(passed=True, installerSha256=hashlib.sha256(INSTALLER.read_bytes()).hexdigest())
(OUTPUT / "package-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
