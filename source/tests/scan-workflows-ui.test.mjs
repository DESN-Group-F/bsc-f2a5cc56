import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import ts from "typescript";

// Evaluate the actual component handlers with controlled hooks and transport.
// Compile dependencies into this test's own directory, independent of the shared
// domain runner. These probes do not operate a browser, reader or business store.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "scan-workflows-ui-"));
for (const name of ["scan-session", "client-utils", "battery-age", "location-catalog"]) {
    const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
        .replace(/from "(\.\/[^\"]+)"/g, (_, specifier) => `from "${specifier}.mjs"`);
    await writeFile(join(scratch, `${name}.mjs`), output);
}
const [scan, client, locations] = await Promise.all(["scan-session", "client-utils", "location-catalog"].map(name => import(pathToFileURL(join(scratch, `${name}.mjs`)))));
const source = await readFile(new URL("../components/inventory/scan-station.tsx", import.meta.url), "utf8");
const componentSource = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const uiNames = ["CheckCircle2", "LogOut", "Radio", "RefreshCw", "ScanLine", "Trash2", "Button", "Input", "Label", "Checkbox", "Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue", "Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow", "Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"];
const ui = Object.fromEntries(uiNames.map(name => [name, name]));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
    const state = [];
    let pointer = 0;
    return {
        reset() { pointer = 0; },
        useState(initial) {
            const index = pointer++;
            if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
            return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
        },
        useRef(initial) {
            const index = pointer++;
            if (!(index in state)) state[index] = { current: initial };
            return state[index];
        },
        useEffect() {},
    };
}
function nodes(node, result = []) {
    if (Array.isArray(node)) { for (const item of node) nodes(item, result); return result; }
    if (!node || typeof node !== "object") return result;
    result.push(node); nodes(node.props?.children, result); return result;
}
function text(node) {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(text).join("");
    return node && typeof node === "object" ? text(node.props?.children) : "";
}
function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node) === label); }
function issueRows(tree) { return nodes(tree).filter(node => node.type === "article" && node.props.className === "history-entry px-5"); }
function roomPicker(tree) { return nodes(tree).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === "Session return room")); }
function simulatorRows(tree) {
    const list = nodes(tree).find(node => node.props.className === "scan-station-demo-list");
    return list ? nodes(list).filter(node => node.type === "label") : [];
}
function simulatorChoice(tree, id) {
    const row = simulatorRows(tree).find(node => node.key === id);
    return row && nodes(row).find(node => node.type === "Checkbox");
}
async function simulate(station) {
    button(station.render(), "Simulate selected reads").props.onClick();
    for (let pass = 0; pass < 50; pass++) {
        const tree = station.render();
        if (!tree.props["aria-busy"]) return tree;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail("The simulated read did not settle.");
}
function mount(props) {
    const state = hooks(), bindings = { ...ui, ...scan, ...client, ...locations, ...state }, names = Object.keys(bindings);
    const ScanStation = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${componentSource}\nreturn ScanStation;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    const render = () => { state.reset(); return ScanStation(props); };
    return {
        render,
        async read(tagId) {
            const input = nodes(render()).find(node => node.type === "Input" && node.props.id === "scan-station-tag");
            input.props.onChange({ target: { value: tagId } });
            await button(render(), "Read tag").props.onClick();
            return render();
        },
    };
}
async function withStorage(run) {
    const saved = Object.fromEntries(["window", "sessionStorage"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const entries = new Map();
    const storage = {
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: key => entries.delete(key),
    };
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {} });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, writable: true, value: storage });
    try {
        await run({ read: () => { assert.equal(entries.size, 1); return JSON.parse([...entries.values()][0]); } });
    } finally {
        for (const [name, descriptor] of Object.entries(saved)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
}
async function withFetch(transport, run) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: transport });
    try { await run(); }
    finally {
        if (saved) Object.defineProperty(globalThis, "fetch", saved);
        else Reflect.deleteProperty(globalThis, "fetch");
    }
}
const loanA = "11111111-1111-4111-8111-111111111111";
const loanB = "22222222-2222-4222-8222-222222222222";
const loanC = "33333333-3333-4333-8333-333333333333";
const loanD = "44444444-4444-4444-8444-444444444444";
function battery(id, tagId, loanId = null) {
    return { id, tagId, name: "Scenario battery", version: 1, ownerName: "Responsible staff", loanId, borrowerName: loanId ? "Current staff holder" : null, borrowerAccountId: loanId ? "holder-account" : null, checkedOutAt: loanId ? "2026-10-03T00:00:00.000Z" : null };
}
function data(batteries = []) {
    return {
        dataset: "demo", user: { id: "review-account", displayName: "Review staff", username: "reviewer", role: "admin" }, batteries,
        rooms: [{ id: "J18-DEMO-ROOM", buildingId: "J18", number: "DEMO", name: "Demo room", version: 1, selectable: true, isPlaceholder: true }],
        buildings: [{ id: "J18", name: "Willis Annexe" }], people: [], staffDirectory: [],
    };
}
function receipt(payload, inventory) {
    return {
        kind: payload.kind, requestId: payload.requestId, batteryIds: [...payload.batteryIds], count: payload.batteryIds.length, at: "2026-10-03T01:00:00.000Z",
        ...(payload.kind === "checkout" ? { borrower: inventory.user.displayName, borrowerAccountId: inventory.user.id } : {}),
        ...(payload.returnRoom ? { returnPlacement: { roomId: payload.returnRoom.roomId, roomName: "Demo room", isPlaceholder: true, source: "manual", observedAt: "2026-10-03T01:00:00.000Z" } } : {}),
    };
}

