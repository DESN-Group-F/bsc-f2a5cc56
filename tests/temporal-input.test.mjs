import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { enAU } from "react-day-picker/locale";
import ts from "typescript";
import * as temporal from "../work/qa/temporal-input.mjs";
import { fromSydneyInput } from "../work/qa/client-utils.mjs";

test("English temporal fields validate complete real dates/times and preserve optional blanks and min/max bounds", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-10-", "0000-01-01", "2026\u5e7410\u670803\u65e5"]) assert.match(temporal.temporalInputMessage("date", value), /valid date.*YYYY-MM-DD/);
    assert.equal(temporal.temporalInputMessage("date", "2024-02-29"), ""); assert.equal(temporal.temporalInputMessage("date", ""), "");
    assert.match(temporal.temporalInputMessage("date", "", true), /Enter a date/);
    assert.match(temporal.temporalInputMessage("date", "2026-10-01", false, "2026-10-02"), /on or after/);
    assert.match(temporal.temporalInputMessage("date", "2026-10-04", false, undefined, "2026-10-03"), /on or before/);
    for (const value of ["24:00", "12:60", "9:30", "\u4e0a\u534809:30"]) assert.match(temporal.temporalInputMessage("time", value), /HH:mm/);
    assert.equal(temporal.temporalInputMessage("time", "00:00"), ""); assert.equal(temporal.temporalInputMessage("time", "23:59"), "");
    assert.equal(temporal.temporalInputMessage("datetime-local", "2026-10-03T12:30"), "");
    assert.match(temporal.temporalInputMessage("datetime-local", "2026-10-03T"), /YYYY-MM-DDTHH:mm/);
    assert.match(temporal.temporalInputMessage("datetime-local", "2026-02-30T12:30"), /valid date/);
});

