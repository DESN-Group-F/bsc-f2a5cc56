import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FEEDBACK_KEY, SUCCESS_INTERVAL_MS, readFeedbackPreferences, scanFeedbackOutcome, expireScanFeedback } from '../src/features/scan/feedback.mjs';

test('feedback preferences use shared key, haptics on and sounds off unless explicitly changed', () => {
  assert.equal(FEEDBACK_KEY, 'preference:mobile-feedback');
  assert.deepEqual(readFeedbackPreferences({ getItem: () => null }), { haptics: true, sounds: false, strength: 'light' });
  assert.deepEqual(readFeedbackPreferences({ getItem: () => JSON.stringify({ haptics: false, sounds: true, strength: 'medium' }) }), { haptics: false, sounds: true, strength: 'medium' });
  assert.deepEqual(readFeedbackPreferences({ getItem: () => '{broken' }), { haptics: true, sounds: false, strength: 'light' });
});

test('orb and queue share one acquisition-success deadline; duplicate does not change or extend the pulse', () => {
  const accepted = scanFeedbackOutcome({}, { type: 'accepted', battery: { id: 'BAT-1', name: 'Battery 1' }, message: 'Added to review' }, 1000);
  assert.equal(accepted.until, 1000 + SUCCESS_INTERVAL_MS); assert.equal(accepted.tone, 'success'); assert.equal(accepted.expression, '');
  const duplicate = scanFeedbackOutcome(accepted, { type: 'duplicate', message: 'Battery 1 · Already in review' }, 1200);
  assert.equal(duplicate.until, accepted.until); assert.equal(duplicate.tone, 'success'); assert.equal(duplicate.expression, 'duplicate');
  assert.equal(duplicate.sequence, accepted.sequence + 1); assert.equal(duplicate.successSequence, accepted.successSequence);
  const expired = expireScanFeedback(duplicate, accepted.until);
  assert.equal(expired.tone, ''); assert.equal(expired.expression, ''); assert.equal(expired.capsule, duplicate.capsule);
});

test('saved results and routine state messages retain the duplicate capsule and acquisition deadline', () => {
  const duplicate = scanFeedbackOutcome({ tone: '', until: 0, successSequence: 3 }, { type: 'duplicate', message: 'Already in review' }, 1000);
  for (const type of ['saved', 'refreshed', 'paused']) {
    const next = scanFeedbackOutcome(duplicate, { type, message: 'Routine update' }, 1200);
    assert.equal(next.capsule, duplicate.capsule);
    assert.equal(next.until, duplicate.until);
    assert.equal(next.successSequence, duplicate.successSequence);
    assert.equal(next.sequence, duplicate.sequence);
    assert.equal(next.message, duplicate.message);
    assert.equal(next.noticeMessage, 'Routine update');
  }
});

test('routine reader or save updates retain the exact rejected acquisition explanation',()=>{
  const failure=scanFeedbackOutcome({}, {type:'failure',message:'The selected battery is retired.',code:'RETIRED'},1000);
  const next=scanFeedbackOutcome(expireScanFeedback(failure,9000),{type:'notice',message:'Reading paused'},9000);
  assert.equal(next.outcomeType,'failure');assert.equal(next.message,'The selected battery is retired.');assert.equal(next.code,'RETIRED');assert.equal(next.noticeMessage,'Reading paused');assert.equal(next.tone,'');
});

test('failure is surprised red feedback, duplicates retain ordinary operation color and no queue mutation', () => {
  const duplicate = scanFeedbackOutcome({ tone: '', until: 0 }, { type: 'duplicate', message: 'Already processed' }, 1000);
  assert.equal(duplicate.tone, ''); assert.equal(duplicate.until, 0); assert.equal(duplicate.expression, 'duplicate');
  const failure = scanFeedbackOutcome(duplicate, { type: 'failure', message: 'Unknown tag' }, 1100);
  assert.equal(failure.tone, 'failure'); assert.equal(failure.expression, 'failure'); assert.equal(failure.capsule, ''); assert.equal(failure.message,'Unknown tag'); assert.equal(failure.latest,null);
  const acquiredFailure = scanFeedbackOutcome({ ...duplicate, capsule: '' }, { type: 'failure', message: 'Unknown actual input' }, 1100);
  assert.equal(acquiredFailure.capsule, '');
});

test('mobile review has confirmation inside the sheet, retains focus/queue close, and pauses reader under review', async () => {
  const jsx = await readFile(new URL('../src/features/scan/scan.jsx', import.meta.url), 'utf8'), hook = await readFile(new URL('../src/features/scan/use-scan-workflow.js', import.meta.url), 'utf8'), ownCss = await readFile(new URL('../src/features/scan/scan.css', import.meta.url), 'utf8');
  assert.match(ownCss, /@import ['"]\.\/workflow-controls\.css['"]/);
  const css = ownCss + await readFile(new URL('../src/features/scan/workflow-controls.css', import.meta.url), 'utf8');
  assert.ok(jsx.indexOf('scan-confirm-button') > jsx.indexOf('scan-review-sheet'));
  assert.match(jsx, /Close review and retain queue/); assert.match(jsx, /useDialogFocus\(reviewOpen, reviewSheet, reviewEntry/);
  assert.match(hook, /!reviewOpen/); assert.match(hook, /visibilitychange/); assert.match(hook, /useOwnedNfcReader/);
  const reader=await readFile(new URL('../src/features/scan/use-owned-nfc-reader.js',import.meta.url),'utf8');
  assert.match(reader,/session\.pause/);
  // Cancellation ordering and cross-instance ownership are exercised by the
  // reader-session and iOS batch behavior suites, independently of helper names.
  assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /scan-review-sheet>footer/);
});
