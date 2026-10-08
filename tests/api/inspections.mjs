import assert from "node:assert/strict";
import ExcelJS from "exceljs";

/** Checks factual records and corrections through authenticated, isolated HTTP. */
export async function checkBatteryInspections({ check, json, adminCookie, staffCookie }) {
  const read = async (name, url, cookie = staffCookie) =>
    (await check(name, url, { headers: { Cookie: cookie } })).json();
  const post = async (name, action, payload, cookie = staffCookie, status = 200, dataset = "demo") =>
    (await check(name, "/api/inventory", json({ dataset, action, payload }, cookie), status)).json();
  const snapshot = await read("inspection setup reads the current staff identity", "/api/inventory?dataset=demo");
  const owner = snapshot.people.find(person => person.accountId === snapshot.user.id);
  const id = "QA-INSPECTION-001";
  await post("staff may register the isolated inspection fixture", "battery", {
    id, name: "Demonstration inspection fixture", ownerId: owner.id, homeBuildingId: "J18",
  });
  const detailUrl = `/api/inventory?dataset=demo&batteryId=${id}`;
  const before = await read("new battery has factual empty histories", detailUrl);
  assert.equal(before.inspectionSummary.totalRecords, 0);
  assert.equal(before.inspectionSummary.latest, null);
  assert.equal(before.usageSummary.totalCheckouts, 0);
  assert.equal(before.usageSummary.totalCheckedOutSeconds, 0);
  const payload = {
    requestId: crypto.randomUUID(), batteryId: id, expectedBatteryVersion: before.battery.version,
    kind: "visual_check", outcome: "inconclusive", performedAt: new Date(Date.now() - 60_000).toISOString(),
    method: "Software fixture; no physical inspection performed.", notes: "HTTP workflow verification only.", reference: "", capacityMah: null,
  };
  const created = (await post("staff can append an attributed inspection", "inspection", payload)).result;
  assert.equal(created.actorAccountId, snapshot.user.id);
  assert.equal(created.requestId, payload.requestId);
  assert.equal(created.replayed, false);
  const replayed = (await post("repeating an exact inspection request cannot duplicate the check", "inspection", payload)).result;
  assert.equal(replayed.inspectionId, created.inspectionId);
  assert.equal(replayed.replayed, true);
  await post("inspection retries cannot change captured findings", "inspection", { ...payload, notes: "Changed result" }, staffCookie, 409);
  await post("clients cannot substitute a different inspector", "inspection", { ...payload, requestId: crypto.randomUUID(), inspectorAccountId: "another-account" }, staffCookie, 400);
  await post("future inspection dates are rejected", "inspection", { ...payload, requestId: crypto.randomUUID(), performedAt: new Date(Date.now() + 86_400_000).toISOString() }, staffCookie, 400);
  await post("stale reviewed battery versions are rejected", "inspection", { ...payload, requestId: crypto.randomUUID(), expectedBatteryVersion: before.battery.version + 1 }, staffCookie, 409);
  await post("inspection records cannot cross inventory datasets", "inspection", { ...payload, requestId: crypto.randomUUID() }, staffCookie, 404, "live");
  const recorded = await read("inspection detail shows attributed findings without changing borrowing", detailUrl);
  assert.equal(recorded.inspectionSummary.totalRecords, 1);
  assert.equal(recorded.inspectionSummary.validRecords, 1);
  assert.equal(recorded.inspectionSummary.latest.id, created.inspectionId);
  assert.equal(recorded.inspections[0].inspectorAccountId, snapshot.user.id);
  assert.equal(recorded.inspections[0].method, payload.method);
  assert.equal(recorded.battery.version, before.battery.version);
  assert.equal(recorded.usageSummary.totalCheckouts, before.usageSummary.totalCheckouts);
  const correction = { requestId: crypto.randomUUID(), batteryId: id, inspectionId: created.inspectionId, reason: "Intentional isolated software test correction." };
  await post("staff cannot void shared inspection evidence", "inspection_void", correction, staffCookie, 403);
  const voided = (await post("admin can retain an inspection while marking it entered in error", "inspection_void", correction, adminCookie)).result;
  assert.equal(voided.inspectionId, created.inspectionId);
  assert.equal((await post("inspection correction exact retry returns the original receipt", "inspection_void", correction, adminCookie)).result.replayed, true);
  const corrected = await read("voided records remain visible but no longer count as the latest check", detailUrl);
  assert.equal(corrected.inspectionSummary.totalRecords, 1);
  assert.equal(corrected.inspectionSummary.validRecords, 0);
  assert.equal(corrected.inspectionSummary.latest, null);
  assert.equal(corrected.inspections[0].outcome, payload.outcome);
  assert.equal(corrected.inspections[0].voidReason, correction.reason);
  assert.ok(corrected.inspections[0].voidedAt);
  const request = { dataset: "demo", mode: "detail", batteryId: id, sections: ["inspections"] };
  const download = format => `/api/export?request=${encodeURIComponent(JSON.stringify(request))}&format=${format}`;
  const exported = await read("staff can export complete retained inspection evidence", download("json"));
  assert.equal(exported.tables.Inspections.length, 1);
  assert.equal(exported.tables.Inspections[0].voidReason, correction.reason);
  assert.equal(exported.tables.Inspections[0].inspectorAccountId, snapshot.user.id);
  const response = await check("inspection workbook includes readable and original evidence sheets", download("xlsx"), { headers: { Cookie: staffCookie } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.ok(workbook.getWorksheet("Inspection history"));
  assert.equal(workbook.getWorksheet("Evidence Inspections").state, "hidden");
}
