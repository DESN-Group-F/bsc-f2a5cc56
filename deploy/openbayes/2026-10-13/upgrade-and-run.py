"""Launch the sealed integration release against its independently preserved current database."""
import argparse
import json
import os
from pathlib import Path
import signal
import platform
import subprocess
from preservation import NAME, RUNTIME_VERSIONS, acquire_lock, expected_migrations, prepare_database, prepare_rollback, reviewed_execution, verify_bundle


def launch(rollback=False):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", default=os.environ.get("INVENTORY_RELEASE_SOURCE_COMMIT"), required=os.environ.get("INVENTORY_RELEASE_SOURCE_COMMIT") is None)
    if rollback: parser.add_argument("--confirm-current-data-maintenance", action="store_true", required=True)
    args = parser.parse_args()
    os.environ["INVENTORY_RELEASE_SOURCE_COMMIT"] = args.source_commit
    local = os.environ.get("INVENTORY_LOCAL_TEST") == "1"
    release = Path(__file__).resolve().parent
    configured = os.environ.get("INVENTORY_PROJECT_ROOT", "") if local else "/openbayes/home/battery-inventory"
    if not configured: raise RuntimeError("Select a synthetic local qualification fixture explicitly.")
    project = Path(configured).resolve()
    if not project.is_dir(): raise RuntimeError("The retained saved home is unavailable.")
    if local and str(project).replace("\\", "/").startswith("/openbayes/home"):
        raise RuntimeError("A hosting saved home cannot serve as a synthetic qualification fixture.")
    if not local and (platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64") or release != project / "releases" / NAME):
        raise RuntimeError("This sealed release must run inside the retained Linux saved home.")
    reviewed_execution()
    with acquire_lock(project) as lease:
        manifest = verify_bundle(release)
        expected = expected_migrations(release)
        modules = Path(os.environ["INVENTORY_TEST_NODE_MODULES"]).resolve() if local else project / "releases/0.6.1/runtime/node_modules"
        for name, version in RUNTIME_VERSIONS.items():
            if json.loads((modules / name / "package.json").read_text(encoding="utf-8")).get("version") != version:
                raise RuntimeError("The retained runtime dependency version changed: " + name)
        node = Path(os.environ["INVENTORY_TEST_NODE"]).resolve() if local else project / "tools/node-v24.21.0/bin/node"
        if not node.is_file(): raise RuntimeError("Select the installed local Node runtime explicitly.")
        if not local and subprocess.check_output([str(node), "--version"], text=True).strip() != "v24.21.0":
            raise RuntimeError("The retained verified Linux Node runtime changed.")
        link = release / "node_modules"
        if link.exists() or link.is_symlink():
            if link.resolve() != modules: raise RuntimeError("The runtime dependency link differs.")
        elif os.name == "nt":
            subprocess.run([str(node), "-e", "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')", str(modules), str(link)], check=True, timeout=10)
            if link.resolve() != modules: raise RuntimeError("The local runtime dependency junction differs.")
        else: link.symlink_to(modules, target_is_directory=True)
        if rollback: data, application = prepare_rollback(project, release, manifest, expected)
        else: data, application = prepare_database(project, release, manifest, expected), release
        environment = {**os.environ, "INVENTORY_PROJECT_ROOT": str(project), "INVENTORY_BUNDLE_ROOT": str(release), "INVENTORY_APPLICATION_ROOT": str(application), "INVENTORY_ROLLBACK_READ_ONLY": "1" if rollback else "0", "INVENTORY_DATA_ROOT": str(data), "INVENTORY_LAUNCHER_LOCK_HELD": "1", "INVENTORY_LAUNCHER_PID": str(os.getpid()), "INVENTORY_PORT": os.environ.get("INVENTORY_PORT", "0" if local else "8081")}
        if os.name != "nt": environment["INVENTORY_LAUNCHER_LOCK_FD"] = str(lease.fileno())
        child = subprocess.Popen([str(node), str(release / "runtime.mjs")], cwd=release, env=environment, start_new_session=os.name != "nt", pass_fds=(lease.fileno(),) if os.name != "nt" else ())
        def shutdown(_signum=None, _frame=None):
            if child.poll() is None:
                child.terminate()
                try: child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    if os.name != "nt": os.killpg(child.pid, signal.SIGKILL)
                    else: child.kill()
                    child.wait()
        signal.signal(signal.SIGTERM, shutdown); signal.signal(signal.SIGINT, shutdown)
        try: code = child.wait()
        finally: shutdown()
        if code: raise RuntimeError("The inventory runtime failed; no retained database was reset.")


if __name__ == "__main__": launch()
