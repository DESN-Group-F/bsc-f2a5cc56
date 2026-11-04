import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const handoff = await import(`data:text/javascript;base64,${Buffer.from(compile(await readFile("lib/nfc-handoff.ts", "utf8"))).toString("base64")}`);
const returns = await import(`data:text/javascript;base64,${Buffer.from(compile(await readFile("lib/return-path.ts", "utf8"))).toString("base64")}`);
const uid = "nfc:uid:04AABBCCDDEEFF";
const response = (body, status = 200) => Response.json(body, { status });
const signedIn = { user: { id: "staff-a", displayName: "Test staff" }, setupRequired: false };
const matched = (tagId = uid) => ({ ok: true, result: { source: "manual", results: [{ tagId, battery: { id: "BAT-TEST", name: "Test battery", tagId, loanId: null, lifecycleStatus: "active", version: 1, privateUnusedField: "not displayed" } }] } });

test("NFC UID normalization preserves its typed namespace and supported byte lengths", () => {
  assert.equal(handoff.normalizeNfcUidIdentifier(" nfc:uid:04aabbccddeeff "), uid);
  assert.equal(handoff.normalizeNfcUidIdentifier("nfc:uid:AABBCCDD"), "nfc:uid:AABBCCDD");
  assert.equal(handoff.normalizeNfcUidIdentifier("nfc:uid:00112233445566778899"), "nfc:uid:00112233445566778899");
  for (const value of ["04AABBCCDDEEFF", "nfc:uid:04AABBCCDDEEF", "nfc:uid:04AABBCCDDEEFG", "nfc:ndef:04AABBCCDDEEFF", "https://example.com", `${uid}&dataset=live`])
    assert.equal(handoff.normalizeNfcUidIdentifier(value), null);
});

test("a normal handoff pre-fills a UID but never selects the working inventory", () => {
  assert.deepEqual(handoff.parseNfcHandoff("?dataset=demo&tagId=nfc%3Auid%3A04aabbccddeeff"), { tagId: uid, suppliedByLink: true, blocked: false, error: "" });
  assert.deepEqual(handoff.parseNfcHandoff(""), { tagId: "", suppliedByLink: false, blocked: false, error: "" });
  assert.equal(handoff.parseNfcHandoff(`?tagId=${uid}`).tagId, uid);
});

test("ambiguous, malformed and working-inventory handoff queries are blocked", () => {
  for (const query of [
    `?dataset=live&tagId=${uid}`, "?dataset=LIVE", "?dataset=", "?dataset=demo&dataset=demo", "?dataset=demo&dataset=live",
    `?tagId=${uid}&tagId=${uid}`, "?tagId=", "?tagId=BAT-TEST", "?tagId=https%3A%2F%2Fexample.com",
    "?tagId=nfc%3Auid%3A00112233445566%26dataset%3Dlive",
  ]) {
    const parsed = handoff.parseNfcHandoff(query);
    assert.equal(parsed.blocked, true, query);
    assert.equal(parsed.tagId, "", query);
    assert.ok(parsed.error, query);
  }
});

test("sign-in returns to a canonical local diagnostic path without query injection", () => {
  const link = new URL(handoff.nfcHandoffSignInPath(uid), "https://inventory.example");
  const returnTo = link.searchParams.get("return_to");
  assert.equal(returns.safeReturnPath(returnTo), returnTo);
  const path = new URL(returnTo, "https://inventory.example");
  assert.equal(path.pathname, "/nfc-test");
  assert.equal(path.searchParams.get("dataset"), "demo");
  assert.equal(path.searchParams.get("tagId"), uid);
  for (const input of ["https://untrusted.example", "//untrusted.example", `${uid}&dataset=live`, "?return_to=https://untrusted.example"])
    assert.equal(handoff.nfcHandoffReturnPath(input), "/nfc-test?dataset=demo");
});

test("anonymous access checks cannot issue an inventory query", async () => {
  const calls = [];
  const transport = async (url, init) => { calls.push({ url, init }); return response({ user: null, setupRequired: false }); };
  await assert.rejects(handoff.lookupDemoNfcTag(uid, transport), error => error.kind === "authentication");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/session");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.method, undefined);
});

test("explicit authenticated lookup sends only a fixed demonstration read and exposes a minimal projection", async () => {
  const calls = [];
  const transport = async (url, init) => { calls.push({ url, init }); return response(url === "/api/session" ? signedIn : matched()); };
  const found = await handoff.lookupDemoNfcTag("nfc:uid:04aabbccddeeff", transport);
  assert.deepEqual(found, { tagId: uid, battery: { id: "BAT-TEST", name: "Test battery", status: "In store" } });
  assert.deepEqual(calls.map(call => call.url), ["/api/session", "/api/inventory"]);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[1].init.body), { dataset: "demo", action: "scan_lookup", payload: { tagIds: [uid], source: "manual" } });
});

