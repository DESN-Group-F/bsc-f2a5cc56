import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("../../hooks/use-download-feedback.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

// Bind the actual shared hook to the component tests' inert React boundary.
export function bindDownloadFeedback(hooks) {
  return new Function("useEffect", "useRef", "useState", `${source}\nreturn useDownloadFeedback;`)(hooks.useEffect, hooks.useRef, hooks.useState);
}
