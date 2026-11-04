// Starts the development server (with hot reload) against a private, fictional local
// database for working on the management console. It never reads work/local-access.*,
// never touches the hosted service and never reuses the ordinary development state.
//
// Usage: node scripts/start-console-dev.mjs [--port 5190] [--fresh]
// State, setup key and fictional credentials live in ignored work/qa/console-dev/.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const args = process.argv.slice(2);
let port = 5190, fresh = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--port") port = Number(args[++index]);
  else if (args[index] === "--fresh") fresh = true;
  else throw new Error("Usage: node scripts/start-console-dev.mjs [--port 5190] [--fresh]");
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a port between 1024 and 65535.");

const root = path.join(projectRoot, "work", "qa", "console-dev");
const stateDirectory = path.join(root, "state");
const secretsFile = path.join(root, "secrets.json");
const credentialsFile = path.join(root, "credentials.json");
const logFile = path.join(root, "server.log");
const exists = (file) => access(file).then(() => true, () => false);

if (fresh && await exists(root)) {
  // Keep earlier fictional state for inspection instead of deleting it.
  await rename(root, `${root}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}
await mkdir(root, { recursive: true });

let secrets;
if (await exists(secretsFile)) secrets = JSON.parse(await readFile(secretsFile, "utf8"));
else {
  secrets = { setupKey: randomBytes(32).toString("hex") };
  await writeFile(secretsFile, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
}

const wrangler = path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js");
function run(argv, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd: projectRoot, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${path.basename(argv[1])} exited with ${code}:\n${output.slice(-2000)}`)));
  });
}

const marker = path.join(root, "migrations.json");
if (!await exists(marker)) {
  const config = path.join(root, "wrangler.json");
  await writeFile(config, JSON.stringify({
    name: "console-dev-migrations",
    compatibility_date: "2026-05-15",
    d1_databases: [{ binding: "DB", database_name: "battery-inventory-d1", database_id: LOCAL_DATABASE_ID }],
  }, null, 2) + "\n");
  const journal = JSON.parse(await readFile(path.join(projectRoot, "drizzle/meta/_journal.json"), "utf8"));
  const applied = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (!/^\d{4}_[a-z0-9_]+$/i.test(entry.tag)) throw new Error("Invalid migration name in the committed journal.");
    console.log(`Applying migration ${index + 1}/${journal.entries.length}: ${entry.tag}`);
    await run([wrangler, "d1", "execute", "DB", "--local", "--config", config, "--persist-to", stateDirectory, "--file", path.join(projectRoot, "drizzle", `${entry.tag}.sql`), "--yes"], {
      CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", CI: "true", NO_COLOR: "1",
    });
    applied.push(entry.tag);
  }
  await writeFile(marker, JSON.stringify({ appliedAt: new Date().toISOString(), migrations: applied }, null, 2) + "\n");
}

