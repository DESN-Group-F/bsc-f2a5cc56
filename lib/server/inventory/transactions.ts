import { DomainError } from "../../domain";
import { InventoryDatabase, type Row } from "./database";
import { InventorySession } from "./actor";
import { type ResolvedGroup } from "./groups";

/** Keep receipts, guards, domain writes and audit evidence in one D1 batch. */
export class InventoryTransactions {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
  ) {}

  event(
    action: string,
    batteryId: string | null,
    details: unknown,
    at: string,
  ) {
    return this.database.statement(
      "INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)",
      crypto.randomUUID(),
      this.database.scope,
      action,
      batteryId,
      this.session.actor.id,
      this.session.actor.name,
      at,
      JSON.stringify(details),
    );
  }

  async replay(requestId: string, kind: string, fingerprint: string) {
    const old = await this.database.first(
      "SELECT * FROM operations WHERE id=? AND scope=?",
      this.database.key(requestId),
      this.database.scope,
    );
    if (!old) return null;
    const result = JSON.parse(String(old.result_json));
    const rejectedMovement =
      old.kind === "movement_rejected" &&
      result.rejected === true &&
      result.kind === kind;
    const rejectedLifecycle =
      old.kind === "battery_lifecycle_rejected" &&
      result.rejected === true &&
      kind === "battery_lifecycle";
    const rejectedGroup =
      old.kind === "group_maintenance_rejected" &&
      result.rejected === true &&
      kind === "group_maintenance";
    if (
      (!rejectedMovement &&
        !rejectedLifecycle &&
        !rejectedGroup &&
        old.kind !== kind) ||
      old.fingerprint !== fingerprint
    )
      throw new DomainError(
        409,
        "This request identifier was already used for a different operation.",
        kind === "battery_lifecycle" ? "idempotency_conflict" : undefined,
      );
    if (rejectedMovement)
      throw new DomainError(
        Number(result.status),
        String(result.error),
        "movement_rejected_final",
      );
    if (rejectedLifecycle)
      throw new DomainError(
        Number(result.status),
        String(result.error),
        "lifecycle_rejected_final",
      );
    if (rejectedGroup)
      throw new DomainError(
        Number(result.status),
        String(result.error),
        "group_operation_rejected_final",
      );
    return { ...result, replayed: true };
  }

  async atomic(
    requestId: string,
    kind: string,
    fingerprint: string,
    result: unknown,
    at: string,
    guardSql: string,
    guardValues: unknown[],
    writes: D1PreparedStatement[],
    conflictMessage = "The records changed or conflict with this operation. Refresh and review the batteries again. Nothing in this batch was saved.",
    conflictCode?: string,
    group?: ResolvedGroup,
  ) {
    if (group) {
      guardSql = `(${guardSql}) AND (${group.guard})`;
      guardValues = [...guardValues, ...group.values];
    }
    if (this.session.actor.authVersion !== undefined) {
      guardSql = `(${guardSql}) AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)`;
      guardValues = [
        ...guardValues,
        this.session.actor.id,
        this.session.actor.authVersion,
        this.session.actor.role,
      ];
    }
    const old = await this.replay(requestId, kind, fingerprint);
    if (old) return old;
    const guard = this.database.statement(
      `INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?, CASE WHEN (${guardSql}) THEN 1 ELSE 0 END`,
      this.database.key(requestId),
      this.database.scope,
      kind,
      fingerprint,
      JSON.stringify(result),
      at,
      ...guardValues,
    );
    try {
      await this.database.raw.batch([guard, ...writes]);
      return result;
    } catch (error) {
      const replay = await this.replay(requestId, kind, fingerprint);
      if (replay) return replay;
      const message = String(error);
      if (/UNIQUE/i.test(message) && kind.startsWith("battery_"))
        throw new DomainError(
          409,
          "That battery ID or RFID identifier is already assigned.",
        );
      if (
        /UNIQUE/i.test(message) &&
        (kind === "person_registered" ||
          kind === "room_registered" ||
          kind === "building_registered")
      )
        throw new DomainError(
          409,
          "That record ID or room number is already registered.",
        );
      if (/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(message))
        throw new DomainError(409, conflictMessage, conflictCode);
      throw error;
    }
  }

  metadataWrite(
    table: "people" | "buildings" | "rooms" | "batteries",
    kind: string,
    id: string,
    data: unknown,
    before: Row | null,
    version: number,
    at: string,
    writes: D1PreparedStatement[],
    relatedGuard = "1",
    relatedValues: unknown[] = [],
    group?: ResolvedGroup,
  ) {
    const guard = before
      ? `(SELECT COUNT(*) FROM ${table} WHERE scope=? AND id=? AND version=?${table === "batteries" ? " AND lifecycle_status='active'" : ""})=1`
      : `(SELECT COUNT(*) FROM ${table} WHERE scope=? AND id=?)=0`;
    const values = before
      ? [this.database.scope, id, version - 1]
      : [this.database.scope, id];
    return this.atomic(
      crypto.randomUUID(),
      kind,
      JSON.stringify(data),
      { id, version },
      at,
      `(${guard}) AND (${relatedGuard})`,
      [...values, ...relatedValues],
      writes,
      "This record or its related information changed. Your edits were not saved. Load the latest record and review your input before saving.",
      "record_conflict",
      group,
    );
  }
}
