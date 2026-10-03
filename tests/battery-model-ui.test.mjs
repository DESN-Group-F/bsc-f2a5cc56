import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the actual component handlers with controlled hooks and transport.
// No browser, physical reader or shared business database is operated here.
const scratchRoot = new URL("../work/qa/", import.meta.url);
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(fileURLToPath(scratchRoot), "battery-model-ui-"));
for (const name of ["battery-models", "client-utils", "battery-age", "location-catalog"]) {
    const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "(\.\/[^\"]+)"/g, (_, specifier) => `from "${specifier}.mjs"`);
    await writeFile(join(scratch, `${name}.mjs`), compiled);
}
const [models, client, locations] = await Promise.all(["battery-models", "client-utils", "location-catalog"].map(name => import(pathToFileURL(join(scratch, `${name}.mjs`)))));
const ui = Object.fromEntries(["Button", "Checkbox", "Input", "Label", "Textarea", "RecordPicker", "BatteryModelPicker", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter"].map(name => [name, name]));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function hooks() {
    const state = [], effects = [];
    let pointer = 0, effectPointer = 0, scheduled = [];
    return {
        reset() { pointer = 0; effectPointer = 0; scheduled = []; },
        useState(initial) {
            const index = pointer++;
            if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
            return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }];
        },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, dependencies) {
            const index = effectPointer++, prior = effects[index];
            if (!prior || dependencies.some((value, key) => !Object.is(value, prior.dependencies[key]))) scheduled.push(() => { prior?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; });
        },
        commit() { for (const callback of scheduled) callback(); },
        unmount() { for (const effect of effects) effect?.cleanup?.(); },
    };
}
async function component(path, exportNames, state, additional = {}) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { ...ui, ...models, ...client, ...locations, ...state, currentSydneyDate: () => "2026-10-03", ...additional }, names = Object.keys(bindings);
    return new Function(...names, "_jsx", "_jsxs", "_Fragment", `${compiled}\nreturn {${exportNames.join(",")}};`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
}
function nodes(node, results = []) { if (Array.isArray(node)) { for (const item of node) nodes(item, results); } else if (node && typeof node === "object") { results.push(node); nodes(node.props?.children, results); } return results; }
function text(node) { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return node && typeof node === "object" ? text(node.props?.children) : ""; }
function button(tree, label) { return nodes(tree).find(node => node.type === "Button" && text(node) === label); }
function input(tree, id) { return nodes(tree).find(node => ["Input", "Textarea"].includes(node.type) && node.props.id === id); }
function checkbox(tree, field) { return nodes(tree).find(node => node.type === "Checkbox" && node.props.id === `use-model-${field}`); }
function choice(overrides = {}) {
    return { origin: "saved", id: "33333333-3333-4333-8333-333333333333", version: 1, label: "Test brand model A · 2S", brand: "Test brand", variant: "2S", name: "Reusable battery name", model: "Model A", chemistry: "LiPo", capacityMah: 2200, voltage: null, capacityBasis: "Rated", verificationStatus: "staff_entry", notes: "Not a safety assessment", warnings: ["Check the exact variant."], sources: [], contentHash: "a".repeat(64), ...overrides };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
async function environment(transport, run, seed = []) {
    const descriptors = Object.fromEntries(["fetch", "sessionStorage"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const entries = new Map(seed), requests = [];
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) } });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url, options = {}) => { requests.push({ url, options }); return transport(url, options); } });
    try { await run({ entries, requests }); }
    finally { for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
}
async function picker(props = {}) {
    const state = hooks(), applied = [], busy = [], callback = value => busy.push(value);
    const componentModule = await component("components/inventory/battery-model-picker.tsx", ["BatteryModelPicker", "verifyModelCreateReceipt", "recoverModelCreate", "modelCreateStorageKey"], state);
    const current = { dataset: "demo", actorAccountId: "native-review-account", canEditModels: false, values: {}, selection: null, disabled: false, onApply: (model, fields) => applied.push({ model, fields }), onManual() {}, onBusyChange: callback, ...props };
    return { ...componentModule, props: current, applied, busy, render() { state.reset(); const tree = componentModule.BatteryModelPicker(current); state.commit(); return tree; }, unmount: state.unmount };
}
async function settled(view) { view.render(); await new Promise(resolve => setImmediate(resolve)); return view.render(); }
function choose(view, model) { const picker = nodes(view.render()).find(node => node.type === "RecordPicker"); picker.props.onChange(`${model.origin}:${model.id}`); return view.render(); }
function draftFields(view, fields) { for (const [key, value] of Object.entries(fields)) input(view.render(), `new-model-${key}`).props.onChange({ target: { value } }); }
function receipt(payload, dataset, options = {}) {
    const model = choice({ ...payload, origin: "saved", contentHash: "b".repeat(64), version: payload.expectedVersion ? payload.expectedVersion + 1 : 1, ...options.model });
    return { ok: true, result: { model, requestId: payload.requestId || payload.id, actorAccountId: "native-review-account", dataset, replayed: false, ...options.result } };
}

