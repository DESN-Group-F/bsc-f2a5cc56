import { randomBytes } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

/** Windows retains a child-owned lease independently of the Python launcher's kernel lock. */
export async function acquireRuntimeOwner(dataRoot) {
  const ownerPath = path.join(dataRoot, ".runtime-owner.json");
  const owner = { pid: process.pid, hostname: hostname(), token: randomBytes(16).toString("hex") };
  async function create() {
    const handle = await open(ownerPath, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(owner)); } finally { await handle.close(); }
  }
  try { await create(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(ownerPath, "utf8"));
    if (previous.hostname !== hostname() || !Number.isInteger(previous.pid) || previous.pid < 1 || typeof previous.token !== "string" || !/^[a-f0-9]{32}$/.test(previous.token)) throw new Error("An unverified candidate runtime owner is retained.");
    try { process.kill(previous.pid, 0); }
    catch (failure) {
      if (failure.code !== "ESRCH") throw new Error("Another candidate runtime may still be running.");
      throw new Error("A stale candidate runtime owner is retained. Verify its entire owned process tree has stopped before explicitly removing this record; a missing Node PID alone does not prove workerd stopped.");
    }
    throw new Error("Another candidate runtime is still running, even if its launcher no longer holds the saved-home lock.");
  }
  return release;
  async function release() {
    try {
      const current = JSON.parse(await readFile(ownerPath, "utf8"));
      if (current.token === owner.token && current.pid === owner.pid && current.hostname === owner.hostname) await unlink(ownerPath);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
