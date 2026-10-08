import { z } from "zod";
export const modelFieldNames = ["name", "model", "chemistry", "capacityMah", "voltage"];
export const modelSelectionSchema = z.object({
    origin: z.enum(["saved", "inventory", "reference"]),
    id: z.string().trim().min(1).max(256),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
    appliedFields: z.array(z.enum(modelFieldNames)).max(modelFieldNames.length)
        .refine(fields => new Set(fields).size === fields.length, "Apply each model field at most once."),
}).strict();
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
export const updateBatteryModelSchema = newBatteryModelSchema.extend({
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().uuid(),
}).strict();
export function canonicalModelJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalModelJson).join(",")}]`;
    const object = value;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
        .map(key => `${JSON.stringify(key)}:${canonicalModelJson(object[key])}`).join(",")}}`;
}
export async function modelChoiceContentHash(choice) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalModelJson(choice)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function modelFieldValue(choice, field) {
    const value = choice[field];
    return value === null ? "" : String(value);
}
export function modelApplication(values, choice, selected) {
    const next = { ...values };
    for (const field of selected)
        next[field] = modelFieldValue(choice, field);
    return next;
}
