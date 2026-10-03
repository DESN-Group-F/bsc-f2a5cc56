import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wrangler = path.join(
  projectRoot,
  "node_modules/wrangler/bin/wrangler.js",
);
const builtConfig = path.join(projectRoot, "dist/server/wrangler.json");

function redactText(value, secrets) {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text.replace(
    /inventory_session=[a-f0-9]+/gi,
    "inventory_session=[redacted]",
  );
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function processExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Stop only a process started by this module and its own descendants. */
async function stopOwnedProcess(child, exited) {
  if (!child.pid || processExited(child)) {
    await exited;
    return;
  }
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    if (
      !(await Promise.race([
        exited.then(() => true),
        delay(3000).then(() => false),
      ]))
    ) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  if (
    !(await Promise.race([
      exited.then(() => true),
      delay(5000).then(() => false),
    ]))
  ) {
    throw new Error(`The isolated worker process ${child.pid} did not stop.`);
  }
}

/**
 * Start the existing production build against an entirely new local database.
 * This never reads local-access files or adopts an existing preview process.
 * The caller owns the returned stop() and must await it in finally.
 */
export async function startIsolatedPreview({
  signal,
  onProgress = () => {},
  credentials: suppliedCredentials,
} = {}) {
  const credentials = Object.fromEntries(
    ["admin", "staff"].map((role) => {
      const account = suppliedCredentials?.[role] ?? {
        username: `api-${role}`,
        password: randomBytes(24).toString("base64url"),
      };
      if (
        typeof account.username !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(account.username) ||
        typeof account.password !== "string" ||
        account.password.length < 12 ||
        account.password.length > 128
      ) {
        throw new Error(`Invalid isolated ${role} credentials.`);
      }
      return [role, { username: account.username, password: account.password }];
    }),
  );
  if (credentials.admin.username === credentials.staff.username)
    throw new Error("Isolated administrator and staff usernames must differ.");
  let original;
  try {
    original = JSON.parse(await readFile(builtConfig, "utf8"));
    await access(path.resolve(path.dirname(builtConfig), original.main));
    await access(wrangler);
  } catch {
    throw new Error(
      "The production Worker build is unavailable. Run npm run build before the isolated API checks.",
    );
  }
  if (
    !original.assets?.directory ||
    original.d1_databases?.length !== 1 ||
    original.d1_databases[0].binding !== "DB"
  ) {
    throw new Error(
      "The isolated API runner requires the built assets and one DB binding.",
    );
  }
  const root = path.join(projectRoot, "work/qa");
  await mkdir(root, { recursive: true });
  const runDirectory = await mkdtemp(path.join(root, "api-"));
  const stateDirectory = path.join(runDirectory, "state");
  const configPath = path.join(runDirectory, "wrangler.json");
  const logPath = path.join(runDirectory, "worker.log");
  const migrationLogPath = path.join(runDirectory, "migrations.log");
  const setupKey = randomBytes(32).toString("hex");
  const secrets = [
    setupKey,
    credentials.admin.password,
    credentials.staff.password,
  ];
  const redact = (value) => redactText(value, secrets);
  const children = new Map();
  const stoppingChildren = new WeakMap();
  const stopChild = (child, exited) => {
    if (!stoppingChildren.has(child))
      stoppingChildren.set(child, stopOwnedProcess(child, exited));
    return stoppingChildren.get(child);
  };
  let stopped = false;
  let stopping;
  const stop = () =>
    (stopping ??= (async () => {
      stopped = true;
      signal?.removeEventListener("abort", abort);
      const outcomes = await Promise.allSettled(
        [...children].map(([child, exited]) => stopChild(child, exited)),
      );
      // The installation secret is no longer needed after the owned process exits.
      try {
        const saved = JSON.parse(await readFile(configPath, "utf8"));
        saved.vars = {};
        await writeFile(configPath, JSON.stringify(saved, null, 2) + "\n", {
          mode: 0o600,
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure) throw failure.reason;
    })());
  const abort = () => {
    void stop().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const checkActive = () => {
    signal?.throwIfAborted();
    if (stopped) throw new Error("The isolated preview was stopped.");
  };
  const environment = {
    ...process.env,
    CLOUDFLARE_CF_FETCH_ENABLED: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_SEND_ERROR_REPORTS: "false",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: path.join(runDirectory, "runtime/logs"),
    WRANGLER_REGISTRY_PATH: path.join(runDirectory, "runtime/dev-registry"),
    MINIFLARE_REGISTRY_PATH: path.join(runDirectory, "runtime/registry"),
    INVENTORY_SETUP_KEY: setupKey,
    NO_COLOR: "1",
    CI: "true",
  };
  delete environment.WRANGLER_ENV;
  delete environment.CLOUDFLARE_API_TOKEN;
  delete environment.CLOUDFLARE_API_KEY;
  const launch = (args, outputPath) => {
    checkActive();
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: runDirectory,
      env: environment,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Redact whole lines, including values split across stream chunks.
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines)
          appendFileSync(outputPath, redact(line) + "\n", { mode: 0o600 });
      });
      stream.on("end", () => {
        if (pending)
          appendFileSync(outputPath, redact(pending), { mode: 0o600 });
      });
    }
    const exited = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    children.set(child, exited);
    return { child, exited };
  };
  const command = async (args, label) => {
    const { child, exited } = launch(args, migrationLogPath);
    let timeout;
    try {
      const result = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} timed out.`)),
            90000,
          );
        }),
      ]);
      checkActive();
      if (result.error || result.code !== 0)
        throw new Error(
          `${label} failed${result.error ? `: ${redact(result.error.message)}` : ""}. See ${migrationLogPath}`,
        );
    } finally {
      clearTimeout(timeout);
      await stopChild(child, exited);
      children.delete(child);
    }
  };
  try {
    checkActive();
    // Wrangler watches module and asset directories. Use an immutable build copy
    // so another local build cannot restart the Worker during a write assertion.
    const serverDirectory = path.join(runDirectory, "build/server");
    const assetDirectory = path.join(runDirectory, "build/client");
    await cp(path.dirname(builtConfig), serverDirectory, {
      recursive: true,
      filter: (source) => path.basename(source) !== ".wrangler",
    });
    await cp(
      path.resolve(path.dirname(builtConfig), original.assets.directory),
      assetDirectory,
      { recursive: true },
    );
    checkActive();
    const port = await availablePort();
    let inspectorPort = await availablePort();
    while (inspectorPort === port) inspectorPort = await availablePort();
    const base = `http://127.0.0.1:${port}`;
    const runName = path.basename(runDirectory).toLowerCase();
    const config = {
      ...original,
      name: `inventory-api-${runName}`,
      topLevelName: `inventory-api-${runName}`,
      main: path.resolve(serverDirectory, original.main),
      assets: {
        ...original.assets,
        directory: assetDirectory,
      },
      vars: { INVENTORY_SETUP_KEY: setupKey },
      dev: {
        ...original.dev,
        ip: "127.0.0.1",
        port,
        inspector_port: inspectorPort,
        enable_containers: false,
      },
      d1_databases: [
        {
          ...original.d1_databases[0],
          database_id: randomUUID(),
          database_name: `inventory-${runName}`,
          remote: false,
        },
      ],
    };
    delete config.build;
    await mkdir(path.join(runDirectory, "runtime"), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    await writeFile(logPath, "", { mode: 0o600 });
    await writeFile(migrationLogPath, "", { mode: 0o600 });
    const journal = JSON.parse(
      await readFile(
        path.join(projectRoot, "drizzle/meta/_journal.json"),
        "utf8",
      ),
    );
    const migrations = [];
    for (const [index, entry] of journal.entries.entries()) {
      if (!/^\d{4}_[a-z0-9_]+$/i.test(entry.tag))
        throw new Error("Invalid migration name in the committed journal.");
      const file = path.join(projectRoot, "drizzle", `${entry.tag}.sql`);
      const sql = await readFile(file);
      onProgress(
        `Applying isolated migration ${index + 1}/${journal.entries.length}: ${entry.tag}`,
      );
      await command(
        [
          "d1",
          "execute",
          "DB",
          "--local",
          "--config",
          configPath,
          "--persist-to",
          stateDirectory,
          "--file",
          file,
          "--yes",
          "--json",
        ],
        entry.tag,
      );
      migrations.push({
        name: entry.tag,
        sha256: createHash("sha256").update(sql).digest("hex"),
      });
    }
    await writeFile(
      path.join(runDirectory, "migrations.json"),
      JSON.stringify(migrations, null, 2) + "\n",
    );
    onProgress("Starting the isolated production Worker.");
    const worker = launch(
      [
        "dev",
        "--local",
        "--config",
        configPath,
        "--persist-to",
        stateDirectory,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--inspector-port",
        String(inspectorPort),
      ],
      logPath,
    );
    await writeFile(
      path.join(runDirectory, "preview.json"),
      JSON.stringify(
        {
          base,
          stateDirectory,
          workerPid: worker.child.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    const request = async (pathname, body, cookie) => {
      checkActive();
      const response = await fetch(base + pathname, {
        method: body ? "POST" : "GET",
        redirect: "manual",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any([
          AbortSignal.timeout(20000),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok)
        throw new Error(
          `Isolated fixture request ${pathname} returned HTTP ${response.status}. See ${logPath}`,
        );
      await response.clone().arrayBuffer();
      return response;
    };
    let ready = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      checkActive();
      if (!worker.child.pid || processExited(worker.child))
        throw new Error(
          `The isolated Worker exited before becoming ready. See ${logPath}`,
        );
      try {
        const response = await fetch(base + "/api/session", {
          redirect: "manual",
          signal: AbortSignal.any([
            AbortSignal.timeout(1000),
            ...(signal ? [signal] : []),
          ]),
        });
        if (response.ok && (await response.json()).setupRequired === true) {
          ready = true;
          break;
        }
      } catch {
        checkActive();
      }
      await delay(250, undefined, { signal });
    }
    if (!ready)
      throw new Error(
        `The isolated Worker did not become ready within 60 seconds. See ${logPath}`,
      );
    await request("/api/session", {
      action: "setup",
      setupKey,
      payload: {
        ...credentials.admin,
        role: "admin",
        displayName: "API Administrator",
        email: "api-admin@example.invalid",
        defaultDataset: "demo",
      },
    });
    const signIn = await request("/api/session", {
      action: "signin",
      payload: credentials.admin,
    });
    const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
    if (!cookie)
      throw new Error(
        "The isolated administrator did not receive a session cookie.",
      );
    await request(
      "/api/accounts",
      {
        action: "create",
        payload: {
          ...credentials.staff,
          role: "staff",
          displayName: "API Staff",
          email: "api-staff@example.invalid",
          defaultDataset: "demo",
        },
      },
      cookie,
    );
    await request("/api/session", { action: "signout" }, cookie);
    onProgress("Isolated administrator and staff fixtures are ready.");
    return {
      base,
      credentials,
      runDirectory,
      logPath,
      migrationLogPath,
      migrations,
      stop,
      redact,
    };
  } catch (error) {
    let message = redact(error.message);
    try {
      await stop();
    } catch (cleanupError) {
      message += `\nCleanup failed: ${redact(cleanupError.message)}`;
    }
    throw Object.assign(
      new Error(`${message}\nIsolated diagnostics: ${runDirectory}`, {
        cause: error,
      }),
      { runDirectory },
    );
  }
}