const base = `http://127.0.0.1:${port}`;
console.log(`Starting the development server at ${base} (log: ${logFile})`);
const server = spawn(process.execPath, [path.join(projectRoot, "scripts/run-framework.mjs"), "dev", "--port", String(port), "--hostname", "127.0.0.1"], {
  cwd: projectRoot,
  env: { ...process.env, INVENTORY_DEV_STATE_DIR: stateDirectory, INVENTORY_SETUP_KEY: secrets.setupKey, NO_COLOR: "1" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
await writeFile(logFile, "");
const redact = (text) => String(text).split(secrets.setupKey).join("[redacted]").replace(/inventory_session=[a-f0-9]+/gi, "inventory_session=[redacted]");
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { void writeFile(logFile, redact(chunk), { flag: "a" }); });
let exited = false;
server.once("close", (code) => { exited = true; console.log(`Development server exited (${code}).`); process.exit(code ?? 1); });
const stop = () => { if (!exited) server.kill(); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);

async function request(pathname, body, cookie) {
  const response = await fetch(base + pathname, {
    method: body ? "POST" : "GET",
    redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}: ${redact(text).slice(0, 400)}`);
  return { response, body: text ? JSON.parse(text) : null };
}

let session = null;
for (const deadline = Date.now() + 180000; Date.now() < deadline && !exited;) {
  try { session = (await request("/api/session")).body; break; } catch { await delay(1000); }
}
if (!session) { stop(); throw new Error(`The development server did not answer within three minutes. See ${logFile}`); }

if (session.setupRequired) {
  const credentials = {
    admin: { username: "console-admin", password: randomBytes(18).toString("base64url") },
    staff: { username: "console-staff", password: randomBytes(18).toString("base64url") },
  };
  await request("/api/session", { action: "setup", setupKey: secrets.setupKey, payload: { ...credentials.admin, role: "admin", displayName: "Console Administrator", email: "console-admin@example.invalid", defaultDataset: "demo" } });
  const signIn = await request("/api/session", { action: "signin", payload: credentials.admin });
  const cookie = signIn.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("The fictional administrator did not receive a session cookie.");
  await request("/api/accounts", { action: "create", payload: { ...credentials.staff, role: "staff", displayName: "Console Staff", email: "console-staff@example.invalid", defaultDataset: "demo" } }, cookie);
  await request("/api/inventory", { dataset: "demo", action: "initialize_demo" }, cookie);
  await request("/api/session", { action: "signout" }, cookie);
  await writeFile(credentialsFile, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
  console.log("Created fictional administrator and staff accounts and the Demonstration inventory.");
}
console.log(`Console: ${base}/console`);
console.log(`Fictional credentials: ${credentialsFile}`);

// Local verification requests: a file work/qa/console-dev/requests/<id>.json naming one
// allowlisted check runs it here and writes results/<id>.log and results/<id>.json.
// Only these fixed project commands can run; nothing else is accepted.
const checks = {
  typecheck: ["run", "typecheck"],
  lint: ["run", "lint"],
  test: ["test"],
  build: ["run", "build"],
  compile: null,
};
const requests = path.join(root, "requests"), results = path.join(root, "results");
await mkdir(requests, { recursive: true });
await mkdir(results, { recursive: true });
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
let checking = false;
async function runCheck(id, task, testFile) {
  const log = path.join(results, `${id}.log`);
  await writeFile(log, `${task}${testFile ? ` ${testFile}` : ""} started ${new Date().toISOString()}\n`);
  const argv = task === "compile"
    ? [path.join(projectRoot, "scripts/test-domain.mjs"), "--compile-only"]
    : task === "test" && testFile ? null : [npmCli, ...checks[task]];
  const runOne = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { void writeFile(log, redact(chunk), { flag: "a" }); });
    child.once("error", (error) => resolve({ code: -1, error: error.message }));
    child.once("close", (code) => resolve({ code }));
  });
  let outcome;
  if (argv) outcome = await runOne(argv);
  else {
    outcome = await runOne([path.join(projectRoot, "scripts/test-domain.mjs"), "--compile-only"]);
    if (outcome.code === 0) outcome = await runOne(["--test", testFile]);
  }
  await writeFile(path.join(results, `${id}.json`), JSON.stringify({ id, task, testFile: testFile ?? null, ...outcome, finishedAt: new Date().toISOString() }) + "\n");
}
setInterval(async () => {
  if (checking || exited) return;
  checking = true;
  try {
    const { readdir, unlink } = await import("node:fs/promises");
    for (const name of (await readdir(requests)).filter((entry) => /^[a-z0-9-]{1,64}\.json$/.test(entry)).sort()) {
      const file = path.join(requests, name), id = name.slice(0, -5);
      let request;
      try { request = JSON.parse(await readFile(file, "utf8")); } catch { continue; }
      await unlink(file).catch(() => {});
      const testFile = typeof request.testFile === "string" && /^tests\/[a-z0-9-]+\.test\.mjs$/.test(request.testFile) ? request.testFile : undefined;
      if (!Object.hasOwn(checks, request.task)) {
        await writeFile(path.join(results, `${id}.json`), JSON.stringify({ id, rejected: "Unknown check." }) + "\n");
        continue;
      }
      await runCheck(id, request.task, testFile);
    }
  } finally { checking = false; }
}, 2000);
console.log("Press Ctrl+C to stop.");
