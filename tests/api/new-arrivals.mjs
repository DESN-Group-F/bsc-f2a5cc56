import assert from "node:assert/strict";

/** Two native accounts exercise reminders in caller-owned fictional inventory. */
export async function checkNewArrivals({ check, json, adminCookie, staffCookie }) {
  const read = async (name, cookie = adminCookie, dataset = "demo") => (await check(name, `/api/inventory?dataset=${dataset}`, { headers: { Cookie: cookie } })).json();
  const post = async (name, action, payload, cookie = adminCookie, status = 200) => (await check(name, "/api/inventory", json({ dataset: "demo", action, payload }, cookie), status)).json();
  const initial = await read("arrival snapshot includes server time and a native-account cursor");
  assert.ok(Number.isFinite(Date.parse(initial.newArrivals.serverNow)));
  await post("admin acknowledges only the existing captured arrival cursor", "new_arrivals_ack", { throughSequence: initial.newArrivals.throughSequence });
  await post("staff independently acknowledges the existing inventory arrivals", "new_arrivals_ack", { throughSequence: initial.newArrivals.throughSequence }, staffCookie);
  const staff = await read("arrival registration resolves the native staff owner", staffCookie);
  const owner = staff.people.find(person => person.accountId === staff.user.id);
  for (let n = 1; n <= 3; n++) await post(`staff registers arrival fixture ${n}`, "battery", { id: `QA-ARRIVAL-${n}`, name: `Arrival test battery ${n}`, chemistry: "LiPo", model: "Software-only arrival fixture", capacityMah: null, voltage: 11.1, ownerId: owner.id, homeBuildingId: "J18", tagId: null }, staffCookie);
  const captured = await read("other-account first registrations produce three unread arrivals");
  assert.equal(captured.newArrivals.unreadCount, 3);
  const ids = [1, 2, 3].map(n => `QA-ARRIVAL-${n}`);
  for (const id of ids) assert.equal(captured.newArrivals.items.find(item => item.batteryId === id).isUnread, true);
  const stillUnread = await read("reading the inventory does not acknowledge arrival reminders");
  assert.equal(stillUnread.newArrivals.unreadCount, 3);
  const own = await read("own registrations retain recent labels without own unread reminders", staffCookie);
  assert.equal(own.newArrivals.unreadCount, 0);
  for (const id of ids) assert.equal(own.newArrivals.items.find(item => item.batteryId === id).isUnread, false);
  const live = await read("working and demonstration arrival state remain separate", adminCookie, "live");
  assert.ok(live.newArrivals.items.every(item => !ids.includes(item.batteryId)));
  await post("arrival acknowledgement cannot impersonate another native account", "new_arrivals_ack", { throughSequence: captured.newArrivals.throughSequence, accountId: staff.user.id }, adminCookie, 400);
  await post("unseen future arrival cursors are rejected", "new_arrivals_ack", { throughSequence: captured.newArrivals.throughSequence + 100 }, adminCookie, 409);
  await post("a newer arrival commits after the reviewed cursor was captured", "battery", { id: "QA-ARRIVAL-4", name: "Concurrent registration battery", chemistry: "", model: "", capacityMah: null, voltage: null, ownerId: owner.id, homeBuildingId: "J18", tagId: null }, staffCookie);
  await post("explicit view acknowledges the captured cursor without swallowing a newer arrival", "new_arrivals_ack", { throughSequence: captured.newArrivals.throughSequence });
  const reviewed = await read("newer arrival stays unread while viewed registration labels remain");
  assert.equal(reviewed.newArrivals.unreadCount, 1);
  for (const id of ids) assert.equal(reviewed.newArrivals.items.find(item => item.batteryId === id).isUnread, false);
  assert.equal(reviewed.newArrivals.items.find(item => item.batteryId === "QA-ARRIVAL-4").isUnread, true);
  const exported = await (await check("new-arrivals downloads use the same registration and ordinary query criteria", "/api/export", json({ dataset: "demo", mode: "summary", range: "filtered", filter: { newArrivalsOnly: true, search: "Arrival test battery" } }, adminCookie))).json();
  assert.equal(exported.metadata.matching_batteries, 3);
  assert.deepEqual(exported.tables.Inventory.map(row => row.battery_id).sort(), ids);
  assert.ok(Number.isFinite(Date.parse(exported.metadata.new_arrivals_as_of_utc)));
  await post("an old tab acknowledgement cannot move this account's cursor backward", "new_arrivals_ack", { throughSequence: initial.newArrivals.throughSequence });
  const monotonic = await read("old acknowledgement keeps the unseen newer registration unread");
  assert.equal(monotonic.newArrivals.unreadCount, 1);
  assert.equal(monotonic.newArrivals.acknowledgedThroughSequence, captured.newArrivals.throughSequence);
}
