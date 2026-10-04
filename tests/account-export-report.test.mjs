import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import ExcelJS from "exceljs";
import { parseCsv } from "../work/qa/client-utils.mjs";

const directory = "work/qa/account-report-route";
await mkdir(directory, { recursive: true });
const compiled = ts.transpileModule(await readFile("app/api/accounts/route.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from "@\/(?:db|lib\/api)"/g, 'from "./context.mjs"')
    .replace(/from "@\/lib\/(accounts|domain|downloads)"/g, (_, name) => `from "../${name}.mjs"`);
await writeFile(`${directory}/route.mjs`, compiled);
await writeFile(`${directory}/context.mjs`, `
import { z } from "zod";
const state = () => globalThis[Symbol.for("account-export-report-tests")];
export const requestUser = async () => state().actor;
export const requestJson = request => request.json();
export const apiJson = (value, status = 200) => Response.json(value, {status});
export const apiError = error => apiJson({error:error.message}, error.status ?? (error instanceof z.ZodError ? 400 : 500));
export const getD1Database = () => ({prepare(sql) {return {bind() {return this;}, async all() {state().queries.push(sql); return {results:sql.includes("FROM staff_accounts") ? state().rows : []};}};}});
`);
const { GET } = await import(`../${directory}/route.mjs`);
function fixture(role = "admin") {
    const state = { actor: { id: "admin-account", displayName: "Account report reviewer", username: "reviewer", role }, queries: [], rows: [
        { id: "internal-admin", username: "admin", display_name: "Teaching administrator", email: "", role: "admin", active: 1, default_dataset: "live", version: 3, auth_version: 11, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-04T00:00:00Z", password_hash: "private-hash-sentinel", password_salt: "private-salt-sentinel" },
        { id: "internal-staff", username: "helper", display_name: "Teaching assistant", email: "helper@example.test", role: "staff", active: 0, default_dataset: "demo", version: 2, auth_version: 9, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" },
    ] };
    globalThis[Symbol.for("account-export-report-tests")] = state;
    return state;
}
const request = query => new Request(`https://inventory.test/api/accounts?${new URLSearchParams(query)}`);
function rows(workbook, name) {
    const sheet = workbook.getWorksheet(name), fields = sheet.getRow(4).values.slice(1);
    return Array.from({ length: Math.max(0, sheet.rowCount - 4) }, (_, index) => Object.fromEntries(fields.map((field, column) => [field, sheet.getRow(index + 5).getCell(column + 1).value])));
}

test("administrator account Excel export respects search and omits authentication data from every worksheet", async () => {
    fixture();
    const response = await GET(request({ download: "xlsx", search: "administrator" }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /spreadsheetml/);
    assert.match(response.headers.get("content-disposition"), /staff-accounts-report.xlsx/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await response.arrayBuffer());
    const accounts = rows(workbook, "Staff accounts");
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].Name, "Teaching administrator");
    assert.equal(accounts[0].Username, "admin");
    assert.equal(accounts[0].Role, "Administrator");
    assert.equal(accounts[0]["Account status"], "Active");
    assert.equal(accounts[0].Email, "Not recorded");
    assert.equal(accounts[0]["Default inventory"], "Working inventory");
    assert.equal(accounts[0]["Last updated (Sydney)"].toISOString(), "2026-10-04T11:00:00.000Z");
    assert.ok(!("id" in accounts[0]));
    const evidence = rows(workbook, "Evidence Accounts")[0];
    assert.equal(evidence.id, "internal-admin");
    assert.equal(evidence.version, 3);
    const contents = JSON.stringify(workbook.worksheets.map(sheet => sheet.getSheetValues()));
    assert.ok(!/authVersion|auth_version|password_hash|password_salt|private-hash-sentinel|private-salt-sentinel/.test(contents));
    const guide = rows(workbook, "Report guide");
    assert.equal(guide.find(row => row.Topic === "Inventory").Explanation, "Global staff accounts (both inventories)");
    assert.equal(guide.find(row => row.Topic === "Filters").Explanation, "Search: administrator");
    assert.ok(!guide.some(row => row.Topic === "Personal scope"));
});

test("account CSV endpoint remains available and uses the same search and human role/status labels", async () => {
    fixture();
    const response = await GET(request({ download: "csv", search: "disabled" }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /staff-accounts.csv/);
    const accounts = parseCsv(await response.text());
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].Username, "helper");
    assert.equal(accounts[0].Role, "Staff");
    assert.equal(accounts[0]["Account status"], "Disabled");
    assert.equal(accounts[0]["Default inventory"], "Demonstration inventory");
    assert.equal(accounts[0]["Report inventory"], "Global staff accounts (both inventories)");
});

test("staff cannot bypass account administration permission with download or self scope", async () => {
    for (const download of ["csv", "xlsx"]) {
        const state = fixture("staff"), response = await GET(request({ download, scope: "self" }));
        assert.equal(response.status, 403);
        assert.equal(response.headers.get("content-disposition"), null);
        assert.deepEqual(state.queries, []);
    }
    fixture();
    assert.equal((await GET(request({ download: "pdf" }))).status, 400);
});
