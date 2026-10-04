"""Build version 0.6.1 and preserve the current sixteen-migration staff database."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import struct
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import uuid

CONFIGURATION = json.loads(r'''{"sourceCommit": "14e18151e52184b24d4b941f1057c78c34a88b09", "archiveUrl": "https://codeload.github.com/DESN-Group-F/bsc-f2a5cc56/legacy.tar.gz/14e18151e52184b24d4b941f1057c78c34a88b09", "archiveSha256": "7533a13e754baa05f7e087dfe5cc3f3c46db8fd0e5fda9715abc0467fd3dfed5", "archiveSizeBytes": 1086115}''')
RUNTIME_SOURCE = r'''import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, rename } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const expectedCommit = "14e18151e52184b24d4b941f1057c78c34a88b09";
const previousCommit = "c563823e42832fda1873c9d9f75acb88c8ed2fd0";
const root = path.resolve(process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL("./", import.meta.url)));
const dataRoot = path.resolve(process.env.INVENTORY_DATA_ROOT || "");
const localMode = process.env.INVENTORY_LOCAL_TEST === "1";
if (!process.env.INVENTORY_DATA_ROOT || path.basename(dataRoot) !== "data-v0.6.1"
  || (!localMode && dataRoot !== "/openbayes/home/battery-inventory/data-v0.6.1")) {
  throw new Error("The verified current data-v0.6.1 copy is required.");
}
const manifest = JSON.parse(await readFile(path.join(root, "deployment.json"), "utf8"));
if (manifest.sourceCommit !== expectedCommit || manifest.applicationVersion !== "0.6.1" || manifest.schemaUnchanged !== true) {
  throw new Error("The deployment does not match the reviewed application-only update.");
}
const upgrade = JSON.parse(await readFile(path.join(dataRoot, "upgrade-source.json"), "utf8"));
if (upgrade.sourceCommit !== expectedCommit || upgrade.fromVersion !== "0.6.0" || upgrade.fromSourceCommit !== previousCommit || upgrade.schemaUnchanged !== true) {
  throw new Error("A verified current-version database copy is required.");
}
const sourceRoot = path.join(root, "source");
const migrationRoot = path.join(root, "migrations");
const compatibility = JSON.parse(await readFile(path.join(root, "migration-compatibility.json"), "utf8"));
if (compatibility.sourceCommit !== expectedCommit || compatibility.previousSourceCommit !== previousCommit || compatibility.schemaUnchanged !== true || compatibility.entries?.length !== 16) {
  throw new Error("The sixteen unchanged migration records are required.");
}
const journal = JSON.parse(await readFile(path.join(migrationRoot, "meta/_journal.json"), "utf8"));
if (journal.entries.length !== 16) throw new Error("This update cannot add or change migrations.");
const expectedReceipts = new Map();
for (const [index, entry] of journal.entries.entries()) {
  if (!/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error("Invalid migration journal entry.");
  const sql = await readFile(path.join(migrationRoot, `${entry.tag}.sql`));
  const sourceSql = await readFile(path.join(sourceRoot, `drizzle/${entry.tag}.sql`));
  const expected = compatibility.entries[index];
  const hash = createHash("sha256").update(sql).digest("hex");
  const sourceHash = createHash("sha256").update(sourceSql).digest("hex");
  if (expected.name !== entry.tag || expected.sha256 !== hash || expected.sourceSha256 !== sourceHash
    || expected.retainedLegacyBytes !== (index < 10) || expected.lineEndingOnlyDifference !== (hash !== sourceHash)
    || (index < 10 ? sql.toString().replaceAll("\r\n", "\n") !== sourceSql.toString().replaceAll("\r\n", "\n") : !sql.equals(sourceSql))) {
    throw new Error(`Changed migration bytes: ${entry.tag}`);
  }
  expectedReceipts.set(entry.tag, hash);
}
const sqliteFiles = (await readdir(path.join(dataRoot, "d1"), { recursive: true }))
  .filter(file => file.endsWith(".sqlite") && path.basename(file) !== "metadata.sqlite");
if (sqliteFiles.length !== 1) throw new Error("Exactly one current inventory database is required.");
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
function snapshot() {
  const saved = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    if (saved.prepare("PRAGMA quick_check").get().quick_check !== "ok" || saved.prepare("PRAGMA foreign_key_check").all().length) throw new Error("The current database failed integrity checks.");
    if (saved.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get().count < 8
      || saved.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE role='admin' AND active=1").get().count < 1) throw new Error("All existing staff accounts and the current administrator are required.");
    const receipts = saved.prepare("SELECT name,sha256 FROM portable_migrations ORDER BY name").all();
    if (receipts.length !== 16 || receipts.some(row => expectedReceipts.get(row.name) !== row.sha256)) throw new Error("All sixteen existing migration receipts must match exactly.");
    const tables = saved.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA' ORDER BY name").all();
    const records = {};
    for (const { name } of tables) {
      const columns = saved.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      const expressions = columns.flatMap((field, index) => [`${quote(field)} AS c${index}`, `typeof(${quote(field)}) AS t${index}`]);
      const statement = saved.prepare(`SELECT ${expressions.join(",")} FROM ${quote(name)}`);
      statement.setReadBigInts(true);
      const rows = statement.all().map(row => JSON.stringify(columns.map((_, index) => encodeCell(row[`c${index}`], row[`t${index}`])))).sort();
      records[name] = { columns, count: rows.length, sha256: createHash("sha256").update(rows.join("\n")).digest("hex") };
    }
    return records;
  } finally { saved.close(); }
}
const before = snapshot();
let existingComplete;
try { existingComplete = JSON.parse(await readFile(path.join(dataRoot, "upgrade-complete.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (existingComplete && existingComplete.sourceCommit !== expectedCommit) throw new Error("The completed database belongs to another application release.");
if (!existingComplete && JSON.stringify(upgrade.snapshot) !== JSON.stringify(before)) throw new Error("The current database copy differs from its verified backup.");
const serverRoot = path.join(sourceRoot, "dist/server");
const files = (await readdir(serverRoot, { recursive: true })).filter(file => /\.m?js$/.test(file));
files.sort((left, right) => left === "index.js" ? -1 : right === "index.js" ? 1 : left.localeCompare(right));
const runtime = new Miniflare({
  host: "127.0.0.1", port: 0, cf: false,
  modules: files.map(file => ({ type: "ESModule", path: path.join(serverRoot, file) })), modulesRoot: serverRoot,
  compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
  assets: { directory: path.join(sourceRoot, "dist/client"), routerConfig: { has_user_worker: true } },
  d1Databases: { DB: "battery-inventory-portable" }, d1Persist: path.join(dataRoot, "d1"),
  cachePersist: false, liveReload: false,
});
try {
  const db = await runtime.getD1Database("DB");
  if (Number(await db.prepare("SELECT COUNT(*) FROM staff_accounts").first("COUNT(*)")) < 8) throw new Error("The Worker opened a different or incomplete staff database.");
  const receipts = (await db.prepare("SELECT name,sha256 FROM portable_migrations").all()).results;
  if (receipts.length !== 16 || receipts.some(row => expectedReceipts.get(row.name) !== row.sha256)) throw new Error("The Worker migration receipts changed.");
  if (JSON.stringify(snapshot()) !== JSON.stringify(before)) throw new Error("Worker startup changed existing database cells.");
  const receipt = { sourceCommit: expectedCommit, version: "0.6.1", migrations: 16, schemaUnchanged: true, snapshot: before, verifiedAt: new Date().toISOString() };
  const complete = path.join(dataRoot, "upgrade-complete.json");
  await writeFile(complete + ".tmp", JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  await rename(complete + ".tmp", complete);
  console.log(JSON.stringify({ event: "database_upgrade_verified", migrations: 16, schemaUnchanged: true, allOriginalCellsPreserved: true, preservedTableCounts: Object.fromEntries(Object.entries(before).map(([name, value]) => [name, value.count])) }));

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
        return sendJson(res, 200, { status: "ok", version: "0.6.1", sourceCommit: expectedCommit });
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
  console.log(JSON.stringify({ event: "inventory_ready", version: "0.6.1", sourceCommit: expectedCommit, port: server.address().port, migrations: 16, dataDirectory: dataRoot, existingAccountsPreserved: true, nativeStaffAuthentication: true, automaticStop: !manualStop }));
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
    process.exit(0);
  }
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  if (localMode && process.send) process.on("message", message => { if (message?.action === "shutdown") void shutdown(); });
  if (!manualStop) setTimeout(shutdown, maximumSeconds * 1000);
} catch (error) {
  await runtime.dispose();
  throw error;
}
'''
PIN = "14e18151e52184b24d4b941f1057c78c34a88b09"
PREVIOUS_PIN = "c563823e42832fda1873c9d9f75acb88c8ed2fd0"
INITIAL_SAVED_HOME_EXECUTION = "unectzwzehn3"
MINIMUM_ACCOUNTS = 8
NODE_VERSION = "v24.21.0"
NODE_SHA256 = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
STARTED = time.monotonic()
LIMIT = 7200
MANUAL = os.environ.get("INVENTORY_MANUAL_STOP") == "1"


def log(event, **values):
    print(json.dumps(dict(event=event, **values)), flush=True)


def remaining(maximum):
    budget = maximum if MANUAL else min(maximum, LIMIT - (time.monotonic() - STARTED))
    if budget < 1:
        raise RuntimeError("The bounded deployment time limit was reached.")
    return budget


def sha256(file):
    digest = hashlib.sha256()
    with file.open("rb") as content:
        for chunk in iter(lambda: content.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, file, expected, host, maximum):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != host or parsed.username or parsed.password:
        raise RuntimeError("The download host is invalid.")
    received = 0
    started = time.monotonic()
    with urllib.request.urlopen(url, timeout=60) as response, file.open("xb") as output:
        if urllib.parse.urlsplit(response.geturl()).hostname != host:
            raise RuntimeError("The download redirect is invalid.")
        while chunk := response.read(1024 * 1024):
            received += len(chunk)
            if received > maximum or time.monotonic() - started > 600:
                raise RuntimeError("The download exceeded its size or time limit.")
            remaining(600)
            output.write(chunk)
    if sha256(file) != expected:
        raise RuntimeError("The downloaded file checksum does not match.")
    log("download_verified", source=host, bytes=received, sha256=expected)


def extract_source(archive, target):
    with tarfile.open(archive, "r:gz") as package:
        members = package.getmembers()
        roots = {PurePosixPath(member.name).parts[0] for member in members if member.name}
        if len(roots) != 1:
            raise RuntimeError("The source archive has an unexpected layout.")
        for member in members:
            parts = PurePosixPath(member.name).parts
            if not parts or PurePosixPath(member.name).is_absolute() or ".." in parts:
                raise RuntimeError("The source archive has an unsafe path.")
            if not (member.isfile() or member.isdir()):
                raise RuntimeError("Source archive links are not allowed.")
            if len(parts) == 1:
                continue
            destination = target.joinpath(*parts[1:])
            if not destination.resolve().is_relative_to(target.resolve()):
                raise RuntimeError("The source archive leaves its release directory.")
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as content, destination.open("xb") as output:
                    shutil.copyfileobj(content, output)


def install_node(project):
    tools = project / "tools"
    tools.mkdir(exist_ok=True)
    final = tools / ("node-" + NODE_VERSION)
    marker = final / "verified-archive.json"
    if final.exists():
        if not marker.is_file() or json.loads(marker.read_text()).get("sha256") != NODE_SHA256:
            raise RuntimeError("The saved Node installation is incomplete or unverified.")
        return final / "bin/node"
    stage = tools / (".node-" + str(uuid.uuid4()))
    stage.mkdir()
    name = "node-" + NODE_VERSION + "-linux-x64.tar.xz"
    archive = stage / name
    download("https://nodejs.org/dist/" + NODE_VERSION + "/" + name, archive, NODE_SHA256, "nodejs.org", 60 * 1024 * 1024)
    with tarfile.open(archive, "r:xz") as package:
        for member in package.getmembers():
            destination = (stage / member.name).resolve()
            if not destination.is_relative_to(stage.resolve()) or not (member.isfile() or member.isdir() or member.issym()):
                raise RuntimeError("The verified Node archive has an unsafe entry.")
            if member.issym() and not (destination.parent / member.linkname).resolve().is_relative_to(stage.resolve()):
                raise RuntimeError("The verified Node archive has an unsafe link.")
        package.extractall(stage)
    unpacked = stage / ("node-" + NODE_VERSION + "-linux-x64")
    (unpacked / "verified-archive.json").write_text(json.dumps({"sha256": NODE_SHA256}))
    unpacked.rename(final)
    return final / "bin/node"


def run(command, cwd, environment, log_path, timeout):
    with log_path.open("ab") as output:
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=remaining(timeout))
        except BaseException:
            stop(child)
            raise
    if code:
        raise RuntimeError("A remote build step failed; inspect its retained build log.")


def stop(child):
    if child.poll() is not None:
        return
    # Let the Node supervisor drain active HTTP requests before stopping workerd.
    child.send_signal(signal.SIGTERM)
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def cell(value, kind):
    if kind == "null":
        return ["null"]
    if kind == "integer":
        return [kind, str(value)]
    if kind == "real":
        return [kind, struct.pack(">d", value).hex()]
    if kind == "text":
        return [kind, value.encode("utf-8").hex()]
    if kind == "blob":
        return [kind, value.hex()]
    raise RuntimeError("Unsupported SQLite storage type.")


def database_file(data):
    candidates = [file for file in (data / "d1").rglob("*.sqlite") if file.name != "metadata.sqlite"]
    if len(candidates) != 1:
        raise RuntimeError("Exactly one current inventory database is required.")
    return candidates[0]


def snapshot(file, expected):
    connection = sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)] or connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("The current database failed integrity checks.")
        if connection.execute("SELECT COUNT(*) FROM staff_accounts").fetchone()[0] < MINIMUM_ACCOUNTS:
            raise RuntimeError("Restore the latest saved home with all eight existing accounts.")
        if connection.execute("SELECT COUNT(*) FROM staff_accounts WHERE role='admin' AND active=1").fetchone()[0] < 1:
            raise RuntimeError("The existing active administrator is required.")
        receipts = dict(connection.execute("SELECT name,sha256 FROM portable_migrations ORDER BY name"))
        if len(receipts) != 16 or receipts != expected:
            raise RuntimeError("All sixteen unchanged migration receipts are required.")
        result = {}
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA' ORDER BY name").fetchall()
        for (name,) in tables:
            columns = [row[1] for row in connection.execute("PRAGMA table_info(" + quote(name) + ")")]
            expressions = [part for field in columns for part in (quote(field), "typeof(" + quote(field) + ")")]
            rows = []
            for row in connection.execute("SELECT " + ",".join(expressions) + " FROM " + quote(name)):
                encoded = [cell(row[index], row[index + 1]) for index in range(0, len(row), 2)]
                rows.append(json.dumps(encoded, separators=(",", ":")))
            rows.sort()
            result[name] = {"columns": columns, "count": len(rows), "sha256": hashlib.sha256("\n".join(rows).encode()).hexdigest()}
        return result
    finally:
        connection.close()


def retained_migrations(project, source, target=None):
    previous = project / "releases/0.6.0-r2"
    old_manifest = json.loads((previous / "deployment.json").read_text())
    old_compatibility = json.loads((previous / "migration-compatibility.json").read_text())
    journal_bytes = (source / "drizzle/meta/_journal.json").read_bytes()
    entries = json.loads(journal_bytes)["entries"]
    if old_manifest.get("sourceCommit") != PREVIOUS_PIN or old_compatibility.get("sourceCommit") != PREVIOUS_PIN:
        raise RuntimeError("The verified current 0.6.0-r2 release is required.")
    if len(entries) != 16 or journal_bytes != (previous / "source/drizzle/meta/_journal.json").read_bytes() or journal_bytes != (previous / "migrations/meta/_journal.json").read_bytes():
        raise RuntimeError("This application-only update cannot change the migration journal.")
    records = old_compatibility.get("entries", [])
    if [record["name"] for record in records] != [entry["tag"] for entry in entries]:
        raise RuntimeError("The current migration compatibility record is inconsistent.")
    files = {}
    for index, record in enumerate(records):
        name = record["name"]
        if not name[:4].isdigit() or Path(name).name != name:
            raise RuntimeError("Invalid migration name.")
        frozen = (source / "drizzle" / (name + ".sql")).read_bytes()
        old_frozen = (previous / "source/drizzle" / (name + ".sql")).read_bytes()
        applied = (previous / "migrations" / (name + ".sql")).read_bytes()
        if frozen != old_frozen or hashlib.sha256(frozen).hexdigest() != record["sourceSha256"] or hashlib.sha256(applied).hexdigest() != record["sha256"]:
            raise RuntimeError("Existing migration source, applied bytes or receipts changed.")
        if record["retainedLegacyBytes"] != (index < 10) or record["lineEndingOnlyDifference"] != (applied != frozen):
            raise RuntimeError("The retained migration metadata changed.")
        if (applied.replace(b"\r\n", b"\n") != frozen.replace(b"\r\n", b"\n")) if index < 10 else applied != frozen:
            raise RuntimeError("The retained migration contains an unsupported difference.")
        files[name] = applied
    hashes = {record["name"]: record["sha256"] for record in records}
    if target is not None:
        target.mkdir()
        (target / "meta").mkdir()
        (target / "meta/_journal.json").write_bytes(journal_bytes)
        for name, content in files.items():
            (target / (name + ".sql")).write_bytes(content)
        (target.parent / "migration-compatibility.json").write_text(json.dumps({"sourceCommit": PIN, "previousSourceCommit": PREVIOUS_PIN, "schemaUnchanged": True, "entries": records}, indent=2) + "\n")
    return hashes


def verify_release_migrations(project, release):
    expected = retained_migrations(project, release / "source")
    compatibility = json.loads((release / "migration-compatibility.json").read_text())
    if compatibility.get("sourceCommit") != PIN or compatibility.get("schemaUnchanged") is not True:
        raise RuntimeError("The current application migration manifest is invalid.")
    for record in compatibility.get("entries", []):
        if expected.get(record["name"]) != record["sha256"] or sha256(release / "migrations" / (record["name"] + ".sql")) != record["sha256"]:
            raise RuntimeError("The retained migration sidecar changed.")
    if len(compatibility.get("entries", [])) != 16:
        raise RuntimeError("All sixteen retained migration files are required.")
    return expected


def reuse_verified_dependencies(project, source):
    previous = project / "releases/0.6.0/source"
    cached = previous / "node_modules"
    if not cached.is_dir():
        return False
    current_package = json.loads((source / "package.json").read_text())
    previous_package = json.loads((previous / "package.json").read_text())
    current_package.pop("version", None)
    previous_package.pop("version", None)
    if current_package != previous_package:
        return False
    current_lock = json.loads((source / "package-lock.json").read_text())
    previous_lock = json.loads((previous / "package-lock.json").read_text())
    for lock in (current_lock, previous_lock):
        lock.pop("version", None)
        lock.get("packages", {}).get("", {}).pop("version", None)
    if current_lock != previous_lock:
        return False
    dependencies = dict(current_package.get("dependencies", {}), **current_package.get("devDependencies", {}))
    for name in dependencies:
        file = cached / name / "package.json"
        if not file.is_file() or json.loads(file.read_text()).get("version") != current_lock["packages"].get("node_modules/" + name, {}).get("version"):
            return False
    (source / "node_modules").symlink_to(cached, target_is_directory=True)
    log("verified_dependencies_reused", matchingCatalog=True, matchingLock=True, directPackages=len(dependencies))
    return True


def copy_current_database(project, expected):
    current, upgraded = project / "data-v0.6.0", project / "data-v0.6.1"
    if upgraded.exists():
        marker = upgraded / "upgrade-complete.json"
        if not marker.is_file() or json.loads(marker.read_text()).get("sourceCommit") != PIN:
            raise RuntimeError("An incomplete application upgrade exists and will not be reset.")
        records = snapshot(database_file(upgraded), expected)
        log("saved_upgrade_verified", migrations=16, tableCounts={name: row["count"] for name, row in records.items()})
        return upgraded
    if os.environ.get("INVENTORY_RESTORED_FROM_EXECUTION") != INITIAL_SAVED_HOME_EXECUTION:
        raise RuntimeError("Confirm the stopped latest execution's saved home before copying its database.")
    old_marker = json.loads((current / "upgrade-complete.json").read_text())
    if old_marker.get("sourceCommit") != PREVIOUS_PIN:
        raise RuntimeError("The completed current version 0.6.0 database is required.")
    original = database_file(current)
    before = snapshot(original, expected)
    pending = project / (".061-copy-" + uuid.uuid4().hex)
    pending.mkdir(mode=0o700)
    destination = pending / original.relative_to(current)
    destination.parent.mkdir(parents=True)
    readonly = sqlite3.connect(original.resolve().as_uri() + "?mode=ro", uri=True)
    copied = sqlite3.connect(destination)
    try:
        readonly.backup(copied)
    finally:
        copied.close()
        readonly.close()
    if snapshot(destination, expected) != before or snapshot(original, expected) != before:
        raise RuntimeError("The current database changed during backup or the copy differs.")
    receipt = {"sourceCommit": PIN, "fromVersion": "0.6.0", "fromSourceCommit": PREVIOUS_PIN,
               "initialSavedHomeExecution": INITIAL_SAVED_HOME_EXECUTION, "originalPreserved": True,
               "schemaUnchanged": True, "snapshot": before}
    (pending / "upgrade-source.json").write_text(json.dumps(receipt, indent=2) + "\n")
    pending.rename(upgraded)
    log("database_copy_verified", migrations=16, originalRetained=True, allOriginalCellsPreserved=True,
        tableCounts={name: row["count"] for name, row in before.items()})
    return upgraded


def main():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Linux x86_64 is required.")
    if len(PIN) != 40 or CONFIGURATION.get("sourceCommit") != PIN or len(CONFIGURATION.get("archiveSha256", "")) != 64:
        raise RuntimeError("The public download configuration must pin the reviewed application commit.")
    if not RUNTIME_SOURCE.startswith('import { Miniflare }') or PIN not in RUNTIME_SOURCE:
        raise RuntimeError("The reviewed native runtime is missing.")
    project = Path("/openbayes/home/battery-inventory")
    old_release = project / "releases/0.6.0-r2"
    runtime_modules = (old_release / "runtime/node_modules").resolve(strict=True)
    if json.loads((runtime_modules / "miniflare/package.json").read_text()).get("version") != "4.20260515.0":
        raise RuntimeError("The existing verified native runtime is required.")
    if shutil.disk_usage(project).free < 5 * 1024**3:
        raise RuntimeError("At least five GiB of free deployment space is required.")
    release = project / "releases/0.6.1"
    runtime_digest = hashlib.sha256(RUNTIME_SOURCE.encode()).hexdigest()
    stage = None
    if release.exists():
        manifest = json.loads((release / "deployment.json").read_text())
        if manifest.get("sourceCommit") != PIN or manifest.get("archiveSha256") != CONFIGURATION["archiveSha256"] or manifest.get("runtimeSha256") != runtime_digest or sha256(release / "runtime/runtime.mjs") != runtime_digest or not (release / "source/dist/server/index.js").is_file():
            raise RuntimeError("The saved version 0.6.1 release is incomplete or mismatched.")
    else:
        stage = project / "releases" / (".0.6.1-build-" + uuid.uuid4().hex)
        stage.mkdir()
        source = stage / "source"
        source.mkdir()
        archive = stage / "frozen-source.tar.gz"
        download(CONFIGURATION["archiveUrl"], archive, CONFIGURATION["archiveSha256"], "codeload.github.com", 30 * 1024 * 1024)
        extract_source(archive, source)
        if json.loads((source / "package.json").read_text()).get("version") != "0.6.1":
            raise RuntimeError("The pinned source has the wrong application version.")
        expected = retained_migrations(project, source)
        # Fail before a paid build if the copied home predates the current staff accounts.
        current_marker = json.loads((project / "data-v0.6.0/upgrade-complete.json").read_text())
        if current_marker.get("sourceCommit") != PREVIOUS_PIN:
            raise RuntimeError("Restore the latest completed current database.")
        snapshot(database_file(project / "data-v0.6.0"), expected)
    node = install_node(project)
    environment = dict(os.environ, PATH=str(node.parent) + os.pathsep + os.environ.get("PATH", ""),
                       CI="true", SHARP_IGNORE_GLOBAL_LIBVIPS="1", NODE_OPTIONS="--max-old-space-size=2560",
                       CLOUDFLARE_CF_FETCH_ENABLED="false", WRANGLER_SEND_METRICS="false", WRANGLER_WRITE_LOGS="false")
    if stage is not None:
        npm = node.parent.parent / "lib/node_modules/npm/bin/npm-cli.js"
        build_log = stage / "build.log"
        if not reuse_verified_dependencies(project, source):
            log("remote_install_started", sourceCommit=PIN)
            run([str(node), str(npm), "ci", "--include=dev", "--include=optional", "--no-audit", "--no-fund"], source, environment, build_log, 1800)
        log("remote_build_started", sourceCommit=PIN)
        run([str(node), str(npm), "run", "build"], source, environment, build_log, 1200)
        if not (source / "dist/server/index.js").is_file() or not (source / "dist/client").is_dir():
            raise RuntimeError("The application build did not produce the Worker and assets.")
        runtime = stage / "runtime"
        runtime.mkdir()
        (runtime / "runtime.mjs").write_text(RUNTIME_SOURCE, encoding="utf-8", newline="\n")
        (runtime / "node_modules").symlink_to(runtime_modules, target_is_directory=True)
        retained_migrations(project, source, stage / "migrations")
        manifest = {"sourceCommit": PIN, "applicationVersion": "0.6.1", "previousSourceCommit": PREVIOUS_PIN,
                    "archiveSha256": CONFIGURATION["archiveSha256"], "runtimeSha256": runtime_digest,
                    "schemaUnchanged": True, "nodeArchiveSha256": NODE_SHA256}
        (stage / "deployment.json").write_text(json.dumps(manifest, indent=2) + "\n")
        stage.rename(release)
        log("remote_build_verified", sourceCommit=PIN, version="0.6.1")
    data = copy_current_database(project, verify_release_migrations(project, release))
    port = int(os.environ.get("INVENTORY_PORT", "8081"))
    if not 1 <= port <= 65535:
        raise RuntimeError("The application port is invalid.")
    duration = int(remaining(7200))
    environment.update(PORT=str(port), INVENTORY_BUNDLE_ROOT=str(release), INVENTORY_DATA_ROOT=str(data),
                       INVENTORY_MAX_SECONDS=str(duration), INVENTORY_MANUAL_STOP="1" if MANUAL else "0", NODE_ENV="production")
    log("deployment_start", version="0.6.1", sourceCommit=PIN, automaticStop=not MANUAL,
        maximumRemainingSeconds=duration if not MANUAL else None)
    child = subprocess.Popen([str(node), str(release / "runtime/runtime.mjs")], cwd=release, env=environment, start_new_session=True)
    def shutdown(_signum=None, _frame=None):
        stop(child)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        child.wait(timeout=None if MANUAL else remaining(7200))
    except subprocess.TimeoutExpired:
        log("bounded_time_limit_reached")
    finally:
        stop(child)
    return child.returncode if child.returncode is not None and child.returncode >= 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        safe_message = str(error) if isinstance(error, RuntimeError) else "Inspect the retained deployment files and build log."
        print("Deployment failed: " + type(error).__name__ + ": " + safe_message, flush=True)
        sys.exit(1)