test("model registration keeps asset identity, ownership, dates, location and tag, while subsequent overrides remove only their suggestion link", async () => {
    const state = hooks(), writes = [], data = { dataset: "demo", user: { id: "native-review-account", role: "staff" }, people: [], staffDirectory: [], buildings: [{ id: "J18", name: "Willis Annexe" }], rooms: [] };
    const { RecordEditor } = await component("components/inventory/record-editor.tsx", ["RecordEditor"], state);
    const props = { draft: { kind: "battery", initialTagId: "EXACT-TAG" }, data, onClose() {}, async write(action, payload) { writes.push({ action, payload }); } };
    const render = () => { state.reset(); return RecordEditor(props); };
    for (const [key, value] of Object.entries({ id: "BAT-MODEL-1", ownerId: "staff-owner", homeRoomId: "J18-DEMO", manufacturedOn: "2025-01-01", firstUsedOn: "2025-02-01" })) {
        const node = input(render(), `edit-${key}`) || nodes(render()).find(node => node.type === "RecordPicker" && node.props.id === (key === "ownerId" ? "edit-owner" : "edit-room"));
        if (node.type === "Input") node.props.onChange({ target: { value } }); else node.props.onChange(value);
    }
    nodes(render()).find(node => node.type === "BatteryModelPicker").props.onApply(choice(), ["name", "model", "chemistry", "capacityMah"]);
    assert.equal(input(render(), "edit-capacityMah").props.value, "2200");
    input(render(), "edit-capacityMah").props.onChange({ target: { value: "2500" } });
    await nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.deepEqual({ id: writes[0].payload.id, ownerId: writes[0].payload.ownerId, room: writes[0].payload.homeRoomId, building: writes[0].payload.homeBuildingId, tag: writes[0].payload.tagId, manufactured: writes[0].payload.manufacturedOn, firstUsed: writes[0].payload.firstUsedOn }, { id: "BAT-MODEL-1", ownerId: "staff-owner", room: "J18-DEMO", building: "J18", tag: "EXACT-TAG", manufactured: "2025-01-01", firstUsed: "2025-02-01" });
    assert.equal(writes[0].payload.capacityMah, 2500);
    assert.deepEqual(writes[0].payload.modelSelection.appliedFields, ["name", "model", "chemistry"]);
    assert.equal(writes[0].payload.modelSelection.confirmed, true);
    const existingState = hooks(), existing = await component("components/inventory/record-editor.tsx", ["RecordEditor"], existingState);
    existingState.reset(); assert.equal(nodes(existing.RecordEditor({ ...props, draft: { kind: "battery", record: { id: "BAT-EXISTING", version: 1 } } })).some(node => node.type === "BatteryModelPicker"), false);
});

test("conflicting and unknown specifications are preserved unless individually reviewed, and later manual edits invalidate an earlier overwrite confirmation", async () => {
    const model = choice();
    await environment(() => response({ dataset: "demo", models: [model], issues: [] }), async () => {
        const view = await picker({ values: { name: "Own battery name", capacityMah: "2400", voltage: "7.4", ownerId: "original-owner" } });
        await settled(view); choose(view, model);
        assert.equal(checkbox(view.render(), "name").props.checked, false);
        assert.equal(checkbox(view.render(), "capacityMah").props.checked, false);
        assert.equal(checkbox(view.render(), "voltage").props.disabled, true);
        checkbox(view.render(), "capacityMah").props.onCheckedChange(true);
        assert.equal(checkbox(view.render(), "capacityMah").props.checked, true);
        view.props.values = { ...view.props.values, capacityMah: "2600" };
        assert.equal(checkbox(view.render(), "capacityMah").props.checked, false);
        button(view.render(), "Use this model").props.onClick();
        assert.deepEqual(view.applied[0].fields, ["model", "chemistry"]);
        assert.equal(view.props.values.voltage, "7.4");
        assert.equal(nodes(view.render()).some(node => node.type === "RecordPicker" && node.props.showClearFilters === false), false);
        view.unmount();
    });
});

