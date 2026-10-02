import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { InventoryStore } from "../work/qa/store.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { excelBuffer } from "../work/qa/downloads.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('unicode-export-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "unicode-export-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    await db.batch(sql.split("--> statement-breakpoint").filter(statement => statement.trim()).map(statement => db.prepare(statement)));
}
after(() => mf.dispose());
const now = "2026-10-02T02:00:00.000Z", accountId = "unicode-export-admin";
await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(accountId, accountId, "Unicode export staff", "admin", "test-only-no-login", "test-only-no-login", 600000, now, now).run();
const inventory = new InventoryStore(db, "unicode-export:demo", "demo", { id: accountId, name: "Unicode export staff", role: "admin", authVersion: 1 }, () => new Date(now));
await inventory.initializeDemo();

function parseXml(xml, handlers) {
    const parser = new SaxesParser();
    for (const [event, handler] of Object.entries(handlers)) parser.on(event, handler);
    parser.write(xml).close();
}

async function rawWorkbook(bytes) {
    const zip = await JSZip.loadAsync(bytes), files = {};
    // Decode each complete XML byte array once: a library string reader can hide its own chunk-decoding defect.
    for (const entry of Object.values(zip.files).filter(entry => /\.(?:xml|rels)$/.test(entry.name))) {
        files[entry.name] = new TextDecoder("utf-8", { fatal: true }).decode(await entry.async("uint8array"));
        assert.ok(!files[entry.name].includes("\uFFFD"), `${entry.name} contains a replacement character absent from this fixture`);
    }
    const shared = [];
    let sharedText = "", inText = false;
    parseXml(files["xl/sharedStrings.xml"], {
        opentag: tag => { if (tag.name === "si") sharedText = ""; if (tag.name === "t") inText = true; },
        text: value => { if (inText) sharedText += value; },
        closetag: tag => { if (tag.name === "t") inText = false; if (tag.name === "si") shared.push(sharedText); },
    });
    const sheets = new Map();
    parseXml(files["xl/workbook.xml"], { opentag: tag => {
        if (tag.name !== "sheet") return;
        const xml = files[`xl/worksheets/sheet${tag.attributes.sheetId}.xml`], rows = [];
        let row, cell, value = "", inValue = false;
        parseXml(xml, {
            opentag: current => {
                if (current.name === "row") row = { number: Number(current.attributes.r), cells: {} };
                if (current.name === "c") { cell = current.attributes; value = ""; }
                if (current.name === "v") inValue = true;
            },
            text: text => { if (inValue) value += text; },
            closetag: current => {
                if (current.name === "v") inValue = false;
                if (current.name === "c") row.cells[cell.r.replace(/[0-9]+$/, "")] = cell.t === "s" ? shared[Number(value)] : cell.t === "b" ? value === "1" : value === "" ? null : Number(value);
                if (current.name === "row") rows.push(row);
            },
        });
        const headers = rows[0].cells, records = rows.slice(1).map(row => Object.fromEntries(Object.entries(headers).map(([column, field]) => [field, row.cells[column]])));
        sheets.set(tag.attributes.name, { xml, records });
    } });
    return { files, shared, sheets };
}

