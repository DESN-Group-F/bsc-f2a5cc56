"""Qualify the sealed code-only update and its rollback using an isolated synthetic Linux saved home."""
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
import sqlite3
from preservation import NAME, PREVIOUS, PREVIOUS_COMMIT, PUBLIC_ORIGIN, MIGRATIONS, PREVIOUS_MIGRATIONS, expected_migrations, snapshot, database_file, verify_bundle, verify_previous_application

ROOT = Path(__file__).resolve().parent


def run(args):
    if platform.system() != "Linux": raise RuntimeError("This qualification hook requires Linux; Windows results cannot establish Linux acceptance.")
    if sys.flags.optimize: raise RuntimeError("The qualification checks are assertions; run without -O or PYTHONOPTIMIZE.")
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
        if rollback: command.append("--confirm-current-data-predecessor-application")
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
    def interrupted_start():
        # A controlled failure after schema verification, before completion, must leave a resumable copy.
        command = [sys.executable, str(release / "upgrade-and-run.py"), "--source-commit", args.source_commit]
        child = subprocess.run(command, cwd=release, env={**environment, "INVENTORY_TEST_STOP_BEFORE_COMPLETION": "1"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", timeout=120, start_new_session=True)
        if child.returncode == 0 or '"event":"inventory_ready"' in child.stdout.replace(" ", ""): raise RuntimeError("The controlled interruption did not stop before HTTP.")
        return child.stdout
    def receipts(file):
        db = sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)
        try: return [row[0] for row in db.execute("SELECT name FROM portable_migrations ORDER BY name")], {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
        finally: db.close()
    def request(ready, pathname, method="GET", body=None, cookie=None, origin=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", ready["port"], timeout=20)
        headers = {"Host": "zztv-battery.gear-c1.openbayes.net", **(headers or {})}
        if cookie: headers["Cookie"] = cookie
        if origin: headers["Origin"] = origin
        if body is not None: headers["Content-Type"] = "application/json"
        connection.request(method, pathname, body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse(); content = response.read(); response_headers = dict(response.getheaders()); status = response.status
        response_headers["Content-Security-Policy"] = response.msg.get_all("Content-Security-Policy") or []  # every policy, not only the last
        connection.close()
        try: value = json.loads(content)
        except json.JSONDecodeError: value = content.decode("utf-8")
        return status, value, response_headers
    try:
        prior_names, prior_triggers = receipts(database_file(source_data))
        assert len(prior_names) == PREVIOUS_MIGRATIONS == MIGRATIONS
        output = interrupted_start()
        target = project / ("data-" + NAME)
        names, triggers = receipts(database_file(target)); assert names == prior_names and triggers == prior_triggers and '"migration_applied_verified"' not in output
        assert snapshot(database_file(target), expected) == before and snapshot(database_file(source_data), expected) == before
        assert not (target / "upgrade-complete.json").exists() and not (target / ".runtime-owner.json").exists()
        passed("an interrupted first start appends nothing, keeps every original cell and leaves a resumable copy")
        current, ready = start(); assert ready["mode"] == "normal" and ready["sourceCommit"] == args.source_commit and ready["migrations"] == MIGRATIONS and ready["deploymentName"] == NAME
        names, triggers = receipts(database_file(target)); assert names == prior_names and triggers == prior_triggers
        assert {"metadata_edit_operations_no_replace", "csv_import_operations_no_replace", "model_create_operations_no_replace"} <= triggers
        complete = json.loads((target / "upgrade-complete.json").read_text(encoding="utf-8")); assert complete["appendedMigrations"] == [] and complete["migrations"] == MIGRATIONS
        assert snapshot(database_file(target), expected) == before and snapshot(target / "original-backup.sqlite", expected) == before
        passed("the resumed start completes the copy with the same 25 receipts and triggers, no appended migration and every original typed cell")
        status, login, headers = request(ready, "/api/session", "POST", {"action": "signin", "payload": {"username": credentials["username"], "password": credentials["password"]}})
        assert status == 200 and login["user"]["id"] == credentials["accountId"] and "; Secure" in headers["Set-Cookie"]
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        assert request(ready, "/api/inventory?dataset=demo", cookie=cookie)[0] == 200
        assert request(ready, "/api/inventory", "POST", {}, cookie, "https://untrusted.example")[0] == 403
        status, page, _ = request(ready, "/console", cookie=cookie); assert status == 200 and "<html" in page.lower()
        assert request(ready, "/console")[0] in (302, 303, 307)
        assert request(ready, "/nfc-test")[0] == 404
        passed("the update starts with native account continuity, Secure cookies, strict origin enforcement, the signed-in console page and without the removed NFC test page")
        account = {"username": credentials["username"], "password": credentials["password"]}
        teams_policy = ["frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft"]
        status, _, page_headers = request(ready, "/signin")
        assert status == 200 and page_headers["Content-Security-Policy"] == teams_policy and "X-Frame-Options" not in page_headers, page_headers
        assert request(ready, "/")[2]["Content-Security-Policy"] == ["frame-ancestors 'none'"] and request(ready, "/api/session")[2]["Content-Security-Policy"] == ["frame-ancestors 'none'"]
        frame = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe"}
        status, _, entry_headers = request(ready, "/console", headers=frame); assert status in (302, 303, 307) and "/signin" in entry_headers.get("Location", ""), (status, entry_headers)
        assert request(ready, "/api/session", headers=frame)[0] == 403 and request(ready, "/", headers=frame)[0] == 403
        assert request(ready, "/console", headers={**frame, "Sec-Fetch-Site": "same-site"})[0] == 403
        status, _, embedded_headers = request(ready, "/api/session", "POST", {"action": "signin", "embedded": True, "payload": account})
        embedded_set = embedded_headers.get("Set-Cookie", ""); assert status == 200 and "; SameSite=None;" in embedded_set and embedded_set.endswith("; Secure; Partitioned"), embedded_set
        embedded_cookie = embedded_set.split(";", 1)[0]
        assert request(ready, "/api/inventory?dataset=demo", cookie=embedded_cookie)[0] == 200
        status, tab_page, tab_headers = request(ready, "/console", cookie=embedded_cookie, headers=frame)
        assert status == 200 and "<html" in tab_page.lower() and tab_headers["Content-Security-Policy"] == teams_policy, (status, tab_headers)
        assert request(ready, "/api/battery-models", "POST", {"dataset": "demo", "payload": {}}, embedded_cookie, "https://teams.microsoft.com")[0] == 403
        status, _, signout_headers = request(ready, "/api/session", "POST", {"action": "signout", "embedded": True}, embedded_cookie)
        assert status == 200 and signout_headers.get("Set-Cookie", "").startswith("inventory_session=;") and signout_headers["Set-Cookie"].endswith("; Max-Age=0; Secure; Partitioned")
        assert request(ready, "/api/inventory?dataset=demo", cookie=embedded_cookie)[0] == 401
        passed("only the console and its sign-in page may be framed, only by Microsoft Teams (frame-ancestors, no X-Frame-Options; every other response forbids framing); a cross-site frame may load them but no other page or API; a sign-in inside a frame gets a Secure, Partitioned SameSite=None session that opens the console in the frame, reads like any other, cannot write cross-site and ends on sign-out")
        _, directory, _ = request(ready, "/api/inventory?dataset=demo", cookie=cookie)
        owner = next(person for person in directory["people"] if person["accountId"] == credentials["accountId"])
        at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()); tag = "nfc:uid:04A1B2C3D4E5F6"
        # The browser reader's evidence shape (Web NFC on Android): no records or capacity are claimed.
        evidence = {"attemptId": str(uuid.uuid4()), "source": "native-nfc-reader", "platform": "android", "startedAt": at, "endedAt": at, "adoptedAt": at, "tagId": tag, "result": {"uidHex": "04A1B2C3D4E5F6", "technology": "Web NFC (Chrome on Android)", "ndefStatus": "unknown", "capacityBytes": None, "records": [], "observedAt": at}}
        incoming = {"requestId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()), "source": "native_nfc", "tagId": tag, "nfcEvidence": evidence, "scannedAt": at, "common": {"name": "Fictional Linux qualification asset", "model": "", "chemistry": "", "capacityMah": None, "voltage": None, "ownerId": owner["id"], "homeBuildingId": "J18", "homeRoomId": None, "manufacturedOn": None, "firstUsedOn": None}, "firstUseMode": "unknown"}
        status, registration, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "intake", "payload": incoming}, cookie); assert status == 200 and registration["result"]["nfcEvidence"] == evidence, registration
        asset_id = registration["result"]["batteryId"]
        _, directory, _ = request(ready, "/api/inventory?dataset=demo", cookie=cookie)
        battery = next(item for item in directory["batteries"] if item["id"] == asset_id)
        person = next(item for item in directory["people"] if item["id"] == battery["ownerId"]); building = next(item for item in directory["buildings"] if item["id"] == "J18")
        values = {key: battery[key] for key in ("name", "model", "chemistry", "capacityMah", "voltage", "tagId", "ownerId", "homeRoomId", "manufacturedOn", "firstUsedOn")}
        edit = {"requestId": str(uuid.uuid4()), "batteryId": asset_id, "before": {**values, "homeBuildingId": battery["homeBuildingId"], "version": battery["version"], "registeredAt": battery["registeredAt"]}, "fields": {**values, "name": "Fictional edited qualification asset", "homeBuildingId": "J18"}, "directoryBindings": {"ownerVersion": person["version"], "ownerAccountId": person["accountId"], "buildingVersion": building["version"], "roomVersion": None}}
        status, edited, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "operator_edit", "payload": edit}, cookie)
        assert status == 200 and edited["result"]["state"] == "confirmed" and edited["result"]["receipt"]["replayed"] is False, edited
        status, edit_replay, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "operator_edit", "payload": edit}, cookie)
        assert status == 200 and edit_replay["result"]["receipt"]["replayed"] is True and edit_replay["result"]["receipt"]["after"]["version"] == battery["version"] + 1, edit_replay
        status, outcome, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "operator_edit_outcome", "payload": edit}, cookie); assert status == 200 and outcome["result"]["state"] == "confirmed", outcome
        legacy = {"id": str(uuid.uuid4()), "brand": "Fictional", "model": "QUAL-LEGACY", "variant": "", "name": "Fictional legacy model", "chemistry": "", "capacityMah": 1200, "voltage": 3.7, "notes": ""}
        first_legacy = request(ready, "/api/battery-models", "POST", {"dataset": "demo", "payload": legacy}, cookie); replay_legacy = request(ready, "/api/battery-models", "POST", {"dataset": "demo", "payload": legacy}, cookie)
        assert first_legacy[0] == 200 and replay_legacy[0] == 200, (first_legacy, replay_legacy)
        model = {**legacy, "id": str(uuid.uuid4()), "model": "QUAL-UPDATE", "name": "Fictional update model"}
        assert request(ready, "/api/battery-models", "POST", {"dataset": "demo", "action": "create_reviewed", "payload": model}, cookie)[0] == 200
        assert request(ready, "/api/battery-models", "POST", {"dataset": "demo", "action": "create_reviewed", "payload": model}, cookie)[0] == 200
        passed("Web NFC-shaped intake evidence, a metadata edit with its outcome lookup, and legacy (native client) and reviewed model creation commit once on the update; their exact retries return the original receipts")
        e10_room = {"id": "QUAL-E10-ROOM", "name": "Fictional makerspace", "buildingId": "E10", "number": "QUAL-1", "isPlaceholder": False}
        status, refused_room, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "room", "payload": e10_room}, cookie); assert status == 400, refused_room
        status, saved_room, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "room", "payload": {**e10_room, "id": "QUAL-J18-ROOM", "buildingId": "J18"}}, cookie); assert status == 200, saved_room
        e10_pack = {"id": "QUAL-E10-PACK", "name": "Fictional E10 asset", "ownerId": owner["id"], "homeBuildingId": "E10", "homeRoomId": None}
        status, saved_pack, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "battery", "payload": e10_pack}, cookie); assert status == 200, saved_pack
        status, g17_pack, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "battery", "payload": {**e10_pack, "id": "QUAL-G17-PACK", "homeBuildingId": "G17"}}, cookie); assert status == 200, g17_pack
        status, mixed, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "battery", "payload": {**e10_pack, "id": "QUAL-MIXED-PACK", "homeRoomId": "QUAL-J18-ROOM"}}, cookie); assert status == 400, mixed
        status, unsupported, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "battery", "payload": {**e10_pack, "id": "QUAL-K17-PACK", "homeBuildingId": "K17"}}, cookie); assert status == 400, unsupported
        _, directory, _ = request(ready, "/api/inventory?dataset=demo", cookie=cookie)
        stored = {item["id"]: (item["homeBuildingId"], item["homeRoomId"]) for item in directory["batteries"] if item["id"].startswith("QUAL-") and item["id"].endswith("-PACK")}
        assert stored == {"QUAL-E10-PACK": ("E10", None), "QUAL-G17-PACK": ("G17", None)}, stored
        pack = next(item for item in directory["batteries"] if item["id"] == "QUAL-E10-PACK"); g17 = next(item for item in directory["buildings"] if item["id"] == "G17")
        pack_values = {key: pack[key] for key in ("name", "model", "chemistry", "capacityMah", "voltage", "tagId", "ownerId", "homeRoomId", "manufacturedOn", "firstUsedOn")}
        move = {"requestId": str(uuid.uuid4()), "batteryId": "QUAL-E10-PACK", "before": {**pack_values, "homeBuildingId": pack["homeBuildingId"], "version": pack["version"], "registeredAt": pack["registeredAt"]}, "fields": {**pack_values, "homeBuildingId": "G17"}, "directoryBindings": {"ownerVersion": person["version"], "ownerAccountId": person["accountId"], "buildingVersion": g17["version"], "roomVersion": None}}
        status, moved, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "operator_edit", "payload": move}, cookie)
        assert status == 200 and moved["result"]["state"] == "confirmed" and moved["result"]["receipt"]["after"]["homeBuildingId"] == "G17", moved
        status, move_replay, _ = request(ready, "/api/inventory", "POST", {"dataset": "demo", "action": "operator_edit", "payload": move}, cookie)
        assert status == 200 and move_replay["result"]["receipt"]["replayed"] is True, move_replay
        passed("E10 and G17 accept registered storage without a room, and a reviewed metadata edit moves storage from E10 to G17 once (its exact retry replays); rooms stay in J18; a J18 room under another building and an unsupported building are refused")
        status, working, _ = request(ready, "/api/inventory?dataset=live", cookie=cookie); assert status == 200, working
        assert working["capabilities"]["nativeNfc"]["enabled"] is True and working["capabilities"]["nativeNfc"]["enabledDatasets"] == ["demo", "live"], working["capabilities"]
        status, working_lookup, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "scan_lookup", "payload": {"source": "native_nfc", "tagIds": ["nfc:uid:0004AB00"]}}, cookie)
        assert status == 200 and working_lookup["result"]["source"] == "native_nfc" and working_lookup["result"]["results"][0]["battery"] is None, working_lookup
        status, working_simulated, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "scan_lookup", "payload": {"source": "simulated", "tagIds": ["nfc:uid:0004AB00"]}}, cookie); assert status == 400, working_simulated
        live_owner = next(person for person in working["people"] if person["accountId"] == credentials["accountId"])
        live_tag = "nfc:uid:04A1B2C3D4E5F7"
        live_evidence = {**evidence, "attemptId": str(uuid.uuid4()), "tagId": live_tag, "result": {**evidence["result"], "uidHex": "04A1B2C3D4E5F7"}}
        live_incoming = {**incoming, "requestId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()), "tagId": live_tag, "nfcEvidence": live_evidence, "common": {**incoming["common"], "name": "Fictional Working qualification asset", "ownerId": live_owner["id"], "homeBuildingId": "E10"}}
        status, live_registration, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "intake", "payload": live_incoming}, cookie)
        assert status == 200 and live_registration["result"]["source"] == "native_nfc" and live_registration["result"]["nfcEvidence"] == live_evidence, live_registration
        status, live_replay, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "intake", "payload": live_incoming}, cookie); assert status == 200 and live_replay["result"] == {**live_registration["result"], "replayed": True}, live_replay
        live_id = live_registration["result"]["batteryId"]
        status, found, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "scan_lookup", "payload": {"source": "native_nfc", "tagIds": [live_tag]}}, cookie)
        assert status == 200 and found["result"]["results"][0]["battery"]["id"] == live_id, found
        live_binding = {"batteryId": live_id, "tagId": live_tag, "version": found["result"]["results"][0]["battery"]["version"], "nfcEvidence": live_evidence}
        live_checkout = {"requestId": str(uuid.uuid4()), "kind": "checkout", "batteryIds": [live_id], "scan": {"sessionId": str(uuid.uuid4()), "source": "native_nfc", "bindings": [live_binding]}}
        status, live_out, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "movement", "payload": live_checkout}, cookie); assert status == 200 and live_out["result"]["scan"]["source"] == "native_nfc", live_out
        status, live_held, _ = request(ready, "/api/inventory?dataset=live&batteryId=" + live_id, cookie=cookie); assert status == 200 and live_held["battery"]["loanId"], live_held
        live_return = {"requestId": str(uuid.uuid4()), "kind": "return", "batteryIds": [live_id], "expectedLoans": [{"batteryId": live_id, "loanId": live_held["battery"]["loanId"]}], "scan": {"sessionId": str(uuid.uuid4()), "source": "native_nfc", "bindings": [{**live_binding, "version": live_held["battery"]["version"]}]}}
        status, live_back, _ = request(ready, "/api/inventory", "POST", {"dataset": "live", "action": "movement", "payload": live_return}, cookie); assert status == 200 and live_back["result"]["scan"]["source"] == "native_nfc", live_back
        passed("the Working inventory advertises native NFC; a Working tag registers by NFC in E10 (its exact retry replays), is found by a native lookup, and is checked out and returned by NFC; simulated scans stay Demonstration-only")
        before_rollback_status, original_detail, _ = request(ready, "/api/inventory?dataset=demo&batteryId=" + asset_id, cookie=cookie); assert before_rollback_status == 200
        # An execution restart kills every process without shutdown: emulate it with SIGKILL.
        runtime_pid = current.inventory_runtime_pid
        os.killpg(runtime_pid, signal.SIGKILL); os.killpg(current.pid, signal.SIGKILL); current.wait(timeout=10)
        for _ in range(50):
            if not any(Path("/proc", name).is_dir() for name in (str(runtime_pid),)): break
            time.sleep(0.1)
        owner_file = target / ".runtime-owner.json"; assert owner_file.exists()
        wal_after_kill = sum(file.stat().st_size for file in target.joinpath("d1").rglob("*.sqlite-wal"))
        owner_file.rename(work / "stale-runtime-owner.json")  # as `cutover.py resume` does once no process remains
        current, ready = start(); assert ready["mode"] == "normal" and ready["completedDatabaseRetained"] is True
        status, detail_after_kill, _ = request(ready, "/api/inventory?dataset=demo&batteryId=" + asset_id, cookie=cookie); assert status == 200 and all(detail_after_kill[key] == original_detail[key] for key in ("battery", "events", "loans", "observations"))
        _, models_after_kill, _ = request(ready, "/api/battery-models?dataset=demo", cookie=cookie); assert legacy["id"] in json.dumps(models_after_kill) and model["id"] in json.dumps(models_after_kill)
        passed(f"after an unclean stop (SIGKILL, as on an execution restart; {wal_after_kill} bytes of write-ahead log left) the update starts again on the same copy with every committed record")
        stop(current)
        later = snapshot(database_file(target), expected)
        assert later != before and snapshot(database_file(source_data), expected) == before
        passed("records written on the update are retained in its current database while the predecessor data stays unchanged")
        previous_app, rollback_ready = start(rollback=True)
        assert rollback_ready["mode"] == "rollback-predecessor-application" and rollback_ready["applicationSourceCommit"] == PREVIOUS_COMMIT and rollback_ready["applicationDeploymentName"] == PREVIOUS and rollback_ready["migrations"] == MIGRATIONS
        status, rollback_pack, _ = request(rollback_ready, "/api/inventory", "POST", {"dataset": "demo", "action": "battery", "payload": {**e10_pack, "id": "QUAL-E10-ROLLBACK"}}, cookie)
        assert status == 200, rollback_pack  # the storage-buildings Worker also accepts E10 storage
        status, gated_lookup, _ = request(rollback_ready, "/api/inventory", "POST", {"dataset": "live", "action": "scan_lookup", "payload": {"source": "native_nfc", "tagIds": ["nfc:uid:0004AB00"]}}, cookie)
        assert status == 400 and gated_lookup.get("code") == "native_nfc_demo_only", gated_lookup  # the storage-buildings Worker still limits NFC to Demonstration
        status, e10_detail, _ = request(rollback_ready, "/api/inventory?dataset=demo&batteryId=QUAL-E10-PACK", cookie=cookie); assert status == 200 and e10_detail["battery"]["homeBuildingId"] == "G17", e10_detail
        status, _, old_headers = request(rollback_ready, "/api/session", "POST", {"action": "signin", "embedded": True, "payload": account})
        assert status == 200 and "; SameSite=None;" in old_headers.get("Set-Cookie", ""), old_headers  # the storage-buildings Worker keeps the embedded session
        assert request(rollback_ready, "/signin")[2]["Content-Security-Policy"] == teams_policy
        status, detail, _ = request(rollback_ready, "/api/inventory?dataset=demo&batteryId=" + asset_id, cookie=cookie); assert status == 200
        assert detail["battery"] == original_detail["battery"] and detail["events"] == original_detail["events"] and detail["loans"] == original_detail["loans"] and detail["observations"] == original_detail["observations"]
        status, exported, _ = request(rollback_ready, "/api/export", "POST", {"dataset": "demo", "mode": "detail", "range": "selected", "batteryIds": [asset_id], "sections": ["audit"]}, cookie); assert status == 200
        registration_event = next(row for row in exported["tables"]["Operations"] if row["action"] == "battery_registered" and row["battery_id"] == asset_id)
        assert json.loads(registration_event["details_json"])["nfcEvidence"] == evidence
        rollback_model = {**model, "id": str(uuid.uuid4()), "model": "QUAL-ROLLBACK", "name": "Fictional rollback model"}
        assert request(rollback_ready, "/api/battery-models", "POST", {"dataset": "demo", "action": "create_reviewed", "payload": rollback_model}, cookie)[0] == 200
        status, edit_after, _ = request(rollback_ready, "/api/inventory", "POST", {"dataset": "demo", "action": "operator_edit", "payload": edit}, cookie); assert status == 200 and edit_after["result"]["receipt"]["replayed"] is True, edit_after
        assert request(rollback_ready, "/console", cookie=cookie)[0] == 200
        rollback_record = json.loads((target / "rollback-source.json").read_text(encoding="utf-8")); assert rollback_record["readOnlyBusinessOperations"] is False and (target / rollback_record["backup"]).is_file()
        stop(previous_app)
        after_rollback = snapshot(database_file(target), expected)
        assert after_rollback != later and snapshot(database_file(source_data), expected) == before
        passed("rollback serves the CURRENT database through the 5 November storage-buildings application (which accepts E10 storage but still refuses Working inventory NFC) behind this gateway, with complete evidence, exact receipts and ordinary writes; the predecessor data stays unchanged")
        restarted, restart_ready = start(); assert restart_ready["completedDatabaseRetained"] is True and restart_ready["mode"] == "normal"
        status, replay, _ = request(restart_ready, "/api/inventory", "POST", {"dataset": "demo", "action": "intake", "payload": incoming}, cookie); assert status == 200 and replay["result"] == {**registration["result"], "replayed": True}
        assert request(restart_ready, "/api/session", cookie=cookie)[1]["user"]["id"] == credentials["accountId"]
        _, models, _ = request(restart_ready, "/api/battery-models?dataset=demo", cookie=cookie); assert rollback_model["id"] in json.dumps(models) and model["id"] in json.dumps(models)
        assert "; SameSite=None;" in request(restart_ready, "/api/session", "POST", {"action": "signin", "embedded": True, "payload": account})[2].get("Set-Cookie", "")
        assert request(restart_ready, "/api/inventory", "POST", {"dataset": "demo", "action": "battery", "payload": {**e10_pack, "id": "QUAL-E10-RESTORED"}}, cookie)[0] == 200
        stop(restarted)
        assert snapshot(database_file(source_data), expected) == before and snapshot(target / "original-backup.sqlite", expected) == before
        assert not (target / ".runtime-owner.json").exists()
        passed("restoring the update retains records written during rollback, exact original-request receipts and native sessions without recopying old data")
        report = {"passed": True, "checks": len(results), "results": results, "workDirectory": str(work), "archiveSha256": args.sha256, "sourceCommit": args.source_commit, "syntheticDataOnly": True, "normalBusinessDatabaseAccessed": False, "ownedProcessesStopped": all(child.poll() is not None for child in owned), "publicTlsQualified": False, "physicalNfcQualified": False}
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
