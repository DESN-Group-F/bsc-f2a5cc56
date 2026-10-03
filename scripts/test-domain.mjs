import "./sites-env.mjs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const library = path.join(root, "lib");
const outputRoot = path.join(root, "work", "qa");
process.chdir(root);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(filename)
        : /\.(?:ts|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
          ? [filename]
          : [];
    }),
  );
  return groups.flat().sort();
}

// Preserve the library graph instead of maintaining a second manual module list.
for (const filename of await sourceFiles(library)) {
  const outputFile = path.join(
    outputRoot,
    path.relative(library, filename).replace(/\.(?:ts|mts)$/, ".mjs"),
  );
  const source = await readFile(filename, "utf8");
  let compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  compiled = compiled.replace(
    /(\bfrom\s*["']|\bimport\s*\(\s*["'])([^"']+)(["'])/g,
    (match, before, specifier, after) => {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/"))
        return match;
      const original = specifier.startsWith("@/")
        ? path.join(root, specifier.slice(2))
        : path.resolve(path.dirname(filename), specifier);
      const relative = path.relative(library, original);
      const isLibrary =
        !relative.startsWith("..") && !path.isAbsolute(relative);
      const target = isLibrary
        ? path.join(
            outputRoot,
            relative.replace(/\.(?:ts|mts|mjs)$/, "") + ".mjs",
          )
        : original;
      let mapped = path
        .relative(path.dirname(outputFile), target)
        .split(path.sep)
        .join("/");
      if (!mapped.startsWith(".")) mapped = `./${mapped}`;
      return `${before}${mapped}${after}`;
    },
  );
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, compiled);
}

if (!process.argv.includes("--compile-only")) {
  const tests = (await readdir(path.join(root, "tests")))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `tests/${name}`);
  // Each D1 suite starts an actual local Worker; keep resource use bounded.
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=4", ...tests],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
