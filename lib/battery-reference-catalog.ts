import catalogJson from "../data/battery-catalog/catalog.json" with { type: "json" };
import { digest } from "./credentials";
import { DomainError } from "./domain";
import { modelSelectionSchema, type BatteryModelChoice, type ModelSelection } from "./battery-models";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ReferenceSource = {
    source_id: string;
    url: string;
    title: string;
    [key: string]: JsonValue;
};
export type ReferenceModel = {
    catalog_id: string;
    brand: string;
    model: string;
    variant_key: string;
    variant_description: string;
    suggested_display_name: string;
    aliases: { value: string; kind: string; match_policy: string }[];
    chemistry: string;
    rated_capacity_mah: number | null;
    capacity_basis: string;
    typical_capacity_mah: number | null;
    minimum_capacity_mah: number | null;
    stated_capacity_mah: number | null;
    stated_capacity_label: string | null;
    nominal_voltage_v: number | null;
    connector: { description: string; polarity: string | null } | null;
    source_ids: string[];
    verification_status: string;
    conflicts: string[];
    unknowns: string[];
    notes: string[];
    [key: string]: JsonValue;
};
type ReferenceCatalog = {
    schema_version: string;
    catalog_version: string;
    sources: ReferenceSource[];
    models: ReferenceModel[];
    [key: string]: JsonValue;
};

// These two digests describe the same published release. The research tooling
// preserves JSON float spellings such as 68.0; JavaScript parses them as 68.
// Pin both representations instead of labelling a JavaScript digest as the
// original research digest. A catalog change requires reviewing both pins.
export const REFERENCE_CATALOG_RELEASE = {
    catalogVersion: "2026.10.03.4",
    catalogHash: "41be134a1df54e65d4e2d6f7bd9d2bcf4f3f2b586c4621a100402f817a789c87",
    jsonValueHash: "571b49677a42206f8a228a7e8f6c0eefdbce6a3399595d2a4b0ebf16624ff281",
} as const;

const chemistryLabels: Readonly<Record<string, string>> = {
    alkaline_zinc_manganese_dioxide: "Alkaline",
    lithium_iron_disulfide: "Li-FeS2",
    nickel_metal_hydride: "NiMH",
    lithium_ion: "Li-ion",
    lithium_ion_polymer: "LiPo",
    lithium_iron_phosphate: "LiFePO4",
    lead_acid: "Lead-acid",
};
const prefillCapacityBases = new Set(["rated", "nominal", "test_rated"]);

