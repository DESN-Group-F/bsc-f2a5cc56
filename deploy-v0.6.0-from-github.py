"""Build a pinned GitHub source and upgrade a copy of the retained native database."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import uuid

CONFIGURATION = json.loads(r'''{"sourceCommit": "c563823e42832fda1873c9d9f75acb88c8ed2fd0", "archiveUrl": "https://codeload.github.com/DESN-Group-F/bsc-f2a5cc56/legacy.tar.gz/c563823e42832fda1873c9d9f75acb88c8ed2fd0", "archiveSha256": "ef97fdf02f63d36265fdcd2f15c4f0e6c6122a48518d4152514eed6051c365b8", "archiveSizeBytes": 1076919}''')
RUNTIME_SOURCE = r'''import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, rename } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const expectedCommit = "c563823e42832fda1873c9d9f75acb88c8ed2fd0";
const root = path.resolve(process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL("./", import.meta.url)));
const dataRoot = path.resolve(process.env.INVENTORY_DATA_ROOT || "");
const localMode = process.env.INVENTORY_LOCAL_TEST === "1";
if (!process.env.INVENTORY_DATA_ROOT || path.basename(dataRoot) !== "data-v0.6.0"
  || (!localMode && dataRoot !== "/openbayes/home/battery-inventory/data-v0.6.0")) {
  throw new Error("The verified data-v0.6.0 upgrade copy is required.");
}
const manifest = JSON.parse(await readFile(path.join(root, "deployment.json"), "utf8"));
if (manifest.sourceCommit !== expectedCommit || manifest.applicationVersion !== "0.6.0") {
  throw new Error("The deployment does not match the frozen source commit.");
}
const upgrade = JSON.parse(await readFile(path.join(dataRoot, "upgrade-source.json"), "utf8"));
if (upgrade.sourceCommit !== expectedCommit || upgrade.fromVersion !== "0.5.0") {
  throw new Error("A verified existing-data upgrade receipt is required.");
}
const sqliteFiles = (await readdir(path.join(dataRoot, "d1"), { recursive: true }))
  .filter(file => file.endsWith(".sqlite") && path.basename(file) !== "metadata.sqlite");
if (sqliteFiles.length !== 1) throw new Error("Exactly one existing inventory database is required.");
const saved = new DatabaseSync(path.join(dataRoot, "d1", sqliteFiles[0]), { readOnly: true });
let beforeCounts;
try {
  if (saved.prepare("PRAGMA quick_check").get().quick_check !== "ok"
    || saved.prepare("SELECT COUNT(*) AS count FROM staff_accounts").get().count < 1
    || saved.prepare("SELECT COUNT(*) AS count FROM portable_migrations").get().count < 10) {
    throw new Error("Existing native accounts and migration receipts are required before upgrading.");
  }
  beforeCounts = Object.fromEntries(saved.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_METADATA','portable_migrations') ORDER BY name").all()
    .map(({ name }) => [name, saved.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count]));
} finally { saved.close(); }
const sourceRoot = path.join(root, "source");
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
  if (Number(await db.prepare("SELECT COUNT(*) FROM staff_accounts").first("COUNT(*)")) < 1) throw new Error("The Worker database has no existing accounts; refusing replacement.");
  const journal = JSON.parse(await readFile(path.join(sourceRoot, "drizzle/meta/_journal.json"), "utf8"));
  if (journal.entries.length !== 16) throw new Error("The frozen release requires sixteen migrations.");
  for (const entry of journal.entries) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error("Invalid migration journal entry.");
    const sql = await readFile(path.join(sourceRoot, `drizzle/${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const previous = await db.prepare("SELECT sha256 FROM portable_migrations WHERE name=?").bind(entry.tag).first();
    if (previous) {
      if (previous.sha256 !== hash) throw new Error(`Applied migration changed: ${entry.tag}`);
      continue;
    }
    const statements = sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement));
    statements.push(db.prepare("INSERT INTO portable_migrations(name,sha256,applied_at) VALUES(?,?,?)").bind(entry.tag, hash, new Date().toISOString()));
    await db.batch(statements);
  }

  for (const [name, count] of Object.entries(beforeCounts)) {
    const after = Number(await db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).first("count"));
    if (after !== count) throw new Error(`Upgrade changed the row count in ${name}.`);
  }
  if ((await db.prepare("PRAGMA foreign_key_check").all()).results.length) throw new Error("Foreign-key validation failed after upgrade.");
  const receipt = { sourceCommit: expectedCommit, version: "0.6.0", migrations: journal.entries.map(entry => entry.tag), counts: beforeCounts, verifiedAt: new Date().toISOString() };
  const complete = path.join(dataRoot, "upgrade-complete.json");
  await writeFile(complete + ".tmp", JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  await rename(complete + ".tmp", complete);
  console.log(JSON.stringify({ event: "database_upgrade_verified", migrations: 16, preservedTableCounts: beforeCounts }));

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
        return sendJson(res, 200, { status: "ok", version: "0.6.0", sourceCommit: expectedCommit });
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
  console.log(JSON.stringify({ event: "inventory_ready", version: "0.6.0", sourceCommit: expectedCommit, port: server.address().port, migrations: journal.entries.length, dataDirectory: dataRoot, existingAccountsPreserved: true, nativeStaffAuthentication: true, automaticStop: !manualStop }));
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    console.log("Stopping inventory and preserving its upgraded database.");
    server.close(); server.closeIdleConnections();
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
PIN = "c563823e42832fda1873c9d9f75acb88c8ed2fd0"
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
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()


def frozen_receipts(source):
    journal = json.loads((source / "drizzle/meta/_journal.json").read_text())["entries"]
    if len(journal) != 16:
        raise RuntimeError("The frozen source requires sixteen migrations.")
    return {entry["tag"]: sha256(source / "drizzle" / (entry["tag"] + ".sql")) for entry in journal}


def database_file(data):
    candidates = [file for file in (data / "d1").rglob("*.sqlite") if file.name != "metadata.sqlite"]
    if len(candidates) != 1:
        raise RuntimeError("Exactly one retained native inventory database is required.")
    return candidates[0]


def inspect_database(file, expected, required_count):
    connection = sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)] or connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("The retained database failed integrity checks.")
        if connection.execute("SELECT COUNT(*) FROM staff_accounts").fetchone()[0] < 1:
            raise RuntimeError("The retained database must already contain native staff accounts.")
        receipts = dict(connection.execute("SELECT name,sha256 FROM portable_migrations ORDER BY name"))
        if len(receipts) != required_count or any(expected.get(name) != digest for name, digest in receipts.items()):
            raise RuntimeError("Saved migration receipts do not match the frozen source.")
        if list(receipts) != list(expected)[:required_count]:
            raise RuntimeError("Saved migrations are not a complete journal prefix.")
        names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_METADATA','portable_migrations') ORDER BY name")]
        counts = {name: connection.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in names}
        return counts
    finally:
        connection.close()


def upgrade_copy(project, source):
    original, upgraded = project / "data-v0.5.0", project / "data-v0.6.0"
    expected = frozen_receipts(source)
    if upgraded.exists():
        marker = upgraded / "upgrade-complete.json"
        if not marker.is_file() or json.loads(marker.read_text()).get("sourceCommit") != PIN:
            raise RuntimeError("An incomplete upgrade copy exists; it requires review and will not be reset.")
        counts = inspect_database(database_file(upgraded), expected, 16)
        log("saved_upgrade_verified", migrationCount=16, tableCounts=counts)
        return upgraded
    original_file = database_file(original)
    before = inspect_database(original_file, expected, 10)
    pending = project / (".data-v0.6.0-copy-" + str(uuid.uuid4()))
    pending.mkdir(mode=0o700)
    destination = pending / original_file.relative_to(original)
    destination.parent.mkdir(parents=True)
    readonly = sqlite3.connect(original_file.resolve().as_uri() + "?mode=ro", uri=True)
    copied = sqlite3.connect(destination)
    try:
        readonly.backup(copied)
    finally:
        copied.close()
        readonly.close()
    after = inspect_database(destination, expected, 10)
    if before != after:
        raise RuntimeError("The database backup did not preserve table counts.")
    receipt = {"sourceCommit": PIN, "fromVersion": "0.5.0", "originalRelativePath": str(original_file.relative_to(project)), "originalPreserved": True, "counts": before}
    (pending / "upgrade-source.json").write_text(json.dumps(receipt, indent=2) + "\n")
    pending.rename(upgraded)
    log("database_copy_verified", migrationCount=10, originalRetained=True, tableCounts=before)
    return upgraded


def main():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Linux x86_64 is required.")
    if CONFIGURATION.get("sourceCommit") != PIN or len(CONFIGURATION.get("archiveSha256", "")) != 64:
        raise RuntimeError("The private download configuration does not match the frozen source.")
    if not RUNTIME_SOURCE.startswith('import { Miniflare }') or PIN not in RUNTIME_SOURCE:
        raise RuntimeError("The verified native runtime is missing.")
    project = Path("/openbayes/home/battery-inventory")
    old_release = project / "releases/0.5.0"
    runtime_modules = old_release / "node_modules"
    runtime_package = json.loads((runtime_modules / "miniflare/package.json").read_text())
    if runtime_package.get("version") != "4.20260515.0":
        raise RuntimeError("Restore the verified v0.5.0 saved home before upgrading.")
    if shutil.disk_usage(project).free < 5 * 1024**3:
        raise RuntimeError("At least five GiB of free deployment space is required.")
    release = project / "releases/0.6.0"
    runtime_digest = hashlib.sha256(RUNTIME_SOURCE.encode()).hexdigest()
    stage = None
    if release.exists():
        manifest = json.loads((release / "deployment.json").read_text())
        if manifest.get("sourceCommit") != PIN or manifest.get("archiveSha256") != CONFIGURATION["archiveSha256"] or manifest.get("runtimeSha256") != runtime_digest or sha256(release / "runtime/runtime.mjs") != runtime_digest or not (release / "source/dist/server/index.js").is_file():
            raise RuntimeError("The saved release is incomplete or does not match this deployment.")
    else:
        stage = project / "releases" / (".0.6.0-build-" + str(uuid.uuid4()))
        stage.mkdir()
        source = stage / "source"
        source.mkdir()
        archive = stage / "frozen-source.tar.gz"
        download(CONFIGURATION["archiveUrl"], archive, CONFIGURATION["archiveSha256"], "codeload.github.com", 30 * 1024 * 1024)
        extract_source(archive, source)
        if json.loads((source / "package.json").read_text()).get("version") != "0.6.0":
            raise RuntimeError("The archive has the wrong application version.")
        frozen_receipts(source)
    # Consume the short-lived private source link before downloading the Node toolchain.
    node = install_node(project)
    environment = dict(os.environ, PATH=str(node.parent) + os.pathsep + os.environ.get("PATH", ""),
                       CI="true", SHARP_IGNORE_GLOBAL_LIBVIPS="1", NODE_OPTIONS="--max-old-space-size=2560",
                       CLOUDFLARE_CF_FETCH_ENABLED="false", WRANGLER_SEND_METRICS="false", WRANGLER_WRITE_LOGS="false")
    if stage is not None:
        build_log = stage / "build.log"
        npm = node.parent.parent / "lib/node_modules/npm/bin/npm-cli.js"
        log("remote_install_started", sourceCommit=PIN)
        run([str(node), str(npm), "ci", "--include=dev", "--include=optional", "--no-audit", "--no-fund"], source, environment, build_log, 1800)
        log("remote_build_started", sourceCommit=PIN)
        run([str(node), str(npm), "run", "build"], source, environment, build_log, 1200)
        if not (source / "dist/server/index.js").is_file() or not (source / "dist/client").is_dir():
            raise RuntimeError("The frozen source build did not produce the Worker and assets.")
        runtime = stage / "runtime"
        runtime.mkdir()
        (runtime / "runtime.mjs").write_text(RUNTIME_SOURCE, encoding="utf-8", newline="\n")
        (runtime / "node_modules").symlink_to(runtime_modules, target_is_directory=True)
        manifest = {"sourceCommit": PIN, "applicationVersion": "0.6.0", "archiveSha256": CONFIGURATION["archiveSha256"], "runtimeSha256": runtime_digest, "nodeArchiveSha256": NODE_SHA256}
        (stage / "deployment.json").write_text(json.dumps(manifest, indent=2) + "\n")
        stage.rename(release)
        log("remote_build_verified", sourceCommit=PIN, version="0.6.0")
    data = upgrade_copy(project, release / "source")
    port = int(os.environ.get("INVENTORY_PORT", "8081"))
    if not 1 <= port <= 65535:
        raise RuntimeError("The application port is invalid.")
    duration = int(remaining(7200))
    environment.update(PORT=str(port), INVENTORY_BUNDLE_ROOT=str(release), INVENTORY_DATA_ROOT=str(data),
                       INVENTORY_MAX_SECONDS=str(duration), INVENTORY_MANUAL_STOP="1" if MANUAL else "0", NODE_ENV="production")
    log("deployment_start", version="0.6.0", sourceCommit=PIN, automaticStop=not MANUAL, maximumRemainingSeconds=duration if not MANUAL else None)
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
        # Private archive URLs and authentication material must never enter logs.
        safe_message = str(error) if isinstance(error, RuntimeError) else "Inspect the retained deployment files and build log."
        print("Deployment failed: " + type(error).__name__ + ": " + safe_message, flush=True)
        sys.exit(1)