test("registration carries the exact unknown tag and resolves only that tag after a deliberate known reread", async () => withStorage(async store => {
    const inventory = data(), tags = new Map([["STATE-TAG", battery("STATE-BATTERY", "STATE-TAG", loanA)]]), calls = [], registrations = [];
    const props = { data: inventory, kind: "checkout", onExit() {}, onRegister: tagId => registrations.push(tagId), async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: tags.get(tagId) ?? null })) };
        return receipt(payload, inventory);
    } };
    const station = mount(props);
    await station.read("UNKNOWN-A"); await station.read("UNKNOWN-B");
    await station.read("STATE-TAG");
    const initial = store.read();
    assert.equal(initial.issues.filter(issue => issue.category === "unknown" && !issue.acknowledged).length, 2);
    assert.equal(initial.issues.filter(issue => issue.category === "state" && !issue.acknowledged).length, 1);
    const registrationA = issueRows(station.render()).find(row => text(row).includes("UNKNOWN-A"));
    button(registrationA, "Register new battery").props.onClick({ type: "click" });
    assert.deepEqual(registrations, ["UNKNOWN-A"]);
    tags.set("UNKNOWN-A", battery("NEW-BATTERY-A", "UNKNOWN-A"));
    assert.equal(calls.filter(call => call.action === "movement").length, 0, "registration handoff alone cannot save a movement");
    const tree = await station.read("UNKNOWN-A"), current = store.read();
    const issueA = current.issues.find(issue => issue.category === "unknown" && issue.tagId === "UNKNOWN-A");
    assert.equal(issueA.acknowledged, true); assert.equal(issueA.resolvedBatteryId, "NEW-BATTERY-A");
    assert.equal(current.issues.find(issue => issue.tagId === "UNKNOWN-B").acknowledged, false);
    assert.equal(current.issues.find(issue => issue.category === "state").acknowledged, false);
    assert.equal(current.completed.length, 1); assert.equal(current.completed[0].battery.id, "NEW-BATTERY-A");
    assert.equal(current.queue.length, 0); assert.equal(current.attempt, null);
    assert.equal(calls.filter(call => call.action === "movement").length, 1);
    const resolved = issueRows(tree).find(row => text(row).includes("UNKNOWN-A"));
    assert.match(text(resolved), /Registered tag.*Resolved/);
    assert.equal(button(resolved, "Register new battery"), undefined);
    assert.ok(button(issueRows(tree).find(row => text(row).includes("UNKNOWN-B")), "Register new battery"));
    assert.equal(nodes(tree).filter(node => node.type === "Button" && text(node) === "Register new battery").length, 1);
}));

