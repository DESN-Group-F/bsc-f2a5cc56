"""Operate the 4 November cutover inside the existing OpenBayes execution.

Run from the staged release directory with the reviewed source commit, archive SHA-256 and
saved-home execution:

    python3 cutover.py preflight --source-commit C --sha256 S --execution E   # read-only; R3 keeps serving
    python3 cutover.py qualify   --source-commit C --sha256 S --execution E   # synthetic data only; R3 keeps serving
    python3 cutover.py cutover   --source-commit C --sha256 S --execution E   # stop R3, back up, start this release
    python3 cutover.py verify    --source-commit C --sha256 S --execution E   # compare business cells, check health
    python3 cutover.py revert    --source-commit C --sha256 S --execution E   # back to R3 while nothing was written
    python3 cutover.py status    --source-commit C --sha256 S --execution E

Every check that can refuse runs before R3 is stopped. After the stop, each attempt keeps its
own records, and `revert` can always serve R3 again on its own data unless the new release
already holds business records that R3's data lacks. Nothing here deletes data, resets
accounts, kills processes or serves an older copy: a reverted copy is renamed aside, not reused.
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
R3 = preservation.PREVIOUS
R3_COMMIT = preservation.PREVIOUS_COMMIT
R3_RELEASE = ROOT / "releases" / R3
R3_DATA = ROOT / ("data-" + R3)
NEW_DATA = ROOT / ("data-" + NEW)
WORK = ROOT / "cutover-20261104"
LOG = ROOT / "server-cutover-20261104.log"
R3_LOG = ROOT / "server-revert-r3-20261104.log"
NODE = ROOT / "tools/node-v24.21.0/bin/node"
NODE_MODULES = ROOT / "releases/0.6.1/runtime/node_modules"
PUBLIC_HOST = "zztv-battery.gear-c1.openbayes.net"
PORT = 8081
TRANSIENT = {"_cf_METADATA", "sign_in_attempts", "staff_sessions"}
RUNTIME_TERMS = ("workerd", "runtime.mjs", "upgrade-and-run.py", "rollback-and-run.py", "qualify-linux.py", "qualification-fixture.mjs")


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


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
    """Python launchers whose script resolves (against their own working directory) to this release."""
    table = table if table is not None else processes()
    target = (release / "upgrade-and-run.py").resolve()
    matches = []
    for entry in table.values():
        if entry["state"] in ("Z", "X") or not entry["argv"] or "python" not in Path(entry["argv"][0]).name:
            continue
        for argument in entry["argv"][1:]:
            if argument.endswith("upgrade-and-run.py"):
                path = Path(argument) if Path(argument).is_absolute() else Path(entry["cwd"] or "/") / argument
                if path.resolve() == target:
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


def listening(port=PORT):
    wanted = f"{port:04X}"
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
    """Non-destructive checks of this release, R3 and the runtime; safe while R3 serves."""
    if RELEASE != ROOT / "releases" / NEW:
        raise RuntimeError("Run this from the staged release directory.")
    manifest = preservation.verify_bundle(RELEASE)
    expected = preservation.expected_migrations(RELEASE)
    preservation.verify_previous_application(ROOT)
    preservation.verify_predecessor(ROOT, RELEASE, expected)
    r3_source = json.loads((R3_DATA / "upgrade-source.json").read_text(encoding="utf-8"))
    if r3_source.get("initialSavedHomeExecution") != args.execution:
        raise RuntimeError("The supplied execution differs from the reviewed R3 saved-home execution.")
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
        raise RuntimeError("No cutover attempt is recorded; R3 was never stopped by this tool.")
    return found[-1]


def launch(release, commit, log):
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "INVENTORY_MANUAL_STOP": "1", "INVENTORY_PORT": str(PORT), "INVENTORY_PUBLIC_ORIGIN": "https://" + PUBLIC_HOST, "INVENTORY_RELEASE_SOURCE_COMMIT": commit}
    offset = log.stat().st_size if log.exists() else 0
    with log.open("ab") as handle:
        process = subprocess.Popen([sys.executable, str(release / "upgrade-and-run.py"), "--source-commit", commit], cwd=release, env=environment, stdout=handle, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
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

def preflight(args):
    manifest, expected = check_identity(args)
    if NEW_DATA.exists():
        raise RuntimeError("A data directory for this release already exists; inspect it before any cutover.")
    current = health()
    if current.get("deploymentName") != R3 or current.get("mode") != "normal":
        raise RuntimeError("R3 is not serving normally: " + json.dumps(current))
    launcher, members = single_launcher(R3_RELEASE)
    scratch = Path(tempfile.mkdtemp(prefix="cutover-preflight-"))
    try:
        online_copy(preservation.database_file(R3_DATA), scratch / "copy.sqlite")
        tables, receipts, triggers = identities(scratch / "copy.sqlite")
        preservation.snapshot(scratch / "copy.sqlite", expected)
    finally:
        shutil.rmtree(scratch)
    emit({"phase": "preflight", "at": now(), **release_identity(args), "execution": args.execution, "release": NEW, "manifestSourceCommit": manifest["sourceCommit"], "r3Health": current, "r3Launcher": {"pid": launcher["pid"], "argv": launcher["argv"]}, "r3ProcessTree": sorted(members), "r3Receipts": len(receipts), "r3IntegrityOk": True, "r3Triggers": len(triggers), **summary(tables), "newDataDirectoryAbsent": True, "port8081Listening": listening()}, WORK / "preflight.json")


def qualify(args):
    check_identity(args)
    spec = importlib.util.spec_from_file_location("sealed_installer", RELEASE / "install-release.py")
    installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
    work = Path(tempfile.mkdtemp(prefix="inventory-qualification-20261104-", dir="/tmp"))
    payload = installer.download(installer.RELEASE_URL, args.sha256)
    records = installer.verified_archive(payload, args.sha256, args.source_commit)
    if records["deployment.json"] != (RELEASE / "deployment.json").read_bytes():
        raise RuntimeError("The downloaded archive is not the staged release; nothing was qualified.")
    archive = work / "release.zip"; archive.write_bytes(payload)
    report = work / "qualification.json"
    environment = {key: value for key, value in os.environ.items() if not key.startswith("INVENTORY_")}
    child = subprocess.Popen([sys.executable, str(RELEASE / "qualify-linux.py"), "--archive", str(archive), "--sha256", args.sha256, "--source-commit", args.source_commit, "--previous-release", str(R3_RELEASE), "--node", str(NODE), "--node-modules", str(NODE_MODULES), "--fixture-root", str(work), "--report", str(report)], cwd=RELEASE, env={**environment, "PYTHONDONTWRITEBYTECODE": "1"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        output, _ = child.communicate(timeout=900)
    except subprocess.TimeoutExpired:
        child.terminate()  # its own handler stops the synthetic runtimes it started
        output, _ = child.communicate(timeout=120)
    outcome = json.loads(report.read_text(encoding="utf-8")) if report.exists() else None
    leftovers = [entry for entry in runtime_like() if str(work) in " ".join(entry["argv"]) or (entry["cwd"] or "").startswith(str(work))]
    emit({"phase": "qualification", "at": now(), **release_identity(args), "exitCode": child.returncode, "passed": child.returncode == 0 and bool(outcome) and outcome.get("passed") is True and not leftovers, "checks": [item["name"] for item in (outcome or {}).get("results", [])], "leftoverProcesses": [[entry["pid"], " ".join(entry["argv"])[:200]] for entry in leftovers], "outputTail": None if child.returncode == 0 else output[-6000:], "workDirectory": str(work), "r3StillServing": health().get("deploymentName") == R3}, WORK / "qualification.json")
    if child.returncode != 0 or not outcome or outcome.get("passed") is not True or leftovers:
        raise SystemExit("Qualification failed; R3 keeps serving and nothing was changed.")


def cutover(args):
    # Everything that can refuse runs before R3 is touched.
    _, expected = check_identity(args)
    identity = release_identity(args)
    for name in ("preflight.json", "qualification.json"):
        record = json.loads((WORK / name).read_text(encoding="utf-8"))
        if any(record.get(key) != value for key, value in identity.items()):
            raise RuntimeError(name + " belongs to a different commit, archive or staged release; run it again.")
    if json.loads((WORK / "qualification.json").read_text(encoding="utf-8")).get("passed") is not True:
        raise RuntimeError("Qualification has not passed for this exact release.")
    if NEW_DATA.exists():
        raise RuntimeError("A data directory for this release already exists; inspect it before any cutover.")
    if health().get("deploymentName") != R3:
        raise RuntimeError("R3 is not the serving release.")
    launcher, members = single_launcher(R3_RELEASE)
    attempt = WORK / ("attempt-" + time.strftime("%Y%m%dT%H%M%S"))
    attempt.mkdir(mode=0o700, parents=True)
    emit({"phase": "stopping-r3", "at": now(), **identity, "r3Launcher": {"pid": launcher["pid"], "argv": launcher["argv"]}, "r3ProcessTree": sorted(members)}, attempt / "stopping.json")
    if not stop_tree(launcher, members):
        raise SystemExit("R3 did not stop within 90 s after SIGTERM; nothing else was done. Run `status`, then `revert` once it has stopped.")
    owner = R3_DATA / ".runtime-owner.json"
    database = preservation.database_file(R3_DATA)
    backup = attempt / "business-before-cutover.sqlite"
    with preservation.acquire_lock(ROOT):
        online_copy(database, backup)
    tables, receipts, _ = identities(backup)
    if identities(database)[0] != tables:
        raise SystemExit("The pre-cutover backup differs from the stopped R3 database; the new release was not started. Run `revert`.")
    preservation.snapshot(backup, expected)
    (attempt / "before-cutover-identities.json").write_text(json.dumps(tables, indent=2) + "\n", encoding="utf-8")
    process, events, failure = launch(RELEASE, args.source_commit, LOG)
    emit({"phase": "cutover", "at": now(), **identity, "attempt": attempt.name, "r3OwnerRecordLeft": owner.exists(), "backup": str(backup), "backupSha256": sha256(backup), "r3Receipts": len(receipts), **summary(tables), "launcherPid": process.pid, "log": str(LOG), "events": [event for event in events if event.get("event") != "inventory_ready"] + [event for event in events if event.get("event") == "inventory_ready"][:1], "failure": failure}, attempt / "cutover.json")
    if failure:
        raise SystemExit("The new release did not become ready. R3 data is unchanged; run `revert` to serve R3 again.")


def verify(args):
    check_identity(args)
    attempt = latest_attempt()
    before = json.loads((attempt / "before-cutover-identities.json").read_text(encoding="utf-8"))
    after, receipts, triggers = identities(preservation.database_file(NEW_DATA))
    original, original_receipts, _ = identities(preservation.database_file(R3_DATA))
    complete = json.loads((NEW_DATA / "upgrade-complete.json").read_text(encoding="utf-8"))
    current = health()
    report = {"phase": "verified", "at": now(), **release_identity(args), "attempt": attempt.name, "health": current, "changedBusinessTables": changed(before, after), "r3DatabaseUnchanged": original == before, "r3Receipts": len(original_receipts), "receipts": len(receipts), "appended": receipts[preservation.PREVIOUS_MIGRATIONS:], "newTriggersPresent": all(name in triggers for name in ("metadata_edit_operations_no_replace", "csv_import_operations_no_replace", "model_create_operations_no_replace")), **summary(after), "upgradeComplete": {key: complete.get(key) for key in ("deploymentName", "sourceCommit", "migrations", "schemaVerified", "originalPreserved", "initialVerificationAt")}, "runtimeProcesses": len(runtime_like())}
    report["passed"] = (current.get("deploymentName") == NEW and current.get("sourceCommit") == args.source_commit and current.get("migrations") == preservation.MIGRATIONS and current.get("mode") == "normal"
                        and not report["changedBusinessTables"] and report["r3DatabaseUnchanged"] and len(receipts) == preservation.MIGRATIONS and len(original_receipts) == preservation.PREVIOUS_MIGRATIONS and report["newTriggersPresent"] and complete.get("migrations") == preservation.MIGRATIONS and complete.get("schemaVerified") is True)
    emit(report, attempt / "verification.json")
    if not report["passed"]:
        raise SystemExit("Verification failed. If nothing was written since cutover, `revert` serves R3 again.")


def revert(args):
    check_identity(args)
    attempt = latest_attempt()
    if health().get("deploymentName") == R3 and launcher_for(R3_RELEASE):
        raise RuntimeError("R3 is already serving.")
    # Refusals that do not depend on what the new release wrote come before anything is stopped.
    before_file = attempt / "before-cutover-identities.json"
    original, _, _ = identities(preservation.database_file(R3_DATA))
    before = json.loads(before_file.read_text(encoding="utf-8")) if before_file.exists() else None
    if before is not None and original != before:
        raise RuntimeError("The R3 database differs from its pre-cutover state; inspect before serving it.")
    if before is None and NEW_DATA.exists():
        raise RuntimeError("This attempt has no pre-cutover record but a new data directory exists; inspect before serving R3.")
    # Stop the new release first, so no write can land between the comparison and R3 starting.
    found = launcher_for(RELEASE)
    if len(found) == 1:
        launcher, members = single_launcher(RELEASE)
        if not stop_tree(launcher, members):
            raise SystemExit("The new release did not stop within 90 s; nothing else was done.")
    elif found:
        raise RuntimeError("More than one launcher for this release is running.")
    leftovers = runtime_like()
    if leftovers or listening():
        raise RuntimeError("An unexpected runtime or listener is present: " + json.dumps([[entry["pid"], " ".join(entry["argv"])[:200]] for entry in leftovers]))
    new_owner = NEW_DATA / ".runtime-owner.json"
    if new_owner.exists():
        # The new release's whole process tree is verified gone above; keep the record as evidence.
        new_owner.rename(attempt / ("new-runtime-owner-" + time.strftime("%H%M%S") + ".json"))
    if before is not None:
        if NEW_DATA.exists() and any(NEW_DATA.joinpath("d1").rglob("*.sqlite")):
            after, _, _ = identities(preservation.database_file(NEW_DATA))
            moved = changed(before, after)
            if moved:
                process, events, failure = launch(RELEASE, args.source_commit, LOG)
                emit({"phase": "revert-refused", "at": now(), "attempt": attempt.name, "changedBusinessTables": moved, "newReleaseRestarted": failure is None, "failure": failure}, attempt / "revert-refused.json")
                raise SystemExit("Business records changed on the new release; serving R3 on its older data would hide them. The new release was started again. Use the maintenance rollback adapter if the new release must not serve.")
    # A reverted copy is renamed aside so that no later start can serve it as current data.
    if NEW_DATA.exists():
        NEW_DATA.rename(ROOT / ("superseded-" + NEW_DATA.name + "-" + attempt.name))
    owner = R3_DATA / ".runtime-owner.json"
    if owner.exists():
        # Its whole process tree is verified gone above; keep the record as evidence.
        owner.rename(attempt / "r3-runtime-owner.json")
    process, events, failure = launch(R3_RELEASE, R3_COMMIT, R3_LOG)
    emit({"phase": "reverted-to-r3", "at": now(), "attempt": attempt.name, "launcherPid": process.pid, "events": [event for event in events if event.get("event") == "inventory_ready"][:1], "failure": failure, "health": health()}, attempt / "revert.json")
    if failure:
        raise SystemExit("R3 did not become ready; its data is unchanged.")


def status(args):
    table = processes()
    emit({"phase": "status", "at": now(), "health": health(), "port8081Listening": listening(), "r3Launchers": [entry["pid"] for entry in launcher_for(R3_RELEASE, table)], "newLaunchers": [entry["pid"] for entry in launcher_for(RELEASE, table)], "runtimeProcesses": [[entry["pid"], entry["state"], " ".join(entry["argv"])[:160]] for entry in runtime_like(table)], "newDataDirectory": NEW_DATA.exists(), "attempts": [path.name for path in attempts()]})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("phase", choices=("preflight", "qualify", "cutover", "verify", "revert", "status"))
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--execution", required=True)
    arguments = parser.parse_args()
    set_environment(arguments)
    {"preflight": preflight, "qualify": qualify, "cutover": cutover, "verify": verify, "revert": revert, "status": status}[arguments.phase](arguments)
