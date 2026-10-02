"""Use existing local Git authentication to issue a scoped temporary archive download."""
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/"work/openbayes"
REPOSITORY="DESN-Group-F/bsc-f2a5cc56"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

def main():
    origin=subprocess.check_output(["git","config","--get","remote.origin.url"],cwd=WORK/"github",text=True).strip()
    if origin!=f"https://github.com/{REPOSITORY}.git":raise RuntimeError("Unexpected repository.")
    commit=subprocess.check_output(["git","rev-parse","HEAD"],cwd=WORK/"github",text=True).strip()
    environment=dict(os.environ,GIT_TERMINAL_PROMPT="0",GCM_INTERACTIVE="never")
    result=subprocess.run(["git","credential","fill"],input=f"url={origin}\n\n",cwd=WORK/"github",
                          env=environment,text=True,capture_output=True,check=True)
    credential=dict(line.split("=",1) for line in result.stdout.splitlines() if "=" in line)
    token=credential.get("password")
    if not token:raise RuntimeError("Existing Git authentication is unavailable.")
    request=urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/tarball/{commit}",headers={
        "Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
        "User-Agent":"Battery-Inventory-Deployment","X-GitHub-Api-Version":"2022-11-28"})
    opener=urllib.request.build_opener(NoRedirect)
    try:opener.open(request,timeout=30);raise RuntimeError("The archive did not provide a redirect.")
    except urllib.error.HTTPError as response:
        if response.code!=302:raise RuntimeError(f"GitHub archive request returned {response.code}.") from None
        archive_url=response.headers["Location"]
    del credential,token,result,request
    parsed=urllib.parse.urlsplit(archive_url)
    if parsed.scheme!="https" or parsed.hostname!="codeload.github.com":raise RuntimeError("Unexpected archive host.")
    manifest=json.loads((WORK/"github/artifacts/manifest.json").read_text())
    authentication=json.loads((WORK/"bundle/bootstrap.json").read_text())
    configuration={**manifest,"commit":commit,"archiveUrl":archive_url,"authentication":authentication}
    template=(ROOT/"deploy/openbayes/launch-github.py").read_text()
    target=WORK/"deploy-from-github.py"
    target.write_text(template.replace("__PRIVATE_BOOTSTRAP_JSON__",json.dumps(configuration)),encoding="utf-8",newline="\n")
    os.chmod(target,0o600)
    print(json.dumps({"bootstrap":str(target),"commit":commit,"linkValidityMinutes":5,"sizeBytes":target.stat().st_size}))

if __name__=="__main__":main()