test("one return station handles different loans of the same battery, preserves both receipts and blocks reads during an uncertain write", async () => withStorage(async store => {
    let currentBattery = battery("ROUND-TRIP", "ROUND-TAG", loanA), fail = false;
    const inventory = data([currentBattery]), calls = [];
    const props = { data: inventory, kind: "return", onExit() {}, onRegister() {}, async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: currentBattery })) };
        if (fail) throw Object.assign(new Error("The transport failed after submission."), { status: 503 });
        return receipt(payload, inventory);
    } };
    const station = mount(props);
    const roomPicker = nodes(station.render()).find(node => node.type === "Select" && nodes(node).some(child => child.props["aria-label"] === "Session return room"));
    roomPicker.props.onValueChange("J18-DEMO-ROOM");
    await station.read("ROUND-TAG");
    currentBattery = { ...currentBattery, loanId: null, borrowerName: null };
    await station.read("ROUND-TAG");
    assert.equal(calls.filter(call => call.action === "movement").length, 1, "rereading after the confirmed return must be ignored");
    currentBattery = { ...currentBattery, loanId: loanB, borrowerName: "Next staff holder", checkedOutAt: "2026-10-03T02:00:00.000Z" };
    let tree = await station.read("ROUND-TAG");
    const movements = calls.filter(call => call.action === "movement"), completed = store.read().completed;
    assert.equal(movements.length, 2); assert.equal(completed.length, 2);
    assert.deepEqual(movements.map(call => call.payload.expectedLoans), [[{ batteryId: "ROUND-TRIP", loanId: loanA }], [{ batteryId: "ROUND-TRIP", loanId: loanB }]]);
    assert.deepEqual(movements.map(call => call.payload.returnRoom), [{ roomId: "J18-DEMO-ROOM", version: 1 }, { roomId: "J18-DEMO-ROOM", version: 1 }]);
    assert.deepEqual(completed.map(read => read.battery.loanId), [loanA, loanB]);
    assert.notEqual(completed[0].receipt.requestId, completed[1].receipt.requestId);
    const completedTable = nodes(tree).find(node => node.type === "section" && node.props.className === "scan-station-completed inventory-panel");
    const rowKeys = nodes(completedTable).filter(node => node.type === "TableRow" && node.key).map(node => node.key);
    assert.equal(rowKeys.length, 2); assert.equal(new Set(rowKeys).size, 2);
    await station.read("ROUND-TAG");
    assert.equal(calls.filter(call => call.action === "movement").length, 2, "the same completed loan must remain a duplicate");
    assert.equal(store.read().issues.filter(issue => issue.category === "duplicate").length, 2);
    currentBattery = { ...currentBattery, loanId: loanC }; fail = true;
    tree = await station.read("ROUND-TAG");
    const uncertain = store.read();
    assert.equal(uncertain.attempt.status, "uncertain");
    assert.deepEqual(uncertain.attempt.payload.expectedLoans, [{ batteryId: "ROUND-TRIP", loanId: loanC }]);
    assert.equal(uncertain.completed.length, 2);
    const before = calls.length, captured = structuredClone(uncertain.attempt.payload);
    currentBattery = { ...currentBattery, loanId: loanD };
    assert.equal(button(tree, "Read tag").props.disabled, true);
    await button(tree, "Read tag").props.onClick();
    assert.equal(calls.length, before, "even an invoked stale handler must not look up or submit another battery");
    assert.deepEqual(store.read().attempt.payload, captured);
    const restored = mount(props), recoveredTree = restored.render();
    assert.equal(button(recoveredTree, "Read tag").props.disabled, true);
    assert.match(text(recoveredTree), /Movement result uncertain/);
    await button(recoveredTree, "Read tag").props.onClick();
    assert.equal(calls.length, before);
    assert.deepEqual(store.read().attempt.payload, captured);
    assert.equal(store.read().completed.length, 2);
    assert.ok(scan.recoverScanSession(JSON.stringify(store.read()), "return"), "distinct completed loans must remain recoverable alongside the exact pending third request");
}));

