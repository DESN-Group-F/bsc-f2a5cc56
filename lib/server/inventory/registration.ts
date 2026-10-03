import { batterySchema, DomainError, validateBatteryDates } from "../../domain";
import { demoBatteries } from "../../fixtures";
import { isSupportedBuilding } from "../../location-catalog";
import { modelSelectionSchema, modelFieldNames } from "../../battery-models";
import { BatteryModelStore } from "../../battery-model-store";
import { resolveReferenceModel } from "../../battery-reference-catalog";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";
import { InventoryGroups } from "./groups";
import { ensureInventoryReferenceData } from "./provisioning";
import { requireActiveBattery, editVersion } from "./records";

/** Register and edit physical assets while retaining model and directory evidence. */
export class InventoryRegistration {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
    private transactions: InventoryTransactions,
    private groups: InventoryGroups,
  ) {}

  async initializeDemo() {
    if (this.session.dataset !== "demo")
      throw new DomainError(
        400,
        "Demonstration records can only be initialized in the demo inventory.",
      );
    await ensureInventoryReferenceData(this.database);
    if (
      await this.database.first(
        "SELECT scope FROM workspaces WHERE scope=?",
        this.database.scope,
      )
    )
      return { initialized: false };
    const now = this.session.clock(),
      at = now.toISOString(),
      yesterday = new Date(now.getTime() - 86400000).toISOString();
    const writes = [
      this.database.statement(
        "INSERT INTO workspaces(scope,created_at) VALUES(?,?)",
        this.database.scope,
        at,
      ),
    ];
    const owner = await this.database.first(
      "SELECT p.key FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.account_id=? AND p.role='staff' AND a.active=1",
      this.database.scope,
      this.session.actor.id,
    );
    if (!owner)
      throw new DomainError(
        401,
        "Sign in with an active staff account before initializing the demonstration inventory.",
      );
    for (const b of demoBatteries)
      writes.push(
        this.database.statement(
          "INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          this.database.key(b.id),
          this.database.scope,
          b.id,
          b.name,
          b.chemistry,
          b.model,
          b.capacityMah,
          b.voltage,
          b.tagId,
          owner.key,
          this.database.key("J18"),
          b.homeRoomId ? this.database.key(b.homeRoomId) : null,
          at,
        ),
      );
    for (const [batteryId, durationMinutes] of [
      ["BAT-001", 60],
      ["BAT-003", 90],
      ["BAT-006", 120],
    ] as const)
      writes.push(
        this.database.statement(
          "INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)",
          crypto.randomUUID(),
          this.database.scope,
          this.database.key(batteryId),
          yesterday,
          durationMinutes,
          at,
          "demo-setup",
          "Demonstration setup",
        ),
      );
    writes.push(
      this.transactions.event(
        "demo_initialized",
        null,
        {
          note: "Fictional batteries and placeholder rooms assigned to the initializing staff account. No real RFID readings.",
          ownerAccountId: this.session.actor.id,
        },
        at,
      ),
    );
    try {
      await this.transactions.atomic(
        crypto.randomUUID(),
        "demo_initialized",
        "demo-fixtures-v1",
        { initialized: true },
        at,
        "NOT EXISTS(SELECT 1 FROM workspaces WHERE scope=?) AND EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=? AND p.scope=? AND p.account_id=? AND a.active=1)",
        [
          this.database.scope,
          owner.key,
          this.database.scope,
          this.session.actor.id,
        ],
        writes,
      );
    } catch (e) {
      if (
        !(await this.database.first(
          "SELECT scope FROM workspaces WHERE scope=?",
          this.database.scope,
        ))
      )
        throw e;
    }
    return { initialized: true };
  }

  async saveBattery(input: unknown, update = false) {
    if (update) this.session.requireAdmin();
    await ensureInventoryReferenceData(this.database);
    const { modelSelection, ...b } = batterySchema
      .extend({ modelSelection: modelSelectionSchema.optional() })
      .parse(input);
    if (update && modelSelection)
      throw new DomainError(
        400,
        "Model suggestions are used when registering new batteries. Review saved specifications directly when editing a battery.",
      );
    const at = this.session.clock().toISOString();
    validateBatteryDates(b, new Date(at));
    let modelReference: Record<string, unknown> | null = null;
    let modelGuard = "1";
    let modelGuardValues: unknown[] = [];
    if (modelSelection) {
      if (this.session.actor.authVersion === undefined)
        throw new DomainError(
          401,
          "Sign in with a staff account before using a model suggestion.",
        );
      const resolved =
        modelSelection.origin === "reference"
          ? await resolveReferenceModel(modelSelection).then(
              ({ choice, provenance }) => ({
                snapshot: { model: choice, provenance },
                guardSql: "1",
                guardValues: [] as unknown[],
              }),
            )
          : await new BatteryModelStore(
              this.database.raw,
              this.database.scope,
              this.session.dataset,
              {
                id: this.session.actor.id,
                displayName: this.session.actor.name,
                role: this.session.actor.role,
                authVersion: this.session.actor.authVersion,
              },
              this.session.clock,
            ).resolve(modelSelection);
      const suggestion = resolved.snapshot.model;
      const appliedFields = modelSelection.appliedFields.filter(
        (field) => b[field] === suggestion[field],
      );
      const overrides = modelFieldNames.filter(
        (field) => b[field] !== suggestion[field],
      );
      modelReference = {
        ...resolved.snapshot,
        confirmed: true,
        chosenFields: modelSelection.appliedFields,
        appliedFields,
        overrides,
      };
      modelGuard = resolved.guardSql;
      modelGuardValues = resolved.guardValues;
    }
    const [owner, building, room, before] = await Promise.all([
      this.database.first(
        "SELECT p.key,p.account_id,a.active AS accountActive FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.id=? AND p.role='staff'",
        this.database.scope,
        b.ownerId,
      ),
      b.homeBuildingId
        ? this.database.first(
            "SELECT key FROM buildings WHERE scope=? AND id=?",
            this.database.scope,
            b.homeBuildingId,
          )
        : null,
      b.homeRoomId
        ? this.database.first(
            "SELECT key,building_key,selectable FROM rooms WHERE scope=? AND id=?",
            this.database.scope,
            b.homeRoomId,
          )
        : null,
      this.database.first(
        "SELECT * FROM batteries WHERE scope=? AND id=?",
        this.database.scope,
        b.id,
      ),
    ]);
    const retainedOwner = update && !!owner && before?.owner_key === owner.key;
    if (update && before) requireActiveBattery(before);
    if (
      !owner ||
      (owner.accountActive !== 1 && !retainedOwner) ||
      !building ||
      !isSupportedBuilding(b.homeBuildingId)
    )
      throw new DomainError(
        400,
        "Select an active staff account as the responsible owner and J18 as the storage building. The room can stay unspecified.",
      );
    if (
      b.homeRoomId &&
      (!room || room.building_key !== building.key || room.selectable !== 1)
    )
      throw new DomainError(
        400,
        "Select an available J18 room, or leave it unspecified.",
      );
    if (update && !before) throw new DomainError(404, "Battery not found.");
    if (!update && before)
      throw new DomainError(409, "That battery ID is already registered.");
    const version = editVersion(before, b.expectedVersion),
      kind = update ? "battery_updated" : "battery_registered";
    const group = await this.groups.resolve(
      b.teachingGroup,
      [b.id],
      crypto.randomUUID(),
    );
    const values = [
      b.name,
      b.chemistry,
      b.model,
      b.capacityMah,
      b.voltage,
      b.tagId,
      owner.key,
      building?.key ?? null,
      room?.key ?? null,
      b.manufacturedOn,
      b.firstUsedOn,
    ];
    const write = update
      ? this.database.statement(
          "UPDATE batteries SET name=?,chemistry=?,model=?,capacity_mah=?,voltage=?,tag_id=?,owner_key=?,home_building_key=?,home_room_key=?,manufactured_on=?,first_used_on=?,version=version+1 WHERE key=? AND scope=? AND version=?",
          ...values,
          this.database.key(b.id),
          this.database.scope,
          b.expectedVersion,
        )
      : this.database.statement(
          "INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,manufactured_on,first_used_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          this.database.key(b.id),
          this.database.scope,
          b.id,
          ...values,
          at,
        );
    try {
      return await this.transactions.metadataWrite(
        "batteries",
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
            b.id,
            {
              before,
              after: { ...b, version },
              ...(modelReference ? { modelReference } : {}),
              ...(group ? { teachingGroup: group.evidence } : {}),
            },
            at,
          ),
        ],
        `EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=? AND p.scope=? AND p.role='staff' AND p.account_id=? AND (a.active=1 OR ?=1)) AND (? IS NULL OR EXISTS(SELECT 1 FROM rooms WHERE key=? AND scope=? AND building_key=? AND selectable=1)) AND (${modelGuard})`,
        [
          owner.key,
          this.database.scope,
          owner.account_id,
          Number(retainedOwner),
          room?.key ?? null,
          room?.key ?? null,
          this.database.scope,
          building.key,
          ...modelGuardValues,
        ],
        group,
      );
    } catch (e) {
      if (/UNIQUE/i.test(String(e)))
        throw new DomainError(
          409,
          "That battery ID or RFID identifier is already assigned.",
        );
      throw e;
    }
  }
}
