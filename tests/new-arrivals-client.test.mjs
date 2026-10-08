import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";

// Evaluate the actual hooks and transport with deterministic hook state. Layout
// effects run at commit; passive effects can be delayed to exercise response races.
// This harness verifies handlers and queries, not browser scheduling or layout.
const files = ["lib/new-arrivals.ts", "lib/client/inventory-request.ts", "hooks/use-new-arrivals.ts", "hooks/use-inventory-data.ts"];
const source = (await Promise.all(files.map(file => readFile(new URL(`../${file}`, import.meta.url), "utf8")))).join("\n");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const windowMs = 48 * 60 * 60 * 1000;
const nativeAccount = "staff-native-01";
const serverNow = "2026-10-08T01:00:00.000Z";
const iso = value => new Date(value).toISOString();

function snapshot({ dataset = "demo", account = nativeAccount, cursor = 41, acknowledged = 39, now = serverNow, items } = {}) {
  const registrations = items ?? [
    { batteryId: "BAT-SELF", sequence: 40, registeredAt: iso(Date.parse(now) - 1000), isUnread: false },
    { batteryId: "BAT-OTHER", sequence: 41, registeredAt: iso(Date.parse(now) - 1000), isUnread: true },
  ];
  return {
    dataset, user: { id: account, username: "staff.one", role: "staff", defaultDataset: dataset },
    batteries: [], rooms: [], events: [], staffDirectory: [],
    newArrivals: { serverNow: now, throughSequence: cursor, acknowledgedThroughSequence: acknowledged,
      unreadCount: registrations.filter(item => item.isUnread).length, items: registrations },
  };
}

function hooksHarness() {
  const cells = [], passive = new Map(), layout = new Map();
  let index = 0, clock = 0, changed = false;
  const same = (left, right) => !!left && !!right && left.length === right.length && left.every((value, offset) => Object.is(value, right[offset]));
  function memo(factory, dependencies) {
    const slot = index++;
    if (!cells[slot] || !same(cells[slot].dependencies, dependencies)) cells[slot] = { value: factory(), dependencies };
    return cells[slot].value;
  }
  function effect(queue, callback, dependencies) {
    const slot = index++;
    if (!cells[slot]) cells[slot] = { dependencies: undefined, cleanup: undefined };
    if (!same(cells[slot].dependencies, dependencies)) queue.set(slot, { callback, dependencies });
  }
  function flush(queue) {
    for (const [slot, pending] of queue) {
      cells[slot].cleanup?.();
      cells[slot].dependencies = pending.dependencies;
      cells[slot].cleanup = pending.callback();
    }
    queue.clear();
  }
  const hooks = {
    useState(initial) {
      const slot = index++;
      if (!cells[slot]) cells[slot] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[slot].value, next => {
        const value = typeof next === "function" ? next(cells[slot].value) : next;
        if (!Object.is(value, cells[slot].value)) { cells[slot].value = value; changed = true; }
      }];
    },
    useRef(initial) {
      const slot = index++;
      if (!cells[slot]) cells[slot] = { value: { current: initial } };
      return cells[slot].value;
    },
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useEffect: (callback, dependencies) => effect(passive, callback, dependencies),
    useLayoutEffect: (callback, dependencies) => effect(layout, callback, dependencies),
    useSyncExternalStore() { index++; return clock; },
  };
  const bindings = { z, ...hooks, reloadSessionPage() { throw new Error("Unexpected sign-in navigation"); } };
  const evaluated = new Function(...Object.keys(bindings), `${compiled}\nreturn { useNewArrivals, useInventoryData, inventoryRevisionKey, recentNewArrivals, advanceArrivalClock };`)(...Object.values(bindings));
  return {
    ...evaluated,
    setClock(value) { clock = value; },
    render(callback, { passiveEffects = true } = {}) {
      let result, attempts = 0;
      do {
        changed = false; index = 0; layout.clear(); passive.clear(); result = callback();
        assert.ok(++attempts <= 10, "Render updates must settle");
      } while (changed);
      flush(layout);
      if (passiveEffects) flush(passive);
      return result;
    },
    flushEffects() { flush(passive); },
    unmount() { cells.forEach(cell => cell?.cleanup?.()); passive.clear(); layout.clear(); },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function receipt(body, changes = {}) {
  return Response.json({ ok: true, result: {
    dataset: body.dataset, actorAccountId: nativeAccount,
    acknowledgedThroughSequence: body.payload.throughSequence, ...changes,
  } });
}
function arrivalsHarness(data = snapshot()) {
  const hooks = hooksHarness(), loads = [];
  const load = async (dataset, signal) => { loads.push({ dataset, signal }); };
  return { hooks, loads, load, render(options) { return hooks.render(() => hooks.useNewArrivals(data, load), options); },
    replace(next) { data = next; } };
}

test("new arrivals never acknowledge through rendering, own registration, clock ticks, account changes or inventory changes", async context => {
  const writes = [];
  context.mock.method(globalThis, "fetch", async (url, options) => { writes.push({ url, options }); throw new Error("No request expected"); });
  const view = arrivalsHarness();
  assert.equal(view.render().arrivals.items.find(item => item.batteryId === "BAT-SELF").isUnread, false);
  view.hooks.setClock(10000); view.render();
  view.replace(snapshot({ account: "other-native-account" })); view.render();
  view.replace(snapshot({ dataset: "live", account: "other-native-account" })); view.render();
  view.replace(null); assert.equal(view.render().arrivals, undefined);
  view.replace(snapshot()); view.render();
  assert.deepEqual(writes, []); assert.deepEqual(view.loads, []);
  view.hooks.unmount();
});

test("repeated clicks share one captured cursor and a verified result refreshes its native account and inventory once", async context => {
  const response = deferred(), requests = [], view = arrivalsHarness();
  context.mock.method(globalThis, "fetch", (url, options) => {
    assert.equal(url, "/api/inventory"); requests.push({ body: JSON.parse(options.body), signal: options.signal }); return response.promise;
  });
  const first = view.render();
  const saving = first.acknowledge(41);
  await first.acknowledge(42);
  assert.equal(view.render().pending, true); assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { dataset: "demo", action: "new_arrivals_ack", payload: { throughSequence: 41 } });
  response.resolve(receipt(requests[0].body)); await saving;
  assert.equal(view.loads.length, 1); assert.equal(view.loads[0].dataset, "demo");
  assert.equal(view.loads[0].signal, requests[0].signal);
  assert.equal(view.render().pending, false); assert.equal(view.render().error, "");
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await view.render().acknowledge(invalid);
  assert.equal(requests.length, 1);
  view.hooks.unmount();
});