test("continuous checkout accepts a later in-store round but ignores an active loan without replacing earlier receipts", async () => withStorage(async store => {
    let currentBattery = battery("REUSED-CHECKOUT", "CHECKOUT-TAG");
    const inventory = data([currentBattery]), calls = [];
    const props = { data: inventory, kind: "checkout", onExit() {}, onRegister() {}, async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: currentBattery })) };
        return receipt(payload, inventory);
    } };
    const station = mount(props);
    await station.read("CHECKOUT-TAG");
    currentBattery = { ...currentBattery, loanId: loanA, borrowerName: inventory.user.displayName };
    await station.read("CHECKOUT-TAG");
    assert.equal(calls.filter(call => call.action === "movement").length, 1);
    currentBattery = { ...currentBattery, loanId: null, borrowerName: null };
    await station.read("CHECKOUT-TAG");
    const completed = store.read().completed, movements = calls.filter(call => call.action === "movement");
    assert.equal(completed.length, 2); assert.equal(movements.length, 2);
    assert.notEqual(movements[0].payload.requestId, movements[1].payload.requestId);
    assert.equal(movements[0].payload.scan.sessionId, movements[1].payload.scan.sessionId);
    assert.deepEqual(movements.map(call => call.payload.batteryIds), [["REUSED-CHECKOUT"], ["REUSED-CHECKOUT"]]);
    assert.ok(movements.every(call => call.payload.expectedLoans === undefined));
    currentBattery = { ...currentBattery, loanId: loanB };
    await station.read("CHECKOUT-TAG");
    assert.equal(calls.filter(call => call.action === "movement").length, 2);
    assert.equal(store.read().issues.filter(issue => issue.category === "duplicate").length, 2);
    assert.equal(store.read().completed.length, 2);
    assert.equal(store.read().attempt, null);
}));

test("discarding a reviewed room conflict requires an explicit fresh room choice in the same station while preserving earlier receipts", async () => withStorage(async store => {
    let currentBattery = battery("ROOM-CONFLICT", "ROOM-TAG", loanA), roomChanged = false;
    const inventory = data([currentBattery]), calls = [], latestInventory = { ...inventory, rooms: inventory.rooms.map(room => ({ ...room, version: 2, name: "Renamed demo room" })) };
    const props = { data: inventory, kind: "return", onExit() {}, onRegister() {}, async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: currentBattery })) };
        if (roomChanged && payload.returnRoom?.version !== 2) throw Object.assign(new Error("This return room changed. Nothing was saved."), { status: 409, code: "movement_rejected_final" });
        const result = receipt(payload, inventory);
        if (payload.returnRoom?.version === 2) result.returnPlacement.roomName = "Renamed demo room";
        return result;
    } };
    await withFetch(async (url, options) => {
        assert.equal(url, "/api/inventory?dataset=demo"); assert.equal(options.cache, "no-store");
        return Response.json({ ...latestInventory, batteries: [currentBattery] });
    }, async () => {
        const station = mount(props);
        roomPicker(station.render()).props.onValueChange("J18-DEMO-ROOM");
        await station.read("ROOM-TAG");
        const originalReceipt = structuredClone(store.read().completed[0]);
        assert.equal(roomPicker(station.render()).props.disabled, true, "ordinary completed sessions retain their room lock");
        button(station.render(), "Batch").props.onClick();
        roomChanged = true; currentBattery = { ...currentBattery, loanId: loanB };
        await station.read("ROOM-TAG");
        await button(station.render(), "Confirm batch (1)").props.onClick();
        const captured = structuredClone(store.read().attempt.payload);
        assert.equal(store.read().attempt.status, "rejected");
        assert.deepEqual(captured.returnRoom, { roomId: "J18-DEMO-ROOM", version: 1 });
        await button(station.render(), "Review current records").props.onClick();
        let tree = station.render();
        assert.match(text(tree), /Captured room version 1; current version 2/);
        assert.deepEqual(store.read().attempt.payload, captured, "review must not substitute the current room into the captured request");
        roomPicker(tree).props.onValueChange("J18-DEMO-ROOM");
        assert.deepEqual(store.read().attempt.payload, captured);
        await button(tree, "Retry same request").props.onClick();
        const submitted = calls.filter(call => call.action === "movement");
        assert.deepEqual(submitted.at(-1).payload, captured, "retry uses the original v1 binding and request ID");
        await button(station.render(), "Review current records").props.onClick();
        button(station.render(), "Discard rejected request after review").props.onClick();
        button(station.render(), "Discard rejected request").props.onClick();
        tree = station.render();
        assert.equal(store.read().attempt, null); assert.equal(store.read().room, null); assert.equal(store.read().roomConfirmationRequired, true);
        assert.equal(roomPicker(tree).props.disabled, false, "reviewed discard can re-confirm the room despite earlier completed movements");
        assert.match(text(roomPicker(tree)), /Renamed demo room/);
        assert.equal(button(tree, "Read tag").props.disabled, true);
        const before = calls.length;
        await station.read("ROOM-TAG");
        assert.equal(calls.length, before, "an invoked stale read handler cannot omit the former room silently");
        roomPicker(station.render()).props.onValueChange("J18-DEMO-ROOM");
        assert.equal(store.read().room.version, 2); assert.equal(store.read().room.name, "Renamed demo room");
        assert.equal(store.read().roomConfirmationRequired, false);
        await station.read("ROOM-TAG");
        await button(station.render(), "Confirm batch (1)").props.onClick();
        const fresh = calls.filter(call => call.action === "movement").at(-1).payload, saved = store.read();
        assert.notEqual(fresh.requestId, captured.requestId); assert.deepEqual(fresh.returnRoom, { roomId: "J18-DEMO-ROOM", version: 2 });
        assert.deepEqual(fresh.expectedLoans, [{ batteryId: "ROOM-CONFLICT", loanId: loanB }]);
        assert.equal(fresh.scan.sessionId, captured.scan.sessionId);
        assert.deepEqual(saved.completed[0], originalReceipt, "previous receipt and placement evidence remain unchanged");
        assert.equal(saved.completed[1].receipt.returnPlacement.roomName, "Renamed demo room");
        assert.equal(saved.completed.length, 2); assert.equal(saved.attempt, null);
        assert.equal(roomPicker(station.render()).props.disabled, true);
        assert.deepEqual(captured.returnRoom, { roomId: "J18-DEMO-ROOM", version: 1 });
    });
}));