test("Excel ZIP XML preserves 70 valid saved Unicode observation labels and their audit evidence", async () => {
    const expected = [];
    for (let index = 0; index < 70; index++) {
        const id = `REVIEW-ROOM-${String(index).padStart(3, "0")}`, name = `Review room ${String(index).padStart(3, "0")} ${"🔋".repeat(30)}`;
        await inventory.saveRoom({ id, name, buildingId: "J18", number: `U${index}`, isPlaceholder: true });
        await inventory.observation({ requestId: crypto.randomUUID(), batteryId: "BAT-002", roomId: id, observedAt: now });
        expected.push(`${name} — Placeholder`);
    }
    const document = await createExport(inventory, { dataset: "demo", mode: "detail", batteryId: "BAT-002", sections: ["observations", "audit", "directories"] });
    const savedLabels = document.tables.Observations.filter(row => String(row.room_key).includes("REVIEW-ROOM-")).map(row => row.room_name);
    assert.deepEqual(savedLabels, expected);
    for (const alignment of ["A", "AB"]) {
        const workbook = await rawWorkbook(await excelBuffer({ ...document, metadata: { ...document.metadata, fixture_alignment: alignment } }));
        assert.ok(workbook.files["xl/sharedStrings.xml"].length > 16384, "Fixture must cross the failing aggregate XML chunk boundary");
        assert.deepEqual(workbook.sheets.get("Observations").records.filter(row => String(row.room_key).includes("REVIEW-ROOM-")).map(row => row.room_name), expected);
        for (const row of document.tables.Operations) assert.ok(workbook.shared.includes(row.details_json), `Operation ${row.id} must retain its exact JSON`);
        assert.deepEqual([...workbook.sheets.keys()], ["Export information", ...Object.keys(document.tables)]);
        assert.ok(workbook.files["xl/styles.xml"].includes('rgb="FF234A69"'));
        for (const { xml } of workbook.sheets.values()) {
            assert.ok(xml.includes('ySplit="1"') && xml.includes('state="frozen"'));
            assert.ok(xml.includes("<autoFilter "));
        }
    }
});

test("long Unicode audit text reconstructs exactly from ordered Complete text cells in raw ZIP XML", async () => {
    const details = JSON.stringify({ payload: `prefix <&>\" ${"🙂".repeat(18000)} tail` });
    await db.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), inventory.scope, "test_long_unicode_operation", "BAT-001", accountId, "Unicode export staff", now, details).run();
    const document = await createExport(inventory, { dataset: "demo", mode: "detail", batteryId: "BAT-001", sections: ["audit"] });
    assert.equal(document.tables.Operations.find(row => row.action === "test_long_unicode_operation").details_json, details);
    // Shift XML text by one code unit so a coincidentally safe chunk alignment cannot hide surrogate loss.
    for (const alignment of ["A", "AB"]) {
        const workbook = await rawWorkbook(await excelBuffer({ ...document, metadata: { ...document.metadata, fixture_alignment: alignment } }));
        const operations = workbook.sheets.get("Operations").records, index = operations.findIndex(row => row.action === "test_long_unicode_operation");
        assert.equal(operations[index].details_json, "See Complete text worksheet; all parts are preserved.");
        const parts = workbook.sheets.get("Complete text").records.filter(row => row.worksheet === "Operations" && row.record_number === index + 1 && row.field === "details_json").sort((a, b) => a.part - b.part);
        assert.ok(parts.length > 1);
        assert.deepEqual(parts.map(row => row.part), parts.map((_, part) => part + 1));
        assert.equal(parts.map(row => row.value).join(""), details);
        assert.ok(parts.every(row => row.value.length <= 32000 && !/[\uD800-\uDBFF]$/.test(row.value) && !/^[\uDC00-\uDFFF]/.test(row.value)));
        assert.deepEqual([...workbook.sheets.keys()], ["Export information", "Batteries", "Operations", "Complete text"]);
    }
});

test("concurrent workbook exports preserve distinct Unicode text without modifying global process flags", async () => {
    const browserFlag = Object.getOwnPropertyDescriptor(process, "browser");
    await Promise.all(Array.from({ length: 4 }, async (_, index) => {
        const value = `Concurrent ${index} ${"🚀".repeat(9000)}`;
        const workbook = await rawWorkbook(await excelBuffer({ metadata: { operator: `Staff ${index} 🧪`, exported_at_utc: now }, tables: { Records: [{ value }] } }));
        assert.equal(workbook.sheets.get("Records").records[0].value, value);
        assert.ok(workbook.shared.includes(`Staff ${index} 🧪`));
    }));
    assert.deepEqual(Object.getOwnPropertyDescriptor(process, "browser"), browserFlag);
});