test("a failed acknowledgement keeps the unread projection and retries its original cursor after a later registration", async context => {
  const requests = [], view = arrivalsHarness();
  context.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (requests.length === 1) throw new Error("Connection interrupted after acknowledgement");
    return receipt(body);
  });
  await view.render().acknowledge(41);
  let state = view.render();
  assert.match(state.error, /interrupted/i); assert.equal(state.pending, false);
  assert.equal(state.arrivals.unreadCount, 1); assert.deepEqual(view.loads, []);
  view.replace(snapshot({ cursor: 42, items: [...snapshot().newArrivals.items,
    { batteryId: "BAT-LATER", sequence: 42, registeredAt: serverNow, isUnread: true }] }));
  state = view.render();
  await state.acknowledge(42);
  assert.deepEqual(requests.map(body => body.payload.throughSequence), [41, 41], "Retry must not acknowledge the later unseen registration");
  assert.equal(view.render().error, ""); assert.equal(view.loads.length, 1);
  view.hooks.unmount();
});

for (const contextChange of [
  { name: "dataset", next: snapshot({ dataset: "live" }) },
  { name: "native account", next: snapshot({ account: "staff-native-02" }) },
]) test(`late acknowledgement after a committed ${contextChange.name} switch cannot query the older context before passive effects`, async context => {
  const response = deferred(), requests = [], view = arrivalsHarness();
  context.mock.method(globalThis, "fetch", (url, options) => {
    requests.push({ body: JSON.parse(options.body), signal: options.signal }); return response.promise;
  });
  const saving = view.render().acknowledge(41);
  view.replace(contextChange.next); const next = view.render({ passiveEffects: false });
  assert.equal(next.pending, false); assert.equal(next.error, "");
  response.resolve(receipt(requests[0].body)); await saving;
  assert.deepEqual(view.loads, []); assert.equal(requests[0].signal.aborted, true);
  view.hooks.flushEffects(); view.hooks.unmount();
});

