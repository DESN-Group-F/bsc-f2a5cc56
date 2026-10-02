"""Fetch a pinned deployment through a short-lived archive link, then run for two hours."""
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

STARTED = time.monotonic()
LIMIT_SECONDS = 7200
CONFIGURATION = json.loads(r'''__PRIVATE_BOOTSTRAP_JSON__''')

def main():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("This deployment requires Linux x86_64.")
    home = Path("/openbayes/home")
    if not home.is_dir():
        raise RuntimeError("The persistent OpenBayes home directory is unavailable.")
    project = home / "battery-inventory"
    release, data, transfer = project/"release", project/"data", project/"transfer"
    for directory in (release,data,transfer):
        directory.mkdir(parents=True,exist_ok=True)
    os.chmod(data,0o700)
    url = urllib.parse.urlsplit(CONFIGURATION["archiveUrl"])
    if url.scheme != "https" or url.hostname != "codeload.github.com":
        raise RuntimeError("The archive must use the official GitHub download host.")
    archive = transfer / "github.tar.gz"
    print(json.dumps({"event":"download_started","source":"GitHub","commit":CONFIGURATION["commit"]}),flush=True)
    downloaded, reported = 0, 0
    with urllib.request.urlopen(CONFIGURATION["archiveUrl"],timeout=30) as response,archive.open("wb") as output:
        while True:
            chunk=response.read(1024*1024)
            if not chunk:break
            downloaded+=len(chunk)
            if downloaded>180*1024*1024 or time.monotonic()-STARTED>600:
                raise RuntimeError("The archive download exceeded the demonstration setup limit.")
            output.write(chunk)
            if downloaded-reported>=10*1024*1024:
                reported=downloaded
                print(json.dumps({"event":"download_progress","downloadedMiB":round(downloaded/1048576,1)}),flush=True)
    part_paths=[]
    with tarfile.open(archive,"r:gz") as repository:
        members=repository.getmembers()
        for part in CONFIGURATION["parts"]:
            matches=[m for m in members if m.name.endswith("/artifacts/"+part["name"])]
            if len(matches)!=1 or not matches[0].isfile() or matches[0].size!=part["size"]:
                raise RuntimeError("The repository archive is missing a deployment part.")
            destination=transfer / part["name"]
            with repository.extractfile(matches[0]) as source,destination.open("wb") as output:
                shutil.copyfileobj(source,output)
            if hashlib.sha256(destination.read_bytes()).hexdigest()!=part["sha256"]:
                raise RuntimeError("A deployment part checksum does not match.")
            part_paths.append(destination)
    payload=transfer / "bundle.tar.gz"
    digest=hashlib.sha256()
    with payload.open("wb") as output:
        for part in part_paths:
            with part.open("rb") as content:
                while True:
                    chunk=content.read(1024*1024)
                    if not chunk:break
                    digest.update(chunk);output.write(chunk)
    if digest.hexdigest()!=CONFIGURATION["bundleSha256"]:
        raise RuntimeError("The complete deployment checksum does not match.")
    with tarfile.open(payload,"r:gz") as bundle:
        for member in bundle.getmembers():
            target=(release/member.name).resolve()
            if not target.is_relative_to(release.resolve()) or not(member.isfile() or member.isdir()):
                raise RuntimeError("The deployment contains an unsafe path or link.")
        bundle.extractall(release)
    (release/"bootstrap.json").write_text(json.dumps(CONFIGURATION["authentication"]))
    os.chmod(release/"bootstrap.json",0o600)
    node=release/"runtime-node"/"bin"/"node"
    worker=release/"node_modules"/"@cloudflare"/"workerd-linux-64"/"bin"/"workerd"
    os.chmod(node,0o755);os.chmod(worker,0o755)
    # Remove only the verified, generated transfer files; retain the release and database.
    for file in [archive,payload,*part_paths]:
        if file.resolve().parent!=transfer.resolve():
            raise RuntimeError("Unexpected transfer cleanup path.")
        file.unlink()
    environment=dict(os.environ)
    environment.update({"PORT":"8080","INVENTORY_BUNDLE_ROOT":str(release),"INVENTORY_DATA_ROOT":str(data),
                        "NODE_ENV":"production","INVENTORY_MAX_SECONDS":str(max(1,int(LIMIT_SECONDS-(time.monotonic()-STARTED))))})
    print(json.dumps({"event":"deployment_start","commit":CONFIGURATION["commit"],"limitSeconds":LIMIT_SECONDS}),flush=True)
    process=subprocess.Popen([str(node),str(release/"runtime.mjs")],cwd=release,env=environment,start_new_session=True)
    def stop(_signum=None,_frame=None):
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.wait()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try:process.wait(timeout=max(1,LIMIT_SECONDS-(time.monotonic()-STARTED)))
    except subprocess.TimeoutExpired:
        print("Demonstration time limit reached; stopping the CPU task.",flush=True);stop()
    finally:stop()
    print("Inventory stopped; its database remains in the persistent home directory.",flush=True)
    return process.returncode if process.returncode is not None and process.returncode>=0 else 0

if __name__=="__main__":
    try:sys.exit(main())
    except Exception as error:
        # Never include the short-lived private download link in logs.
        print("Deployment failed: "+type(error).__name__,flush=True)
        sys.exit(1)
