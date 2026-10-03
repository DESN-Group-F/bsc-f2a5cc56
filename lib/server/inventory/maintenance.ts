import {
  chargeSchema,
  observationSchema,
  correctionSchema,
  DomainError,
  validatePastTime,
} from "../../domain";
import { isSupportedBuilding } from "../../location-catalog";
import { canonicalModelJson } from "../../battery-models";
import { groupMaintenanceSchema } from "../../group-maintenance";
import { InventoryDatabase, type Row } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { InventoryGroups } from "./groups";
import { getBattery, requireActiveBattery } from "./records";

/** Attributed evidence, reasoned corrections and atomic group maintenance. */
export class InventoryMaintenance {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
    private groups: InventoryGroups,
  ) {}

  async charge(input: unknown) {
    this.session.requireAdmin();
    const v = chargeSchema.parse(input),
      fingerprint = JSON.stringify(v),
      old = await this.transactions.replay(v.requestId, "charge", fingerprint);
    if (old) return old;
    const b = await getBattery(this.database, v.batteryId),
      at = this.session.clock().toISOString(),
      completedAt = validatePastTime(v.completedAt, this.session.clock()),
      id = crypto.randomUUID();
    requireActiveBattery(b);
    const group = await this.groups.resolve(
      v.teachingGroup,
      [v.batteryId],
      v.requestId,
    );
    return this.transactions.atomic(
      v.requestId,
      "charge",
      fingerprint,
      { id, batteryId: v.batteryId },
      at,
      "EXISTS(SELECT 1 FROM batteries WHERE key=? AND scope=? AND lifecycle_status='active')",
      [b.key, this.database.scope],
      [
        this.database.statement(
          "INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)",
          id,
          this.database.scope,
          b.key,
          completedAt,
          v.durationMinutes,
          at,
          this.session.actor.id,
          this.session.actor.name,
        ),
        this.transactions.event(
          "charge_recorded",
          v.batteryId,
          {
            completedAt,
            durationMinutes: v.durationMinutes,
            source: "Manual record",
            ...(group ? { teachingGroup: group.evidence } : {}),
          },
          at,
        ),
      ],
      undefined,
      undefined,
      group,
    );
  }

  async observation(input: unknown) {
    this.session.requireAdmin();
    if (this.session.dataset !== "demo")
      throw new DomainError(
        501,
        "Real RFID room observations are not enabled. Hardware and room mapping must be validated first.",
      );
    const v = observationSchema.parse(input),
      fingerprint = JSON.stringify(v),
      old = await this.transactions.replay(
        v.requestId,
        "observation",
        fingerprint,
      );
    if (old) return old;
    const b = await getBattery(this.database, v.batteryId),
      r = await this.database.first(
        "SELECT r.*,building.id AS building_id,building.version AS building_version,COALESCE(building.id || ' - ' || building.name,r.building) AS building_label,CASE WHEN r.is_placeholder=1 THEN r.name || ' — Placeholder' WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END AS room_label FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.scope=? AND r.id=?",
        this.database.scope,
        v.roomId,
      );
    requireActiveBattery(b);
    if (!r || !isSupportedBuilding(String(r.building_id)) || r.selectable !== 1)
      throw new DomainError(400, "Select an available J18 room.");
    const at = this.session.clock().toISOString(),
      observedAt = validatePastTime(v.observedAt, this.session.clock()),
      id = crypto.randomUUID();
    const group = await this.groups.resolve(
      v.teachingGroup,
      [v.batteryId],
      v.requestId,
    );
    return this.transactions.atomic(
      v.requestId,
      "observation",
      fingerprint,
      { id, batteryId: v.batteryId },
      at,
      "(SELECT COUNT(*) FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.key=? AND r.scope=? AND r.version=? AND r.selectable=1 AND building.id='J18' AND building.version IS ?)=1 AND EXISTS(SELECT 1 FROM batteries WHERE key=? AND scope=? AND lifecycle_status='active')",
      [
        r.key,
        this.database.scope,
        r.version,
        r.building_version,
        b.key,
        this.database.scope,
      ],
      [
        this.database.statement(
          "INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)",
          id,
          this.database.scope,
          b.key,
          r.key,
          observedAt,
          at,
          "Demo observation",
          r.room_label,
          r.building_label,
        ),
        this.transactions.event(
          "demo_observation",
          v.batteryId,
          {
            observationId: id,
            room: r.room_label,
            building: r.building_label,
            roomId: r.id,
            observedAt,
            source: "Demo observation",
            ...(group ? { teachingGroup: group.evidence } : {}),
          },
          at,
        ),
      ],
      undefined,
      undefined,
      group,
    );
  }

  async correctLoan(input: unknown) {
    this.session.requireAdmin();
    const v = correctionSchema.parse(input),
      fingerprint = JSON.stringify({ ...v, actorId: this.session.actor.id }),
      old = await this.transactions.replay(
        v.requestId,
        "correction",
        fingerprint,
      );
    if (old) return old;
    const l = await this.database.first(
      "SELECT l.*,b.id AS battery_id,b.lifecycle_status AS battery_lifecycle_status FROM loans l JOIN batteries b ON b.key=l.battery_key WHERE l.scope=? AND l.id=?",
      this.database.scope,
      v.loanId,
    );
    if (!l || l.cancelled_at)
      throw new DomainError(409, "This loan is unavailable for correction.");
    requireActiveBattery({ lifecycle_status: l.battery_lifecycle_status });
    const latest = await this.database.first(
      "SELECT id FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 1",
      this.database.scope,
      l.battery_key,
    );
    if (latest?.id !== l.id)
      throw new DomainError(
        409,
        "Only the most recent loan can be corrected. Later movements must remain intact.",
      );
    const reopen = v.action === "return_reopened";
    if (
      l.returned_at !== v.expectedReturnedAt ||
      reopen !== (v.expectedReturnedAt !== null)
    )
      throw new DomainError(
        409,
        "The reviewed loan state changed. This correction was not saved. Review the loan and choose the intended correction again.",
      );
    const at = this.session.clock().toISOString();
    const group = await this.groups.resolve(
      v.teachingGroup,
      [String(l.battery_id)],
      v.requestId,
    );
    const write = reopen
      ? this.database.statement(
          "UPDATE loans SET returned_at=NULL,return_actor_id=NULL,return_actor_name=NULL,correction_reason=? WHERE id=? AND scope=?",
          v.reason,
          l.id,
          this.database.scope,
        )
      : this.database.statement(
          "UPDATE loans SET cancelled_at=?,correction_reason=? WHERE id=? AND scope=?",
          at,
          v.reason,
          l.id,
          this.database.scope,
        );
    return this.transactions.atomic(
      v.requestId,
      "correction",
      fingerprint,
      { id: l.id, action: v.action },
      at,
      "(SELECT COUNT(*) FROM loans WHERE id=? AND scope=? AND returned_at IS ? AND cancelled_at IS NULL)=1 AND (SELECT id FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 1)=? AND EXISTS(SELECT 1 FROM batteries WHERE key=? AND scope=? AND lifecycle_status='active')",
      [
        l.id,
        this.database.scope,
        v.expectedReturnedAt,
        this.database.scope,
        l.battery_key,
        l.id,
        l.battery_key,
        this.database.scope,
      ],
      [
        write,
        this.transactions.event(
          v.action,
          String(l.battery_id),
          {
            loanId: l.id,
            reason: v.reason,
            intendedAction: v.action,
            expectedReturnedAt: v.expectedReturnedAt,
            before: l,
            ...(group ? { teachingGroup: group.evidence } : {}),
          },
          at,
        ),
      ],
      undefined,
      undefined,
      group,
    );
  }

  async groupMaintenance(input: unknown) {
    this.session.requireAdmin();
    await this.session.requireLifecycleActor(this.database);
    const payload = groupMaintenanceSchema.parse(input),
      kind = "group_maintenance";
    const fingerprint = canonicalModelJson({
      actorAccountId: this.session.actor.id,
      dataset: this.session.dataset,
      payload,
    });
    const previous = await this.transactions.replay(
      payload.requestId,
      kind,
      fingerprint,
    );
    if (previous) return previous;
    try {
      const ids = payload.items.map((item) => item.batteryId),
        group = (await this.groups.resolve(
          payload.teachingGroup,
          ids,
          payload.requestId,
        ))!;
      const bindings = JSON.stringify(payload.items),
        at = this.session.clock().toISOString();
      const batteries = await this.database.rows(
        "SELECT * FROM batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?))",
        this.database.scope,
        JSON.stringify(ids),
      );
      for (const item of payload.items) {
        const battery = batteries.find((row) => row.id === item.batteryId);
        if (
          !battery ||
          battery.version !== item.version ||
          battery.tag_id !== item.tagId ||
          battery.lifecycle_status !== "active"
        )
          throw new DomainError(
            409,
            "A reviewed battery changed or is retired. No group changes were saved.",
          );
      }
      let relatedGuard = "1",
        relatedValues: unknown[] = [],
        owner: Row | null = null,
        room: Row | null = null;
      if (payload.kind === "owner") {
        owner = await this.database.first(
          "SELECT p.* FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.id=? AND p.role='staff' AND a.active=1",
          this.database.scope,
          payload.ownerId,
        );
        if (!owner)
          throw new DomainError(
            400,
            "Select an active responsible staff owner.",
          );
        relatedGuard =
          "EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=? AND p.scope=? AND p.version=? AND a.active=1)";
        relatedValues = [owner.key, this.database.scope, owner.version];
      }
      if (payload.kind === "storage" || payload.kind === "observation") {
        const roomId =
          payload.kind === "storage" ? payload.homeRoomId : payload.roomId;
        if (payload.kind === "observation" && this.session.dataset !== "demo")
          throw new DomainError(
            501,
            "Room observations remain demonstration-only until hardware is validated.",
          );
        if (roomId) {
          room = await this.database.first(
            "SELECT r.*,b.id AS building_id,b.version AS building_version,b.name AS building_name FROM rooms r JOIN buildings b ON b.key=r.building_key WHERE r.scope=? AND r.id=? AND r.selectable=1 AND b.id='J18'",
            this.database.scope,
            roomId,
          );
          if (!room)
            throw new DomainError(400, "Select an available J18 room.");
          relatedGuard =
            "EXISTS(SELECT 1 FROM rooms r JOIN buildings b ON b.key=r.building_key WHERE r.key=? AND r.scope=? AND r.version=? AND r.selectable=1 AND b.id='J18' AND b.version=?)";
          relatedValues = [
            room.key,
            this.database.scope,
            room.version,
            room.building_version,
          ];
        } else {
          if (
            !(await this.database.first(
              "SELECT key FROM buildings WHERE scope=? AND id='J18'",
              this.database.scope,
            ))
          )
            throw new DomainError(400, "J18 is unavailable in this inventory.");
          relatedGuard =
            "EXISTS(SELECT 1 FROM buildings WHERE scope=? AND id='J18')";
          relatedValues = [this.database.scope];
        }
      }
      const evidenceAt =
        payload.kind === "charge"
          ? validatePastTime(payload.completedAt, this.session.clock())
          : payload.kind === "observation"
            ? validatePastTime(payload.observedAt, this.session.clock())
            : null;
      const writes: D1PreparedStatement[] = [];
      for (const item of payload.items) {
        const before = batteries.find((row) => row.id === item.batteryId)!;
        const details: Record<string, unknown> = {
          requestId: payload.requestId,
          teachingGroup: group.evidence,
          reviewedBinding: item,
        };
        let action: string;
        if (payload.kind === "owner" || payload.kind === "storage") {
          action = "battery_updated";
          const after =
            payload.kind === "owner"
              ? { ...before, owner_key: owner!.key, version: item.version + 1 }
              : {
                  ...before,
                  home_building_key: this.database.key("J18"),
                  home_room_key: room?.key ?? null,
                  version: item.version + 1,
                };
          if (payload.kind === "owner")
            writes.push(
              this.database.statement(
                "UPDATE batteries SET owner_key=?,version=version+1 WHERE key=? AND scope=? AND version=?",
                owner!.key,
                before.key,
                this.database.scope,
                item.version,
              ),
            );
          else
            writes.push(
              this.database.statement(
                "UPDATE batteries SET home_building_key=?,home_room_key=?,version=version+1 WHERE key=? AND scope=? AND version=?",
                this.database.key("J18"),
                room?.key ?? null,
                before.key,
                this.database.scope,
                item.version,
              ),
            );
          Object.assign(details, { changedField: payload.kind, before, after });
        } else if (payload.kind === "charge") {
          action = "charge_recorded";
          writes.push(
            this.database.statement(
              "INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)",
              crypto.randomUUID(),
              this.database.scope,
              before.key,
              evidenceAt,
              payload.durationMinutes,
              at,
              this.session.actor.id,
              this.session.actor.name,
            ),
          );
          Object.assign(details, {
            completedAt: evidenceAt,
            durationMinutes: payload.durationMinutes,
            source: "Manual record",
          });
        } else {
          action = "demo_observation";
          const roomLabel =
              room!.is_placeholder === 1
                ? `${room!.name} — Placeholder`
                : `${room!.number} - ${room!.name}`,
            buildingLabel = `J18 - ${room!.building_name}`;
          writes.push(
            this.database.statement(
              "INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)",
              crypto.randomUUID(),
              this.database.scope,
              before.key,
              room!.key,
              evidenceAt,
              at,
              "Demo observation",
              roomLabel,
              buildingLabel,
            ),
          );
          Object.assign(details, {
            roomId: room!.id,
            room: roomLabel,
            building: buildingLabel,
            observedAt: evidenceAt,
            source: "Demo observation",
          });
        }
        writes.push(
          this.transactions.event(action, item.batteryId, details, at),
        );
      }
      const result = {
        requestId: payload.requestId,
        dataset: this.session.dataset,
        actorAccountId: this.session.actor.id,
        kind: payload.kind,
        batteryIds: ids,
        at,
        teachingGroup: group.evidence,
        replayed: false,
      };
      const guard =
        "(SELECT COUNT(*) FROM batteries b JOIN json_each(?) j ON b.id=json_extract(j.value,'$.batteryId') AND b.version=json_extract(j.value,'$.version') AND b.tag_id IS json_extract(j.value,'$.tagId') WHERE b.scope=? AND b.lifecycle_status='active')=?";
      return await this.transactions.atomic(
        payload.requestId,
        kind,
        fingerprint,
        result,
        at,
        `(${guard}) AND (${relatedGuard})`,
        [bindings, this.database.scope, ids.length, ...relatedValues],
        writes,
        "A battery, teaching group, directory or staff account changed. No group changes were saved.",
        "group_conflict",
        group,
      );
    } catch (error) {
      const committed = await this.transactions.replay(
        payload.requestId,
        kind,
        fingerprint,
      );
      if (committed) return committed;
      if (
        !(error instanceof DomainError) ||
        ![400, 404, 409, 422].includes(error.status) ||
        error.code === "idempotency_conflict"
      )
        throw error;
      await this.session.requireLifecycleActor(this.database);
      try {
        await this.database.raw.batch([
          this.database.statement(
            "INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'group_maintenance_rejected',?,?,?,CASE WHEN EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role='admin') THEN 1 ELSE 0 END",
            this.database.key(payload.requestId),
            this.database.scope,
            fingerprint,
            JSON.stringify({
              rejected: true,
              status: error.status,
              error: error.message,
            }),
            this.session.clock().toISOString(),
            this.session.actor.id,
            this.session.actor.authVersion,
          ),
        ]);
      } catch (reservationError) {
        const committed = await this.transactions.replay(
          payload.requestId,
          kind,
          fingerprint,
        );
        if (committed) return committed;
        throw reservationError;
      }
      throw new DomainError(
        error.status,
        error.message,
        "group_operation_rejected_final",
      );
    }
  }
}