test("calendar dates survive host timezone and early-year arithmetic without shifting saved calendar days", () => {
    const moduleUrl = new URL("../work/qa/temporal-input.mjs", import.meta.url).href;
    for (const TZ of ["Australia/Sydney", "Asia/Shanghai", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import assert from 'node:assert/strict'; import {toCalendarDate,fromCalendarDate} from ${JSON.stringify(moduleUrl)}; for(const value of ['0001-01-01','0099-12-31','2024-02-29','2026-10-04','9999-12-31']) assert.equal(fromCalendarDate(toCalendarDate(value)),value);`], { env: { ...process.env, TZ }, encoding: "utf8" });
        assert.equal(result.status, 0, `${TZ}: ${result.stderr}`);
    }
});

test("changing a date or time part preserves the other part and never invents midnight, minutes or today's date", () => {
    const day = temporal.toCalendarDate("2026-10-05");
    assert.equal(temporal.replaceTemporalDate("date", "2026-01-01", day), "2026-10-05");
    assert.equal(temporal.replaceTemporalDate("datetime-local", "2026-01-01T14:37", day), "2026-10-05T14:37");
    assert.equal(temporal.replaceTemporalDate("datetime-local", "", day), "2026-10-05T");
    assert.equal(temporal.replaceTemporalTime("time", "", "hour", "09"), "09:");
    assert.equal(temporal.replaceTemporalTime("datetime-local", "", "minute", "30"), "T:30");
    assert.equal(temporal.replaceTemporalTime("datetime-local", "2026-10-03T14:37", "minute", "45"), "2026-10-03T14:45");
    assert.throws(() => fromSydneyInput("2026-10-04T02:30"), /invalid or ambiguous/);
    assert.throws(() => fromSydneyInput("2026-04-05T02:30"), /invalid or ambiguous/);
    assert.equal(fromSydneyInput("2026-10-03T12:30"), "2026-10-03T02:30:00.000Z");
});

// Execute real component handlers with inert UI and a public native-input event
// boundary. This is not browser rendering, focus or assistive-technology evidence.
const source = await readFile("components/ui/temporal-input.tsx", "utf8"), code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const ui = Object.fromEntries(["CalendarDays", "Clock", "Button", "Calendar", "Popover", "PopoverContent", "PopoverTrigger"].map(name => [name, name]));
function hooks() {
    const state = []; let pointer = 0, effects = [];
    return { reset() { pointer = 0; effects = []; }, useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }]; }, useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; }, useEffect(callback) { effects.push(callback); }, commit() { effects.forEach(callback => callback()); } };
}
const jsx = (type, props, key) => ({ type, props: props || {}, key });
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(item => nodes(item, result)); else if (node && typeof node === "object") { result.push(node); nodes(node.props?.children, result); } return result; }
function mount(extra = {}) {
    const state = hooks(), emitted = [], forwarded = { current: null };
    const bindings = { ...ui, ...temporal, React: state, enAU, currentSydneyDate: () => "2026-10-03" }, names = Object.keys(bindings);
    const TemporalInput = new Function(...names, "_jsx", "_jsxs", `${code}\nreturn TemporalInput;`)(...names.map(name => bindings[name]), jsx, jsx);
    const props = { type: "date", id: "review-date", value: "", ref: forwarded, onChange(event) { assert.equal(event.target, element); emitted.push(event.target.value); props.value = event.target.value; }, ...extra };
    class NativeInput { set value(value) { this.content = value; } get value() { return this.content; } setCustomValidity(value) { this.validation = value; } dispatchEvent(event) { Object.defineProperty(event, "target", { value: this }); props.onChange(event); } }
    const element = new NativeInput(); element.ownerDocument = { defaultView: { HTMLInputElement: NativeInput, Event } };
    return { props, emitted, element, forwarded, render() { state.reset(); const tree = TemporalInput(props), field = nodes(tree).find(node => node.type === "input"); element.value = field.props.value; field.props.ref(element); state.commit(); return tree; } };
}

test("actual date controls use an English calendar/text field and emit the original input target only on deliberate selection", () => {
    const view = mount({ min: "2026-10-01", max: "2026-10-03", required: true });
    let tree = view.render(); assert.equal(view.emitted.length, 0); assert.equal(view.forwarded.current, view.element);
    assert.equal(tree.props.lang, "en-AU"); assert.equal(nodes(tree).find(node => node.type === "input").props.type, "text");
    const calendar = nodes(tree).find(node => node.type === "Calendar"); assert.equal(calendar.props.locale, enAU); assert.equal(calendar.props.locale.localize.month(0, { width: "wide" }), "January");
    assert.equal(calendar.props.selected, undefined); assert.equal(calendar.props.disabled.length, 2); assert.match(view.element.validation, /YYYY-MM-DD/);
    calendar.props.onSelect(temporal.toCalendarDate("2026-10-02")); assert.deepEqual(view.emitted, ["2026-10-02"]); tree = view.render(); assert.equal(view.element.validation, "");
    view.props.value = "2026-02-30"; view.render(); assert.match(view.element.validation, /valid date/);
    view.props.value = "2026-10-04"; view.render(); assert.match(view.element.validation, /on or before/);
});

test("actual datetime/time controls retain explicit parts and clear optional values through the existing native onChange contract", () => {
    const view = mount({ type: "datetime-local", value: "2026-10-03T14:37" });
    nodes(view.render()).find(node => node.type === "Calendar").props.onSelect(temporal.toCalendarDate("2026-10-05")); assert.equal(view.props.value, "2026-10-05T14:37");
    nodes(view.render()).find(node => node.type === "select" && node.props["aria-label"].endsWith(" minute")).props.onChange({ target: { value: "45" } }); assert.equal(view.props.value, "2026-10-05T14:45");
    const clear = nodes(view.render()).find(node => node.type === "Button" && node.props.children === "Clear"); clear.props.onClick(); assert.equal(view.props.value, "");
    nodes(view.render()).find(node => node.type === "Calendar").props.onSelect(temporal.toCalendarDate("2026-10-06")); assert.equal(view.props.value, "2026-10-06T"); assert.match(view.render() && view.element.validation, /THH:mm/);
    const clock = mount({ type: "time" }); let tree = clock.render(); assert.ok(!nodes(tree).some(node => node.type === "Calendar"));
    nodes(tree).find(node => node.type === "select" && node.props["aria-label"].endsWith(" hour")).props.onChange({ target: { value: "09" } }); assert.equal(clock.props.value, "09:");
    tree = clock.render(); nodes(tree).find(node => node.type === "select" && node.props["aria-label"].endsWith(" minute")).props.onChange({ target: { value: "30" } }); assert.equal(clock.props.value, "09:30"); assert.equal(clock.render() && clock.element.validation, "");
});

test("disabled/read-only temporal controls cannot emit date, time or clear changes, and manual partial drafts remain visible", () => {
    for (const extra of [{ disabled: true }, { readOnly: true }]) {
        const view = mount({ type: "datetime-local", value: "2026-10-03T12:00", ...extra }), tree = view.render();
        nodes(tree).find(node => node.type === "Calendar").props.onSelect(temporal.toCalendarDate("2026-10-05")); nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: "20" } }); nodes(tree).find(node => node.type === "Button" && node.props.children === "Clear").props.onClick();
        assert.deepEqual(view.emitted, []); assert.equal(view.props.value, "2026-10-03T12:00");
        assert.equal(nodes(tree).find(node => node.type === "Popover").props.open, false);
    }
    const view = mount(), tree = view.render(), field = nodes(tree).find(node => node.type === "input"); view.element.value = "2026-10-"; field.props.onChange({ target: view.element });
    assert.equal(nodes(view.render()).find(node => node.type === "input").props.value, "2026-10-"); assert.match(view.element.validation, /valid date/);
});
