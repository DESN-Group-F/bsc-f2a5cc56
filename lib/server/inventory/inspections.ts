import { DomainError } from "../../domain";
import { canonicalModelJson } from "../../battery-models";
import { inspectionSchema, inspectionVoidSchema, type InspectionReceipt } from "../../battery-inspections";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { rejectPurgedReplay } from "../purge-evidence";

/** Append factual checks and retain corrections separately from original evidence. */
export class InventoryInspections {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
  ) {}

  private async requireActor(admin: boolean) {
    const actor = this.session.actor;
    if (actor.authVersion === undefined) throw new DomainError(401, "Sign in with an active staff account before recording inspections.");
    const account = await this.database.first(
      "SELECT display_name FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')",
      actor.id, actor.authVersion, actor.role,
    );
    if (!account || (admin && actor.role !== "admin"))
      throw new DomainError(403, admin ? "Only an active administrator can mark an inspection as entered in error." : "Your staff account access changed. Sign in again before recording inspections.");
    this.session.actor = { ...actor, name: String(account.display_name) };
  }

  private async replay(requestId: string, action: string, fingerprint: string) {
    const old = await this.database.first("SELECT * FROM operations WHERE id=? AND scope=?", this.database.key(requestId), this.database.scope);
    if (!old) return null;
    rejectPurgedReplay(old.result_json, "inspection_rejected_final");
    if (old.fingerprint !== fingerprint || ![action, `${action}_rejected`].includes(String(old.kind)))
      throw new DomainError(409, "This request identifier was already used for a different operation.", "idempotency_conflict");
    const result = JSON.parse(String(old.result_json));
    if (old.kind === `${action}_rejected`)
      throw new DomainError(Number(result.status), String(result.error), "inspection_rejected_final");
    return { ...result, replayed: true } as InspectionReceipt;
  }

  private async execute(
    payload: { requestId: string },
    action: "inspection" | "inspection_void",
    work: (fingerprint: string) => Promise<unknown>,
  ) {
    await this.requireActor(action === "inspection_void");
    const fingerprint = canonicalModelJson({ actorAccountId: this.session.actor.id, dataset: this.session.dataset, payload });
    const old = await this.replay(payload.requestId, action, fingerprint);
    if (old) return old;
    try {
      return await work(fingerprint);
    } catch (error) {
      const committed = await this.replay(payload.requestId, action, fingerprint);
      if (committed) return committed;
      if (!(error instanceof DomainError) || ![400, 404, 409, 422].includes(error.status) || error.code === "idempotency_conflict") throw error;
      await this.requireActor(action === "inspection_void");
      try {
        await this.database.statement(
          "INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?) THEN 1 ELSE 0 END",
          this.database.key(payload.requestId), this.database.scope, `${action}_rejected`, fingerprint,
          JSON.stringify({ rejected: true, status: error.status, error: error.message }), this.session.clock().toISOString(),
          this.session.actor.id, this.session.actor.authVersion, this.session.actor.role,
        ).run();
      } catch (reservationError) {
        const committed = await this.replay(payload.requestId, action, fingerprint);
        if (committed) return committed;
        throw reservationError;
      }
      throw new DomainError(error.status, error.message, "inspection_rejected_final");
    }
  }

  async record(input: unknown) {
    const value = inspectionSchema.parse(input);
    return this.execute(value, "inspection", async (fingerprint) => {
      const now = this.session.clock(), at = now.toISOString();
      if (Date.parse(value.performedAt) > now.getTime())
        throw new DomainError(400, "The inspection time cannot be in the future.");
      const battery = await this.database.first("SELECT * FROM batteries WHERE scope=? AND id=?", this.database.scope, value.batteryId);
      if (!battery) throw new DomainError(404, "Battery not found in this inventory.");
      if (battery.lifecycle_status !== "active" || battery.version !== value.expectedBatteryVersion)
        throw new DomainError(409, "The reviewed battery changed or is retired. Reload its details before recording this inspection.");
      const inspectionId = crypto.randomUUID(), performedAt = new Date(value.performedAt).toISOString();
      const result: InspectionReceipt = { requestId: value.requestId, dataset: this.session.dataset, actorAccountId: this.session.actor.id, batteryId: value.batteryId, inspectionId, action: "inspection", at, replayed: false };
      return this.transactions.atomic(value.requestId, "inspection", fingerprint, result, at,
        "EXISTS(SELECT 1 FROM batteries WHERE key=? AND scope=? AND version=? AND lifecycle_status='active')",
        [battery.key, this.database.scope, value.expectedBatteryVersion], [
          this.database.statement(
            "INSERT INTO battery_inspections(id,scope,battery_key,expected_battery_version,operation_id,kind,outcome,performed_at,recorded_at,inspector_account_id,inspector_auth_version,inspector_name,method,notes,reference,capacity_mah) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            inspectionId, this.database.scope, battery.key, value.expectedBatteryVersion, this.database.key(value.requestId), value.kind, value.outcome, performedAt, at,
            this.session.actor.id, this.session.actor.authVersion, this.session.actor.name, value.method, value.notes, value.reference, value.capacityMah,
          ),
          this.transactions.event("inspection_recorded", value.batteryId, {
            requestId: value.requestId, inspectionId, expectedBatteryVersion: value.expectedBatteryVersion,
            kind: value.kind, outcome: value.outcome, performedAt, method: value.method, notes: value.notes, reference: value.reference, capacityMah: value.capacityMah,
            inspectorAccountId: this.session.actor.id, inspectorName: this.session.actor.name,
            source: "Staff inspection record",
          }, at),
        ], "The battery or staff account changed. The inspection was not saved.", "inspection_conflict");
    });
  }

  async void(input: unknown) {
    const value = inspectionVoidSchema.parse(input);
    return this.execute(value, "inspection_void", async (fingerprint) => {
      const inspection = await this.database.first(
        "SELECT i.*,v.id AS void_id FROM battery_inspections i JOIN batteries b ON b.key=i.battery_key AND b.scope=i.scope LEFT JOIN battery_inspection_voids v ON v.inspection_id=i.id WHERE i.scope=? AND i.id=? AND b.id=?",
        this.database.scope, value.inspectionId, value.batteryId,
      );
      if (!inspection || inspection.void_id) throw new DomainError(409, "This inspection is unavailable or was already marked as entered in error. Reload the inspection history.");
      const at = this.session.clock().toISOString();
      if (Date.parse(String(inspection.recorded_at)) > Date.parse(at)) throw new DomainError(409, "The recorded inspection time is later than the current server time. This correction was not saved.");
      const result: InspectionReceipt = { requestId: value.requestId, dataset: this.session.dataset, actorAccountId: this.session.actor.id, batteryId: value.batteryId, inspectionId: value.inspectionId, action: "inspection_void", at, replayed: false };
      return this.transactions.atomic(value.requestId, "inspection_void", fingerprint, result, at,
        "EXISTS(SELECT 1 FROM battery_inspections WHERE id=? AND scope=? AND battery_key=?) AND NOT EXISTS(SELECT 1 FROM battery_inspection_voids WHERE inspection_id=?)",
        [value.inspectionId, this.database.scope, inspection.battery_key, value.inspectionId], [
          this.database.statement(
            "INSERT INTO battery_inspection_voids(id,scope,inspection_id,operation_id,voided_at,actor_account_id,actor_auth_version,actor_name,reason) VALUES(?,?,?,?,?,?,?,?,?)",
            crypto.randomUUID(), this.database.scope, value.inspectionId, this.database.key(value.requestId), at, this.session.actor.id, this.session.actor.authVersion, this.session.actor.name, value.reason,
          ),
          this.transactions.event("inspection_voided", value.batteryId, { requestId: value.requestId, inspectionId: value.inspectionId, reason: value.reason, original: { kind: inspection.kind, outcome: inspection.outcome, performedAt: inspection.performed_at, recordedAt: inspection.recorded_at, inspectorAccountId: inspection.inspector_account_id, inspectorName: inspection.inspector_name } }, at),
        ], "The inspection or administrator account changed. The correction was not saved.", "inspection_conflict");
    });
  }
}
