import assert from "node:assert/strict";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../../../work/qa/store.mjs";
import { acquireRuntimeOwner } from "./runtime-owner.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const python = process.env.INVENTORY_TEST_PYTHON || "python";
const output = path.join(root, "work/openbayes-integration-candidate");
const packageResult = JSON.parse(await readFile(path.join(output, "package-result.json"), "utf8"));
const fixtureRoot = path.resolve(process.env.INVENTORY_TEST_FIXTURE_ROOT || path.join(root, "work"));
await mkdir(fixtureRoot, { recursive: true });
const work = await mkdtemp(path.join(fixtureRoot, "obc-")), project = path.join(work, "home"), release = path.join(work, "release");
const name = "2026-10-13-web-server-integration-candidate", previous = "2026-10-12-workspace-1.0.0", commit = "d0e1640a0c516ba6c68aeae4695b12a8afb12525";
const previousData = path.join(project, `data-${previous}`), targetData = path.join(project, `data-${name}`);
const results = [], owned = new Set();
const passed = check => results.push({ name: check, passed: true });
const environment = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", INVENTORY_LOCAL_TEST: "1", INVENTORY_PROJECT_ROOT: project, INVENTORY_EXPECTED_SAVED_HOME_EXECUTION: "synthetic-runtime-E1", INVENTORY_RESTORED_FROM_EXECUTION: "synthetic-runtime-E1", INVENTORY_TEST_NODE: process.execPath, INVENTORY_TEST_NODE_MODULES: path.join(root, "node_modules"), INVENTORY_PORT: "0", INVENTORY_MAX_SECONDS: "10", INVENTORY_PUBLIC_ORIGIN: "https://zztv-battery.gear-c1.openbayes.net" };
function child(command, args, env = environment) {
  const process = spawn(command, args, { env, cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  owned.add(process); let output = "";
  process.stdout.on("data", bytes => { output += bytes.toString(); }); process.stderr.on("data", bytes => { output += bytes.toString(); });
  const exited = new Promise(resolve => process.once("exit", (code, signal) => { owned.delete(process); resolve({ code, signal, output }); }));
  process.once("error", error => { output += error.message; });
  return { process, exited, output: () => output };
}
async function runPython(program, args = []) {
  const running = child(python, ["-B", "-c", program, ...args]);
  const result = await running.exited; assert.equal(result.code, 0, result.output); return result.output;
}
async function stop(running) {
  if (running.process.exitCode !== null) return running.exited;
  if (running.ready) return running.exited; // Its ten-second local timer disposes Node/workerd before Python exits.
  running.process.kill("SIGTERM");
  return await running.exited;
}
async function start() {
  const running = child(python, ["-B", path.join(release, "launch.py")]);
  const ready = await new Promise((resolve, reject) => {
    let lines = "";
    const timeout = setTimeout(() => reject(new Error(`Candidate did not start: ${running.output()}`)), 30000);
    running.process.stdout.on("data", bytes => {
      lines += bytes.toString();
      for (const line of lines.split(/\r?\n/)) {
        try { const value = JSON.parse(line); if (value.event === "integration_candidate_ready") { clearTimeout(timeout); resolve(value); return; } } catch {}
      }
    });
    running.exited.then(result => { clearTimeout(timeout); reject(new Error(`Candidate exited before ready: ${result.output}`)); });
  });
  return { ...running, ready };
}
async function request(port, pathname, { method = "GET", body, cookie } = {}) {
  return await new Promise((resolve, reject) => {
    const client = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers: { Host: "zztv-battery.gear-c1.openbayes.net", ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) } }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    client.setTimeout(15000, () => client.destroy(new Error("Local candidate request timed out."))); client.once("error", reject); client.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
let fixtureRuntime, live;
try {
  await mkdir(project, { recursive: true }); await mkdir(release);
  await runPython("import pathlib,sys,zipfile; sys.path.insert(0,sys.argv[1]); import importlib.util; s=importlib.util.spec_from_file_location('p',pathlib.Path(sys.argv[1])/'package-candidate.py'); p=importlib.util.module_from_spec(s); s.loader.exec_module(p); data=pathlib.Path(sys.argv[2]).read_bytes(); p.verify_archive(data,sys.argv[3]); out=pathlib.Path(sys.argv[4]); out=pathlib.Path(chr(92)*2+'?'+chr(92)+str(out.resolve())) if sys.platform=='win32' else out; zipfile.ZipFile(__import__('io').BytesIO(data)).extractall(out)", [path.join(root, "deploy/openbayes/integration-candidate"), path.join(output, "candidate.zip"), packageResult.archiveSha256, release]);
  const manifest = JSON.parse(await readFile(path.join(release, "candidate.json"), "utf8"));
  const compatibility = JSON.parse(await readFile(path.join(release, "migration-compatibility.json"), "utf8"));
  const priorRelease = path.join(project, "releases", previous);
  await mkdir(priorRelease, { recursive: true });
  for (const directory of ["drizzle", "migrations"]) await cp(path.join(release, directory), path.join(priorRelease, directory), { recursive: true });
  await writeFile(path.join(priorRelease, "deployment.json"), JSON.stringify({ deploymentName: previous, applicationVersion: "1.0.0", sourceCommit: commit }));
  fixtureRuntime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('synthetic predecessor fixture')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "battery-inventory-portable" }, d1Persist: path.join(previousData, "d1") });
  const db = await fixtureRuntime.getD1Database("DB"), journal = JSON.parse(await readFile(path.join(release, "migrations/meta/_journal.json"), "utf8"));
  for (const entry of journal.entries) await db.batch((await readFile(path.join(release, "migrations", `${entry.tag}.sql`), "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  await db.prepare("CREATE TABLE portable_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)").run();
  for (const entry of compatibility.entries) await db.prepare("INSERT INTO portable_migrations VALUES(?,?,?)").bind(entry.name, entry.sha256, new Date().toISOString()).run();
  const password = randomBytes(24).toString("base64url"), salt = randomBytes(32).toString("hex"), encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const passwordHash = Buffer.from(await webcrypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 600000, hash: "SHA-256" }, key, 256)).toString("hex");
  const accountId = randomUUID(), now = new Date().toISOString(), actor = { id: accountId, name: "Synthetic preserved administrator", role: "admin", authVersion: 1 };
  for (let index = 0; index < 8; index++) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(index ? randomUUID() : accountId, index ? `candidate-staff-${index}` : "candidate-admin", index ? `Synthetic staff ${index}` : actor.name, index ? "staff" : "admin", passwordHash, salt, 600000, now, now).run();
  const inventory = new InventoryStore(db, "shared:demo", "demo", actor);
  await inventory.snapshot(); await db.prepare("INSERT INTO shared_inventories(dataset,scope) VALUES('demo','shared:demo')").run();
  await inventory.saveBattery({ id: "QA-PRESERVED", name: "Synthetic preserved battery", ownerId: `staff-${accountId}`, homeBuildingId: "J18", homeRoomId: null, model: "", chemistry: "", capacityMah: null, voltage: null, manufacturedOn: null, firstUsedOn: null });
  await inventory.movement({ requestId: randomUUID(), kind: "checkout", batteryIds: ["QA-PRESERVED"] });
  await fixtureRuntime.dispose(); fixtureRuntime = null;
  await writeFile(path.join(previousData, "upgrade-complete.json"), JSON.stringify({ deploymentName: previous, migrations: 23, schemaVerified: true, originalPreserved: true }));
  await runPython("import json,pathlib,sys; sys.path.insert(0,sys.argv[1]); import preservation as p; r=pathlib.Path(sys.argv[2]); m=p.verify_bundle(r); e=p.expected_migrations(r); d=p.prepare_database(pathlib.Path(sys.argv[3]),r,m,e); print(json.dumps({'copied':str(d)}))", [path.join(root, "deploy/openbayes/integration-candidate"), release, project]);
  passed("the archive extracts and preserves a real synthetic current 23-migration D1 database before launch");
  if (process.platform === "win32") {
    const holder = child(process.execPath, ["--input-type=module", "-e", "const {acquireRuntimeOwner}=await import(process.argv[1]); const release=await acquireRuntimeOwner(process.argv[2]); console.log('owner-ready'); process.on('SIGTERM',async()=>{await release();process.exit(0)}); setInterval(()=>{},1000);", pathToFileURL(path.join(release, "runtime-owner.mjs")).href, targetData]);
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Lease holder did not start.")), 10000); holder.process.stdout.once("data", () => { clearTimeout(timeout); resolve(); }); });
    const before = await readFile(path.join(targetData, "copy-source.json"));
    const contender = child(python, ["-B", path.join(release, "launch.py")]);
    const rejected = await contender.exited;
    assert.notEqual(rejected.code, 0); assert.match(rejected.output, /Another candidate runtime is still running/);
    assert.deepEqual(await readFile(path.join(targetData, "copy-source.json")), before);
    await runPython("import pathlib,sys,json; sys.path.insert(0,sys.argv[1]); import preservation as p; r=pathlib.Path(sys.argv[2]); d=pathlib.Path(sys.argv[3]); e=p.expected_migrations(r); m=json.loads((d/'copy-source.json').read_text()); assert p.snapshot(p.database_file(d),e)==m['snapshot']; assert not (d/'candidate-complete.json').exists()", [path.join(root, "deploy/openbayes/integration-candidate"), release, targetData]);
    const ownedLease = JSON.parse(await readFile(path.join(targetData, ".runtime-owner.json"), "utf8"));
    assert.equal(ownedLease.pid, holder.process.pid);
    await stop(holder);
    await assert.rejects(acquireRuntimeOwner(targetData), /stale candidate runtime owner/);
    // This controlled holder imported only the lease helper and created no child process.
    const staleLease = JSON.parse(await readFile(path.join(targetData, ".runtime-owner.json"), "utf8"));
    assert.deepEqual(staleLease, ownedLease); await unlink(path.join(targetData, ".runtime-owner.json"));
    passed("a live orphan-style Windows child lease blocks a real second launcher before any D1 write even without a Python kernel lock");
  }
  live = await start();
  assert.equal(live.ready.sourceSnapshotSha256, manifest.sourceSnapshotSha256); assert.equal(live.ready.localOnly, true); assert.equal(live.ready.transportTls, false);
  const health = await request(live.ready.port, "/healthz"); assert.equal(health.status, 200); assert.equal(health.body.migrationCount, 23);
  const signedIn = await request(live.ready.port, "/api/session", { method: "POST", body: { action: "signin", payload: { username: "candidate-admin", password } } });
  assert.equal(signedIn.status, 200); const cookie = signedIn.headers["set-cookie"][0].split(";")[0]; assert.match(signedIn.headers["set-cookie"][0], /; Secure/); assert.equal(signedIn.body.user.id, accountId);
  const snapshot = await request(live.ready.port, "/api/inventory?dataset=demo", { cookie }); assert.equal(snapshot.status, 200); assert.equal(snapshot.body.batteries.find(item => item.id === "QA-PRESERVED").borrowerAccountId, accountId);
  passed("the copied candidate starts through the strict gateway with preserved native sign-in Secure cookies and exact old active-loan evidence");
  const directory = snapshot.body, owner = directory.people.find(item => item.accountId === accountId), building = directory.buildings.find(item => item.id === "J18");
  const registration = { requestId: randomUUID(), sessionId: randomUUID(), source: "operator-entered-registration", tagId: null, directoryBindings: { ownerVersion: owner.version, ownerAccountId: accountId, buildingVersion: building.version, roomVersion: null }, common: { name: "Synthetic later candidate write", model: "", chemistry: "", capacityMah: null, voltage: null, ownerId: owner.id, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null }, firstUseMode: "unknown" };
  const saved = await request(live.ready.port, "/api/inventory", { method: "POST", cookie, body: { dataset: "demo", action: "operator_register", payload: registration } }); assert.equal(saved.status, 200); const registered = saved.body.result;
  const stoppedFirst = await stop(live); assert.equal(stoppedFirst.code, 0, stoppedFirst.output); live = null;
  live = await start(); assert.equal(live.ready.completedDatabaseRetained, true);
  const session = await request(live.ready.port, "/api/session", { cookie }); assert.equal(session.status, 200); assert.equal(session.body.user.id, accountId);
  const retry = await request(live.ready.port, "/api/inventory", { method: "POST", cookie, body: { dataset: "demo", action: "operator_register", payload: registration } }); assert.equal(retry.status, 200); assert.deepEqual(retry.body.result, { ...registered, replayed: true });
  const after = await request(live.ready.port, "/api/inventory?dataset=demo", { cookie }); assert.equal(after.body.batteries.length, directory.batteries.length + 1); assert.equal(after.body.batteries.find(item => item.id === "QA-PRESERVED").loanId, directory.batteries.find(item => item.id === "QA-PRESERVED").loanId);
  const stoppedSecond = await stop(live); assert.equal(stoppedSecond.code, 0, stoppedSecond.output); live = null;
  await runPython("import pathlib,sys,json; sys.path.insert(0,sys.argv[1]); import preservation as p; r=pathlib.Path(sys.argv[2]); d=pathlib.Path(sys.argv[3]); old=pathlib.Path(sys.argv[4]); e=p.expected_migrations(r); m=json.loads((d/'copy-source.json').read_text()); assert p.snapshot(p.database_file(old),e)==m['snapshot']; assert p.snapshot(d/'original-backup.sqlite',e)==m['snapshot']; assert p.snapshot(p.database_file(d),e)!=m['snapshot']; assert not (d/'.runtime-owner.json').exists()", [path.join(root, "deploy/openbayes/integration-candidate"), release, targetData, previousData]);
  passed("restart retains later candidate writes native sessions exact operation receipts and the original predecessor/backup unchanged");
  const report = { passed: true, checks: results.length, results, archiveSha256: packageResult.archiveSha256, sourceSnapshotSha256: manifest.sourceSnapshotSha256, buildSnapshotSha256: manifest.buildSnapshotSha256, workDirectory: work, syntheticDataOnly: true, remoteAccess: false, ownedProcessesStopped: owned.size === 0, transportTls: false };
  await writeFile(path.join(output, "runtime-verification.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { passed: false, checks: results.length, results, archiveSha256: packageResult.archiveSha256, workDirectory: work, syntheticDataOnly: true, remoteAccess: false, error: String(error), ownedProcessesStopped: owned.size === 0 };
  await writeFile(path.join(output, "runtime-verification.json"), JSON.stringify(report, null, 2) + "\n");
  let failures = [];
  try { failures = JSON.parse(await readFile(path.join(output, "runtime-failures.json"), "utf8")); } catch (failure) { if (failure.code !== "ENOENT") throw failure; }
  failures.push(report); await writeFile(path.join(output, "runtime-failures.json"), JSON.stringify(failures, null, 2) + "\n");
  throw error;
} finally {
  if (live) await stop(live); await fixtureRuntime?.dispose();
  for (const process of owned) process.kill("SIGTERM");
}
