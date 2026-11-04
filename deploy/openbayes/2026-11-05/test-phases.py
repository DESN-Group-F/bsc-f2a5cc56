"""Synthetic Linux tests of cutover.py's recovery phases (rollback, restore, revert refusals and
every resume state) with stand-in launchers and synthetic SQLite databases. No real runtime,
no saved home and no hosted data are involved."""
import importlib.util
import json
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cutover", ROOT / "cutover.py")
cutover = importlib.util.module_from_spec(spec); spec.loader.exec_module(cutover)
preservation = cutover.preservation

# A stand-in launcher: serves /healthz with the identity a real launcher would report for its
# release, mode and commit, until SIGTERM. A file fail-<mode> beside it makes it fail at start.
STAND_IN = r'''import http.server, json, os, signal, sys
from pathlib import Path
here = Path(__file__).resolve().parent
mode = "rollback-predecessor-application" if "rollback" in Path(__file__).name else "normal"
commit = sys.argv[sys.argv.index("--source-commit") + 1]
if (here / ("fail-" + ("rollback" if "rollback" in Path(__file__).name else "normal"))).exists():
    print("stand-in start refused", flush=True); sys.exit(1)
identity = {"status": "ok", "deploymentName": here.name, "sourceCommit": commit, "mode": mode, "migrations": 25}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(identity).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *_): pass
server = http.server.HTTPServer(("127.0.0.1", int(os.environ["INVENTORY_PORT"])), Handler)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print(json.dumps({"event": "inventory_ready", **identity}), flush=True)
server.serve_forever()
'''

KILLED_WRITER = r'''import os, signal, sqlite3, sys
db = sqlite3.connect(sys.argv[1]); db.execute("PRAGMA wal_autocheckpoint=0")
db.execute("INSERT INTO batteries VALUES('BAT-WAL','committed before the kill')"); db.commit()
os.kill(os.getpid(), signal.SIGKILL)
'''


def free_port():
    probe = socket.socket(); probe.bind(("127.0.0.1", 0)); port = probe.getsockname()[1]; probe.close(); return port


def database(path, expected):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript("CREATE TABLE staff_accounts(id TEXT PRIMARY KEY, active INTEGER, role TEXT); CREATE TABLE portable_migrations(name TEXT PRIMARY KEY, sha256 TEXT, applied_at TEXT); CREATE TABLE batteries(id TEXT PRIMARY KEY, name TEXT); CREATE TABLE staff_sessions(id TEXT);")
    db.executemany("INSERT INTO staff_accounts VALUES(?,1,?)", [(str(index), "admin" if index == 0 else "staff") for index in range(8)])
    db.executemany("INSERT INTO portable_migrations VALUES(?,?,'2026-11-04T10:31:00Z')", list(expected.items()))
    db.execute("INSERT INTO batteries VALUES('BAT-1','one')"); db.commit(); db.close()


def write(path, rows):
    db = sqlite3.connect(path); db.executemany("INSERT INTO batteries VALUES(?,?)", rows); db.commit(); db.close()


def raises(kind, text, action):
    try: action()
    except kind as error:
        assert text in str(error), str(error); return
    raise AssertionError("Expected a refusal containing: " + text)


def setup(work, name, commit, expected):
    """A synthetic saved home with both releases (stand-in launchers), the predecessor data and a
    completed copy of it, plus one cutover attempt. Points cutover.py's paths at it."""
    home = work / name; home.mkdir(); (home / ".teaching-deployment.lock").write_bytes(b"0")
    cutover.ROOT = home
    cutover.RELEASE = home / "releases" / cutover.NEW; cutover.PRED_RELEASE = home / "releases" / cutover.PRED
    cutover.NEW_DATA = home / ("data-" + cutover.NEW); cutover.PRED_DATA = home / ("data-" + cutover.PRED)
    cutover.WORK = home / "cutover-20261105"; cutover.LOG = home / "update.log"; cutover.PRED_LOG = home / "predecessor.log"
    cutover.PORT = free_port()
    for release in (cutover.RELEASE, cutover.PRED_RELEASE):
        release.mkdir(parents=True)
        for script in cutover.LAUNCHERS: (release / script).write_text(STAND_IN, encoding="utf-8")
        (release / "deployment.json").write_text("{}", encoding="utf-8")
    pred_db = cutover.PRED_DATA / "d1/store/db.sqlite"; database(pred_db, expected)
    new_db = cutover.NEW_DATA / "d1/store/db.sqlite"; new_db.parent.mkdir(parents=True); shutil.copy2(pred_db, new_db)
    (cutover.NEW_DATA / "upgrade-source.json").write_text(json.dumps({"snapshot": preservation.snapshot(pred_db, expected)}), encoding="utf-8")
    (cutover.NEW_DATA / "upgrade-complete.json").write_text(json.dumps({"deploymentName": cutover.NEW, "sourceCommit": commit, "migrations": 25, "appendedMigrations": [], "schemaVerified": True}), encoding="utf-8")
    attempt = cutover.WORK / "attempt-20261105T000000"; attempt.mkdir(parents=True)
    (attempt / "before-cutover-identities.json").write_text(json.dumps(cutover.identities(pred_db)[0]), encoding="utf-8")
    return home, pred_db, new_db, attempt


