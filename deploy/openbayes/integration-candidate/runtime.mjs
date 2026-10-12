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

const candidateName = "2026-10-13-web-server-integration-candidate";
const previousDeploymentName = "2026-10-12-workspace-1.0.0";
const previousSourceCommit = "d0e1640a0c516ba6c68aeae4695b12a8afb12525";
const migrationCount = 23, applicationVersion = "1.0.0";
if (process.env.INVENTORY_LOCAL_TEST !== "1") throw new Error("An unsealed integration candidate can run only for local qualification.");
if (process.env.INVENTORY_LAUNCHER_LOCK_HELD !== "1" || Number(process.env.INVENTORY_LAUNCHER_PID) !== process.ppid) throw new Error("Use the local launcher holding the shared saved-home lock.");
const restoredFromExecution = process.env.INVENTORY_RESTORED_FROM_EXECUTION;
if (!restoredFromExecution || restoredFromExecution !== process.env.INVENTORY_EXPECTED_SAVED_HOME_EXECUTION) throw new Error("The restored execution identity must be explicitly reviewed.");
const root = path.resolve(process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL("./", import.meta.url)));
const project = path.resolve(process.env.INVENTORY_PROJECT_ROOT || "");
const dataRoot = path.resolve(process.env.INVENTORY_DATA_ROOT || "");
if (!process.env.INVENTORY_PROJECT_ROOT || !process.env.INVENTORY_DATA_ROOT || project.replaceAll("\\", "/").startsWith("/openbayes/home") || path.basename(dataRoot) !== `data-${candidateName}` || await realpath(dataRoot) !== path.join(await realpath(project), `data-${candidateName}`)) throw new Error("An independently copied synthetic local database is required.");
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
const manifest = JSON.parse(await safeFile("candidate.json"));
if (manifest.candidateName !== candidateName || manifest.applicationVersion !== applicationVersion || manifest.sourceCommit !== null || manifest.unsealed !== true || manifest.localOnly !== true || manifest.previousDeploymentName !== previousDeploymentName || manifest.previousSourceCommit !== previousSourceCommit || manifest.migrationCount !== migrationCount) throw new Error("The local candidate identity differs.");
const listed = new Set();
for (const record of manifest.files) {
  if (listed.has(record.path) || hash(await safeFile(record.path)) !== record.sha256) throw new Error(`Changed candidate file: ${record.path}`);
  listed.add(record.path);
}
if (hash(JSON.stringify(manifest.sourceFiles)) !== manifest.sourceSnapshotSha256 || hash(JSON.stringify(manifest.adapterSourceFiles)) !== manifest.adapterSnapshotSha256 || manifest.gatewaySha256 !== hash(await safeFile("http-gateway.mjs"))) throw new Error("The candidate source or gateway identity differs.");
const buildFiles = manifest.files.filter(record => record.path.startsWith("dist/")).map(({ path, sha256 }) => ({ path, sha256 }));
if (hash(JSON.stringify(buildFiles)) !== manifest.buildSnapshotSha256) throw new Error("The candidate production build identity differs.");
const compatibility = JSON.parse(await safeFile("migration-compatibility.json"));
const journalBytes = await safeFile("migrations/meta/_journal.json"), journal = JSON.parse(journalBytes);
if (!journalBytes.equals(await safeFile("drizzle/meta/_journal.json")) || compatibility.entries?.length !== migrationCount || journal.entries?.length !== migrationCount || compatibility.candidateName !== candidateName || compatibility.previousDeploymentName !== previousDeploymentName || compatibility.previousSourceCommit !== previousSourceCommit) throw new Error("The 23 accepted predecessor migrations are required.");
const expectedReceipts = [], migrationSql = [];
for (const [index, entry] of journal.entries.entries()) {
  const record = compatibility.entries[index];
  if (entry.idx !== index || record.name !== entry.tag || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || entry.tag.slice(0, 4) !== String(index).padStart(4, "0")) throw new Error("The migration identity changed.");
  const applied = await safeFile(`migrations/${entry.tag}.sql`), source = await safeFile(`drizzle/${entry.tag}.sql`);
  if (hash(applied) !== record.sha256 || hash(source) !== record.sourceSha256 || applied.toString().replaceAll("\r\n", "\n") !== source.toString().replaceAll("\r\n", "\n")) throw new Error("An accepted migration source or applied sidecar changed.");
  expectedReceipts.push({ name: entry.tag, sha256: record.sha256 }); migrationSql.push(applied.toString("utf8"));
}
const copy = JSON.parse(await readFile(path.join(dataRoot, "copy-source.json"), "utf8"));
if (copy.candidateName !== candidateName || copy.previousDeploymentName !== previousDeploymentName || copy.previousSourceCommit !== previousSourceCommit || copy.sourceSnapshotSha256 !== manifest.sourceSnapshotSha256 || copy.initialSavedHomeExecution !== restoredFromExecution || copy.originalPreserved !== true || !copy.snapshot) throw new Error("The verified independent database backup and its exact reviewed execution identity are required.");
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
function snapshot(file) {
  const db = new DatabaseSync(process.platform === "win32" ? path.toNamespacedPath(file) : file, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Copied database integrity failed.");
    if (db.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get().count < 8 || db.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE active=1 AND role='admin'").get().count < 1) throw new Error("The retained native accounts and active administrator are required.");
    if (JSON.stringify(db.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all()) !== JSON.stringify(expectedReceipts)) throw new Error("All 23 exact accepted migration receipts are required.");
    const result = {};
    for (const [name, original] of Object.entries(copy.snapshot)) {
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      if (JSON.stringify(columns) !== JSON.stringify(original.columns)) throw new Error("An original database column changed.");
      const expressions = columns.flatMap((field, index) => [`${quote(field)} AS c${index}`, `typeof(${quote(field)}) AS t${index}`]);
      const statement = db.prepare(`SELECT ${expressions.join(",")} FROM ${quote(name)}`); statement.setReadBigInts(true);
      const rows = statement.all().map(row => JSON.stringify(columns.map((_, index) => encode(row[`c${index}`], row[`t${index}`])))).sort();
      result[name] = { columns, count: rows.length, sha256: hash(rows.join("\n")) };
    }
    return result;
  } finally { db.close(); }
}
if (JSON.stringify(snapshot(backupPath)) !== JSON.stringify(copy.snapshot)) throw new Error("The verified backup does not preserve every original typed cell.");
let completed;
try { completed = JSON.parse(await readFile(path.join(dataRoot, "candidate-complete.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (completed && (completed.candidateName !== candidateName || completed.migrations !== migrationCount || completed.sourceSnapshotSha256 !== manifest.sourceSnapshotSha256 || completed.schemaVerified !== true)) throw new Error("A completed candidate has a different identity.");
const currentSnapshot = snapshot(sqlitePath);
if (!completed && JSON.stringify(currentSnapshot) !== JSON.stringify(copy.snapshot)) throw new Error("The independent initial copy differs from the original database.");
const releaseOwner = process.platform === "win32" ? await acquireRuntimeOwner(dataRoot) : async () => {};
const serverRoot = path.join(root, "dist/server");
const files = (await readdir(serverRoot, { recursive: true })).filter(file => /\.m?js$/.test(file));
files.sort((a, b) => a === "index.js" ? -1 : b === "index.js" ? 1 : a < b ? -1 : a > b ? 1 : 0);
const persistencePath = path.join(dataRoot, "d1");
const runtime = new Miniflare({ host: "127.0.0.1", port: 0, cf: false, modules: files.map(file => ({ type: "ESModule", path: path.join(serverRoot, file) })), modulesRoot: serverRoot, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], assets: { directory: path.join(root, "dist/client"), routerConfig: { has_user_worker: true } }, d1Databases: { DB: "battery-inventory-portable" }, d1Persist: persistencePath, cachePersist: false, liveReload: false });
let server;
try {
  const db = await runtime.getD1Database("DB");
  if (JSON.stringify((await db.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all()).results) !== JSON.stringify(expectedReceipts)) throw new Error("The Worker opened a different or empty database; no HTTP service was started.");
  const schema = async database => (await database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'portable_migrations' ORDER BY type,name").all()).results.map(row => ({ ...row, sql: row.sql?.replaceAll("\r\n", "\n") ?? null }));
  const validation = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('local candidate schema')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "candidate-schema-reference" }, d1Persist: false });
  try {
    const reference = await validation.getD1Database("DB");
    for (const sql of migrationSql) await reference.batch(sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => reference.prepare(value)));
    if (JSON.stringify(await schema(db)) !== JSON.stringify(await schema(reference))) throw new Error("The copied current database schema or integrity triggers differ from the accepted 23-migration boundary.");
  } finally { await validation.dispose(); }
  if (JSON.stringify(snapshot(sqlitePath)) !== JSON.stringify(currentSnapshot)) throw new Error("Schema verification changed persisted business cells.");
  const receipt = { candidateName, migrations: migrationCount, sourceSnapshotSha256: manifest.sourceSnapshotSha256, buildSnapshotSha256: manifest.buildSnapshotSha256, restoredFromExecution, initialSavedHomeExecution: copy.initialSavedHomeExecution, schemaVerified: true, originalPreserved: true, localOnly: true, initialVerificationAt: completed?.initialVerificationAt ?? new Date().toISOString() };
  const completePath = path.join(dataRoot, "candidate-complete.json");
  await writeFile(completePath + ".tmp", JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 }); await rename(completePath + ".tmp", completePath);
  let port = Number(process.env.INVENTORY_PORT || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Select a valid local loopback port.");
  if (!port) {
    const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  }
  const configuredOrigin = process.env.INVENTORY_PUBLIC_ORIGIN;
  const publicOrigin = configuredOrigin || `http://127.0.0.1:${port}`;
  const identity = { candidateName, applicationVersion, sourceCommit: null, unsealed: true, localOnly: true, migrationCount, sourceSnapshotSha256: manifest.sourceSnapshotSha256, buildSnapshotSha256: manifest.buildSnapshotSha256, gatewaySha256: manifest.gatewaySha256, transportTls: false };
  server = createInventoryHttpServer({ publicOrigin, allowLoopbackHttp: !configuredOrigin, dispatchFetch: (url, init) => new URL(url).pathname === "/healthz" ? Promise.resolve(Response.json(identity)) : runtime.dispatchFetch(url, init) });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  console.log(JSON.stringify({ event: "integration_candidate_ready", ...identity, port, publicOrigin, copiedCurrentDatabase: true, originalBackupRetained: true, completedDatabaseRetained: !!completed }));
  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await runtime.dispose(); await releaseOwner(); process.exit(0);
  }
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  const maximumSeconds = Number(process.env.INVENTORY_MAX_SECONDS || 7200);
  if (!Number.isFinite(maximumSeconds) || maximumSeconds < 1 || maximumSeconds > 7200) throw new Error("Local candidate runtime duration must be between one second and two hours.");
  setTimeout(shutdown, maximumSeconds * 1000);
} catch (error) {
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await runtime.dispose(); await releaseOwner(); throw error;
}
