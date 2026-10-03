import {
  personSchema,
  buildingSchema,
  roomSchema,
  DomainError,
} from "../../domain";
import { isSupportedBuilding } from "../../location-catalog";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { ensureInventoryReferenceData } from "./provisioning";
import { editVersion } from "./records";

/** Versioned edits to people and registered storage directories. */
export class InventoryDirectories {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
  ) {}

  async savePerson(input: unknown, update = false) {
    this.session.requireAdmin();
    const p = personSchema.parse(input),
      at = this.session.clock().toISOString(),
      before = await this.database.first(
        "SELECT * FROM people WHERE scope=? AND id=?",
        this.database.scope,
        p.id,
      );
    if (update && !before) throw new DomainError(404, "Person not found.");
    if (!update && before)
      throw new DomainError(409, "That person ID is already registered.");
    const version = editVersion(before, p.expectedVersion);
    if (before?.account_id && p.role !== "staff")
      throw new DomainError(
        409,
        "A staff-account directory entry must retain its staff role.",
      );
    if (
      update &&
      p.role !== "staff" &&
      (await this.database.first(
        "SELECT id FROM batteries WHERE scope=? AND owner_key=? LIMIT 1",
        this.database.scope,
        this.database.key(p.id),
      ))
    )
      throw new DomainError(
        409,
        "This person owns registered batteries. Reassign their batteries to another staff owner before changing the role.",
      );
    const kind = update ? "person_updated" : "person_registered";
    const write = update
      ? this.database.statement(
          "UPDATE people SET name=?,reference=?,role=?,version=version+1 WHERE key=? AND scope=? AND version=?",
          p.name,
          p.reference,
          p.role,
          this.database.key(p.id),
          this.database.scope,
          p.expectedVersion,
        )
      : this.database.statement(
          "INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)",
          this.database.key(p.id),
          this.database.scope,
          p.id,
          p.name,
          p.reference,
          p.role,
        );
    return this.transactions.metadataWrite(
      "people",
      kind,
      p.id,
      p,
      before,
      version,
      at,
      [
        write,
        this.transactions.event(
          kind,
          null,
          { before, after: { ...p, version } },
          at,
        ),
      ],
    );
  }

  async saveBuilding(input: unknown, update = false) {
    this.session.requireAdmin();
    const b = buildingSchema.parse(input),
      at = this.session.clock().toISOString(),
      before = await this.database.first(
        "SELECT * FROM buildings WHERE scope=? AND id=?",
        this.database.scope,
        b.id,
      );
    if (update && !before) throw new DomainError(404, "Building not found.");
    if (!update && before)
      throw new DomainError(409, "That building code is already registered.");
    const version = editVersion(before, b.expectedVersion),
      kind = update ? "building_updated" : "building_registered";
    const write = update
      ? this.database.statement(
          "UPDATE buildings SET name=?,version=version+1 WHERE key=? AND scope=? AND version=?",
          b.name,
          this.database.key(b.id),
          this.database.scope,
          b.expectedVersion,
        )
      : this.database.statement(
          "INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)",
          this.database.key(b.id),
          this.database.scope,
          b.id,
          b.name,
        );
    return this.transactions.metadataWrite(
      "buildings",
      kind,
      b.id,
      b,
      before,
      version,
      at,
      [
        write,
        this.transactions.event(
          kind,
          null,
          { before, after: { ...b, version } },
          at,
        ),
      ],
    );
  }

  async saveRoom(input: unknown, update = false) {
    this.session.requireAdmin();
    await ensureInventoryReferenceData(this.database);
    const r = roomSchema.parse(input),
      at = this.session.clock().toISOString(),
      before = await this.database.first(
        "SELECT * FROM rooms WHERE scope=? AND id=?",
        this.database.scope,
        r.id,
      );
    if (!isSupportedBuilding(r.buildingId))
      throw new DomainError(
        400,
        "Only J18 rooms are available for the current project.",
      );
    if (update && !before) throw new DomainError(404, "Room not found.");
    if (!update && before)
      throw new DomainError(409, "That room ID is already registered.");
    const building = await this.database.first(
      "SELECT key FROM buildings WHERE scope=? AND id=?",
      this.database.scope,
      r.buildingId,
    );
    if (!building)
      throw new DomainError(
        400,
        "Select a registered building before adding a room.",
      );
    const version = editVersion(before, r.expectedVersion),
      kind = update ? "room_updated" : "room_registered";
    const isPlaceholder =
      r.isPlaceholder ?? (before ? before.is_placeholder === 1 : true);
    const saved = { ...r, isPlaceholder, selectable: true };
    const write = update
      ? this.database.statement(
          "UPDATE rooms SET name=?,building_key=?,number=?,is_placeholder=?,selectable=1,version=version+1 WHERE key=? AND scope=? AND version=?",
          r.name,
          building.key,
          r.number,
          Number(isPlaceholder),
          this.database.key(r.id),
          this.database.scope,
          r.expectedVersion,
        )
      : this.database.statement(
          "INSERT INTO rooms(key,scope,id,name,building_key,number,is_placeholder,selectable) VALUES(?,?,?,?,?,?,?,1)",
          this.database.key(r.id),
          this.database.scope,
          r.id,
          r.name,
          building.key,
          r.number,
          Number(isPlaceholder),
        );
    return this.transactions.metadataWrite(
      "rooms",
      kind,
      r.id,
      saved,
      before,
      version,
      at,
      [
        write,
        this.transactions.event(
          kind,
          null,
          { before, after: { ...saved, version } },
          at,
        ),
      ],
    );
  }
}
