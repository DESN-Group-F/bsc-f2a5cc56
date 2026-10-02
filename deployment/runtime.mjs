import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const expectedCommit = "ddac6320daf36f677605667f329f031a10b1f813";
const root = path.resolve(process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL("./", import.meta.url)));
const dataRoot = path.resolve(process.env.INVENTORY_DATA_ROOT || path.join(root, "data-v0.5.0"));
if (dataRoot === path.resolve("/openbayes/home/battery-inventory/data")) {
  throw new Error("This release requires its independent data-v0.5.0 directory; the earlier database is retained.");
}
const bootstrap = JSON.parse(await readFile(process.env.INVENTORY_BOOTSTRAP_FILE || path.join(root, "bootstrap.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "deployment.json"), "utf8"));
if (manifest.sourceCommit !== expectedCommit || bootstrap.sourceCommit !== expectedCommit) {
  throw new Error("The deployment or private bootstrap does not match the frozen source commit.");
}
const initial = bootstrap.initialAdmin;
if (!initial || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(initial.id)
  || initial.username !== "admin" || initial.displayName !== "admin" || initial.email !== "" || initial.role !== "admin"
  || initial.defaultDataset !== "demo" || initial.hashIterations !== 600000
  || !/^[a-f0-9]{64}$/.test(initial.passwordHash) || !/^[a-f0-9]{64}$/.test(initial.passwordSalt)) {
  throw new Error("The private native administrator bootstrap is invalid.");
}
await mkdir(dataRoot, { recursive: true, mode: 0o700 });
const serverRoot = path.join(root, "dist/server");
const files = (await readdir(serverRoot, { recursive: true })).filter(file => /\.m?js$/.test(file));
files.sort((left, right) => left === "index.js" ? -1 : right === "index.js" ? 1 : left.localeCompare(right));
const runtime = new Miniflare({
  host: "127.0.0.1", port: 0, cf: false,
  modules: files.map(file => ({ type: "ESModule", path: path.join(serverRoot, file) })), modulesRoot: serverRoot,
  compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
  assets: { directory: path.join(root, "dist/client"), routerConfig: { has_user_worker: true } },
  d1Databases: { DB: "battery-inventory-portable" }, d1Persist: path.join(dataRoot, "d1"),
  cachePersist: false, liveReload: false,
});

try {
  const db = await runtime.getD1Database("DB");
  await db.prepare("CREATE TABLE IF NOT EXISTS portable_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)").run();
  const journal = JSON.parse(await readFile(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
  for (const entry of journal.entries) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error("Invalid migration journal entry.");
    const sql = await readFile(path.join(root, `drizzle/${entry.tag}.sql`), "utf8");
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

  // This matches the native first-account transaction, with no profile or password update on restart.
  let initialized = false;
  if (Number(await db.prepare("SELECT COUNT(*) FROM staff_accounts").first("COUNT(*)")) === 0) {
    const at = new Date().toISOString();
    const details = JSON.stringify({ username: initial.username, role: initial.role, displayName: initial.displayName, email: initial.email });
    try {
      await db.batch([
        db.prepare("INSERT INTO staff_account_events(id,action,actor_id,actor_name,target_id,at,details_json,guard) SELECT ?,'administrator_initialized',?,?,?,?,?,((SELECT COUNT(*) FROM staff_accounts)=0)")
          .bind(crypto.randomUUID(), initial.id, initial.displayName, initial.id, at, details),
        db.prepare("INSERT INTO staff_accounts(id,username,display_name,email,role,password_hash,password_salt,hash_iterations,default_dataset,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
          .bind(initial.id, initial.username, initial.displayName, initial.email, initial.role, initial.passwordHash, initial.passwordSalt, initial.hashIterations, initial.defaultDataset, at, at),
      ]);
      initialized = true;
    } catch (error) {
      // A concurrent successful setup is accepted; its existing identity remains authoritative.
      if (Number(await db.prepare("SELECT COUNT(*) FROM staff_accounts").first("COUNT(*)")) === 0) throw error;
    }
  }

  const localMode = process.env.INVENTORY_LOCAL_TEST === "1";
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
        return sendJson(res, 200, { status: "ok", version: "0.5.0", sourceCommit: expectedCommit });
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
  console.log(JSON.stringify({ event: "inventory_ready", version: "0.5.0", sourceCommit: expectedCommit, port: server.address().port, migrations: journal.entries.length, dataDirectory: dataRoot, administratorInitialized: initialized, nativeStaffAuthentication: true, automaticStop: !manualStop }));
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    console.log("Stopping inventory and preserving its independent database.");
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
