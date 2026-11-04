import { z } from "zod";
import { datasetSchema, type Dataset } from "./domain";
import { canonicalModelJson, modelChoiceContentHash, newBatteryModelSchema, type NewBatteryModel } from "./battery-models";

export const batteryModelChoiceSchema = z.object({
  id: z.string().min(1).max(256), origin: z.enum(["saved", "inventory", "reference"]), label: z.string(),
  brand: z.string(), variant: z.string(), name: z.string(), model: z.string(), chemistry: z.string(),
  capacityMah: z.number().finite().positive().nullable(), voltage: z.number().finite().positive().nullable(),
  capacityBasis: z.string().nullable(), verificationStatus: z.string(), notes: z.string(),
  warnings: z.array(z.string()), sources: z.array(z.object({ id: z.string(), url: z.string().url(), title: z.string() }).strict()),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime({ offset: true }).optional(),
  actorName: z.string().optional(), version: z.number().int().positive().optional(),
}).strict();
export const modelCreateReceiptSchema = z.object({
  model: batteryModelChoiceSchema, requestId: z.string().uuid(), actorAccountId: z.string().uuid(),
  dataset: datasetSchema, replayed: z.boolean(),
}).strict();
const identity = { requestId: z.string().uuid(), actorAccountId: z.string().uuid(), dataset: datasetSchema };
export const modelCreateOutcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing"), ...identity }).strict(),
  z.object({ state: z.literal("confirmed"), receipt: modelCreateReceiptSchema }).strict(),
  z.object({ state: z.literal("rejected"), ...identity, at: z.string().datetime({ offset: true }), code: z.literal("model_rejected_final"), status: z.union([z.literal(400), z.literal(404), z.literal(409)]), error: z.string(), fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
]);
export type ModelCreateReceipt = z.infer<typeof modelCreateReceiptSchema>;
export type ModelCreateOutcome = z.infer<typeof modelCreateOutcomeSchema>;
export async function modelCreateFingerprint(payload: NewBatteryModel, actorAccountId: string, dataset: Dataset): Promise<string> {
  const source = canonicalModelJson({ kind: "model_create", actorAccountId, dataset, model: newBatteryModelSchema.parse(payload) });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export async function verifyModelCreateReceipt(value: unknown, payload: NewBatteryModel, actorAccountId: string, dataset: Dataset): Promise<ModelCreateReceipt> {
  const receipt = modelCreateReceiptSchema.parse(value), requested = newBatteryModelSchema.parse(payload);
  const { contentHash, ...choice } = receipt.model;
  if (receipt.requestId !== requested.id || receipt.actorAccountId !== actorAccountId || receipt.dataset !== dataset || receipt.model.origin !== "saved" || receipt.model.id !== requested.id || receipt.model.version !== 1 || !receipt.model.createdAt || !receipt.model.actorName || Object.entries(requested).some(([field, expected]) => receipt.model[field as keyof typeof receipt.model] !== expected) || contentHash !== await modelChoiceContentHash(choice))
    throw new Error("The model receipt differs from the original reviewed template. Resolve the preserved request.");
  return receipt;
}
export async function verifyModelCreateOutcome(value: unknown, payload: NewBatteryModel, actorAccountId: string, dataset: Dataset): Promise<ModelCreateOutcome> {
  const outcome = modelCreateOutcomeSchema.parse(value);
  if (outcome.state === "confirmed") return { state: "confirmed", receipt: await verifyModelCreateReceipt(outcome.receipt, payload, actorAccountId, dataset) };
  if (outcome.requestId !== payload.id || outcome.actorAccountId !== actorAccountId || outcome.dataset !== dataset || (outcome.state === "rejected" && outcome.fingerprint !== await modelCreateFingerprint(payload, actorAccountId, dataset)))
    throw new Error("The model outcome belongs to a different template, account or inventory. Resolve the preserved request.");
  return outcome;
}
