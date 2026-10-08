import { z } from "zod";
import { datasetSchema, type Dataset } from "./domain";
import { currentSydneyDate } from "./battery-age";
import { intakeCommonSchema } from "./intake-session";

export const MOBILE_REGISTRATION_SOURCE = "operator-entered-registration" as const;
const tagId = z.string().regex(/^nfc:uid:(?:[A-F0-9]{8}|[A-F0-9]{14}|[A-F0-9]{20})$/, "Use a canonical NFC UID or leave the battery untagged.").nullable();

/** An explicit operator binding is not a verified native reader observation. */
export const mobileRegistrationPayloadSchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(),
  source: z.literal(MOBILE_REGISTRATION_SOURCE), tagId,
  common: intakeCommonSchema.omit({ teachingGroup: true }),
  firstUseMode: z.enum(["at_registration", "date", "unknown"]).default("at_registration"),
}).strict().superRefine((value, context) => {
  if (value.firstUseMode === "date" && !value.common.firstUsedOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["common", "firstUsedOn"], message: "Record the actual first-use date, or choose registration time / unknown." });
  if (value.firstUseMode !== "date" && value.common.firstUsedOn !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["common", "firstUsedOn"], message: "A custom first-use date requires the date option." });
});
export type MobileRegistrationPayload = z.infer<typeof mobileRegistrationPayloadSchema>;
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const mobileRegistrationReceiptSchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(), dataset: datasetSchema,
  actorAccountId: z.string().min(1), batteryId: z.string().max(64).regex(/^BAT-\d{8}$/), tagId,
  registeredAt: z.string().datetime({ offset: true }), source: z.literal(MOBILE_REGISTRATION_SOURCE), replayed: z.boolean(),
  name: z.string(), model: z.string(), chemistry: z.string(), capacityMah: z.number().finite().positive().nullable(), voltage: z.number().finite().positive().nullable(),
  ownerId: z.string(), homeBuildingId: z.string().nullable(), homeRoomId: z.string().nullable(), manufacturedOn: nullableDate, firstUsedOn: nullableDate,
}).strict();
export type MobileRegistrationReceipt = z.infer<typeof mobileRegistrationReceiptSchema>;
export type MobileRegistrationAttempt = { actorAccountId: string; dataset: Dataset; payload: MobileRegistrationPayload };

export function mobileRegistrationStorageKey(accountId: string, dataset: Dataset) { return `battery-mobile-registration:${accountId}:${dataset}`; }
export function captureMobileRegistrationAttempt(actorAccountId: string, dataset: Dataset, payload: MobileRegistrationPayload): MobileRegistrationAttempt {
  if (!actorAccountId || dataset !== "demo") throw new Error("This operator-entered registration test supports only an authenticated account and Demonstration inventory.");
  return { actorAccountId, dataset, payload: mobileRegistrationPayloadSchema.parse(structuredClone(payload)) };
}
export function recoverMobileRegistrationAttempt(raw: string | null, actorAccountId: string, dataset: Dataset): MobileRegistrationAttempt | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as MobileRegistrationAttempt;
    if (saved.actorAccountId !== actorAccountId || saved.dataset !== dataset) return null;
    return captureMobileRegistrationAttempt(actorAccountId, dataset, saved.payload);
  } catch { return null; }
}
export function verifyMobileRegistrationReceipt(value: unknown, attempt: MobileRegistrationAttempt): MobileRegistrationReceipt {
  const parsed = mobileRegistrationReceiptSchema.safeParse(value);
  if (!parsed.success) throw new Error("The registration receipt is incomplete. Retry the preserved registration request.");
  const receipt = parsed.data, requested = attempt.payload;
  if (receipt.dataset !== attempt.dataset || receipt.actorAccountId !== attempt.actorAccountId || receipt.requestId !== requested.requestId || receipt.sessionId !== requested.sessionId || receipt.tagId !== requested.tagId)
    throw new Error("The registration receipt belongs to a different request, account or inventory. Retry the preserved request.");
  for (const field of ["name", "model", "chemistry", "capacityMah", "voltage", "ownerId", "homeBuildingId", "homeRoomId", "manufacturedOn"] as const) {
    if (receipt[field] !== requested.common[field]) throw new Error("The registered battery differs from the reviewed details. Retry the preserved request.");
  }
  const expectedFirstUse = requested.firstUseMode === "at_registration" ? currentSydneyDate(new Date(receipt.registeredAt)) : requested.firstUseMode === "date" ? requested.common.firstUsedOn : null;
  if (receipt.firstUsedOn !== expectedFirstUse) throw new Error("The registration service-start date differs from the reviewed details. Retry the preserved request.");
  return receipt;
}
/** Only a durable final reservation proves that an earlier uncertain write cannot commit. */
export function mobileRegistrationFailureStatus(error: unknown, alreadyUncertain = false): "uncertain" | "rejected" {
  const value = error as { status?: number; code?: string };
  if (value?.code === "registration_rejected_final" && [400, 404, 409].includes(value.status ?? 0)) return "rejected";
  if (!alreadyUncertain && [400, 404, 422, 501].includes(value?.status ?? 0)) return "rejected";
  return "uncertain";
}
