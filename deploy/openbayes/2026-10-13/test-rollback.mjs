import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceRollbackDispatch } from "./rollback-gateway.mjs";

test("maintenance rollback exposes raw read evidence and ordinary sign-in without forwarding business mutations", async () => {
  const forwarded = [];
  const dispatch = maintenanceRollbackDispatch(async (url, init) => { forwarded.push({ url, init }); return Response.json({ preserved: true }); });
  const origin = "https://zztv-battery.gear-c1.openbayes.net";
  for (const [path, method, body] of [["/api/inventory?dataset=demo", "GET"], ["/api/export", "POST", { dataset: "demo", mode: "detail" }], ["/api/session", "POST", { action: "signin" }], ["/api/session", "POST", { action: "signout" }]]) {
    assert.equal((await dispatch(origin + path, { method, ...(body ? { body: Buffer.from(JSON.stringify(body)) } : {}) })).status, 200);
  }
  assert.equal(forwarded.length, 4);
  for (const [path, method, body] of [["/api/inventory", "POST", { action: "operator_register" }], ["/api/inventory", "POST", { action: "movement" }], ["/api/session", "POST", { action: "setup" }], ["/api/session", "POST", { action: "profile" }], ["/api/task-plans", "GET"], ["/api/messages", "GET"], ["/api/export?format=xlsx", "POST"], ["/api/teaching-checkouts?format=xlsx", "GET"], ["/some-old-ui", "GET"]]) {
    const response = await dispatch(origin + path, { method, ...(body ? { body: Buffer.from(JSON.stringify(body)) } : {}) });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "maintenance_read_only");
  }
  assert.equal(forwarded.length, 4);
  const page = await dispatch(origin + "/", { method: "GET" }); assert.equal(page.status, 200); assert.match(await page.text(), /current database/);
});
