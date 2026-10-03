import { DomainError } from "../../domain";
import { canonicalModelJson } from "../../battery-models";
import {
  lifecyclePayloadSchema,
  type LifecyclePayload,
  type LifecycleReceipt,
} from "../../lifecycle-session";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { InventoryGroups } from "./groups";
import { requireActiveBattery } from "./records";

/** Terminal asset transitions with exact reviewed bindings and retained history. */
export class InventoryLifecycle {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
    private groups: InventoryGroups,
  ) {}

  private async rejectLifecycle(
    payload: LifecyclePayload,
    fingerprint: string,
    rejection: DomainError,
  ): Promise<LifecycleReceipt> {
    await this.session.requireLifecycleActor(this.database);
    const result = {
      kind: payload.kind,
      rejected: true,
      status: rejection.status,
      error: rejection.message,
      reasonCode: rejection.code ?? null,
    };
    try {
      await this.database.raw.batch([
        this.database.statement(
          "INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'battery_lifecycle_rejected',?,?,?,CASE WHEN EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')) THEN 1 ELSE 0 END",
          this.database.key(payload.requestId),
          this.database.scope,
          fingerprint,
          JSON.stringify(result),
          this.session.clock().toISOString(),
          this.session.actor.id,
          this.session.actor.authVersion,
          this.session.actor.role,
        ),
      ]);
    } catch (error) {
      const committed = await this.transactions.replay(
        payload.requestId,
        "battery_lifecycle",
        fingerprint,
      );
      if (committed) return committed as LifecycleReceipt;
      await this.session.requireLifecycleActor(this.database);
      // A failed reservation cannot establish a delayed request's outcome.
      throw error;
    }
    throw new DomainError(
      rejection.status,
      rejection.message,
      "lifecycle_rejected_final",
    );
  }

  async lifecycle(input: unknown): Promise<LifecycleReceipt> {
    await this.session.requireLifecycleActor(this.database);
    const payload = lifecyclePayloadSchema.parse(input),
      fingerprint = canonicalModelJson({
        actorAccountId: this.session.actor.id,
        dataset: this.session.dataset,
        payload,
      });
    const previous = await this.transactions.replay(
      payload.requestId,
      "battery_lifecycle",
      fingerprint,
    );
    if (previous) return previous as LifecycleReceipt;
    try {
      const group = await this.groups.resolve(
        payload.teachingGroup,
        payload.items.map((item) => item.batteryId),
        payload.requestId,
      );
      const bindingsJson = JSON.stringify(payload.items),
        keysJson = JSON.stringify(
          payload.items.map((item) => this.database.key(item.batteryId)),
        );
      const batteries = await this.database.rows(
        "SELECT b.*,p.id AS ownerId,COALESCE(a.display_name,p.name) AS ownerName,p.account_id AS ownerAccountId,building.id AS homeBuildingId,building.name AS homeBuildingName,room.id AS homeRoomId,room.name AS homeRoomName,room.number AS homeRoomNumber,room.is_placeholder AS homeRoomIsPlaceholder FROM batteries b JOIN people p ON p.key=b.owner_key LEFT JOIN staff_accounts a ON a.id=p.account_id LEFT JOIN buildings building ON building.key=b.home_building_key LEFT JOIN rooms room ON room.key=b.home_room_key WHERE b.scope=? AND b.key IN (SELECT value FROM json_each(?))",
        this.database.scope,
        keysJson,
      );
      if (batteries.length !== payload.items.length)
        throw new DomainError(
          404,
          "One or more reviewed batteries are not registered in this inventory.",
        );
      for (const item of payload.items) {
        const battery = batteries.find((row) => row.id === item.batteryId)!;
        requireActiveBattery(battery);
        if (battery.version !== item.version || battery.tag_id !== item.tagId)
          throw new DomainError(
            409,
            "A reviewed battery version or exact tag changed. No batteries were removed. Review the current records.",
            "lifecycle_conflict",
          );
      }
      if (
        await this.database.first(
          "SELECT id FROM loans WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?)) AND returned_at IS NULL AND cancelled_at IS NULL LIMIT 1",
          this.database.scope,
          keysJson,
        )
      )
        throw new DomainError(
          409,
          "Return every selected battery's active loan before scrapping or permanently removing it.",
          "lifecycle_loan_active",
        );
      const at = this.session.clock().toISOString(),
        savedReason = payload.reason || null;
      const result: LifecycleReceipt = {
        requestId: payload.requestId,
        dataset: this.session.dataset,
        actorAccountId: this.session.actor.id,
        kind: payload.kind,
        reason: payload.reason,
        destination: payload.destination,
        source: payload.source,
        at,
        items: payload.items.map((item) => ({
          batteryId: item.batteryId,
          tagId: item.tagId,
          version: item.version + 1,
          status: payload.kind,
        })),
        replayed: false,
        ...(group ? { teachingGroup: group.evidence } : {}),
      };
      const writes: D1PreparedStatement[] = [];
      for (const item of payload.items) {
        const before = batteries.find((row) => row.id === item.batteryId)!;
        const after = {
          ...before,
          lifecycle_status: payload.kind,
          lifecycle_at: at,
          lifecycle_reason: savedReason,
          lifecycle_destination: payload.destination,
          version: item.version + 1,
        };
        writes.push(
          this.database.statement(
            "UPDATE batteries SET lifecycle_status=?,lifecycle_at=?,lifecycle_reason=?,lifecycle_destination=?,version=version+1 WHERE scope=? AND id=? AND version=? AND tag_id IS ? AND lifecycle_status='active'",
            payload.kind,
            at,
            savedReason,
            payload.destination,
            this.database.scope,
            item.batteryId,
            item.version,
            item.tagId,
          ),
        );
        writes.push(
          this.transactions.event(
            payload.kind === "scrapped"
              ? "battery_scrapped"
              : "battery_permanently_removed",
            item.batteryId,
            {
              requestId: payload.requestId,
              kind: payload.kind,
              reason: payload.reason,
              destination: payload.destination,
              source: payload.source,
              reviewedBinding: item,
              before,
              after,
              ...(group ? { teachingGroup: group.evidence } : {}),
            },
            at,
          ),
        );
      }
      const guard =
        "(SELECT COUNT(*) FROM batteries b JOIN json_each(?) j ON b.id=json_extract(j.value,'$.batteryId') AND b.version=json_extract(j.value,'$.version') AND b.tag_id IS json_extract(j.value,'$.tagId') WHERE b.scope=? AND b.lifecycle_status='active')=? AND NOT EXISTS(SELECT 1 FROM loans WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?)) AND returned_at IS NULL AND cancelled_at IS NULL)";
      return (await this.transactions.atomic(
        payload.requestId,
        "battery_lifecycle",
        fingerprint,
        result,
        at,
        guard,
        [
          bindingsJson,
          this.database.scope,
          payload.items.length,
          this.database.scope,
          keysJson,
        ],
        writes,
        "A reviewed battery, tag, loan, teaching group or staff account changed. No batteries were removed. Review the current records.",
        "lifecycle_conflict",
        group,
      )) as LifecycleReceipt;
    } catch (error) {
      const committed = await this.transactions.replay(
        payload.requestId,
        "battery_lifecycle",
        fingerprint,
      );
      if (committed) return committed as LifecycleReceipt;
      if (
        error instanceof DomainError &&
        [400, 404, 409, 422].includes(error.status) &&
        !["idempotency_conflict", "lifecycle_rejected_final"].includes(
          error.code ?? "",
        )
      )
        return this.rejectLifecycle(payload, fingerprint, error);
      throw error;
    }
  }
}
