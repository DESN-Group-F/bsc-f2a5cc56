import { writeFile } from "node:fs/promises";
import path from "node:path";
import { startIsolatedPreview } from "./isolated-preview.mjs";
import { runNfcHandoffHttpChecks } from "../tests/api/nfc-handoff.mjs";

const controller = new AbortController();
const interrupt = () => controller.abort(new Error("NFC handoff checks were interrupted."));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const startedAt = new Date().toISOString();
let preview;
let result;
try {
  preview = await startIsolatedPreview({ signal: controller.signal, onProgress: console.log });
  result = await runNfcHandoffHttpChecks({
    base: preview.base, credentials: preview.credentials, signal: controller.signal,
  });
} catch (error) {
  const message = preview ? preview.redact(error.message) : error.message;
  result = { passed: false, error: message };
  console.error(message);
  process.exitCode = 1;
} finally {
  if (preview) {
    try { await preview.stop(); }
    catch (error) {
      result = { ...result, passed: false, cleanupError: preview.redact(error.message) };
      process.exitCode = 1;
    }
    const report = path.join(preview.runDirectory, "nfc-handoff-results.json");
    await writeFile(report, JSON.stringify({
      ...result, startedAt, completedAt: new Date().toISOString(),
      target: preview.base, migrations: preview.migrations,
    }, null, 2) + "\n");
    console.log(`${result.passed ? "Passed" : "Failed"}: ${result.checks ?? 0} isolated NFC handoff HTTP checks. Report: ${report}`);
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
