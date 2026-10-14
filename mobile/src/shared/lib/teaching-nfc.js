import { z } from "zod";
const deviceTime = z.string().datetime({ offset: true });
const uidHex = z.string().regex(/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/);
const rawHex = z.string().max(32768).regex(/^(?:[0-9A-Fa-f]{2})*$/);
export const teachingNfcResultSchema = z.object({
    uidHex,
    technology: z.string().min(1).max(256),
    ndefStatus: z.enum(["readWrite", "readOnly", "notSupported", "unknown"]),
    capacityBytes: z.number().int().nonnegative().nullable(),
    records: z.array(z.object({ tnf: z.number().int().min(0).max(7), typeHex: rawHex, idHex: rawHex, payloadHex: rawHex }).strict()).max(100),
    ndefError: z.string().max(2000).optional(),
    observedAt: deviceTime,
}).strict();
/** Device-reported evidence, never a server attestation or a room observation. */
export const teachingNfcEvidenceSchema = z.object({
    attemptId: z.string().uuid(),
    source: z.literal("native-nfc-reader"),
    platform: z.enum(["ios", "android"]),
    startedAt: deviceTime,
    endedAt: deviceTime,
    adoptedAt: deviceTime,
    tagId: z.string().regex(/^nfc:uid:(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/),
    result: teachingNfcResultSchema,
}).strict().superRefine((value, ctx) => {
    if (value.tagId !== `nfc:uid:${value.result.uidHex}`)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tagId"], message: "The adopted tag must retain the complete UID in native byte order." });
});
export function validateTeachingNfcTag(evidence, tagId) {
    const value = teachingNfcEvidenceSchema.parse(evidence);
    if (tagId !== value.tagId)
        throw new Error("The registered tag does not match the adopted NFC evidence.");
    return value;
}
/** Only the mobile runtime installs a native bridge; browsers have no inferred reader. */
export function teachingNfcBridge() {
    if (typeof window === "undefined")
        return null;
    return window.__batteryTeachingNfc ?? null;
}
