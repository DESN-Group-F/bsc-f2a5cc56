import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
    REFERENCE_CATALOG_RELEASE, listReferenceModels, resolveReferenceModel,
    projectReferenceModel, referenceValueJson,
} from "../work/qa/battery-reference-catalog.mjs";

const raw = await readFile(new URL("../data/battery-catalog/catalog.json", import.meta.url), "utf8");
const catalog = JSON.parse(raw);
const hash = text => createHash("sha256").update(text).digest("hex");
const review = choice => ({ origin: "reference", id: choice.id, contentHash: choice.contentHash,
    confirmed: true, appliedFields: ["name", "model", "chemistry", "capacityMah", "voltage"] });

// Independently verify the research hash without losing Python's 68.0 token.
// Strings use decoded JSON values; number tokens retain the published spelling.
function canonicalSourceTokens(source) {
    let cursor = 0;
    const whitespace = () => { while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++; };
    const string = () => {
        const begin = cursor++;
        while (cursor < source.length) {
            if (source[cursor] === "\\") { cursor += 2; continue; }
            if (source[cursor++] === '"') return JSON.parse(source.slice(begin, cursor));
        }
        throw new Error("Unclosed JSON string.");
    };
    const value = () => {
        whitespace();
        if (source[cursor] === '"') return JSON.stringify(string());
        if (source[cursor] === "[") {
            cursor++; const entries = []; whitespace();
            while (source[cursor] !== "]") {
                entries.push(value()); whitespace();
                if (source[cursor] === ",") cursor++;
                else if (source[cursor] !== "]") throw new Error("Invalid JSON array.");
            }
            cursor++; return `[${entries.join(",")}]`;
        }
        if (source[cursor] === "{") {
            cursor++; const entries = []; whitespace();
            while (source[cursor] !== "}") {
                whitespace(); const key = string(); whitespace();
                if (source[cursor++] !== ":") throw new Error("Invalid JSON object.");
                entries.push([key, value()]); whitespace();
                if (source[cursor] === ",") cursor++;
                else if (source[cursor] !== "}") throw new Error("Invalid JSON object.");
            }
            cursor++; entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
            return `{${entries.map(([key, encoded]) => `${JSON.stringify(key)}:${encoded}`).join(",")}}`;
        }
        const token = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(cursor))?.[0];
        if (!token) throw new Error("Invalid JSON scalar.");
        cursor += token.length; return token;
    };
    const result = value(); whitespace();
    if (cursor !== source.length) throw new Error("Trailing JSON text.");
    return result;
}

test("reference pins verify the actual original research release and normalized runtime representation", async () => {
    const report = JSON.parse(await readFile(new URL("../data/battery-catalog/validation-report.json", import.meta.url), "utf8"));
    assert.equal(catalog.catalog_version, REFERENCE_CATALOG_RELEASE.catalogVersion);
    assert.equal(hash(canonicalSourceTokens(raw)), REFERENCE_CATALOG_RELEASE.catalogHash);
    assert.equal(report.content_sha256, REFERENCE_CATALOG_RELEASE.catalogHash);
    assert.equal(hash(referenceValueJson(catalog)), REFERENCE_CATALOG_RELEASE.jsonValueHash);
    assert.notEqual(REFERENCE_CATALOG_RELEASE.catalogHash, REFERENCE_CATALOG_RELEASE.jsonValueHash);
    assert.equal((await listReferenceModels()).length, 202);
});

test("every projected capacity is qualified rated or nominal and 112 missing scalars remain null", async () => {
    const choices = await listReferenceModels();
    const byId = new Map(choices.map(choice => [choice.id, choice]));
    let unknownCapacity = 0;
    for (const record of catalog.models) {
        const choice = byId.get(record.catalog_id);
        assert.equal(choice.capacityMah, record.rated_capacity_mah);
        assert.equal(choice.voltage, record.nominal_voltage_v);
        assert.equal(choice.capacityBasis, record.rated_capacity_mah === null ? null : record.capacity_basis);
        if (choice.capacityMah === null) unknownCapacity++;
        else assert.ok(["rated", "nominal", "test_rated"].includes(choice.capacityBasis));
        for (const field of ["tagId", "idForAsset", "ownerId", "homeBuildingId", "homeRoomId", "manufacturedOn", "firstUsedOn", "loanId", "observedAt"])
            assert.equal(Object.hasOwn(choice, field), false);
    }
    assert.equal(unknownCapacity, 112);
    const p50s = byId.get("molicel-inr-21700-p50s");
    assert.equal(p50s.capacityMah, null);
    assert.match(p50s.notes, /Typical capacity: 5000 mAh \(reference only\)/);
});

test("reference suggestions distinguish exact variants and retain conflicts, unknowns and source URLs", async () => {
    const choices = await listReferenceModels();
    const sourceIndex = new Map(catalog.sources.map(source => [source.source_id, source]));
    for (const record of catalog.models) {
        const choice = choices.find(candidate => candidate.id === record.catalog_id);
        assert.equal(choice.origin, "reference");
        assert.equal(choice.model, `${record.brand} ${record.model}`);
        assert.ok(choice.label.includes(record.variant_key));
        assert.equal(choice.variant, record.variant_description);
        assert.equal(choice.verificationStatus, record.verification_status);
        for (const warning of [...record.conflicts, ...record.unknowns]) assert.ok(choice.warnings.includes(warning));
        assert.deepEqual(choice.sources, record.source_ids.map(id => {
            const source = sourceIndex.get(id); return { id, url: source.url, title: source.title };
        }));
        assert.ok(choice.name.length <= 120 && choice.model.length <= 120 && choice.chemistry.length <= 40);
        assert.match(choice.contentHash, /^[a-f0-9]{64}$/);
    }
    const partial = choices.filter(choice => choice.verificationStatus === "partial");
    assert.equal(partial.length, 2);
    for (const choice of partial) assert.match(choice.warnings[0], /unresolved product or variant applicability/);
});

