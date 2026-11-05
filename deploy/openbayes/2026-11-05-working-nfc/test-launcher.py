"""Linux signal regression using only owned Python children and a synthetic lock directory."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time
from preservation import acquire_lock

ROOT = Path(__file__).resolve().parent
CHILD = "import signal,sys,time; signal.signal(signal.SIGTERM,lambda *_:sys.exit(0)); print('ready',flush=True); time.sleep(30)"
IGNORES_STOP = """import json,signal,subprocess,sys,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
descendant = subprocess.Popen([sys.executable, '-u', '-c', "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('ready',flush=True); time.sleep(30)"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True, pass_fds=(int(sys.argv[1]),))
assert descendant.stdout.readline().strip() == 'ready'
print(json.dumps({'event':'runtime_probe_ready','descendantPid':descendant.pid}), flush=True)
time.sleep(30)
"""
NONZERO_EXIT = "import sys,time; print('ready',flush=True); time.sleep(0.3); sys.exit(23)"
CASES = ("legacy", "fixed", "ignores-stop", "nonzero-exit")


def harness(project, case):
    spec = importlib.util.spec_from_file_location("sealed_launcher", ROOT / "upgrade-and-run.py")
    launcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(launcher)
    with acquire_lock(project) as lease:
        script = IGNORES_STOP if case == "ignores-stop" else NONZERO_EXIT if case == "nonzero-exit" else CHILD
        child = subprocess.Popen([sys.executable, "-u", "-c", script, str(lease.fileno())], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, text=True, pass_fds=(lease.fileno(),), start_new_session=True)
        initial = child.stdout.readline().strip()
        ready = {"event": "signal_probe_ready", "runtimePid": child.pid, "case": case}
        if case == "ignores-stop":
            value = json.loads(initial)
            if value.get("event") != "runtime_probe_ready": raise RuntimeError("The owned process group did not become ready.")
            ready["descendantPid"] = value["descendantPid"]
        elif initial != "ready": raise RuntimeError("The owned child did not become ready.")
        print(json.dumps(ready), flush=True)
        if case == "legacy":
            def shutdown(_signum, _frame):
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=0.5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
            signal.signal(signal.SIGTERM, shutdown)
            child.wait()
        else:
            code = launcher.wait_for_runtime(child, shutdown_timeout=0.5 if case == "ignores-stop" else 2)
            expected = -signal.SIGKILL if case == "ignores-stop" else 23 if case == "nonzero-exit" else 0
            if code != expected: raise RuntimeError("The actual launcher changed the owned runtime return code.")
    if case != "legacy": print(json.dumps({"event": "signal_probe_finished", "case": case, "runtimeReturnCode": code}), flush=True)


def stop_owned(child, runtime_pid):
    for pid in (runtime_pid, child.pid):
        if pid is not None:
            try: os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError: pass
    child.wait(timeout=5)


def run(report):
    if platform.system() != "Linux": raise RuntimeError("Run this actual signal regression on Linux; Windows SIGTERM is not graceful.")
    work = Path(tempfile.mkdtemp(prefix="inventory-launcher-signal-"))
    results = []
    for case in CASES:
        project = work / case; project.mkdir()
        child = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "--harness", str(project), "--case", case],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        runtime_pid = None
        try:
            # The readiness timeout applies before any signal is sent.
            import select
            if not select.select([child.stdout], [], [], 5)[0]: raise RuntimeError("The owned signal probe did not become ready.")
            ready = json.loads(child.stdout.readline()); runtime_pid = ready["runtimePid"]
            if ready.get("event") != "signal_probe_ready" or ready.get("case") != case: raise RuntimeError("Unexpected signal probe output.")
            time.sleep(0.1)  # Enter the outer wait before testing signal delivery.
            started = time.monotonic()
            if case != "nonzero-exit": child.terminate()
            if case == "legacy":
                try: child.wait(timeout=1.5)
                except subprocess.TimeoutExpired: pass
                else: raise RuntimeError("The historical wait-in-handler deadlock was not reproduced on this interpreter.")
                results.append({"name": "Python wait-in-handler deadlock is reproduced using an ordinary owned child", "passed": True})
            else:
                child.wait(timeout=5)
                elapsed = time.monotonic() - started
                if child.returncode != 0: raise RuntimeError("The lifecycle probe failed its actual launcher assertions.")
                finished = json.loads(child.stdout.read().strip())
                expected = -signal.SIGKILL if case == "ignores-stop" else 23 if case == "nonzero-exit" else 0
                if finished != {"event": "signal_probe_finished", "case": case, "runtimeReturnCode": expected}:
                    raise RuntimeError("The runtime return-code evidence differs.")
                with acquire_lock(project): pass
                if case == "ignores-stop":
                    if not 0.5 <= elapsed < 3: raise RuntimeError("Forced owned-group shutdown did not obey the bounded grace period.")
                    results.append({"name": "a SIGTERM-ignoring owned runtime and descendant are killed after the bounded grace period and release their inherited lock", "passed": True, "runtimeReturnCode": expected, "elapsedSeconds": elapsed})
                elif case == "nonzero-exit":
                    results.append({"name": "spontaneous nonzero runtime exit preserves its original return code and releases the inherited lock", "passed": True, "runtimeReturnCode": expected})
                else:
                    results.append({"name": "signal flag and normal-flow shutdown exit cleanly and release the synthetic shared kernel lock", "passed": True})
        finally:
            stop_owned(child, runtime_pid)
    value = {"passed": True, "checks": len(results), "results": results, "pythonVersion": platform.python_version(), "platform": platform.system(),
             "syntheticDataOnly": True, "businessDatabaseOpened": False, "ownedProcessesStopped": True, "workDirectory": str(work)}
    if report: report.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(value, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--harness", type=Path)
    parser.add_argument("--case", choices=CASES, default="fixed")
    args = parser.parse_args()
    if args.harness: harness(args.harness, args.case)
    else: run(args.report)
