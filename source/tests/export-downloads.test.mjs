import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import ExcelJS from "exceljs";
import { downloadExportAttachment, downloadTaskJson, readDownloadAttachment, requestExportAttachment, parseCsv } from "../work/qa/client-utils.mjs";

const routeDirectory = "work/qa/review-fixes/attachment-route-tests";
await mkdir(routeDirectory, { recursive: true });
// Exercise the actual handler with an isolated inventory adapter, without using a running server or persistent database.
const compiled = ts.transpileModule(await readFile("app/api/export/route.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from "@\/(?:db|lib\/(?:api|shared-inventory|store))"/g, 'from "./context.mjs"')
    .replace(/from "@\/lib\/(domain|exports|downloads)"/g, (_, name) => `from "../../${name}.mjs"`);
await writeFile(`${routeDirectory}/route.mjs`, compiled);
await writeFile(`${routeDirectory}/context.mjs`, `
import { DomainError } from "../../domain.mjs";
import { z } from "zod";
const state = () => globalThis[Symbol.for("battery-export-attachment-test")];
export const getD1Database = () => ({});
export const requestUser = async () => state().actor;
export const sharedInventoryScope = async (_, dataset) => "attachment-review:" + dataset;
export async function requestJson(request, max) { const text = await request.text(); if (text.length > max) throw new DomainError(413, "This request is too large."); return JSON.parse(text); }
export const apiJson = (value, status = 200) => Response.json(value, { status });
export const apiError = error => apiJson({ error: error instanceof z.ZodError ? error.issues.map(issue => issue.message).join("; ") : error.message }, error.status ?? 400);
export class InventoryStore {
  constructor(_database, scope, dataset, actor) { const current = state(); current.actors.push(actor); this.viewerAccountId = actor.id; this.scope = scope; this.dataset = dataset; }
  async exportData() { const current = state(); current.reads++; return current.source; }
}
`);
const { GET, POST } = await import(`../${routeDirectory}/route.mjs`);
const symbol = Symbol.for("battery-export-attachment-test");
function fixture() {
    const batteries = [
        { id: "MINE", ownerAccountId: "native-self", ownerId: "staff-self", loanId: null, borrowerAccountId: null },
        { id: "OTHER", ownerAccountId: "native-other", ownerId: "staff-other", loanId: "other-loan", borrowerAccountId: "native-other" },
    ].map(battery => ({ name: "Attachment review battery", chemistry: "LiPo", model: "", capacityMah: null, voltage: null, manufacturedOn: null, firstUsedOn: null, chargedAt: null, lastCheckedOutAt: null, tagId: null, ownerName: "Same display name", borrowerName: null, homeBuildingId: "J18", homeRoomId: null, ...battery }));
    const state = { reads: 0, actors: [], actor: { id: "native-self", displayName: "Review staff", role: "staff", authVersion: 1 }, source: { snapshot: { batteries, actor: "Review staff", people: [], buildings: [], rooms: [] }, raw: { batteries: batteries.map(battery => ({ id: battery.id, key: `review/${battery.id}`, name: battery.name })), loans: [], observations: [], charges: [], audit_events: [], people: [], buildings: [], rooms: [] } } };
    globalThis[symbol] = state;
    return state;
}
const input = { dataset: "demo", mode: "summary", range: "selected", batteryIds: ["MINE"], filter: { personalScope: "responsible", search: "Saved selection survives ordinary filter changes" } };
const postRequest = (value, format) => new Request(`http://inventory.test/api/export${format === undefined ? "" : `?format=${format}`}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const csvHeaders = { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": 'attachment; filename="battery-review.csv"' };
function browserHarness(context) {
    const result = { clicks: 0, created: [], revoked: [], timer: null, removed: false, link: null };
    context.mock.method(URL, "createObjectURL", blob => { result.created.push(blob); return "blob:attachment-review"; });
    context.mock.method(URL, "revokeObjectURL", value => { result.revoked.push(value); });
    context.mock.method(globalThis, "setTimeout", (callback, delay) => { result.timer = { callback, delay }; return 0; });
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { body: { appendChild: link => { result.link = link; } }, createElement: kind => { assert.equal(kind, "a"); return { click: () => { result.clicks++; }, remove: () => { result.removed = true; } }; } } });
    context.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document; });
    return result;
}

test("formatted POST returns the actual JSON, CSV or Excel attachment from one authenticated inventory snapshot", async () => {
    for (const format of ["json", "csv", "xlsx"]) {
        const state = fixture(), response = await POST(postRequest(input, format));
        assert.equal(response.status, 200); assert.equal(state.reads, 1);
        assert.equal(state.actors[0].id, state.actor.id); assert.equal(state.actors[0].authVersion, 1);
        assert.match(response.headers.get("content-disposition"), new RegExp(`^attachment; filename="battery-summary-demo-.*\\.${format}"$`));
        assert.equal(response.headers.get("cache-control"), "no-store");
        if (format === "json") assert.deepEqual((await response.json()).tables.Inventory.map(row => row.battery_id), ["MINE"]);
        if (format === "csv") assert.deepEqual(parseCsv(await response.text()).map(row => row.battery_id), ["MINE"]);
        if (format === "xlsx") {
            const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await response.arrayBuffer());
            assert.equal(workbook.getWorksheet("Inventory").getCell("A2").value, "MINE");
        }
    }
});

test("existing JSON-document POST and attachment GET callers retain their behavior", async () => {
    const state = fixture(), document = await POST(postRequest(input));
    assert.equal(document.status, 200); assert.equal(document.headers.get("content-disposition"), null);
    assert.deepEqual((await document.json()).tables.Inventory.map(row => row.battery_id), ["MINE"]);
    const response = await GET(new Request(`http://inventory.test/api/export?${new URLSearchParams({ request: JSON.stringify(input), format: "csv" })}`));
    assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /\.csv"$/);
    assert.deepEqual(parseCsv(await response.text()).map(row => row.battery_id), ["MINE"]); assert.equal(state.reads, 2);
});

test("formatted POST preserves rejected selection and incompatible format errors in its actual response", async () => {
    fixture();
    const stale = await POST(postRequest({ ...input, batteryIds: ["MINE", "OTHER"] }, "csv"));
    assert.equal(stale.status, 409); assert.equal(stale.headers.get("content-disposition"), null);
    assert.match((await stale.json()).error, /No partial download/);
    const incompatible = await POST(postRequest({ ...input, mode: "detail" }, "csv"));
    assert.equal(incompatible.status, 400); assert.match((await incompatible.json()).error, /multiple tables/);
    const invalidFormat = await POST(postRequest(input, "pdf"));
    assert.equal(invalidFormat.status, 400); assert.equal(invalidFormat.headers.get("content-disposition"), null);
});

test("a single client request downloads the exact captured selection and the server filename without a second navigation", async context => {
    const state = fixture(), browser = browserHarness(context), requests = [];
    context.mock.method(globalThis, "fetch", async (url, init) => { requests.push({ url, init }); return POST(new Request(new URL(url, "http://inventory.test"), init)); });
    await downloadExportAttachment(input, "csv", "fallback.csv");
    assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/export?format=csv");
    assert.equal(requests[0].init.method, "POST"); assert.deepEqual(JSON.parse(requests[0].init.body), input);
    assert.equal(state.reads, 1); assert.equal(browser.clicks, 1); assert.equal(browser.created.length, 1);
    assert.equal(browser.link.href, "blob:attachment-review"); assert.match(browser.link.download, /^battery-summary-demo-.*\.csv$/);
    assert.deepEqual(parseCsv(await browser.created[0].text()).map(row => row.battery_id), ["MINE"]);
    assert.equal(browser.removed, true); assert.deepEqual(browser.revoked, []);
    assert.equal(browser.timer.delay, 60000); browser.timer.callback(); assert.deepEqual(browser.revoked, ["blob:attachment-review"]);
});

test("a personal selection changed before download surfaces the real server conflict and never creates a file", async context => {
    const state = fixture(), browser = browserHarness(context); let calls = 0;
    state.source.snapshot.batteries.find(battery => battery.id === "MINE").ownerAccountId = "native-other";
    context.mock.method(globalThis, "fetch", async (url, init) => { calls++; return POST(new Request(new URL(url, "http://inventory.test"), init)); });
    await assert.rejects(downloadExportAttachment(input, "json", "fallback.json"), /No partial download/);
    assert.equal(calls, 1); assert.equal(state.reads, 1); assert.equal(browser.clicks, 0); assert.deepEqual(browser.created, []);
});

test("failed, empty, interrupted and unexpected attachment bodies remain visible errors rather than downloaded error files", async context => {
    const browser = browserHarness(context);
    for (const response of [Response.json({ error: "Sign in with an active staff account." }, { status: 401 }), Response.json({ error: "The records changed. Refresh and review." }, { status: 409 }), Response.json({ error: "Service temporarily unavailable." }, { status: 503 })]) {
        const message = (await response.clone().json()).error;
        await assert.rejects(readDownloadAttachment(response, "csv", "fallback.csv"), error => error.message === message);
    }
    await assert.rejects(readDownloadAttachment(new Response("Forbidden", { status: 403 }), "csv", "fallback.csv"), /403/);
    await assert.rejects(readDownloadAttachment(new Response("<html>Sign in</html>", { headers: { "Content-Type": "text/html" } }), "csv", "fallback.csv"), /did not return the requested file/);
    await assert.rejects(readDownloadAttachment(new Response("", { headers: csvHeaders }), "csv", "fallback.csv"), /empty file/);
    await assert.rejects(readDownloadAttachment(new Response("{truncated", { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="review.json"' } }), "json", "fallback.json"), /incomplete export/);
    await assert.rejects(readDownloadAttachment(Response.json({ error: "A JSON document is not an attachment." }), "json", "fallback.json"), /did not return the requested file/);
    const interrupted = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("battery_id\n")); controller.error(new Error("Disconnected")); } }), { headers: csvHeaders });
    await assert.rejects(readDownloadAttachment(interrupted, "csv", "fallback.csv"), /file transfer was interrupted/);
    context.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network offline"); });
    await assert.rejects(downloadExportAttachment(input, "csv", "fallback.csv"), /download request was interrupted/);
    assert.equal(browser.clicks, 0); assert.deepEqual(browser.created, []);
});

