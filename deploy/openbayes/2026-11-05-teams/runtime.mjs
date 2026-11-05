import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, rename, realpath } from "node:fs/promises";
import { fstatSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createInventoryHttpServer } from "./http-gateway.mjs";
import { acquireRuntimeOwner } from "./runtime-owner.mjs";

const deploymentName = "2026-11-05-teams-embedding-1.0.0";
const previousDeploymentName = "2026-11-05-web-console-wrapup-1.0.0";
const previousSourceCommit = "dcb1256ece33b7e0a2aed14ccb3888c324fcaa4d";
// Code-only update: the predecessor database carries all 25 receipts and nothing is appended.
const previousMigrationCount = 25, migrationCount = 25, applicationVersion = "1.0.0";
// Rollback: the retained 5 November wrap-up application serves the CURRENT copy with ordinary reads and writes.
const localMode = process.env.INVENTORY_LOCAL_TEST === "1", rollback = process.env.INVENTORY_PREDECESSOR_APPLICATION === "1";
const publicOrigin = "https://zztv-battery.gear-c1.openbayes.net";
if (process.env.INVENTORY_PUBLIC_ORIGIN && process.env.INVENTORY_PUBLIC_ORIGIN !== publicOrigin) throw new Error("The configured public origin differs from the reviewed canonical origin.");
if (process.env.INVENTORY_LAUNCHER_LOCK_HELD !== "1" || Number(process.env.INVENTORY_LAUNCHER_PID) !== process.ppid) throw new Error("Use the launcher holding the shared saved-home lock.");
const restoredFromExecution = process.env.INVENTORY_RESTORED_FROM_EXECUTION;
if (!restoredFromExecution || restoredFromExecution !== process.env.INVENTORY_EXPECTED_SAVED_HOME_EXECUTION) throw new Error("The restored execution identity must be explicitly reviewed.");
const root = path.resolve(process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL("./", import.meta.url)));
const project = path.resolve(process.env.INVENTORY_PROJECT_ROOT || "");
const dataRoot = path.resolve(process.env.INVENTORY_DATA_ROOT || "");
if (!process.env.INVENTORY_PROJECT_ROOT || !process.env.INVENTORY_DATA_ROOT || path.basename(dataRoot) !== `data-${deploymentName}` || await realpath(dataRoot) !== path.join(await realpath(project), `data-${deploymentName}`)) throw new Error("The independently preserved current deployment database is required.");
if (localMode && project.replaceAll("\\", "/").startsWith("/openbayes/home")) throw new Error("The hosted saved home cannot be a synthetic fixture.");
if (!localMode && (process.platform !== "linux" || process.arch !== "x64" || await realpath(project) !== await realpath("/openbayes/home/battery-inventory") || root !== path.join(project, "releases", deploymentName))) throw new Error("The sealed release must run in the retained Linux saved home.");
if (process.platform !== "win32") {
  const descriptor = Number(process.env.INVENTORY_LAUNCHER_LOCK_FD);
  if (!Number.isInteger(descriptor) || descriptor < 3 || !fstatSync(descriptor).isFile() || realpathSync(`/proc/self/fd/${descriptor}`) !== realpathSync(path.join(project, ".teaching-deployment.lock"))) throw new Error("The inherited local saved-home kernel lock is required.");
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function safeFile(name) {
  if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe candidate manifest path.");
  const file = path.join(root, name), resolved = await realpath(file);
  if (resolved !== file) throw new Error("Candidate runtime content cannot be linked.");
  return readFile(file);
}
const manifest = JSON.parse(await safeFile("deployment.json"));
if (manifest.deploymentName !== deploymentName || manifest.applicationVersion !== applicationVersion || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) || manifest.sourceCommit !== process.env.INVENTORY_RELEASE_SOURCE_COMMIT || manifest.sealedSource !== true || manifest.publicOrigin !== publicOrigin || manifest.previousDeploymentName !== previousDeploymentName || manifest.previousSourceCommit !== previousSourceCommit || manifest.migrationCount !== migrationCount) throw new Error("The exact sealed release identity differs.");
const listed = new Set();
for (const record of manifest.files) {
  if (listed.has(record.path) || hash(await safeFile(record.path)) !== record.sha256) throw new Error(`Changed candidate file: ${record.path}`);
  listed.add(record.path);
}
if (hash(JSON.stringify(manifest.sourceFiles)) !== manifest.sourceSnapshotSha256 || manifest.gatewaySha256 !== hash(await safeFile("http-gateway.mjs"))) throw new Error("The complete sealed source or gateway identity differs.");
const buildFiles = manifest.files.filter(record => record.path.startsWith("dist/")).map(({ path, sha256 }) => ({ path, sha256 }));
if (hash(JSON.stringify(buildFiles)) !== manifest.buildSnapshotSha256) throw new Error("The candidate production build identity differs.");
const compatibility = JSON.parse(await safeFile("migration-compatibility.json"));
const journalBytes = await safeFile("migrations/meta/_journal.json"), journal = JSON.parse(journalBytes);
if (!journalBytes.equals(await safeFile("drizzle/meta/_journal.json")) || compatibility.entries?.length !== migrationCount || journal.entries?.length !== migrationCount || compatibility.deploymentName !== deploymentName || compatibility.previousDeploymentName !== previousDeploymentName || compatibility.previousSourceCommit !== previousSourceCommit) throw new Error("The 25 accepted predecessor migrations are required.");
const expectedReceipts = [], migrationSql = [];
for (const [index, entry] of journal.entries.entries()) {
  const record = compatibility.entries[index];
  if (entry.idx !== index || record.name !== entry.tag || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || entry.tag.slice(0, 4) !== String(index).padStart(4, "0")) throw new Error("The migration identity changed.");
  const applied = await safeFile(`migrations/${entry.tag}.sql`), source = await safeFile(`drizzle/${entry.tag}.sql`);
  if (hash(applied) !== record.sha256 || hash(source) !== record.sourceSha256 || applied.toString().replaceAll("\r\n", "\n") !== source.toString().replaceAll("\r\n", "\n")) throw new Error("An accepted migration source or applied sidecar changed.");
  if (record.previouslyApplied !== true || index >= previousMigrationCount) throw new Error("This code-only update appends no migration.");
  expectedReceipts.push({ name: entry.tag, sha256: record.sha256 }); migrationSql.push(applied.toString("utf8"));
}
const copy = JSON.parse(await readFile(path.join(dataRoot, "upgrade-source.json"), "utf8"));
if (copy.deploymentName !== deploymentName || copy.fromDeploymentName !== previousDeploymentName || copy.fromSourceCommit !== previousSourceCommit || copy.sourceCommit !== manifest.sourceCommit || copy.sourceSnapshotSha256 !== manifest.sourceSnapshotSha256 || copy.initialSavedHomeExecution !== restoredFromExecution || copy.originalPreserved !== true || !copy.snapshot) throw new Error("The verified independent database backup and its exact reviewed execution identity are required.");
const sqliteFiles = (await readdir(path.join(dataRoot, "d1"), { recursive: true })).filter(file => file.endsWith(".sqlite") && path.basename(file) !== "metadata.sqlite");
if (sqliteFiles.length !== 1) throw new Error("Exactly one copied inventory database is required.");
const sqlitePath = path.join(dataRoot, "d1", sqliteFiles[0]), backupPath = path.join(dataRoot, "original-backup.sqlite");
if (hash(await readFile(backupPath)) !== copy.backupSha256) throw new Error("The original database backup changed.");
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function encode(value, kind) {
  if (kind === "null") return [kind];
  if (kind === "integer") return [kind, value.toString()];
  if (kind === "real") { const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); return [kind, bytes.toString("hex")]; }
  if (kind === "text") return [kind, Buffer.from(value, "utf8").toString("hex")];
  if (kind === "blob") return [kind, Buffer.from(value).toString("hex")];
  throw new Error("Unsupported SQLite storage type.");
}
// Receipts must be the exact reviewed list (25; this update appends none).
function snapshot(file, counts = [previousMigrationCount]) {
  const db = new DatabaseSync(process.platform === "win32" ? path.toNamespacedPath(file) : file, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Copied database integrity failed.");
    if (db.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get().count < 8 || db.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE active=1 AND role='admin'").get().count < 1) throw new Error("The retained native accounts and active administrator are required.");
    const receipts = db.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all();
    if (!counts.includes(receipts.length) || JSON.stringify(receipts) !== JSON.stringify(expectedReceipts.slice(0, receipts.length))) throw new Error("The migration receipts are not the exact reviewed prefix for this step.");
    const result = {};
    for (const [name, original] of Object.entries(copy.snapshot)) {
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      if (JSON.stringify(columns) !== JSON.stringify(original.columns)) throw new Error("An original database column changed.");
      const expressions = columns.flatMap((field, index) => [`${quote(field)} AS c${index}`, `typeof(${quote(field)}) AS t${index}`]);
      const suffix = name === "portable_migrations" ? ` ORDER BY name LIMIT ${previousMigrationCount}` : "";
      const statement = db.prepare(`SELECT ${expressions.join(",")} FROM ${quote(name)}${suffix}`); statement.setReadBigInts(true);
      const rows = statement.all().map(row => JSON.stringify(columns.map((_, index) => encode(row[`c${index}`], row[`t${index}`])))).sort();
      result[name] = { columns, count: rows.length, sha256: hash(rows.join("\n")) };
    }
    return result;
  } finally { db.close(); }
}
if (JSON.stringify(snapshot(backupPath)) !== JSON.stringify(copy.snapshot)) throw new Error("The verified backup does not preserve every original typed cell.");
let completed;
try { completed = JSON.parse(await readFile(path.join(dataRoot, "upgrade-complete.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (completed && (completed.deploymentName !== deploymentName || completed.migrations !== migrationCount || completed.sourceCommit !== manifest.sourceCommit || completed.sourceSnapshotSha256 !== manifest.sourceSnapshotSha256 || completed.schemaVerified !== true)) throw new Error("A completed current deployment has a different identity.");
const anyStep = Array.from({ length: migrationCount - previousMigrationCount + 1 }, (_, offset) => previousMigrationCount + offset);
const currentSnapshot = snapshot(sqlitePath, completed ? [migrationCount] : anyStep);
if (!completed && JSON.stringify(currentSnapshot) !== JSON.stringify(copy.snapshot)) throw new Error("The independent initial copy differs from the original database.");
if (rollback && !completed) throw new Error("Rollback requires a completed current database.");
const applicationRoot = path.resolve(process.env.INVENTORY_APPLICATION_ROOT || root);
if (applicationRoot !== (rollback ? path.join(project, "releases", previousDeploymentName) : root)) throw new Error("The selected application does not match normal or rollback mode.");
if (rollback) {
  const previous = JSON.parse(await readFile(path.join(applicationRoot, "deployment.json"), "utf8"));
  if (previous.deploymentName !== previousDeploymentName || previous.sourceCommit !== previousSourceCommit || previous.applicationVersion !== applicationVersion) throw new Error("The exact retained predecessor application is required.");
  for (const record of previous.files) {
    const file = path.join(applicationRoot, record.path);
    if (record.path.includes("\\") || record.path.split("/").some(part => !part || part === ".." || part === ".") || await realpath(file) !== file || hash(await readFile(file)) !== record.sha256) throw new Error("A retained predecessor application file changed.");
  }
}
const releaseOwner = await acquireRuntimeOwner(dataRoot);
let runtime, server;
try {
const serverRoot = path.join(applicationRoot, "dist/server");
const files = (await readdir(serverRoot, { recursive: true })).filter(file => /\.m?js$/.test(file));
files.sort((a, b) => a === "index.js" ? -1 : b === "index.js" ? 1 : a < b ? -1 : a > b ? 1 : 0);
const persistencePath = path.join(dataRoot, "d1");
const signalHandlersBeforeMiniflare = new Map(["SIGTERM", "SIGINT"].map(name => [name, process.listeners(name)]));
runtime = new Miniflare({ host: "127.0.0.1", port: 0, cf: false, modules: files.map(file => ({ type: "ESModule", path: path.join(serverRoot, file) })), modulesRoot: serverRoot, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], assets: { directory: path.join(applicationRoot, "dist/client"), routerConfig: { has_user_worker: true } }, d1Databases: { DB: "battery-inventory-portable" }, d1Persist: persistencePath, cachePersist: false, liveReload: false });
const miniflareSignalHandlers = new Map(["SIGTERM", "SIGINT"].map(name => [name, process.listeners(name).filter(handler => !signalHandlersBeforeMiniflare.get(name).includes(handler))]));
for (const [name, handlers] of miniflareSignalHandlers) {
  if (handlers.length !== 1 || handlers[0].name !== (name === "SIGTERM" ? "onSignalTerm" : "onSignalInt")) throw new Error("The retained Miniflare signal handlers differ from the reviewed runtime.");
}
  const db = await runtime.getD1Database("DB");
  const receiptCount = async () => {
    const receipts = (await db.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all()).results;
    if (receipts.length < previousMigrationCount || receipts.length > migrationCount || JSON.stringify(receipts) !== JSON.stringify(expectedReceipts.slice(0, receipts.length))) throw new Error("The Worker opened a different or empty database; no HTTP service was started.");
    return receipts.length;
  };
  let applied = await receiptCount();
  if ((completed || rollback) && applied !== migrationCount) throw new Error("A completed current database must carry all 25 migration receipts.");
  const schema = async database => (await database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'portable_migrations' ORDER BY type,name").all()).results.map(row => ({ ...row, sql: row.sql?.replaceAll("\r\n", "\n") ?? null }));
  const statementsOf = (database, sql) => sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => database.prepare(value));
  const validation = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('local candidate schema')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "candidate-schema-reference" }, d1Persist: false });
  try {
    const reference = await validation.getD1Database("DB");
    for (let index = 0; index < migrationCount; index++) {
      await reference.batch(statementsOf(reference, migrationSql[index]));
      if (index + 1 === applied && JSON.stringify(await schema(db)) !== JSON.stringify(await schema(reference))) throw new Error("The copied current database schema or integrity triggers differ from the reviewed migration boundary.");
      if (index < applied) continue;
      if (completed || rollback) throw new Error("A completed current database cannot apply new migrations.");
      // Each reviewed migration and its receipt commit in one atomic D1 batch.
      const entry = journal.entries[index];
      await db.batch([...statementsOf(db, migrationSql[index]), db.prepare("INSERT INTO portable_migrations(name,sha256,applied_at) VALUES(?,?,?)").bind(entry.tag, expectedReceipts[index].sha256, new Date().toISOString())]);
      applied = await receiptCount();
      if (applied !== index + 1 || JSON.stringify(await schema(db)) !== JSON.stringify(await schema(reference))) throw new Error("An appended migration schema or receipt differs from its reviewed result.");
      if (JSON.stringify(snapshot(sqlitePath, [applied])) !== JSON.stringify(copy.snapshot)) throw new Error("Existing business cells changed while appending a reviewed migration.");
      console.log(JSON.stringify({ event: "migration_applied_verified", name: entry.tag, migrations: applied, allOriginalCellsPreserved: true }));
      if (localMode && Number(process.env.INVENTORY_TEST_STOP_AFTER_MIGRATION) === index) throw new Error("Controlled interruption after an atomic migration.");
    }
  } finally { await validation.dispose(); }
  if (await receiptCount() !== migrationCount) throw new Error("All 25 migration receipts are required before HTTP.");
  if (JSON.stringify(snapshot(sqlitePath, [migrationCount])) !== JSON.stringify(currentSnapshot)) throw new Error("Schema verification changed persisted business cells.");
  const receipt = { deploymentName, sourceCommit: manifest.sourceCommit, migrations: migrationCount, appendedMigrations: journal.entries.slice(previousMigrationCount).map(entry => entry.tag), sourceSnapshotSha256: manifest.sourceSnapshotSha256, buildSnapshotSha256: manifest.buildSnapshotSha256, restoredFromExecution, initialSavedHomeExecution: copy.initialSavedHomeExecution, schemaVerified: true, originalPreserved: true, initialVerificationAt: completed?.initialVerificationAt ?? new Date().toISOString() };
  const completePath = path.join(dataRoot, "upgrade-complete.json");
  if (localMode && process.env.INVENTORY_TEST_STOP_BEFORE_COMPLETION === "1") throw new Error("Controlled interruption after schema verification, before completion.");
  if (!rollback) {
  await writeFile(completePath + ".tmp", JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 }); await rename(completePath + ".tmp", completePath);
  }
  let port = Number(process.env.INVENTORY_PORT || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Select a valid local loopback port.");
  if (!port) {
    const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  }
  // Rollback serves the CURRENT database through the retained predecessor application. Both have
  // the same schema and receipts (it differs in the web client and the embedded session cookie
  // only), so ordinary reads and writes remain available.
  const identity = { status: "ok", deploymentName, version: applicationVersion, sourceCommit: manifest.sourceCommit, mode: rollback ? "rollback-predecessor-application" : "normal", applicationDeploymentName: rollback ? previousDeploymentName : deploymentName, applicationSourceCommit: rollback ? previousSourceCommit : manifest.sourceCommit, migrations: migrationCount, sourceSnapshotSha256: manifest.sourceSnapshotSha256, buildSnapshotSha256: manifest.buildSnapshotSha256, gatewaySha256: manifest.gatewaySha256, publicOrigin, syntheticQualification: localMode };
  const dispatch = (url, init) => runtime.dispatchFetch(url, init);
  server = createInventoryHttpServer({ publicOrigin, dispatchFetch: (url, init) => new URL(url).pathname === "/healthz" ? Promise.resolve(Response.json(identity)) : dispatch(url, init) });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, localMode ? "127.0.0.1" : "0.0.0.0", resolve); });
  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await runtime.dispose(); await releaseOwner(); process.exit(0);
  }
  // Miniflare exits synchronously on signals before asynchronous application cleanup.
  // Remove only its captured additions; retain unrelated listeners and its exit hook.
  for (const [name, handlers] of miniflareSignalHandlers) for (const handler of handlers) process.removeListener(name, handler);
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  console.log(JSON.stringify({ event: "inventory_ready", ...identity, runtimePid: process.pid, port, copiedCurrentDatabase: true, originalBackupRetained: true, completedDatabaseRetained: !!completed }));
  if (process.env.INVENTORY_MANUAL_STOP !== "1") {
    const maximumSeconds = Number(process.env.INVENTORY_MAX_SECONDS || 7200);
    if (!Number.isFinite(maximumSeconds) || maximumSeconds < 1 || maximumSeconds > 7200) throw new Error("A bounded runtime duration must be between one second and two hours.");
    setTimeout(shutdown, maximumSeconds * 1000);
  }
} catch (error) {
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  try { await runtime?.dispose(); } finally { await releaseOwner(); }
  throw error;
}
