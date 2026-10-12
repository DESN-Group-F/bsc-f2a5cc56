import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceDirectories = ["app", "components", "hooks", "db", "lib", "styles", "drizzle", "public", "build", "scripts", "deploy/integration"];
const sourceFiles = [
  "package.json", "package-lock.json", "vite.config.ts", "next.config.ts", "tsconfig.json",
  "postcss.config.mjs", "drizzle.config.ts", ".openai/hosting.json",
];

export const manifestSha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const ordered = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export async function integrationTreeFiles(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Integration snapshots cannot include symbolic links.");
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await integrationTreeFiles(root, name));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort(ordered);
}

export async function integrationFileManifest(root, files) {
  const entries = [];
  for (const file of [...new Set(files)]) {
    const bytes = await readFile(path.join(root, file));
    entries.push({ path: file.split(path.sep).join("/"), bytes: bytes.length, sha256: manifestSha256(bytes) });
  }
  return entries.sort((left, right) => ordered(left.path, right.path));
}

/** Hash the selected application/build inputs; no environment or access files. */
export async function collectIntegrationSourceManifest(sourceRoot) {
  const root = path.resolve(sourceRoot), selected = [...sourceFiles];
  for (const directory of sourceDirectories) {
    try { selected.push(...(await integrationTreeFiles(path.join(root, directory))).map(file => path.join(directory, file))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const files = await integrationFileManifest(root, selected);
  return { sourceRoot: root, files, sourceSnapshotSha256: manifestSha256(JSON.stringify(files)) };
}
