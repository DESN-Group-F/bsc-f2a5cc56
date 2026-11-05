import type { StaffUser } from "../../accounts";
import { canonicalModelJson } from "../../battery-models";
import { DomainError, validateBatteryDates, type Dataset } from "../../domain";
import {
  operatorEditFingerprint, operatorEditPayloadSchema, operatorEditSnapshotSchema,
  verifyOperatorEditOutcome, type OperatorEditPayload, type OperatorEditOutcome,
  type OperatorEditReceipt, type OperatorEditSnapshot,
} from "../../operator-edit";
import { registeredTagHash } from "../purge-evidence";
import { SUPPORTED_BUILDINGS_LABEL, SUPPORTED_BUILDINGS_SQL } from "../../location-catalog";
import { InventoryDatabase, type Row } from "./database";
import { requireActiveBattery } from "./records";

type Actor = Pick<StaffUser, "id" | "displayName" | "role" | "authVersion">;
const conflict = "This battery or its reviewed directory information changed. Nothing was saved. Load the latest record and review a new edit.";

/** Exact-request metadata writes; lookup never grants permission for a new edit. */
export class OperatorEditStore {
  private readonly database: InventoryDatabase;
  constructor(db: D1Database, scope: string, private readonly dataset: Dataset, private readonly actor: Actor, private readonly clock: () => Date = () => new Date()) {
    this.database = new InventoryDatabase(db, scope);
  }

  private identity(payload: OperatorEditPayload) {
    return { requestId: payload.requestId, dataset: this.dataset, actorAccountId: this.actor.id };
  }
  private async requireActor(admin = false) {
    const row = await this.database.first("SELECT display_name FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')", this.actor.id, this.actor.authVersion, this.actor.role);
    if (!row) throw new DomainError(403, "Your staff account access changed. Sign in again to resolve the saved request.");
    if (admin && this.actor.role !== "admin") throw new DomainError(403, "Only administrators can modify saved battery metadata.");
    return String(row.display_name);
  }
  private async original(payload: OperatorEditPayload, fingerprint: string): Promise<OperatorEditOutcome> {
    const old = await this.database.first("SELECT kind,fingerprint,result_json FROM operations WHERE id=? AND scope=?", this.database.key(payload.requestId), this.database.scope);
    if (!old) return { state: "missing", ...this.identity(payload) };
    if ((old.kind !== "metadata_edit" && old.kind !== "metadata_edit_rejected") || old.fingerprint !== fingerprint)
      throw new DomainError(409, "This request identifier was already used for a different operation.", "idempotency_conflict");
    const result = JSON.parse(String(old.result_json));
    if (Array.isArray(result.purgedBatteryIds) && result.purgedBatteryIds.includes(payload.batteryId))
      return { state: "purged", ...this.identity(payload), batteryId: payload.batteryId, fingerprint };
    const outcome = old.kind === "metadata_edit" ? { state: "confirmed", receipt: { ...result, replayed: true } } : result;
    return verifyOperatorEditOutcome(outcome, payload, this.actor.id, this.dataset);
  }

  async lookup(input: unknown): Promise<OperatorEditOutcome> {
    const payload = operatorEditPayloadSchema.parse(input);
    await this.requireActor();
    return this.original(payload, await operatorEditFingerprint(payload, this.actor.id, this.dataset));
  }

  private operation(payload: OperatorEditPayload, kind: string, fingerprint: string, result: unknown, at: string, guard = "1", values: unknown[] = []) {
    return this.database.statement(
      `INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role='admin') AND (${guard}) THEN 1 ELSE 0 END`,
      this.database.key(payload.requestId), this.database.scope, kind, fingerprint, JSON.stringify(result), at,
      this.actor.id, this.actor.authVersion, ...values,
    );
  }

