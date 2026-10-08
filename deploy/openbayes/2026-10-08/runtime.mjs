import { Miniflare } from "miniflare";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, writeFile, rename, open, unlink, realpath } from "node:fs/promises";
import { fstatSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { hostname } from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const deploymentName = "2026-10-08-teaching-groups";
const applicationVersion = "0.7.0";
const previousCommit = "14e18151e52184b24d4b941f1057c78c34a88b09";
const root = path.resolve(process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL("./", import.meta.url)));
const dataRoot = path.resolve(process.env.INVENTORY_DATA_ROOT || "");
const localMode = process.env.INVENTORY_LOCAL_TEST === "1";
if (!localMode && process.env.INVENTORY_LAUNCHER_LOCK_HELD !== "1") throw new Error("The locked saved-home launcher is required.");
const restoredFromExecution = process.env.INVENTORY_RESTORED_FROM_EXECUTION;
if (!restoredFromExecution || restoredFromExecution !== process.env.INVENTORY_EXPECTED_SAVED_HOME_EXECUTION) throw new Error("The latest restored execution must be explicitly reviewed.");
if (!process.env.INVENTORY_DATA_ROOT || path.basename(dataRoot) !== `data-${deploymentName}` || (!localMode && await realpath(dataRoot) !== await realpath(`/openbayes/home/battery-inventory/data-${deploymentName}`))) throw new Error("The independently copied current inventory database is required.");
if (!localMode) {
  const descriptor = Number(process.env.INVENTORY_LAUNCHER_LOCK_FD);
  if (!Number.isInteger(descriptor) || descriptor < 3 || !fstatSync(descriptor).isFile() || realpathSync(`/proc/self/fd/${descriptor}`) !== realpathSync("/openbayes/home/battery-inventory/.teaching-deployment.lock")) throw new Error("The inherited saved-home lock descriptor is required.");
  console.log(JSON.stringify({ event: "inherited_deployment_lock_verified", descriptor, retainedForRuntimeLifetime: true }));
}
const manifest = JSON.parse(await readFile(path.join(root, "deployment.json"), "utf8"));
if (manifest.deploymentName !== deploymentName || manifest.applicationVersion !== applicationVersion) throw new Error("The release manifest does not match this deployment.");
const upgrade = JSON.parse(await readFile(path.join(dataRoot, "upgrade-source.json"), "utf8"));
if (upgrade.deploymentName !== deploymentName || upgrade.fromSourceCommit !== previousCommit || !upgrade.originalPreserved || !upgrade.snapshot) throw new Error("The verified original database backup is required.");
const migrationRoot = path.join(root, "migrations");
const journal = JSON.parse(await readFile(path.join(migrationRoot, "meta/_journal.json"), "utf8"));
const compatibility = JSON.parse(await readFile(path.join(root, "migration-compatibility.json"), "utf8"));
if (journal.entries.length !== 21 || compatibility.entries?.length !== 21 || compatibility.deploymentName !== deploymentName || compatibility.previousSourceCommit !== previousCommit) throw new Error("The twenty-one reviewed migration records are required.");
const expectedReceipts = new Map();
const migrationSql = [];
for (const [index, entry] of journal.entries.entries()) {
  const expected = compatibility.entries[index];
  if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || expected.name !== entry.tag) throw new Error("Invalid migration journal order or name.");
  const sql = await readFile(path.join(migrationRoot, `${entry.tag}.sql`));
  const source = await readFile(path.join(root, `drizzle/${entry.tag}.sql`));
  if (createHash("sha256").update(sql).digest("hex") !== expected.sha256 || createHash("sha256").update(source).digest("hex") !== expected.sourceSha256 || sql.toString().replaceAll("\r\n", "\n") !== source.toString().replaceAll("\r\n", "\n")) throw new Error(`Changed migration bytes: ${entry.tag}`);
  if (index >= 16 && (sql.includes(13) || sql.subarray(0, 3).equals(Buffer.from([239, 187, 191])))) throw new Error("New migrations require LF without a byte-order mark.");
  expectedReceipts.set(entry.tag, expected.sha256);
  migrationSql.push(sql.toString("utf8"));
}
const sqliteFiles = (await readdir(path.join(dataRoot, "d1"), { recursive: true })).filter(file => file.endsWith(".sqlite") && path.basename(file) !== "metadata.sqlite");
if (sqliteFiles.length !== 1) throw new Error("Exactly one copied inventory database is required.");
const sqlitePath = path.join(dataRoot, "d1", sqliteFiles[0]);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function encodeCell(value, kind) {
  if (kind === "null") return [kind];
  if (kind === "integer") return [kind, value.toString()];
  if (kind === "real") { const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); return [kind, bytes.toString("hex")]; }
  if (kind === "text") return [kind, Buffer.from(value, "utf8").toString("hex")];
  if (kind === "blob") return [kind, Buffer.from(value).toString("hex")];
  throw new Error("Unsupported SQLite storage type.");
}
function snapshotOriginal() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database integrity or foreign keys failed.");
    if (db.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get().count < 8 || db.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE active=1 AND role='admin'").get().count < 1) throw new Error("The latest native accounts and active administrator are required.");
    const result = {};
    for (const [name, original] of Object.entries(upgrade.snapshot)) {
      const columns = original.columns;
      const found = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      if (columns.some(column => !found.includes(column))) throw new Error(`Original table or column missing: ${name}`);
      const expressions = columns.flatMap((field, index) => [`${quote(field)} AS c${index}`, `typeof(${quote(field)}) AS t${index}`]);
      const suffix = name === "portable_migrations" ? " ORDER BY name LIMIT 16" : "";
      const statement = db.prepare(`SELECT ${expressions.join(",")} FROM ${quote(name)}${suffix}`);
      statement.setReadBigInts(true);
      const rows = statement.all().map(row => JSON.stringify(columns.map((_, index) => encodeCell(row[`c${index}`], row[`t${index}`])))).sort();
      result[name] = { columns, count: rows.length, sha256: createHash("sha256").update(rows.join("\n")).digest("hex") };
    }
    return result;
  } finally { db.close(); }
}
function originalPreserved() {
  if (JSON.stringify(snapshotOriginal()) !== JSON.stringify(upgrade.snapshot)) throw new Error("Existing business cells changed during the upgrade.");
}
function schemaSql(value) { return value === null ? null : value.replaceAll("\r\n", "\n"); }
async function schema(db) {
  return (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'portable_migrations' ORDER BY type,name").all()).results.map(row => ({ ...row, sql: schemaSql(row.sql) }));
}
async function receiptCount(db) {
  const receipts = (await db.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all()).results;
  const expected = [...expectedReceipts];
  if (receipts.length < 16 || receipts.length > 21 || receipts.some((row, index) => row.name !== expected[index]?.[0] || row.sha256 !== expected[index]?.[1])) throw new Error("Migration receipts are not the exact reviewed journal prefix.");
  return receipts.length;
}
let existingComplete;
try { existingComplete = JSON.parse(await readFile(path.join(dataRoot, "upgrade-complete.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (existingComplete && (existingComplete.deploymentName !== deploymentName || existingComplete.migrations !== 21)) throw new Error("The completed database belongs to another deployment.");
if (!existingComplete) originalPreserved();
const ownerPath = path.join(dataRoot, ".runtime-owner.json");
const owner = { pid: process.pid, hostname: hostname(), token: randomBytes(16).toString("hex") };
async function acquireLease() {
  try { const handle = await open(ownerPath, "wx", 0o600); await handle.writeFile(JSON.stringify(owner)); await handle.close(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(ownerPath, "utf8"));
    if (previous.hostname !== hostname() || !Number.isInteger(previous.pid) || previous.pid < 1) throw new Error("An unverified runtime lock is retained.");
    try { process.kill(previous.pid, 0); } catch (failure) {
      if (failure.code !== "ESRCH") throw new Error("Another runtime may still be running.");
      await unlink(ownerPath);
      const handle = await open(ownerPath, "wx", 0o600); await handle.writeFile(JSON.stringify(owner)); await handle.close();
      return;
    }
    throw new Error("Another inventory runtime is already running.");
  }
}
async function releaseLease() {
  if (!localMode) return;
  try { const current = JSON.parse(await readFile(ownerPath, "utf8")); if (current.token === owner.token) await unlink(ownerPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
// Production ownership uses the launcher's kernel lock, released even after a crash.
// Controlled direct Windows fixtures additionally reject simultaneous Node runtimes.
if (localMode) await acquireLease();
const serverRoot = path.join(root, "dist/server");
const files = (await readdir(serverRoot, { recursive: true })).filter(file => /\.m?js$/.test(file));
files.sort((left, right) => left === "index.js" ? -1 : right === "index.js" ? 1 : left.localeCompare(right));
const runtime = new Miniflare({ host: "127.0.0.1", port: 0, cf: false, modules: files.map(file => ({ type: "ESModule", path: path.join(serverRoot, file) })), modulesRoot: serverRoot, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], assets: { directory: path.join(root, "dist/client"), routerConfig: { has_user_worker: true } }, d1Databases: { DB: "battery-inventory-portable" }, d1Persist: path.join(dataRoot, "d1"), cachePersist: false, liveReload: false });
try {
  const db = await runtime.getD1Database("DB");
  let applied = await receiptCount(db);
  if (existingComplete && applied !== 21) throw new Error("A completed deployment cannot have incomplete migration receipts.");
  const validation = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('schema validation')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "schema-validation" }, d1Persist: false });
  try {
    const reference = await validation.getD1Database("DB");
    for (let index = 0; index < 21; index++) {
      await reference.batch(migrationSql[index].split("--> statement-breakpoint").filter(value => value.trim()).map(value => reference.prepare(value)));
      if (index + 1 === applied && JSON.stringify(await schema(db)) !== JSON.stringify(await schema(reference))) throw new Error("Existing database schema or integrity triggers differ from the reviewed migration boundary.");
      if (index >= applied) {
        if (existingComplete) throw new Error("A completed deployment cannot apply new migrations.");
        const entry = journal.entries[index];
        const statements = migrationSql[index].split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value));
        statements.push(db.prepare("INSERT INTO portable_migrations(name,sha256,applied_at) VALUES(?,?,?)").bind(entry.tag, expectedReceipts.get(entry.tag), new Date().toISOString()));
        await db.batch(statements);
        if (await receiptCount(db) !== index + 1 || JSON.stringify(await schema(db)) !== JSON.stringify(await schema(reference))) throw new Error("Applied migration schema or receipt differs from its reviewed result.");
        originalPreserved();
        console.log(JSON.stringify({ event: "migration_applied_verified", name: entry.tag, migrations: index + 1, allOriginalCellsPreserved: true }));
        if (localMode && Number(process.env.INVENTORY_TEST_STOP_AFTER_MIGRATION) === index) throw new Error("Controlled interruption after an atomic migration.");
      }
    }
  } finally { await validation.dispose(); }
  if (await receiptCount(db) !== 21) throw new Error("All twenty-one migration receipts are required before HTTP.");
  const verified = snapshotOriginal();
  if (!existingComplete) originalPreserved();
  const now = new Date().toISOString();
  const receipt = { deploymentName, version: applicationVersion, migrations: 21, originalPreserved: true, initialSavedHomeExecution: upgrade.initialSavedHomeExecution, restoredFromExecution, schemaVerified: true, allOriginalCellsPreservedDuringUpgrade: true, initialVerificationAt: existingComplete?.initialVerificationAt ?? now, lastStartupVerifiedAt: now };
  const complete = path.join(dataRoot, "upgrade-complete.json");
  await writeFile(complete + ".tmp", JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  await rename(complete + ".tmp", complete);
  console.log(JSON.stringify({ event: "database_upgrade_verified", deploymentName, migrations: 21, schemaVerified: true, allOriginalCellsPreserved: !existingComplete, completedDatabaseRetained: !!existingComplete, originalTableCounts: Object.fromEntries(Object.entries(verified).map(([name, record]) => [name, record.count])) }));

  const manualStop = process.env.INVENTORY_MANUAL_STOP === "1";
  const maximumSeconds = Number(process.env.INVENTORY_MAX_SECONDS || 7200);
  if (!manualStop && (!Number.isFinite(maximumSeconds) || maximumSeconds < 1 || maximumSeconds > 7200)) {
    throw new Error("A bounded demonstration must run between one second and two hours.");
  }
  function sendJson(res, status, value) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
    res.end(JSON.stringify(value));
  }
  async function bodyBytes(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      // Native endpoints apply their own tighter character and row limits.
      if (size > 1000000) throw Object.assign(new Error("This request is too large."), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function publicOrigin(req) {
    const host = req.headers.host;
    if (!host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw Object.assign(new Error("Invalid host."), { status: 400 });
    return `${localMode ? "http" : "https"}://${host}`;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const origin = publicOrigin(req), url = new URL(req.url, origin);
      if (url.origin !== origin) return sendJson(res, 400, { error: "Invalid request URL." });
      if (url.pathname === "/healthz") {
        if (!["GET", "HEAD"].includes(req.method)) return sendJson(res, 405, { error: "Method not allowed." });
        return sendJson(res, 200, { status: "ok", version: applicationVersion, deploymentName });
      }
      if (["/bootstrap.json", "/deployment.json", "/runtime.mjs"].includes(url.pathname)) return sendJson(res, 404, { error: "Not found." });
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && req.headers.origin !== origin) return sendJson(res, 403, { error: "Cross-origin changes are not allowed." });
      const headers = new Headers();
      const blocked = /^(?:oai-authenticated-user-|x-miniflare-|x-vinext-prerender|cf-access-|x-forwarded-)/i;
      const hopHeaders = new Set(["host", "authorization", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "forwarded"]);
      const connectionHeaders = new Set(String(req.headers.connection || "").split(",").map(value => value.trim().toLowerCase()));
      for (const [key, value] of Object.entries(req.headers)) {
        if (blocked.test(key) || hopHeaders.has(key) || connectionHeaders.has(key)) continue;
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const body = mutating ? await bodyBytes(req) : undefined;
      const response = await runtime.dispatchFetch(url.href, { method: req.method, headers, body, redirect: "manual" });
      const outgoing = Object.fromEntries(response.headers);
      delete outgoing["content-length"]; delete outgoing["transfer-encoding"]; delete outgoing["content-encoding"];
      if (response.headers.getSetCookie) {
        const cookies = response.headers.getSetCookie();
        if (cookies.length) outgoing["set-cookie"] = cookies;
      }
      outgoing["x-content-type-options"] = "nosniff";
      outgoing["x-frame-options"] = "DENY";
      outgoing["referrer-policy"] = "same-origin";
      outgoing["cache-control"] = "no-store";
      res.writeHead(response.status, outgoing);
      if (req.method === "HEAD" || !response.body) return res.end();
      Readable.fromWeb(response.body).on("error", () => res.destroy()).pipe(res);
    } catch (error) {
      console.error("Gateway request failed:", error.name);
      if (!res.headersSent) sendJson(res, error.status || 503, { error: error.status ? error.message : "The inventory could not complete this request." });
      else res.destroy();
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(process.env.PORT || 8081), process.env.INVENTORY_LISTEN_HOST || "0.0.0.0", resolve);
  });
  console.log(JSON.stringify({ event: "inventory_ready", version: applicationVersion, deploymentName, port: server.address().port, migrations: 21, dataDirectory: dataRoot, existingAccountsPreserved: true, nativeStaffAuthentication: true, automaticStop: !manualStop }));
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    console.log("Stopping inventory and preserving the current staff database.");
    let deadline;
    await new Promise(resolve => {
      deadline = setTimeout(() => { server.closeAllConnections(); resolve(); }, 10000);
      server.close(resolve);
      server.closeIdleConnections();
    });
    clearTimeout(deadline);
    await runtime.dispose();
    await releaseLease();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  if (localMode && process.send) process.on("message", message => { if (message?.action === "shutdown") void shutdown(); });
  if (!manualStop) setTimeout(shutdown, maximumSeconds * 1000);
} catch (error) {
  await runtime.dispose();
  await releaseLease();
  throw error;
}
