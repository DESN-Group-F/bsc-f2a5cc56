import {
  batterySchema,
  personSchema,
  buildingSchema,
  roomSchema,
  DomainError,
  validateBatteryDates,
} from "../../domain";
import { isSupportedBuilding } from "../../location-catalog";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { ensureInventoryReferenceData } from "./provisioning";

/** Atomic directory or battery imports with complete attributed evidence. */
export class InventoryImports {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
  ) {}

  async importRecords(kind: string, records: unknown[]) {
    if (kind !== "batteries") this.session.requireAdmin();
    if (!Array.isArray(records) || !records.length || records.length > 200)
      throw new DomainError(400, "Import between 1 and 200 records at a time.");
    const at = this.session.clock().toISOString(),
      requestId = crypto.randomUUID(),
      writes: D1PreparedStatement[] = [],
      batteryIds: string[] = [];
    let guard = "1",
      guardValues: unknown[] = [];
    if (kind === "batteries" || kind === "rooms")
      await ensureInventoryReferenceData(this.database);
    if (kind === "people")
      for (const raw of records) {
        const p = personSchema.parse(raw);
        writes.push(
          this.database.statement(
            "INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)",
            this.database.key(p.id),
            this.database.scope,
            p.id,
            p.name,
            p.reference,
            p.role,
          ),
        );
      }
    else if (kind === "buildings")
      for (const raw of records) {
        const b = buildingSchema.parse(raw);
        writes.push(
          this.database.statement(
            "INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)",
            this.database.key(b.id),
            this.database.scope,
            b.id,
            b.name,
          ),
        );
      }
    else if (kind === "rooms")
      for (const raw of records) {
        const r = roomSchema.parse(raw);
        if (!isSupportedBuilding(r.buildingId))
          throw new DomainError(
            400,
            `${r.id}: only J18 rooms are available for the current project.`,
          );
        if (
          !(await this.database.first(
            "SELECT key FROM buildings WHERE scope=? AND id=?",
            this.database.scope,
            r.buildingId,
          ))
        )
          throw new DomainError(400, `${r.id}: register its building first.`);
        writes.push(
          this.database.statement(
            "INSERT INTO rooms(key,scope,id,name,building_key,number,is_placeholder,selectable) VALUES(?,?,?,?,?,?,?,1)",
            this.database.key(r.id),
            this.database.scope,
            r.id,
            r.name,
            this.database.key(r.buildingId),
            r.number,
            Number(r.isPlaceholder ?? true),
          ),
        );
      }
    else if (kind === "batteries") {
      const people = await this.database.rows(
          "SELECT p.id,p.key FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.role='staff' AND a.active=1",
          this.database.scope,
        ),
        buildings = await this.database.rows(
          "SELECT key,id FROM buildings WHERE scope=?",
          this.database.scope,
        ),
        rooms = await this.database.rows(
          "SELECT id,key,building_key,selectable FROM rooms WHERE scope=?",
          this.database.scope,
        );
      const ownerKeys = new Set<string>(),
        roomKeys = new Set<string>();
      for (const raw of records) {
        const b = batterySchema.parse(raw);
        validateBatteryDates(b, new Date(at));
        const building = buildings.find((x) => x.id === b.homeBuildingId);
        const owner = people.find((p) => p.id === b.ownerId),
          room = b.homeRoomId
            ? rooms.find(
                (r) =>
                  r.id === b.homeRoomId &&
                  r.building_key === building?.key &&
                  r.selectable === 1,
              )
            : null;
        if (
          !owner ||
          !building ||
          !isSupportedBuilding(b.homeBuildingId) ||
          (b.homeRoomId && !room)
        )
          throw new DomainError(
            400,
            `${b.id}: select an active staff account as its responsible owner, J18, and an available room or leave it unspecified.`,
          );
        ownerKeys.add(String(owner.key));
        if (room) roomKeys.add(String(room.key));
        writes.push(
          this.database.statement(
            "INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,manufactured_on,first_used_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            this.database.key(b.id),
            this.database.scope,
            b.id,
            b.name,
            b.chemistry,
            b.model,
            b.capacityMah,
            b.voltage,
            b.tagId,
            this.database.key(b.ownerId),
            this.database.key(b.homeBuildingId!),
            b.homeRoomId ? this.database.key(b.homeRoomId) : null,
            b.manufacturedOn,
            b.firstUsedOn,
            at,
          ),
        );
        batteryIds.push(b.id);
        writes.push(
          this.transactions.event(
            "battery_registered",
            b.id,
            {
              before: null,
              after: { ...b, version: 1 },
              registrationSource: "csv",
              importRequestId: requestId,
            },
            at,
          ),
        );
      }
      guard =
        "(SELECT COUNT(*) FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.role='staff' AND a.active=1 AND p.key IN (SELECT value FROM json_each(?)))=? AND (SELECT COUNT(*) FROM rooms WHERE scope=? AND selectable=1 AND building_key=? AND key IN (SELECT value FROM json_each(?)))=?";
      guardValues = [
        this.database.scope,
        JSON.stringify([...ownerKeys]),
        ownerKeys.size,
        this.database.scope,
        this.database.key("J18"),
        JSON.stringify([...roomKeys]),
        roomKeys.size,
      ];
    } else
      throw new DomainError(
        400,
        "Choose people, buildings, rooms or batteries for import.",
      );
    writes.push(
      this.transactions.event(
        "records_imported",
        null,
        {
          kind,
          count: records.length,
          requestId,
          ...(kind === "batteries" ? { batteryIds } : {}),
        },
        at,
      ),
    );
    try {
      return await this.transactions.atomic(
        requestId,
        "records_imported",
        JSON.stringify({ kind, records }),
        { kind, count: records.length, requestId },
        at,
        guard,
        guardValues,
        writes,
        "Your account access or a related record changed. No rows were imported.",
      );
    } catch (e) {
      if (/constraint|UNIQUE/i.test(String(e)))
        throw new DomainError(
          409,
          "An ID, room number or RFID identifier conflicts with existing records, or a related record changed. No rows were imported.",
        );
      throw e;
    }
  }
}