  private async reject(payload: OperatorEditPayload, fingerprint: string, error: DomainError): Promise<OperatorEditOutcome> {
    const outcome: OperatorEditOutcome = { state: "rejected", ...this.identity(payload), batteryId: payload.batteryId, at: this.clock().toISOString(), code: "metadata_edit_rejected_final", error: error.message, fingerprint };
    try {
      await this.database.raw.batch([this.operation(payload, "metadata_edit_rejected", fingerprint, outcome, outcome.at)]);
      return outcome;
    } catch (failure) {
      const winner = await this.original(payload, fingerprint);
      if (winner.state !== "missing") return winner;
      await this.requireActor(true);
      throw failure;
    }
  }

  async edit(input: unknown): Promise<OperatorEditOutcome> {
    const payload = operatorEditPayloadSchema.parse(input);
    const actorName = await this.requireActor();
    const fingerprint = await operatorEditFingerprint(payload, this.actor.id, this.dataset);
    const original = await this.original(payload, fingerprint);
    if (original.state !== "missing") return original;
    await this.requireActor(true);
    try {
      return await this.commit(payload, fingerprint, actorName);
    } catch (error) {
      // Only a known rejection reserves a final outcome. Transport/database failures stay uncertain.
      if (error instanceof DomainError && [400, 404, 409].includes(error.status) && error.code !== "idempotency_conflict")
        return this.reject(payload, fingerprint, error);
      throw error;
    }
  }

  private snapshot(row: Row): OperatorEditSnapshot {
    return operatorEditSnapshotSchema.parse({
      name: row.name, model: row.model, chemistry: row.chemistry, capacityMah: row.capacity_mah,
      voltage: row.voltage, tagId: row.tag_id, ownerId: row.ownerId, homeBuildingId: row.homeBuildingId,
      homeRoomId: row.homeRoomId, manufacturedOn: row.manufactured_on, firstUsedOn: row.first_used_on,
      version: row.version, registeredAt: row.created_at,
    });
  }