/** Stable JSON-value hashing; float token formatting is deliberately excluded. */
export function referenceValueJson(value: JsonValue): string {
    if (value === null || typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Reference values must be finite.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(referenceValueJson).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${referenceValueJson(value[key])}`).join(",")}}`;
}

/** Pure projection of product references; no physical-asset fields are copied. */
export function projectReferenceModel(record: ReferenceModel, sources: readonly ReferenceSource[], contentHash: string): BatteryModelChoice {
    const name = record.suggested_display_name || `${record.brand} ${record.model}`;
    const model = `${record.brand} ${record.model}`;
    const chemistry = chemistryLabels[record.chemistry];
    if (name.length < 2 || name.length > 120 || model.length > 120 || !chemistry || chemistry.length > 40) {
        throw new Error(`The reference model ${record.catalog_id} cannot fit the asset registration fields without changing its identity.`);
    }
    const capacityMah = prefillCapacityBases.has(record.capacity_basis) ? record.rated_capacity_mah : null;
    if ((capacityMah !== null && (!Number.isFinite(capacityMah) || capacityMah <= 0 || capacityMah > 1000000))
        || (record.nominal_voltage_v !== null && (!Number.isFinite(record.nominal_voltage_v) || record.nominal_voltage_v <= 0 || record.nominal_voltage_v > 1000))) {
        throw new Error(`The reference model ${record.catalog_id} has an invalid registration scalar.`);
    }
    const capacityNotes = [
        capacityMah !== null ? `${record.capacity_basis === "nominal" ? "Nominal" : "Rated/test-rate"} capacity: ${capacityMah} mAh.` : "No rated or nominal capacity is suggested.",
        record.minimum_capacity_mah !== null ? `Minimum capacity: ${record.minimum_capacity_mah} mAh (reference only).` : "",
        record.typical_capacity_mah !== null ? `Typical capacity: ${record.typical_capacity_mah} mAh (reference only).` : "",
        record.stated_capacity_mah !== null ? `${record.stated_capacity_label || "Stated capacity"}: ${record.stated_capacity_mah} mAh (reference only).` : "",
    ].filter(Boolean);
    return {
        origin: "reference",
        id: record.catalog_id,
        label: `${record.brand} ${record.model} · ${record.variant_key}`,
        brand: record.brand,
        variant: record.variant_description,
        name,
        model,
        chemistry,
        capacityMah,
        voltage: record.nominal_voltage_v,
        capacityBasis: capacityMah === null ? null : record.capacity_basis,
        verificationStatus: record.verification_status,
        notes: [record.connector?.description ? `Connector: ${record.connector.description}` : "", ...capacityNotes,
            record.aliases.length ? `Search aliases: ${record.aliases.map(alias => alias.value).join(", ")}.` : "", ...record.notes].filter(Boolean).join("\n"),
        warnings: [...(record.verification_status === "partial" ? ["This reference has unresolved product or variant applicability. Confirm the exact physical label and review the conflicts before using any suggestion."] : []), ...record.conflicts, ...record.unknowns],
        sources: sources.map(source => ({ id: source.source_id, url: source.url, title: source.title })),
        contentHash,
    };
}

export type ReferenceModelProvenance = {
    snapshotSchemaVersion: "1.0.0";
    origin: "reference";
    catalogId: string;
    catalogVersion: string;
    catalogHash: string;
    catalogJsonValueHash: string;
    valueHashScheme: "sha256-sorted-json-values-v1";
    modelHash: string;
    contentHash: string;
    modelRecord: ReferenceModel;
    sources: ReferenceSource[];
    prefill: Pick<BatteryModelChoice, "name" | "model" | "chemistry" | "capacityMah" | "voltage" | "capacityBasis">;
};
type IndexedReference = { choice: BatteryModelChoice; provenance: ReferenceModelProvenance };
let loadedReferences: Promise<ReadonlyMap<string, IndexedReference>> | undefined;

async function references(): Promise<ReadonlyMap<string, IndexedReference>> {
    loadedReferences ??= (async () => {
        const catalog = catalogJson as unknown as ReferenceCatalog;
        const catalogJsonValueHash = await digest(referenceValueJson(catalog));
        if (catalog.catalog_version !== REFERENCE_CATALOG_RELEASE.catalogVersion || catalogJsonValueHash !== REFERENCE_CATALOG_RELEASE.jsonValueHash) {
            throw new DomainError(503, "The battery reference catalog failed its release integrity check.", "model_catalog_unavailable");
        }
        const sourceIndex = new Map(catalog.sources.map(source => [source.source_id, source]));
        if (sourceIndex.size !== catalog.sources.length) throw new Error("Reference source identifiers must be unique.");
        const entries = await Promise.all(catalog.models.map(async modelRecord => {
            const sources = modelRecord.source_ids.map(id => {
                const source = sourceIndex.get(id);
                if (!source) throw new Error(`The reference model ${modelRecord.catalog_id} has a missing source ${id}.`);
                return source;
            });
            const modelHash = await digest(referenceValueJson(modelRecord));
            const contentHash = await digest(referenceValueJson({ catalogVersion: catalog.catalog_version,
                catalogHash: REFERENCE_CATALOG_RELEASE.catalogHash, modelRecord, sources }));
            const choice = projectReferenceModel(modelRecord, sources, contentHash);
            const provenance: ReferenceModelProvenance = {
                snapshotSchemaVersion: "1.0.0", origin: "reference", catalogId: modelRecord.catalog_id,
                catalogVersion: catalog.catalog_version, catalogHash: REFERENCE_CATALOG_RELEASE.catalogHash,
                catalogJsonValueHash, valueHashScheme: "sha256-sorted-json-values-v1", modelHash, contentHash, modelRecord, sources,
                prefill: { name: choice.name, model: choice.model, chemistry: choice.chemistry,
                    capacityMah: choice.capacityMah, voltage: choice.voltage, capacityBasis: choice.capacityBasis },
            };
            return [modelRecord.catalog_id, { choice, provenance }] as const;
        }));
        const result = new Map(entries);
        if (result.size !== entries.length) throw new Error("Reference model identifiers must be unique.");
        return result;
    })();
    return loadedReferences;
}

/** Called only by authenticated server routes; the full catalog stays server-side. */
export async function listReferenceModels(): Promise<BatteryModelChoice[]> {
    const index = await references();
    return [...index.values()].map(entry => structuredClone(entry.choice));
}

/** Reconstruct authoritative evidence; a browser cannot supply or replace it. */
export async function resolveReferenceModel(selection: ModelSelection): Promise<{ choice: BatteryModelChoice; provenance: ReferenceModelProvenance }> {
    const reviewed = modelSelectionSchema.parse(selection);
    if (reviewed.origin !== "reference") throw new DomainError(400, "Choose a reference catalog model.");
    const entry = (await references()).get(reviewed.id);
    if (!entry || entry.choice.contentHash !== reviewed.contentHash) {
        throw new DomainError(409, "The selected model reference changed or is unavailable. Review the model again before registration.", "model_conflict");
    }
    return structuredClone(entry);
}
