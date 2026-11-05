"""Local Linux tests of the cutover helper's process, port and comparison logic (synthetic only)."""
import importlib.util
import json
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cutover", ROOT / "cutover.py")
cutover = importlib.util.module_from_spec(spec); spec.loader.exec_module(cutover)

LAUNCHER = """import signal, subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "runtime.mjs"])
def stop(*_):
    child.terminate(); child.wait(); sys.exit(0)
signal.signal(signal.SIGTERM, stop)
while True: time.sleep(0.2)
"""


def run():
    results = []
    def passed(name): results.append({"name": name, "passed": True})
    work = Path(tempfile.mkdtemp(prefix="cutover-tests-"))
    release = work / "releases" / "fixture-release"; release.mkdir(parents=True)
    (release / "upgrade-and-run.py").write_text(LAUNCHER, encoding="utf-8")
    owned = []
    try:
        listener = socket.socket(); listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); listener.bind(("127.0.0.1", 0)); listener.listen()
        port = listener.getsockname()[1]
        assert cutover.listening(port)
        client = socket.create_connection(("127.0.0.1", port)); accepted, _ = listener.accept(); accepted.close(); client.close(); listener.close()
        time.sleep(0.2)
        assert not cutover.listening(port)
        passed("a closed listener with lingering TIME_WAIT connections is not reported as listening")
        # Started with a relative path from its own directory, as a notebook might.
        launcher = subprocess.Popen([sys.executable, "upgrade-and-run.py"], cwd=release, start_new_session=True); owned.append(launcher)
        time.sleep(0.8)
        found = cutover.launcher_for(release)
        assert [entry["pid"] for entry in found] == [launcher.pid]
        entry, members = cutover.single_launcher(release)
        assert entry["pid"] == launcher.pid and len(members) == 2
        passed("the launcher is found by its resolved script path and its runtime child belongs to its tree")
        (release / "rollback-and-run.py").write_text(LAUNCHER, encoding="utf-8")
        rollback = subprocess.Popen([sys.executable, str(release / "rollback-and-run.py"), "--confirm-current-data-predecessor-application"], cwd="/", start_new_session=True); owned.append(rollback)
        time.sleep(0.8)
        assert sorted(entry["pid"] for entry in cutover.launcher_for(release)) == sorted([launcher.pid, rollback.pid])
        try: cutover.single_launcher(release); raise AssertionError("Two launchers were accepted.")
        except RuntimeError as error: assert "Expected exactly one launcher" in str(error)
        other = work / "releases" / "other-release"; other.mkdir(); assert cutover.launcher_for(other) == []
        rollback.terminate(); rollback.wait(timeout=5); time.sleep(0.3)
        passed("rollback launchers are found by their absolute script path, two launchers refuse, and another release's launchers are not matched")
        stray = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "workerd"]); owned.append(stray)
        time.sleep(0.3)
        try: cutover.single_launcher(release); raise AssertionError("A stray runtime was accepted.")
        except RuntimeError as error: assert "outside the expected launcher" in str(error)
        stray.terminate(); stray.wait()
        passed("a runtime process outside the launcher's tree refuses before anything is stopped")
        zombie = subprocess.Popen([sys.executable, "-c", "pass"]); time.sleep(0.5)
        assert not cutover.alive(zombie.pid); zombie.wait()
        passed("an exited but unreaped process counts as stopped")
        entry, members = cutover.single_launcher(release)
        original_port = cutover.PORT; cutover.PORT = port
        try: assert cutover.stop_tree(entry, members, seconds=20)
        finally: cutover.PORT = original_port
        launcher.wait(timeout=5)
        assert not any(cutover.alive(pid) for pid in members)
        passed("SIGTERM to the launcher stops its whole tree, and the stop is confirmed")
        database = work / "fixture.sqlite"
        db = sqlite3.connect(database)
        db.executescript("CREATE TABLE portable_migrations(name TEXT PRIMARY KEY, sha256 TEXT); CREATE TABLE batteries(id TEXT PRIMARY KEY, name TEXT); CREATE TABLE staff_sessions(id TEXT);")
        db.executemany("INSERT INTO portable_migrations VALUES(?,?)", [(f"{index:04d}_m", "x") for index in range(25)]); db.execute("INSERT INTO batteries VALUES('BAT-1','one')"); db.commit()
        before, receipts, _ = cutover.identities(database)
        db.execute("INSERT INTO staff_sessions VALUES('s')"); db.commit()
        after, more, _ = cutover.identities(database)
        assert len(receipts) == 25 and more == receipts and cutover.changed(before, after) == []
        db.execute("UPDATE batteries SET name='changed'"); db.commit(); db.close()
        assert cutover.changed(before, cutover.identities(database)[0]) == ["batteries"]
        copy = work / "copy.sqlite"; cutover.online_copy(database, copy)
        assert cutover.identities(copy)[0] == cutover.identities(database)[0]
        passed("sessions are not business changes; an edited row is; the online copy is identical")
    finally:
        for process in owned:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill()
    print(json.dumps({"passed": True, "checks": len(results), "results": results}, indent=2))


if __name__ == "__main__": run()