test("room reconfirmation survives remount and cannot accept an unavailable live placeholder or silently default to unspecified", async () => withStorage(async store => {
    const currentBattery = battery("LIVE-ROOM-CONFLICT", "LIVE-ROOM-TAG", loanA), inventory = { ...data([currentBattery]), dataset: "live" };
    inventory.rooms = inventory.rooms.map(room => ({ ...room, isPlaceholder: false }));
    const latestInventory = { ...inventory, rooms: inventory.rooms.map(room => ({ ...room, version: 2, name: "Unverified renamed room", isPlaceholder: true })) }, calls = [];
    const props = { data: inventory, kind: "return", onExit() {}, onRegister() {}, async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: currentBattery })) };
        if (payload.returnRoom) throw Object.assign(new Error("This return room changed. Nothing was saved."), { status: 409, code: "movement_rejected_final" });
        return receipt(payload, inventory);
    } };
    let fetchCount = 0;
    await withFetch(async (url, options) => {
        fetchCount++; assert.equal(url, "/api/inventory?dataset=live"); assert.equal(options.cache, "no-store");
        return Response.json(latestInventory);
    }, async () => {
        const station = mount(props);
        roomPicker(station.render()).props.onValueChange("J18-DEMO-ROOM");
        await station.read("LIVE-ROOM-TAG");
        const captured = structuredClone(store.read().attempt.payload);
        await button(station.render(), "Review current records").props.onClick();
        button(station.render(), "Discard rejected request after review").props.onClick();
        button(station.render(), "Discard rejected request").props.onClick();
        let tree = station.render();
        const unavailable = nodes(roomPicker(tree)).find(node => node.type === "SelectItem" && node.props.value === "J18-DEMO-ROOM");
        assert.equal(unavailable.props.disabled, true);
        roomPicker(tree).props.onValueChange("J18-DEMO-ROOM");
        roomPicker(station.render()).props.onValueChange("NOT-IN-DIRECTORY");
        assert.equal(store.read().roomConfirmationRequired, true); assert.equal(store.read().room, null);
        assert.ok(scan.recoverScanSession(JSON.stringify(store.read()), "return"));
        assert.equal(scan.recoverScanSession(JSON.stringify(store.read()), "checkout"), null);
        const restored = mount(props); tree = restored.render();
        assert.equal(button(tree, "Read tag").props.disabled, true);
        assert.equal(roomPicker(tree).props.disabled, true, "a remount must not reuse its stale v1 parent directory");
        roomPicker(tree).props.onValueChange("J18-DEMO-ROOM");
        roomPicker(restored.render()).props.onValueChange("__unspecified");
        assert.equal(store.read().roomConfirmationRequired, true);
        const before = calls.length;
        await restored.read("LIVE-ROOM-TAG"); assert.equal(calls.length, before);
        await button(restored.render(), "Reload current return rooms").props.onClick();
        assert.equal(fetchCount, 2);
        roomPicker(restored.render()).props.onValueChange("J18-DEMO-ROOM");
        assert.equal(store.read().roomConfirmationRequired, true);
        roomPicker(restored.render()).props.onValueChange("__unspecified");
        assert.equal(store.read().roomConfirmationRequired, false); assert.equal(store.read().room, null);
        await restored.read("LIVE-ROOM-TAG");
        const fresh = calls.filter(call => call.action === "movement").at(-1).payload;
        assert.notEqual(fresh.requestId, captured.requestId); assert.equal(fresh.returnRoom, undefined);
        assert.deepEqual(captured.returnRoom, { roomId: "J18-DEMO-ROOM", version: 1 });
        assert.equal(store.read().completed.length, 1); assert.equal(store.read().completed[0].receipt.returnPlacement, undefined);
    });
}));

