"""Stage credentials-free, split deployment artifacts for the authorized private branch."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/"work/openbayes"
STAGE=WORK/"bundle"
GITHUB=WORK/"github"

def main():
    artifacts=GITHUB/"artifacts"
    artifacts.mkdir(parents=True,exist_ok=True)
    payload=WORK/"github-bundle.tar.gz"
    with tarfile.open(payload,"w:gz",compresslevel=6) as bundle:
        for file in sorted(STAGE.rglob("*")):
            if not file.is_file() or file.is_symlink():continue
            relative=file.relative_to(STAGE).as_posix()
            if relative=="bootstrap.json" or relative.startswith("node_modules/.bin/"):continue
            info=bundle.gettarinfo(str(file),arcname=relative)
            info.uid=info.gid=0;info.uname=info.gname="";info.mtime=0;info.mode=0o644
            with file.open("rb") as content:bundle.addfile(info,content)
    parts=[]
    with payload.open("rb") as source:
        index=0
        while True:
            chunk=source.read(64*1024*1024)
            if not chunk:break
            name=f"bundle.part{index:02d}"
            (artifacts/name).write_bytes(chunk)
            parts.append({"name":name,"size":len(chunk),"sha256":hashlib.sha256(chunk).hexdigest()})
            index+=1
    manifest={"bundleSha256":hashlib.sha256(payload.read_bytes()).hexdigest(),"parts":parts,
              "sourceCommit":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()}
    (artifacts/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    source_archive=WORK/"source.tar"
    subprocess.run(["git","archive","HEAD","--output",str(source_archive)],cwd=ROOT,check=True)
    source_root=GITHUB/"source"
    source_root.mkdir(exist_ok=True)
    with tarfile.open(source_archive) as source:
        for member in source.getmembers():
            if not (source_root/member.name).resolve().is_relative_to(source_root.resolve()) or not(member.isfile() or member.isdir()):
                raise RuntimeError("The tracked source contains an unsafe archive entry.")
        source.extractall(source_root)
    (GITHUB/".gitattributes").write_text("artifacts/bundle.part* -text -filter -diff\nsource/deploy/openbayes/** text eol=lf\n")
    (GITHUB/"README.txt").write_text("Battery Inventory — OpenBayes deployment snapshot\n\nThis independent deployment branch contains this inventory application's source and\nits portable Linux runtime, split into files below the ordinary Git file-size limit.\nIt is intended for deployment transfer and is not intended to merge into BSC main.\nThe artifacts retain vendor license notices. Credentials and existing databases\nare excluded. A private, temporary archive link transfers only this snapshot.\nSee source/deploy/openbayes/README.txt for the runtime scope and cost limit.\n")
    print(json.dumps({"manifest":manifest,"branchDirectory":str(GITHUB)}))

if __name__=="__main__":main()
