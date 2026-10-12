import assert from "node:assert/strict";

/** Use only disposable isolated state. The injectable transport must assert HTTP status and return parsed JSON. */
export async function runIntegrationNativeChecks({ base, cookie, request, signal, onCheck = () => {} }) {
  const target = new URL(base);
  assert.equal(target.protocol, "http:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port, "An isolated loopback listener is required.");
  const results = [];
  const send = request ?? (async (method, pathname, body, expectedStatus) => {
    const response = await fetch(base + pathname, { method, redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
    assert.equal(response.status, expectedStatus, `${method} ${pathname}: expected HTTP ${expectedStatus}, received ${response.status}`);
    return response.json();
  });
  async function check(name, method, pathname, body, expectedStatus = 200) {
    const value = await send(method, pathname, body, expectedStatus);
    const result = { name, expectedStatus, passed: true }; results.push(result); onCheck(result); return value;
  }
  const get = (name, pathname) => check(name, "GET", pathname);
  const post = (name, dataset, action, payload, status = 200) => check(name, "POST", "/api/inventory", { dataset, action, payload }, status);
  const detail = (dataset, id) => get(`review ${dataset} battery ${id}`, `/api/inventory?dataset=${dataset}&batteryId=${encodeURIComponent(id)}`);
  // usageSummary.asOf is calculated at read time, separately from persisted business evidence.
  const persistedDetail = value => {
    const stable = structuredClone(value);
    if (stable.usageSummary) delete stable.usageSummary.asOf;
    return stable;
  };
  const demo = await get("Demonstration advertises controlled native evidence capability", "/api/inventory?dataset=demo");
  const live = await get("Working advertises explicit native scope exclusion", "/api/inventory?dataset=live");
  for (const [snapshot, enabled] of [[demo, true], [live, false]]) {
    assert.equal(snapshot.capabilities.operatorRegistration, 1);
    assert.deepEqual(Object.keys(snapshot.capabilities).sort(), ["nativeNfc", "operatorRegistration"]);
    assert.equal(snapshot.capabilities.nativeNfc.version, 1); assert.equal(snapshot.capabilities.nativeNfc.enabled, enabled);
    assert.deepEqual(snapshot.capabilities.nativeNfc.enabledDatasets, ["demo"]);
    assert.equal(snapshot.capabilities.nativeNfc.evidenceSource, "device-reported"); assert.equal(snapshot.capabilities.nativeNfc.physicalAcceptance, false);
  }
  const actor = demo.user;
  assert.equal(live.user.id, actor.id);
  const common = (snapshot, name) => {
    const owner = snapshot.people.find(person => person.accountId === actor.id), building = snapshot.buildings.find(item => item.id === "J18");
    assert.ok(owner); assert.ok(building);
    return { name, model: "Controlled HTTP pack", chemistry: "", capacityMah: null, voltage: null, ownerId: owner.id, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null };
  };
  const liveOwner = live.people.find(person => person.accountId === actor.id), liveBuilding = live.buildings.find(item => item.id === "J18");
  const uid = bytes => "00" + crypto.randomUUID().replaceAll("-", "").slice(0, bytes * 2 - 2).toUpperCase();
  const proof = uidHex => {
    const at = new Date().toISOString();
    return { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: `nfc:uid:${uidHex}`, result: { uidHex, technology: "Controlled HTTP NFC-A evidence", ndefStatus: "readOnly", capacityBytes: 144, records: [{ tnf: 2, typeHex: "0001", idHex: "00", payloadHex: "00fFAa01" }], observedAt: at } };
  };
  const operator = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: "operator-entered-registration", tagId: `nfc:uid:${uid(4)}`, directoryBindings: { ownerVersion: liveOwner.version, ownerAccountId: liveOwner.accountId, buildingVersion: liveBuilding.version, roomVersion: null }, common: common(live, "Controlled Working operator registration"), firstUseMode: "at_registration" };
  await post("operator registration rejects hardware evidence claims", "live", "operator_register", { ...operator, nfcEvidence: proof(uid(4)) }, 400);
  await post("operator registration rejects a native source", "live", "operator_register", { ...operator, source: "native_nfc" }, 400);
  const registeredWorking = (await post("reviewed operator registration creates a Working asset with server attribution", "live", "operator_register", operator)).result;
  assert.equal(registeredWorking.source, operator.source); assert.equal(registeredWorking.actorAccountId, actor.id); assert.equal(registeredWorking.tagId, operator.tagId); assert.match(registeredWorking.batteryId, /^BAT-\d{8}$/);
  assert.equal(registeredWorking.requestId, operator.requestId); assert.equal(registeredWorking.sessionId, operator.sessionId); assert.ok(Number.isFinite(Date.parse(registeredWorking.registeredAt)));
  assert.deepEqual((await post("operator exact retry returns the immutable original receipt", "live", "operator_register", operator)).result, { ...registeredWorking, replayed: true });
  assert.equal((await post("operator request cannot change the typed identifier", "live", "operator_register", { ...operator, tagId: null }, 409)).code, "idempotency_conflict");
  const workingDetail = await detail("live", registeredWorking.batteryId);
  assert.equal(workingDetail.observations.length, 0); assert.equal(workingDetail.loans.length, 0);
  assert.equal(workingDetail.events.find(event => event.action === "battery_registered").details.source, operator.source);
  const workingBinding = { batteryId: workingDetail.battery.id, tagId: workingDetail.battery.tagId, version: workingDetail.battery.version, nfcEvidence: proof(operator.tagId.slice("nfc:uid:".length)) };
  const workingNative = { requestId: crypto.randomUUID(), kind: "checkout", batteryIds: [workingBinding.batteryId], scan: { sessionId: crypto.randomUUID(), source: "native_nfc", bindings: [workingBinding] } };
  assert.equal((await post("Working ordinary native lookup remains gated", "live", "scan_lookup", { source: "native_nfc", tagIds: [operator.tagId] }, 400)).code, "native_nfc_demo_only");
  assert.equal((await post("Working ordinary native checkout remains gated", "live", "movement", workingNative, 400)).code, "native_nfc_demo_only");

  const evidence = proof(uid(7));
  const incoming = { requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: "native_nfc", tagId: evidence.tagId, nfcEvidence: evidence, scannedAt: evidence.result.observedAt, common: common(demo, "Controlled HTTP native intake"), firstUseMode: "at_registration" };
  const mismatched = structuredClone(incoming); mismatched.tagId = `nfc:uid:${uid(7)}`;
  await post("native intake requires the exact adopted tag", "demo", "intake", mismatched, 400);
  await post("native intake cannot add a client registration timestamp", "demo", "intake", { ...incoming, registeredAt: new Date().toISOString() }, 400);
  await post("Working native intake stays outside enabled scope", "live", "intake", { ...incoming, common: common(live, incoming.common.name) }, 501);
  const intake = (await post("demo native intake preserves full device evidence and independent server time", "demo", "intake", incoming)).result;
  assert.equal(intake.source, "native_nfc"); assert.deepEqual(intake.nfcEvidence, evidence); assert.equal(intake.scannedAt, incoming.scannedAt); assert.equal(intake.actorAccountId, actor.id); assert.equal(intake.requestId, incoming.requestId); assert.equal(intake.sessionId, incoming.sessionId); assert.equal(intake.tagId, evidence.tagId);
  assert.deepEqual((await post("native intake exact retry preserves all original evidence", "demo", "intake", incoming)).result, { ...intake, replayed: true });
  const lookupBefore = await detail("demo", intake.batteryId);
  const lookup = (await post("native lookup resolves only the registered complete UID", "demo", "scan_lookup", { source: "native_nfc", tagIds: [evidence.tagId, `nfc:uid:${uid(10)}`] })).result;
  assert.equal(lookup.source, "native_nfc"); assert.equal(lookup.results[0].battery.id, intake.batteryId); assert.equal(lookup.results[1].battery, null);
  assert.deepEqual(persistedDetail(await detail("demo", intake.batteryId)), persistedDetail(lookupBefore), "Native lookup preserves every persisted detail field");
  const movement = (kind, battery) => ({ requestId: crypto.randomUUID(), kind, batteryIds: [battery.id], ...(kind === "return" ? { expectedLoans: [{ batteryId: battery.id, loanId: battery.loanId }] } : {}), scan: { sessionId: crypto.randomUUID(), source: "native_nfc", bindings: [{ batteryId: battery.id, tagId: battery.tagId, version: battery.version, nfcEvidence: evidence }] } });
  const checkout = movement("checkout", lookupBefore.battery);
  const missing = structuredClone(checkout); delete missing.scan.bindings[0].nfcEvidence;
  await post("native checkout rejects incomplete reader evidence", "demo", "movement", missing, 400);
  const wrongSource = structuredClone(checkout); wrongSource.scan.source = "manual";
  await post("typed input cannot carry hardware evidence", "demo", "movement", wrongSource, 400);
  const stale = structuredClone(checkout); stale.requestId = crypto.randomUUID(); stale.scan.bindings[0].version++;
  assert.equal((await post("stale native binding reserves final rejection", "demo", "movement", stale, 409)).code, "movement_rejected_final");
  const checkoutReceipt = (await post("reviewed native checkout records the authenticated holder", "demo", "movement", checkout)).result;
  assert.equal(checkoutReceipt.borrowerAccountId, actor.id); assert.deepEqual(checkoutReceipt.scan, checkout.scan);
  assert.deepEqual((await post("native checkout exact retry adds no second loan", "demo", "movement", checkout)).result, { ...checkoutReceipt, replayed: true });
  const changedEvidence = structuredClone(checkout); changedEvidence.scan.bindings[0].nfcEvidence.result.records[0].payloadHex = "00fFAa02";
  await post("saved scan request cannot substitute raw NDEF bytes", "demo", "movement", changedEvidence, 409);
  const held = (await detail("demo", intake.batteryId)).battery, returning = movement("return", held);
  const wrongLoan = structuredClone(returning); wrongLoan.requestId = crypto.randomUUID(); wrongLoan.expectedLoans[0].loanId = crypto.randomUUID();
  assert.equal((await post("native return rejects the wrong reviewed loan", "demo", "movement", wrongLoan, 409)).code, "movement_rejected_final");
  const returnReceipt = (await post("native return closes the exact reviewed loan", "demo", "movement", returning)).result;
  assert.deepEqual(returnReceipt.scan, returning.scan);
  const returned = (await detail("demo", intake.batteryId)).battery;
  await post("create a later loan for exact historic replay verification", "demo", "movement", movement("checkout", returned));
  const later = (await detail("demo", intake.batteryId)).battery;
  assert.notEqual(later.loanId, held.loanId);
  assert.deepEqual((await post("historic native return replay retains its immutable receipt", "demo", "movement", returning)).result, { ...returnReceipt, replayed: true });
  assert.equal((await detail("demo", intake.batteryId)).battery.loanId, later.loanId);
  assert.equal((await post("a new request cannot return a later loan using historic bindings", "demo", "movement", { ...returning, requestId: crypto.randomUUID() }, 409)).code, "movement_rejected_final");
  await post("explicitly return the later reviewed native loan", "demo", "movement", movement("return", later));
  const free = (await detail("demo", intake.batteryId)).battery;
  const removal = { requestId: crypto.randomUUID(), source: "native_nfc", kind: "scrapped", reason: "", destination: null, items: [{ batteryId: free.id, tagId: free.tagId, version: free.version, nfcEvidence: evidence }] };
  await post("Working native retirement stays outside enabled scope", "live", "lifecycle", { ...removal, items: [workingBinding] }, 501);
  const removalReceipt = (await post("native removal preserves full evidence and exact reviewed version", "demo", "lifecycle", removal)).result;
  assert.equal(removalReceipt.source, "native_nfc"); assert.equal(removalReceipt.items[0].version, free.version + 1); assert.deepEqual(removalReceipt.items[0].nfcEvidence, evidence);
  assert.deepEqual((await post("native removal exact retry preserves original outcome", "demo", "lifecycle", removal)).result, { ...removalReceipt, replayed: true });
  const exported = await check("JSON detail exports retain native source UID raw bytes and original requests", "POST", "/api/export", { dataset: "demo", mode: "detail", range: "selected", batteryIds: [intake.batteryId] });
  assert.equal(exported.tables.Loans.length, 2);
  for (const action of ["battery_registered", "checkout", "return", "battery_scrapped"]) {
    const events = exported.tables.Operations.filter(event => event.action === action); assert.ok(events.length);
    for (const event of events) {
      const detail = JSON.parse(event.details_json); assert.equal(event.actor_id, actor.id);
      if (["checkout", "return"].includes(action)) { assert.equal(detail.scan.source, "native_nfc"); assert.deepEqual(detail.scan.bindings[0].nfcEvidence, evidence); }
      else { assert.equal(detail.source, "native_nfc"); assert.deepEqual(detail.nfcEvidence, evidence); }
    }
  }
  assert.ok(JSON.stringify(exported).includes("00fFAa01"));

  async function teaching(dataset, actualBattery, source) {
    const snapshot = dataset === "live" ? live : demo;
    const originalRequest = { ...operator, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: null, common: common(snapshot, `Controlled ${dataset} teaching original`) };
    if (dataset === "demo") {
      const owner = demo.people.find(person => person.accountId === actor.id), building = demo.buildings.find(item => item.id === "J18");
      originalRequest.directoryBindings = { ownerVersion: owner.version, ownerAccountId: owner.accountId, buildingVersion: building.version, roomVersion: null };
    }
    const original = (await post(`register ${dataset} teaching original using explicit operator evidence`, dataset, "operator_register", originalRequest)).result;
    const group = (await check(`create own ${dataset} teaching group`, "POST", "/api/teaching-groups", { dataset, payload: { action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: `Controlled ${dataset} teaching set`, batteryIds: [original.batteryId] } })).result.group;
    const originalDetail = (await detail(dataset, original.batteryId)).battery;
    const binding = battery => ({ batteryId: battery.id, tagId: battery.tagId, version: battery.version });
    const payload = { action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope: "all", mappings: [{ original: binding(originalDetail), actual: binding(actualBattery), originalLoanId: null, method: "manual", source }] };
    const save = (name, value, status = 200) => check(name, "POST", "/api/teaching-checkouts", { dataset, payload: value }, status);
    if (dataset === "live") {
      const before = await detail(dataset, actualBattery.id);
      assert.equal((await save("Working new native teaching checkout is durably gated", payload, 400)).code, "teaching_checkout_rejected_final");
      await save("Working rejected native teaching request remains final on retry", payload, 400);
      assert.deepEqual(persistedDetail(await detail(dataset, actualBattery.id)), persistedDetail(before));
      const manual = { ...payload, requestId: crypto.randomUUID(), mappings: [{ ...payload.mappings[0], source: { kind: "selection" } }] };
      const saved = (await save("Working teaching manual selection remains enabled", manual)).result;
      const held = (await detail(dataset, actualBattery.id)).battery;
      const nativeReturn = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ ...binding(held), loanId: held.loanId, source }] };
      assert.equal((await save("Working native teaching return also remains gated", nativeReturn, 400)).code, "teaching_checkout_rejected_final");
      assert.equal((await detail(dataset, actualBattery.id)).battery.loanId, held.loanId);
      await save("Working explicit selection hand-back remains enabled", { ...nativeReturn, requestId: crypto.randomUUID(), items: [{ ...binding(held), loanId: held.loanId }] });
    } else {
      const saved = (await save("Demonstration teaching native acquisition retains complete source", payload)).result;
      assert.deepEqual(saved.run.mappings[0].source, source);
      assert.deepEqual((await save("teaching native exact retry preserves original loan and mapping", payload)).result, { ...saved, replayed: true });
      const held = (await detail(dataset, actualBattery.id)).battery;
      const returning = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ ...binding(held), loanId: held.loanId, source }] };
      const receipt = (await save("Demonstration native teaching hand-back preserves complete evidence", returning)).result;
      assert.deepEqual(receipt.returnedItems[0].source, source);
    }
  }
  await teaching("live", workingDetail.battery, { kind: "native_nfc", evidence: workingBinding.nfcEvidence });
  const teachingProof = proof(uid(4)), teachingIncoming = { ...incoming, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: teachingProof.tagId, nfcEvidence: teachingProof, scannedAt: teachingProof.result.observedAt };
  const teachingReceipt = (await post("create isolated Demonstration teaching replacement through native intake", "demo", "intake", teachingIncoming)).result;
  await teaching("demo", (await detail("demo", teachingReceipt.batteryId)).battery, { kind: "native_nfc", evidence: teachingProof });
  return { passed: true, checks: results.length, exactRequestReplayChecked: true, nativeEnabledDatasets: ["demo"], physicalAcceptanceClaimed: false, registeredBatteryIds: [registeredWorking.batteryId, intake.batteryId, teachingReceipt.batteryId], results };
}