test("simulator offers tagged batteries for the movement and resets confirmed choices without blocking a later round at the same metadata version", async () => {
    for (const kind of ["checkout", "return"]) await withStorage(async store => {
        const first = battery("SIM-ROUND", "SIM-ROUND-TAG", kind === "return" ? loanA : null);
        const remaining = battery("SIM-REMAINING", "SIM-REMAINING-TAG", kind === "return" ? loanC : null);
        const wrongState = battery("SIM-WRONG-STATE", "SIM-WRONG-TAG", kind === "checkout" ? loanD : null);
        const noTag = battery("SIM-NO-TAG", null, kind === "return" ? loanD : null);
        const inventory = data([first, remaining, wrongState, noTag]), calls = [];
        let currentBattery = first;
        const props = { data: inventory, kind, onExit() {}, onRegister() {}, async write(action, payload) {
            calls.push({ action, payload: structuredClone(payload) });
            if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: currentBattery })) };
            return receipt(payload, props.data);
        } };
        const station = mount(props);
        assert.deepEqual(simulatorRows(station.render()).map(row => row.key), ["SIM-ROUND", "SIM-REMAINING"]);
        assert.equal(simulatorChoice(station.render(), "SIM-WRONG-STATE"), undefined);
        assert.equal(simulatorChoice(station.render(), "SIM-NO-TAG"), undefined);
        simulatorChoice(station.render(), "SIM-ROUND").props.onCheckedChange(true);
        assert.equal(simulatorChoice(station.render(), "SIM-ROUND").props.checked, true);
        let tree = await simulate(station);
        assert.equal(store.read().completed.length, 1);
        assert.equal(simulatorChoice(tree, "SIM-ROUND"), undefined, "the confirmed action cannot remain selectable from its stale in-store/on-loan snapshot");
        assert.equal(simulatorChoice(tree, "SIM-REMAINING").props.checked, false, "unprocessed choices remain available");
        assert.equal(button(tree, "Simulate selected reads").props.disabled, true);
        assert.equal(calls.filter(call => call.action === "movement").length, 1);

        currentBattery = { ...first, loanId: kind === "return" ? loanB : null, borrowerName: kind === "return" ? "Later staff holder" : null };
        assert.equal(currentBattery.version, first.version, "loan cycles do not need a metadata edit");
        props.data = { ...inventory, batteries: [currentBattery, remaining, wrongState, noTag] };
        tree = station.render();
        assert.equal(simulatorChoice(tree, "SIM-ROUND").props.checked, false, "success clears the selection rather than preserving a hidden checked item");
        simulatorChoice(tree, "SIM-ROUND").props.onCheckedChange(true);
        tree = await simulate(station);
        const movements = calls.filter(call => call.action === "movement"), completed = store.read().completed;
        assert.equal(movements.length, 2); assert.equal(completed.length, 2);
        assert.notEqual(movements[0].payload.requestId, movements[1].payload.requestId);
        assert.equal(movements[0].payload.scan.sessionId, movements[1].payload.scan.sessionId);
        assert.ok(movements.every(call => call.payload.scan.source === "simulated"));
        if (kind === "return") assert.deepEqual(movements.map(call => call.payload.expectedLoans), [
            [{ batteryId: "SIM-ROUND", loanId: loanA }], [{ batteryId: "SIM-ROUND", loanId: loanB }],
        ]);
        assert.equal(simulatorChoice(tree, "SIM-ROUND"), undefined);
        assert.equal(simulatorChoice(tree, "SIM-REMAINING").props.checked, false);
    });
});

