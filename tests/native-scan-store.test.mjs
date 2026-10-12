import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { InventoryStore } from '../work/qa/store.mjs';
import { scanMovementPayload } from '../work/qa/scan-session.mjs';
import { verifyMovementReceipt } from '../work/qa/movement-session.mjs';
import { createExport } from '../work/qa/exports.mjs';

// Controlled native-evidence fixtures exercise actual D1 semantics. They do not
// establish physical reader acceptance or measure phone performance.
const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('native-scan-semantic-test')}}", compatibilityDate: '2026-05-15', d1Databases: { DB: 'native-scan-semantic-test' }, d1Persist: false });
const db = await mf.getD1Database('DB');
after(() => mf.dispose());
for (const entry of JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries) {
  const statements = (await readFile(`drizzle/${entry.tag}.sql`, 'utf8')).split('--> statement-breakpoint').filter(sql => sql.trim());
  await db.batch(statements.map(sql => db.prepare(sql)));
}
const at = '2026-10-12T05:00:00.000Z', returnedAt = '2026-10-12T05:01:00.000Z', laterAt = '2026-10-12T05:02:00.000Z';
const staff = { id: crypto.randomUUID(), name: 'Native semantic staff', role: 'staff', authVersion: 1 };
const admin = { id: crypto.randomUUID(), name: 'Native semantic administrator', role: 'admin', authVersion: 1 };
for (const [index, actor] of [staff, admin].entries()) await db.prepare('INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(actor.id, `native-semantic-${index}`, actor.name, actor.role, 'controlled-test-no-login', 'controlled-test-no-login', 600000, at, at).run();
const uidById = { 'BAT-ONE': '0004AB00', 'BAT-TWO': '00000004001100' };
async function rows(table, scope) { return (await db.prepare(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`).bind(scope).all()).results; }
async function history(context) { return { batteries: await rows('batteries', context.scope), loans: await rows('loans', context.scope), observations: await rows('observations', context.scope), operations: await rows('operations', context.scope), events: await rows('audit_events', context.scope) }; }
async function fixture(name, dataset = 'demo') {
  const scope = `native-semantic-${name}:${dataset}`, store = (actor = staff, database = db, time = at) => new InventoryStore(database, scope, dataset, actor, () => new Date(time));
  await store(admin).snapshot();
  // Legacy direct registration is setup only; these tests target scan movement.
  for (const [id, uid] of Object.entries(uidById)) await store(admin).saveBattery({ id, name: `Controlled ${id}`, model: 'Controlled pack', chemistry: 'LiPo', capacityMah: 2200, voltage: 7.4, tagId: `nfc:uid:${uid}`, ownerId: `staff-${staff.id}`, homeBuildingId: 'J18', homeRoomId: 'J18-DEMO-ROOM', manufacturedOn: null, firstUsedOn: null });
  return { scope, dataset, store };
}
function evidence(uidHex, atDevice = at) {
  return { attemptId: crypto.randomUUID(), source: 'native-nfc-reader', platform: 'android', startedAt: atDevice, endedAt: atDevice, adoptedAt: atDevice, tagId: `nfc:uid:${uidHex}`,
    result: { uidHex, technology: 'Controlled NFC-A semantic fixture', ndefStatus: 'readOnly', capacityBytes: 144, records: [{ tnf: 2, typeHex: '0001', idHex: '00', payloadHex: '000000AB' }, { tnf: 1, typeHex: '54', idHex: '', payloadHex: '02656E74657374' }], observedAt: atDevice } };
}
async function request(context, kind = 'checkout', ids = ['BAT-ONE'], options = {}) {
  const snapshot = await context.store().snapshot();
  const reads = ids.map(id => {
    const battery = snapshot.batteries.find(item => item.id === id);
    return { battery, tagId: battery.tagId, source: 'native_nfc', readAt: options.deviceTime ?? at, nfcEvidence: evidence(uidById[id], options.deviceTime ?? at) };
  });
  return scanMovementPayload(kind, reads, options.sessionId ?? crypto.randomUUID(), null, options.requestId ?? crypto.randomUUID());
}
function assertEventEvidence(event, payload) {
  const details = JSON.parse(event.details_json), binding = payload.scan.bindings.find(item => item.batteryId === event.battery_id);
  assert.equal(details.requestId, payload.requestId); assert.equal(details.scan.source, 'native_nfc'); assert.equal(details.scan.sessionId, payload.scan.sessionId);
  assert.deepEqual(details.scan.bindings, [binding]); assert.deepEqual(details.scan.bindings[0].nfcEvidence, binding.nfcEvidence);
  assert.equal(event.actor_id, staff.id); assert.equal(event.actor_name, staff.name);
}
function loseMovementBatchResponseOnce(kind) {
  const sqlByStatement = new WeakMap(); let losses = 0;
  return { get losses() { return losses; }, prepare(sql) { const statement = db.prepare(sql); return { bind(...values) { const bound = statement.bind(...values); sqlByStatement.set(bound, { sql, values }); return bound; } }; },
    async batch(statements) {
      const movement = statements.some(statement => { const saved = sqlByStatement.get(statement); return saved?.sql.startsWith('INSERT INTO operations(') && saved.values[2] === kind; });
      const result = await db.batch(statements);
      if (movement && !losses) { losses++; throw new Error('Controlled response loss after the D1 movement batch committed'); }
      return result;
    } };
}

test('demo native lookup is side-effect-free and reviewed checkout persists exact full evidence in receipt and each D1 audit event', async () => {
  const context = await fixture('evidence'), before = await history(context);
  const lookup = await context.store().scanLookup({ source: 'native_nfc', tagIds: ['nfc:uid:0004AB00', 'nfc:uid:FFFFFFFF'] });
  assert.equal(lookup.source, 'native_nfc'); assert.equal(lookup.results[0].battery.id, 'BAT-ONE'); assert.equal(lookup.results[1].battery, null);
  assert.deepEqual(await history(context), before);
  const payload = await request(context, 'checkout', ['BAT-TWO', 'BAT-ONE']), result = await context.store().movement(payload);
  assert.equal(verifyMovementReceipt(result, payload, staff.id), result); assert.equal(result.borrowerAccountId, staff.id);
  assert.deepEqual(result.scan.bindings, [...payload.scan.bindings].sort((a, b) => a.batteryId.localeCompare(b.batteryId)));
  const saved = await history(context), checkoutEvents = saved.events.filter(item => item.action === 'checkout');
  assert.equal(saved.loans.length, 2); assert.equal(checkoutEvents.length, 2); assert.equal(saved.observations.length, 0, 'A native read does not create a location observation');
  for (const event of checkoutEvents) assertEventEvidence(event, payload);
  const operation = saved.operations.find(item => item.kind === 'checkout');
  assert.deepEqual(JSON.parse(operation.result_json).scan, result.scan);
  assert.ok(operation.fingerprint.includes('00000004001100')); assert.ok(operation.fingerprint.includes('000000AB'));
});
test('controlled loss after D1 commit and exact retry produce one loan, one audit event and the original immutable native receipt', async () => {
  const context = await fixture('lost-response'), payload = await request(context), proxy = loseMovementBatchResponseOnce('checkout');
  const recoveredResult = await context.store(staff, proxy).movement(payload);
  assert.equal(proxy.losses, 1); assert.equal(recoveredResult.replayed, true); assert.ok(verifyMovementReceipt(recoveredResult, payload, staff.id));
  const afterCommit = await history(context), retried = await context.store(staff, db, laterAt).movement(structuredClone(payload));
  assert.deepEqual(retried, recoveredResult); assert.deepEqual(await history(context), afterCommit);
  assert.equal(afterCommit.loans.length, 1); assert.equal(afterCommit.events.filter(item => item.action === 'checkout').length, 1); assert.equal(afterCommit.operations.filter(item => item.kind === 'checkout').length, 1);
  const differentEvidence = structuredClone(payload); differentEvidence.scan.bindings[0].nfcEvidence.result.records[0].payloadHex = '00FF';
  await assert.rejects(context.store().movement(differentEvidence), error => error.status === 409 && /different operation/.test(error.message));
  assert.deepEqual(await history(context), afterCommit, 'A replacement evidence fingerprint cannot add or rewrite any history');
});
test('native return guards the reviewed Loan ID and original return replay cannot return a later loan of the same asset', async () => {
  const context = await fixture('exact-loans'), checkedOut = await request(context);
  await context.store().movement(checkedOut);
  const firstLoan = (await context.store().detail('BAT-ONE')).battery.loanId, payload = await request(context, 'return');
  assert.deepEqual(payload.expectedLoans, [{ batteryId: 'BAT-ONE', loanId: firstLoan }]);
  const wrong = structuredClone(payload); wrong.requestId = crypto.randomUUID(); wrong.expectedLoans[0].loanId = crypto.randomUUID();
  await assert.rejects(context.store().movement(wrong), error => error.code === 'movement_rejected_final' && /reviewed loan changed/.test(error.message));
  assert.equal((await context.store().detail('BAT-ONE')).battery.loanId, firstLoan);
  const returned = await context.store(staff, db, returnedAt).movement(payload); assert.ok(verifyMovementReceipt(returned, payload, staff.id));
  const newCheckout = await request(context, 'checkout', ['BAT-ONE'], { deviceTime: laterAt }); await context.store(staff, db, laterAt).movement(newCheckout);
  const laterLoan = (await context.store().detail('BAT-ONE')).battery.loanId; assert.notEqual(laterLoan, firstLoan);
  const replay = await context.store(staff, db, laterAt).movement(payload); assert.deepEqual(replay, { ...returned, replayed: true });
  assert.equal((await context.store().detail('BAT-ONE')).battery.loanId, laterLoan);
  const staleNewRequest = structuredClone(payload); staleNewRequest.requestId = crypto.randomUUID();
  await assert.rejects(context.store().movement(staleNewRequest), error => error.code === 'movement_rejected_final');
  const saved = await history(context), returns = saved.events.filter(item => item.action === 'return'); assert.equal(returns.length, 1);
  assert.equal(JSON.parse(returns[0].details_json).loanId, firstLoan); assertEventEvidence(returns[0], payload);
  assert.equal(saved.loans.find(item => item.id === firstLoan).returned_at, returnedAt); assert.equal(saved.loans.find(item => item.id === laterLoan).returned_at, null); assert.equal(saved.observations.length, 0);
});
test('working native lookup and movement reject the explicit demo-only gate before any D1 business mutation', async () => {
  const context = await fixture('working-gate', 'live'), payload = await request(context), before = await history(context);
  const blocked = error => error.status === 400 && error.code === 'native_nfc_demo_only';
  await assert.rejects(context.store().scanLookup({ source: 'native_nfc', tagIds: ['nfc:uid:0004AB00'] }), blocked);
  assert.deepEqual(await history(context), before);
  await assert.rejects(context.store().movement(payload), blocked); assert.deepEqual(await history(context), before);
  const manual = structuredClone(payload); manual.scan.source = 'manual'; manual.scan.bindings.forEach(item => delete item.nfcEvidence);
  await context.store().movement(manual);
  const returnPayload = await request(context, 'return'), loanState = await history(context);
  await assert.rejects(context.store().movement(returnPayload), blocked); assert.deepEqual(await history(context), loanState);
});
test('malformed, missing, mismatched and mixed-source native evidence creates neither loans nor movement audit evidence', async () => {
  const context = await fixture('invalid-evidence'), payload = await request(context), before = await history(context);
  for (const mutate of [
    value => { delete value.scan.bindings[0].nfcEvidence; },
    value => { value.scan.bindings[0].nfcEvidence.tagId = 'nfc:uid:FFFFFFFF'; },
    value => { value.scan.bindings[0].nfcEvidence.result.uidHex = '04AB00'; },
    value => { value.scan.bindings[0].nfcEvidence.result.records[0].payloadHex = '0'; },
    value => { value.scan.source = 'selection'; },
    value => { value.scan.source = 'manual'; },
  ]) { const invalid = structuredClone(payload); mutate(invalid); await assert.rejects(context.store().movement(invalid), error => error.name === 'ZodError'); assert.deepEqual(await history(context), before); }
  const rebound = structuredClone(payload); rebound.scan.bindings[0].tagId = 'nfc:uid:00000004001100'; rebound.scan.bindings[0].nfcEvidence = evidence('00000004001100');
  await assert.rejects(context.store().movement(rebound), error => error.code === 'movement_rejected_final' && /binding or battery record changed/.test(error.message));
  const after = await history(context); assert.deepEqual(after.loans, before.loans); assert.deepEqual(after.observations, before.observations); assert.deepEqual(after.events, before.events); assert.deepEqual(after.batteries, before.batteries);
  assert.equal(after.operations.filter(item => item.kind === 'movement_rejected').length, 1, 'A valid but stale binding records only a terminal rejection reservation');
});
test('detail and activity exports retain the exact raw native UID, NDEF bytes, device source and original audit JSON', async () => {
  const context = await fixture('export-evidence'), checkout = await request(context, 'checkout', ['BAT-ONE', 'BAT-TWO']);
  await context.store().movement(checkout); const returned = await request(context, 'return', ['BAT-ONE', 'BAT-TWO']); await context.store(staff, db, returnedAt).movement(returned);
  const saved = await history(context), movementEvents = saved.events.filter(item => ['checkout', 'return'].includes(item.action)); assert.equal(movementEvents.length, 4);
  const detail = await createExport(context.store(), { dataset: 'demo', mode: 'detail', range: 'selected', batteryIds: ['BAT-ONE', 'BAT-TWO'] });
  assert.equal(detail.tables.Batteries.length, 2); assert.equal(detail.tables.Loans.length, 2);
  const activity = await createExport(context.store(), { dataset: 'demo', mode: 'activity', activityDepth: 'battery_details', activityIds: movementEvents.map(item => item.id), sections: ['audit', 'loans'] });
  assert.equal(activity.tables.Activity.length, 4); assert.equal(activity.tables.Loans.length, 2);
  for (const sourceEvent of movementEvents) {
    for (const table of [detail.tables.Operations, activity.tables.Activity, activity.tables.Operations]) {
      const exported = table.find(item => item.id === sourceEvent.id); assert.ok(exported); assert.equal(exported.details_json, sourceEvent.details_json);
      assertEventEvidence(exported, sourceEvent.action === 'checkout' ? checkout : returned);
    }
  }
  const serialized = JSON.stringify(detail); assert.ok(serialized.includes('nfc:uid:0004AB00')); assert.ok(serialized.includes('nfc:uid:00000004001100')); assert.ok(serialized.includes('000000AB')); assert.ok(serialized.includes('02656E74657374'));
  assert.deepEqual(await history(context), saved, 'Exporting evidence is read-only');
});