test("template creation saves null unknowns separately without registering or applying a physical battery", async () => {
    const catalog = [];
    await environment((url, options) => {
        if (!options.method) return response({ dataset: "demo", models: catalog, issues: [] });
        const body = JSON.parse(options.body), result = receipt(body.payload, body.dataset); catalog.push(result.result.model); return response(result);
    }, async ({ requests, entries }) => {
        const view = await picker(); await settled(view);
        button(view.render(), "Add reusable model").props.onClick();
        draftFields(view, { model: "NEW-A", name: "New model battery", brand: "Research brand" });
        assert.equal(nodes(view.render()).some(node => node.type === "form"), false);
        assert.equal(input(view.render(), "new-model-model").props.form, "battery-model-template");
        await button(view.render(), "Save reusable model").props.onClick(); await settled(view);
        const post = JSON.parse(requests.find(request => request.options.method === "POST").options.body);
        assert.equal(post.payload.capacityMah, null); assert.equal(post.payload.voltage, null); assert.equal(post.dataset, "demo");
        assert.equal(post.payload.ownerId, undefined); assert.equal(post.payload.tagId, undefined);
        assert.equal(view.applied.length, 0); assert.equal(entries.size, 0);
        assert.ok(text(view.render()).includes("physical battery has not been registered"));
        assert.deepEqual(view.busy, [true, false]); view.unmount();
    });
});

test("an interrupted save followed by lost authorization preserves the exact UUID and payload until a verified replay succeeds", async () => {
    let writes = 0, saved;
    await environment((url, options) => {
        if (!options.method) return response({ dataset: "demo", models: saved ? [saved] : [], issues: [] });
        const body = JSON.parse(options.body); writes++;
        if (writes === 1) { saved = receipt(body.payload, body.dataset).result.model; throw new Error("Interrupted transport"); }
        if (writes === 2) return response({ error: "Sign in required" }, 401);
        return response(receipt(body.payload, body.dataset, { result: { replayed: true } }));
    }, async ({ requests, entries }) => {
        const view = await picker(); await settled(view); button(view.render(), "Add reusable model").props.onClick(); draftFields(view, { model: "RETRY-A", name: "Retry model" });
        await button(view.render(), "Save reusable model").props.onClick();
        const original = JSON.parse([...entries.values()][0]); assert.equal(input(view.render(), "new-model-model").props.disabled, true);
        await button(view.render(), "Retry saved model request").props.onClick();
        assert.deepEqual(JSON.parse([...entries.values()][0]), original);
        assert.ok(text(view.render()).includes("original account"));
        await button(view.render(), "Retry saved model request").props.onClick(); await settled(view);
        assert.equal(entries.size, 0);
        const posts = requests.filter(request => request.options.method === "POST").map(request => request.options.body);
        assert.equal(posts.length, 3); assert.equal(new Set(posts).size, 1); assert.equal(view.applied.length, 0); view.unmount();
    });
});

test("foreign or mismatched success receipts never clear an uncertain request or show model success", async () => {
    await environment((url, options) => options.method ? response(receipt(JSON.parse(options.body).payload, "live")) : response({ dataset: "demo", models: [], issues: [] }), async ({ entries }) => {
        const view = await picker(); await settled(view); button(view.render(), "Add reusable model").props.onClick(); draftFields(view, { model: "CTX-A", name: "Context model" });
        await button(view.render(), "Save reusable model").props.onClick();
        assert.equal(entries.size, 1); assert.equal(view.applied.length, 0); assert.ok(text(view.render()).includes("could not be verified")); assert.equal(text(view.render()).includes("Model saved for reuse"), false); view.unmount();
    });
});

test("admin model edits use a distinct guarded request and fresh reload results supersede local saved copies without automatically applying changes", async () => {
    let catalog = [], posted;
    await environment((url, options) => {
        if (!options.method) return response({ dataset: "demo", models: catalog, issues: [] });
        const body = JSON.parse(options.body); posted = body;
        const result = receipt(body.payload, body.dataset); catalog = [result.result.model]; return response(result);
    }, async () => {
        const view = await picker({ canEditModels: true }); await settled(view); button(view.render(), "Add reusable model").props.onClick(); draftFields(view, { model: "EDIT-A", name: "Model before edit", capacityMah: "2200" });
        await button(view.render(), "Save reusable model").props.onClick(); await settled(view);
        button(view.render(), "Edit saved model").props.onClick(); draftFields(view, { name: "Model after edit", capacityMah: "2300" });
        await button(view.render(), "Save model changes").props.onClick(); await settled(view);
        assert.equal(posted.update, true); assert.equal(posted.payload.expectedVersion, 1); assert.notEqual(posted.payload.requestId, posted.payload.id); assert.equal(view.applied.length, 0);
        catalog = [choice({ ...catalog[0], name: "Changed by another administrator", capacityMah: 2600, version: 3, contentHash: "c".repeat(64) })];
        button(view.render(), "Reload models").props.onClick(); await settled(view);
        button(view.render(), "Use this model").props.onClick();
        assert.equal(view.applied[0].model.version, 3); assert.equal(view.applied[0].model.name, "Changed by another administrator"); assert.equal(view.applied[0].model.capacityMah, 2600); view.unmount();
    });
});

