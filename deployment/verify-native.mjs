import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./", import.meta.url));
const project = path.resolve(directory, "../..");
const sourceCommit = "ddac6320daf36f677605667f329f031a10b1f813";
const qaRoot = path.join(directory, "qa", `native-${randomUUID()}`);
const bundle = path.join(qaRoot, "release"), data = path.join(qaRoot, "data-v0.5.0");
const access = JSON.parse(await readFile(path.join(project, "work/openbayes/access.json"), "utf8"));
assert.equal(access.username, "admin");
assert.ok(typeof access.password === "string" && access.password.length >= 12);
const passwordSalt = randomBytes(32).toString("hex"), adminId = randomUUID();
const bootstrap = { sourceCommit, initialAdmin: { id: adminId, username: "admin", displayName: "admin", email: "", role: "admin", defaultDataset: "demo", passwordHash: pbkdf2Sync(access.password, passwordSalt, 600000, 32, "sha256").toString("hex"), passwordSalt, hashIterations: 600000 } };
await mkdir(bundle, { recursive: true });
await cp(path.join(project, "dist"), path.join(bundle, "dist"), { recursive: true });
await cp(path.join(project, "drizzle"), path.join(bundle, "drizzle"), { recursive: true });
await writeFile(path.join(bundle, "bootstrap.json"), JSON.stringify(bootstrap), { mode: 0o600 });
await writeFile(path.join(bundle, "deployment.json"), JSON.stringify({ sourceCommit, version: "0.5.0" }));
const evidence = { version: "0.5.0", sourceCommit, startedAt: new Date().toISOString(), isolatedQaDirectory: qaRoot, checks: [] };
const check = name => evidence.checks.push({ name, result: "passed" });
let active;
async function start() {
  const child = spawn(process.execPath, [path.join(directory, "runtime.mjs")], { cwd: directory, env: { ...process.env, PORT: "0", INVENTORY_LOCAL_TEST: "1", INVENTORY_LISTEN_HOST: "127.0.0.1", INVENTORY_BUNDLE_ROOT: bundle, INVENTORY_DATA_ROOT: data, INVENTORY_MAX_SECONDS: "120", INVENTORY_MANUAL_STOP: "0" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "", errors = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  const finished = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Runtime failed (${code}): ${errors}`))); });
  finished.catch(() => {});
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Readiness timeout: ${errors}`)), 30000);
    child.stdout.on("data", () => {
      const line = output.split("\n").find(value => value.includes('"event":"inventory_ready"'));
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line)); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Exited before readiness (${code}): ${errors}`)); });
  });
  active = { child, finished, ready, output: () => output, origin: `http://127.0.0.1:${ready.port}` };
  assert.notEqual(ready.port, 5173);
  return active;
}
async function stop(instance) {
  instance.child.send({ action: "shutdown" });
  await instance.finished;
  assert.match(instance.output(), /preserving its independent database/);
  active = null;
}
async function request(instance, route, { cookie, body, headers = {} } = {}) {
  const response = await fetch(instance.origin + route, { redirect: "manual", method: body === undefined ? "GET" : "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: instance.origin, "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return response;
}
async function jsonResponse(response, status = 200) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type"), /application\/json/);
  return response.json();
}
async function signin(instance, username, password) {
  const response = await request(instance, "/api/session", { body: { action: "signin", payload: { username, password } } });
  const json = await jsonResponse(response);
  const raw = response.headers.get("set-cookie");
  assert.match(raw, /^inventory_session=[a-f0-9]{64};/);
  assert.match(raw, /HttpOnly/); assert.match(raw, /SameSite=Strict/);
  assert.equal(/Secure/.test(raw), false);
  return { cookie: raw.split(";")[0], user: json.user };
}
async function databaseReceipt() {
  const names = await readdir(path.join(data, "d1"), { recursive: true });
  const databases = names.filter(name => name.endsWith(".sqlite") && path.basename(name) !== "metadata.sqlite");
  assert.equal(databases.length, 1);
  const db = new DatabaseSync(path.join(data, "d1", databases[0]), { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    return {
      migrations: db.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all(),
      accounts: db.prepare("SELECT * FROM staff_accounts ORDER BY id").all(),
      accountEvents: db.prepare("SELECT * FROM staff_account_events ORDER BY rowid").all(),
      loans: db.prepare("SELECT * FROM loans ORDER BY rowid").all(),
      events: db.prepare("SELECT * FROM audit_events ORDER BY rowid").all(),
      operations: db.prepare("SELECT * FROM operations ORDER BY rowid").all(),
      batteries: db.prepare("SELECT * FROM batteries ORDER BY key").all(),
    };
  } finally { db.close(); }
}

try {
  const first = await start();
  assert.equal(first.ready.migrations, 10);
  assert.equal(first.ready.administratorInitialized, true);
  check("All ten frozen migrations apply through real Miniflare D1; private admin bootstrap succeeds once");
  let response = await request(first, "/api/session");
  const initialSession = await jsonResponse(response);
  assert.equal(initialSession.setupRequired, false); assert.equal(initialSession.user, null);
  response = await request(first, "/api/inventory?dataset=demo"); await jsonResponse(response, 401);
  response = await request(first, "/api/inventory?dataset=demo", { cookie: "inventory_session=" + "a".repeat(64), headers: { "oai-authenticated-user-id": adminId, "oai-authenticated-user-email": "admin@inventory.local", "x-miniflare-user": "admin", "cf-access-authenticated-user-email": "admin@inventory.local" } });
  await jsonResponse(response, 401);
  check("Anonymous clients and forged hosting/internal identity headers cannot authenticate");
  response = await request(first, "/");
  if ([302, 303, 307].includes(response.status)) assert.match(response.headers.get("location"), /^\/signin\?/);
  else {
    assert.equal(response.status, 200);
    const redirectHtml = await response.text();
    assert.match(redirectHtml, /(?:http-equiv="refresh"|NEXT_REDIRECT)/);
    assert.match(redirectHtml, /\/signin\?return_to=/);
  }
  response = await request(first, "/bootstrap.json"); await jsonResponse(response, 404);
  response = await request(first, "/signin"); assert.equal(response.status, 200); const html = await response.text(); assert.match(html, /Staff sign in/);
  const asset = html.match(/src="([^"]+\.js)"/); assert.ok(asset);
  response = await request(first, asset[1]); assert.equal(response.status, 200);
  check("Native signin and built assets are public; inventory redirects to signin and private bootstrap is unavailable");
  response = await request(first, "/api/session", { body: { action: "signin", payload: { username: "admin", password: "incorrect-password" } } }); await jsonResponse(response, 401);
  const admin = await signin(first, "admin", access.password); assert.equal(admin.user.id, adminId); assert.equal(admin.user.role, "admin");
  response = await request(first, "/api/session", { cookie: admin.cookie }); assert.equal((await jsonResponse(response)).user.id, adminId);
  check("Native PBKDF2 600,000-iteration signin issues and accepts the staff cookie; incorrect password fails");
  response = await request(first, "/api/inventory", { cookie: admin.cookie, body: { dataset: "demo", action: "initialize_demo" }, headers: { Origin: "https://untrusted.example" } }); await jsonResponse(response, 403);
  response = await request(first, "/api/inventory", { cookie: admin.cookie, body: { dataset: "demo", action: "initialize_demo" } }); assert.equal((await jsonResponse(response)).result.initialized, true);
  response = await request(first, "/api/accounts", { cookie: admin.cookie }); const accounts = await jsonResponse(response); assert.equal(accounts.accounts.length, 1); assert.equal(accounts.accounts[0].id, adminId);
  check("Same-origin write guard rejects cross-origin mutation; native admin account API works");
  const staffPassword = randomBytes(24).toString("base64url");
  response = await request(first, "/api/accounts", { cookie: admin.cookie, body: { action: "create", payload: { username: "staff-verification", displayName: "Verification staff", email: "", role: "staff", defaultDataset: "demo", password: staffPassword } } });
  const staffId = (await jsonResponse(response)).result.id;
  const staff = await signin(first, "staff-verification", staffPassword); assert.equal(staff.user.id, staffId); assert.equal(staff.user.role, "staff");
  response = await request(first, "/api/inventory?dataset=demo", { cookie: staff.cookie }); const inventory = await jsonResponse(response); assert.equal(inventory.batteries.length, 6);
  response = await request(first, "/api/accounts?scope=self", { cookie: staff.cookie }); assert.equal((await jsonResponse(response)).user.id, staffId);
  const ownerId = inventory.people.find(person => person.accountId === staffId).id;
  response = await request(first, "/api/inventory", { cookie: staff.cookie, body: { dataset: "demo", action: "battery", payload: { id: "QA-BAT-001", name: "Verification battery", chemistry: "Li-ion", model: "QA only", capacityMah: null, voltage: null, tagId: "QA-TAG-001", ownerId, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null } } }); await jsonResponse(response);
  response = await request(first, "/api/export?format=json", { cookie: staff.cookie, body: { dataset: "demo", mode: "summary", range: "filtered", filter: {} } });
  assert.match(response.headers.get("content-disposition"), /attachment/); const exported = await jsonResponse(response); assert.equal(exported.metadata.exported_batteries, 7);
  check("Staff can signin, read shared inventory, read own account, register a new battery and export all shared records");
  response = await request(first, "/api/accounts", { cookie: staff.cookie }); await jsonResponse(response, 403);
  response = await request(first, "/api/accounts", { cookie: staff.cookie, body: { action: "create", payload: {} } }); await jsonResponse(response, 403);
  response = await request(first, "/api/inventory", { cookie: staff.cookie, body: { dataset: "demo", action: "battery", update: true, payload: { id: "QA-BAT-001", name: "Unauthorized edit", ownerId, homeBuildingId: "J18", homeRoomId: null, expectedVersion: 1 } } }); await jsonResponse(response, 403);
  check("Native ordinary-staff permissions reject account administration and saved battery metadata edits");
  const checkout = { requestId: randomUUID(), kind: "checkout", batteryIds: ["QA-BAT-001"] };
  response = await request(first, "/api/inventory", { cookie: staff.cookie, body: { dataset: "demo", action: "movement", payload: checkout } }); await jsonResponse(response);
  response = await request(first, "/api/inventory", { cookie: staff.cookie, body: { dataset: "demo", action: "movement", payload: checkout } }); assert.equal((await jsonResponse(response)).result.replayed, true);
  response = await request(first, "/api/inventory?dataset=demo&batteryId=QA-BAT-001", { cookie: staff.cookie }); const checked = await jsonResponse(response); assert.equal(checked.loans.length, 1); assert.equal(checked.battery.borrowerAccountId, staffId);
  response = await request(first, "/api/inventory", { cookie: staff.cookie, body: { dataset: "demo", action: "movement", payload: { requestId: randomUUID(), kind: "return", batteryIds: ["QA-BAT-001"], expectedLoans: [{ batteryId: "QA-BAT-001", loanId: checked.battery.loanId }] } } }); await jsonResponse(response);
  response = await request(first, "/api/inventory?dataset=demo&batteryId=QA-BAT-001", { cookie: staff.cookie }); const returned = await jsonResponse(response); assert.equal(returned.loans.length, 1); assert.ok(returned.loans[0].returnedAt);
  check("Native staff self-checkout, exact replay and reviewed return record one complete attributed loan");
  response = await request(first, "/api/inventory?dataset=live", { cookie: staff.cookie }); assert.equal((await jsonResponse(response)).batteries.length, 0);
  check("Working inventory remains empty and separate from fictional demonstration records");
  response = await request(first, "/api/accounts", { cookie: admin.cookie, body: { action: "profile", payload: { id: adminId, expectedVersion: 1, displayName: "Admin verification profile", email: "qa@example.test", defaultDataset: "live" } } }); await jsonResponse(response);
  const changedPassword = randomBytes(24).toString("base64url");
  response = await request(first, "/api/accounts", { cookie: admin.cookie, body: { action: "password", payload: { currentPassword: access.password, newPassword: changedPassword } } }); await jsonResponse(response);
  await stop(first);
  const before = await databaseReceipt();
  assert.equal(before.migrations.length, 10);
  assert.equal(before.accountEvents.filter(event => event.action === "administrator_initialized").length, 1);
  assert.equal(before.loans.length, 1);
  assert.equal(before.accounts.find(account => account.id === adminId).display_name, "Admin verification profile");
  const second = await start(); assert.equal(second.ready.administratorInitialized, false);
  response = await request(second, "/api/session", { body: { action: "signin", payload: { username: "admin", password: access.password } } }); await jsonResponse(response, 401);
  const restartedAdmin = await signin(second, "admin", changedPassword); assert.equal(restartedAdmin.user.displayName, "Admin verification profile"); assert.equal(restartedAdmin.user.email, "qa@example.test"); assert.equal(restartedAdmin.user.defaultDataset, "live");
  response = await request(second, "/api/inventory?dataset=demo&batteryId=QA-BAT-001", { cookie: restartedAdmin.cookie }); const restartedDetail = await jsonResponse(response); assert.deepEqual(restartedDetail.loans, returned.loans); assert.deepEqual(restartedDetail.events, returned.events);
  await stop(second);
  const after = await databaseReceipt(); assert.deepEqual(after, before);
  check("Graceful restart retains exact migration receipts, accounts, changed password/profile, batteries, loan/audit/operation histories, with no second bootstrap");
  evidence.finishedAt = new Date().toISOString(); evidence.checkCount = evidence.checks.length;
  await writeFile(path.join(directory, "native-verification.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (active) {
    try { await stop(active); } catch { active?.child.kill(); }
  }
}