test("request limits are checked before transfer and encoded attachment filenames are handled safely", async context => {
    let calls = 0; context.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("No request should be made"); });
    await assert.rejects(requestExportAttachment({ ...input, batteryIds: Array.from({ length: 1000 }, (_, index) => `BAT-${index}-${"x".repeat(30)}`) }, "csv", "fallback.csv"), /request is too large/);
    assert.equal(calls, 0);
    const attachment = await readDownloadAttachment(new Response("battery_id\nMINE", { headers: { ...csvHeaders, "Content-Disposition": "attachment; filename=basic.csv; filename*=UTF-8''review%2Fselection.csv" } }), "csv", "fallback.csv");
    assert.equal(attachment.filename, "review_selection.csv"); assert.equal(await attachment.blob.text(), "battery_id\nMINE");
});

test("task and message downloads reject truncated JSON, HTML and wrong attachment shapes before creating a file", async context => {
    const browser = browserHarness(context), headers = { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="messages.json"' };
    let makeResponse;
    context.mock.method(globalThis, "fetch", async () => makeResponse());
    for (const response of [
        () => new Response("{truncated", { headers }),
        () => new Response("<html>Sign in</html>", { headers: { "Content-Type": "text/html" } }),
        () => Response.json({ messages: [] }),
        () => Response.json({ metadata: { dataset: "live", scope: "personal_messages", exportedMessages: 0 }, messages: [] }, { headers }),
        () => Response.json({ metadata: { dataset: "demo", scope: "personal_messages", exportedMessages: 1 }, messages: [] }, { headers }),
        () => Response.json({ error: "Sign in again" }, { status: 401 }),
        () => { throw new TypeError("Connection ended"); },
    ]) {
        makeResponse = response;
        await assert.rejects(downloadTaskJson("/api/messages?dataset=demo&taskStatus=open&readState=unread&search=weekly&download=json", "messages.json"));
    }
    assert.equal(browser.clicks, 0); assert.deepEqual(browser.created, []);
});

test("task and message downloads retain the exact filter request and use verified attachment filenames and complete bodies", async context => {
    const browser = browserHarness(context), requests = [];
    const files = [
        { url: "/api/messages?dataset=demo&taskStatus=open&readState=unread&search=weekly&download=json", filename: "messages-demo.json", document: { metadata: { dataset: "demo", scope: "personal_messages", exportedMessages: 1 }, messages: [{ id: "own-unread" }] } },
        { url: "/api/task-plans?dataset=live&search=weekly&download=json", filename: "task-records-live.json", document: { metadata: { dataset: "live", scope: "shared_task_records", exportedPlans: 1, exportedCycles: 2 }, plans: [{ id: "weekly" }], cycles: [{ id: "completed" }, { id: "open" }] } },
    ];
    context.mock.method(globalThis, "fetch", async (url, init) => { requests.push({ url, init }); const file = files.find(file => file.url === url); return Response.json(file.document, { headers: { "Content-Disposition": `attachment; filename="${file.filename}"` } }); });
    for (const file of files) {
        await downloadTaskJson(file.url, "fallback.json");
        assert.equal(browser.link.download, file.filename);
        assert.deepEqual(JSON.parse(await browser.created.at(-1).text()), file.document);
    }
    assert.deepEqual(requests.map(request => request.url), files.map(file => file.url));
    assert.ok(requests.every(request => request.init.cache === "no-store"));
    assert.equal(browser.clicks, 2); assert.equal(browser.timer.delay, 60000);
});
