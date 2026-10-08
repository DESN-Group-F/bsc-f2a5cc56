import assert from "node:assert/strict";

/** Run only against a caller-owned disposable loopback Worker with native staff accounts. */
export async function runMobileRegistrationHttpChecks({ base, credentials, signal, onCheck = () => {} }) {
  const target = new URL(base);
  assert.equal(target.protocol, "http:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const results = [];
  async function check(name, pathname, options = {}, expectedStatus = 200) {
    const response = await fetch(base + pathname, { ...options, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
    const result = { name, status: response.status, expectedStatus, passed: response.status === expectedStatus };
    results.push(result); onCheck(result);
    assert.equal(response.status, expectedStatus, `${name}: expected HTTP ${expectedStatus}, received ${response.status}`);
    return response;
  }
  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const envelope = payload => ({ dataset: "demo", action: "mobile_register", payload });
  const uid = "nfc:uid:04000000A62090";
  await check("anonymous mobile registration requires an authenticated staff account", "/api/inventory", json(envelope({})), 401);
  const signIn = async role => {
    const response = await check(`${role} mobile registration checks use native account sign-in`, "/api/session", json({ action: "signin", payload: credentials[role] }));
    const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    return { cookie, user: (await response.json()).user };
  };
  const staff = await signIn("staff"), admin = await signIn("admin");
  const before = await (await check("load shared native owner and J18 references", "/api/inventory?dataset=demo", { headers: { Cookie: staff.cookie } })).json();
  const owner = before.people.find(person => person.accountId === staff.user.id);
  assert.ok(owner); assert.ok(!before.batteries.some(battery => battery.tagId === uid));
  const requested = {
    requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), source: "operator-entered-registration", tagId: uid,
    common: { name: "HTTP operator-entered diagnostic battery", chemistry: "", model: "", capacityMah: null, voltage: null, ownerId: owner.id, homeBuildingId: "J18", homeRoomId: null, manufacturedOn: null, firstUsedOn: null },
    firstUseMode: "at_registration",
  };
  await check("native read source cannot be forged through operator registration", "/api/inventory", json(envelope({ ...requested, source: "native-nfc-reader" }), staff.cookie), 400);
  await check("noncanonical NFC identifiers cannot silently change byte evidence", "/api/inventory", json(envelope({ ...requested, tagId: "nfc:uid:04abcdefa62090" }), staff.cookie), 400);
  await check("client registration times cannot replace the server's timestamp", "/api/inventory", json(envelope({ ...requested, registeredAt: "2026-10-01T00:00:00Z" }), staff.cookie), 400);
  await check("unvalidated mobile registration cannot enter the working inventory", "/api/inventory", json({ ...envelope(requested), dataset: "live" }, staff.cookie), 501);
  const first = (await (await check("explicit reviewed registration allocates an attributable permanent ID", "/api/inventory", json(envelope(requested), staff.cookie))).json()).result;
  assert.match(first.batteryId, /^BAT-\d{8}$/); assert.equal(first.actorAccountId, staff.user.id); assert.equal(first.requestId, requested.requestId);
  assert.equal(first.sessionId, requested.sessionId); assert.equal(first.tagId, uid); assert.equal(first.source, requested.source); assert.equal(first.replayed, false);
  assert.equal(first.capacityMah, null); assert.equal(first.manufacturedOn, null); assert.ok(Number.isFinite(Date.parse(first.registeredAt)));
  const retry = (await (await check("exact lost-response retry returns the original immutable registration", "/api/inventory", json(envelope(requested), staff.cookie))).json()).result;
  assert.deepEqual(retry, { ...first, replayed: true });
  const changed = await (await check("request ID cannot switch to another UID", "/api/inventory", json(envelope({ ...requested, tagId: "nfc:uid:00000000" }), staff.cookie), 409)).json();
  assert.equal(changed.code, "idempotency_conflict");
  const foreign = await (await check("another account cannot replay a same-name staff request", "/api/inventory", json(envelope(requested), admin.cookie), 409)).json();
  assert.equal(foreign.code, "idempotency_conflict");
  const duplicated = { ...requested, requestId: crypto.randomUUID() };
  const duplicate = await (await check("duplicate UID reserves a final rejection and creates no second battery", "/api/inventory", json(envelope(duplicated), staff.cookie), 409)).json();
  assert.equal(duplicate.code, "registration_rejected_final");
  await check("duplicate UID exact retry remains a final rejection", "/api/inventory", json(envelope(duplicated), staff.cookie), 409);
  const untagged = { ...requested, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), tagId: null, firstUseMode: "unknown" };
  const second = (await (await check("explicit untagged registration retains unknown service start", "/api/inventory", json(envelope(untagged), staff.cookie))).json()).result;
  assert.equal(second.tagId, null); assert.equal(second.firstUsedOn, null); assert.notEqual(second.batteryId, first.batteryId);
  const badOwner = { ...untagged, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), common: { ...untagged.common, ownerId: "unknown-native-owner" } };
  const rejected = await (await check("unknown owner is rejected without silently choosing the current account", "/api/inventory", json(envelope(badOwner), staff.cookie), 400)).json();
  assert.equal(rejected.code, "registration_rejected_final");
  const detail = await (await check("saved registration history distinguishes operator binding from hardware reads", `/api/inventory?dataset=demo&batteryId=${first.batteryId}`, { headers: { Cookie: staff.cookie } })).json();
  assert.equal(detail.battery.tagId, uid); assert.equal(detail.battery.ownerAccountId, staff.user.id);
  assert.equal(detail.loans.length, 0); assert.equal(detail.observations.length, 0);
  const registrationEvent = detail.events.find(event => event.action === "battery_registered");
  assert.ok(registrationEvent); assert.equal(registrationEvent.details.source, requested.source); assert.equal(registrationEvent.details.requestId, requested.requestId);
  const after = await (await check("failed and retried requests create exactly the two reviewed new assets", "/api/inventory?dataset=demo", { headers: { Cookie: staff.cookie } })).json();
  assert.equal(after.batteries.length, before.batteries.length + 2);
  assert.equal(after.batteries.filter(battery => battery.tagId === uid).length, 1);
  const live = await (await check("working register remains unchanged by diagnostic registrations", "/api/inventory?dataset=live", { headers: { Cookie: staff.cookie } })).json();
  assert.ok(!live.batteries.some(battery => battery.tagId === uid));
  return { checks: results.length, passed: true, exactRequestReplayChecked: true, nativeNfcClaimed: false, registeredBatteryIds: [first.batteryId, second.batteryId], results };
}

