"""Local structural release tests; all Git source, databases and installs here are synthetic fixtures."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from preservation import NAME, PREVIOUS, PREVIOUS_COMMIT, MIGRATIONS, acquire_lock, database_file, digest, expected_migrations, prepare_database, prepare_rollback, snapshot, verify_bundle

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / (name + ".py"))
    loaded = importlib.util.module_from_spec(spec); spec.loader.exec_module(loaded); return loaded


def rejects(action):
    try: action()
    except (RuntimeError, ValueError, KeyError, FileNotFoundError): return
    raise AssertionError("An unsafe synthetic release operation unexpectedly succeeded.")


def run():
    work = Path(tempfile.mkdtemp(prefix="hosted-adapter-tests-", dir=SOURCE / "work"))
    source, output, project = work / "source", work / "output", work / "home"
    source.mkdir(); project.mkdir()
    packager, installer = module("package-release"), module("install-release")
    checks = []
    def passed(name): checks.append({"name": name, "passed": True})
    for name in (*packager.ADAPTERS, "package-release.py", "test-release.py"):
        file = source / "deploy/openbayes/2026-10-13" / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes((ROOT / name).read_bytes())
    for name in ("deploy/integration/http-gateway.mjs", "deploy/openbayes/2026-10-12/migration-compatibility.json"):
        file = source / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes((SOURCE / name).read_bytes())
    shutil.copytree(SOURCE / "drizzle", source / "drizzle")
    for name, content in {"package.json": '{"version":"1.0.0"}', ".gitignore": "dist/\nwork/\n", "vendor/fixture.js": "export const fixture = true;", "data/battery-catalog/catalog.json": '{"fixture":true}'}.items():
        file = source / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text(content, encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(source)], check=True)
    for key, value in (("user.name", "Fixture"), ("user.email", "fixture@example.invalid"), ("core.autocrlf", "false")):
        subprocess.run(["git", "-C", str(source), "config", key, value], check=True)
    subprocess.run(["git", "-C", str(source), "add", "."], check=True)
    subprocess.run(["git", "-C", str(source), "commit", "-q", "-m", "Synthetic release test fixture"], check=True)
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    paths = subprocess.check_output(["git", "-C", str(source), "ls-tree", "-r", "--full-tree", "--name-only", commit], text=True).splitlines()
    manifest = {"sourceCommit": commit, "records": [{"path": name, "sha256": digest((source / name).read_bytes())} for name in paths]}
    source_manifest = work / "source-manifest.json"; source_manifest.write_text(json.dumps(manifest), encoding="utf-8")
    for name, content in {"dist/server/index.js": "export default {fetch(){return new Response('synthetic structural fixture')}}", "dist/client/index.html": "<!doctype html><title>Synthetic structural fixture</title>", "dist/client/.assetsignore": ".vite/", "dist/client/.vite/manifest.json": "{}", "dist/server/.vite/manifest.json": "{}"}.items():
        file = source / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text(content, encoding="utf-8")
    first = packager.package(commit, source, source_manifest, output)
    payload = (output / "release.zip").read_bytes()
    assert first == packager.package(commit, source, source_manifest, output) and payload == (output / "release.zip").read_bytes()
    records = installer.verified_archive(payload, first["archiveSha256"], commit)
    passed("complete sealed Git fixtures package deterministically and pass exact installer validation")
    incomplete = {**manifest, "records": [record for record in manifest["records"] if not record["path"].startswith("vendor/")]}; source_manifest.write_text(json.dumps(incomplete), encoding="utf-8")
    rejects(lambda: packager.package(commit, source, source_manifest, output)); source_manifest.write_text(json.dumps(manifest), encoding="utf-8")
    assert payload == (output / "release.zip").read_bytes()
    passed("omitted vendor or other committed source cannot be hidden by a subset manifest")
    for url in ("http://github.com/example", "https://untrusted.example/release.zip", "https://github.com:444/example", "https://user@github.com/example"):
        rejects(lambda url=url: installer.checked_url(url))
    rejects(lambda: installer.verified_archive(payload, "0" * 64, commit))
    rejects(lambda: installer.verified_archive(payload, first["archiveSha256"], "0" * 40))
    passed("download hosts, HTTPS, archive checksum and immutable source pins fail closed")
    data = project / ("data-" + PREVIOUS); (data / "d1").mkdir(parents=True)
    db = sqlite3.connect(data / "d1/fixture.sqlite")
    db.executescript("CREATE TABLE staff_accounts(id TEXT PRIMARY KEY,active INTEGER,role TEXT);CREATE TABLE portable_migrations(name TEXT PRIMARY KEY,sha256 TEXT,applied_at TEXT);CREATE TABLE evidence(id INTEGER PRIMARY KEY,unknown_value,text_value TEXT,blob_value BLOB,integer_value INTEGER,real_value REAL);")
    db.executemany("INSERT INTO staff_accounts VALUES(?,1,?)", [(str(index), "admin" if index == 0 else "staff") for index in range(8)])
    compatibility = json.loads(records["migration-compatibility.json"])
    db.executemany("INSERT INTO portable_migrations VALUES(?,?,?)", [(row["name"], row["sha256"], "2026-10-13T00:00:00Z") for row in compatibility["entries"]])
    db.execute("INSERT INTO evidence VALUES(1,NULL,?,?,?,?)", ("Controlled Unicode evidence é", b"\x00\xff", 9223372036854775806, -0.125)); db.commit(); db.close()
    (data / "upgrade-complete.json").write_text(json.dumps({"deploymentName": PREVIOUS, "migrations": 23, "originalPreserved": True, "schemaVerified": True}), encoding="utf-8")
    previous = project / "releases" / PREVIOUS; previous.mkdir(parents=True)
    old_records = {name: content for name, content in records.items() if name.startswith(("dist/", "drizzle/"))}
    for name, content in old_records.items():
        file = previous / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(content)
    for name, content in records.items():
        if name.startswith("migrations/"):
            file = previous / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(content)
    (previous / "deployment.json").write_text(json.dumps({"deploymentName": PREVIOUS, "applicationVersion": "1.0.0", "sourceCommit": PREVIOUS_COMMIT, "files": [{"path": name, "sha256": digest(content)} for name, content in sorted(old_records.items())]}), encoding="utf-8")
    release = installer.install(project, payload, first["archiveSha256"], commit)
    assert installer.install(project, payload, first["archiveSha256"], commit) == release
    assert not (project / ("data-" + NAME)).exists()
    passed("staging is repeatable and creates no current business copy or runtime")
    prior_env = {name: os.environ.get(name) for name in ("INVENTORY_EXPECTED_SAVED_HOME_EXECUTION", "INVENTORY_RESTORED_FROM_EXECUTION", "INVENTORY_RELEASE_SOURCE_COMMIT")}
    try:
        os.environ.update(INVENTORY_EXPECTED_SAVED_HOME_EXECUTION="synthetic-E1", INVENTORY_RESTORED_FROM_EXECUTION="synthetic-E1", INVENTORY_RELEASE_SOURCE_COMMIT=commit)
        supplied = verify_bundle(release); expected = expected_migrations(release); before = snapshot(database_file(data), expected)
        with acquire_lock(project):
            rejects(lambda: acquire_lock(project)); target = prepare_database(project, release, supplied, expected)
        assert snapshot(database_file(target), expected) == before and snapshot(target / "original-backup.sqlite", expected) == before and snapshot(database_file(data), expected) == before
        passed("shared locks and independent typed-cell backup/copy preserve the complete actual predecessor fixture")
        (target / "upgrade-complete.json").write_text(json.dumps({"deploymentName": NAME, "sourceCommit": commit, "migrations": 23, "sourceSnapshotSha256": supplied["sourceSnapshotSha256"], "schemaVerified": True}), encoding="utf-8")
        later_db = sqlite3.connect(database_file(target)); later_db.execute("INSERT INTO evidence(id,text_value) VALUES(2,'Confirmed later current write')"); later_db.commit(); later_db.close(); later = snapshot(database_file(target), expected)
        current, application = prepare_rollback(project, release, supplied, expected)
        assert current == target and application == previous and snapshot(database_file(target), expected) == later
        assert prepare_database(project, release, supplied, expected) == target and snapshot(database_file(target), expected) == later
        assert snapshot(database_file(data), expected) == before
        passed("maintenance rollback and new-version restoration both retain later CURRENT cells without recopying stale stock")
        os.environ["INVENTORY_EXPECTED_SAVED_HOME_EXECUTION"] = os.environ["INVENTORY_RESTORED_FROM_EXECUTION"] = "synthetic-E2"
        rejects(lambda: prepare_database(project, release, supplied, expected)); assert snapshot(database_file(target), expected) == later
        passed("a different unreviewed restored execution cannot silently reuse an older copied state")
    finally:
        for name, value in prior_env.items():
            if value is None: os.environ.pop(name, None)
            else: os.environ[name] = value
    report = {"passed": True, "checks": len(checks), "results": checks, "syntheticDataOnly": True, "remoteAccess": False, "workDirectory": str(work)}
    (SOURCE / "work/deployment-20261013").mkdir(exist_ok=True)
    (SOURCE / "work/deployment-20261013/adapter-structural-verification-r3.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__": run()
