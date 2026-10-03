import { z } from "zod";

export const modelFieldNames = ["name", "model", "chemistry", "capacityMah", "voltage"] as const;
export type ModelField = typeof modelFieldNames[number];
export type BatteryModelChoice = {
    id: string;
    origin: "saved" | "inventory" | "reference";
    label: string;
    brand: string;
    variant: string;
    name: string;
    model: string;
    chemistry: string;
    capacityMah: number | null;
    voltage: number | null;
    capacityBasis: string | null;
    verificationStatus: string;
    notes: string;
    warnings: string[];
    sources: { id: string; url: string; title: string }[];
    contentHash: string;
    createdAt?: string;
    actorName?: string;
    version?: number;
};
export const modelSelectionSchema = z.object({
    origin: z.enum(["saved", "inventory", "reference"]),
    id: z.string().trim().min(1).max(256),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
    appliedFields: z.array(z.enum(modelFieldNames)).max(modelFieldNames.length)
        .refine(fields => new Set(fields).size === fields.length, "Apply each model field at most once."),
}).strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export const newBatteryModelSchema = z.object({
    id: z.string().uuid(),
    brand: z.string().trim().max(80).default(""),
    model: z.string().trim().min(1).max(120),
    variant: z.string().trim().max(120).default(""),
    name: z.string().trim().min(2).max(120),
    chemistry: z.string().trim().max(40).default(""),
    capacityMah: z.number().finite().positive().max(1000000).nullable().default(null),
    voltage: z.number().finite().positive().max(1000).nullable().default(null),
    notes: z.string().trim().max(1000).default(""),
}).strict();
export type NewBatteryModel = z.infer<typeof newBatteryModelSchema>;
export const updateBatteryModelSchema = newBatteryModelSchema.extend({
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().uuid(),
}).strict();
export type UpdateBatteryModel = z.infer<typeof updateBatteryModelSchema>;
export function canonicalModelJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalModelJson).join(",")}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
        .map(key => `${JSON.stringify(key)}:${canonicalModelJson(object[key])}`).join(",")}}`;
}
export async function modelChoiceContentHash(choice: Omit<BatteryModelChoice, "contentHash">): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalModelJson(choice)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function modelFieldValue(choice: BatteryModelChoice, field: ModelField): string {
    const value = choice[field];
    return value === null ? "" : String(value);
}
export function modelApplication(values: Record<string, string>, choice: BatteryModelChoice, selected: readonly ModelField[]) {
    const next = { ...values };
    for (const field of selected) next[field] = modelFieldValue(choice, field);
    return next;
}
