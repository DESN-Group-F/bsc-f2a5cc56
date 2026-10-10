import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile("hooks/use-task-endpoint.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function harness() {
  const state = [], effects = [], requests = [], timers = new Map();
  let stateIndex = 0, effectIndex = 0, timerId = 0;
  const useState = initial => {
    const index = stateIndex++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  };
  const useEffect = (callback, dependencies) => {
    const index = effectIndex++, previous = effects[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      previous?.cleanup?.();
      effects[index] = { dependencies, callback };
    }
  };
  const window = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {}, removeEventListener() {},
  };
  const taskRequest = (url, { signal }) => new Promise((resolve, reject) => {
    requests.push({ url, signal, resolve, reject });
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const hook = new Function("useState", "useEffect", "taskRequest", "window", "document", "setInterval", "clearInterval", `${compiled}\nreturn useTaskEndpoint;`)(useState, useEffect, taskRequest, window, { visibilityState: "visible" }, () => 0, () => {});
  return {
    requests,
    render(url = "/api/messages?dataset=demo", userId = "staff-a", source = "events-1") {
      stateIndex = effectIndex = 0;
      const result = hook(url, userId, source);
      for (const effect of effects) if (effect.callback) { effect.cleanup = effect.callback(); effect.callback = null; }
      return result;
    },
    advance(delay) { for (const [id, timer] of timers) if (timer.delay === delay) { timers.delete(id); timer.callback(); } },
    dispose() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

test("a slow refresh keeps the exact resource's messages mounted while remaining pending", async () => {
  const app = harness(), first = { messages: [{ id: "original", readAt: null }] };
  assert.equal(app.render().payload, null);
  app.requests[0].resolve(first); await flush();
  let result = app.render(); assert.equal(result.loading, false); assert.equal(result.payload, first);
  result.refresh(); result = app.render();
  assert.equal(result.loading, true); assert.equal(result.payload, first);
  const latest = { messages: [{ id: "original", readAt: "2026-10-10T01:00:00Z" }] };
  app.requests[1].resolve(latest); await flush();
  result = app.render(); assert.equal(result.loading, false); assert.equal(result.payload, latest); app.dispose();
});

test("changing account, dataset or filters hides the previous resource and rejects its late response", async () => {
  for (const [url, userId] of [["/api/messages?dataset=live", "staff-a"], ["/api/messages?dataset=demo&search=changed", "staff-a"], ["/api/messages?dataset=demo", "staff-b"]]) {
    const app = harness(); app.render(); app.requests[0].resolve({ messages: ["private"] }); await flush();
    let result = app.render(); result.refresh(); app.render();
    result = app.render(url, userId); assert.equal(result.payload, null); assert.equal(result.loading, true);
    assert.equal(app.requests[1].signal.aborted, true);
    app.requests[1].resolve({ messages: ["stale"] }); await flush();
    assert.equal(app.render(url, userId).payload, null);
    app.requests[2].resolve({ messages: ["correct"] }); await flush();
    assert.deepEqual(app.render(url, userId).payload.messages, ["correct"]); app.dispose();
  }
});

test("a stalled read ends with an English retry state and never drops its last received records", async () => {
  const app = harness(); app.render(); app.requests[0].resolve({ messages: ["received"] }); await flush();
  let result = app.render(); result.refresh(); app.render();
  app.advance(30000); await flush(); result = app.render();
  assert.equal(result.loading, false); assert.match(result.error, /taking too long.*retry/);
  assert.deepEqual(result.payload.messages, ["received"]);
  assert.equal(app.requests.length, 2, "A timeout never silently starts another request");
  result.refresh(); result = app.render(); assert.equal(result.error, ""); assert.equal(result.loading, true);
  app.requests[2].resolve({ messages: ["updated"] }); await flush();
  assert.deepEqual(app.render().payload.messages, ["updated"]); app.dispose();
});

test("new evidence refreshes without erasing the existing view, and unmount aborts its read", async () => {
  const app = harness(); app.render(); app.requests[0].resolve({ messages: ["recorded"] }); await flush(); app.render();
  const result = app.render("/api/messages?dataset=demo", "staff-a", "events-2");
  assert.equal(result.loading, true); assert.deepEqual(result.payload.messages, ["recorded"]);
  app.dispose(); assert.equal(app.requests[1].signal.aborted, true); await flush();
});

const inventoryCompiled = ts.transpileModule(await readFile("hooks/use-inventory-data.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function pollingHarness() {
  const calls = [], errors = [], intervals = new Set(), focusListeners = new Set();
  let previous;
  const document = { visibilityState: "visible" };
  const load = (dataset, signal) => new Promise((resolve, reject) => {
    calls.push({ dataset, signal, resolve, reject });
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const onError = message => errors.push(message);
  const useEffect = (callback, dependencies) => {
    if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
      previous?.cleanup?.();
      previous = { dependencies, cleanup: callback() };
    }
  };
  const window = { addEventListener(_name, callback) { focusListeners.add(callback); }, removeEventListener(_name, callback) { focusListeners.delete(callback); } };
  const hook = new Function("useEffect", "document", "window", "setInterval", "clearInterval", `${inventoryCompiled}\nreturn useInventoryPolling;`)(useEffect, document, window, callback => { intervals.add(callback); return callback; }, callback => intervals.delete(callback));
  return {
    calls, errors, document,
    render({ paused = false, dataset = "demo" } = {}) { hook({ paused, dataset, load, onError }); },
    tick() { intervals.forEach(callback => callback()); },
    focus() { focusListeners.forEach(callback => callback()); },
    dispose() { previous?.cleanup?.(); },
  };
}

test("inventory polling keeps one read in flight across repeated intervals and focus events", async () => {
  const app = pollingHarness(); app.render();
  app.tick(); app.tick(); app.focus(); app.tick();
  assert.equal(app.calls.length, 1, "Slow reads must not be repeatedly superseded by the polling interval");
  app.calls[0].resolve(); await flush();
  app.focus(); assert.equal(app.calls.length, 2);
  app.calls[1].reject(new Error("Temporary network failure")); await flush();
  assert.deepEqual(app.errors, ["Temporary network failure"]);
  app.tick(); assert.equal(app.calls.length, 3, "A failed read must release the in-flight guard");
  app.dispose(); await flush();
  assert.deepEqual(app.errors, ["Temporary network failure"]);
});

test("polling does not compete with paused or hidden work and resumes in its new inventory", async () => {
  const app = pollingHarness(); app.render({ paused: true }); app.tick(); app.focus();
  assert.equal(app.calls.length, 0);
  app.render(); app.document.visibilityState = "hidden"; app.tick(); app.focus();
  assert.equal(app.calls.length, 0);
  app.document.visibilityState = "visible"; app.tick();
  assert.equal(app.calls[0].dataset, "demo");
  app.render({ dataset: "live" });
  assert.equal(app.calls[0].signal.aborted, true);
  app.tick(); assert.equal(app.calls[1].dataset, "live");
  app.calls[0].reject(new Error("Late failure from demonstration inventory")); await flush();
  assert.deepEqual(app.errors, []);
  app.calls[1].resolve(); await flush(); app.dispose();
});