test("resolution reconstructs full selected source and evidence records from the server catalog", async () => {
    const choice = (await listReferenceModels()).find(candidate => candidate.id === "adafruit-1317-150mah-protected-jst-ph");
    const { provenance, choice: resolved } = await resolveReferenceModel(review(choice));
    const record = catalog.models.find(model => model.catalog_id === choice.id);
    assert.deepEqual(resolved, choice);
    assert.deepEqual(provenance.modelRecord, record);
    assert.deepEqual(provenance.sources, record.source_ids.map(id => catalog.sources.find(source => source.source_id === id)));
    assert.equal(provenance.modelHash, hash(referenceValueJson(record)));
    assert.equal(provenance.contentHash, choice.contentHash);
    assert.equal(provenance.catalogVersion, REFERENCE_CATALOG_RELEASE.catalogVersion);
    assert.equal(provenance.catalogHash, REFERENCE_CATALOG_RELEASE.catalogHash);
    assert.equal(provenance.prefill.capacityMah, 150);
    assert.equal(provenance.prefill.capacityBasis, "nominal");
    assert.equal(provenance.prefill.voltage, 3.7);
    const sourceIds = new Set(provenance.sources.map(source => source.source_id));
    for (const evidence of Object.values(provenance.modelRecord.field_evidence).flat()) assert.ok(sourceIds.has(evidence.source_id));
    assert.notEqual(hash(referenceValueJson({ ...record, nominal_voltage_v: 99 })), provenance.modelHash);
});

test("resolution rejects stale or forged selections, missing confirmation and client source injection", async () => {
    const choice = (await listReferenceModels())[0];
    await assert.rejects(resolveReferenceModel({ ...review(choice), contentHash: "0".repeat(64) }), { status: 409, code: "model_conflict" });
    await assert.rejects(resolveReferenceModel({ ...review(choice), id: "not-a-catalog-model" }), { status: 409, code: "model_conflict" });
    await assert.rejects(resolveReferenceModel({ ...review(choice), origin: "saved" }), { status: 400 });
    await assert.rejects(resolveReferenceModel({ ...review(choice), confirmed: false }));
    await assert.rejects(resolveReferenceModel({ ...review(choice), sources: [{ url: "https://example.invalid/forged" }] }));
    await assert.rejects(resolveReferenceModel({ ...review(choice), appliedFields: ["name", "name"] }));
});

test("callers cannot alter later suggestions or authoritative evidence through returned objects", async () => {
    const choice = (await listReferenceModels())[0];
    const original = structuredClone(choice);
    choice.name = "Changed outside catalog";
    choice.sources[0].url = "https://example.invalid/replaced";
    const first = await resolveReferenceModel(review(original));
    assert.deepEqual(first.choice, original);
    first.provenance.modelRecord.model = "Replaced model";
    first.provenance.sources[0].url = "https://example.invalid/replaced";
    const second = await resolveReferenceModel(review(original));
    assert.deepEqual(second.choice, original);
    assert.notEqual(second.provenance.modelRecord.model, "Replaced model");
    assert.notEqual(second.provenance.sources[0].url, "https://example.invalid/replaced");
});

test("projection never substitutes minimum, typical or stated capacity and rejects invalid identity or scalars", () => {
    const original = catalog.models[0];
    const sources = original.source_ids.map(id => catalog.sources.find(source => source.source_id === id));
    const unknown = projectReferenceModel({ ...original, capacity_basis: "minimum", rated_capacity_mah: 150,
        minimum_capacity_mah: 142, typical_capacity_mah: 160, stated_capacity_mah: 170 }, sources, "a".repeat(64));
    assert.equal(unknown.capacityMah, null);
    assert.equal(unknown.capacityBasis, null);
    assert.match(unknown.notes, /Minimum capacity: 142 mAh/);
    assert.match(unknown.notes, /Typical capacity: 160 mAh/);
    assert.match(unknown.notes, /Stated capacity: 170 mAh/);
    assert.throws(() => projectReferenceModel({ ...original, model: "x".repeat(121) }, sources, "a".repeat(64)), /without changing its identity/);
    assert.throws(() => projectReferenceModel({ ...original, suggested_display_name: "x".repeat(121) }, sources, "a".repeat(64)), /without changing its identity/);
    assert.throws(() => projectReferenceModel({ ...original, chemistry: "unmapped" }, sources, "a".repeat(64)), /without changing its identity/);
    assert.throws(() => projectReferenceModel({ ...original, nominal_voltage_v: Infinity }, sources, "a".repeat(64)), /invalid registration scalar/);
    assert.throws(() => projectReferenceModel({ ...original, rated_capacity_mah: 1000001 }, sources, "a".repeat(64)), /invalid registration scalar/);
    assert.throws(() => referenceValueJson({ value: NaN }), /finite/);
});