test("simulated lookup, state, rejection and unverified receipt failures retain the selected battery and never claim completion", async () => {
    for (const failure of ["lookup", "unknown", "state", "rejected", "malformed"]) await withStorage(async store => {
        const selected = battery("SIM-FAILED", "SIM-FAILED-TAG"), inventory = data([selected]), calls = [];
        const props = { data: inventory, kind: "checkout", onExit() {}, onRegister() {}, async write(action, payload) {
            calls.push({ action, payload: structuredClone(payload) });
            if (action === "scan_lookup") {
                if (failure === "lookup") throw new Error("The lookup is unavailable.");
                return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: failure === "unknown" ? null : failure === "state" ? { ...selected, loanId: loanA } : selected })) };
            }
            if (failure === "rejected") throw Object.assign(new Error("This captured movement was finally rejected."), { status: 409, code: "movement_rejected_final" });
            const result = receipt(payload, inventory);
            return { ...result, requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
        } };
        const station = mount(props);
        simulatorChoice(station.render(), "SIM-FAILED").props.onCheckedChange(true);
        const tree = await simulate(station), captured = store.read();
        assert.equal(simulatorChoice(tree, "SIM-FAILED").props.checked, true, `${failure}: unconfirmed work must retain the deliberate selection`);
        assert.equal(captured.completed.length, 0);
        assert.equal(calls.filter(call => call.action === "movement").length, ["rejected", "malformed"].includes(failure) ? 1 : 0);
        if (failure === "rejected" || failure === "malformed") {
            assert.equal(captured.attempt.status, failure === "malformed" ? "uncertain" : "rejected");
            assert.equal(simulatorChoice(tree, "SIM-FAILED").props.disabled, true);
            assert.equal(button(tree, "Simulate selected reads").props.disabled, true);
            assert.deepEqual(captured.attempt.payload.batteryIds, ["SIM-FAILED"]);
        } else {
            assert.equal(captured.attempt, null);
            assert.equal(button(tree, "Simulate selected reads").props.disabled, false);
            assert.ok(captured.issues.some(issue => issue.category === failure || failure === "lookup" && issue.category === "lookup"));
        }
    });
});

test("partial continuous simulated success clears only confirmed selections, preserves the uncertain request and clears the remainder after exact retry despite failed refresh", async () => withStorage(async store => {
    const first = battery("SIM-FIRST", "SIM-FIRST-TAG"), second = battery("SIM-SECOND", "SIM-SECOND-TAG"), third = battery("SIM-THIRD", "SIM-THIRD-TAG");
    const inventory = data([first, second, third]), calls = [];
    let interrupt = true, refreshes = 0;
    const props = { data: inventory, kind: "checkout", onExit() {}, onRegister() {}, async onChanged() {
        refreshes++; throw new Error("The shared snapshot could not refresh.");
    }, async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: inventory.batteries.find(item => item.tagId === tagId) })) };
        if (interrupt && payload.batteryIds.includes("SIM-SECOND")) throw Object.assign(new Error("The response was lost after submission."), { status: 503 });
        return receipt(payload, inventory);
    } };
    const station = mount(props);
    for (const item of inventory.batteries) simulatorChoice(station.render(), item.id).props.onCheckedChange(true);
    let tree = await simulate(station), saved = store.read();
    assert.equal(saved.completed.length, 1); assert.equal(saved.completed[0].battery.id, "SIM-FIRST");
    assert.equal(saved.attempt.status, "uncertain");
    const captured = structuredClone(saved.attempt.payload);
    assert.deepEqual(captured.batteryIds, ["SIM-SECOND"]);
    assert.deepEqual(saved.queue.map(read => read.battery.id), ["SIM-SECOND", "SIM-THIRD"]);
    assert.equal(simulatorChoice(tree, "SIM-FIRST"), undefined, "a failed refresh cannot restore the already confirmed action as a choice");
    for (const id of ["SIM-SECOND", "SIM-THIRD"]) {
        assert.equal(simulatorChoice(tree, id).props.checked, true); assert.equal(simulatorChoice(tree, id).props.disabled, true);
    }
    assert.match(text(tree), /Shared inventory refresh is unavailable/);
    assert.equal(refreshes, 1);
    const before = calls.length;
    await simulate(station);
    assert.equal(calls.length, before, "even an invoked stale simulator handler cannot send another lookup while the request is uncertain");
    assert.deepEqual(store.read().attempt.payload, captured);
    interrupt = false;
    await button(station.render(), "Retry same request").props.onClick();
    tree = station.render(); saved = store.read();
    const movements = calls.filter(call => call.action === "movement");
    assert.deepEqual(movements.map(call => call.payload.batteryIds), [["SIM-FIRST"], ["SIM-SECOND"], ["SIM-SECOND"], ["SIM-THIRD"]]);
    assert.deepEqual(movements[2].payload, captured, "retry must preserve the exact captured request and bindings");
    assert.equal(saved.completed.length, 3); assert.equal(saved.attempt, null); assert.equal(saved.queue.length, 0);
    assert.equal(simulatorRows(tree).length, 0); assert.equal(button(tree, "Simulate selected reads").props.disabled, true);
    assert.match(text(tree), /No tagged in-store batteries available for checkout/);
    assert.deepEqual(inventory.batteries.map(item => item.loanId), [null, null, null], "the test deliberately keeps the parent snapshot stale after all verified writes");
    props.data = { ...inventory, batteries: inventory.batteries.map(item => ({ ...item, loanId: loanD })) };
    assert.equal(simulatorRows(station.render()).length, 0, "a fresh authoritative on-loan snapshot is also ineligible for checkout");
    props.data = { ...inventory, batteries: inventory.batteries.map(item => ({ ...item })) };
    for (const item of inventory.batteries) assert.equal(simulatorChoice(station.render(), item.id).props.checked, false);
}));

