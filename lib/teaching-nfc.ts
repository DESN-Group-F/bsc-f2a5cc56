import { z } from "zod";
import { createWebNfcBridge } from "./web-nfc";

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
    if (value.tagId !== `nfc:uid:${value.result.uidHex}`) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tagId"], message: "The adopted tag must retain the complete UID in native byte order." });
});
export type TeachingNfcEvidence = z.infer<typeof teachingNfcEvidenceSchema>;
export type TeachingNfcResult = z.infer<typeof teachingNfcResultSchema>;
export type TeachingTagSource = { kind: "tag" } | { kind: "native_nfc"; evidence: TeachingNfcEvidence };
export type TeachingNfcProposal = Omit<TeachingNfcEvidence, "adoptedAt">;
export type TeachingNfcBridge = {
    getAvailability(): Promise<{ available: boolean; enabled: boolean; platform: "ios" | "android" | "web"; reason?: string }>;
    read(): Promise<TeachingNfcProposal>;
    cancel(): Promise<void>;
    adopt(proposal: TeachingNfcProposal): Promise<TeachingNfcEvidence>;
    /** Optional continuous listening (the browser reader): one scan for many reads; returns a stop function. */
    listen?(onProposal: (proposal: TeachingNfcProposal) => void, onFailure: (reason: unknown) => void): () => void;
};

export function validateTeachingNfcTag(evidence: unknown, tagId: string | null): TeachingNfcEvidence {
    const value = teachingNfcEvidenceSchema.parse(evidence);
    if (tagId !== value.tagId) throw new Error("The registered tag does not match the adopted NFC evidence.");
    return value;
}

let browserBridge: TeachingNfcBridge | null | undefined;

/**
 * A mobile runtime may install a native bridge. Otherwise the browser's own Web NFC reader is
 * used where it exists (Chrome on Android, top-level page); elsewhere there is no reader.
 * The browser bridge is created once so its identity stays stable across renders.
 */
export function teachingNfcBridge(): TeachingNfcBridge | null {
    if (typeof window === "undefined") return null;
    const native = (window as Window & { __batteryTeachingNfc?: TeachingNfcBridge }).__batteryTeachingNfc;
    if (native) return native;
    if (browserBridge === undefined) browserBridge = createWebNfcBridge();
    return browserBridge;
}