def stop_all():
    for release in (cutover.RELEASE, cutover.PRED_RELEASE):
        for entry in cutover.launcher_for(release):
            subprocess.run(["kill", "-TERM", str(entry["pid"])], check=False)


def latest(directory, prefix):
    """The newest phase record whose file name starts with prefix (owner records are skipped)."""
    records = [json.loads(file.read_text(encoding="utf-8")) for file in directory.glob(prefix + "*.json")]
    records = [record for record in records if isinstance(record, dict) and "phase" in record]
    return max(records, key=lambda record: record.get("atEpoch", 0) or record.get("at", ""))


def run():
    results = []
    def passed(name): results.append({"name": name, "passed": True})
    work = Path(tempfile.mkdtemp(prefix="cutover-phase-tests-"))
    expected = {f"{index:04d}_m": f"{index:064x}" for index in range(25)}
    commit = "1" * 40
    cutover.check_identity = lambda args: ({}, expected)
    original_stop_failed_start = cutover.stop_failed_start
    args = lambda mode=None: SimpleNamespace(source_commit=commit, sha256="2" * 64, execution="synthetic", mode=mode)
    try:
        home, pred_db, new_db, attempt = setup(work, "home", commit, expected)
        pristine_pred = work / "pristine-predecessor.sqlite"; shutil.copy2(pred_db, pristine_pred)
        # An execution restart: the writer died with committed frames still in the write-ahead log.
        db = sqlite3.connect(new_db); db.execute("PRAGMA journal_mode=WAL"); db.close()
        subprocess.run([sys.executable, "-c", KILLED_WRITER, str(new_db)], check=False)
        wal = new_db.with_name(new_db.name + "-wal"); assert wal.exists() and wal.stat().st_size > 0
        (cutover.NEW_DATA / ".runtime-owner.json").write_text('{"pid": 999999}', encoding="utf-8")
        cutover.resume(args())
        assert cutover.serving_update(cutover.health(), commit, "normal") and not (cutover.NEW_DATA / ".runtime-owner.json").exists()
        record_dir = sorted(cutover.WORK.glob("resume-*"))[-1]; record = json.loads((record_dir / "resume.json").read_text(encoding="utf-8"))
        assert record["target"] == "update" and record["healthy"] and record["mode"] == "normal" and any(item["name"].endswith("-wal") and item["bytes"] > 0 for item in record["asFound"])
        backup = sqlite3.connect(record_dir / "business-before-resume.sqlite"); assert backup.execute("SELECT name FROM batteries WHERE id='BAT-WAL'").fetchone() == ("committed before the kill",); backup.close()
        passed("resume after an unclean stop keeps the write-ahead log as evidence, backs up every committed record, archives the stale owner record and starts the update")
        raises(RuntimeError, "already answers", lambda: cutover.resume(args()))
        passed("resume refuses while the service answers")
        cutover.rollback(args())
        assert cutover.serving_update(cutover.health(), commit, cutover.ROLLBACK_MODE)
        record = latest(attempt, "rollback-"); assert record["started"] and record["backupMatches"] and Path(record["backup"]).is_file()
        passed("rollback stops the update and starts the predecessor application on the same data, after a verified backup")
        (cutover.RELEASE / "fail-normal").write_text("", encoding="utf-8")
        raises(SystemExit, "started again", lambda: cutover.restore(args()))
        assert cutover.serving_update(cutover.health(), commit, cutover.ROLLBACK_MODE)
        record = latest(attempt, "restore-"); assert record["started"] is False and record["fallback"]["failure"] is None and record["servingModeAfter"] == cutover.ROLLBACK_MODE
        passed("a restore whose start fails returns to rollback mode on the same data")
        cutover.stop_current(cutover.RELEASE)
        cutover.resume(args())
        assert cutover.serving_update(cutover.health(), commit, cutover.ROLLBACK_MODE)
        passed("after a restart, resume without --mode returns to the mode the update last served in (rollback)")
        (cutover.RELEASE / "fail-rollback").write_text("", encoding="utf-8")
        raises(SystemExit, "previous mode was stopped", lambda: cutover.restore(args()))
        assert "unavailable" in cutover.health()
        record = latest(attempt, "restore-"); assert record["previousModeStopped"] and record["servingModeAfter"] is None and record["fallback"]["failure"]
        (cutover.RELEASE / "fail-rollback").unlink()
        cutover.stop_failed_start = lambda process: (_ for _ in ()).throw(RuntimeError("synthetic: a stray runtime remains"))
        cutover.resume(args())
        assert cutover.serving_update(cutover.health(), commit, cutover.ROLLBACK_MODE)
        raises(SystemExit, "synthetic: a stray runtime remains", lambda: cutover.restore(args()))
        record = latest(attempt, "restore-"); assert record["error"] == "synthetic: a stray runtime remains" and record["servingModeAfter"] is None
        cutover.stop_failed_start = original_stop_failed_start
        (cutover.RELEASE / "fail-normal").unlink()
        cutover.resume(args())
        assert cutover.serving_update(cutover.health(), commit, cutover.ROLLBACK_MODE)
        passed("when neither mode starts, or the failed start cannot be cleared, the record is still written and resume recovers the last serving mode")
        cutover.restore(args())
        assert cutover.serving_update(cutover.health(), commit, "normal")
        passed("restore returns to the update")
        write(pred_db, [("BAT-PRED", "written to the predecessor after cutover")])
        pid = cutover.launcher_for(cutover.RELEASE)[0]["pid"]
        raises(RuntimeError, "Nothing was stopped", lambda: cutover.rollback(args()))
        assert cutover.serving_update(cutover.health(), commit, "normal") and cutover.launcher_for(cutover.RELEASE)[0]["pid"] == pid
        shutil.copy2(pristine_pred, pred_db)
        passed("rollback refuses before stopping anything once the predecessor's own data moved on")
        raises(RuntimeError, "Nothing was stopped", lambda: cutover.revert(args()))
        assert cutover.serving_update(cutover.health(), commit, "normal") and cutover.launcher_for(cutover.RELEASE)[0]["pid"] == pid
        passed("revert refuses before stopping anything when the update already holds changed business records")
        cutover.stop_current(cutover.RELEASE)
        raises(RuntimeError, "must not serve its own older data", lambda: cutover.resume(args("predecessor")))
        complete = cutover.NEW_DATA / "upgrade-complete.json"; complete.rename(work / "upgrade-complete.json")
        raises(RuntimeError, "Run `revert`", lambda: cutover.resume(args())); assert "unavailable" in cutover.health()
        (work / "upgrade-complete.json").rename(complete)
        passed("resume refuses the predecessor while this update's copy is current, and an interrupted cutover (copy without completion), naming revert")
        cutover.NEW_DATA.rename(home / "superseded-copy")
        raises(RuntimeError, "Run `revert`", lambda: cutover.resume(args())); assert "unavailable" in cutover.health()
        passed("resume refuses a stopped predecessor with no copy and no completed revert")
        shutil.rmtree(cutover.WORK); cutover.WORK.mkdir()
        raises(RuntimeError, "--mode predecessor", lambda: cutover.resume(args()))
        cutover.resume(args("predecessor"))
        assert cutover.serving_predecessor(cutover.health())
        cutover.stop_current(cutover.PRED_RELEASE)
        passed("with no cutover recorded, resume starts the 4 November release only with an explicit --mode predecessor")

        # A complete revert on a fresh home whose copy holds nothing new.
        home, pred_db, new_db, attempt = setup(work, "home-revert", commit, expected)
        cutover.resume(args())
        assert cutover.serving_update(cutover.health(), commit, "normal")
        db = sqlite3.connect(new_db); db.execute("INSERT INTO staff_sessions VALUES('a session is not a business record')"); db.commit(); db.close()
        cutover.revert(args())
        assert cutover.serving_predecessor(cutover.health()) and not cutover.NEW_DATA.exists() and (home / ("superseded-" + cutover.NEW_DATA.name + "-" + attempt.name)).is_dir()
        assert latest(attempt, "reverted-")["failure"] is None
        passed("revert serves the 4 November release on its unchanged data while the update holds no business record, and renames the copy aside")
        cutover.stop_current(cutover.PRED_RELEASE)
        raises(RuntimeError, "use no --mode or --mode predecessor", lambda: cutover.resume(args("rollback")))
        cutover.resume(args())
        assert cutover.serving_predecessor(cutover.health())
        passed("after a completed revert, resume starts the 4 November release on its own data")
        cutover.stop_current(cutover.PRED_RELEASE)
    finally:
        cutover.stop_failed_start = original_stop_failed_start
        stop_all()
    print(json.dumps({"passed": True, "checks": len(results), "results": results, "syntheticDataOnly": True, "workDirectory": str(work)}, indent=2))


if __name__ == "__main__": run()
