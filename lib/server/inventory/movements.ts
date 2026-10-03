import {
  movementSchema,
  DomainError,
  uniqueIds,
  type ReturnPlacement,
} from "../../domain";
import { isSupportedBuilding } from "../../location-catalog";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { InventoryGroups } from "./groups";
import { requireActiveBattery } from "./records";

/** Checkout and exact-loan returns, including durable final rejection. */
export class InventoryMovements {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
    private groups: InventoryGroups,
  ) {}

  private async rejectMovement(
    requestId: string,
    kind: "checkout" | "return",
    fingerprint: string,
    rejection: DomainError,
  ) {
    const result = {
      kind,
      rejected: true,
      status: rejection.status,
      error: rejection.message,
    };
    const authorization =
      "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)";
    try {
      // Success and final rejection compete for the same immutable request key.
      await this.database.raw.batch([
        this.database.statement(
          `INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'movement_rejected',?,?,?, CASE WHEN (${authorization}) THEN 1 ELSE 0 END`,
          this.database.key(requestId),
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
        requestId,
        kind,
        fingerprint,
      );
      if (committed) return { ...committed, requestId };
      const authorized = await this.database.first(
        "SELECT id FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?",
        this.session.actor.id,
        this.session.actor.authVersion,
        this.session.actor.role,
      );
      if (!authorized) throw rejection;
      // A failed reservation does not establish an in-flight request's final outcome.
      throw error;
    }
    throw new DomainError(
      rejection.status,
      rejection.message,
      "movement_rejected_final",
    );
  }

  async movement(input: unknown) {
    const v = movementSchema.parse(input),
      ids = uniqueIds(v.batteryIds);
    const scan = v.scan
      ? {
          ...v.scan,
          bindings: [...v.scan.bindings].sort((a, b) =>
            a.batteryId.localeCompare(b.batteryId),
          ),
        }
      : null;
    const returnRoom = v.kind === "return" ? v.returnRoom : undefined;
    if (scan?.source === "simulated" && this.session.dataset !== "demo")
      throw new DomainError(
        400,
        "Simulated scans are available only in the demonstration inventory.",
      );
    if (scan && this.session.actor.authVersion === undefined)
      throw new DomainError(
        401,
        "Sign in with a staff account before confirming scanned batteries.",
      );
    const taggedBindings =
      scan?.bindings.filter((binding) => binding.tagId !== null) ?? [];
    if (
      scan &&
      (scan.bindings.length !== ids.length ||
        new Set(scan.bindings.map((binding) => binding.batteryId)).size !==
          ids.length ||
        new Set(taggedBindings.map((binding) => binding.tagId)).size !==
          taggedBindings.length ||
        scan.bindings.some((binding) => !ids.includes(binding.batteryId)))
    )
      throw new DomainError(
        400,
        "The reviewed battery bindings must match every selected battery exactly once, without duplicate registered tags.",
      );
    if (returnRoom && !scan)
      throw new DomainError(
        400,
        "A return-room confirmation requires a reviewed scan session.",
      );
    const expected =
      v.kind === "return"
        ? [...v.expectedLoans].sort((a, b) =>
            a.batteryId.localeCompare(b.batteryId),
          )
        : [];
    if (
      v.kind === "return" &&
      (expected.length !== ids.length ||
        new Set(expected.map((item) => item.batteryId)).size !== ids.length ||
        new Set(expected.map((item) => item.loanId)).size !== ids.length ||
        expected.some((item) => !ids.includes(item.batteryId)))
    )
      throw new DomainError(
        400,
        "The reviewed loan IDs must match every selected battery exactly once.",
      );
    const fingerprint = JSON.stringify({
      kind: v.kind,
      ids,
      actorId: this.session.actor.id,
      borrowerAccountId: v.kind === "checkout" ? this.session.actor.id : null,
      expectedLoans: expected,
      ...(scan ? { scan, ...(returnRoom ? { returnRoom } : {}) } : {}),
      ...(v.teachingGroup ? { teachingGroup: v.teachingGroup } : {}),
    });
    const old = await this.transactions.replay(
      v.requestId,
      v.kind,
      fingerprint,
    );
    if (old) return { ...old, requestId: v.requestId };
    try {
      const at = this.session.clock().toISOString(),
        keysJson = JSON.stringify(ids.map((id) => this.database.key(id)));
      const group = await this.groups.resolve(
        v.teachingGroup,
        ids,
        v.requestId,
      );
      // JSON carries the batch as one bound parameter, including 100-battery batches.
      const bs = await this.database.rows(
        "SELECT key,id,tag_id,version,lifecycle_status FROM batteries WHERE scope=? AND key IN (SELECT value FROM json_each(?))",
        this.database.scope,
        keysJson,
      );
      if (bs.length !== ids.length)
        throw new DomainError(
          404,
          "One or more batteries are not registered in this inventory.",
        );
      for (const battery of bs) requireActiveBattery(battery);
      let evidenceGuard =
        "(SELECT COUNT(*) FROM batteries WHERE scope=? AND key IN (SELECT value FROM json_each(?)) AND lifecycle_status='active')=?";
      const evidenceValues: unknown[] = [
        this.database.scope,
        keysJson,
        ids.length,
      ];
      if (scan) {
        if (
          scan.bindings.some(
            (binding) =>
              !bs.some(
                (battery) =>
                  battery.id === binding.batteryId &&
                  battery.tag_id === binding.tagId &&
                  battery.version === binding.version,
              ),
          )
        )
          throw new DomainError(
            409,
            "A scanned tag binding or battery record changed. Nothing was saved. Review the latest records before confirming.",
            "scan_conflict",
          );
        evidenceGuard +=
          " AND (SELECT COUNT(*) FROM batteries b JOIN json_each(?) reviewed ON b.id=json_extract(reviewed.value,'$.batteryId') AND b.tag_id IS json_extract(reviewed.value,'$.tagId') AND b.version=json_extract(reviewed.value,'$.version') WHERE b.scope=?)=?";
        evidenceValues.push(
          JSON.stringify(scan.bindings),
          this.database.scope,
          ids.length,
        );
      }
      let returnPlacement: ReturnPlacement | undefined,
        placementRoomKey: string | undefined;
      if (returnRoom) {
        const room = await this.database.first(
          "SELECT r.*,building.id AS building_id,building.version AS building_version,COALESCE(building.id || ' - ' || building.name,r.building) AS building_label,CASE WHEN r.is_placeholder=1 THEN r.name || ' — Placeholder' WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END AS room_label FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.scope=? AND r.id=?",
          this.database.scope,
          returnRoom.roomId,
        );
        if (
          !room ||
          !isSupportedBuilding(String(room.building_id)) ||
          room.selectable !== 1
        )
          throw new DomainError(
            400,
            "Select an available J18 room, or leave the return location unspecified.",
          );
        if (this.session.dataset === "live" && room.is_placeholder === 1)
          throw new DomainError(
            400,
            "Confirm a verified room for working-inventory returns. Placeholder rooms are provisional; the location can stay unspecified.",
          );
        if (room.version !== returnRoom.version)
          throw new DomainError(
            409,
            "This return room changed. Nothing was saved. Review the latest room before confirming.",
            "scan_conflict",
          );
        placementRoomKey = String(room.key);
        returnPlacement = {
          roomId: String(room.id),
          roomName: String(room.room_label),
          building: String(room.building_label),
          buildingId: String(room.building_id),
          isPlaceholder: room.is_placeholder === 1,
          source:
            scan!.source === "simulated"
              ? "Simulated return confirmation"
              : "Staff return confirmation",
          observedAt: at,
          roomVersion: Number(room.version),
          buildingVersion: Number(room.building_version),
        };
        evidenceGuard +=
          " AND EXISTS(SELECT 1 FROM rooms r JOIN buildings building ON building.key=r.building_key WHERE r.key=? AND r.scope=? AND r.version=? AND r.selectable=1 AND building.id='J18' AND building.version=? AND (?=0 OR r.is_placeholder=0))";
        evidenceValues.push(
          room.key,
          this.database.scope,
          returnRoom.version,
          room.building_version,
          Number(this.session.dataset === "live"),
        );
      }
      const scanDetails = (batteryId: string) => ({
        requestId: v.requestId,
        ...(scan
          ? {
              scan: {
                ...scan,
                bindings: scan.bindings.filter(
                  (binding) => binding.batteryId === batteryId,
                ),
              },
            }
          : {}),
        ...(group ? { teachingGroup: group.evidence } : {}),
      });
      const receiptDetails = {
        requestId: v.requestId,
        ...(scan
          ? { scan, ...(returnPlacement ? { returnPlacement } : {}) }
          : {}),
        ...(group ? { teachingGroup: group.evidence } : {}),
      };
      const writes: D1PreparedStatement[] = [];
      if (v.kind === "checkout") {
        if (this.session.actor.authVersion === undefined)
          throw new DomainError(
            401,
            "Sign in with a staff account before checking out batteries.",
          );
        const account = await this.database.first(
          "SELECT id,display_name,version FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?",
          this.session.actor.id,
          this.session.actor.authVersion,
          this.session.actor.role,
        );
        if (!account)
          throw new DomainError(
            409,
            "Your account access changed. Sign in again before checking out batteries.",
          );
        this.session.actor = {
          ...this.session.actor,
          name: String(account.display_name),
        };
        const personId = `staff-${this.session.actor.id}`,
          personKey = this.database.key(personId);
        const linked = await this.database.first(
          "SELECT key,id FROM people WHERE scope=? AND account_id=?",
          this.database.scope,
          this.session.actor.id,
        );
        if (linked && (linked.key !== personKey || linked.id !== personId))
          throw new DomainError(
            409,
            "This account's directory association requires administrator review.",
          );
        // Provision an explicit account-ID association in the movement transaction.
        // A same-name or colliding legacy person is never adopted or rewritten.
        writes.push(
          this.database.statement(
            "INSERT INTO people(key,scope,id,name,reference,role,account_id) SELECT ?,?,?,?,'','staff',? WHERE NOT EXISTS(SELECT 1 FROM people WHERE scope=? AND account_id=?)",
            personKey,
            this.database.scope,
            personId,
            account.display_name,
            this.session.actor.id,
            this.database.scope,
            this.session.actor.id,
          ),
        );
        writes.push(
          this.database.statement(
            "INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) SELECT ?,?,'staff_directory_linked',NULL,?,?,?,? WHERE changes()=1",
            crypto.randomUUID(),
            this.database.scope,
            this.session.actor.id,
            this.session.actor.name,
            at,
            JSON.stringify({ personId, accountId: this.session.actor.id }),
          ),
        );
        for (const id of ids) {
          const loanId = crypto.randomUUID();
          writes.push(
            this.database.statement(
              "INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?,?)",
              loanId,
              this.database.scope,
              this.database.key(id),
              personKey,
              account.display_name,
              this.session.actor.id,
              at,
              this.session.actor.id,
              account.display_name,
            ),
            this.transactions.event(
              "checkout",
              id,
              {
                loanId,
                borrower: account.display_name,
                borrowerId: personId,
                borrowerAccountId: this.session.actor.id,
                borrowerKind: "staff",
                ...scanDetails(id),
              },
              at,
            ),
          );
        }
        return await this.transactions.atomic(
          v.requestId,
          v.kind,
          fingerprint,
          {
            kind: v.kind,
            batteryIds: ids,
            count: ids.length,
            borrower: account.display_name,
            borrowerAccountId: this.session.actor.id,
            at,
            ...receiptDetails,
          },
          at,
          "NOT EXISTS(SELECT 1 FROM loans WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?)) AND returned_at IS NULL AND cancelled_at IS NULL) AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND version=? AND display_name=?) AND (" +
            evidenceGuard +
            ")",
          [
            this.database.scope,
            keysJson,
            this.session.actor.id,
            account.version,
            account.display_name,
            ...evidenceValues,
          ],
          writes,
          group
            ? "The reviewed batteries, teaching group, loan state or account access changed. Nothing in this batch was saved. Review the latest records before confirming."
            : scan
              ? "The scanned battery bindings, loan state or account access changed. Nothing in this batch was saved. Review the latest records before confirming."
              : undefined,
          scan ? "scan_conflict" : undefined,
          group,
        );
      }
      const expectedJson = JSON.stringify(
        expected.map((item) => ({
          key: this.database.key(item.batteryId),
          loanId: item.loanId,
        })),
      );
      const reviewedSql =
        "SELECT l.id,l.battery_key,l.borrower_name,l.borrower_account_id FROM loans l JOIN json_each(?) reviewed ON l.id=json_extract(reviewed.value,'$.loanId') AND l.battery_key=json_extract(reviewed.value,'$.key') WHERE l.scope=? AND l.returned_at IS NULL AND l.cancelled_at IS NULL";
      const open = await this.database.rows(
        reviewedSql,
        expectedJson,
        this.database.scope,
      );
      if (open.length !== ids.length)
        throw new DomainError(
          409,
          "A reviewed loan changed. Nothing was returned. Refresh and review the current loans before confirming.",
        );
      for (const l of open) {
        const b = bs.find((b) => b.key === l.battery_key)!;
        const observationId = returnPlacement ? crypto.randomUUID() : undefined;
        writes.push(
          this.database.statement(
            "UPDATE loans SET returned_at=?,return_actor_id=?,return_actor_name=? WHERE id=? AND scope=?",
            at,
            this.session.actor.id,
            this.session.actor.name,
            l.id,
            this.database.scope,
          ),
        );
        if (returnPlacement)
          writes.push(
            this.database.statement(
              "INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)",
              observationId,
              this.database.scope,
              b.key,
              placementRoomKey,
              at,
              at,
              returnPlacement.source,
              returnPlacement.roomName,
              returnPlacement.building,
            ),
          );
        writes.push(
          this.transactions.event(
            "return",
            String(b.id),
            {
              loanId: l.id,
              borrower: l.borrower_name,
              borrowerAccountId: l.borrower_account_id,
              receivedByAccountId: this.session.actor.id,
              ...scanDetails(String(b.id)),
              ...(returnPlacement ? { observationId, returnPlacement } : {}),
            },
            at,
          ),
        );
      }
      return await this.transactions.atomic(
        v.requestId,
        v.kind,
        fingerprint,
        {
          kind: v.kind,
          batteryIds: ids,
          count: ids.length,
          at,
          ...receiptDetails,
        },
        at,
        `(SELECT COUNT(*) FROM (${reviewedSql}))=? AND (${evidenceGuard})`,
        [expectedJson, this.database.scope, ids.length, ...evidenceValues],
        writes,
        group
          ? "The reviewed loan, battery, teaching group, return room or account access changed. Nothing in this batch was saved. Review the latest records before confirming."
          : scan
            ? "The reviewed loan, scanned binding, return room or account access changed. Nothing in this batch was saved. Review the latest records before confirming."
            : undefined,
        scan ? "scan_conflict" : undefined,
        group,
      );
    } catch (error) {
      // Another execution of this exact request may commit after the first receipt read.
      const committed = await this.transactions.replay(
        v.requestId,
        v.kind,
        fingerprint,
      );
      if (committed) return { ...committed, requestId: v.requestId };
      if (
        error instanceof DomainError &&
        error.status >= 400 &&
        error.status < 500 &&
        this.session.actor.authVersion !== undefined
      )
        return await this.rejectMovement(
          v.requestId,
          v.kind,
          fingerprint,
          error,
        );
      throw error;
    }
  }
}
