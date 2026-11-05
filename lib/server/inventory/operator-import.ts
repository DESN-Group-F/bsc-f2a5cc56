import type { StaffUser } from "../../accounts";
import { DomainError, validateBatteryDates, type Dataset } from "../../domain";
import {
  operatorImportFingerprint, operatorImportPayloadSchema, verifyOperatorImportOutcome,
  type OperatorImportPayload, type OperatorImportOutcome, type OperatorImportReceipt,
} from "../../operator-import";
import { registeredTagHash } from "../purge-evidence";
import { InventoryDatabase } from "./database";

type Actor = Pick<StaffUser, "id" | "displayName" | "role" | "authVersion">;
const conflict = "An ID, RFID identifier or reviewed directory record changed or conflicts with this CSV batch. No rows were imported. Review a new batch.";

/** One reviewed CSV batch has one immutable receipt or rejection; lookup never imports. */
export class OperatorImportStore {
  private readonly database: InventoryDatabase;
  constructor(db: D1Database, scope: string, private readonly dataset: Dataset, private readonly actor: Actor, private readonly clock: () => Date = () => new Date()) {
    this.database = new InventoryDatabase(db, scope);
  }
  private identity(payload: OperatorImportPayload) {
    return { requestId: payload.requestId, dataset: this.dataset, actorAccountId: this.actor.id };
  }
  private async requireActor() {
    const row = await this.database.first("SELECT display_name FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')", this.actor.id, this.actor.authVersion, this.actor.role);
    if (!row) throw new DomainError(403, "Your staff account access changed. Sign in again to resolve the original CSV import request.");
    return String(row.display_name);
  }
  private async original(payload: OperatorImportPayload, fingerprint: string): Promise<OperatorImportOutcome> {
    const row = await this.database.first("SELECT kind,fingerprint,result_json FROM operations WHERE id=? AND scope=?", this.database.key(payload.requestId), this.database.scope);
    if (!row) return { state: "missing", ...this.identity(payload) };
    if (!["csv_import", "csv_import_rejected"].includes(String(row.kind)) || row.fingerprint !== fingerprint)
      throw new DomainError(409, "This request identifier was already used for a different operation, batch or staff account.", "idempotency_conflict");
    const result = JSON.parse(String(row.result_json));
    if (Array.isArray(result.purgedBatteryIds) && result.purgedBatteryIds.length)
      return verifyOperatorImportOutcome({ state: "purged", ...this.identity(payload), fingerprint, purgedBatteryIds: result.purgedBatteryIds }, payload, this.actor.id, this.dataset);
    return verifyOperatorImportOutcome(row.kind === "csv_import" ? { state: "confirmed", receipt: { ...result, replayed: true } } : result, payload, this.actor.id, this.dataset);
  }
  async lookup(input: unknown): Promise<OperatorImportOutcome> {
    const payload = operatorImportPayloadSchema.parse(input);
    await this.requireActor();
    return this.original(payload, await operatorImportFingerprint(payload, this.actor.id, this.dataset));
  }
  private operation(payload: OperatorImportPayload, kind: string, fingerprint: string, result: unknown, at: string, guard = "1", values: unknown[] = []) {
    return this.database.statement(
      `INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')) AND (${guard}) THEN 1 ELSE 0 END`,
      this.database.key(payload.requestId), this.database.scope, kind, fingerprint, JSON.stringify(result), at,
      this.actor.id, this.actor.authVersion, this.actor.role, ...values,
    );
  }
  private async reject(payload: OperatorImportPayload, fingerprint: string, error: DomainError): Promise<OperatorImportOutcome> {
    const outcome: OperatorImportOutcome = { state: "rejected", ...this.identity(payload), at: this.clock().toISOString(), code: "csv_import_rejected_final", status: error.status as 400 | 404 | 409, error: error.message, fingerprint };
    try {
      // A delayed successful batch and this rejection compete for the same original key.
      await this.database.raw.batch([this.operation(payload, "csv_import_rejected", fingerprint, outcome, outcome.at)]);
      return outcome;
    } catch (failure) {
      await this.requireActor();
      const winner = await this.original(payload, fingerprint);
      if (winner.state !== "missing") return winner;
      throw failure;
    }
  }
  async import(input: unknown): Promise<OperatorImportOutcome> {
    const payload = operatorImportPayloadSchema.parse(input), actorName = await this.requireActor();
    const fingerprint = await operatorImportFingerprint(payload, this.actor.id, this.dataset);
    const previous = await this.original(payload, fingerprint);
    if (previous.state !== "missing") return previous;
    try { return await this.commit(payload, fingerprint, actorName); }
    catch (error) {
      // Changed authentication or an unreserved database failure cannot establish a terminal outcome.
      if (error instanceof DomainError && [400, 404, 409].includes(error.status) && error.code !== "idempotency_conflict")
        return this.reject(payload, fingerprint, error);
      throw error;
    }
  }
  private async commit(payload: OperatorImportPayload, fingerprint: string, actorName: string): Promise<OperatorImportOutcome> {
    const db = this.database, at = this.clock().toISOString(), records = payload.records, bindings = payload.directoryBindings;
    const ids = records.map(record => record.id), tags = records.flatMap(record => record.tagId === null ? [] : [record.tagId]);
    const ownerIds = [...new Set(records.map(record => record.ownerId))], roomIds = [...new Set(records.flatMap(record => record.homeRoomId === null ? [] : [record.homeRoomId]))];
    if (new Set(ids).size !== ids.length || new Set(tags).size !== tags.length)
      throw new DomainError(400, "Each CSV row must use a distinct battery ID and each known RFID identifier must be unique. No rows were imported.");
    if (new Set(bindings.owners.map(owner => owner.ownerId)).size !== bindings.owners.length || new Set(bindings.rooms.map(room => room.roomId)).size !== bindings.rooms.length || bindings.owners.length !== ownerIds.length || bindings.rooms.length !== roomIds.length || bindings.owners.some(owner => !ownerIds.includes(owner.ownerId)) || bindings.rooms.some(room => !roomIds.includes(room.roomId)))
      throw new DomainError(400, "The CSV review must capture exactly the responsible owners and rooms used by this batch. No rows were imported.");
    const buildingIds = [...new Set(records.map(record => record.homeBuildingId))];
    if (buildingIds.length !== 1)
      throw new DomainError(400, "Each CSV batch must use one storage building. Split the rows by building and import each batch separately. No rows were imported.");
    const buildingId = buildingIds[0];
    for (const record of records) validateBatteryDates(record, new Date(at));
    const [owners, building, rooms, existing, deleted] = await Promise.all([
      db.rows("SELECT p.id,p.version,p.account_id,a.active FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.role='staff' AND p.id IN (SELECT value FROM json_each(?))", db.scope, JSON.stringify(ownerIds)),
      db.first("SELECT version FROM buildings WHERE scope=? AND id=?", db.scope, buildingId),
      db.rows("SELECT id,version,building_key,selectable FROM rooms WHERE scope=? AND id IN (SELECT value FROM json_each(?))", db.scope, JSON.stringify(roomIds)),
      db.first("SELECT id FROM batteries WHERE scope=? AND (id IN (SELECT value FROM json_each(?)) OR tag_id IN (SELECT value FROM json_each(?))) LIMIT 1", db.scope, JSON.stringify(ids), JSON.stringify(tags)),
      db.first("SELECT id FROM purged_batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?)) LIMIT 1", db.scope, JSON.stringify(ids)),
    ]);
    if (existing || deleted) throw new DomainError(409, conflict);
    if (!building || Number(building.version) !== bindings.buildingVersion || bindings.owners.some(binding => !owners.some(owner => owner.id === binding.ownerId && owner.account_id === binding.accountId && Number(owner.version) === binding.version && owner.active === 1)) || bindings.rooms.some(binding => !rooms.some(room => room.id === binding.roomId && Number(room.version) === binding.version && room.building_key === db.key(buildingId) && room.selectable === 1)))
      throw new DomainError(409, conflict);
    const tagHashes = await Promise.all(tags.map(tag => registeredTagHash(db.scope, tag)));
    if (await db.first("SELECT tag_hash FROM purged_tag_reservations WHERE scope=? AND tag_hash IN (SELECT value FROM json_each(?)) LIMIT 1", db.scope, JSON.stringify(tagHashes)))
      throw new DomainError(409, conflict);
    const receipt: OperatorImportReceipt = { kind: "csv_import", ...this.identity(payload), at, replayed: false, count: records.length, batteryIds: ids, records, directoryBindings: bindings };
    const guard = `NOT EXISTS(SELECT 1 FROM batteries WHERE scope=? AND (id IN (SELECT value FROM json_each(?)) OR tag_id IN (SELECT value FROM json_each(?))))
      AND NOT EXISTS(SELECT 1 FROM purged_batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?)))
      AND NOT EXISTS(SELECT 1 FROM purged_tag_reservations WHERE scope=? AND tag_hash IN (SELECT value FROM json_each(?)))
      AND EXISTS(SELECT 1 FROM buildings WHERE scope=? AND id=? AND version=?)
      AND (SELECT COUNT(*) FROM people p JOIN staff_accounts a ON a.id=p.account_id JOIN json_each(?) binding ON p.id=json_extract(binding.value,'$.ownerId') AND p.account_id=json_extract(binding.value,'$.accountId') AND p.version=json_extract(binding.value,'$.version') WHERE p.scope=? AND p.role='staff' AND a.active=1)=?
      AND (SELECT COUNT(*) FROM rooms r JOIN json_each(?) binding ON r.id=json_extract(binding.value,'$.roomId') AND r.version=json_extract(binding.value,'$.version') WHERE r.scope=? AND r.building_key=? AND r.selectable=1)=?`;
    const values = [db.scope, JSON.stringify(ids), JSON.stringify(tags), db.scope, JSON.stringify(ids), db.scope, JSON.stringify(tagHashes), db.scope, buildingId, bindings.buildingVersion, JSON.stringify(bindings.owners), db.scope, bindings.owners.length, JSON.stringify(bindings.rooms), db.scope, db.key(buildingId), bindings.rooms.length];
    const writes = records.flatMap(record => [
      db.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,manufactured_on,first_used_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", db.key(record.id), db.scope, record.id, record.name, record.chemistry, record.model, record.capacityMah, record.voltage, record.tagId, db.key(record.ownerId), db.key(record.homeBuildingId), record.homeRoomId === null ? null : db.key(record.homeRoomId), record.manufacturedOn, record.firstUsedOn, at),
      db.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)", crypto.randomUUID(), db.scope, "battery_registered", record.id, this.actor.id, actorName, at, JSON.stringify({ before: null, after: { ...record, version: 1 }, registrationSource: "csv", source: payload.source, importRequestId: payload.requestId, reviewedDirectoryBindings: bindings })),
    ]);
    writes.push(db.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,NULL,?,?,?,?)", crypto.randomUUID(), db.scope, "records_imported", this.actor.id, actorName, at, JSON.stringify({ kind: "batteries", count: records.length, requestId: payload.requestId, batteryIds: ids, source: payload.source })));
    try {
      await db.raw.batch([this.operation(payload, "csv_import", fingerprint, receipt, at, guard, values), ...writes]);
      return { state: "confirmed", receipt };
    } catch (error) {
      await this.requireActor();
      const winner = await this.original(payload, fingerprint);
      if (winner.state !== "missing") return winner;
      if (/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(String(error))) throw new DomainError(409, conflict);
      throw error;
    }
  }
}
