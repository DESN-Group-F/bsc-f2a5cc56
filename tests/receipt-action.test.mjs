import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the actual receipt component state and callback with inert DOM edges.
// This does not assert browser geometry or physical request success.
const source = ts.transpileModule(await readFile(new URL("../components/ui/receipt-action.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function nodes(value, result = []) { if (Array.isArray(value)) value.forEach(child => nodes(child, result)); else if (value && typeof value === "object") { result.push(value); nodes(value.props?.children, result); } return result; }
function text(value) { return typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" ? text(value.props?.children) : ""; }
function mount(overrides = {}) {
  const state = [], effects = []; let pointer = 0, effectPointer = 0, scheduled = [];
  const hooks = {
    useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useLayoutEffect(callback, dependencies) { const index = effectPointer++, old = effects[index]; if (!old || dependencies.some((value, at) => !Object.is(value, old.dependencies[at]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
  };
  const clicks = [], bindings = { ...hooks, Button: "Button", Check: "Check", LoaderCircle: "LoaderCircle", styles: new Proxy({}, { get: (_, key) => key }), reducedMotion: () => true, spring() {}, ...overrides };
  const names = Object.keys(bindings), Component = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${source}\nreturn ReceiptAction;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
  const props = { pending: false, confirmation: null, reviewKey: "reviewed-1|reviewed-2", actionLabel: "Confirm checkout (2)", children: "Confirm checkout (2)", disabled: false, onClick: event => clicks.push(event) };
  return { props, clicks, render() { pointer = 0; effectPointer = 0; scheduled = []; const result = Component(props); scheduled.forEach(callback => callback()); return result; }, unmount() { effects.forEach(effect => effect.cleanup?.()); } };
}
function settled(view) { view.render(); return view.render(); }
const action = tree => nodes(tree).find(node => node.type === "Button");
const phase = tree => tree.props["data-receipt-phase"];
const live = tree => nodes(tree).find(node => node.props.role === "status");

test("ending pending without a verified receipt never shows a check or success and keeps the original action", () => {
  const view = mount(), event = { type: "click" };
  action(settled(view)).props.onClick(event);
  assert.deepEqual(view.clicks, [event]);
  view.props.pending = true; view.props.disabled = true;
  assert.equal(phase(settled(view)), "pending");
  assert.equal(action(view.render()).props.disabled, true);
  assert.equal(action(view.render()).props["aria-label"], "Confirm checkout (2)");
  view.props.pending = false;
  const result = settled(view);
  assert.equal(phase(result), "idle");
  assert.equal(text(live(result)), "");
  assert.equal(nodes(result).some(node => node.type === "Check"), false);
  assert.equal(view.clicks.length, 1);
  view.unmount();
});

test("explicit server confirmation shows its exact partial count while another receipt button remains idle", () => {
  const active = mount(), inactive = mount();
  action(settled(active)).props.onClick({ type: "click" });
  active.props.pending = true; inactive.props.pending = true;
  settled(active); settled(inactive);
  const confirmation = { identity: "verified-request-1", count: 1, text: "1 battery registered" };
  active.props.confirmation = confirmation; inactive.props.confirmation = confirmation;
  assert.equal(phase(settled(active)), "pending");
  assert.equal(text(live(active.render())), "");
  active.props.pending = false; inactive.props.pending = false;
  const result = settled(active);
  assert.equal(phase(result), "confirmed");
  assert.match(text(live(result)), /1 battery registered/);
  assert.match(text(live(result)), /Confirmed server receipt for 1 battery/);
  assert.equal(phase(settled(inactive)), "idle");
  assert.equal(text(live(inactive.render())), "");
  assert.equal(active.clicks.length, 1);
  active.unmount(); inactive.unmount();
});

test("previously retained receipts do not animate on mount and a new review resets the result without submitting", () => {
  const view = mount(); view.props.confirmation = { identity: "existing-receipt", count: 2, text: "2 batteries returned" };
  assert.equal(phase(settled(view)), "idle");
  action(view.render()).props.onClick({ type: "click" });
  view.props.pending = true; settled(view);
  view.props.pending = false; view.props.confirmation = { identity: "new-verified-receipt", count: 1, text: "1 battery returned" };
  assert.equal(phase(settled(view)), "confirmed");
  view.props.reviewKey = "new-review";
  assert.equal(phase(settled(view)), "idle");
  assert.equal(text(live(view.render())), "");
  assert.equal(view.clicks.length, 1);
  view.unmount();
});

test("a new permitted click interrupts receipt acknowledgement immediately without a timer or duplicate callback", () => {
  const view = mount(); action(settled(view)).props.onClick({ type: "first" });
  view.props.pending = true; settled(view);
  view.props.pending = false; view.props.confirmation = { identity: "receipt-first", count: 2, text: "2 batteries scrapped" };
  assert.equal(phase(settled(view)), "confirmed");
  action(view.render()).props.onClick({ type: "next" });
  assert.equal(view.clicks.length, 2);
  view.props.pending = true;
  assert.equal(phase(settled(view)), "pending");
  view.props.pending = false;
  assert.equal(phase(settled(view)), "idle");
  assert.equal(view.clicks.length, 2);
  view.unmount();
});

test("download acknowledgements announce the actual browser handoff without inventing a battery write or disk save", () => {
  const view = mount();
  view.props.actionLabel = "Download records";
  view.props.children = "Download records";
  view.props.pendingAnnouncement = "Preparing your download.";
  view.props.confirmationAnnouncement = "The file is ready. Your browser was asked to save it.";
  action(settled(view)).props.onClick({ type: "click" });
  view.props.pending = true;
  assert.equal(text(live(settled(view))), "Preparing your download.");
  view.props.pending = false;
  view.props.confirmation = { identity: "validated-attachment-1", count: 1, text: "Download ready" };
  const result = settled(view);
  assert.equal(phase(result), "confirmed");
  assert.equal(text(live(result)), "The file is ready. Your browser was asked to save it.");
  assert.doesNotMatch(text(live(result)), /battery|server receipt|saved to disk/);
  action(result).props.onClick({ type: "download-again" });
  view.props.pending = true; view.props.confirmation = null;
  assert.equal(text(live(settled(view))), "Preparing your download.");
  view.props.pending = false;
  assert.equal(text(live(settled(view))), "");
  view.unmount();
});
