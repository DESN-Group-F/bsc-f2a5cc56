import assert from "node:assert/strict";

/** Exercise lifecycle recovery and deliberate deletion in caller-owned fictional state. */
export async function checkRetiredAssetActions({ check, json, adminCookie, staffCookie }) {
  const read = async (name, url, cookie = staffCookie, status = 200) =>
    (await check(name, url, { headers: { Cookie: cookie } }, status)).json();
  const post = async (name, action, payload, cookie = staffCookie, status = 200) =>
    (await check(name, "/api/inventory", json({ dataset: "demo", action, payload }, cookie), status)).json();
  const initial = await read("retired actions use the authenticated staff owner", "/api/inventory?dataset=demo");
  const owner = initial.people.find(person => person.accountId === initial.user.id);
  const id = "QA-RETIRED-001", tagId = "QA-RETIRED-TAG-001";
  const registration = { id, tagId, name: "Isolated recover and deletion fixture", chemistry: "LiPo", model: "Software-only test", voltage: 11.1, capacityMah: 2200, ownerId: owner.id, homeBuildingId: "J18" };
  const detailUrl = `/api/inventory?dataset=demo&batteryId=${id}`;
  await post("staff can register the isolated retired action fixture", "battery", registration);
  const registered = await read("retired action fixture has its original identity and registration date", detailUrl);
  await post("retired fixture checkout is a normal staff transaction", "movement", { requestId: crypto.randomUUID(), kind: "checkout", batteryIds: [id] });
  const borrowed = await read("retired fixture return captures the exact active loan", detailUrl);
  await post("retired fixture loan is explicitly returned before scrapping", "movement", { requestId: crypto.randomUUID(), kind: "return", batteryIds: [id], expectedLoans: [{ batteryId: id, loanId: borrowed.battery.loanId }] });
  const returned = await read("retired fixture history remains after the return", detailUrl);
  const binding = battery => ({ batteryId: battery.id, version: battery.version, tagId: battery.tagId });
  const scrap = { requestId: crypto.randomUUID(), kind: "scrapped", source: "manual_selection", reason: "Intentional software-only test retirement.", destination: null, items: [binding(returned.battery)] };
  await post("staff can scrap a returned fixture with retained evidence", "lifecycle", scrap);
  const retired = await read("scrapped fixture remains readable before explicit deletion", detailUrl);
  const recover = { requestId: crypto.randomUUID(), kind: "recover", items: [binding(retired.battery)] };
  const recovered = (await post("staff can recover the exact reviewed scrapped fixture", "retired_asset", recover)).result;
  assert.equal(recovered.actorAccountId, initial.user.id);
  assert.equal(recovered.items[0].status, "active");
  assert.equal((await post("recover exact retry returns the original receipt", "retired_asset", recover)).result.replayed, true);
  await post("recover retries cannot switch the reviewed version", "retired_asset", { ...recover, items: [{ ...recover.items[0], version: recover.items[0].version + 1 }] }, staffCookie, 409);
  const restored = await read("recovered fixture preserves its identity, dates, specifications and original history", detailUrl);
  for (const field of ["id", "name", "tagId", "registeredAt", "firstUsedOn", "manufacturedOn", "capacityMah", "voltage", "ownerId", "homeBuildingId"])
    assert.equal(restored.battery[field], registered.battery[field]);
  assert.equal(restored.battery.lifecycleStatus, "active");
  assert.equal(restored.loans.length, returned.loans.length);
  assert.ok(restored.events.some(event => event.action === "battery_scrapped"));
  assert.ok(restored.events.some(event => event.action === "battery_recovered"));
  await post("active batteries cannot be deleted by a retired action", "retired_asset", { requestId: crypto.randomUUID(), kind: "purge", items: [binding(restored.battery)] }, adminCookie, 409);
  await post("recovered batteries may be explicitly scrapped again", "lifecycle", { ...scrap, requestId: crypto.randomUUID(), items: [binding(restored.battery)] });
  const rescrapped = await read("deletion review uses the newly scrapped version", detailUrl);
  const purge = { requestId: crypto.randomUUID(), kind: "purge", items: [binding(rescrapped.battery)] };
  await post("staff cannot permanently delete scrapped battery data", "retired_asset", purge, staffCookie, 403);
  const deleted = (await post("administrator deliberately deletes only the reviewed scrapped fixture", "retired_asset", purge, adminCookie)).result;
  assert.equal(deleted.items[0].status, "deleted");
  assert.equal(deleted.items[0].version, rescrapped.battery.version + 1);
  assert.equal((await post("purge exact retry returns its minimal receipt without deleting another record", "retired_asset", purge, adminCookie)).result.replayed, true);
  await read("deleted fixture details are no longer available", detailUrl, staffCookie, 404);
  const after = await read("deleted fixture leaves only its minimal shared deletion evidence", "/api/inventory?dataset=demo");
  assert.equal(after.batteries.some(battery => battery.id === id), false);
  const evidence = after.purgedBatteries.find(item => item.id === id);
  assert.ok(evidence);
  assert.deepEqual(Object.keys(evidence).sort(), ["actorAccountId", "at", "id"]);
  assert.ok(evidence.at);
  assert.doesNotMatch(JSON.stringify(evidence), /LiPo|2200|11\.1|QA-RETIRED-TAG|Isolated recover/);
  await post("manual registration cannot recycle a permanently deleted BAT ID", "battery", { ...registration, tagId: null }, staffCookie, 409);
  await post("manual registration cannot recycle the deleted tag under another BAT ID", "battery", { ...registration, id: "QA-RETIRED-REUSE" }, staffCookie, 409);
  const exportRequest = { dataset: "demo", mode: "detail", batteryId: id, sections: ["loans", "charges", "observations", "inspections", "audit"] };
  await read("deleted fixture complete history is no longer exportable", `/api/export?request=${encodeURIComponent(JSON.stringify(exportRequest))}&format=json`, staffCookie, 404);
}