  private async commit(payload: OperatorEditPayload, fingerprint: string, actorName: string): Promise<OperatorEditOutcome> {
    const db = this.database, fields = payload.fields, bindings = payload.directoryBindings, at = this.clock().toISOString();
    validateBatteryDates(fields, new Date(at));
    const [beforeRow, owner, building, room] = await Promise.all([
      db.first("SELECT b.*,p.id AS ownerId,h.id AS homeBuildingId,r.id AS homeRoomId FROM batteries b JOIN people p ON p.key=b.owner_key LEFT JOIN rooms r ON r.key=b.home_room_key LEFT JOIN buildings h ON h.key=COALESCE(b.home_building_key,r.building_key) WHERE b.scope=? AND b.id=?", db.scope, payload.batteryId),
      db.first("SELECT p.key,p.account_id,p.version,a.active AS accountActive FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.id=? AND p.role='staff'", db.scope, fields.ownerId),
      db.first("SELECT key,version FROM buildings WHERE scope=? AND id=?", db.scope, fields.homeBuildingId),
      fields.homeRoomId ? db.first("SELECT key,version,building_key,selectable FROM rooms WHERE scope=? AND id=?", db.scope, fields.homeRoomId) : null,
    ]);
    if (!beforeRow) throw new DomainError(404, "Battery not found.");
    requireActiveBattery(beforeRow);
    const before = this.snapshot(beforeRow);
    if (canonicalModelJson(before) !== canonicalModelJson(payload.before)) throw new DomainError(409, conflict);
    const retainedOwner = !!owner && beforeRow.owner_key === owner.key;
    if (!owner || (owner.accountActive !== 1 && !retainedOwner) || !building)
      throw new DomainError(400, `Select an active staff account as the responsible owner and ${SUPPORTED_BUILDINGS_LABEL} as the storage building. The current inactive owner may be retained.`);
    if (fields.homeRoomId && (!room || room.building_key !== building.key || room.selectable !== 1))
      throw new DomainError(400, "Select an available room in the chosen building, or leave it unspecified.");
    if (owner.version !== bindings.ownerVersion || owner.account_id !== bindings.ownerAccountId || building.version !== bindings.buildingVersion || (room?.version ?? null) !== bindings.roomVersion)
      throw new DomainError(409, conflict);
    const tagHash = fields.tagId === null ? null : await registeredTagHash(db.scope, fields.tagId);
    if (fields.tagId !== null && await db.first("SELECT key FROM batteries WHERE scope=? AND tag_id=? AND key<>?", db.scope, fields.tagId, beforeRow.key))
      throw new DomainError(409, "That RFID identifier is already assigned to another battery.");
    if (tagHash && await db.first("SELECT tag_hash FROM purged_tag_reservations WHERE scope=? AND tag_hash=?", db.scope, tagHash))
      throw new DomainError(409, "This registered tag remains reserved after permanent deletion. Use a different unassigned tag.");
    const after: OperatorEditSnapshot = { ...fields, version: before.version + 1, registeredAt: before.registeredAt };
    const receipt: OperatorEditReceipt = { kind: "metadata_edit", ...this.identity(payload), batteryId: payload.batteryId, at, replayed: false, before, after, directoryBindings: bindings };
    const guard = `EXISTS(SELECT 1 FROM batteries WHERE key=? AND scope=? AND version=? AND tag_id IS ? AND lifecycle_status='active')
      AND EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=? AND p.scope=? AND p.role='staff' AND p.version=? AND p.account_id=? AND (a.active=1 OR ?=1))
      AND EXISTS(SELECT 1 FROM buildings WHERE key=? AND scope=? AND id IN ${SUPPORTED_BUILDINGS_SQL} AND version=?)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM rooms WHERE key=? AND scope=? AND building_key=? AND selectable=1 AND version=?))
      AND NOT EXISTS(SELECT 1 FROM batteries WHERE scope=? AND tag_id=? AND key<>?)
      AND NOT EXISTS(SELECT 1 FROM purged_tag_reservations WHERE scope=? AND tag_hash=?)`;
    const values = [beforeRow.key, db.scope, before.version, before.tagId,
      owner.key, db.scope, bindings.ownerVersion, bindings.ownerAccountId, Number(retainedOwner),
      building.key, db.scope, bindings.buildingVersion,
      room?.key ?? null, room?.key ?? null, db.scope, building.key, bindings.roomVersion,
      db.scope, fields.tagId, beforeRow.key, db.scope, tagHash];
    try {
      await db.raw.batch([
        this.operation(payload, "metadata_edit", fingerprint, receipt, at, guard, values),
        db.statement("UPDATE batteries SET name=?,chemistry=?,model=?,capacity_mah=?,voltage=?,tag_id=?,owner_key=?,home_building_key=?,home_room_key=?,manufactured_on=?,first_used_on=?,version=version+1 WHERE key=? AND scope=? AND version=? AND tag_id IS ? AND lifecycle_status='active'",
          fields.name, fields.chemistry, fields.model, fields.capacityMah, fields.voltage, fields.tagId, owner.key, building.key, room?.key ?? null, fields.manufacturedOn, fields.firstUsedOn, beforeRow.key, db.scope, before.version, before.tagId),
        db.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)",
          crypto.randomUUID(), db.scope, "battery_updated", payload.batteryId, this.actor.id, actorName, at,
          JSON.stringify({ requestId: payload.requestId, source: "operator-entered-metadata-edit", before: beforeRow, after: { ...fields, id: payload.batteryId, version: after.version }, reviewedDirectoryBindings: bindings })),
      ]);
      return { state: "confirmed", receipt };
    } catch (error) {
      const winner = await this.original(payload, fingerprint);
      if (winner.state !== "missing") return winner;
      await this.requireActor(true);
      if (/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(String(error))) throw new DomainError(409, conflict);
      throw error;
    }
  }
}
