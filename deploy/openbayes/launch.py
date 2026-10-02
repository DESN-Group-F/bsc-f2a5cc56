"""Launch a bounded CPU demonstration from a self-contained deployment archive."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tarfile
import time

STARTED = time.monotonic()
LIMIT_SECONDS = 7200
PAYLOAD = "__DEPLOYMENT_PAYLOAD__"
PAYLOAD_SHA256 = "__DEPLOYMENT_SHA256__"

def main():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("This bundle requires Linux x86_64.")
    home = Path("/openbayes/home")
    if not home.is_dir():
        raise RuntimeError("The persistent OpenBayes home directory is unavailable.")
    release = home / "battery-inventory" / "release"
    data = home / "battery-inventory" / "data"
    release.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True)
    os.chmod(data, 0o700)
    archive = base64.b64decode(PAYLOAD)
    if hashlib.sha256(archive).hexdigest() != PAYLOAD_SHA256:
        raise RuntimeError("The deployment bundle checksum does not match.")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        for member in bundle.getmembers():
            target = (release / member.name).resolve()
            if not target.is_relative_to(release.resolve()) or not (member.isfile() or member.isdir()):
                raise RuntimeError("The bundle contains an unsafe path or link.")
        bundle.extractall(release)
    del archive
    node = release / "runtime-node" / "bin" / "node"
    worker = release / "node_modules" / "@cloudflare" / "workerd-linux-64" / "bin" / "workerd"
    os.chmod(node, 0o755)
    os.chmod(worker, 0o755)
    os.chmod(release / "bootstrap.json", 0o600)
    environment = dict(os.environ)
    environment.update({"PORT":"8080", "INVENTORY_BUNDLE_ROOT":str(release),
                        "INVENTORY_DATA_ROOT":str(data), "NODE_ENV":"production",
                        "INVENTORY_MAX_SECONDS":str(max(1, int(LIMIT_SECONDS-(time.monotonic()-STARTED))))})
    manifest = json.loads((release / "deployment.json").read_text())
    print(json.dumps({"event":"deployment_start", "sourceCommit":manifest["sourceCommit"],
                      "runtimeVersion":manifest["nodeVersion"], "limitSeconds":LIMIT_SECONDS}), flush=True)
    process = subprocess.Popen([str(node), str(release / "runtime.mjs")], cwd=release,
                               env=environment, start_new_session=True)
    def stop(_signum=None, _frame=None):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        remaining = max(1, LIMIT_SECONDS-(time.monotonic()-STARTED))
        process.wait(timeout=remaining)
    except subprocess.TimeoutExpired:
        print("Demonstration time limit reached; stopping the CPU task.", flush=True)
        stop()
    finally:
        stop()
    print("Inventory stopped. Persistent data remains in /openbayes/home/battery-inventory/data.", flush=True)
    return process.returncode if process.returncode is not None and process.returncode >= 0 else 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("Deployment failed: " + str(error), flush=True)
        sys.exit(1)
