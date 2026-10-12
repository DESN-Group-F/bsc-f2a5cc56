"""Test archive and preservation guards using disposable synthetic SQLite data only."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import zipfile
from preservation import NAME, PREVIOUS, PREVIOUS_COMMIT, MIGRATIONS, acquire_lock, database_file, digest, expected_migrations, prepare_database, snapshot, verify_bundle

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("candidate_packager", ROOT / "package-candidate.py")
packager = importlib.util.module_from_spec(spec); spec.loader.exec_module(packager)
checks = []


def passed(name): checks.append({"name": name, "passed": True})


def rejects(action):
    try: action()
    except (RuntimeError, ValueError, KeyError, FileNotFoundError, json.JSONDecodeError): return
    raise AssertionError("An unsafe candidate operation unexpectedly succeeded.")


def fixture(project, release, expected):
    project.mkdir()
    previous = project / "releases" / PREVIOUS; previous.mkdir(parents=True)
    for directory in ("drizzle", "migrations"): shutil.copytree(release / directory, previous / directory)
    (previous / "deployment.json").write_text(json.dumps({"deploymentName": PREVIOUS, "applicationVersion": "1.0.0", "sourceCommit": PREVIOUS_COMMIT}), encoding="utf-8")
    data = project / ("data-" + PREVIOUS); (data / "d1").mkdir(parents=True)
    file = data / "d1/fixture.sqlite"
    db = sqlite3.connect(file)
    db.executescript("CREATE TABLE staff_accounts(id TEXT PRIMARY KEY,active INTEGER NOT NULL,role TEXT NOT NULL); CREATE TABLE portable_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL); CREATE TABLE typed_evidence(id INTEGER PRIMARY KEY,unknown_value,empty_text TEXT,unicode_text TEXT,raw_blob BLOB,large_integer INTEGER,recorded_real REAL);")
    db.executemany("INSERT INTO staff_accounts VALUES(?,1,?)", [(f"fictional-account-{index}", "admin" if index == 0 else "staff") for index in range(8)])
    db.executemany("INSERT INTO portable_migrations VALUES(?,?,?)", [(name, sha256, "2026-10-12T00:00:00.000Z") for name, sha256 in expected.items()])
    db.execute("INSERT INTO typed_evidence VALUES(1,NULL,'',?,?,?,?)", ("Controlled Unicode evidence é", b"\x00\xff\x00", 9223372036854775806, -0.125))
    db.commit(); db.close()
    (data / "upgrade-complete.json").write_text(json.dumps({"deploymentName": PREVIOUS, "migrations": MIGRATIONS, "schemaVerified": True, "originalPreserved": True}), encoding="utf-8")
    return data


def run(source, output, node):
    first = packager.package(source, output, node)
    payload = (output / "candidate.zip").read_bytes()
    second = packager.package(source, output, node)
    assert first == second and payload == (output / "candidate.zip").read_bytes()
    manifest = packager.verify_archive(payload, first["archiveSha256"])
    assert manifest["sourceCommit"] is None and manifest["localOnly"] and manifest["unsealed"]
    assert manifest["newMigrationCount"] == 0 and manifest["migrationCount"] == 23
    passed("the current production build packages deterministically with explicit unsealed source/build/gateway hashes")
    for name in ["../../outside", "dist/server/local.sqlite", "dist/client/.env", "mobile/source.ts", "node_modules/license.txt"]: rejects(lambda name=name: packager.allowed_archive_path(name))
    rejects(lambda: packager.verify_archive(payload, "0" * 64))
    passed("unsafe, private, unrelated and checksum-mismatched archive content is rejected")
    with tempfile.TemporaryDirectory(prefix="candidate-", dir=source / "work", ignore_cleanup_errors=True) as scratch:
        checked_work = Path(scratch).resolve()
        assert checked_work.is_relative_to(source / "work")
        work = Path("\\\\?\\" + str(checked_work)) if os.name == "nt" else checked_work
        release = work / "release"; release.mkdir()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive: archive.extractall(release)
        assert verify_bundle(release) == manifest
        expected = expected_migrations(release)
        compatibility = json.loads((release / "migration-compatibility.json").read_text(encoding="utf-8"))
        first_migration = compatibility["entries"][0]
        assert first_migration["sha256"] != first_migration["sourceSha256"]
        assert digest((release / "migrations" / (first_migration["name"] + ".sql")).read_bytes()) == first_migration["sha256"]
        passed("all 23 accepted migration sources and historical applied sidecars retain their distinct exact hashes")
        unexpected = release / "dist/server/local.sqlite"; unexpected.write_bytes(b"synthetic unexpected database")
        rejects(lambda: verify_bundle(release)); unexpected.unlink()
        passed("unmanifested extracted build content cannot enter the local runtime")
        project = work / "saved-home"; source_data = fixture(project, release, expected)
        source_file = database_file(source_data); original = snapshot(source_file, expected)
        old_environment = {key: os.environ.get(key) for key in ("INVENTORY_EXPECTED_SAVED_HOME_EXECUTION", "INVENTORY_RESTORED_FROM_EXECUTION")}
        try:
            os.environ["INVENTORY_EXPECTED_SAVED_HOME_EXECUTION"] = "synthetic-reviewed-E1"
            os.environ["INVENTORY_RESTORED_FROM_EXECUTION"] = "synthetic-reviewed-E2"
            rejects(lambda: prepare_database(project, release, manifest, expected))
            assert not (project / ("data-" + NAME)).exists()
            os.environ["INVENTORY_RESTORED_FROM_EXECUTION"] = "synthetic-reviewed-E1"
            passed("conflicting explicit restoration identities fail before creating a candidate copy")
            marker = source_data / "upgrade-complete.json"; saved_marker = marker.read_bytes(); marker.write_text("{}", encoding="utf-8")
            rejects(lambda: prepare_database(project, release, manifest, expected)); marker.write_bytes(saved_marker)
            passed("an unverified predecessor completion marker cannot establish a current data source")
            with acquire_lock(project):
                rejects(lambda: acquire_lock(project))
                target = prepare_database(project, release, manifest, expected)
            assert snapshot(database_file(target), expected) == original
            assert snapshot(target / "original-backup.sqlite", expected) == original
            assert snapshot(source_file, expected) == original
            passed("the shared kernel lock excludes another launcher; source, independent backup and copied typed cells are identical")
            incomplete = database_file(target); copied = sqlite3.connect(incomplete); copied.execute("INSERT INTO typed_evidence(id,unicode_text) VALUES(2,'controlled later write')"); copied.commit(); copied.close()
            rejects(lambda: prepare_database(project, release, manifest, expected))
            completed = {"candidateName": NAME, "migrations": MIGRATIONS, "sourceSnapshotSha256": manifest["sourceSnapshotSha256"], "schemaVerified": True}
            (target / "candidate-complete.json").write_text(json.dumps(completed), encoding="utf-8")
            later = snapshot(incomplete, expected)
            assert prepare_database(project, release, manifest, expected) == target and snapshot(incomplete, expected) == later
            assert later != original and snapshot(source_file, expected) == original
            passed("an altered incomplete copy is rejected while a completed restart retains later candidate writes and the predecessor unchanged")
            for key in old_environment: os.environ[key] = "synthetic-reviewed-E2"
            rejects(lambda: prepare_database(project, release, manifest, expected))
            assert snapshot(incomplete, expected) == later and snapshot(source_file, expected) == original
            passed("a completed E1 copy cannot silently stand in for a newly reviewed E2 saved-home source")
            for key in old_environment: os.environ[key] = "synthetic-reviewed-E1"
            backup = target / "original-backup.sqlite"; changed = sqlite3.connect(backup); changed.execute("UPDATE typed_evidence SET empty_text='tampered' WHERE id=1"); changed.commit(); changed.close()
            rejects(lambda: prepare_database(project, release, manifest, expected))
            assert snapshot(incomplete, expected) == later and snapshot(source_file, expected) == original
            passed("a changed retained original backup blocks restart without resetting current or predecessor data")
        finally:
            for key, value in old_environment.items():
                if value is None: os.environ.pop(key, None)
                else: os.environ[key] = value
        if os.name == "nt":
            # Use the verified fixture's extended path for long production chunk names.
            shutil.rmtree(work)
    report = {"passed": True, "checks": len(checks), "results": checks, "archiveSha256": first["archiveSha256"], "syntheticDataOnly": True, "remoteAccess": False}
    (output / "preservation-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--source", default=ROOT.parents[2], type=Path); parser.add_argument("--output", required=True, type=Path); parser.add_argument("--node", default="node")
    args = parser.parse_args(); print(json.dumps(run(args.source.resolve(), args.output.resolve(), args.node), indent=2))