test("manually entered existing identifiers preserve their original case and support unknown results", async () => {
  const tagId = "Existing-Tag-abc";
  const transport = async (url, init) => {
    if (url === "/api/session") return response(signedIn);
    assert.deepEqual(JSON.parse(init.body).payload.tagIds, [tagId]);
    return response({ ok: true, result: { source: "manual", results: [{ tagId, battery: null }] } });
  };
  assert.deepEqual(await handoff.lookupDemoNfcTag(` ${tagId} `, transport), { tagId, battery: null });
});

test("invalid identifier input is rejected before any authentication or inventory request", async () => {
  for (const input of ["", " ", "a".repeat(129), "nfc:uid:wrong", "nfc:ndef:04AABBCCDDEEFF"]) {
    await assert.rejects(handoff.lookupDemoNfcTag(input, () => assert.fail("Invalid input must not make a request")), error => error.kind === "identifier");
  }
});

test("session expiry, unreadable responses and mismatched identifiers never become accepted results", async () => {
  const cases = [
    () => response({ error: "Sign in with an active staff account." }, 401),
    () => new Response("unreadable", { status: 200 }),
    () => response(matched("nfc:uid:00112233445566")),
    () => response({ ok: true, result: { source: "simulated", results: [] } }),
    () => { const body = matched(); body.result.results[0].battery.tagId = "another-tag"; return response(body); },
  ];
  for (const failure of cases)
    await assert.rejects(handoff.lookupDemoNfcTag(uid, async url => url === "/api/session" ? response(signedIn) : failure()), error => error instanceof handoff.NfcHandoffError);
});

function hookHarness() {
  const values = [], effects = [];
  let pointer = 0, mounted = false;
  return {
    reset() { pointer = 0; },
    useState(initial) {
      const index = pointer++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
    },
    useEffect(effect) { if (!mounted) effects.push(effect); },
    useRef(initial) { const index = pointer++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    runEffects() { mounted = true; return effects.map(effect => effect()); },
  };
}
const jsx = (type, props) => ({ type, props: props ?? {} });
function nodes(tree, found = []) {
  if (Array.isArray(tree)) { for (const node of tree) nodes(node, found); return found; }
  if (!tree || typeof tree !== "object") return found;
  found.push(tree); nodes(tree.props?.children, found); return found;
}
async function withGlobals(values, run) {
  const originals = Object.fromEntries(Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try { await run(); } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}
function component(source, bindings, name) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/^import .*;\r?\n/gm, "").replace(/^export default /gm, "");
  return new Function(...Object.keys(bindings), "_jsx", "_jsxs", `${compiled}\nreturn ${name};`)(...Object.values(bindings), jsx, jsx);
}

test("mounting a device handoff checks authentication but never automatically looks up or saves inventory", async () => {
  const calls = [], hooks = hookHarness();
  const ui = Object.fromEntries(["Battery", "Search", "ShieldCheck", "Button", "Input", "Label", "Link"].map(name => [name, name]));
  const styles = new Proxy({}, { get: (_, key) => key });
  const NfcTest = component(await readFile("app/nfc-test/nfc-test.tsx", "utf8"), { ...handoff, ...ui, ...hooks, styles }, "NfcTest");
  await withGlobals({ window: { location: { search: `?dataset=demo&tagId=${uid}` } }, fetch: async (url, init) => { calls.push({ url, init }); return response(signedIn); } }, async () => {
    const props = { initialHandoff: handoff.parseNfcHandoff(`?dataset=demo&tagId=${uid}`) };
    hooks.reset(); NfcTest(props);
    const cleanups = hooks.runEffects();
    await new Promise(resolve => setImmediate(resolve));
    hooks.reset(); const tree = NfcTest(props);
    assert.deepEqual(calls.map(call => call.url), ["/api/session"]);
    const input = nodes(tree).find(node => node.type === "Input");
    assert.equal(input.props.value, uid);
    assert.ok(nodes(tree).some(node => node.type === "form" && typeof node.props.onSubmit === "function"));
    for (const cleanup of cleanups) cleanup?.();
  });
});

test("an already signed-in user retains the safe NFC return path instead of losing the identifier", async () => {
  const hooks = hookHarness(), destinations = [];
  const ui = Object.fromEntries(["ArrowRight", "Battery", "Check", "LoaderCircle", "ShieldCheck", "Button", "Input", "Label"].map(name => [name, name]));
  const SignInForm = component(await readFile("app/signin/signin-form.tsx", "utf8"), { ...ui, ...hooks, ...returns, flushSync: update => update(), reloadSessionPage: destination => destinations.push(destination) }, "SignInForm");
  const returnTo = handoff.nfcHandoffReturnPath(uid);
  await withGlobals({ window: { location: { search: `?return_to=${encodeURIComponent(returnTo)}` } }, fetch: async () => response(signedIn) }, async () => {
    hooks.reset(); SignInForm(); hooks.runEffects();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(destinations, [returnTo]);
  });
});
