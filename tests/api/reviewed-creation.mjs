import assert from 'node:assert/strict';
import { verifyOperatorImportOutcome } from '../../work/qa/operator-import.mjs';
import { verifyModelCreateOutcome } from '../../work/qa/model-create.mjs';
import { verifyOperatorRegistrationReceipt } from '../../work/qa/operator-registration-session.mjs';
import { verifyIntakeReceipt } from '../../work/qa/intake-session.mjs';

/** Exercise only a caller-owned fresh loopback Worker, without hardware or hosted records. */
export async function runReviewedCreationHttpChecks({ base, credentials, signal, onCheck = () => {} }) {
  const target = new URL(base); assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1'); assert.ok(target.port);
  const results = [], prefix = 'QA-CREATE-' + crypto.randomUUID().slice(0, 8);
  const json = (body, cookie) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  async function check(name, route, options = {}, status = 200) {
    const started = performance.now();
    const response = await fetch(base + route, { ...options, redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
    const body = await response.json();
    const result = { name, status: response.status, expectedStatus: status, passed: response.status === status, elapsedMs: Math.round(performance.now() - started) };
    results.push(result); onCheck(result);
    assert.equal(response.status, status, name);
    return { body, response };
  }
  async function signIn(role) {
    const result = await check(`isolated ${role} authenticates for reviewed creation`, '/api/session', json({ action: 'signin', payload: credentials[role] }));
    const cookie = result.response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    assert.equal(result.body.user.role, role);
    return { cookie, id: result.body.user.id, role };
  }
  const admin = await signIn('admin'), staff = await signIn('staff');
  const inventory = async (dataset, who = staff, name = `read ${dataset} creation context`) => (await check(name, `/api/inventory?dataset=${dataset}`, { headers: { Cookie: who.cookie } })).body;
  const workingBefore = await inventory('live');
  for (const name of ['csvImport', 'batteryModels', 'modelCreate']) assert.equal(workingBefore.capabilities[name], 1);
  assert.equal(workingBefore.capabilities.demoIntake, 0);
  await check('initialize only the shared isolated Demonstration inventory', '/api/inventory', json({ dataset: 'demo', action: 'initialize_demo' }, admin.cookie));
  const demoBefore = await inventory('demo'); assert.equal(demoBefore.capabilities.demoIntake, 1);
  const modelInput = { id: crypto.randomUUID(), brand: 'Synthetic Brand', model: prefix + '-MODEL', variant: 'Reviewed label variant', name: 'Synthetic reusable pack', chemistry: 'LiPo', capacityMah: 2200, voltage: 7.4, notes: 'Explicit isolated HTTP fixture; no manufacturer verification.' };
  const modelRequest = async (name, action, payload = modelInput, who = staff, dataset = 'demo', status = 200) => (await check(name, '/api/battery-models', json({ dataset, action, payload }, who.cookie), status)).body;
  const missingModel = await modelRequest('querying an unsent model does not create a template', 'create_outcome'); assert.equal(missingModel.result.state, 'missing');
  const savedModel = await modelRequest('staff explicitly creates a reviewed reusable model', 'create_reviewed');
  const verifiedModel = await verifyModelCreateOutcome(savedModel.result, modelInput, staff.id, 'demo'); assert.equal(verifiedModel.state, 'confirmed');
  const replayModel = await modelRequest('a preserved model create recovers its original receipt', 'create_reviewed'); assert.deepEqual(replayModel.result.receipt, { ...verifiedModel.receipt, replayed: true });
  const queriedModel = await modelRequest('query-only model outcome returns the same confirmed receipt', 'create_outcome'); assert.deepEqual(queriedModel.result, replayModel.result);
  const duplicateModel = { ...modelInput, id: crypto.randomUUID() };
  const rejectedModel = await modelRequest('duplicate reusable identity returns a reserved final rejection', 'create_reviewed', duplicateModel);
  assert.equal((await verifyModelCreateOutcome(rejectedModel.result, duplicateModel, staff.id, 'demo')).state, 'rejected'); assert.equal(rejectedModel.result.code, 'model_rejected_final');
  assert.deepEqual((await modelRequest('duplicate model outcome stays final on query', 'create_outcome', duplicateModel)).result, rejectedModel.result);
  assert.equal((await modelRequest('another account cannot resolve the original model request', 'create_outcome', modelInput, admin, 'demo', 409)).code, 'idempotency_conflict');
  const models = (await check('both roles read saved, inventory and reference model candidates', '/api/battery-models?dataset=demo', { headers: { Cookie: admin.cookie } })).body;
  assert.ok(models.models.some(model => model.id === modelInput.id)); assert.ok(models.models.some(model => model.origin === 'reference')); assert.ok(Array.isArray(models.issues));

  const ownerFor = (snapshot, account = staff.id) => snapshot.people.find(person => person.accountId === account);
  const bindingFor = snapshot => ({ ownerVersion: ownerFor(snapshot).version, ownerAccountId: staff.id, buildingVersion: snapshot.buildings.find(building => building.id === 'J18').version, roomVersion: null });
  const operatorPayload = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: 'operator-entered-registration', tagId: null, directoryBindings: bindingFor(demoBefore), firstUseMode: 'unknown', common: { name: 'Preserved manual name', model: modelInput.model, chemistry: modelInput.chemistry, capacityMah: modelInput.capacityMah, voltage: modelInput.voltage, ownerId: ownerFor(demoBefore).id, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null, modelSelection: { origin: 'saved', id: modelInput.id, contentHash: verifiedModel.receipt.model.contentHash, confirmed: true, appliedFields: ['name', 'model', 'chemistry', 'capacityMah', 'voltage'] } } };
  const registered = (await check('model-assisted operator registration preserves an explicit individual override', '/api/inventory', json({ dataset: 'demo', action: 'operator_register', payload: operatorPayload }, staff.cookie))).body.result;
  verifyOperatorRegistrationReceipt(registered, operatorPayload, staff.id, 'demo');
  const assistedDetail = (await check('saved registration history retains model evidence and explicit overrides', `/api/inventory?dataset=demo&batteryId=${registered.batteryId}`, { headers: { Cookie: staff.cookie } })).body;
  const evidence = assistedDetail.events.find(event => event.action === 'battery_registered').details.modelReference;
  assert.equal(evidence.model.id, modelInput.id); assert.ok(evidence.overrides.includes('name')); assert.ok(!evidence.appliedFields.includes('name')); assert.equal(assistedDetail.observations.length, 0); assert.equal(assistedDetail.loans.length, 0);
  await check('administrator versioned model correction affects later suggestions only', '/api/battery-models', json({ dataset: 'demo', update: true, payload: { ...modelInput, name: 'Later template suggestion', expectedVersion: 1, requestId: crypto.randomUUID() } }, admin.cookie));
  const staleRegistration = { ...operatorPayload, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const staleModelResult = (await check('stale reviewed model hash cannot register a new battery', '/api/inventory', json({ dataset: 'demo', action: 'operator_register', payload: staleRegistration }, staff.cookie), 409)).body;
  assert.equal(staleModelResult.code, 'registration_rejected_final');
  const oldModelReceipt = await modelRequest('original model creation evidence remains intact after template editing', 'create_outcome'); assert.equal(oldModelReceipt.result.receipt.model.name, modelInput.name); assert.equal(oldModelReceipt.result.receipt.model.version, 1);

  const working = await inventory('live');
  const record = (id, extra = {}) => ({ id, name: 'Explicit imported battery', model: '', chemistry: '', capacityMah: null, voltage: null, tagId: null, ownerId: ownerFor(working).id, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null, ...extra });
  const csvPayload = (records, snapshot = working) => ({ requestId: crypto.randomUUID(), source: 'reviewed-csv-import', records, directoryBindings: { owners: [{ ownerId: ownerFor(snapshot).id, accountId: staff.id, version: ownerFor(snapshot).version }], buildingVersion: snapshot.buildings.find(building => building.id === 'J18').version, rooms: [] } });
  const csvRequest = async (name, action, payload, who = staff, status = 200) => (await check(name, '/api/inventory', json({ dataset: 'live', action, payload }, who.cookie), status)).body;
  const csv = csvPayload([record(prefix + '-CSV-KNOWN', { tagId: prefix + '-KNOWN-TAG', manufacturedOn: '2026-01-01', firstUsedOn: '2026-02-02' }), record(prefix + '-CSV-UNKNOWN')]);
  assert.equal((await csvRequest('CSV outcome lookup never imports an unsent batch', 'operator_import_outcome', csv)).result.state, 'missing');
  const imported = (await csvRequest('staff explicitly imports the entire reviewed CSV batch into Working inventory', 'operator_import', csv)).result;
  assert.equal((await verifyOperatorImportOutcome(imported, csv, staff.id, 'live')).state, 'confirmed');
  const queried = (await csvRequest('lost CSV response is resolved by query-only original outcome', 'operator_import_outcome', csv)).result; assert.deepEqual(queried.receipt, { ...imported.receipt, replayed: true });
  assert.deepEqual((await csvRequest('explicit CSV retry returns the same original complete receipt', 'operator_import', csv)).result, queried);
  assert.equal((await csvRequest('CSV request payload cannot be changed after import', 'operator_import', { ...csv, records: [...csv.records].reverse() }, staff, 409)).code, 'idempotency_conflict');
  assert.equal((await csvRequest('another actor cannot resolve the original CSV request', 'operator_import_outcome', csv, admin, 409)).code, 'idempotency_conflict');
  const duplicateCsv = csvPayload([record(prefix + '-DUPLICATE'), record(prefix + '-DUPLICATE')]);
  const duplicateOutcome = (await csvRequest('duplicate CSV IDs reject the whole batch with an immutable outcome', 'operator_import', duplicateCsv)).result; assert.equal(duplicateOutcome.state, 'rejected'); assert.equal(duplicateOutcome.status, 400);
  assert.deepEqual((await csvRequest('duplicate CSV IDs remain rejected on exact outcome lookup', 'operator_import_outcome', duplicateCsv)).result, duplicateOutcome);
  const tagConflict = csvPayload([record(prefix + '-TAG-CONFLICT', { tagId: prefix + '-KNOWN-TAG' }), record(prefix + '-NO-PARTIAL')]);
  const tagOutcome = (await csvRequest('known RFID conflicts import neither the conflicting row nor other rows', 'operator_import', tagConflict)).result; assert.equal(tagOutcome.state, 'rejected'); assert.equal(tagOutcome.status, 409);
  const staleCsv = csvPayload([record(prefix + '-STALE-DIRECTORY')]); staleCsv.directoryBindings.buildingVersion += 1;
  assert.equal((await csvRequest('CSV directory version mismatch reserves a final rejection', 'operator_import', staleCsv)).result.state, 'rejected');
  const futureCsv = csvPayload([record(prefix + '-FUTURE-DATE', { manufacturedOn: '2099-01-01' })]);
  const futureResult = (await csvRequest('future explicit CSV dates cannot be silently normalized or imported', 'operator_import', futureCsv)).result; assert.equal(futureResult.state, 'rejected'); assert.equal(futureResult.status, 400);
  const large = csvPayload(Array.from({ length: 200 }, (_, index) => record(prefix + '-BULK-' + String(index + 1).padStart(3, '0'))));
  const bulk = (await csvRequest('all 200 reviewed CSV rows receive one complete batch receipt', 'operator_import', large)).result; assert.equal((await verifyOperatorImportOutcome(bulk, large, staff.id, 'live')).state, 'confirmed'); assert.equal(bulk.receipt.records.length, 200);
  const workingAfter = await inventory('live', staff, 'verify complete CSV results without any failed-batch partial stock');
  assert.equal(workingAfter.batteries.length, workingBefore.batteries.length + 202);
  assert.ok(!workingAfter.batteries.some(battery => [prefix + '-DUPLICATE', prefix + '-NO-PARTIAL', prefix + '-FUTURE-DATE', prefix + '-STALE-DIRECTORY'].includes(battery.id)));
  const unknown = workingAfter.batteries.find(battery => battery.id === prefix + '-CSV-UNKNOWN'); assert.equal(unknown.capacityMah, null); assert.equal(unknown.voltage, null); assert.equal(unknown.firstUsedOn, null); assert.equal(unknown.loanId, null);
  const csvDetail = (await check('CSV asset history includes its own full batch linkage and actor', `/api/inventory?dataset=live&batteryId=${prefix}-CSV-KNOWN`, { headers: { Cookie: staff.cookie } })).body;
  assert.ok(csvDetail.events.some(event => event.action === 'records_imported' && event.details.requestId === csv.requestId)); assert.equal(csvDetail.observations.length, 0); assert.equal(csvDetail.loans.length, 0);

  const intakeCommon = { name: 'Simulated demo intake battery', model: '', chemistry: '', capacityMah: null, voltage: null, ownerId: ownerFor(demoBefore).id, homeBuildingId: 'J18', homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
  const intake = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: 'DEMO-INTAKE-' + prefix + '-ONE', common: intakeCommon, firstUseMode: 'unknown' };
  const intakeRequest = async (name, payload, dataset = 'demo', status = 200) => (await check(name, '/api/inventory', json({ dataset, action: 'intake', payload }, staff.cookie), status)).body;
  const demoReceipt = (await intakeRequest('deliberate simulated Demonstration intake creates exactly one individually numbered asset', intake)).result;
  verifyIntakeReceipt(demoReceipt, { actorAccountId: staff.id, dataset: 'demo', payload: intake });
  assert.deepEqual((await intakeRequest('explicit retry of a demo intake entry recovers only its original receipt', intake)).result, { ...demoReceipt, replayed: true });
  const duplicateIntake = { ...intake, requestId: crypto.randomUUID() };
  assert.equal((await intakeRequest('a duplicate simulated tag is a final rejection without another asset', duplicateIntake, 'demo', 409)).code, 'intake_rejected_final');
  await intakeRequest('simulated intake remains unavailable in Working inventory', { ...intake, requestId: crypto.randomUUID() }, 'live', 501);
  const demoAfter = await inventory('demo', staff, 'verify demo creation isolation and absence of partial or stale-model registrations');
  assert.equal(demoAfter.batteries.length, demoBefore.batteries.length + 2);
  assert.equal((await inventory('live', staff, 'Working inventory remains unaffected by simulated intake')).batteries.length, workingAfter.batteries.length);
  return { checks: results.length, passed: true, results, csvRowsConfirmed: 202, modelTemplatesCreated: 1, modelCreateOutcomeVerified: true, queryOnlyMissingChecked: true, completeHistoryChecked: true, terminalDuplicateOutcomesChecked: true, demonstrationOnlyIntakeChecked: true, hardwareClaimed: false, targetOwnership: 'fresh caller-owned isolated loopback Worker' };
}