test("leaving and re-entering an inventory keeps aborted requests from refreshing or clearing the new request", async context => {
  const responses = [], requests = [], view = arrivalsHarness();
  context.mock.method(globalThis, "fetch", (url, options) => {
    const result = deferred(); responses.push(result); requests.push({ body: JSON.parse(options.body), signal: options.signal }); return result.promise;
  });
  const oldSaving = view.render().acknowledge(41);
  view.replace(snapshot({ dataset: "live", cursor: 15 })); view.render();
  view.replace(snapshot({ cursor: 42 }));
  const nextSaving = view.render().acknowledge(42);
  assert.equal(requests.length, 2); assert.equal(requests[0].signal.aborted, true);
  responses[0].resolve(receipt(requests[0].body)); await oldSaving;
  assert.equal(view.render().pending, true); assert.deepEqual(view.loads, []);
  responses[1].resolve(receipt(requests[1].body)); await nextSaving;
  assert.equal(view.loads.length, 1); assert.equal(view.loads[0].signal, requests[1].signal);
  assert.equal(view.render().pending, false);
  view.hooks.unmount();
});

test("unmount aborts the request and a late receipt cannot refresh the closed workspace", async context => {
  const response = deferred(), view = arrivalsHarness(); let request;
  context.mock.method(globalThis, "fetch", (url, options) => { request = { body: JSON.parse(options.body), signal: options.signal }; return response.promise; });
  const saving = view.render().acknowledge(41);
  view.hooks.unmount(); assert.equal(request.signal.aborted, true);
  response.resolve(receipt(request.body)); await saving;
  assert.deepEqual(view.loads, []);
});

test("unverified receipt identity or cursor retains the reminder and never triggers a success refresh", async context => {
  const changes = [
    { dataset: "live" }, { actorAccountId: "other-native-account" }, { acknowledgedThroughSequence: 40 },
    { acknowledgedThroughSequence: undefined }, { acknowledgedThroughSequence: "41" },
    { acknowledgedThroughSequence: 41.5 }, { acknowledgedThroughSequence: Number.MAX_SAFE_INTEGER + 1 },
  ];
  let alteration;
  context.mock.method(globalThis, "fetch", async (url, options) => receipt(JSON.parse(options.body), alteration));
  for (alteration of changes) {
    const view = arrivalsHarness(); await view.render().acknowledge(41);
    assert.deepEqual(view.loads, [], JSON.stringify(alteration));
    assert.match(view.render().error, /verified|invalid|uncertain/i, JSON.stringify(alteration));
    assert.equal(view.render().arrivals.unreadCount, 1); view.hooks.unmount();
  }
});

test("an unsuccessful or incomplete receipt envelope cannot clear a reminder", async context => {
  const bodies = [{ ok: false, result: { dataset: "demo", actorAccountId: nativeAccount, acknowledgedThroughSequence: 41 } },
    { ok: true }, { ok: true, result: null }, null];
  let body;
  context.mock.method(globalThis, "fetch", async () => Response.json(body));
  for (body of bodies) {
    const view = arrivalsHarness(); await view.render().acknowledge(41);
    assert.deepEqual(view.loads, [], JSON.stringify(body)); assert.ok(view.render().error, JSON.stringify(body));
    assert.equal(view.render().arrivals.unreadCount, 1); view.hooks.unmount();
  }
});

test("a refresh failure after a verified acknowledgement retries the same cursor rather than a newer one", async context => {
  const hooks = hooksHarness(), requests = [], loads = []; let data = snapshot();
  const load = async dataset => { loads.push(dataset); if (loads.length === 1) throw new Error("Snapshot refresh interrupted"); };
  const render = () => hooks.render(() => hooks.useNewArrivals(data, load));
  context.mock.method(globalThis, "fetch", async (url, options) => { const body = JSON.parse(options.body); requests.push(body); return receipt(body); });
  await render().acknowledge(41); assert.match(render().error, /refresh interrupted/i);
  data = snapshot({ cursor: 42 }); await render().acknowledge(42);
  assert.deepEqual(requests.map(body => body.payload.throughSequence), [41, 41]);
  assert.equal(render().error, ""); assert.deepEqual(loads, ["demo", "demo"]); hooks.unmount();
});

