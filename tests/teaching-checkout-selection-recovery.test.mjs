import { test } from "node:test";
import assert from "node:assert/strict";
import { initialTeachingSelection, suggestTeachingReplacements, eligibleTeachingAlternatives } from "../work/qa/teaching-checkout-selection.mjs";
import { captureTeachingCheckoutAttempt, recoverTeachingCheckoutAttempt, verifyTeachingCheckoutReceipt, teachingCheckoutFailureStatus, persistTeachingCheckoutAttempt } from "../work/qa/client/teaching-checkout-request.mjs";
import { teachingSpecificationsMatch, teachingSpecificationDifferences } from "../work/qa/teaching-checkouts.mjs";
import { redactBatteryEvidence } from "../work/qa/server/purge-evidence.mjs";
import { createTeachingCheckoutExport } from "../work/qa/teaching-checkout-export.mjs";
import { createHumanReport } from "../work/qa/export-report.mjs";
import { groupActivity, teachingReplacementDescription } from "../work/qa/group-activity.mjs";
import { downloadTeachingCheckoutReport } from "../work/qa/client/teaching-checkout-download.mjs";

const at = "2026-10-08T06:00:00.000Z", requestId = "ed5ca45f-bf04-4c21-9871-96b890bec7d1", groupId = "ef2e801b-8fda-4419-8e17-8a7c6fb36f54", loanId = "1f3a83ae-56be-4c36-962e-82272b369c8c", priorLoanId = "78e91d63-6a49-4bcd-8d3b-6368078eaad6";
function battery(id, changes = {}) { return { id, name: id, version: 1, tagId: null, model: "Model A", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, lifecycleStatus: "active", ownerAccountId: "teacher", loanId: null, borrowerAccountId: null, homeRoomId: null, homeBuildingId: null, homeRoomName: null, homeRoomIsPlaceholder: null, ...changes }; }
function fixture(extra = []) {
  const retained = battery("MEMBER-1", { homeRoomId: "R2", homeBuildingId: "B1", homeRoomIsPlaceholder: false });
  const blocked = battery("MEMBER-2", { loanId: priorLoanId, borrowerAccountId: "other" });
  const group = { id: groupId, version: 1, ownerAccountId: "teacher", state: "active", name: "Class", notes: "", batteryIds: [retained.id, blocked.id], createdAt: at, updatedAt: at };
  const data = { user: { id: "teacher" }, dataset: "demo", batteries: [retained, blocked, ...extra], rooms: [{ id: "R1", buildingId: "B1", isPlaceholder: false }, { id: "R2", buildingId: "B1", isPlaceholder: false }, { id: "PLACEHOLDER", buildingId: "B1", isPlaceholder: true }], buildings: [{ id: "B1" }] };
  return { data, group, slots: initialTeachingSelection(data, group, group.batteryIds, "all") };
}
test("suggestions keep fixed members and require known specifications without assuming a collection location", () => {
  const f = fixture([battery("BAT-1", { homeRoomId: "R1", homeBuildingId: "B1", homeRoomIsPlaceholder: false }), battery("BAT-2", { homeRoomId: "R2", homeBuildingId: "B1", homeRoomIsPlaceholder: false }), battery("BAT-0", { capacityMah: null, homeRoomId: "R2", homeBuildingId: "B1", homeRoomIsPlaceholder: false })]);
  const original = structuredClone(f.group), result = suggestTeachingReplacements(f.data, f.slots, "all");
  assert.equal(result[1].actual.id, "BAT-1"); assert.equal(result[1].method, "automatic"); assert.deepEqual(f.group, original); assert.equal(f.slots[1].actual, null);
});
test("registered homes and last observations do not change automatic stock ranking", () => {
  const f = fixture([battery("BAT-1", { homeRoomId: "PLACEHOLDER", homeBuildingId: "B1", homeRoomIsPlaceholder: false, observedRoomId: "R2", observedAt: at }), battery("BAT-2", { homeRoomId: "R1", homeBuildingId: "B1", homeRoomIsPlaceholder: false })]);
  assert.equal(suggestTeachingReplacements(f.data, f.slots, "all")[1].actual.id, "BAT-1");
});
test("automatic drafts never duplicate candidates and keep manual choices on repeated suggestions", () => {
  const f = fixture([battery("BAT-1")]);
  f.data.batteries.push(battery("MEMBER-3", { loanId: loanId, borrowerAccountId: "other" })); f.group.batteryIds.push("MEMBER-3");
  const result = suggestTeachingReplacements(f.data, initialTeachingSelection(f.data, f.group, f.group.batteryIds, "all"), "all");
  assert.equal(result.filter(slot => slot.actual?.id === "BAT-1").length, 1); assert.match(result[2].issue, /manual alternative/);
  result[1].method = "manual"; result[1].source = { kind: "tag" };
  assert.deepEqual(suggestTeachingReplacements(f.data, result, "all")[1], result[1]);
});
test("manual pool admits unknown and differing specifications but maintains personal scope and availability", () => {
  const f = fixture([battery("MANUAL", { capacityMah: null, model: "Other" }), battery("FOREIGN", { ownerAccountId: "other" }), battery("HELD", { loanId, borrowerAccountId: "other" }), battery("RETIRED", { lifecycleStatus: "scrapped" })]);
  assert.deepEqual(eligibleTeachingAlternatives(f.data, f.slots, "responsible", "MEMBER-2").map(item => item.id), ["MANUAL"]);
  assert.equal(eligibleTeachingAlternatives(f.data, f.slots, "borrowed", "MEMBER-2").length, 0);
  assert.equal(teachingSpecificationsMatch(f.data.batteries[1], f.data.batteries[2]), false);
  assert.deepEqual(teachingSpecificationDifferences(f.data.batteries[1], f.data.batteries[2]), ["model: differs", "capacityMah: unknown information"]);
});
function requestFixture() {
  const binding = id => ({ batteryId: id, tagId: null, version: 1 });
  const payload = { action: "checkout", requestId, teachingGroup: { id: groupId, version: 1 }, personalScope: "all", mappings: [{ original: binding("ORIGINAL"), actual: binding("ACTUAL"), originalLoanId: priorLoanId, method: "manual", source: { kind: "selection" } }] };
  const snapshot = id => ({ ...binding(id), name: id, model: "Model A", chemistry: "LiPo", capacityMah: 2200, voltage: 7.4, homeBuildingId: null, homeRoomId: null, homeRoomName: null, homeRoomIsPlaceholder: null });
  const run = { id: requestId, dataset: "demo", actorAccountId: "teacher", actorName: "Teacher", teachingGroup: { id: groupId, version: 1, name: "Class", ownerAccountId: "teacher", operationId: requestId, batteryIds: ["ACTUAL"] }, requestedBatteryIds: ["ORIGINAL"], mappings: [{ original: snapshot("ORIGINAL"), actual: snapshot("ACTUAL"), originalLoanId: priorLoanId, method: "manual", source: { kind: "selection" }, loanId, specificationMatch: true, differences: [] }], createdAt: at };
  const attempt = captureTeachingCheckoutAttempt("teacher", "demo", payload, { run });
  const receipt = { requestId, actorAccountId: "teacher", dataset: "demo", action: "checkout", run, at };
  return { payload, attempt, receipt, run };
}
test("recovery preserves exact original mapping, source, IDs and review across inventory changes", () => {
  const { attempt } = requestFixture(), saved = JSON.stringify(attempt);
  assert.deepEqual(recoverTeachingCheckoutAttempt(saved, "teacher", "demo"), attempt);
  assert.throws(() => recoverTeachingCheckoutAttempt(saved, "teacher", "live")); assert.throws(() => recoverTeachingCheckoutAttempt("broken", "teacher", "demo"));
});
test("matching receipts establish success while altered source, actual tag, group version and loans do not", () => {
  const { attempt, receipt } = requestFixture(); assert.deepEqual(verifyTeachingCheckoutReceipt(receipt, attempt), receipt);
  for (const change of [r => { r.run.mappings[0].source.kind = "tag"; }, r => { r.run.mappings[0].actual.tagId = "changed"; }, r => { r.run.teachingGroup.version++; }, r => { r.run.mappings[0].loanId = null; }, r => { r.actorAccountId = "other"; }]) {
    const altered = structuredClone(receipt); change(altered); assert.throws(() => verifyTeachingCheckoutReceipt(altered, attempt));
  }
  assert.equal(teachingCheckoutFailureStatus({ status: 409 }, true), "uncertain"); assert.equal(teachingCheckoutFailureStatus({ status: 409, code: "teaching_checkout_rejected_final" }, true), "rejected");
});
test("failed recovery storage readback blocks write preparation", () => {
  const oldStorage = globalThis.sessionStorage, oldWindow = globalThis.window;
  globalThis.sessionStorage = { setItem() {}, getItem() { return null; } }; globalThis.window = { dispatchEvent() {} };
  try { assert.throws(() => persistTeachingCheckoutAttempt("teacher", "demo", requestFixture().attempt), /could not be saved/); } finally { globalThis.sessionStorage = oldStorage; globalThis.window = oldWindow; }
});

