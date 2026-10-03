import { writeFile } from "node:fs/promises";
import path from "node:path";
import { startIsolatedPreview } from "./isolated-preview.mjs";
import { runApiSmoke } from "../tests/api/smoke.mjs";

const controller = new AbortController();
const interrupt = () =>
  controller.abort(new Error("Isolated API checks were interrupted."));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const startedAt = new Date().toISOString();
const results = [];
let preview;
let summary;
try {
  preview = await startIsolatedPreview({
    signal: controller.signal,
    onProgress: (message) => console.log(message),
  });
  console.log(
    `Running HTTP checks against the isolated Worker at ${preview.base}.`,
  );
  summary = await runApiSmoke({
    base: preview.base,
    credentials: preview.credentials,
    signal: controller.signal,
    onCheck(result) {
      results.push(result);
      if (results.length % 10 === 0)
        console.log(`Completed ${results.length} HTTP checks.`);
    },
  });
} catch (error) {
  const message = preview ? preview.redact(error.message) : error.message;
  summary = { checks: results.length, passed: false, results, error: message };
  console.error(`Isolated API checks failed: ${message}`);
  process.exitCode = 1;
} finally {
  if (preview) {
    try {
      await preview.stop();
    } catch (error) {
      summary = {
        ...summary,
        passed: false,
        cleanupError: preview.redact(error.message),
      };
      console.error(
        `Isolated Worker cleanup failed: ${preview.redact(error.message)}`,
      );
      process.exitCode = 1;
    }
    const reportPath = path.join(preview.runDirectory, "results.json");
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          ...summary,
          startedAt,
          completedAt: new Date().toISOString(),
          target: preview.base,
          migrations: preview.migrations,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `${summary.passed ? "Passed" : "Failed"}: ${summary.checks} isolated HTTP checks. Report: ${reportPath}`,
    );
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
