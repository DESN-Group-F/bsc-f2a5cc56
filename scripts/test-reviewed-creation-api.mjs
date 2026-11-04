import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startIsolatedPreview } from './isolated-preview.mjs';
import { runReviewedCreationHttpChecks } from '../tests/api/reviewed-creation.mjs';

const controller = new AbortController();
const interrupt = () => controller.abort(new Error('Reviewed creation HTTP checks were interrupted.'));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const startedAt = new Date().toISOString(), results = [];
let preview, summary;
try {
  preview = await startIsolatedPreview({ signal: controller.signal, onProgress: message => console.log(message) });
  console.log(`Running reviewed creation HTTP checks against owned isolated Worker ${preview.base}.`);
  summary = await runReviewedCreationHttpChecks({ base: preview.base, credentials: preview.credentials, signal: controller.signal, onCheck: result => { results.push(result); console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`); } });
} catch (error) {
  const message = preview ? preview.redact(error.message) : error.message;
  summary = { checks: results.length, passed: false, results, error: message };
  console.error(`Reviewed creation HTTP checks failed: ${message}`); process.exitCode = 1;
} finally {
  if (preview) {
    try { await preview.stop(); }
    catch (error) { summary = { ...summary, passed: false, cleanupError: preview.redact(error.message) }; console.error(`Owned Worker cleanup failed: ${preview.redact(error.message)}`); process.exitCode = 1; }
    const report = path.join(preview.runDirectory, 'reviewed-creation-results.json');
    await writeFile(report, JSON.stringify({ ...summary, startedAt, completedAt: new Date().toISOString(), target: preview.base, migrations: preview.migrations }, null, 2) + '\n');
    console.log(`${summary.passed ? 'Passed' : 'Failed'}: ${summary.checks} reviewed creation HTTP checks. Report: ${report}`);
  }
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
