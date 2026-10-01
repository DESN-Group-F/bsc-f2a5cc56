"""Build a Linux CPU bundle without including existing databases or private settings."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import urllib.request

PROJECT = Path(__file__).resolve().parents[2]
SOURCE = PROJECT / "deploy" / "openbayes"
WORK = PROJECT / "work" / "openbayes"
STAGE = WORK / "bundle"

def download(url, destination):
    with urllib.request.urlopen(url, timeout=90) as response, open(destination, "wb") as output:
        shutil.copyfileobj(response, output)

def main():
    if len(sys.argv) != 3:
        raise RuntimeError("Usage: build-bundle.py <local-node-executable> <npm-cli.js>")
    local_node, npm_cli = sys.argv[1:]
    # Only the explicitly named, generated staging directory can be replaced.
    if not STAGE.resolve().is_relative_to(WORK.resolve()) or STAGE.name != "bundle":
        raise RuntimeError("The staging directory is outside the intended workspace.")
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True, exist_ok=True)
    for name in ("package.json", "package-lock.json", "runtime.mjs"):
        shutil.copy2(SOURCE / name, STAGE / name)
    subprocess.run([local_node,npm_cli,"ci","--prefix",str(STAGE),"--ignore-scripts",
                    "--os=linux","--cpu=x64","--libc=glibc","--no-audit","--no-fund"],check=True)
    with urllib.request.urlopen("https://nodejs.org/dist/index.json",timeout=30) as response:
        versions=json.load(response)
    node_version=next(item["version"] for item in versions if item["version"].startswith("v24.") and item.get("lts"))
    filename=f"node-{node_version}-linux-x64.tar.xz"
    archive=WORK / filename
    checksum_file=WORK / f"node-{node_version}-SHASUMS256.txt"
    download(f"https://nodejs.org/dist/{node_version}/SHASUMS256.txt",checksum_file)
    expected=next(line.split()[0] for line in checksum_file.read_text().splitlines() if line.endswith("  "+filename))
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:
        download(f"https://nodejs.org/dist/{node_version}/{filename}",archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:
        raise RuntimeError("The official Node runtime checksum does not match.")
    runtime=STAGE / "runtime-node"
    (runtime / "bin").mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,"r:xz") as package:
        for source,target in ((f"node-{node_version}-linux-x64/bin/node",runtime/"bin"/"node"),
                              (f"node-{node_version}-linux-x64/LICENSE",runtime/"LICENSE")):
            with package.extractfile(source) as content, open(target,"wb") as output:
                shutil.copyfileobj(content,output)
    shutil.copytree(PROJECT/"dist",STAGE/"dist",dirs_exist_ok=True)
    shutil.copytree(PROJECT/"drizzle",STAGE/"drizzle",dirs_exist_ok=True)
    # Read the existing platform adapter rather than adding protocol identifiers to product code.
    subprocess.run([local_node,"--input-type=module","-e",
        "import fs from 'node:fs';import ts from 'typescript';const source=fs.readFileSync('lib/platform/auth-contract.ts','utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;const value=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));fs.writeFileSync(process.argv[1],JSON.stringify(value.authenticationContract));",
        str(STAGE/"auth-contract.json")],cwd=PROJECT,check=True)
    access_file=WORK / "access.json"
    if access_file.exists():
        access=json.loads(access_file.read_text())
    else:
        access={"username":"admin","password":secrets.token_urlsafe(18)}
        access_file.write_text(json.dumps(access,indent=2)+"\n")
        os.chmod(access_file,0o600)
    salt=secrets.token_hex(24)
    password_hash=hashlib.scrypt(access["password"].encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=64,maxmem=64*1024*1024).hex()
    (STAGE/"bootstrap.json").write_text(json.dumps({"passwordSalt":salt,"passwordHash":password_hash}))
    commit=subprocess.check_output(["git","rev-parse","HEAD"],cwd=PROJECT,text=True).strip()
    manifest={"sourceCommit":commit,"nodeVersion":node_version,"nodeArchiveSha256":expected,
              "runtime":"miniflare-4.20260515.0","maximumRunSeconds":7200,
              "database":"independent-persistent-D1","dataset":"fictional-demo-and-empty-working-inventory"}
    (STAGE/"deployment.json").write_text(json.dumps(manifest,indent=2)+"\n")
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode="w:gz",compresslevel=6) as bundle:
        for file in sorted(STAGE.rglob("*")):
            if not file.is_file() or file.is_symlink():
                continue
            relative=file.relative_to(STAGE)
            if str(relative).replace("\\","/").startswith("node_modules/.bin/"):
                continue
            info=bundle.gettarinfo(str(file),arcname=str(relative).replace("\\","/"))
            info.uid=info.gid=0;info.uname=info.gname="";info.mtime=0
            info.mode=0o600 if str(relative)=="bootstrap.json" else 0o644
            with file.open("rb") as content:
                bundle.addfile(info,content)
    packed=buffer.getvalue()
    template=(SOURCE/"launch.py").read_text()
    executable=template.replace("__DEPLOYMENT_PAYLOAD__",base64.b64encode(packed).decode()).replace("__DEPLOYMENT_SHA256__",hashlib.sha256(packed).hexdigest())
    (WORK/"deploy.py").write_text(executable,encoding="utf-8",newline="\n")
    print(json.dumps({"bundle":str(WORK/"deploy.py"),"sizeBytes":len(executable.encode()),"nodeVersion":node_version,
                      "archiveSha256":hashlib.sha256(packed).hexdigest(),"credentialsFile":str(access_file)}))

if __name__ == "__main__":
    main()
