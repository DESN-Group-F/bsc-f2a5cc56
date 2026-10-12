"""Launch an unpublished candidate only on a local loopback listener with copied data."""
import json
import os
from pathlib import Path
import signal
import subprocess
from preservation import NAME, RUNTIME_VERSIONS, acquire_lock, expected_migrations, prepare_database, reviewed_execution, verify_bundle


def main():
    if os.environ.get("INVENTORY_LOCAL_TEST") != "1":
        raise RuntimeError("This unsealed candidate supports local qualification only. A later explicit release decision is required for OpenBayes launch.")
    release = Path(__file__).resolve().parent
    configured = os.environ.get("INVENTORY_PROJECT_ROOT", "")
    if not configured: raise RuntimeError("Select an isolated synthetic local saved-home fixture explicitly.")
    project = Path(configured).resolve()
    if str(project).replace("\\", "/").startswith("/openbayes/home") or not project.is_dir():
        raise RuntimeError("Existing hosting saved-home paths are outside local candidate qualification.")
    reviewed_execution()
    with acquire_lock(project) as lease:
        manifest = verify_bundle(release)
        expected = expected_migrations(release)
        modules = Path(os.environ["INVENTORY_TEST_NODE_MODULES"]).resolve()
        for name, version in RUNTIME_VERSIONS.items():
            if json.loads((modules / name / "package.json").read_text(encoding="utf-8")).get("version") != version:
                raise RuntimeError("The retained runtime dependency version changed: " + name)
        node = Path(os.environ["INVENTORY_TEST_NODE"]).resolve()
        if not node.is_file(): raise RuntimeError("Select the installed local Node runtime explicitly.")
        link = release / "node_modules"
        if link.exists() or link.is_symlink():
            if link.resolve() != modules: raise RuntimeError("The runtime dependency link differs.")
        elif os.name == "nt":
            subprocess.run([str(node), "-e", "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')", str(modules), str(link)], check=True, timeout=10)
            if link.resolve() != modules: raise RuntimeError("The local runtime dependency junction differs.")
        else: link.symlink_to(modules, target_is_directory=True)
        data = prepare_database(project, release, manifest, expected)
        environment = {**os.environ, "INVENTORY_BUNDLE_ROOT": str(release), "INVENTORY_DATA_ROOT": str(data), "INVENTORY_LAUNCHER_LOCK_HELD": "1", "INVENTORY_LAUNCHER_PID": str(os.getpid()), "INVENTORY_PORT": os.environ.get("INVENTORY_PORT", "0")}
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
        if code: raise RuntimeError("The local candidate runtime failed; no retained database was reset.")


if __name__ == "__main__": main()
