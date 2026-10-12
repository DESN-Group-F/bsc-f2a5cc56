import {
  scanLookupSchema,
  DomainError,
  type BatteryRecord,
  type ScanLookupResult,
} from "../../domain";
import { teachingGroupSchema } from "../../teaching-groups";
import { InventoryDatabase, type Row } from "./database";
import { InventorySession } from "./actor";
import { ensureInventoryReferenceData } from "./provisioning";
import { summarizeBatteryUsage } from "../../battery-usage";
import type { InspectionRecord } from "../../battery-inspections";
import { InventoryNewArrivals } from "./new-arrivals";

const loanColumns = "id,borrower_name AS borrowerName,borrower_account_id AS borrowerAccountId,CASE WHEN borrower_account_id IS NULL THEN 'legacy' ELSE 'staff' END AS borrowerKind,checked_out_at AS checkedOutAt,returned_at AS returnedAt,cancelled_at AS cancelledAt,checkout_actor_name AS checkoutActorName,return_actor_name AS returnActorName,correction_reason AS correctionReason";
const inspectionColumns = "i.id,b.id AS batteryId,i.kind,i.outcome,i.performed_at AS performedAt,i.recorded_at AS recordedAt,i.inspector_account_id AS inspectorAccountId,i.inspector_name AS inspectorName,i.method,i.notes,i.reference,i.capacity_mah AS capacityMah,v.voided_at AS voidedAt,v.actor_account_id AS voidedByAccountId,v.actor_name AS voidedByName,v.reason AS voidReason";

