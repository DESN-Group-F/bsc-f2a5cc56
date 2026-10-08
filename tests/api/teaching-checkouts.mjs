import assert from "node:assert/strict";
import ExcelJS from "exceljs";

/** Exercise reviewed replacements through authenticated isolated HTTP, never hardware. */
export async function checkTeachingCheckouts({ check, json, adminCookie, staffCookie }) {
  const read = async (name, path, cookie = staffCookie) => (await check(name, path, { headers: { Cookie: cookie } })).json();
  const post = async (name, action, payload, cookie = staffCookie, status = 200) => (await check(name, "/api/inventory", json({ dataset: "demo", action, payload }, cookie), status)).json();
  const save = async (name, payload, cookie = staffCookie, status = 200) => (await check(name, "/api/teaching-checkouts", json({ dataset: "demo", payload }, cookie), status)).json();
  await check("anonymous teaching checkout access is rejected", "/api/teaching-checkouts?dataset=demo", {}, 401);
  const snapshot = await read("teaching replacement setup loads staff native identity", "/api/inventory?dataset=demo");
  const owner = snapshot.people.find(person => person.accountId === snapshot.user.id);
  for (const [id, model, chemistry, capacityMah, voltage, tagId] of [["QA-TEACH-ORIGINAL", "PACK", "LiPo", 2200, 7.4, null], ["QA-TEACH-FREE", "PACK", "LiPo", 2200, 7.4, null], ["QA-TEACH-MANUAL", "OTHER", "", null, null, "nfc:uid:00112233"], ["QA-TEACH-SECOND", "PACK", "LiPo", 2200, 7.4, null]]) await post(`register teaching checkout fixture ${id}`, "battery", { id, name: `Teaching HTTP fixture ${id}`, model, chemistry, capacityMah, voltage, tagId, ownerId: owner.id, homeBuildingId: "J18" });
  const definition = { action: "create", requestId: crypto.randomUUID(), id: crypto.randomUUID(), name: "HTTP teaching set", batteryIds: ["QA-TEACH-ORIGINAL", "QA-TEACH-SECOND"] };
  const group = (await (await check("staff creates own fixed teaching selection", "/api/teaching-groups", json({ dataset: "demo", payload: definition }, staffCookie))).json()).result.group;
  await post("another person borrows the original fixed member", "movement", { requestId: crypto.randomUUID(), kind: "checkout", batteryIds: ["QA-TEACH-ORIGINAL"] }, adminCookie);
  const details = {};
  for (const id of definition.batteryIds.concat(["QA-TEACH-FREE", "QA-TEACH-MANUAL"])) details[id] = (await read(`review teaching binding ${id}`, `/api/inventory?dataset=demo&batteryId=${id}`)).battery;
  const binding = id => ({ batteryId: id, tagId: details[id].tagId, version: details[id].version });
  const payload = { action: "checkout", requestId: crypto.randomUUID(), teachingGroup: { id: group.id, version: group.version }, personalScope: "all", mappings: [{ original: binding("QA-TEACH-ORIGINAL"), actual: binding("QA-TEACH-MANUAL"), originalLoanId: details["QA-TEACH-ORIGINAL"].loanId, method: "automatic", source: { kind: "selection" } }] };
  const rejected = await save("strict automatic recommendations refuse unknown and different specifications", payload, staffCookie, 409);
  assert.equal(rejected.code, "teaching_checkout_rejected_final");
  const at = new Date().toISOString(), evidence = { attemptId: crypto.randomUUID(), source: "native-nfc-reader", platform: "android", startedAt: at, endedAt: at, adoptedAt: at, tagId: "nfc:uid:00112233", result: { uidHex: "00112233", technology: "NFC-A", ndefStatus: "unknown", capacityBytes: null, records: [], observedAt: at } };
  const manual = { ...payload, requestId: crypto.randomUUID(), mappings: [{ ...payload.mappings[0], method: "manual", source: { kind: "native_nfc", evidence } }, { original: binding("QA-TEACH-SECOND"), actual: binding("QA-TEACH-SECOND"), originalLoanId: null, method: "original", source: { kind: "selection" } }] };
  const saved = (await save("manual NFC adapter evidence can select a different unknown-specification registered battery", manual)).result;
  assert.equal(saved.run.mappings[0].method, "manual"); assert.equal(saved.run.mappings[0].specificationMatch, false); assert.deepEqual(saved.run.mappings[0].source.evidence, evidence);
  assert.equal((await save("exact teaching retry returns original mapping and loan IDs", manual)).result.replayed, true);
  await save("an original request cannot change its scanned source", { ...manual, mappings: [{ ...manual.mappings[0], source: { kind: "tag" } }, manual.mappings[1]] }, staffCookie, 409);
  const own = await read("own teaching checkouts expose exact outstanding actual loans", "/api/teaching-checkouts?dataset=demo");
  const run = own.runs.find(run => run.id === saved.run.id); assert.equal(run.items.filter(item => item.status === "outstanding").length, 2);
  const other = await read("another account list does not expose this own teaching checkout", "/api/teaching-checkouts?dataset=demo", adminCookie); assert.ok(!other.runs.some(item => item.id === run.id));
  const groups = await read("temporary replacement preserves original fixed membership", "/api/teaching-groups?dataset=demo"); assert.deepEqual(groups.groups.find(item => item.id === group.id).batteryIds, definition.batteryIds);
  const partial = { action: "return", requestId: crypto.randomUUID(), runId: saved.run.id, personalScope: "all", items: [{ batteryId: run.items[0].batteryId, tagId: run.items[0].tagId, version: run.items[0].version, loanId: run.items[0].loanId }] };
  await save("a receiver returns only the reviewed actual loan from a partial checkout", partial, adminCookie);
  assert.equal((await save("partial return exact retry remains a receipt replay", partial, adminCookie)).result.replayed, true);
  const completed = (await read("partial completion retains the other outstanding actual member", `/api/teaching-checkouts?dataset=demo&runId=${run.id}`)).runs[0]; assert.equal(completed.items[0].status, "returned"); assert.equal(completed.items[1].status, "outstanding");
  await post("a later loan can be opened for the returned alternative", "movement", { requestId: crypto.randomUUID(), kind: "checkout", batteryIds: [partial.items[0].batteryId] }, adminCookie);
  await save("returning an old run cannot return the alternative's newer loan", { ...partial, requestId: crypto.randomUUID() }, staffCookie, 409);
  const exported = await read("teaching checkout JSON retains both original and actual mapping evidence", `/api/teaching-checkouts?dataset=demo&runId=${run.id}&format=json`); assert.equal(exported.tables.teaching_mappings.length, 2);
  const exportedLoan = exported.tables.Loans.find(loan => loan.id === partial.items[0].loanId);
  assert.equal(exported.tables.Loans.length, 2); assert.ok(exportedLoan.return_actor_id); assert.ok(exportedLoan.returned_at);
  assert.equal(exported.tables.Activity.filter(event => event.action === "return").length, 1);
  assert.ok(exported.tables.Activity.every(event => saved.run.mappings.some(mapping => mapping.loanId === JSON.parse(event.details_json).loanId)));
  const receiverExport = await read("a receiver's teaching report records the authenticated exporter separately from the borrower", `/api/teaching-checkouts?dataset=demo&runId=${run.id}&format=json`, adminCookie);
  assert.notEqual(receiverExport.metadata.operatorAccountId, saved.run.actorAccountId); assert.equal(receiverExport.metadata.actorAccountId, saved.run.actorAccountId);
  const response = await check("teaching checkout Excel includes actual mapping and historical loans", `/api/teaching-checkouts?dataset=demo&runId=${run.id}&format=xlsx`, { headers: { Cookie: staffCookie } }); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer())); assert.ok(workbook.worksheets.length >= 1); assert.match(JSON.stringify(workbook.model), /QA-TEACH-MANUAL/);
  await check("a missing teaching checkout download returns an explicit error", `/api/teaching-checkouts?dataset=demo&runId=${crypto.randomUUID()}&format=json`, { headers: { Cookie: staffCookie } }, 404);
}
