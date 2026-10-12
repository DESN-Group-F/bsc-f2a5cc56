import { Miniflare, Log, LogLevel } from "miniflare";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInventoryHttpServer } from "../deploy/integration/http-gateway.mjs";
import { collectIntegrationSourceManifest, integrationFileManifest, integrationTreeFiles, manifestSha256 } from "../deploy/integration/source-manifest.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function redactText(value, secrets) {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text.replace(/inventory_session=[a-f0-9]+/gi, "inventory_session=[redacted]");
}

async function choosePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

/**
 * Start an entirely new local candidate from an immutable production-build copy.
 * request(path, init) returns a Fetch Response through the actual Node gateway;
 * it supplies the configured Host and intentionally adds no browser Origin.
 * A configured HTTPS publicOrigin exercises Worker HTTPS semantics over raw
 * loopback HTTP. It does not provide or claim TLS/device/network acceptance.
 */
export async function startIntegrationCandidate({
  publicOrigin: configuredOrigin,
  signal,
  onProgress = () => {},
} = {}) {
  const originalConfigPath = path.join(projectRoot, "dist/server/wrangler.json");
  let original;
  try {
    original = JSON.parse(await readFile(originalConfigPath, "utf8"));
    await access(path.resolve(path.dirname(originalConfigPath), original.main));
  } catch {
    throw new Error("The production Worker build is unavailable. Run npm run build before starting the integration candidate.");
  }
  const builtServer = path.dirname(originalConfigPath);
  const builtAssets = original.assets?.directory && path.resolve(builtServer, original.assets.directory);
  const main = typeof original.main === "string" ? path.relative(builtServer, path.resolve(builtServer, original.main)) : "";
  if (!builtAssets || builtAssets !== path.join(projectRoot, "dist/client") || !main || main.startsWith("..") || path.isAbsolute(main)
      || original.d1_databases?.length !== 1 || original.d1_databases[0].binding !== "DB")
    throw new Error("The integration candidate requires the built local server/client assets and one DB binding.");
  const root = path.join(projectRoot, "work/qa");
  await mkdir(root, { recursive: true });
  const runDirectory = await mkdtemp(path.join(root, "integration-"));
  const candidateName = path.basename(runDirectory).toLowerCase();
  const logPath = path.join(runDirectory, "runtime.log");
  const credentials = Object.fromEntries(["admin", "staff"].map(role => [role, {
    username: `integration-${role}`,
    password: randomBytes(24).toString("base64url"),
  }]));
  const setupKey = randomBytes(32).toString("hex");
  const secrets = [setupKey, credentials.admin.password, credentials.staff.password];
  const redact = value => redactText(value, secrets);
  await writeFile(logPath, "", { mode: 0o600 });
  class CandidateLog extends Log {
    log(message) { appendFileSync(logPath, redact(message) + "\n", { mode: 0o600 }); }
  }
  let runtime, server, listening, updatingRuntime, started = false, stopping;
  const stop = () => stopping ??= (async () => {
    signal?.removeEventListener("abort", aborted);
    // Finish owned allocation operations before closing their resources. A
    // completed stop must never leave a listener/restarted Worker appearing later.
    await Promise.allSettled([listening, updatingRuntime].filter(Boolean));
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    await runtime?.dispose();
    await writeFile(path.join(runDirectory, "stopped.json"), JSON.stringify({ candidateName, stoppedAt: new Date().toISOString(), ownedRuntimeDisposed: true }, null, 2) + "\n");
  })();
  const aborted = () => { void stop().catch(() => {}); };
  signal?.addEventListener("abort", aborted, { once: true });
  const active = () => {
    signal?.throwIfAborted();
    if (stopping) throw new Error("The integration candidate has stopped.");
  };
  try {
    active();
    onProgress("Snapshotting the production build into a fresh local integration run.");
    const serverRoot = path.join(runDirectory, "build/server"), assetRoot = path.join(runDirectory, "build/client");
    await cp(builtServer, serverRoot, { recursive: true, filter: source => path.basename(source) !== ".wrangler" });
    await cp(builtAssets, assetRoot, { recursive: true });
    const { files: sourceManifest, sourceSnapshotSha256: sourceHash } = await collectIntegrationSourceManifest(projectRoot);
    const buildManifest = await integrationFileManifest(path.join(runDirectory, "build"), await integrationTreeFiles(path.join(runDirectory, "build")));
    const buildHash = manifestSha256(JSON.stringify(buildManifest));
    const sourceBuildHash = manifestSha256(JSON.stringify({ sourceHash, buildHash }));
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    const journal = JSON.parse(await readFile(path.join(projectRoot, "drizzle/meta/_journal.json"), "utf8"));
    const migrations = [];
    const migrationRoot = path.join(runDirectory, "migrations");
    await mkdir(migrationRoot, { recursive: true });
    for (const [index, entry] of journal.entries.entries()) {
      if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error("Invalid integration migration journal order or name.");
      const bytes = await readFile(path.join(projectRoot, "drizzle", `${entry.tag}.sql`));
      await writeFile(path.join(migrationRoot, `${entry.tag}.sql`), bytes);
      migrations.push({ name: entry.tag, sha256: manifestSha256(bytes) });
    }
    await writeFile(path.join(migrationRoot, "journal.json"), JSON.stringify(journal, null, 2) + "\n");
    active();
    const port = configuredOrigin ? 0 : await choosePort();
    active();
    const publicOrigin = configuredOrigin ?? `http://127.0.0.1:${port}`;
    const identity = {
      candidateName, sourceBuildHash, applicationVersion: packageJson.version, migrations: migrations.length,
    };
    const moduleFiles = (await integrationTreeFiles(serverRoot)).filter(file => /\.m?js$/.test(file));
    active();
    moduleFiles.sort((left, right) => left === main ? -1 : right === main ? 1 : left.localeCompare(right));
    if (moduleFiles[0] !== main) throw new Error("The snapshot does not contain the declared Worker entry module.");
    const runtimeOptions = {
      host: "127.0.0.1", port: 0, cf: false,
      modules: moduleFiles.map(file => ({ type: "ESModule", path: path.join(serverRoot, file) })),
      modulesRoot: serverRoot, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
      assets: { directory: assetRoot, routerConfig: { has_user_worker: true } },
      d1Databases: { DB: `inventory-${randomUUID()}` }, d1Persist: path.join(runDirectory, "state/d1"),
      bindings: { INVENTORY_SETUP_KEY: setupKey }, cachePersist: false, liveReload: false,
      log: new CandidateLog(LogLevel.WARN),
    };
    onProgress("Starting the owned integration Worker.");
    active();
    runtime = new Miniflare(runtimeOptions);
    const db = await runtime.getD1Database("DB");
    active();
    for (const [index, migration] of migrations.entries()) {
      active();
      onProgress(`Applying isolated integration migration ${index + 1}/${migrations.length}: ${migration.name}`);
      const sql = await readFile(path.join(migrationRoot, `${migration.name}.sql`), "utf8");
      active();
      const statements = sql.split("--> statement-breakpoint").filter(value => value.trim()).map(value => db.prepare(value));
      await db.batch(statements);
    }
    active();
    const integrity = await db.prepare("PRAGMA foreign_key_check").all();
    if (integrity.results.length) throw new Error("The fresh integration schema failed its foreign-key check.");
    active();
    server = createInventoryHttpServer({
      publicOrigin,
      allowLoopbackHttp: !configuredOrigin,
      dispatchFetch: async (url, init) => {
        if (new URL(url).pathname === "/healthz") {
          if (!started) return Response.json({ error: "The integration candidate is starting." }, { status: 503 });
          return Response.json(identity);
        }
        return runtime.dispatchFetch(url, init);
      },
    });
    listening = new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    await listening;
    active();
    const listenPort = server.address().port;
    const base = `http://127.0.0.1:${listenPort}`;
    const request = (pathname, { method = "GET", body, headers = {}, ...unsupported } = {}) => new Promise((resolve, reject) => {
      active();
      if (Object.keys(unsupported).length) return reject(new Error("Use only method, body and headers with the integration request helper."));
      if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//"))
        return reject(new Error("Use an integration request path only."));
      const client = http.request({
        hostname: "127.0.0.1", port: listenPort, path: pathname, method,
        headers: { Host: new URL(publicOrigin).host, ...headers },
      }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
            else if (value !== undefined) responseHeaders.set(name, value);
          }
          resolve(new Response(method === "HEAD" || [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
        });
      });
      const disconnect = () => client.destroy(new Error("The integration request was interrupted."));
      signal?.addEventListener("abort", disconnect, { once: true });
      client.once("close", () => signal?.removeEventListener("abort", disconnect));
      client.once("error", reject);
      client.setTimeout(35_000, () => client.destroy(new Error("The integration request timed out.")));
      client.end(body);
    });
    const fixtureRequest = async (pathname, command, cookie) => {
      const response = await request(pathname, {
        method: "POST", body: JSON.stringify(command),
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      });
      if (!response.ok) throw new Error(`Integration fixture request ${pathname} returned HTTP ${response.status}.`);
      await response.clone().arrayBuffer();
      return response;
    };
    const initial = await request("/api/session");
    if (!initial.ok || (await initial.json()).setupRequired !== true) throw new Error("The integration candidate must begin with a fresh account database.");
    await fixtureRequest("/api/session", { action: "setup", setupKey, payload: {
      ...credentials.admin, role: "admin", displayName: "Integration Administrator", email: "integration-admin@example.invalid", defaultDataset: "demo",
    } });
    const signin = await fixtureRequest("/api/session", { action: "signin", payload: credentials.admin });
    const cookie = signin.headers.getSetCookie()[0]?.split(";")[0];
    if (!/^inventory_session=[a-f0-9]{64}$/.test(cookie ?? "")) throw new Error("The integration administrator did not receive a valid session cookie.");
    await fixtureRequest("/api/accounts", { action: "create", payload: {
      ...credentials.staff, role: "staff", displayName: "Integration Staff", email: "integration-staff@example.invalid", defaultDataset: "demo",
    } }, cookie);
    await fixtureRequest("/api/session", { action: "signout" }, cookie);
    // The temporary installation secret is absent from the ready Worker.
    active();
    updatingRuntime = runtime.setOptions({ ...runtimeOptions, bindings: {} });
    await updatingRuntime;
    active();
    const manifest = {
      ...identity, createdAt: new Date().toISOString(), publicOrigin, base,
      mode: "isolated-local-integration", listenerHost: "127.0.0.1", transportTls: false,
      freshDatabase: true, fixtureAccounts: ["integration-admin", "integration-staff"],
      setupSecretRemoved: true, sourceHash, buildHash, sourceFiles: sourceManifest, buildFiles: buildManifest,
      migrationFiles: migrations,
    };
    await writeFile(path.join(runDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    active();
    started = true;
    onProgress("The isolated integration candidate and fictional account fixtures are ready.");
    return { ...identity, base, publicOrigin, origin: publicOrigin, listenAddress: base, runDirectory, logPath, manifest,
      credentials, migrations, runtime, request, stop, redact };
  } catch (error) {
    let message = redact(error.message);
    try { await stop(); } catch (cleanupError) { message += ` Cleanup failed: ${redact(cleanupError.message)}`; }
    throw Object.assign(new Error(`${message} Integration diagnostics: ${runDirectory}`, { cause: error }), { runDirectory });
  }
}