test("batch simulation preserves checked inputs while queued and clears them only after its verified atomic confirmation", async () => withStorage(async store => {
    const first = battery("SIM-BATCH-A", "SIM-BATCH-A-TAG", loanA), second = battery("SIM-BATCH-B", "SIM-BATCH-B-TAG", loanB);
    const inventory = data([first, second]), calls = [];
    const props = { data: inventory, kind: "return", onExit() {}, onRegister() {}, async write(action, payload) {
        calls.push({ action, payload: structuredClone(payload) });
        if (action === "scan_lookup") return { source: payload.source, results: payload.tagIds.map(tagId => ({ tagId, battery: inventory.batteries.find(item => item.tagId === tagId) })) };
        return receipt(payload, inventory);
    } };
    const station = mount(props);
    button(station.render(), "Batch").props.onClick();
    for (const item of inventory.batteries) simulatorChoice(station.render(), item.id).props.onCheckedChange(true);
    let tree = await simulate(station), saved = store.read();
    assert.equal(saved.queue.length, 2); assert.equal(saved.completed.length, 0); assert.equal(saved.attempt, null);
    assert.equal(calls.filter(call => call.action === "movement").length, 0, "reading a batch is not a confirmed movement");
    for (const item of inventory.batteries) assert.equal(simulatorChoice(tree, item.id).props.checked, true);
    await button(tree, "Confirm batch (2)").props.onClick();
    tree = station.render(); saved = store.read();
    const movements = calls.filter(call => call.action === "movement");
    assert.equal(movements.length, 1); assert.deepEqual(movements[0].payload.batteryIds, ["SIM-BATCH-A", "SIM-BATCH-B"]);
    assert.deepEqual(movements[0].payload.expectedLoans, [{ batteryId: "SIM-BATCH-A", loanId: loanA }, { batteryId: "SIM-BATCH-B", loanId: loanB }]);
    assert.equal(saved.completed.length, 2); assert.equal(saved.queue.length, 0); assert.equal(saved.attempt, null);
    assert.equal(new Set(saved.completed.map(read => read.receipt.requestId)).size, 1, "the batch records one atomic movement receipt");
    assert.equal(simulatorRows(tree).length, 0); assert.match(text(tree), /No tagged on-loan batteries available for return/);
    props.data = { ...inventory, batteries: inventory.batteries.map(item => ({ ...item, loanId: loanC })) };
    for (const item of inventory.batteries) assert.equal(simulatorChoice(station.render(), item.id).props.checked, false, "the later return loan starts without stale selections");
}));
