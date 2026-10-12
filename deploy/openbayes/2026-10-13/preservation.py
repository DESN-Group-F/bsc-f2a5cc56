"""Preserve the authoritative current database across a sealed web/server release."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import re
import struct
import time
import uuid
from urllib.parse import quote as uri_quote

NAME = "2026-10-13-web-server-integration-1.0.0-r3"
PREVIOUS = "2026-10-12-workspace-1.0.0"
PREVIOUS_COMMIT = "d0e1640a0c516ba6c68aeae4695b12a8afb12525"
MIGRATIONS = 23
PUBLIC_ORIGIN = "https://zztv-battery.gear-c1.openbayes.net"
RUNTIME_VERSIONS = {"miniflare": "4.20260515.0", "workerd": "1.20260515.1"}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def canonical(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def safe_file(root, name):
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name or str(relative) != name:
        raise RuntimeError("Unsafe candidate path.")
    file = root.joinpath(*relative.parts)
    if not file.resolve().is_relative_to(root.resolve()) or any(item.is_symlink() for item in [file, *file.parents] if item == root or item.is_relative_to(root)) or not file.is_file():
        raise RuntimeError("Missing or linked candidate content: " + name)
    return file


def verify_bundle(root):
    manifest = json.loads(safe_file(root, "deployment.json").read_text(encoding="utf-8"))
    if manifest.get("deploymentName") != NAME or manifest.get("applicationVersion") != "1.0.0" or not re.fullmatch(r"[0-9a-f]{40}", manifest.get("sourceCommit", "")) or manifest.get("sealedSource") is not True or manifest.get("previousDeploymentName") != PREVIOUS or manifest.get("previousSourceCommit") != PREVIOUS_COMMIT or manifest.get("publicOrigin") != PUBLIC_ORIGIN or manifest.get("migrationCount") != MIGRATIONS:
        raise RuntimeError("The sealed 13 October release identity differs.")
    reviewed_commit = os.environ.get("INVENTORY_RELEASE_SOURCE_COMMIT")
    if reviewed_commit is not None and manifest["sourceCommit"] != reviewed_commit:
        raise RuntimeError("The application source commit differs from its explicit reviewed pin.")
    listed = set()
    for record in manifest.get("files", []):
        name = record["path"]
        if name in listed or digest(safe_file(root, name).read_bytes()) != record["sha256"]:
            raise RuntimeError("Changed or duplicate candidate content: " + name)
        listed.add(name)
    required = {"runtime.mjs", "runtime-owner.mjs", "upgrade-and-run.py", "rollback-and-run.py", "preservation.py", "http-gateway.mjs", "rollback-gateway.mjs", "install-release.py", "migration-compatibility.json", "dist/server/index.js", "drizzle/meta/_journal.json", "migrations/meta/_journal.json"}
    if not required.issubset(listed):
        raise RuntimeError("The candidate manifest omits required runtime content.")
    for folder in ("dist", "drizzle", "migrations"):
        for file in (root / folder).rglob("*"):
            if file.is_symlink() or file.is_file() and file.relative_to(root).as_posix() not in listed:
                raise RuntimeError("Unmanifested candidate application or migration content.")
    source = manifest.get("sourceFiles", [])
    if digest(canonical(source)) != manifest.get("sourceSnapshotSha256"):
        raise RuntimeError("The candidate source identity changed.")
    build = [{key: record[key] for key in ("path", "sha256")} for record in manifest["files"] if record["path"].startswith("dist/")]
    if digest(canonical(build)) != manifest.get("buildSnapshotSha256") or manifest.get("gatewaySha256") != next(record["sha256"] for record in manifest["files"] if record["path"] == "http-gateway.mjs"):
        raise RuntimeError("The candidate build or gateway identity changed.")
    return manifest


def expected_migrations(release):
    compatibility = json.loads((release / "migration-compatibility.json").read_text(encoding="utf-8"))
    source_journal = (release / "drizzle/meta/_journal.json").read_bytes()
    if (release / "migrations/meta/_journal.json").read_bytes() != source_journal:
        raise RuntimeError("The candidate migration journals differ.")
    entries = json.loads(source_journal)["entries"]
    records = compatibility.get("entries", [])
    if compatibility.get("previousDeploymentName") != PREVIOUS or compatibility.get("previousSourceCommit") != PREVIOUS_COMMIT or compatibility.get("deploymentName") != NAME or len(entries) != MIGRATIONS or len(records) != MIGRATIONS:
        raise RuntimeError("Exactly 23 unchanged predecessor migrations are required.")
    expected = {}
    for index, (entry, record) in enumerate(zip(entries, records)):
        name = entry["tag"]
        if entry["idx"] != index or name != record["name"] or name[:4] != f"{index:04d}" or Path(name).name != name:
            raise RuntimeError("The migration journal identity changed.")
        source = safe_file(release, f"drizzle/{name}.sql").read_bytes()
        applied = safe_file(release, f"migrations/{name}.sql").read_bytes()
        if digest(source) != record["sourceSha256"] or digest(applied) != record["sha256"] or applied.replace(b"\r\n", b"\n") != source.replace(b"\r\n", b"\n"):
            raise RuntimeError("An accepted migration source or applied sidecar changed.")
        expected[name] = record["sha256"]
    return expected


def reviewed_execution():
    expected = os.environ.get("INVENTORY_EXPECTED_SAVED_HOME_EXECUTION", "")
    restored = os.environ.get("INVENTORY_RESTORED_FROM_EXECUTION", "")
    if not expected or expected != restored:
        raise RuntimeError("The restored saved home must match the explicitly reviewed execution identity.")
    return restored


def quote(value):
    return '"' + value.replace('"', '""') + '"'


def cell(value, kind):
    if kind == "null": return [kind]
    if kind == "integer": return [kind, str(value)]
    if kind == "real": return [kind, struct.pack(">d", value).hex()]
    if kind == "text": return [kind, value.encode("utf-8").hex()]
    if kind == "blob": return [kind, value.hex()]
    raise RuntimeError("Unsupported SQLite cell type.")


def database_file(data):
    data = extended_path(data)
    if not data.is_dir() or data.is_symlink():
        raise RuntimeError("An existing independent data directory is required.")
    files = []
    for file in (data / "d1").rglob("*"):
        if file.is_symlink(): raise RuntimeError("Linked database paths are not allowed.")
        if file.is_file() and file.suffix == ".sqlite" and file.name != "metadata.sqlite": files.append(file)
    if len(files) != 1:
        raise RuntimeError("Exactly one existing inventory SQLite database is required.")
    return files[0]


def extended_path(file):
    resolved = str(file.resolve())
    return Path("\\\\?\\" + resolved) if os.name == "nt" and not resolved.startswith("\\\\?\\") else Path(resolved)


def snapshot(file, expected):
    db = sqlite3.connect(readonly_uri(file), uri=True)
    try:
        if db.execute("PRAGMA quick_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Database integrity or foreign keys failed.")
        if db.execute("SELECT COUNT(*) FROM staff_accounts").fetchone()[0] < 8 or db.execute("SELECT COUNT(*) FROM staff_accounts WHERE active=1 AND role='admin'").fetchone()[0] < 1:
            raise RuntimeError("The retained eight native accounts and an active administrator are required.")
        if list(db.execute("SELECT name,sha256 FROM portable_migrations ORDER BY name")) != list(expected.items()):
            raise RuntimeError("The existing database must have exactly the 23 accepted migration receipts.")
        result = {}
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name"):
            columns = [row[1] for row in db.execute("PRAGMA table_info(" + quote(name) + ")")]
            expressions = [item for field in columns for item in (quote(field), "typeof(" + quote(field) + ")")]
            rows = [canonical([cell(row[index], row[index + 1]) for index in range(0, len(row), 2)]).decode("utf-8") for row in db.execute("SELECT " + ",".join(expressions) + " FROM " + quote(name))]
            result[name] = {"columns": columns, "count": len(rows), "sha256": digest("\n".join(sorted(rows)).encode("utf-8"))}
        return result
    finally:
        db.close()


def sqlite_backup(source, target):
    readonly = sqlite3.connect(readonly_uri(source), uri=True)
    copied = sqlite3.connect(target)
    try: readonly.backup(copied)
    finally: copied.close(); readonly.close()


def readonly_uri(file):
    if os.name == "nt":
        # Encode the extended prefix as filename bytes, not a URI authority/query.
        return "file:" + uri_quote(str(extended_path(file)), safe="") + "?mode=ro"
    return file.resolve().as_uri() + "?mode=ro"


def prepare_database(project, release, manifest, expected):
    execution = reviewed_execution()
    source, target = project / ("data-" + PREVIOUS), project / ("data-" + NAME)
    if target.exists():
        if target.is_symlink(): raise RuntimeError("The candidate data directory cannot be linked.")
        marker = json.loads((target / "upgrade-source.json").read_text(encoding="utf-8"))
        if marker.get("deploymentName") != NAME or marker.get("fromDeploymentName") != PREVIOUS or marker.get("fromSourceCommit") != PREVIOUS_COMMIT or marker.get("sourceCommit") != manifest["sourceCommit"] or marker.get("sourceSnapshotSha256") != manifest["sourceSnapshotSha256"] or marker.get("originalPreserved") is not True or marker.get("initialSavedHomeExecution") != execution:
            raise RuntimeError("An unknown candidate database will not be overwritten.")
        current = snapshot(database_file(target), expected)
        backup = safe_file(target, "original-backup.sqlite")
        if snapshot(backup, expected) != marker.get("snapshot") or digest(backup.read_bytes()) != marker.get("backupSha256"):
            raise RuntimeError("The independently retained original backup changed.")
        complete = target / "upgrade-complete.json"
        if complete.exists():
            receipt = json.loads(complete.read_text(encoding="utf-8"))
            if receipt.get("deploymentName") != NAME or receipt.get("migrations") != MIGRATIONS or receipt.get("sourceCommit") != manifest["sourceCommit"] or receipt.get("sourceSnapshotSha256") != manifest["sourceSnapshotSha256"] or receipt.get("schemaVerified") is not True:
                raise RuntimeError("The completed candidate identity changed.")
        elif current != marker.get("snapshot"):
            raise RuntimeError("An incomplete copy differs from the verified original.")
        return target
    prior_release = project / "releases" / PREVIOUS
    previous_manifest = json.loads((prior_release / "deployment.json").read_text(encoding="utf-8"))
    if previous_manifest.get("deploymentName") != PREVIOUS or previous_manifest.get("applicationVersion") != "1.0.0" or previous_manifest.get("sourceCommit") != PREVIOUS_COMMIT:
        raise RuntimeError("The recorded current predecessor release is required.")
    if (prior_release / "migrations/meta/_journal.json").read_bytes() != (release / "migrations/meta/_journal.json").read_bytes():
        raise RuntimeError("The predecessor migration journal changed.")
    for name, sha256 in expected.items():
        if digest(safe_file(prior_release, f"migrations/{name}.sql").read_bytes()) != sha256 or safe_file(prior_release, f"drizzle/{name}.sql").read_bytes() != safe_file(release, f"drizzle/{name}.sql").read_bytes():
            raise RuntimeError("The predecessor migration bytes differ.")
    complete = json.loads((source / "upgrade-complete.json").read_text(encoding="utf-8"))
    if complete.get("deploymentName") != PREVIOUS or complete.get("migrations") != MIGRATIONS or complete.get("schemaVerified") is not True or complete.get("originalPreserved") is not True:
        raise RuntimeError("A verified completed predecessor database is required.")
    original = database_file(source)
    before = snapshot(original, expected)
    pending = project / (".integration-copy-" + uuid.uuid4().hex[:12])
    pending.mkdir(mode=0o700)
    destination = extended_path(pending) / original.relative_to(extended_path(source))
    destination.parent.mkdir(parents=True)
    backup = pending / "original-backup.sqlite"
    sqlite_backup(original, backup); sqlite_backup(backup, destination)
    if snapshot(original, expected) != before or snapshot(backup, expected) != before or snapshot(destination, expected) != before:
        raise RuntimeError("The original database, backup and candidate copy do not retain identical typed cells.")
    marker = {"deploymentName": NAME, "fromDeploymentName": PREVIOUS, "fromSourceCommit": PREVIOUS_COMMIT, "sourceCommit": manifest["sourceCommit"], "sourceSnapshotSha256": manifest["sourceSnapshotSha256"], "initialSavedHomeExecution": execution, "originalPreserved": True, "backupSha256": digest(backup.read_bytes()), "snapshot": before}
    (pending / "upgrade-source.json").write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    for attempt in range(10):
        try: pending.rename(target); break
        except PermissionError:
            if target.exists() or attempt == 9: raise
            time.sleep(0.2)
    return target


def verify_previous_application(project):
    release = project / "releases" / PREVIOUS
    manifest = json.loads(safe_file(release, "deployment.json").read_text(encoding="utf-8"))
    if manifest.get("deploymentName") != PREVIOUS or manifest.get("applicationVersion") != "1.0.0" or manifest.get("sourceCommit") != PREVIOUS_COMMIT:
        raise RuntimeError("The exact retained predecessor application is required for maintenance rollback.")
    records = manifest.get("files", [])
    if not records or not any(record.get("path") == "dist/server/index.js" for record in records):
        raise RuntimeError("The predecessor build file manifest is missing.")
    names = set()
    for record in records:
        if record["path"] in names or digest(safe_file(release, record["path"]).read_bytes()) != record["sha256"]:
            raise RuntimeError("A retained predecessor application file changed.")
        names.add(record["path"])
    for folder in ("dist", "drizzle"):
        for file in (release / folder).rglob("*"):
            if file.is_symlink() or file.is_file() and file.relative_to(release).as_posix() not in names:
                raise RuntimeError("Unmanifested predecessor application content cannot run against current data.")
    return release


def prepare_rollback(project, release, manifest, expected):
    reviewed_execution()
    data = project / ("data-" + NAME)
    if not data.is_dir():
        raise RuntimeError("Maintenance rollback requires the current 13 October database; the stale predecessor copy cannot be substituted.")
    data = prepare_database(project, release, manifest, expected)
    complete = json.loads((data / "upgrade-complete.json").read_text(encoding="utf-8"))
    if complete.get("deploymentName") != NAME or complete.get("schemaVerified") is not True:
        raise RuntimeError("Only a completed current release may enter maintenance rollback.")
    previous = verify_previous_application(project)
    original = database_file(data); before = snapshot(original, expected)
    backup = data / ("pre-rollback-" + uuid.uuid4().hex[:12] + ".sqlite")
    sqlite_backup(original, backup)
    if snapshot(backup, expected) != before or snapshot(original, expected) != before:
        raise RuntimeError("The current database changed during rollback backup or the backup differs.")
    receipt = {"deploymentName": NAME, "applicationDeploymentName": PREVIOUS, "applicationSourceCommit": PREVIOUS_COMMIT, "readOnlyBusinessOperations": True, "restoredFromExecution": reviewed_execution(), "snapshot": before, "backup": backup.name, "backupSha256": digest(backup.read_bytes())}
    marker = data / "rollback-source.json"
    marker.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return data, previous


def acquire_lock(project):
    handle = open(project / ".teaching-deployment.lock", "a+b")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            if not handle.read(1): handle.write(b"0"); handle.flush()
            handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, BlockingIOError):
        handle.close(); raise RuntimeError("Another inventory launcher or runtime holds the shared saved-home lock.")
    return handle