test("the monotonic clock expires labels and unread indicators at 48 hours without any request or device-date dependence", async context => {
  const writes = [];
  context.mock.method(globalThis, "fetch", async (...args) => { writes.push(args); throw new Error("Clock ticks must not query"); });
  const items = [
    { batteryId: "BAT-EXPIRING", sequence: 41, registeredAt: iso(Date.parse(serverNow) - windowMs + 1000), isUnread: true },
    { batteryId: "BAT-SELF", sequence: 40, registeredAt: serverNow, isUnread: false },
  ];
  const view = arrivalsHarness(snapshot({ items }));
  view.hooks.setClock(5000); assert.equal(view.render().arrivals.unreadCount, 1);
  context.mock.method(Date, "now", () => Date.parse("2040-01-01T00:00:00.000Z"));
  view.hooks.setClock(5999); assert.equal(view.render().arrivals.unreadCount, 1);
  view.hooks.setClock(6000); const expired = view.render().arrivals;
  assert.deepEqual(expired.items.map(item => item.batteryId), ["BAT-SELF"]); assert.equal(expired.unreadCount, 0);
  assert.equal(expired.serverNow, iso(Date.parse(serverNow) + 1000));
  assert.deepEqual(writes, []); assert.deepEqual(view.loads, []); view.hooks.unmount();
});

test("server-clock-only inventory polling updates its anchor without invalidating business queries, but registration and asset changes do", async context => {
  const hooks = hooksHarness(), initial = snapshot(); let response = initial;
  context.mock.method(globalThis, "fetch", async url => { assert.equal(url, "/api/inventory?dataset=demo"); return Response.json(response); });
  const render = () => hooks.render(() => hooks.useInventoryData(initial.user), { passiveEffects: false });
  await render().load("demo"); let state = render(); assert.equal(state.revision, 1);
  response = { ...initial, newArrivals: { ...initial.newArrivals, serverNow: iso(Date.parse(serverNow) + 10000) } };
  await state.load("demo"); state = render();
  assert.equal(state.data.newArrivals.serverNow, response.newArrivals.serverNow); assert.equal(state.revision, 1);
  response = { ...response, newArrivals: { ...response.newArrivals, throughSequence: 42 } };
  await state.load("demo"); state = render(); assert.equal(state.revision, 2);
  response = { ...response, batteries: [{ id: "BAT-OTHER", version: 2 }] };
  await state.load("demo"); state = render(); assert.equal(state.revision, 3);
  hooks.unmount();
});

test("a snapshot refresh already in flight when the inventory changes cannot restore the old data or account", async context => {
  const hooks = hooksHarness(), initial = snapshot(), oldRefresh = deferred();
  let demoQueries = 0, oldSignal;
  context.mock.method(globalThis, "fetch", async (url, options) => {
    if (options?.method === "POST") return receipt(JSON.parse(options.body));
    if (url === "/api/inventory?dataset=demo") {
      if (++demoQueries === 1) return Response.json(initial);
      oldSignal = options.signal; return oldRefresh.promise;
    }
    assert.equal(url, "/api/inventory?dataset=live");
    return Response.json(snapshot({ dataset: "live", account: "staff-native-02", cursor: 8 }));
  });
  const render = () => hooks.render(() => {
    const inventory = hooks.useInventoryData(initial.user);
    const arrivals = hooks.useNewArrivals(inventory.data, inventory.load);
    return { inventory, arrivals };
  }, { passiveEffects: false });
  await render().inventory.load("demo");
  const saving = render().arrivals.acknowledge(41);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(demoQueries, 2); assert.equal(oldSignal.aborted, false);
  render().inventory.changeDataset("live");
  let state = render(); assert.equal(state.inventory.data, null); assert.equal(oldSignal.aborted, true);
  await state.inventory.load("live"); state = render();
  assert.equal(state.inventory.dataset, "live"); assert.equal(state.inventory.user.id, "staff-native-02");
  oldRefresh.resolve(Response.json(initial)); await saving; state = render();
  assert.equal(state.inventory.data.dataset, "live"); assert.equal(state.inventory.user.id, "staff-native-02");
  assert.equal(state.arrivals.pending, false); assert.equal(state.arrivals.error, "");
  hooks.unmount();
});