/** Inventory read models; provisioning is explicit at the public snapshot/detail entry points. */
export class InventoryQueries {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
  ) {}

  private inspectionStatement(batteryId?: string) {
    return this.database.statement(
      `SELECT ${inspectionColumns} FROM battery_inspections i JOIN batteries b ON b.key=i.battery_key AND b.scope=i.scope LEFT JOIN battery_inspection_voids v ON v.inspection_id=i.id AND v.scope=i.scope WHERE i.scope=?${batteryId ? " AND b.id=?" : ""} ORDER BY julianday(i.performed_at) DESC,julianday(i.recorded_at) DESC,i.rowid DESC`,
      this.database.scope, ...(batteryId ? [batteryId] : []),
    );
  }

  private snapshotStatements(tagIds?: string[], batteryId?: string) {
    return [
      this.database.statement(
        `WITH current_inspections AS (
          SELECT i.*,ROW_NUMBER() OVER(PARTITION BY i.scope,i.battery_key ORDER BY julianday(i.performed_at) DESC,julianday(i.recorded_at) DESC,i.rowid DESC) AS latest_rank,
          ROW_NUMBER() OVER(PARTITION BY i.scope,i.battery_key,i.outcome ORDER BY julianday(i.performed_at) DESC,julianday(i.recorded_at) DESC,i.rowid DESC) AS outcome_rank
          FROM battery_inspections i LEFT JOIN battery_inspection_voids v ON v.inspection_id=i.id AND v.scope=i.scope
          WHERE i.scope=? AND v.inspection_id IS NULL
        ), inspection_counts AS (
          SELECT scope,battery_key,COUNT(*) AS valid_records,SUM(CASE WHEN outcome='concern_observed' THEN 1 ELSE 0 END) AS concern_records
          FROM current_inspections GROUP BY scope,battery_key
        ) SELECT b.id,b.version,b.name,b.chemistry,b.model,b.capacity_mah AS capacityMah,b.voltage,b.tag_id AS tagId,
        b.lifecycle_status AS lifecycleStatus,b.lifecycle_at AS lifecycleAt,b.lifecycle_reason AS lifecycleReason,b.lifecycle_destination AS lifecycleDestination,
        b.manufactured_on AS manufacturedOn,b.first_used_on AS firstUsedOn,b.created_at AS registeredAt,
        own.id AS ownerId,COALESCE(ownerAccount.display_name,own.name) AS ownerName,own.account_id AS ownerAccountId,
        home.id AS homeRoomId,home.name AS homeRoomName,home.number AS homeRoomNumber,home.is_placeholder AS homeRoomIsPlaceholder,home.selectable AS homeRoomSelectable,
        homeBuilding.id AS homeBuildingId,homeBuilding.name AS homeBuildingName,
        l.id AS loanId,p.id AS borrowerId,l.borrower_name AS borrowerName,l.borrower_account_id AS borrowerAccountId,
        CASE WHEN l.id IS NULL THEN NULL WHEN l.borrower_account_id IS NULL THEN 'legacy' ELSE 'staff' END AS borrowerKind,
        l.checked_out_at AS checkedOutAt,
        (SELECT checked_out_at FROM loans WHERE battery_key=b.key AND scope=b.scope AND cancelled_at IS NULL ORDER BY checked_out_at DESC,rowid DESC LIMIT 1) AS lastCheckedOutAt,
        observedRoom.id AS observedRoomId,
        CASE WHEN o.id IS NULL THEN NULL ELSE COALESCE(o.room_name,'Room ID: ' || observedRoom.id) END AS observedRoom,
        o.room_building AS observedBuilding,CASE WHEN o.id IS NULL THEN NULL WHEN o.room_name IS NULL THEN 'unavailable' ELSE 'recorded' END AS observationRoomSnapshot,
        o.observed_at AS observedAt,o.source AS observationSource,
        c.completed_at AS chargedAt,c.duration_minutes AS chargeDurationMinutes,
        COALESCE(ic.valid_records,0) AS inspectionValidRecords,COALESCE(ic.concern_records,0) AS inspectionConcernRecords,
        latestCheck.id AS inspectionLatestId,latestCheck.kind AS inspectionLatestKind,latestCheck.outcome AS inspectionLatestOutcome,
        latestCheck.performed_at AS inspectionLatestPerformedAt,latestCheck.recorded_at AS inspectionLatestRecordedAt,latestCheck.inspector_name AS inspectionLatestInspectorName,
        latestConcern.id AS inspectionConcernId,latestConcern.kind AS inspectionConcernKind,
        latestConcern.performed_at AS inspectionConcernPerformedAt,latestConcern.recorded_at AS inspectionConcernRecordedAt,latestConcern.inspector_name AS inspectionConcernInspectorName
        FROM batteries b JOIN people own ON own.key=b.owner_key LEFT JOIN rooms home ON home.key=b.home_room_key
        LEFT JOIN staff_accounts ownerAccount ON ownerAccount.id=own.account_id
        LEFT JOIN buildings homeBuilding ON homeBuilding.key=COALESCE(b.home_building_key,home.building_key)
        LEFT JOIN loans l ON l.battery_key=b.key AND l.scope=b.scope AND l.returned_at IS NULL AND l.cancelled_at IS NULL
        LEFT JOIN people p ON p.key=l.borrower_key
        LEFT JOIN observations o ON o.id=(SELECT id FROM observations WHERE battery_key=b.key AND scope=b.scope ORDER BY observed_at DESC,received_at DESC,rowid DESC LIMIT 1)
        LEFT JOIN rooms observedRoom ON observedRoom.key=o.room_key
        LEFT JOIN charges c ON c.id=(SELECT id FROM charges WHERE battery_key=b.key AND scope=b.scope ORDER BY completed_at DESC,recorded_at DESC,rowid DESC LIMIT 1)
        LEFT JOIN inspection_counts ic ON ic.scope=b.scope AND ic.battery_key=b.key
        LEFT JOIN current_inspections latestCheck ON latestCheck.scope=b.scope AND latestCheck.battery_key=b.key AND latestCheck.latest_rank=1
        LEFT JOIN current_inspections latestConcern ON latestConcern.scope=b.scope AND latestConcern.battery_key=b.key AND latestConcern.outcome='concern_observed' AND latestConcern.outcome_rank=1
        WHERE b.scope=?${tagIds ? " AND b.tag_id IN (SELECT value FROM json_each(?))" : ""}${batteryId ? " AND b.id=?" : ""} ORDER BY b.id`,
        this.database.scope,
        this.database.scope,
        ...(tagIds ? [JSON.stringify(tagIds)] : []),
        ...(batteryId ? [batteryId] : []),
      ),
      this.database.statement(
        "SELECT p.id,p.version,COALESCE(a.display_name,p.name) AS name,p.reference,p.role,p.account_id AS accountId FROM people p LEFT JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? ORDER BY name",
        this.database.scope,
      ),
      this.database.statement(
        "SELECT id,version,name FROM buildings WHERE scope=? ORDER BY id",
        this.database.scope,
      ),
      this.database.statement(
        "SELECT r.id,r.version,r.name,r.number,r.is_placeholder AS isPlaceholder,r.selectable,b.id AS buildingId,COALESCE(b.id || ' - ' || b.name,r.building) AS building FROM rooms r LEFT JOIN buildings b ON b.key=r.building_key WHERE r.scope=? ORDER BY b.id,r.number,r.name",
        this.database.scope,
      ),
      this.database.statement(
        "SELECT id,action,battery_id AS batteryId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 200",
        this.database.scope,
      ),
      this.database.statement(
        "SELECT id,display_name AS displayName,username,active FROM staff_accounts ORDER BY display_name,username",
      ),
      this.database.statement(
        "SELECT id,version,name,notes,member_ids_json,owner_account_id AS ownerAccountId,state,created_at AS createdAt,updated_at AS updatedAt FROM teaching_groups WHERE scope=? AND owner_account_id=? AND state='active' ORDER BY name COLLATE NOCASE,id",
        this.database.scope,
        this.session.actor.id,
      ),
      this.database.statement("SELECT id,actor_id AS actorAccountId,at FROM purged_batteries WHERE scope=? ORDER BY at DESC,id", this.database.scope),
      ...new InventoryNewArrivals(this.database, this.session).snapshotStatements(),
    ];
  }

  private snapshotResult(result: Row[][]) {
    const [
      batteries,
      people,
      buildings,
      rooms,
      events,
      staffDirectory,
      groups = [],
      purgedBatteries = [],
      arrivalMetadata,
      arrivalRecords = [],
    ] = result;
    return {
      dataset: this.session.dataset,
      purgedBatteries,
      ...(arrivalMetadata ? { newArrivals: new InventoryNewArrivals(this.database, this.session).snapshotResult(arrivalMetadata, arrivalRecords, this.session.clock().toISOString()) } : {}),
      batteries: batteries.map<Row>((row) => {
        const {
          inspectionValidRecords, inspectionConcernRecords,
          inspectionLatestId, inspectionLatestKind, inspectionLatestOutcome,
          inspectionLatestPerformedAt, inspectionLatestRecordedAt, inspectionLatestInspectorName,
          inspectionConcernId, inspectionConcernKind,
          inspectionConcernPerformedAt, inspectionConcernRecordedAt, inspectionConcernInspectorName,
          ...battery
        } = row;
        return {
          ...battery,
          inspectionPreview: {
            validRecords: Number(inspectionValidRecords),
            concernRecords: Number(inspectionConcernRecords),
            latest: inspectionLatestId ? {
              id: inspectionLatestId, kind: inspectionLatestKind, outcome: inspectionLatestOutcome,
              performedAt: inspectionLatestPerformedAt, recordedAt: inspectionLatestRecordedAt,
              inspectorName: inspectionLatestInspectorName,
            } : null,
            latestConcern: inspectionConcernId ? {
              id: inspectionConcernId, kind: inspectionConcernKind,
              performedAt: inspectionConcernPerformedAt, recordedAt: inspectionConcernRecordedAt,
              inspectorName: inspectionConcernInspectorName,
            } : null,
          },
          homeRoomIsPlaceholder:
            battery.homeRoomIsPlaceholder === null
              ? null
              : battery.homeRoomIsPlaceholder === 1,
          homeRoomSelectable:
            battery.homeRoomSelectable === null
              ? null
              : battery.homeRoomSelectable === 1,
        };
      }),
      people,
      buildings,
      rooms: rooms.map<Row>((room) => ({
        ...room,
        isPlaceholder: room.isPlaceholder === 1,
        selectable: room.selectable === 1,
      })),
      staffDirectory: staffDirectory.map<Row>((account) => ({
        ...account,
        active: account.active === 1,
      })),
      teachingGroups: groups.map(({ member_ids_json, ...group }) =>
        teachingGroupSchema.parse({
          ...group,
          batteryIds: JSON.parse(String(member_ids_json)),
        }),
      ),
      events: events.map(({ details_json, ...event }) => ({
        ...event,
        details: JSON.parse(String(details_json)),
      })),
      actor: this.session.actor.name,
      hardwareConnected: false,
    };
  }

  async snapshot() {
    await ensureInventoryReferenceData(this.database);
    return this.snapshotResult(
      (await this.database.raw.batch<Row>(this.snapshotStatements())).map(
        (result) => result.results,
      ),
    );
  }

  async exportData() {
    await ensureInventoryReferenceData(this.database);
    const snapshotStatements = this.snapshotStatements();
    const result = (
      await this.database.raw.batch<Row>([
        ...snapshotStatements,
        ...[
          "batteries",
          "people",
          "buildings",
          "rooms",
          "loans",
          "charges",
          "observations",
          "audit_events",
          "battery_inspections",
          "battery_inspection_voids",
        ].map((table) =>
          this.database.statement(
            `SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`,
            this.database.scope,
          ),
        ),
        this.inspectionStatement(),
      ])
    ).map((item) => item.results);
    return {
      snapshot: this.snapshotResult(result),
      raw: Object.fromEntries(
        [
          "batteries",
          "people",
          "buildings",
          "rooms",
          "loans",
          "charges",
          "observations",
          "audit_events",
          "battery_inspections",
          "battery_inspection_voids",
        ].map((name, index) => [name, result[index + snapshotStatements.length]]),
      ),
      inspections: result[snapshotStatements.length + 10] as unknown as InspectionRecord[],
    };
  }

  async fullActivity(activityScope: "all" | "mine" = "all") {
    if (activityScope !== "all" && activityScope !== "mine")
      throw new DomainError(400, "Choose all activity or your own activity.");
    const mine = activityScope === "mine";
    return (
      await this.database.rows(
        `SELECT id,action,battery_id AS batteryId,actor_id AS actorId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=?${mine ? " AND actor_id=?" : ""} ORDER BY at DESC,rowid DESC`,
        this.database.scope,
        ...(mine ? [this.session.actor.id] : []),
      )
    ).map(({ details_json, ...event }) => ({
      ...event,
      details: JSON.parse(String(details_json)),
    }));
  }

  async detail(id: string) {
    await ensureInventoryReferenceData(this.database);
    const key = this.database.key(id);
    const [batteries, loans, charges, observations, events, activeLoans, latestReturns, recentLoans, registrations, usageLoans, inspectionRows] = (
      await this.database.raw.batch<Row>([
        this.snapshotStatements(undefined, id)[0],
        this.database.statement(
          `SELECT ${loanColumns} FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 200`,
          this.database.scope,
          key,
        ),
        this.database.statement(
          "SELECT id,completed_at AS completedAt,duration_minutes AS durationMinutes,percentage,actor_name AS actorName,recorded_at AS recordedAt FROM charges WHERE scope=? AND battery_key=? ORDER BY completed_at DESC,recorded_at DESC,rowid DESC LIMIT 200",
          this.database.scope,
          key,
        ),
        this.database.statement(
          "SELECT o.id,COALESCE(o.room_name,'Room ID: ' || r.id) AS roomName,o.room_building AS roomBuilding,CASE WHEN o.room_name IS NULL THEN 'unavailable' ELSE 'recorded' END AS roomSnapshot,o.observed_at AS observedAt,o.received_at AS receivedAt,o.source FROM observations o JOIN rooms r ON r.key=o.room_key WHERE o.scope=? AND o.battery_key=? ORDER BY o.observed_at DESC,o.received_at DESC,o.rowid DESC LIMIT 200",
          this.database.scope,
          key,
        ),
        this.database.statement(
          "SELECT e.id,e.action,e.battery_id AS batteryId,e.actor_name AS actorName,e.at,e.details_json FROM audit_events e WHERE e.scope=? AND (e.battery_id=? OR (e.battery_id IS NULL AND e.action='records_imported' AND json_extract(e.details_json,'$.kind')='batteries' AND EXISTS(SELECT 1 FROM audit_events registration WHERE registration.scope=e.scope AND registration.battery_id=? AND registration.action='battery_registered' AND json_extract(registration.details_json,'$.importRequestId')=json_extract(e.details_json,'$.requestId')))) ORDER BY e.at DESC,e.rowid DESC LIMIT 200",
          this.database.scope,
          id,
          id,
        ),
        // Read movement evidence independently of the capped history, in the same D1 snapshot.
        this.database.statement(
          `SELECT ${loanColumns} FROM loans WHERE scope=? AND battery_key=? AND cancelled_at IS NULL AND returned_at IS NULL LIMIT 1`,
          this.database.scope,
          key,
        ),
        this.database.statement(
          `SELECT ${loanColumns} FROM loans WHERE scope=? AND battery_key=? AND cancelled_at IS NULL AND returned_at IS NOT NULL ORDER BY julianday(returned_at) DESC,rowid DESC LIMIT 1`,
          this.database.scope,
          key,
        ),
        this.database.statement(
          `SELECT ${loanColumns} FROM loans WHERE scope=? AND battery_key=? AND cancelled_at IS NULL ORDER BY julianday(COALESCE(returned_at,checked_out_at)) DESC,rowid DESC LIMIT 6`,
          this.database.scope,
          key,
        ),
        this.database.statement(
          "SELECT at,actor_name AS actorName FROM audit_events WHERE scope=? AND battery_id=? AND action='battery_registered' ORDER BY at,rowid LIMIT 1",
          this.database.scope,
          id,
        ),
        this.database.statement(
          "SELECT checked_out_at AS checkedOutAt,returned_at AS returnedAt,cancelled_at AS cancelledAt FROM loans WHERE scope=? AND battery_key=?",
          this.database.scope, key,
        ),
        this.inspectionStatement(id),
      ])
    ).map((result) => result.results);
    // Anchor after the snapshot so a concurrent committed movement included in
    // that read is not incorrectly classified as future-dated evidence.
    const asOf = this.session.clock();
    if (!batteries.length)
      throw new DomainError(404, "Battery not found in this inventory.");
    const battery = this.snapshotResult([batteries, [], [], [], [], []])
      .batteries[0];
    const inspections = inspectionRows as unknown as InspectionRecord[];
    const validInspections = inspections.filter((inspection) => inspection.voidedAt === null);
    return {
      battery,
      usageSummary: summarizeBatteryUsage(usageLoans, asOf),
      inspections: inspections.slice(0, 200),
      inspectionSummary: { totalRecords: inspections.length, validRecords: validInspections.length, latest: validInspections[0] ?? null },
      movementSummary: {
        activeLoan: activeLoans.find((loan) => loan.id === battery.loanId) ?? null,
        latestReturn: latestReturns[0] ?? null,
        recentLoans,
        registration: registrations[0] ?? null,
      },
      loans,
      charges,
      observations,
      events: events.map(({ details_json, ...e }) => ({
        ...e,
        details: JSON.parse(String(details_json)),
      })),
    };
  }

  async scanLookup(input: unknown): Promise<ScanLookupResult> {
    const value = scanLookupSchema.parse(input);
    if (value.source === "native_nfc" && this.session.dataset !== "demo")
      throw new DomainError(400, "Native NFC business lookup is demonstration-only until physical workflow acceptance is approved.", "native_nfc_demo_only");
    if (value.source === "simulated" && this.session.dataset !== "demo")
      throw new DomainError(
        400,
        "Simulated scans are available only in the demonstration inventory.",
      );
    const tagIds = [...new Set(value.tagIds)];
    // Lookup has no initialization, observation or movement side effects.
    const rows = (await this.snapshotStatements(tagIds)[0].all<Row>()).results;
    const batteries = this.snapshotResult([rows, [], [], [], [], []])
      .batteries as unknown as BatteryRecord[];
    return {
      source: value.source,
      results: tagIds.map((tagId) => ({
        tagId,
        battery: batteries.find((battery) => battery.tagId === tagId) ?? null,
      })),
    };
  }
}
