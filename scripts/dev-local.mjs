import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const accessFile = path.join(root, "work", "local-access.json");
let access = {};
try {
  access = JSON.parse(await readFile(accessFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!access.setupKey && !process.env.INVENTORY_SETUP_KEY) {
  access.setupKey = randomBytes(32).toString("hex");
  await mkdir(path.dirname(accessFile), { recursive: true });
  await writeFile(accessFile, JSON.stringify(access, null, 2) + "\n", { mode: 0o600 });
  console.log("Installation setup key saved in ignored work/local-access.json.");
}
process.env.INVENTORY_SETUP_KEY ??= access.setupKey;
process.env.INVENTORY_DEV_STATE_DIR ??= access.stateDirectory || ".wrangler/state";
console.log("Local inventory state: " + process.env.INVENTORY_DEV_STATE_DIR);
await import("./sites-env.mjs");
process.argv = [process.execPath, fileURLToPath(new URL("./run-framework.mjs", import.meta.url)), "dev", ...process.argv.slice(2)];
await import("./run-framework.mjs");