test("oversized native reader evidence blocks request capture without truncating the reviewed draft", () => {
  const { payload } = requestFixture();
  const evidence = { attemptId: requestId, source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: "nfc:uid:00112233", result: { uidHex: "00112233", technology: "Controlled adapter fixture", ndefStatus: "readOnly", capacityBytes: null, records: Array.from({ length: 8 }, () => ({ tnf: 1, typeHex: "55", idHex: "", payloadHex: "AA".repeat(16384) })), observedAt: at } };
  payload.mappings[0].actual.tagId = evidence.tagId;
  payload.mappings[0].source = { kind: "native_nfc", evidence };
  const original = structuredClone(payload);
  assert.throws(() => captureTeachingCheckoutAttempt("teacher", "demo", payload, { payload }), /request size limit/);
  assert.deepEqual(payload, original);
  payload.mappings[0].source.evidence.result.records = evidence.result.records.slice(0, 1);
  assert.equal(captureTeachingCheckoutAttempt("teacher", "demo", payload).payload.mappings[0].source.evidence.result.records[0].payloadHex.length, 32768);
});
test("an exact partial return accepts deletion-only history cleanup without accepting altered remaining evidence", () => {
  const { run } = requestFixture();
  const other = structuredClone(run.mappings[0]); other.original.batteryId = "OTHER-ORIGINAL"; other.actual.batteryId = "OTHER-ACTUAL"; other.loanId = "914cc399-94fa-4d22-a7fb-f50b603d104b";
  run.mappings.push(other); run.requestedBatteryIds.push(other.original.batteryId); run.teachingGroup.batteryIds.push(other.actual.batteryId);
  const items = [{ batteryId: "ACTUAL", tagId: null, version: 1, loanId, source: { kind: "selection" } }];
  const returnId = "b24a5730-e90b-498e-a7d3-8d365a7c257e", attempt = captureTeachingCheckoutAttempt("teacher", "demo", { action: "return", requestId: returnId, runId: run.id, personalScope: "all", items }, { run: { ...run, items: [] } });
  const deleted = redactBatteryEvidence(run, new Set(["OTHER-ACTUAL", "ORIGINAL"]), new Set());
  const receipt = JSON.parse(JSON.stringify({ requestId: returnId, actorAccountId: "teacher", dataset: "demo", action: "return", run: deleted, returnedItems: items, at }));
  assert.deepEqual(verifyTeachingCheckoutReceipt(receipt, attempt), JSON.parse(JSON.stringify(receipt)));
  const changed = structuredClone(receipt); changed.run.mappings[0].actual.model = "Unreviewed"; assert.throws(() => verifyTeachingCheckoutReceipt(changed, attempt));
  const wrongLoan = structuredClone(receipt); wrongLoan.run.mappings[0].loanId = other.loanId; assert.throws(() => verifyTeachingCheckoutReceipt(wrongLoan, attempt));
});
test("purging actual replacement removes its raw reader evidence and comparisons while preserving independent original snapshot", () => {
  const { run } = requestFixture(); run.mappings[0].source = { kind: "native_nfc", evidence: { rawUid: "SECRET-UID", rawNdef: "secret data" } }; run.mappings[0].differences = ["private model differs"];
  const redacted = redactBatteryEvidence(run, new Set(["ACTUAL"]), new Set(["scope/ACTUAL"]));
  assert.deepEqual(redacted.mappings[0].actual, { batteryId: "ACTUAL", deleted: true }); assert.equal(redacted.mappings[0].loanId, null); assert.equal(redacted.mappings[0].source, undefined); assert.deepEqual(redacted.mappings[0].differences, []); assert.equal(redacted.mappings[0].original.name, "ORIGINAL"); assert.doesNotMatch(JSON.stringify(redacted), /SECRET-UID|private model|secret data/);
});
test("run reports and shared history retain original-to-actual manual mapping and exact loan status", () => {
  const { run } = requestFixture(), listed = { ...run, items: [{ batteryId: "ACTUAL", loanId, status: "returned", tagId: null, version: 1, returnedAt: at }] };
  const exported = createTeachingCheckoutExport(listed); assert.equal(exported.tables.teaching_mappings[0].exact_loan_status, "returned"); assert.deepEqual(exported.tables.teaching_evidence[0].snapshot, listed);
  const human = createHumanReport(exported), mapping = human.sheets.find(sheet => sheet.name === "Actual checkout mapping").rows[0]; assert.equal(human.title, "Teaching checkout report"); assert.equal(mapping["Selection method"], "Manual alternative"); assert.equal(mapping["Exact loan ID"], loanId);
  const event = { id: "event", batteryId: "ACTUAL", action: "checkout", actorName: "Teacher", at, details: { teachingGroup: run.teachingGroup, teachingCheckout: run } };
  assert.equal(groupActivity([event]).length, 1); assert.match(teachingReplacementDescription(event), /ORIGINAL → ACTUAL · Manual alternative/);
});