/** Exercise the same reviewed selection contracts used by the complete mobile staff app. */
export async function runMobileMovementHttpChecks({ base, credentials, batteryIds, signal, onCheck = () => {} }) {
  const target = new URL(base); assert.equal(target.protocol, "http:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  assert.equal(batteryIds.length, 2); assert.equal(new Set(batteryIds).size, 2);
  const results = [];
  async function check(name, pathname, options = {}, expectedStatus = 200) {
    const response = await fetch(base + pathname, { ...options, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
    const result = { name, status: response.status, expectedStatus, passed: response.status === expectedStatus }; results.push(result); onCheck(result);
    assert.equal(response.status, expectedStatus, `${name}: expected HTTP ${expectedStatus}, received ${response.status}`); return response;
  }
  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const login = await check("mobile movement checks sign in as the actual staff account", "/api/session", json({ action: "signin", payload: credentials.staff }));
  const cookie = login.headers.get("set-cookie")?.split(";")[0], actor = (await login.json()).user; assert.ok(cookie);
  const snapshot = async name => (await (await check(name, "/api/inventory?dataset=demo", { headers: { Cookie: cookie } })).json()).batteries.filter(battery => batteryIds.includes(battery.id));
  const reviewed = await snapshot("review tagged and untagged saved batteries before any checkout");
  assert.equal(reviewed.length, 2); assert.ok(reviewed.every(battery => battery.loanId === null)); assert.ok(reviewed.some(battery => battery.tagId === null));
  const payload = (kind, batteries, requestId = crypto.randomUUID()) => ({
    requestId, kind, batteryIds: batteries.map(battery => battery.id),
    ...(kind === "return" ? { expectedLoans: batteries.map(battery => ({ batteryId: battery.id, loanId: battery.loanId })) } : {}),
    scan: { sessionId: crypto.randomUUID(), source: "selection", bindings: batteries.map(battery => ({ batteryId: battery.id, tagId: battery.tagId, version: battery.version })) },
  });
  const movement = async (name, value, expectedStatus = 200) => (await (await check(name, "/api/inventory", json({ dataset: "demo", action: "movement", payload: value }, cookie), expectedStatus)).json());
  const checkout = payload("checkout", reviewed);
  const staleVersion = structuredClone(checkout); staleVersion.requestId = crypto.randomUUID(); staleVersion.scan.bindings[0].version += 1;
  assert.equal((await movement("stale reviewed versions reject the whole tagged and untagged batch", staleVersion, 409)).code, "movement_rejected_final");
  await movement("a client cannot replace the authenticated checkout holder", { ...checkout, borrowerAccountId: crypto.randomUUID() }, 400);
  const savedCheckout = (await movement("explicit reviewed two-battery checkout records the authenticated holder", checkout)).result;
  assert.equal(savedCheckout.count, 2); assert.equal(savedCheckout.requestId, checkout.requestId); assert.equal(savedCheckout.borrowerAccountId, actor.id);
  assert.deepEqual([...savedCheckout.batteryIds].sort(), [...batteryIds].sort());
  const retryCheckout = (await movement("lost checkout response retries only the captured immutable request", checkout)).result;
  assert.deepEqual(retryCheckout, { ...savedCheckout, replayed: true });
  const borrowed = await snapshot("review the exact current loans while preserving responsible ownership");
  assert.ok(borrowed.every(battery => battery.loanId && battery.borrowerAccountId === actor.id));
  for (const battery of borrowed) assert.equal(battery.ownerAccountId, reviewed.find(original => original.id === battery.id).ownerAccountId);
  const returnRequest = payload("return", borrowed);
  const staleLoan = structuredClone(returnRequest); staleLoan.requestId = crypto.randomUUID(); staleLoan.expectedLoans[0].loanId = crypto.randomUUID();
  assert.equal((await movement("a substituted return loan never closes a reviewed current loan", staleLoan, 409)).code, "movement_rejected_final");
  const savedReturn = (await movement("explicit reviewed return closes exactly the two captured loans", returnRequest)).result;
  assert.equal(savedReturn.count, 2); assert.equal(savedReturn.requestId, returnRequest.requestId);
  const returned = await snapshot("returned status is derived from active-loan absence");
  assert.ok(returned.every(battery => battery.loanId === null));
  const secondCheckout = payload("checkout", returned.slice(0, 1));
  await movement("prepare a later independent loan to check historic exact-return replay", secondCheckout);
  const laterLoan = await snapshot("capture the later loan before retrying the old return");
  const newLoan = laterLoan.find(battery => battery.id === returned[0].id).loanId; assert.ok(newLoan); assert.notEqual(newLoan, borrowed.find(battery => battery.id === returned[0].id).loanId);
  const oldReturnReplay = (await movement("an old return's saved receipt can replay without returning a later loan", returnRequest)).result;
  assert.deepEqual(oldReturnReplay, { ...savedReturn, replayed: true });
  const preserved = await snapshot("historic replay leaves the new active loan intact");
  assert.equal(preserved.find(battery => battery.id === returned[0].id).loanId, newLoan);
  const oldLoanNewRequest = { ...structuredClone(returnRequest), requestId: crypto.randomUUID() };
  assert.equal((await movement("a new request cannot reuse historic loan bindings to return the later loan", oldLoanNewRequest, 409)).code, "movement_rejected_final");
  await movement("finish the test's later loan using a newly reviewed explicit return", payload("return", preserved.filter(battery => battery.loanId)));
  const detail = await (await check("complete loan and audit history retains all confirmed operations", `/api/inventory?dataset=demo&batteryId=${returned[0].id}`, { headers: { Cookie: cookie } })).json();
  assert.equal(detail.loans.length, 2); assert.ok(detail.loans.every(loan => loan.returnedAt && loan.borrowerAccountId === actor.id));
  assert.equal(detail.observations.length, 0);
  return { checks: results.length, passed: true, reviewedNullTagGuardChecked: true, exactLoanReplayChecked: true, nativeNfcClaimed: false, results };
}
