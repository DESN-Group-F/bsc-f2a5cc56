import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { safeReturnPath } from "../work/qa/return-path.mjs";

const source = await readFile("app/signin/signin-form.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export default /gm, "");
const jsx = (type, props) => ({ type, props: props ?? {} });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const settle = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree, found = []) {
  if (Array.isArray(tree)) { for (const child of tree) nodes(child, found); return found; }
  if (!tree || typeof tree !== "object") return found;
  found.push(tree); nodes(tree.props?.children, found); return found;
}
function label(tree) {
  return Array.isArray(tree) ? tree.map(label).join("") : tree && typeof tree === "object" ? label(tree.props?.children) : tree == null ? "" : String(tree);
}
const input = (tree, name) => nodes(tree).find(node => node.type === "Input" && node.props.name === name);
const button = (tree, text) => nodes(tree).find(node => node.type === "Button" && label(node) === text);
const form = tree => nodes(tree).find(node => node.type === "form");
const submit = (tree, values) => form(tree).props.onSubmit({ preventDefault() {}, currentTarget: { values } });
const account = { username: "fictional-staff", password: "test-password-only" };

function harness(request = async () => response({ user: null, setupRequired: false }), search = "") {
  const states = [], effects = [], timers = new Map(), calls = [], destinations = [], focused = [];
  let pointer = 0, effectPointer = 0, nextTimer = 1, effectQueue = [];
  const bindings = {
    ...Object.fromEntries(["ArrowRight", "Battery", "Check", "LoaderCircle", "ShieldCheck", "Button", "Input", "Label"].map(name => [name, name])),
    safeReturnPath,
    flushSync: update => update(),
    reloadSessionPage: destination => destinations.push(destination),
    window: { location: { search } },
    requestAnimationFrame: callback => { callback(); return 1; },
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    FormData: class { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? null; } },
    async fetch(url, options) { calls.push({ url, options }); return request(url, options); },
    useState(initial) {
      const index = pointer++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { const index = pointer++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
    useEffect(callback, dependencies) {
      const index = effectPointer++, previous = effects[index];
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
        effectQueue.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  const SignInForm = new Function(...Object.keys(bindings), "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn SignInForm;`)(...Object.values(bindings), jsx, jsx, "Fragment");
  return {
    calls, destinations, focused, timers,
    render() {
      pointer = 0; effectPointer = 0; effectQueue = [];
      const tree = SignInForm();
      for (const node of nodes(tree)) if (node.type === "Input" && node.props.ref) node.props.ref.current = { focus() { focused.push(node.props.name); } };
      for (const effect of effectQueue) effect();
      return tree;
    },
    async ready() { this.render(); await settle(); return this.render(); },
    fire(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("sign-in uses English inline validation and focuses the first invalid field without sending credentials", async () => {
  const h = harness();
  let tree = await h.ready();
  assert.equal(form(tree).props.noValidate, true);
  assert.equal(tree.props.lang, "en");
  await submit(tree, { username: "", password: "" });
  tree = h.render();
  assert.equal(h.calls.length, 1, "Validation must not make a sign-in request");
  assert.match(label(tree), /Enter your username\./);
  assert.match(label(tree), /Enter your password\./);
  assert.equal(input(tree, "username").props["aria-invalid"], true);
  assert.equal(input(tree, "password").props["aria-describedby"], "signin-password-error");
  assert.equal(h.focused.at(-1), "username");
  input(tree, "username").props.onChange({ target: { value: account.username } });
  tree = h.render();
  assert.equal(input(tree, "username").props["aria-invalid"], false);
  assert.equal(input(tree, "password").props["aria-invalid"], true);
  await submit(tree, { username: "!invalid", password: account.password });
  tree = h.render();
  assert.equal(input(tree, "password").props.value, account.password, "Inline validation must preserve password-manager values from the form");
  h.unmount();
});

test("sign-in validates username shape and password bounds without imposing setup password length", async () => {
  const h = harness(async (_url, options) => options?.method === "POST" ? response({ error: "The username or password is incorrect." }, 401) : response({ user: null, setupRequired: false }));
  let tree = await h.ready();
  for (const values of [{ username: "!invalid", password: "test" }, { username: "x", password: "test" }, { username: account.username, password: "x".repeat(129) }]) {
    await submit(tree, values); tree = h.render();
  }
  assert.equal(h.calls.length, 1);
  await submit(tree, { username: account.username, password: "x" });
  assert.equal(h.calls.length, 2, "Existing sign-in password authority remains on the server");
  assert.equal(JSON.parse(h.calls[1].options.body).payload.password, "x");
  h.unmount();
});

test("password-manager form values are submitted unchanged and only server-confirmed access navigates", async () => {
  const h = harness(async (_url, options) => response(options?.method === "POST" ? { user: { id: "staff" } } : { user: null, setupRequired: false }), "?return_to=%2Fnfc-test%3Fdataset%3Ddemo");
  const tree = await h.ready();
  assert.equal(input(tree, "username").props.autoComplete, "username");
  assert.equal(input(tree, "password").props.autoComplete, "current-password");
  const password = "  test-password-only  ";
  await submit(tree, { username: "  Fictional-Staff  ", password });
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { action: "signin", payload: { username: "Fictional-Staff", password } });
  assert.deepEqual(h.destinations, ["/nfc-test?dataset=demo"]);
  assert.equal(h.render().props["data-phase"], "opening");
  h.unmount();
});

test("slow sign-in stays pending without duplicate submissions or fake progress", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = harness(async (_url, options) => options?.method === "POST" ? pending : response({ user: null, setupRequired: false }));
  const tree = await h.ready();
  const saving = submit(tree, account);
  await submit(tree, account);
  let pendingTree = h.render();
  assert.equal(pendingTree.props["data-phase"], "submitting");
  assert.equal(button(pendingTree, "Signing in").props.disabled, true);
  assert.equal(input(pendingTree, "password").props.readOnly, true);
  assert.equal(input(pendingTree, "password").props.disabled, false);
  h.fire(8_000); pendingTree = h.render();
  assert.match(label(pendingTree), /The server is still responding/);
  assert.equal(nodes(pendingTree).some(node => node.props.role === "progressbar"), false);
  assert.equal(h.calls.filter(call => call.options?.method === "POST").length, 1);
  assert.deepEqual(h.destinations, []);
  resolve(response({ user: { id: "staff" } })); await saving;
  assert.equal(h.render().props["data-phase"], "opening");
  h.unmount();
});

test("a server rejection preserves fields and permits an explicit retry", async () => {
  let rejected = true;
  const h = harness(async (_url, options) => options?.method === "POST" ? rejected ? response({ error: "The username or password is incorrect, or this account is disabled." }, 401) : response({ user: { id: "staff" } }) : response({ user: null, setupRequired: false }));
  await submit(await h.ready(), account);
  let tree = h.render();
  assert.equal(tree.props["data-phase"], "ready");
  assert.match(label(tree), /The username or password is incorrect/);
  assert.equal(h.focused.at(-1), "password");
  assert.equal(input(tree, "username").props.value, account.username);
  assert.equal(input(tree, "password").props.value, account.password);
  assert.equal(button(tree, "Sign in").props.disabled, false);
  assert.deepEqual(h.destinations, []);
  rejected = false;
  await submit(tree, account); tree = h.render();
  assert.equal(tree.props["data-phase"], "opening");
  h.unmount();
});

test("an uncertain sign-in checks the existing session without automatically resending credentials", async () => {
  let signedIn = false;
  const h = harness(async (_url, options) => {
    if (options?.method === "POST") { signedIn = true; throw new TypeError("Localized network error"); }
    return response({ user: signedIn ? { id: "staff" } : null, setupRequired: false });
  });
  await submit(await h.ready(), account);
  let tree = h.render();
  assert.equal(tree.props["data-phase"], "unconfirmed");
  assert.match(label(tree), /The connection was interrupted before access could be confirmed/);
  assert.doesNotMatch(label(tree), /Localized network error/);
  assert.equal(button(tree, "Sign in").props.disabled, true);
  await submit(tree, account);
  assert.equal(h.calls.length, 2);
  button(tree, "Check access").props.onClick(); h.render(); await settle(); tree = h.render();
  assert.equal(tree.props["data-phase"], "opening");
  assert.equal(h.calls.filter(call => call.options?.method === "POST").length, 1);
  assert.deepEqual(h.destinations, ["/"]);
  h.unmount();
});

test("unconfirmed successful-looking responses never open the workspace", async () => {
  for (const result of [response({ ok: true }), response({ error: "Service unavailable" }, 503), { ok: true, async json() { throw new SyntaxError("Invalid response"); } }]) {
    const h = harness(async (_url, options) => options?.method === "POST" ? result : response({ user: null, setupRequired: false }));
    await submit(await h.ready(), account);
    const tree = h.render();
    assert.equal(tree.props["data-phase"], "unconfirmed");
    assert.ok(button(tree, "Check access"));
    assert.deepEqual(h.destinations, []);
    h.unmount();
  }
});

test("setup validates all required English fields and an uncertain creation is rechecked before retry", async () => {
  let created = false;
  const h = harness(async (_url, options) => {
    if (options?.method === "POST") { created = true; throw new TypeError("Connection interrupted"); }
    return response({ user: null, setupRequired: !created });
  });
  let tree = await h.ready();
  await submit(tree, { setupKey: "", displayName: "x", username: "", password: "short" });
  tree = h.render();
  assert.equal(h.calls.length, 1);
  assert.equal(h.focused.at(-1), "setupKey");
  assert.match(label(tree), /Enter the installation setup key/);
  assert.match(label(tree), /at least 2 characters/);
  assert.match(label(tree), /at least 12 characters/);
  assert.equal(input(tree, "password").props.autoComplete, "new-password");
  await submit(tree, { setupKey: "fictional-installation-key", displayName: "Fictional Admin", ...account });
  tree = h.render();
  assert.equal(tree.props["data-phase"], "unconfirmed");
  button(tree, "Check access").props.onClick(); h.render(); await settle(); tree = h.render();
  assert.equal(tree.props["data-phase"], "ready");
  assert.equal(input(tree, "setupKey"), undefined);
  assert.equal(input(tree, "password").props.autoComplete, "current-password");
  assert.equal(h.calls.filter(call => call.options?.method === "POST").length, 1);
  assert.deepEqual(h.destinations, [], "Creating an administrator must not establish a signed-in session");
  h.unmount();
});

test("initial access checks and submitted requests have explicit timeout recovery", async () => {
  for (const timeoutPost of [false, true]) {
    const h = harness(async (_url, options) => {
      if (timeoutPost && !options?.method) return response({ user: null, setupRequired: false });
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    let saving;
    if (timeoutPost) saving = submit(await h.ready(), account);
    else h.render();
    h.render(); h.fire(8_000);
    assert.match(label(h.render()), timeoutPost ? /server is still responding/ : /access check is still running/);
    h.fire(30_000); await saving; await settle();
    const tree = h.render();
    assert.equal(tree.props["data-phase"], timeoutPost ? "unconfirmed" : "unavailable");
    assert.match(label(tree), /timed out/);
    assert.ok(button(tree, timeoutPost ? "Check access" : "Try again"));
    assert.deepEqual(h.destinations, []);
    h.unmount();
    assert.equal(h.timers.size, 0);
  }
});

test("confirmed setup returns to sign-in and retains no setup key", async () => {
  const h = harness(async (_url, options) => response(options?.method === "POST" ? { user: { id: "new-admin" }, ok: true } : { user: null, setupRequired: true }));
  await submit(await h.ready(), { setupKey: "fictional-installation-key", displayName: "Fictional Admin", ...account });
  const tree = h.render();
  assert.equal(tree.props["data-phase"], "ready");
  assert.match(label(tree), /Administrator created\. Sign in with your new account\./);
  assert.equal(input(tree, "setupKey"), undefined);
  assert.equal(input(tree, "password").props.autoComplete, "current-password");
  assert.deepEqual(h.destinations, []);
  h.unmount();
});

test("leaving sign-in aborts pending access without navigating from a late response", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = harness(async (_url, options) => options?.method === "POST" ? pending : response({ user: null, setupRequired: false }));
  const saving = submit(await h.ready(), account);
  h.render(); h.unmount();
  assert.equal(h.calls.at(-1).options.signal.aborted, true);
  resolve(response({ user: { id: "staff" } })); await saving;
  assert.deepEqual(h.destinations, []);
  assert.equal(h.timers.size, 0);
});
