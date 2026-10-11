"""Verify a supplied release and preserve the latest native-account database."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import sqlite3
import struct
import subprocess
import sys
import time
import uuid

DEPLOYMENT = "2026-10-12-workspace-1.0.0"
PREVIOUS_DEPLOYMENT = "2026-10-08-teaching-groups"
PREVIOUS_MIGRATIONS = 21
MIGRATIONS = 23
PREVIOUS_COMMIT = "14e18151e52184b24d4b941f1057c78c34a88b09"
MINIMUM_ACCOUNTS = 8
RUNTIME_VERSIONS = {"miniflare": "4.20260515.0", "workerd": "1.20260515.1"}


def log(event, **values):
    print(json.dumps(dict(event=event, **values)), flush=True)


def publish_directory(pending, target):
    for attempt in range(10):
        try:
            pending.rename(target)
            return
        except PermissionError:
            if target.exists() or attempt == 9:
                raise
            time.sleep(0.2)


def quote(value):
    return '"' + value.replace('"', '""') + '"'


def cell(value, kind):
    if kind == "null":
        return [kind]
    if kind == "integer":
        return [kind, str(value)]
    if kind == "real":
        return [kind, struct.pack(">d", value).hex()]
    if kind == "text":
        return [kind, value.encode("utf-8").hex()]
    if kind == "blob":
        return [kind, value.hex()]
    raise RuntimeError("Unsupported SQLite storage type.")


def database_file(data):
    files = [file for file in (data / "d1").rglob("*.sqlite") if file.name != "metadata.sqlite"]
    if len(files) != 1:
        raise RuntimeError("Exactly one existing inventory SQLite database is required.")
    return files[0]


def snapshot(file, expected, required_count=None):
    db = sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        if db.execute("PRAGMA quick_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Database integrity or foreign keys failed.")
        if db.execute("SELECT COUNT(*) FROM staff_accounts").fetchone()[0] < MINIMUM_ACCOUNTS or db.execute("SELECT COUNT(*) FROM staff_accounts WHERE active=1 AND role='admin'").fetchone()[0] < 1:
            raise RuntimeError("The latest native accounts and an active administrator are required.")
        receipts = list(db.execute("SELECT name,sha256 FROM portable_migrations ORDER BY name"))
        count = len(receipts)
        if count < PREVIOUS_MIGRATIONS or count > MIGRATIONS or (required_count is not None and count != required_count) or receipts != list(expected.items())[:count]:
            raise RuntimeError("Migration receipts are not the exact verified journal prefix.")
        result = {}
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name"):
            columns = [row[1] for row in db.execute("PRAGMA table_info(" + quote(name) + ")")]
            expressions = [item for field in columns for item in (quote(field), "typeof(" + quote(field) + ")")]
            rows = [json.dumps([cell(row[index], row[index + 1]) for index in range(0, len(row), 2)], separators=(",", ":")) for row in db.execute("SELECT " + ",".join(expressions) + " FROM " + quote(name))]
            rows.sort()
            result[name] = {"columns": columns, "count": len(rows), "sha256": hashlib.sha256("\n".join(rows).encode()).hexdigest()}
        return result
    finally:
        db.close()


def verify_restore():
    expected = os.environ.get("INVENTORY_EXPECTED_SAVED_HOME_EXECUTION", "")
    restored = os.environ.get("INVENTORY_RESTORED_FROM_EXECUTION", "")
    if not expected or not restored or restored != expected:
        raise RuntimeError("The restored saved home must match the explicitly reviewed latest execution.")
    return restored


def verify_bundle(release):
    manifest = json.loads((release / "deployment.json").read_text(encoding="utf-8"))
    if manifest.get("deploymentName") != DEPLOYMENT or manifest.get("applicationVersion") != "1.0.0" or not isinstance(manifest.get("files"), list):
        raise RuntimeError("The supplied application release manifest is invalid.")
    listed = set()
    for record in manifest["files"]:
        relative = PurePosixPath(record["path"])
        if relative.is_absolute() or ".." in relative.parts or "\\" in record["path"] or record["path"] in listed:
            raise RuntimeError("Unsafe or duplicate release manifest path.")
        supplied = release / Path(*relative.parts)
        target = supplied.resolve()
        linked = any(parent.is_symlink() for parent in (supplied, *supplied.parents) if parent == release or parent.is_relative_to(release))
        if not target.is_relative_to(release.resolve()) or not target.is_file() or linked or hashlib.sha256(target.read_bytes()).hexdigest() != record["sha256"]:
            raise RuntimeError("Release file does not match its reviewed hash: " + record["path"])
        listed.add(record["path"])
    required = {"runtime.mjs", "upgrade-and-run.py", "migration-compatibility.json", "dist/server/index.js", "drizzle/meta/_journal.json"}
    for folder in (release / "dist", release / "drizzle"):
        for file in folder.rglob("*"):
            if file.is_symlink():
                raise RuntimeError("Linked application or migration content cannot be executed.")
            if file.is_file():
                required.add(file.relative_to(release).as_posix())
    if not required.issubset(listed):
        raise RuntimeError("The release manifest omits application or migration files.")
    return manifest


def prepare_migrations(project, release):
    compatibility = json.loads((release / "migration-compatibility.json").read_text(encoding="utf-8"))
    journal_bytes = (release / "drizzle/meta/_journal.json").read_bytes()
    entries = json.loads(journal_bytes)["entries"]
    records = compatibility.get("entries", [])
    if compatibility.get("deploymentName") != DEPLOYMENT or compatibility.get("previousSourceCommit") != PREVIOUS_COMMIT or compatibility.get("previousDeploymentName") != PREVIOUS_DEPLOYMENT or len(entries) != MIGRATIONS or len(records) != MIGRATIONS:
        raise RuntimeError("All twenty-three reviewed migration records are required.")
    previous = project / "releases" / PREVIOUS_DEPLOYMENT
    previous_manifest = json.loads((previous / "deployment.json").read_text(encoding="utf-8"))
    if previous_manifest.get("deploymentName") != PREVIOUS_DEPLOYMENT or previous_manifest.get("applicationVersion") != "0.7.0":
        raise RuntimeError("The retained current native-account release is required.")
    previous_records = json.loads((previous / "migration-compatibility.json").read_text(encoding="utf-8"))["entries"]
    if len(previous_records) != PREVIOUS_MIGRATIONS:
        raise RuntimeError("The retained release must have twenty-one migration records.")
    previous_journal = json.loads((previous / "migrations/meta/_journal.json").read_text(encoding="utf-8"))["entries"]
    if entries[:PREVIOUS_MIGRATIONS] != previous_journal:
        raise RuntimeError("The already-applied migration journal changed.")
    expected, contents = {}, {}
    for index, (entry, record) in enumerate(zip(entries, records)):
        name = entry["tag"]
        if entry["idx"] != index or name != record["name"] or not name[:4].isdigit() or Path(name).name != name:
            raise RuntimeError("The migration journal order or identity is invalid.")
        source = (release / "drizzle" / (name + ".sql")).read_bytes()
        if hashlib.sha256(source).hexdigest() != record["sourceSha256"]:
            raise RuntimeError("The reviewed migration source changed.")
        if index < PREVIOUS_MIGRATIONS:
            old_record = previous_records[index]
            applied = (previous / "migrations" / (name + ".sql")).read_bytes()
            if old_record["name"] != name or old_record["sha256"] != record["sha256"] or old_record["sourceSha256"] != record["sourceSha256"] or (previous / "drizzle" / (name + ".sql")).read_bytes() != source or applied.replace(b"\r\n", b"\n") != source.replace(b"\r\n", b"\n"):
                raise RuntimeError("An already-applied migration or retained sidecar changed.")
        else:
            applied = source
            if b"\r" in source or source.startswith(b"\xef\xbb\xbf"):
                raise RuntimeError("New migrations require LF without a byte-order mark.")
        if hashlib.sha256(applied).hexdigest() != record["sha256"]:
            raise RuntimeError("The original migration byte hash does not match.")
        expected[name], contents[name] = record["sha256"], applied
    target = release / "migrations"
    if target.exists():
        if (target / "meta/_journal.json").read_bytes() != journal_bytes or any((target / (name + ".sql")).read_bytes() != content for name, content in contents.items()):
            raise RuntimeError("The existing generated migration sidecar changed.")
    else:
        pending = release / (".migrations-" + uuid.uuid4().hex[:12])
        (pending / "meta").mkdir(parents=True)
        (pending / "meta/_journal.json").write_bytes(journal_bytes)
        for name, content in contents.items():
            (pending / (name + ".sql")).write_bytes(content)
        publish_directory(pending, target)
    return expected


def copy_current_database(project, expected):
    restored = verify_restore()
    source, target = project / ("data-" + PREVIOUS_DEPLOYMENT), project / ("data-" + DEPLOYMENT)
    if target.exists():
        marker = json.loads((target / "upgrade-source.json").read_text(encoding="utf-8"))
        if marker.get("deploymentName") != DEPLOYMENT or marker.get("fromDeploymentName") != PREVIOUS_DEPLOYMENT or marker.get("fromSourceCommit") != PREVIOUS_COMMIT or marker.get("originalPreserved") is not True:
            raise RuntimeError("An unknown or incomplete database copy will not be reset.")
        complete = target / "upgrade-complete.json"
        if complete.exists():
            completed = json.loads(complete.read_text(encoding="utf-8"))
            if completed.get("deploymentName") != DEPLOYMENT or completed.get("migrations") != MIGRATIONS:
                raise RuntimeError("The existing completed copy belongs to another release.")
            snapshot(database_file(target), expected, MIGRATIONS)
        else:
            snapshot(database_file(target), expected)
        log("saved_database_copy_retained", completed=complete.exists(), restoredFromExecution=restored)
        return target
    old_marker = json.loads((source / "upgrade-complete.json").read_text(encoding="utf-8"))
    if old_marker.get("deploymentName") != PREVIOUS_DEPLOYMENT or old_marker.get("migrations") != PREVIOUS_MIGRATIONS or old_marker.get("schemaVerified") is not True or old_marker.get("originalPreserved") is not True:
        raise RuntimeError("The latest completed native-account database is required.")
    original = database_file(source)
    before = snapshot(original, expected, PREVIOUS_MIGRATIONS)
    pending = project / (".workspace-copy-" + uuid.uuid4().hex[:12])
    pending.mkdir(mode=0o700)
    destination = pending / original.relative_to(source)
    destination.parent.mkdir(parents=True)
    readonly = sqlite3.connect(original.resolve().as_uri() + "?mode=ro", uri=True)
    copied = sqlite3.connect(destination)
    try:
        readonly.backup(copied)
    finally:
        copied.close()
        readonly.close()
    if snapshot(destination, expected, PREVIOUS_MIGRATIONS) != before or snapshot(original, expected, PREVIOUS_MIGRATIONS) != before:
        raise RuntimeError("The original database changed during backup or the copy differs.")
    receipt = {"deploymentName": DEPLOYMENT, "fromVersion": "0.7.0", "fromDeploymentName": PREVIOUS_DEPLOYMENT, "fromSourceCommit": PREVIOUS_COMMIT, "initialSavedHomeExecution": restored, "originalPreserved": True, "snapshot": before}
    (pending / "upgrade-source.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    publish_directory(pending, target)
    log("database_copy_verified", migrations=PREVIOUS_MIGRATIONS, originalRetained=True, allOriginalCellsPreserved=True, restoredFromExecution=restored, tableCounts={name: row["count"] for name, row in before.items()})
    return target


def acquire_lock(project):
    handle = open(project / ".teaching-deployment.lock", "a+b")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            if not handle.read(1):
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, BlockingIOError):
        handle.close()
        raise RuntimeError("Another inventory deployment or runtime is already running.")
    return handle


def verify_linux_lock(project):
    if os.name == "nt":
        return
    probe = "import fcntl,sys; h=open(sys.argv[1],'a+b');\ntry: fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(0)\nelse: sys.exit(1)"
    checked = subprocess.run([sys.executable, "-c", probe, str(project / ".teaching-deployment.lock")], capture_output=True, timeout=5)
    if checked.returncode != 0:
        raise RuntimeError("The independent process could acquire the runtime lock.")
    log("deployment_kernel_lock_verified", independentAcquisitionRejected=True)


def main():
    local = os.environ.get("INVENTORY_LOCAL_TEST") == "1"
    release = Path(__file__).resolve().parent
    project = Path(os.environ.get("INVENTORY_PROJECT_ROOT", "/openbayes/home/battery-inventory")).resolve()
    if not local and (platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64") or project != Path("/openbayes/home/battery-inventory").resolve() or release != project / "releases" / DEPLOYMENT):
        raise RuntimeError("This release must run inside the preserved Linux saved home.")
    verify_restore()
    with acquire_lock(project) as lease:
        verify_linux_lock(project)
        verify_bundle(release)
        expected = prepare_migrations(project, release)
        modules = project / "releases/0.6.1/runtime/node_modules"
        if local:
            modules = Path(os.environ["INVENTORY_TEST_NODE_MODULES"]).resolve()
        for name, version in RUNTIME_VERSIONS.items():
            if json.loads((modules / name / "package.json").read_text(encoding="utf-8")).get("version") != version:
                raise RuntimeError("The retained runtime dependency version changed: " + name)
        link = release / "node_modules"
        if link.exists() or link.is_symlink():
            if link.resolve() != modules.resolve():
                raise RuntimeError("The existing runtime dependency link differs.")
        else:
            link.symlink_to(modules, target_is_directory=True)
        node = Path(os.environ["INVENTORY_TEST_NODE"]) if local else project / "tools/node-v24.21.0/bin/node"
        if not node.is_file():
            raise RuntimeError("The retained verified Node runtime is unavailable.")
        data = copy_current_database(project, expected)
        environment = {**os.environ, "INVENTORY_BUNDLE_ROOT": str(release), "INVENTORY_DATA_ROOT": str(data), "INVENTORY_LAUNCHER_LOCK_HELD": "1", "PORT": os.environ.get("INVENTORY_PORT", "8081")}
        if os.name != "nt":
            environment["INVENTORY_LAUNCHER_LOCK_FD"] = str(lease.fileno())
        if not local and subprocess.check_output([str(node), "--version"], text=True).strip() != "v24.21.0":
            raise RuntimeError("The retained Node version changed.")
        child = subprocess.Popen([str(node), str(release / "runtime.mjs")], cwd=release, env=environment, start_new_session=os.name != "nt", pass_fds=(lease.fileno(),) if os.name != "nt" else ())
        def shutdown(_signum=None, _frame=None):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        os.killpg(child.pid, signal.SIGKILL)
                    else:
                        child.kill()
                    child.wait()
        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
        try:
            code = child.wait()
        finally:
            shutdown()
        if code:
            raise RuntimeError("The inventory runtime failed; preserved databases were not reset.")


if __name__ == "__main__":
    main()
