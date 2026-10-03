import { z } from "zod";
import { isActiveBattery } from "./battery-lifecycle";
import type { InventorySnapshot } from "./domain";
import type { MovementDraft } from "@/lib/client/inventory-contracts";
type Tool = {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: {
        readOnlyHint: boolean;
        untrustedContentHint: boolean;
    };
    execute: (input: unknown) => unknown;
};
type ModelContext = {
    registerTool: (tool: Tool, options: {
        signal: AbortSignal;
    }) => void | Promise<void>;
};
export function registerInventoryTools(read: () => InventorySnapshot | null, stage: (draft: MovementDraft) => void) {
    const ctx = (document as Document & {
        modelContext?: ModelContext;
    }).modelContext;
    if (!ctx?.registerTool)
        return () => { };
    const abort = new AbortController(), register = (tool: Tool) => { try {
        void Promise.resolve(ctx.registerTool(tool, { signal: abort.signal })).catch(() => { });
    }
    catch { /* Browser tools are optional; regular UI remains available. */ } };
    register({ name: "read_battery_inventory", title: "Read displayed battery inventory", description: "Read the inventory currently displayed, including recorded loans and last observations. No records are changed.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["all", "in", "out"] } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input) { const { status = "all" } = z.object({ status: z.enum(["all", "in", "out"]).optional() }).strict().parse(input); const s = read(); if (!s)
            throw new Error("Wait for the inventory to load."); return { dataset: s.dataset, hardwareConnected: false, batteries: s.batteries.filter(b => isActiveBattery(b) && (status === "all" || (status === "out" ? !!b.loanId : !b.loanId))).map(b => ({ id: b.id, name: b.name, status: b.loanId ? "out" : "in", owner: b.ownerName, currentHolder: b.borrowerName, holderKind: b.borrowerKind, holderAccountId: b.borrowerAccountId, storageBuildingCode: b.homeBuildingId, storageBuildingName: b.homeBuildingName, storageRoomNumber: b.homeRoomNumber, storageRoomName: b.homeRoomName, lastObservedRoom: b.observedRoom, lastObservedBuilding: b.observedBuilding, observedAt: b.observedAt, source: b.observationSource, lastChargeCompletedAt: b.chargedAt, lastChargeDurationMinutes: b.chargeDurationMinutes })) }; } });
    register({ name: "stage_battery_movement", title: "Prepare a battery checkout or return", description: "Open a review list for registered batteries. This stages a draft only; the signed-in staff member must confirm it in the visible interface. Checkout responsibility belongs to that account; another holder cannot be supplied.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["checkout", "return"] }, batteryIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 } }, required: ["kind", "batteryIds"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute(input) { const v = z.object({ kind: z.enum(["checkout", "return"]), batteryIds: z.array(z.string()).min(1).max(100) }).strict().parse(input), s = read(); if (!s)
            throw new Error("Wait for the inventory to load."); const ids = [...new Set(v.batteryIds)]; for (const id of ids) {
            const b = s.batteries.find(b => b.id === id);
            if (!b)
                throw new Error(`${id} is not registered.`);
            if (!isActiveBattery(b)) throw new Error(`${id} has been retired or permanently removed.`);
            if (v.kind === "checkout" && b.loanId)
                throw new Error(`${id} is already in use.`);
            if (v.kind === "return" && !b.loanId)
                throw new Error(`${id} has no active loan.`);
        } stage({ kind: v.kind, ids, nonce: crypto.randomUUID() }); return { state: "awaiting_staff_confirmation", persisted: false, batteryIds: ids, kind: v.kind }; } });
    return () => abort.abort();
}
