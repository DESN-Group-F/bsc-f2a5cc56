import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const ts = createRequire(path.join(root, "mobile/package.json"))("typescript");
const postcss = createRequire(path.join(root, "mobile/package.json"))("postcss");
const target = path.join(root, "mobile/src/shared");
const exists = (file) => access(file).then(() => true, () => false);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const entries = ["app/inventory-app.tsx", "app/globals.css", "lib/mobile-registration-session.ts"];
const files = new Map();
const external = new Set();
const adapters = {
  "lib/client-utils.ts": "../../platform/shared-client-utils.js",
};
async function resolveLocal(specifier, from) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith("@styles/")) base = path.join(root, "styles", specifier.slice(8));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  if (!base.startsWith(root)) throw new Error("A frontend import escaped the project.");
  for (const candidate of [base, ...[".ts", ".tsx", ".js", ".mjs", ".css", "/index.ts", "/index.tsx"].map((ext) => base + ext)]) {
    if (await exists(candidate) && path.extname(candidate)) return candidate;
  }
  throw new Error(`Frontend import not found: ${specifier}`);
}
async function collect(filename) {
  const relative = path.relative(root, filename).replaceAll("\\", "/");
  if (files.has(relative)) return;
  if (/^(db|lib\/server|app\/api)\//.test(relative)) throw new Error(`Server module cannot enter the mobile bundle: ${relative}`);
  const source = await readFile(filename, "utf8");
  const css = filename.endsWith(".css");
  let output = css ? source : ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: filename }).outputText;
  const destination = relative.replace(/\.tsx?$/, ".js");
  files.set(relative, { path: destination, sourceSha256: digest(source) });
  const imports = css ? [...source.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1])
    : ts.preProcessFile(output, true, true).importedFiles.map((entry) => entry.fileName);
  for (const specifier of imports) {
    const local = await resolveLocal(specifier, filename);
    if (!local) {
      if (/^(cloudflare:|node:|next\/)/.test(specifier)) throw new Error(`Unsupported mobile runtime dependency: ${specifier}`);
      external.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
      continue;
    }
    await collect(local);
    let replacement = path.relative(path.dirname(path.join(target, destination)), path.join(target, path.relative(root, local))).replaceAll("\\", "/").replace(/\.tsx?$/, ".js");
    if (!replacement.startsWith(".")) replacement = "./" + replacement;
    output = output.replaceAll(`"${specifier}"`, `"${replacement}"`).replaceAll(`'${specifier}'`, `'${replacement}'`);
  }
  if (adapters[relative]) {
    if (relative === "lib/client-utils.ts") {
      output = output.replace("export function reloadSessionPage(destination) {", "export function reloadSessionPage(destination) {\n    window.dispatchEvent(new CustomEvent('battery-mobile-session', {detail: destination})); return; ");
      output = output.replace("function saveDownloadAttachment(attachment) {", "async function saveDownloadAttachment(attachment) {\n    if (window.__batteryMobileSaveFile) return await window.__batteryMobileSaveFile(attachment); ");
      output = output.replace("saveDownloadAttachment(await requestExportAttachment", "await saveDownloadAttachment(await requestExportAttachment").replace("    saveDownloadAttachment(attachment);", "    await saveDownloadAttachment(attachment);");
    }
  }
  if (!css) output = output.replace(/\bsessionStorage\b/g, "window.__batteryWorkflowStorage");
  if (!css) output = output.replaceAll('Browser recovery storage', 'Device recovery storage').replaceAll('remains in this tab', 'is retained on this device');
  if (relative === 'app/inventory-app.tsx') {
    const anchor = 'const [exportDraft, setExportDraft] = useState(null);';
    if (!output.includes(anchor)) throw new Error('Review the updated inventory refresh adapter.');
    output = output.replace(anchor, `useEffect(() => { const refresh = () => { void load(dataset).catch(error => setError(error.message)); }; window.addEventListener('battery-mobile-inventory-refresh', refresh); return () => window.removeEventListener('battery-mobile-inventory-refresh', refresh); }, [dataset, load, setError]);\n    ${anchor}`);
  }
  if (relative === "components/inventory/scan-station.tsx") {
    output = 'import { NfcReadButton } from "../../../business/nfc-read.jsx";\n' + output;
    const anchor = '_jsx(Button, { onClick: () => readTags([tag], "manual")';
    if (!output.includes(anchor)) throw new Error("Review the updated scan station before adding its native adapter.");
    output = output.replace(anchor, '_jsx(NfcReadButton, { disabled: locked || data.dataset !== "demo", onIdentity: setTag }), ' + anchor);
  }
  if (relative === "components/inventory/record-editor.tsx") {
    if (!output.includes('export function RecordEditor(')) throw new Error('Review the updated registration entry point before adapting it.');
    output = 'import { MobileRegistrationDialog } from "../../../business/registration.jsx";\n' + output.replace('export function RecordEditor(', 'function LegacyRecordEditor(');
    output += '\nexport function RecordEditor(props) { if (props.draft.kind === "battery" && !props.draft.record) return _jsx(MobileRegistrationDialog, {data:props.data, initialTagId:props.draft.initialTagId, onClose:props.onClose}); return _jsx(LegacyRecordEditor, {...props}); }\n';
  }
  const station = { 'components/inventory/scan-station.tsx':'ScanStation', 'components/inventory/intake-station.tsx':'IntakeStation', 'components/inventory/removal-station.tsx':'RemovalStation' }[relative];
  if (station) {
    if (!output.includes(`export function ${station}(`)) throw new Error('Review the updated workflow before adapting its navigation boundary.');
    output = 'import { WorkflowBoundary } from "../../../business/workflow-boundary.jsx";\n' + output.replace(`export function ${station}(`, `function Shared${station}(`);
    output += `\nexport function ${station}(props) { return _jsx(WorkflowBoundary, {children:_jsx(Shared${station}, {...props})}); }\n`;
  }
  const outputFile = path.join(target, destination);
  await mkdir(path.dirname(outputFile), { recursive: true });
  if (!await exists(outputFile) || await readFile(outputFile, "utf8") !== output) await writeFile(outputFile, output);
  files.get(relative).sha256 = digest(output);
}

if (!await exists(path.join(root, entries[0]))) {
  const manifest = JSON.parse(await readFile(path.join(target, "source-manifest.json"), "utf8"));
  for (const entry of manifest.files) if (digest(await readFile(path.join(target, entry.path))) !== entry.sha256) throw new Error(`Mobile frontend snapshot mismatch: ${entry.path}`);
  console.log("Bundled frontend snapshot verified.");
} else {
  for (const entry of entries) await collect(path.join(root, entry));
  const manifest = { schemaVersion: 1, entries, externalPackages: [...external].sort(), files: [...files.entries()].map(([source, record]) => ({ source, ...record })).sort((a, b) => a.path.localeCompare(b.path)) };
  await writeFile(path.join(target, "source-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Frontend snapshot synchronized: ${files.size} files. Packages: ${manifest.externalPackages.join(", ")}`);
}
const diagnosticCss = postcss.parse(await readFile(path.join(root, "mobile/src/styles.css"), "utf8"));
diagnosticCss.walkRules((rule) => {
  if (rule.parent.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
  rule.selectors = rule.selectors.map((selector) => /^(body|:root)$/.test(selector) ? ".nfc-diagnostics" : `.nfc-diagnostics ${selector}`);
});
await writeFile(path.join(root, "mobile/src/diagnostics.css"), diagnosticCss.toString());