test("actual checkout JSON downloads accept the complete listed snapshot and retain exact returned loan evidence", async context => {
  const { run } = requestFixture(), listed = { ...run, items: [{ batteryId: "ACTUAL", loanId, status: "returned", tagId: null, version: 1, returnedAt: at }] };
  const report = createTeachingCheckoutExport(listed), bodies = [], links = [], requests = [];
  context.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, options }); return Response.json(report, { headers: { "Content-Disposition": 'attachment; filename="actual-checkout.json"' } }); });
  context.mock.method(URL, "createObjectURL", blob => { bodies.push(blob); return "blob:controlled-checkout"; });
  context.mock.method(globalThis, "setTimeout", () => 0);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ click() { links.push(this); }, remove() {} }), body: { appendChild() {} } } });
  context.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  await downloadTeachingCheckoutReport("demo", run.id, "json");
  assert.equal(links.length, 1); assert.equal(links[0].download, "actual-checkout.json");
  assert.deepEqual(JSON.parse(await bodies[0].text()), report);
  assert.equal(requests[0].url, `/api/teaching-checkouts?dataset=demo&runId=${run.id}&format=json`);
  assert.equal(requests[0].options.cache, "no-store");
  report.tables.teaching_evidence[0].snapshot.items[0].status = "invented";
  await assert.rejects(downloadTeachingCheckoutReport("demo", run.id, "json"), /incomplete export/);
  report.tables.teaching_evidence[0].snapshot.items[0].status = "returned";
  report.metadata.dataset = "live";
  await assert.rejects(downloadTeachingCheckoutReport("demo", run.id, "json"), /incomplete export/);
  assert.equal(links.length, 1);
});
