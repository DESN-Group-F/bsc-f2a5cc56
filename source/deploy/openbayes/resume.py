"""Resume the verified release after binding its saved OpenBayes home directory."""
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time

STARTED=time.monotonic()
LIMIT_SECONDS=7200

def verify_saved_database(data):
    candidates=[file for file in (data/'d1').rglob('*.sqlite') if file.name!='metadata.sqlite']
    if len(candidates)!=1:
        raise RuntimeError('The saved inventory database is unavailable or ambiguous; refusing to create a replacement.')
    connection=sqlite3.connect(candidates[0].resolve().as_uri()+'?mode=ro',uri=True)
    try:
        applied=connection.execute('SELECT count(*) FROM portable_migrations').fetchone()[0]
        if not applied:
            raise RuntimeError('The saved inventory has no migration receipt; refusing to resume it.')
    finally:
        connection.close()

def main():
    project=Path('/openbayes/home/battery-inventory')
    release,data=project/'release',project/'data'
    node=release/'runtime-node'/'bin'/'node'
    for required in (node,release/'runtime.mjs',release/'bootstrap.json'):
        if not required.is_file():
            raise RuntimeError('Bind the saved execution home directory before resuming this deployment.')
    if not data.is_dir():
        raise RuntimeError('The saved database directory is unavailable; refusing to create a replacement.')
    verify_saved_database(data)
    environment=dict(os.environ)
    environment.update({'PORT':'8080','INVENTORY_BUNDLE_ROOT':str(release),'INVENTORY_DATA_ROOT':str(data),
                        'NODE_ENV':'production','INVENTORY_MAX_SECONDS':str(LIMIT_SECONDS)})
    child=subprocess.Popen([str(node),str(release/'runtime.mjs')],cwd=release,env=environment,start_new_session=True)
    def stop(_signum=None,_frame=None):
        if child.poll() is None:
            os.killpg(child.pid,signal.SIGTERM)
            try:child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGKILL);child.wait()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try:child.wait(timeout=max(1,LIMIT_SECONDS-(time.monotonic()-STARTED)))
    except subprocess.TimeoutExpired:stop()
    finally:stop()
    return child.returncode if child.returncode is not None and child.returncode>=0 else 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:
        print('Resume failed: '+str(error),flush=True)
        sys.exit(1)