test("model editing is unavailable to ordinary staff and for external reference records", async () => {
    let catalog = [choice()];
    await environment(() => response({ dataset: "demo", models: catalog, issues: [] }), async () => {
        const staff = await picker(); await settled(staff); choose(staff, catalog[0]); assert.equal(button(staff.render(), "Edit saved model"), undefined); staff.unmount();
        catalog = [choice({ origin: "reference" })]; const admin = await picker({ canEditModels: true }); await settled(admin); choose(admin, catalog[0]); assert.equal(button(admin.render(), "Edit saved model"), undefined); admin.unmount();
    });
});

test("stale template edits keep their draft and advance the guarded version only after explicit review", async () => {
    let catalog = [choice()], writes = 0, saved;
    await environment((url, options) => {
        if (!options.method) return response({ dataset: "demo", models: catalog, issues: [] });
        const body = JSON.parse(options.body); writes++;
        if (writes === 1) { catalog = [choice({ name: "Another administrator's name", capacityMah: 2700, version: 2, contentHash: "d".repeat(64) })]; return response({ code: "model_conflict", error: "The saved model changed." }, 409); }
        saved = body; return response(receipt(body.payload, body.dataset));
    }, async () => {
        const view = await picker({ canEditModels: true }); await settled(view); choose(view, catalog[0]); button(view.render(), "Edit saved model").props.onClick(); draftFields(view, { name: "My retained draft" });
        await button(view.render(), "Save model changes").props.onClick();
        assert.equal(button(view.render(), "Save model changes").props.disabled, true); assert.equal(input(view.render(), "new-model-name").props.value, "My retained draft");
        await button(view.render(), "Review latest model").props.onClick();
        assert.equal(button(view.render(), "Save model changes").props.disabled, true); assert.ok(text(view.render()).includes("Another administrator's name"));
        button(view.render(), "Use reviewed version").props.onClick(); await button(view.render(), "Save model changes").props.onClick();
        assert.equal(saved.payload.expectedVersion, 2); assert.equal(saved.payload.name, "My retained draft"); assert.equal(view.applied.length, 0); view.unmount();
    });
});

test("saved requests recover only for their native account and inventory, and delayed responses cannot apply a model after unmount", async () => {
    let release;
    await environment((url, options) => !options.method ? response({ dataset: "demo", models: [], issues: [] }) : new Promise(resolve => { release = () => resolve(response(receipt(JSON.parse(options.body).payload, "demo"))); }), async ({ entries }) => {
        const view = await picker(); await settled(view); button(view.render(), "Add reusable model").props.onClick(); draftFields(view, { model: "LATE-A", name: "Delayed model" });
        const saving = button(view.render(), "Save reusable model").props.onClick();
        const raw = [...entries.values()][0]; assert.ok(view.recoverModelCreate(raw, "native-review-account", "demo")); assert.equal(view.recoverModelCreate(raw, "another-account", "demo"), null); assert.equal(view.recoverModelCreate(raw, "native-review-account", "live"), null);
        view.unmount(); release(); await saving;
        assert.equal(view.applied.length, 0); assert.deepEqual(view.busy, [true, false]); assert.equal(entries.size, 0);
    });
});

test("registration rejects dataset changes under an open draft without replacing the entered asset", async () => {
    const state = hooks(), writes = [], props = { draft: { kind: "battery", initialTagId: "ORIGINAL-TAG" }, data: { dataset: "demo", user: { id: "native-review-account", role: "staff" }, people: [], staffDirectory: [], buildings: [], rooms: [] }, onClose() {}, async write(...args) { writes.push(args); } };
    const { RecordEditor } = await component("components/inventory/record-editor.tsx", ["RecordEditor"], state);
    const render = () => { state.reset(); return RecordEditor(props); }; render(); props.data = { ...props.data, dataset: "live" };
    await nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(writes.length, 0); assert.equal(input(render(), "edit-tagId").props.value, "ORIGINAL-TAG"); assert.ok(text(render()).includes("inventory or account changed"));
});
