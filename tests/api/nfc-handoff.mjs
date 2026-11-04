import assert from "node:assert/strict";

/** Caller must supply a freshly initialized isolated local Worker, never a hosted inventory. */
export async function runNfcHandoffHttpChecks({ base, credentials, signal, onCheck = () => {} }) {
  const target = new URL(base);
  assert.equal(target.protocol, "http:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port, "An isolated loopback port is required.");
  const results = [];
  async function check(name, pathname, options = {}, status = 200) {
    const response = await fetch(base + pathname, {
      ...options, redirect: "manual",
      signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
    });
    const result = { name, status: response.status, expectedStatus: status, passed: response.status === status };
    results.push(result); onCheck(result);
    assert.equal(response.status, status, `${name}: expected HTTP ${status}, received ${response.status}`);
    return response;
  }
  const json = (body, cookie) => ({ method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const uid = "nfc:uid:04AABBCCDDEEFF";
  const shell = await check("NFC diagnostic shell is public and contains no automatic inventory result", `/nfc-test?dataset=demo&tagId=${encodeURIComponent(uid)}`);
  const html = await shell.text();
  assert.match(html, /Check an identifier/);
  assert.match(html, /Checking staff access/);
  assert.doesNotMatch(html, /Identifier matched|Identifier not registered/);
  const restricted = await (await check("working-inventory links cannot open the diagnostic lookup form", `/nfc-test?dataset=live&tagId=${encodeURIComponent(uid)}`)).text();
  assert.match(restricted, /supports only the demonstration inventory/);
  assert.doesNotMatch(restricted, /<form/);
  const ambiguous = await (await check("duplicate identifiers cannot open the diagnostic lookup form", `/nfc-test?dataset=demo&tagId=${encodeURIComponent(uid)}&tagId=${encodeURIComponent(uid)}`)).text();
  assert.match(ambiguous, /contains more than one identifier/);
  assert.doesNotMatch(ambiguous, /<form/);
  await check("anonymous NFC identifier lookup remains forbidden", "/api/inventory", json({ dataset: "demo", action: "scan_lookup", payload: { tagIds: [uid], source: "manual" } }), 401);
  const login = await check("existing staff session supports read-only diagnostic queries", "/api/session", json({ action: "signin", payload: credentials.staff }));
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Staff authentication must issue its existing session cookie.");
  const session = await (await check("same-origin session check confirms staff identity", "/api/session", { headers: { Cookie: cookie } })).json();
  assert.equal(typeof session.user.id, "string");
  const fixtureDirectory = await (await check("load native staff and J18 references for an explicit isolated test fixture", "/api/inventory?dataset=demo", { headers: { Cookie: cookie } })).json();
  const owner = fixtureDirectory.people.find(person => person.accountId === session.user.id);
  assert.ok(owner, "The fixture must use the authenticated staff account's native responsible-owner projection.");
  const fixtureId = "QA-NFC-HANDOFF";
  assert.ok(!fixtureDirectory.batteries.some(battery => battery.id === fixtureId || battery.tagId === uid), "The caller must supply disposable isolated state without the known NFC fixture.");
  const registration = await (await check("explicit staff registration confirms a known NFC UID fixture before diagnostic reads", "/api/inventory", json({
    dataset: "demo", action: "battery", payload: {
      id: fixtureId, name: "Fictional NFC diagnostic battery", tagId: uid,
      ownerId: owner.id, homeBuildingId: "J18", homeRoomId: null,
      chemistry: "", model: "", capacityMah: null, voltage: null,
      manufacturedOn: null, firstUsedOn: null,
    },
  }, cookie))).json();
  assert.equal(registration.ok, true);
  assert.equal(registration.result.id, fixtureId);
  assert.equal(registration.result.version, 1);
  const snapshot = await (await check("capture demonstration register before diagnostic lookups", "/api/inventory?dataset=demo", { headers: { Cookie: cookie } })).json();
  const registered = snapshot.batteries.find(battery => battery.id === fixtureId && battery.tagId === uid);
  assert.ok(registered, "Confirmed fixture registration must appear in the shared demonstration register.");
  assert.equal(registered.ownerAccountId, session.user.id);
  const missingTag = `nfc:uid:${"FF".repeat(10)}`;
  assert.ok(!snapshot.batteries.some(battery => battery.tagId === missingTag), "Unknown diagnostic fixture must stay absent from the register.");
  const absent = await (await check("unknown diagnostic tag does not register a new battery", "/api/inventory", json({ dataset: "demo", action: "scan_lookup", payload: { tagIds: [missingTag], source: "manual" } }, cookie))).json();
  assert.deepEqual(absent.result, { source: "manual", results: [{ tagId: missingTag, battery: null }] });
  const found = await (await check("registered canonical NFC UID resolves the explicitly registered fixture", "/api/inventory", json({ dataset: "demo", action: "scan_lookup", payload: { tagIds: [uid], source: "manual" } }, cookie))).json();
  assert.equal(found.ok, true);
  assert.equal(found.result.results[0].tagId, uid);
  assert.equal(found.result.results[0].battery.id, registered.id);
  assert.equal(found.result.results[0].battery.version, registered.version);
  assert.equal(found.result.results[0].battery.loanId, registered.loanId);
  await check("unvalidated native NFC source is not enabled as a server ingestion source", "/api/inventory", json({ dataset: "demo", action: "scan_lookup", payload: { tagIds: [uid], source: "native_nfc" } }, cookie), 400);
  await check("cross-origin diagnostic POST retains the existing origin guard", "/api/inventory", {
    ...json({ dataset: "demo", action: "scan_lookup", payload: { tagIds: [uid], source: "manual" } }, cookie),
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://untrusted.example" },
  }, 403);
  const after = await (await check("diagnostic reads preserve registered batteries and shared business events", "/api/inventory?dataset=demo", { headers: { Cookie: cookie } })).json();
  assert.deepEqual(after.batteries, snapshot.batteries);
  assert.deepEqual(after.events, snapshot.events);
  return { checks: results.length, passed: true, matchedFixtureChecked: true, results };
}
