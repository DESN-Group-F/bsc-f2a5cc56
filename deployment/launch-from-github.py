"""Fetch and verify the frozen staff platform, then run until manually stopped."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

CONFIGURATION = json.loads(r'''__PRIVATE_BOOTSTRAP_JSON__''')
PIN = "ddac6320daf36f677605667f329f031a10b1f813"

def main():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Linux x86_64 is required.")
    if os.environ.get("INVENTORY_MANUAL_STOP") != "1":
        raise RuntimeError("Explicit manual-stop operation is required.")
    if CONFIGURATION["sourceCommit"] != PIN or CONFIGURATION["applicationVersion"] != "0.5.0":
        raise RuntimeError("Unexpected application source.")
    home = Path("/openbayes/home")
    if not home.is_dir():
        raise RuntimeError("Persistent home is unavailable.")
    project = home / "battery-inventory"
    release = project / "releases" / "0.5.0"
    data = project / "data-v0.5.0"
    transfer = project / "transfer-v0.5.0"
    for directory in (release, data, transfer):
        directory.mkdir(parents=True, exist_ok=True)
    os.chmod(data, 0o700)
    ready = release / "deployment-ready.json"
    reusable = ready.is_file() and json.loads(ready.read_text()).get("bundleSha256") == CONFIGURATION["bundleSha256"]
    if not reusable:
        url = urllib.parse.urlsplit(CONFIGURATION["archiveUrl"])
        if url.scheme != "https" or url.hostname != "codeload.github.com":
            raise RuntimeError("An official GitHub archive is required.")
        archive = transfer / "github.tar.gz"
        started, downloaded, reported = time.monotonic(), 0, 0
        print(json.dumps({"event": "download_started", "source": "GitHub", "commit": CONFIGURATION["commit"], "applicationSource": PIN}), flush=True)
        with urllib.request.urlopen(CONFIGURATION["archiveUrl"], timeout=60) as response, archive.open("wb") as output:
            if urllib.parse.urlsplit(response.geturl()).hostname != "codeload.github.com":
                raise RuntimeError("Unexpected archive redirect.")
            while chunk := response.read(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > 220 * 1024 * 1024 or time.monotonic() - started > 600:
                    raise RuntimeError("Deployment download limit exceeded.")
                output.write(chunk)
                if downloaded - reported >= 10 * 1024 * 1024:
                    reported = downloaded
                    print(json.dumps({"event": "download_progress", "MiB": round(downloaded / 1048576, 1)}), flush=True)
        part_paths = []
        with tarfile.open(archive, "r:gz") as repository:
            members = repository.getmembers()
            for part in CONFIGURATION["parts"]:
                if Path(part["name"]).name != part["name"]:
                    raise RuntimeError("Invalid part name.")
                matches = [m for m in members if m.name.endswith("/artifacts/" + part["name"])]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size != part["size"]:
                    raise RuntimeError("A deployment part is missing.")
                target = transfer / part["name"]
                with repository.extractfile(matches[0]) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                if hashlib.sha256(target.read_bytes()).hexdigest() != part["sha256"]:
                    raise RuntimeError("Deployment part checksum mismatch.")
                part_paths.append(target)
        payload = transfer / "bundle.tar.gz"
        digest = hashlib.sha256()
        with payload.open("wb") as output:
            for part in part_paths:
                with part.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        output.write(chunk)
        if digest.hexdigest() != CONFIGURATION["bundleSha256"]:
            raise RuntimeError("Deployment bundle checksum mismatch.")
        with tarfile.open(payload, "r:gz") as bundle:
            for member in bundle.getmembers():
                if not (release / member.name).resolve().is_relative_to(release.resolve()) or not (member.isfile() or member.isdir()):
                    raise RuntimeError("Unsafe deployment archive member.")
                if member.name == "bootstrap.json":
                    raise RuntimeError("Public artifacts must not contain private bootstrap configuration.")
            bundle.extractall(release)
        ready.write_text(json.dumps({"bundleSha256": CONFIGURATION["bundleSha256"], "sourceCommit": PIN}))
        for file in (archive, payload, *part_paths):
            if file.resolve().parent != transfer.resolve():
                raise RuntimeError("Unexpected transfer cleanup path.")
            file.unlink()
    manifest = json.loads((release / "deployment.json").read_text())
    if manifest["sourceCommit"] != PIN or hashlib.sha256((release / "runtime.mjs").read_bytes()).hexdigest() != CONFIGURATION["runtimeSha256"]:
        raise RuntimeError("Saved deployment does not match the verified version.")
    bootstrap_file = release / "bootstrap.json"
    if not bootstrap_file.exists():
        bootstrap_file.write_text(json.dumps(CONFIGURATION["bootstrap"]))
    os.chmod(bootstrap_file, 0o600)
    node = release / "runtime-node/bin/node"
    worker = release / "node_modules/@cloudflare/workerd-linux-64/bin/workerd"
    os.chmod(node, 0o755)
    os.chmod(worker, 0o755)
    port = int(os.environ.get("INVENTORY_PORT", "8081"))
    if not 1 <= port <= 65535:
        raise RuntimeError("Invalid application port.")
    environment = dict(os.environ, PORT=str(port), INVENTORY_BUNDLE_ROOT=str(release),
                       INVENTORY_DATA_ROOT=str(data), INVENTORY_MANUAL_STOP="1", NODE_ENV="production")
    print(json.dumps({"event": "deployment_start", "version": "0.5.0", "sourceCommit": PIN,
                      "automaticStop": False, "previousDataRetained": (project / "data").is_dir()}), flush=True)
    child = subprocess.Popen([str(node), str(release / "runtime.mjs")], cwd=release, env=environment, start_new_session=True)
    def stop(_signum=None, _frame=None):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        child.wait()
    finally:
        stop()
    return child.returncode if child.returncode is not None and child.returncode >= 0 else 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("Deployment failed: " + type(error).__name__, flush=True)
        sys.exit(1)
