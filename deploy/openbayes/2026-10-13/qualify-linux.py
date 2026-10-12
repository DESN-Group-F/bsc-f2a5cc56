"""Qualify the sealed runtime and maintenance rollback using an isolated synthetic Linux saved home."""
import argparse
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import queue
import threading
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from preservation import NAME, PREVIOUS, PREVIOUS_COMMIT, PUBLIC_ORIGIN, expected_migrations, snapshot, database_file, verify_bundle, verify_previous_application

ROOT = Path(__file__).resolve().parent


def run(args):
    if platform.system() != "Linux": raise RuntimeError("This qualification hook requires Linux; Windows results cannot establish Linux acceptance.")
    def interrupted(_signal, _frame): raise KeyboardInterrupt("Synthetic Linux qualification was interrupted.")
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    previous = args.previous_release.resolve()
    previous_project = previous.parent.parent
    if previous.name != PREVIOUS or verify_previous_application(previous_project) != previous:
        raise RuntimeError("Select the exact verified predecessor application, never a business-data directory.")
    if not args.fixture_root.is_dir() or args.fixture_root.resolve().is_relative_to(previous_project.resolve()):
        raise RuntimeError("Select an existing independent synthetic fixture root.")
    spec = importlib.util.spec_from_file_location("sealed_installer", ROOT / "install-release.py")
    installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
    payload = args.archive.read_bytes(); records = installer.verified_archive(payload, args.sha256, args.source_commit)
    work = Path(tempfile.mkdtemp(prefix="inventory-linux-qualification-", dir=args.fixture_root.resolve()))
    project = work / "home"; project.mkdir(); release = project / "releases" / NAME; release.mkdir(parents=True)
    for name, content in records.items():
        file = release / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(content)
    prior = project / "releases" / PREVIOUS; prior.mkdir()
    prior_manifest = json.loads((previous / "deployment.json").read_text(encoding="utf-8"))
    for record in prior_manifest["files"]:
        name = record["path"]; file = prior / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes((previous / name).read_bytes())
    (prior / "deployment.json").write_bytes((previous / "deployment.json").read_bytes())
    for directory in ("migrations",):
        if not (prior / directory).exists(): shutil.copytree(previous / directory, prior / directory)
    (release / "node_modules").symlink_to(args.node_modules.resolve(), target_is_directory=True)
    credential_file = work / "private-credentials.json"
    fixture_child = subprocess.Popen([str(args.node), str(release / "qualification-fixture.mjs"), str(release), str(project), str(credential_file)], start_new_session=True)
    try:
        if fixture_child.wait(timeout=60) != 0: raise RuntimeError("Synthetic predecessor creation failed.")
    finally:
        if fixture_child.poll() is None:
            try: os.killpg(fixture_child.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: fixture_child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try: os.killpg(fixture_child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                fixture_child.wait(timeout=5)
    credentials = json.loads(credential_file.read_text(encoding="utf-8"))
    expected = expected_migrations(release)
    source_data = project / ("data-" + PREVIOUS); before = snapshot(database_file(source_data), expected)
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "INVENTORY_LOCAL_TEST": "1", "INVENTORY_PROJECT_ROOT": str(project), "INVENTORY_EXPECTED_SAVED_HOME_EXECUTION": "synthetic-linux-qualification-E1", "INVENTORY_RESTORED_FROM_EXECUTION": "synthetic-linux-qualification-E1", "INVENTORY_RELEASE_SOURCE_COMMIT": args.source_commit, "INVENTORY_TEST_NODE": str(args.node), "INVENTORY_TEST_NODE_MODULES": str(args.node_modules.resolve()), "INVENTORY_PORT": "0", "INVENTORY_MANUAL_STOP": "1", "INVENTORY_PUBLIC_ORIGIN": PUBLIC_ORIGIN}
    results, owned = [], []
    def passed(name): results.append({"name": name, "passed": True})
    def start(rollback=False):
        command = [sys.executable, str(release / ("rollback-and-run.py" if rollback else "upgrade-and-run.py")), "--source-commit", args.source_commit]
        if rollback: command.append("--confirm-current-data-maintenance")
        child = subprocess.Popen(command, cwd=release, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", start_new_session=True)
        owned.append(child); lines = []; deadline = time.monotonic() + 60; output = queue.Queue()
        def read_output():
            for line in child.stdout: output.put(line)
            output.put(None)
        threading.Thread(target=read_output, daemon=True).start()
        while time.monotonic() < deadline:
            try: line = output.get(timeout=0.2)
            except queue.Empty: continue
            if line is not None:
                lines.append(line)
                try:
                    value = json.loads(line)
                    if value.get("event") == "inventory_ready":
                        child.inventory_runtime_pid = value["runtimePid"]
                        return child, value
                except json.JSONDecodeError: pass
            if line is None: raise RuntimeError("Qualification runtime failed before ready: " + "".join(lines))
        raise RuntimeError("Qualification runtime startup timed out: " + "".join(lines))
    def stop(child):
        child.terminate()
        child.wait(timeout=20)
        if child.returncode != 0: raise RuntimeError("The qualification launcher did not complete a clean shutdown.")
    def cleanup(child):
        runtime_pid = getattr(child, "inventory_runtime_pid", None)
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                if runtime_pid is None:
                    owner_file = project / ("data-" + NAME) / ".runtime-owner.json"
                    if owner_file.exists():
                        owner = json.loads(owner_file.read_text(encoding="utf-8")); candidate_pid = owner.get("pid")
                        if isinstance(candidate_pid, int) and candidate_pid > 1:
                            status_file = Path("/proc") / str(candidate_pid) / "status"
                            if status_file.exists() and f"PPid:\t{child.pid}\n" in status_file.read_text(): runtime_pid = candidate_pid
                if runtime_pid is not None:
                    try:
                        if os.getpgid(runtime_pid) == runtime_pid: os.killpg(runtime_pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                child.wait(timeout=5)
        if runtime_pid is not None:
            try: os.killpg(runtime_pid, signal.SIGTERM)
            except ProcessLookupError: return
            time.sleep(0.1)
            try: os.killpg(runtime_pid, signal.SIGKILL)
            except ProcessLookupError: pass
    def request(ready, pathname, method="GET", body=None, cookie=None, origin=None):
        connection = http.client.HTTPConnection("127.0.0.1", ready["port"], timeout=20)
        headers = {"Host": "zztv-battery.gear-c1.openbayes.net"}
        if cookie: headers["Cookie"] = cookie
        if origin: headers["Origin"] = origin
        if body is not None: headers["Content-Type"] = "application/json"
        connection.request(method, pathname, body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse(); content = response.read(); response_headers = dict(response.getheaders()); status = response.status; connection.close()
        try: value = json.loads(content)
        except json.JSONDecodeError: value = content.decode("utf-8")
        return status, value, response_headers
    try:
        current, ready = start(); assert ready["mode"] == "normal" and ready["sourceCommit"] == args.source_commit and ready["migrations"] == 23
        status, login, headers = request(ready, "/api/session", "POST", {"action": "signin", "payload": {"username": credentials["username"], "password": credentials["password"]}})
        assert status == 200 and login["user"]["id"] == credentials["accountId"] and "; Secure" in headers["Set-Cookie"]
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        assert request(ready, "/api/inventory?dataset=demo", cookie=cookie)[0] == 200
        assert request(ready, "/api/inventory", "POST", {}, cookie, "https://untrusted.example")[0] == 403
        passed("the sealed Linux runtime starts with exact schema, native account continuity, Secure cookies and strict origin enforcement")
        _, directory, _ = request(ready, "/api/inventory?dataset=demo", cookie=cookie)
        owner = next(person for person in directory["people"] if person["accountId"] == credentials["accountId"])
        at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()); tag = "nfc:uid:0004AB00"
        evidence = {"attemptId": str(uuid.uuid4()), "source": "native-nfc-reader", "platform": "android", "startedAt": at, "endedAt": at, "adoptedAt": at, "tagId": tag, "result": {"uidHex": "0004AB00", "technology": "Controlled Linux qualification evidence", "ndefStatus": "readOnly", "capacityBytes": 144, "records": [{"tnf": 2, "typeHex": "0001", "idHex": "00", "payloadHex": "00fFAa01"}], "observedAt": at}}
        incoming = {"requestId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()), "source": "native_nfc", "tagId": tag, "nfcEvidence": evidence, "scannedAt": at, "common": {"name": "Fictional Linux native qualification asset", "model": "", "chemistry": "", "capacityMah": None, "voltage": None, "ownerId": owner["id"], "homeBuildingId": "J18", "homeRoomId": None, "manufacturedOn": None, "firstUsedOn": None}, "firstUseMode": "unknown"}
        status, registration, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "intake", "payload": incoming}, cookie); assert status == 200 and registration["result"]["nfcEvidence"] == evidence
        asset_id = registration["result"]["batteryId"]
        before_rollback_status, original_detail, _ = request(ready, "/api/inventory?dataset=demo&batteryId=" + asset_id, cookie=cookie); assert before_rollback_status == 200
        stop(current)
        target = project / ("data-" + NAME); later = snapshot(database_file(target), expected)
        assert later != before and snapshot(database_file(source_data), expected) == before
        passed("confirmed post-deployment native evidence is retained in the current database while the predecessor remains unchanged")
        maintenance, rollback_ready = start(rollback=True); assert rollback_ready["mode"] == "maintenance-read-only" and rollback_ready["applicationSourceCommit"] == PREVIOUS_COMMIT
        status, detail, _ = request(rollback_ready, "/api/inventory?dataset=demo&batteryId=" + asset_id, cookie=cookie); assert status == 200
        assert detail["battery"] == original_detail["battery"] and detail["events"] == original_detail["events"] and detail["loans"] == original_detail["loans"] and detail["observations"] == original_detail["observations"]
        status, exported, _ = request(rollback_ready, "/api/export", "POST", {"dataset": "demo", "mode": "detail", "range": "selected", "batteryIds": [asset_id], "sections": ["audit"]}, cookie); assert status == 200
        registration_event = next(row for row in exported["tables"]["Operations"] if row["action"] == "battery_registered" and row["battery_id"] == asset_id)
        original_evidence = json.loads(registration_event["details_json"])
        assert original_evidence["nfcEvidence"] == evidence and original_evidence["source"] == "native_nfc"
        assert original_evidence["requestId"] == incoming["requestId"] and original_evidence["sessionId"] == incoming["sessionId"] and original_evidence["scannedAt"] == incoming["scannedAt"]
        for action in ("operator_register", "movement", "intake", "lifecycle", "initialize_demo"):
            status, rejected, _ = request(rollback_ready, "/api/inventory", "POST", {"dataset": "demo", "action": action, "payload": {}}, cookie); assert status == 503 and rejected["code"] == "maintenance_read_only"
        assert request(rollback_ready, "/api/teaching-checkouts?dataset=demo&format=xlsx&runId=" + str(uuid.uuid4()), cookie=cookie)[0] == 503
        assert request(rollback_ready, "/api/export?format=xlsx", "POST", {"dataset": "demo", "mode": "detail", "range": "selected", "batteryIds": [asset_id]}, cookie)[0] == 503
        assert snapshot(database_file(target), expected) == later
        stop(maintenance)
        passed("maintenance rollback uses the CURRENT database, preserves complete native JSON evidence and blocks incompatible business writes/human exports")
        restarted, restart_ready = start(); assert restart_ready["completedDatabaseRetained"] is True
        status, replay, _ = request(restart_ready, "/api/inventory", "POST", {"dataset": "demo", "action": "intake", "payload": incoming}, cookie); assert status == 200 and replay["result"] == {**registration["result"], "replayed": True}
        assert request(restart_ready, "/api/session", cookie=cookie)[1]["user"]["id"] == credentials["accountId"]
        stop(restarted)
        assert snapshot(database_file(source_data), expected) == before and snapshot(target / "original-backup.sqlite", expected) == before
        assert not (target / ".runtime-owner.json").exists()
        passed("restoring the new source retains later stock, exact original-request receipts and native sessions without recopying old data")
        report = {"passed": True, "checks": len(results), "results": results, "workDirectory": str(work), "archiveSha256": args.sha256, "sourceCommit": args.source_commit, "syntheticDataOnly": True, "normalBusinessDatabaseAccessed": False, "ownedProcessesStopped": all(child.poll() is not None for child in owned), "publicTlsQualified": False}
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
    finally:
        for child in owned:
            cleanup(child)
        credential_file.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path); parser.add_argument("--sha256", required=True); parser.add_argument("--source-commit", required=True)
    parser.add_argument("--previous-release", required=True, type=Path); parser.add_argument("--node", required=True, type=Path); parser.add_argument("--node-modules", required=True, type=Path)
    parser.add_argument("--fixture-root", default=Path(tempfile.gettempdir()), type=Path); parser.add_argument("--report", required=True, type=Path)
    run(parser.parse_args())
