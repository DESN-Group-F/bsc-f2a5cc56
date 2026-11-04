import { writeFile } from "node:fs/promises";
import path from "node:path";
import { startIsolatedPreview } from "./isolated-preview.mjs";
import { runMobileRegistrationHttpChecks, runMobileMovementHttpChecks } from "../tests/api/mobile-registration.mjs";

const controller = new AbortController(), startedAt = new Date().toISOString();
const interrupt = () => controller.abort(new Error("Mobile business checks interrupted."));
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
let preview, result;
try {
  preview = await startIsolatedPreview({ signal: controller.signal, onProgress: console.log });
  const registration = await runMobileRegistrationHttpChecks({ base: preview.base, credentials: preview.credentials, signal: controller.signal });
  const movement = await runMobileMovementHttpChecks({ base: preview.base, credentials: preview.credentials, batteryIds: registration.registeredBatteryIds, signal: controller.signal });
  result = { passed: registration.passed && movement.passed, checks: registration.checks + movement.checks, registration, movement };
} catch (error) {
  result = { passed: false, error: preview ? preview.redact(error.message) : error.message };
  console.error(result.error); process.exitCode = 1;
} finally {
  if (preview) {
    try { await preview.stop(); }
    catch (error) { result = { ...result, passed: false, cleanupError: preview.redact(error.message) }; process.exitCode = 1; }
    const report = path.join(preview.runDirectory, "mobile-business-results.json");
    await writeFile(report, JSON.stringify({ ...result, startedAt, completedAt: new Date().toISOString(), target: preview.base, migrations: preview.migrations }, null, 2) + "\n");
    console.log(`${result.passed ? "Passed" : "Failed"}: ${result.checks ?? 0} isolated mobile business HTTP checks. Report: ${report}`);
  }
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
