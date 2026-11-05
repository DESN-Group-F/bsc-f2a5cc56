"""Operate the 5 November Teams embedding update (code only) inside the existing OpenBayes execution.

Run from the staged release directory with the reviewed source commit, archive SHA-256 and
saved-home execution:

    python3 cutover.py preflight --source-commit C --sha256 S --execution E   # read-only; wrap-up release keeps serving
    python3 cutover.py qualify   --source-commit C --sha256 S --execution E   # synthetic data only; wrap-up release keeps serving
    python3 cutover.py cutover   --source-commit C --sha256 S --execution E   # stop wrap-up release, back up, start this update
    python3 cutover.py verify    --source-commit C --sha256 S --execution E   # compare business cells, check health
    python3 cutover.py revert    --source-commit C --sha256 S --execution E   # wrap-up release on its own data, while nothing was written
    python3 cutover.py rollback  --source-commit C --sha256 S --execution E   # wrap-up application on the CURRENT data (after writes)
    python3 cutover.py restore   --source-commit C --sha256 S --execution E   # from rollback back to this update
    python3 cutover.py resume    --source-commit C --sha256 S --execution E   # after an execution restart
    python3 cutover.py status    --source-commit C --sha256 S --execution E

This update appends no migration. It differs from the predecessor in the web client, the
gateway (pages may be framed by Microsoft Teams) and the session cookie of a sign-in made inside
a frame; the schema and the 25 receipts are the same. Every check that can refuse runs before
the predecessor is stopped. After the stop, each attempt keeps its own records. `revert`
serves the predecessor on its own data only while this update holds no business record that
the predecessor's data lacks; afterwards `rollback` serves the CURRENT data through the
predecessor application instead. Nothing here deletes data, resets accounts, kills processes
or serves an older copy: a reverted copy is renamed aside, not reused.

After cutover the predecessor must never be started on its own data again (it would hide
later records). After an execution restart, use `resume` from this release.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.dont_write_bytecode = True
RELEASE = Path(__file__).resolve().parent
sys.path.insert(0, str(RELEASE))
import preservation  # noqa: E402

ROOT = Path("/openbayes/home/battery-inventory").resolve()
NEW = preservation.NAME
PRED = preservation.PREVIOUS
PRED_COMMIT = preservation.PREVIOUS_COMMIT
PRED_RELEASE = ROOT / "releases" / PRED
PRED_DATA = ROOT / ("data-" + PRED)
NEW_DATA = ROOT / ("data-" + NEW)
WORK = ROOT / "cutover-20261105-teams"
LOG = ROOT / "server-cutover-20261105-teams.log"
PRED_LOG = ROOT / "server-revert-wrapup-20261105.log"
NODE = ROOT / "tools/node-v24.21.0/bin/node"
NODE_MODULES = ROOT / "releases/0.6.1/runtime/node_modules"
PUBLIC_HOST = "zztv-battery.gear-c1.openbayes.net"
PORT = 8081
TRANSIENT = {"_cf_METADATA", "sign_in_attempts", "staff_sessions"}
RUNTIME_TERMS = ("workerd", "runtime.mjs", "upgrade-and-run.py", "rollback-and-run.py", "qualify-linux.py", "qualification-fixture.mjs")
LAUNCHERS = ("upgrade-and-run.py", "rollback-and-run.py")
ROLLBACK_MODE = "rollback-predecessor-application"


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def stamp():
    """A full timestamp plus a random suffix, so no record overwrites an earlier one."""
    return time.strftime("%Y%m%dT%H%M%S") + "-" + os.urandom(3).hex()


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def emit(report, file=None):
    print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)
    if file:
        file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        file.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- processes and port

def processes():
    found = {}
    for item in Path("/proc").iterdir():
        if not item.name.isdigit() or int(item.name) == os.getpid():
            continue
        try:
            stat = (item / "stat").read_text()
            state, ppid = stat[stat.rindex(")") + 2:].split(" ")[:2]
            argv = [part.decode(errors="replace") for part in (item / "cmdline").read_bytes().split(b"\0") if part]
            try: cwd = os.readlink(item / "cwd")
            except OSError: cwd = None
        except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError):
            continue
        found[int(item.name)] = {"pid": int(item.name), "ppid": int(ppid), "state": state, "argv": argv, "cwd": cwd}
    return found


def alive(pid, table=None):
    entry = (table if table is not None else processes()).get(pid)
    return entry is not None and entry["state"] not in ("Z", "X")


def runtime_like(table=None):
    table = table if table is not None else processes()
    return [entry for entry in table.values() if entry["state"] not in ("Z", "X") and any(term in " ".join(entry["argv"]) for term in RUNTIME_TERMS)]


def launcher_for(release, table=None):
    """Python launchers (normal or rollback) whose script resolves, against their own working
    directory, to this release."""
    table = table if table is not None else processes()
    targets = {(release / name).resolve() for name in LAUNCHERS}
    matches = []
    for entry in table.values():
        if entry["state"] in ("Z", "X") or not entry["argv"] or "python" not in Path(entry["argv"][0]).name:
            continue
        for argument in entry["argv"][1:]:
            if argument.endswith(LAUNCHERS):
                path = Path(argument) if Path(argument).is_absolute() else Path(entry["cwd"] or "/") / argument
                if path.resolve() in targets:
                    matches.append(entry)
                break
    return matches


def tree(pid, table=None):
    table = table if table is not None else processes()
    members, frontier = {pid}, [pid]
    while frontier:
        parent = frontier.pop()
        for entry in table.values():
            if entry["ppid"] == parent and entry["pid"] not in members:
                members.add(entry["pid"]); frontier.append(entry["pid"])
    return members


def listening(port=None):
    wanted = f"{PORT if port is None else port:04X}"
    for name in ("/proc/net/tcp", "/proc/net/tcp6"):
        try: lines = Path(name).read_text().splitlines()[1:]
        except FileNotFoundError: continue
        for line in lines:
            fields = line.split()
            if len(fields) > 3 and fields[1].rsplit(":", 1)[1] == wanted and fields[3] == "0A":
                return True
    return False


def single_launcher(release):
    """Exactly one launcher for `release`, and every runtime-like process belongs to its tree."""
    table = processes()
    found = launcher_for(release, table)
    if len(found) != 1:
        raise RuntimeError(f"Expected exactly one launcher for {release.name}; found {len(found)}: " + json.dumps([entry["argv"] for entry in found]))
    members = tree(found[0]["pid"], table)
    strays = [entry for entry in runtime_like(table) if entry["pid"] not in members]
    if strays:
        raise RuntimeError("Runtime processes outside the expected launcher are present; nothing was stopped: " + json.dumps([[entry["pid"], " ".join(entry["argv"])[:200]] for entry in strays]))
    return found[0], members


def stop_tree(launcher, members, seconds=90):
    os.kill(launcher["pid"], signal.SIGTERM)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        table = processes()
        if not any(alive(pid, table) for pid in members) and not listening():
            return True
        time.sleep(0.5)
    return False


def health():
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}/healthz", headers={"Host": PUBLIC_HOST})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except OSError as error:
        return {"unavailable": str(error)}


# ---------------------------------------------------------------- databases

def table_identity(connection, table):
    quoted = '"' + table.replace('"', '""') + '"'
    suffix = f" ORDER BY name LIMIT {preservation.PREVIOUS_MIGRATIONS}" if table == "portable_migrations" else ""
    rows = []
    for row in connection.execute("SELECT * FROM " + quoted + suffix):
        cells = []
        for value in row:
            if isinstance(value, bytes): cells.append(["blob", value.hex()])
            elif isinstance(value, float): cells.append(["real", value.hex()])
            elif isinstance(value, int): cells.append(["integer", str(value)])
            elif isinstance(value, str): cells.append(["text", value])
            elif value is None: cells.append(["null"])
            else: raise RuntimeError("Unexpected SQLite value type.")
        rows.append(json.dumps(cells, separators=(",", ":"), ensure_ascii=False))
    blob = json.dumps(sorted(rows), separators=(",", ":"), ensure_ascii=False).encode()
    return {"rows": len(rows), "sha256": hashlib.sha256(blob).hexdigest()}


def identities(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("BEGIN")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Database integrity check failed: " + str(path))
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        result = {table: table_identity(connection, table) for table in tables}
        receipts = [row[0] for row in connection.execute("SELECT name FROM portable_migrations ORDER BY name")]
        triggers = sorted(row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'"))
        connection.rollback()
        return result, receipts, triggers
    finally:
        connection.close()


def changed(before, after):
    return [table for table in sorted(set(before) | set(after)) if table not in TRANSIENT and before.get(table) != after.get(table)]


def online_copy(source, target):
    """SQLite backup API through a read-only connection: a consistent snapshot."""
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    readonly = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
    copied = sqlite3.connect(target)
    try: readonly.backup(copied)
    finally: copied.close(); readonly.close()


def summary(tables):
    counts = {name: value["rows"] for name, value in tables.items()}
    return {"businessTables": len([name for name in counts if name not in TRANSIENT]), "businessRows": sum(value for name, value in counts.items() if name not in TRANSIENT),
            "keyCounts": {name: counts.get(name) for name in ("batteries", "loans", "audit_events", "operations", "staff_accounts", "battery_models", "task_cycles", "messages")}}


# ---------------------------------------------------------------- identity and records

def set_environment(args):
    os.environ.update(INVENTORY_EXPECTED_SAVED_HOME_EXECUTION=args.execution, INVENTORY_RESTORED_FROM_EXECUTION=args.execution, INVENTORY_RELEASE_SOURCE_COMMIT=args.source_commit, PYTHONDONTWRITEBYTECODE="1")
    os.environ.pop("INVENTORY_LOCAL_TEST", None)


def check_identity(args):
    """Non-destructive checks of this update, the predecessor and the runtime; safe while either serves."""
    if RELEASE != ROOT / "releases" / NEW:
        raise RuntimeError("Run this from the staged release directory.")
    manifest = preservation.verify_bundle(RELEASE)
    expected = preservation.expected_migrations(RELEASE)
    preservation.verify_previous_application(ROOT)
    preservation.verify_predecessor(ROOT, RELEASE, expected)
    pred_source = json.loads((PRED_DATA / "upgrade-source.json").read_text(encoding="utf-8"))
    if pred_source.get("initialSavedHomeExecution") != args.execution:
        raise RuntimeError("The supplied execution differs from the reviewed saved-home execution of the 5 November wrap-up data.")
    for name, version in preservation.RUNTIME_VERSIONS.items():
        if json.loads((NODE_MODULES / name / "package.json").read_text(encoding="utf-8")).get("version") != version:
            raise RuntimeError("The retained runtime dependency version changed: " + name)
    if subprocess.check_output([str(NODE), "--version"], text=True).strip() != "v24.21.0":
        raise RuntimeError("The retained Node runtime changed.")
    return manifest, expected


def release_identity(args):
    return {"sourceCommit": args.source_commit, "archiveSha256": args.sha256, "stagedDeploymentSha256": sha256(RELEASE / "deployment.json")}


def attempts():
    return sorted(path for path in WORK.glob("attempt-*") if path.is_dir()) if WORK.is_dir() else []


def latest_attempt():
    found = attempts()
    if not found:
        raise RuntimeError("No cutover attempt is recorded; the predecessor was never stopped by this tool.")
    return found[-1]


def launch(release, commit, log, rollback=False):
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "INVENTORY_MANUAL_STOP": "1", "INVENTORY_PORT": str(PORT), "INVENTORY_PUBLIC_ORIGIN": "https://" + PUBLIC_HOST, "INVENTORY_RELEASE_SOURCE_COMMIT": commit}
    command = [sys.executable, str(release / ("rollback-and-run.py" if rollback else "upgrade-and-run.py")), "--source-commit", commit]
    if rollback: command.append("--confirm-current-data-predecessor-application")
    offset = log.stat().st_size if log.exists() else 0
    with log.open("ab") as handle:
        process = subprocess.Popen(command, cwd=release, env=environment, stdout=handle, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    deadline, events = time.monotonic() + 240, []
    while time.monotonic() < deadline:
        with log.open("rb") as handle:
            handle.seek(offset); text = handle.read().decode("utf-8", errors="replace")
        events = []
        for line in text.splitlines():
            try: value = json.loads(line)
            except json.JSONDecodeError: continue
            if isinstance(value, dict) and "event" in value: events.append(value)
        if any(event["event"] == "inventory_ready" for event in events):
            return process, events, None
        if process.poll() is not None:
            return process, events, text[-4000:]
        time.sleep(1)
    return process, events, "Startup timed out; the launcher is still running."


# ---------------------------------------------------------------- phases

def serving_predecessor(current):
    return current.get("deploymentName") == PRED and current.get("sourceCommit") == PRED_COMMIT and current.get("mode") == "normal"


def preflight(args):
    manifest, expected = check_identity(args)
    if NEW_DATA.exists():
        raise RuntimeError("A data directory for this update already exists; inspect it before any cutover.")
    current = health()
    if not serving_predecessor(current):
        raise RuntimeError("The 5 November wrap-up release is not serving normally: " + json.dumps(current))
    launcher, members = single_launcher(PRED_RELEASE)
    scratch = Path(tempfile.mkdtemp(prefix="cutover-preflight-"))
    try:
        online_copy(preservation.database_file(PRED_DATA), scratch / "copy.sqlite")
        tables, receipts, triggers = identities(scratch / "copy.sqlite")
        preservation.snapshot(scratch / "copy.sqlite", expected)
    finally:
        shutil.rmtree(scratch)
    emit({"phase": "preflight", "at": now(), **release_identity(args), "execution": args.execution, "release": NEW, "manifestSourceCommit": manifest["sourceCommit"], "predecessorHealth": current, "predecessorLauncher": {"pid": launcher["pid"], "argv": launcher["argv"]}, "predecessorProcessTree": sorted(members), "predecessorReceipts": len(receipts), "predecessorIntegrityOk": True, "predecessorTriggers": len(triggers), **summary(tables), "newDataDirectoryAbsent": True, "port8081Listening": listening()}, WORK / "preflight.json")


def qualify(args):
    check_identity(args)
    spec = importlib.util.spec_from_file_location("sealed_installer", RELEASE / "install-release.py")
    installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
    work = Path(tempfile.mkdtemp(prefix="inventory-qualification-20261105-teams-", dir="/tmp"))
    payload = installer.download(installer.RELEASE_URL, args.sha256)
    records = installer.verified_archive(payload, args.sha256, args.source_commit)
    if records["deployment.json"] != (RELEASE / "deployment.json").read_bytes():
        raise RuntimeError("The downloaded archive is not the staged release; nothing was qualified.")
    archive = work / "release.zip"; archive.write_bytes(payload)
    report = work / "qualification.json"
    # Assertions carry the qualification checks, so optimisation flags must not strip them.
    environment = {key: value for key, value in os.environ.items() if not key.startswith("INVENTORY_") and key != "PYTHONOPTIMIZE"}
    child = subprocess.Popen([sys.executable, str(RELEASE / "qualify-linux.py"), "--archive", str(archive), "--sha256", args.sha256, "--source-commit", args.source_commit, "--previous-release", str(PRED_RELEASE), "--node", str(NODE), "--node-modules", str(NODE_MODULES), "--fixture-root", str(work), "--report", str(report)], cwd=RELEASE, env={**environment, "PYTHONDONTWRITEBYTECODE": "1"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        output, _ = child.communicate(timeout=900)
    except subprocess.TimeoutExpired:
        child.terminate()  # its own handler stops the synthetic runtimes it started
        output, _ = child.communicate(timeout=120)
    outcome = json.loads(report.read_text(encoding="utf-8")) if report.exists() else None
    leftovers = [entry for entry in runtime_like() if str(work) in " ".join(entry["argv"]) or (entry["cwd"] or "").startswith(str(work))]
    emit({"phase": "qualification", "at": now(), **release_identity(args), "exitCode": child.returncode, "passed": child.returncode == 0 and bool(outcome) and outcome.get("passed") is True and not leftovers, "checks": [item["name"] for item in (outcome or {}).get("results", [])], "leftoverProcesses": [[entry["pid"], " ".join(entry["argv"])[:200]] for entry in leftovers], "outputTail": None if child.returncode == 0 else output[-6000:], "workDirectory": str(work), "predecessorStillServing": serving_predecessor(health())}, WORK / "qualification.json")
    if child.returncode != 0 or not outcome or outcome.get("passed") is not True or leftovers:
        raise SystemExit("Qualification failed; the 5 November wrap-up release keeps serving and nothing was changed.")


def cutover(args):
    # Everything that can refuse runs before the predecessor is touched.
    _, expected = check_identity(args)
    identity = release_identity(args)
    for name in ("preflight.json", "qualification.json"):
        record = json.loads((WORK / name).read_text(encoding="utf-8"))
        if any(record.get(key) != value for key, value in identity.items()):
            raise RuntimeError(name + " belongs to a different commit, archive or staged release; run it again.")
    if json.loads((WORK / "qualification.json").read_text(encoding="utf-8")).get("passed") is not True:
        raise RuntimeError("Qualification has not passed for this exact release.")
    if NEW_DATA.exists():
        raise RuntimeError("A data directory for this update already exists; inspect it before any cutover.")
    if not serving_predecessor(health()):
        raise RuntimeError("The 5 November wrap-up release is not the serving release.")
    launcher, members = single_launcher(PRED_RELEASE)
    attempt = WORK / ("attempt-" + time.strftime("%Y%m%dT%H%M%S"))
    attempt.mkdir(mode=0o700, parents=True)
    emit({"phase": "stopping-predecessor", "at": now(), **identity, "predecessorLauncher": {"pid": launcher["pid"], "argv": launcher["argv"]}, "predecessorProcessTree": sorted(members)}, attempt / "stopping.json")
    if not stop_tree(launcher, members):
        raise SystemExit("The 5 November wrap-up release did not stop within 90 s after SIGTERM; nothing else was done. Run `status`, then `revert` once it has stopped.")
    owner = PRED_DATA / ".runtime-owner.json"
    database = preservation.database_file(PRED_DATA)
    backup = attempt / "business-before-cutover.sqlite"
    with preservation.acquire_lock(ROOT):
        online_copy(database, backup)
    tables, receipts, _ = identities(backup)
    if identities(database)[0] != tables:
        raise SystemExit("The pre-cutover backup differs from the stopped predecessor database; this update was not started. Run `revert`.")
    preservation.snapshot(backup, expected)
    (attempt / "before-cutover-identities.json").write_text(json.dumps(tables, indent=2) + "\n", encoding="utf-8")
    process, events, failure = launch(RELEASE, args.source_commit, LOG)
    emit({"phase": "cutover", "at": now(), **identity, "attempt": attempt.name, "predecessorOwnerRecordLeft": owner.exists(), "backup": str(backup), "backupSha256": sha256(backup), "predecessorReceipts": len(receipts), **summary(tables), "launcherPid": process.pid, "log": str(LOG), "events": [event for event in events if event.get("event") != "inventory_ready"] + [event for event in events if event.get("event") == "inventory_ready"][:1], "failure": failure}, attempt / "cutover.json")
    if failure:
        raise SystemExit("This update did not become ready. The predecessor data is unchanged; run `revert` to serve the 5 November wrap-up release again.")


def verify(args):
    check_identity(args)
    attempt = latest_attempt()
    before = json.loads((attempt / "before-cutover-identities.json").read_text(encoding="utf-8"))
    after, receipts, triggers = identities(preservation.database_file(NEW_DATA))
    original, original_receipts, original_triggers = identities(preservation.database_file(PRED_DATA))
    complete = json.loads((NEW_DATA / "upgrade-complete.json").read_text(encoding="utf-8"))
    current = health()
    report = {"phase": "verified", "at": now(), **release_identity(args), "attempt": attempt.name, "health": current, "changedBusinessTables": changed(before, after), "predecessorDatabaseUnchanged": original == before, "predecessorReceipts": len(original_receipts), "receipts": len(receipts), "receiptsUnchanged": receipts == original_receipts, "triggersUnchanged": triggers == original_triggers, **summary(after), "upgradeComplete": {key: complete.get(key) for key in ("deploymentName", "sourceCommit", "migrations", "appendedMigrations", "schemaVerified", "originalPreserved", "initialVerificationAt")}, "runtimeProcesses": len(runtime_like())}
    report["passed"] = (current.get("deploymentName") == NEW and current.get("sourceCommit") == args.source_commit and current.get("migrations") == preservation.MIGRATIONS and current.get("mode") == "normal"
                        and not report["changedBusinessTables"] and report["predecessorDatabaseUnchanged"] and len(receipts) == preservation.MIGRATIONS and report["receiptsUnchanged"] and report["triggersUnchanged"]
                        and complete.get("migrations") == preservation.MIGRATIONS and complete.get("appendedMigrations") == [] and complete.get("schemaVerified") is True)
    emit(report, attempt / "verification.json")
    if not report["passed"]:
        raise SystemExit("Verification failed. If nothing was written since cutover, `revert` serves the 5 November wrap-up release again.")


def no_runtime_left():
    leftovers = runtime_like()
    if leftovers or listening():
        raise RuntimeError("An unexpected runtime or listener is present: " + json.dumps([[entry["pid"], " ".join(entry["argv"])[:200]] for entry in leftovers]))


def archive_owner_record(data, directory, label):
    owner = data / ".runtime-owner.json"
    if owner.exists():
        # The whole runtime process tree was verified gone before this; keep the record as evidence.
        owner.rename(directory / (label + "-runtime-owner-" + stamp() + ".json"))


def stop_current(release):
    found = launcher_for(release)
    if len(found) == 1:
        launcher, members = single_launcher(release)
        if not stop_tree(launcher, members):
            raise SystemExit("The running launcher did not stop within 90 s; nothing else was done. Run `status`.")
    elif found:
        raise RuntimeError("More than one launcher for this release is running.")


def live_identities(database):
    """Read-only: a consistent online copy of a database that may be serving, then its identities."""
    scratch = Path(tempfile.mkdtemp(prefix="cutover-read-"))
    try:
        online_copy(database, scratch / "copy.sqlite")
        return identities(scratch / "copy.sqlite")[0]
    finally:
        shutil.rmtree(scratch)


def predecessor_moved(expected):
    """Read-only: has the predecessor's own data changed since this update's copy was made?"""
    marker = json.loads((NEW_DATA / "upgrade-source.json").read_text(encoding="utf-8"))
    return preservation.snapshot(preservation.database_file(PRED_DATA), expected) != marker.get("snapshot")


def serving_update(current, commit, mode):
    return current.get("deploymentName") == NEW and current.get("sourceCommit") == commit and current.get("mode") == mode and current.get("migrations") == preservation.MIGRATIONS


def revert(args):
    check_identity(args)
    attempt = latest_attempt()
    if serving_predecessor(health()) and launcher_for(PRED_RELEASE):
        raise RuntimeError("The 5 November wrap-up release is already serving.")
    # Refusals that do not depend on stopping anything come first.
    before_file = attempt / "before-cutover-identities.json"
    original, _, _ = identities(preservation.database_file(PRED_DATA))
    before = json.loads(before_file.read_text(encoding="utf-8")) if before_file.exists() else None
    if before is not None and original != before:
        raise RuntimeError("The 5 November wrap-up database differs from its pre-cutover state; inspect before serving it.")
    if before is None and NEW_DATA.exists():
        raise RuntimeError("This attempt has no pre-cutover record but a new data directory exists; inspect before serving the predecessor.")
    if NEW_DATA.joinpath("rollback-source.json").exists():
        raise RuntimeError("This update's data has been served by the predecessor application in rollback; it may hold later records. Use `rollback` or `restore`, not `revert`.")
    has_copy = NEW_DATA.exists() and any(NEW_DATA.joinpath("d1").rglob("*.sqlite"))
    if before is not None and has_copy:
        moved = changed(before, live_identities(preservation.database_file(NEW_DATA)))
        if moved:
            raise RuntimeError("Business records already changed on this update (" + ", ".join(moved) + "); serving the 5 November wrap-up release on its older data would hide them. Nothing was stopped. Use `rollback` to serve the current data through the 5 November wrap-up application.")
    # Stop this update first, so no write can land between the comparison and the predecessor starting.
    stop_current(RELEASE)
    no_runtime_left()
    archive_owner_record(NEW_DATA, attempt, "new")
    if before is not None and has_copy:
        after, _, _ = identities(preservation.database_file(NEW_DATA))
        moved = changed(before, after)
        if moved:
            process, events, failure = launch(RELEASE, args.source_commit, LOG)
            emit({"phase": "revert-refused", "at": now(), "attempt": attempt.name, "changedBusinessTables": moved, "newReleaseRestarted": failure is None, "failure": failure, "health": health()}, attempt / ("revert-refused-" + stamp() + ".json"))
            raise SystemExit("Business records changed on this update while it was stopping; this update was started again. Use `rollback` to serve the current data through the 5 November wrap-up application.")
    # A reverted copy is renamed aside so that no later start can serve it as current data.
    if NEW_DATA.exists():
        NEW_DATA.rename(ROOT / ("superseded-" + NEW_DATA.name + "-" + attempt.name))
    archive_owner_record(PRED_DATA, attempt, "predecessor")
    process, events, failure = launch(PRED_RELEASE, PRED_COMMIT, PRED_LOG)
    emit({"phase": "reverted-to-predecessor", "at": now(), "attempt": attempt.name, "launcherPid": process.pid, "events": [event for event in events if event.get("event") == "inventory_ready"][:1], "failure": failure, "health": health()}, attempt / ("reverted-" + stamp() + ".json"))
    if failure:
        raise SystemExit("The 5 November wrap-up release did not become ready; its data is unchanged. Run `status`, then `resume`.")


def stop_failed_start(process):
    """After a start that did not become ready: stop it if it is still running, so the other
    mode can start. Raises if anything unexpected remains."""
    if process.poll() is None:
        stop_current(RELEASE)
    try: process.wait(timeout=30)
    except subprocess.TimeoutExpired: raise RuntimeError("A failed launcher did not exit.")
    no_runtime_left()


def switch(args, rollback):
    """Stop this update's launcher (normal or rollback) and start it in the other mode on the
    same CURRENT data. Neither mode copies, migrates or rewrites business data. A failed start
    returns to the mode that was serving; the record is written in every case."""
    _, expected = check_identity(args)
    attempt = latest_attempt()
    wanted, present = (ROLLBACK_MODE, "normal") if rollback else ("normal", ROLLBACK_MODE)
    current = health()
    if not serving_update(current, args.source_commit, present):
        raise RuntimeError(f"This update is not serving in {present} mode: " + json.dumps(current))
    complete = json.loads((NEW_DATA / "upgrade-complete.json").read_text(encoding="utf-8"))
    if complete.get("deploymentName") != NEW or complete.get("sourceCommit") != args.source_commit or complete.get("schemaVerified") is not True:
        raise RuntimeError("This update has not completed its first start.")
    if predecessor_moved(expected):
        raise RuntimeError("The 5 November wrap-up data changed after this update's copy was made; the launcher would refuse. Nothing was stopped; reconcile first.")
    label = ("rollback-" if rollback else "restore-") + stamp()
    stop_current(RELEASE)
    # From here on the previous mode is stopped: every outcome is recorded.
    record = {"phase": "rollback" if rollback else "restore", "at": now(), "atEpoch": time.time(), **release_identity(args), "attempt": attempt.name, "previousModeStopped": True, "started": False, "fallback": None, "servingModeAfter": None}
    try:
        no_runtime_left()
        archive_owner_record(NEW_DATA, attempt, label)
        database = preservation.database_file(NEW_DATA)
        backup = attempt / (label + "-before.sqlite")
        with preservation.acquire_lock(ROOT):
            online_copy(database, backup)
        record.update(backup=str(backup), backupSha256=sha256(backup), backupMatches=identities(database)[0] == identities(backup)[0])
        process = None
        if record["backupMatches"]:
            process, events, failure = launch(RELEASE, args.source_commit, LOG, rollback=rollback)
            record.update(launcherPid=process.pid, events=[event for event in events if event.get("event") == "inventory_ready"][:1], failure=failure)
        else:
            record["failure"] = "The switch backup differs from the stopped database; the other mode was not started."
        record["health"] = health()
        record["started"] = record["failure"] is None and serving_update(record["health"], args.source_commit, wanted)
        if record["started"]:
            record["servingModeAfter"] = wanted
            return
        fallback = record["fallback"] = {"mode": present}
        if process is not None:
            stop_failed_start(process)
            archive_owner_record(NEW_DATA, attempt, label + "-failed")
        _, _, back_failure = launch(RELEASE, args.source_commit, LOG, rollback=not rollback)
        fallback.update(failure=back_failure, health=health())
        if back_failure is None and serving_update(fallback["health"], args.source_commit, present):
            record["servingModeAfter"] = present
    except (RuntimeError, OSError, SystemExit) as error:
        record["error"] = str(error)
    finally:
        record.setdefault("health", health())
        emit(record, attempt / (label + ".json"))
    if record["servingModeAfter"] == present:
        raise SystemExit(f"The {wanted} start did not become ready; the {present} mode was started again on the same data.")
    reason = record.get("error") or (record["fallback"] or {}).get("failure") or record.get("failure") or "no ready identity"
    raise SystemExit("The previous mode was stopped and neither mode became ready (" + str(reason)[:500] + "). The current data is unchanged. Run `status`; once no launcher or runtime remains, `resume` starts the last mode that served.")


def rollback(args): switch(args, rollback=True)


def restore(args): switch(args, rollback=False)


def last_update_mode():
    """The mode this update last served in, from the switch and resume records; normal if none."""
    latest = (0.0, "normal")
    for file in (WORK.rglob("*.json") if WORK.is_dir() else []):
        if not (file.name.startswith(("rollback-", "restore-")) or file.name == "resume.json"): continue
        try: record = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError): continue
        if not isinstance(record, dict) or record.get("phase") not in ("rollback", "restore", "resume") or record.get("servingModeAfter") not in ("normal", ROLLBACK_MODE): continue
        if float(record.get("atEpoch", 0)) > latest[0]: latest = (float(record["atEpoch"]), record["servingModeAfter"])
    return "rollback" if latest[1] == ROLLBACK_MODE else "normal"


def resume(args):
    """Start the CURRENT application again after an execution restart. After cutover that is this
    update on its copy, in the mode it last served (or --mode). After a completed `revert` it is
    the 5 November wrap-up release on its own data. Before any cutover the 5 November wrap-up release is started
    only with an explicit `--mode predecessor`. Any other state refuses with the tool that resolves it."""
    _, expected = check_identity(args)
    current = health()
    if "unavailable" not in current:
        raise RuntimeError("Something already answers on port 8081: " + json.dumps(current))
    if launcher_for(RELEASE) or launcher_for(PRED_RELEASE):
        raise RuntimeError("A launcher is already running.")
    no_runtime_left()
    found = attempts()
    reverted = bool(found) and any(found[-1].glob("reverted-*.json"))
    if NEW_DATA.exists():
        try: complete = json.loads((NEW_DATA / "upgrade-complete.json").read_text(encoding="utf-8"))
        except FileNotFoundError: complete = None
        if not complete or complete.get("deploymentName") != NEW or complete.get("sourceCommit") != args.source_commit or complete.get("schemaVerified") is not True:
            raise RuntimeError("This update's copy exists but its first start never completed (an interrupted cutover). Nothing was started. Run `revert`: it serves the 5 November wrap-up release on its unchanged data.")
        if args.mode == "predecessor":
            raise RuntimeError("This update's copy is the current data; the 5 November wrap-up release must not serve its own older data. Nothing was started.")
        if predecessor_moved(expected):
            raise RuntimeError("The 5 November wrap-up data changed after this update's copy was made; nothing was started. Reconcile before any start.")
        mode = args.mode or last_update_mode()
        target, data, release, commit, log, rollback_mode = "update", NEW_DATA, RELEASE, args.source_commit, LOG, mode == "rollback"
    elif reverted or (not found and args.mode == "predecessor"):
        if args.mode not in (None, "predecessor"):
            raise RuntimeError("Only the 5 November wrap-up release is current (this update was reverted); use no --mode or --mode predecessor. Nothing was started.")
        mode, target, data, release, commit, log, rollback_mode = "predecessor", "predecessor", PRED_DATA, PRED_RELEASE, PRED_COMMIT, PRED_LOG, False
    elif not found:
        raise RuntimeError("No cutover has been recorded and this update has no copy. If the 5 November wrap-up release was serving before the restart, start it with `resume --mode predecessor`. Nothing was started.")
    else:
        raise RuntimeError("A cutover attempt stopped the 5 November wrap-up release but left no copy and no completed revert. Nothing was started. Run `revert`.")
    database = preservation.database_file(data)
    directory = WORK / ("resume-" + stamp()); directory.mkdir(mode=0o700, parents=True)
    # Raw evidence of the files exactly as the restart left them, including any write-ahead log.
    evidence = []
    for file in sorted(database.parent.glob(database.name + "*")):
        if file.is_file() and file.name in (database.name, database.name + "-wal", database.name + "-shm"):
            shutil.copy2(file, directory / ("as-found-" + file.name)); evidence.append({"name": file.name, "bytes": file.stat().st_size})
    # SQLite applies committed write-ahead frames when the database is opened; the online backup
    # through a read-only connection therefore holds every committed record.
    backup = directory / "business-before-resume.sqlite"
    with preservation.acquire_lock(ROOT):
        online_copy(database, backup)
    tables, receipts, _ = identities(backup)
    if identities(database)[0] != tables:
        raise RuntimeError("The resume backup differs from the stopped database; nothing was started.")
    preservation.snapshot(backup, expected)
    archive_owner_record(data, directory, "stale")
    process, events, failure = launch(release, commit, log, rollback=rollback_mode)
    after = health()
    serving_mode = ROLLBACK_MODE if rollback_mode else "normal"
    healthy = serving_update(after, commit, serving_mode) if target == "update" else serving_predecessor(after)
    emit({"phase": "resume", "at": now(), "atEpoch": time.time(), **release_identity(args), "target": target, "mode": mode, "modeFromRecords": args.mode is None and target == "update", "asFound": evidence, "backup": str(backup), "backupSha256": sha256(backup), "receipts": len(receipts), **summary(tables), "launcherPid": process.pid, "events": [event for event in events if event.get("event") == "inventory_ready"][:1], "failure": failure, "health": after, "healthy": healthy, "servingModeAfter": serving_mode if healthy and target == "update" else None}, directory / "resume.json")
    if failure or not healthy:
        raise SystemExit("The resumed application did not become ready with the expected identity; its data is unchanged. Run `status`.")


def status(args):
    table = processes()
    emit({"phase": "status", "at": now(), "health": health(), "port8081Listening": listening(), "predecessorLaunchers": [entry["pid"] for entry in launcher_for(PRED_RELEASE, table)], "newLaunchers": [entry["pid"] for entry in launcher_for(RELEASE, table)], "runtimeProcesses": [[entry["pid"], entry["state"], " ".join(entry["argv"])[:160]] for entry in runtime_like(table)], "newDataDirectory": NEW_DATA.exists(), "newDataComplete": (NEW_DATA / "upgrade-complete.json").exists(), "attempts": [path.name for path in attempts()]})


PHASES = {"preflight": preflight, "qualify": qualify, "cutover": cutover, "verify": verify, "revert": revert, "rollback": rollback, "restore": restore, "resume": resume, "status": status}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("phase", choices=tuple(PHASES))
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--execution", required=True)
    parser.add_argument("--mode", choices=("normal", "rollback", "predecessor"), default=None, help="resume only: normal or rollback for this update (default: the mode it last served in); predecessor for the 5 November wrap-up release before any cutover")
    arguments = parser.parse_args()
    set_environment(arguments)
    PHASES[arguments.phase](arguments)
