import type { StaffUser } from "./accounts";
import { currentSydneyDate } from "./battery-age";
import { BatteryModelStore } from "./battery-model-store";
import {
  canonicalModelJson,
  modelFieldNames,
  type BatteryModelChoice,
} from "./battery-models";
import { resolveReferenceModel } from "./battery-reference-catalog";
import {
  DomainError,
  recordKey,
  validateBatteryDates,
  type Dataset,
} from "./domain";
import {
  intakePayloadSchema,
  type IntakeCommon,
  type IntakePayload,
  type IntakeReceipt,
} from "./intake-session";
import { isSupportedBuilding } from "./location-catalog";
import { InventoryDatabase } from "./server/inventory/database";
import { ensureInventoryReferenceData } from "./server/inventory/provisioning";

type Row = Record<string, unknown>;
type IntakeActor = Pick<
  StaffUser,
  "id" | "displayName" | "role" | "authVersion"
>;
type ModelBinding = {
  key: string;
  id: string;
  version: number;
  model: string;
  chemistry: string;
  capacityMah: number | null;
  voltage: number | null;
};
type ModelEvidence = {
  model: BatteryModelChoice;
  provenance?: unknown;
  sourceBindings?: ModelBinding[];
  confirmed: true;
  chosenFields: string[];
  appliedFields: string[];
  overrides: string[];
};
type IntakeContext = {
  owner: { key: string; accountId: string; version: number };
  building: { key: string; version: number };
  room: { key: string; version: number; isPlaceholder: boolean } | null;
  modelReference: ModelEvidence | null;
};
type Guard = { sql: string; values: unknown[] };
const automaticIdPattern = "BAT-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]";

/** Deliberate demo scans create individual assets with atomic shared numbering. */
export class IntakeStore {
  constructor(
    private db: D1Database,
    readonly scope: string,
    readonly dataset: Dataset,
    private actor: IntakeActor,
    private clock: () => Date = () => new Date(),
  ) {}
  private key(id: string) {
    return recordKey(this.scope, id);
  }
  private statement(sql: string, ...values: unknown[]) {
    return this.db.prepare(sql).bind(...values);
  }
  private async first(sql: string, ...values: unknown[]) {
    return this.statement(sql, ...values).first<Row>();
  }
  private actorGuard(): Guard {
    return {
      sql: "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff'))",
      values: [this.actor.id, this.actor.authVersion, this.actor.role],
    };
  }
  private async requireActor() {
    const guard = this.actorGuard();
    if (
      !(await this.first(
        `SELECT 1 AS allowed WHERE ${guard.sql}`,
        ...guard.values,
      ))
    )
      throw new DomainError(
        403,
        "Your staff account access changed. Sign in again before continuing intake.",
      );
  }
  private async replay(
    requestId: string,
    fingerprint: string,
  ): Promise<IntakeReceipt | null> {
    const row = await this.first(
      "SELECT kind,fingerprint,result_json FROM operations WHERE id=? AND scope=?",
      this.key(requestId),
      this.scope,
    );
    if (!row) return null;
    await this.requireActor();
    if (
      !["simulated_intake", "simulated_intake_rejected"].includes(
        String(row.kind),
      ) ||
      row.fingerprint !== fingerprint
    )
      throw new DomainError(
        409,
        "This scan request identifier was used for a different intake or staff account.",
        "idempotency_conflict",
      );
    const result = JSON.parse(String(row.result_json));
    if (row.kind === "simulated_intake_rejected" && result.rejected === true)
      throw new DomainError(
        Number(result.status),
        String(result.error),
        "intake_rejected_final",
      );
    return { ...(result as IntakeReceipt), replayed: true };
  }
  private async reject(
    payload: IntakePayload,
    fingerprint: string,
    rejection: DomainError,
  ): Promise<IntakeReceipt> {
    const authorization = this.actorGuard();
    const result = {
      rejected: true,
      status: rejection.status,
      error: rejection.message,
      reasonCode: rejection.code ?? null,
    };
    try {
      // A terminal rejection and a delayed successful write compete for the
      // same immutable key. A rejected scan cannot create a later ghost asset.
      await this.db.batch([
        this.statement(
          `INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'simulated_intake_rejected',?,?,?,CASE WHEN (${authorization.sql}) THEN 1 ELSE 0 END`,
          this.key(payload.requestId),
          this.scope,
          fingerprint,
          JSON.stringify(result),
          this.clock().toISOString(),
          ...authorization.values,
        ),
      ]);
    } catch (error) {
      const receipt = await this.replay(payload.requestId, fingerprint);
      if (receipt) return receipt;
      await this.requireActor();
      // A failed reservation is uncertain; never expose the earlier 409 as
      // proof that a competing scan can no longer commit.
      throw error;
    }
    throw new DomainError(
      rejection.status,
      rejection.message,
      "intake_rejected_final",
    );
  }
  private async savedSession(id: string, configuration: string) {
    const row = await this.first(
      "SELECT * FROM intake_sessions WHERE scope=? AND id=?",
      this.scope,
      id,
    );
    if (!row) return null;
    if (
      row.actor_id !== this.actor.id ||
      row.configuration_json !== configuration
    )
      throw new DomainError(
        409,
        "This intake session already uses different batch details or another staff account. Start a new intake session after reviewing the batch.",
        "intake_session_conflict",
      );
    return {
      row,
      context: JSON.parse(String(row.context_json)) as IntakeContext,
    };
  }
  private async modelContext(common: IntakeCommon) {
    const selection = common.modelSelection;
    if (!selection)
      return { evidence: null, guard: { sql: "1", values: [] } as Guard };
    const resolved =
      selection.origin === "reference"
        ? await resolveReferenceModel(selection).then(
            ({ choice, provenance }) => ({
              snapshot: { model: choice, provenance },
              guardSql: "1",
              guardValues: [] as unknown[],
            }),
          )
        : await new BatteryModelStore(
            this.db,
            this.scope,
            this.dataset,
            this.actor,
            this.clock,
          ).resolve(selection);
    const evidence: ModelEvidence = {
      ...resolved.snapshot,
      confirmed: true,
      chosenFields: selection.appliedFields,
      appliedFields: selection.appliedFields.filter(
        (field) => common[field] === resolved.snapshot.model[field],
      ),
      overrides: modelFieldNames.filter(
        (field) => common[field] !== resolved.snapshot.model[field],
      ),
    };
    return {
      evidence,
      guard: { sql: resolved.guardSql, values: resolved.guardValues },
    };
  }
  private async prepareContext(common: IntakeCommon) {
    let owner = await this.first(
      "SELECT p.key,p.version,p.account_id,a.active AS accountActive FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.id=? AND p.role='staff'",
      this.scope,
      common.ownerId,
    );
    let building = common.homeBuildingId
      ? await this.first(
          "SELECT key,version FROM buildings WHERE scope=? AND id=?",
          this.scope,
          common.homeBuildingId,
        )
      : null;
    if (!owner || !building) {
      // A newly installed shared inventory may need its native account projections.
      // Normal scans use the existing directories and do not fetch the whole register.
      await ensureInventoryReferenceData(
        new InventoryDatabase(this.db, this.scope),
      );
      owner = await this.first(
        "SELECT p.key,p.version,p.account_id,a.active AS accountActive FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.id=? AND p.role='staff'",
        this.scope,
        common.ownerId,
      );
      building = common.homeBuildingId
        ? await this.first(
            "SELECT key,version FROM buildings WHERE scope=? AND id=?",
            this.scope,
            common.homeBuildingId,
          )
        : null;
    }
    if (
      !owner ||
      owner.accountActive !== 1 ||
      !building ||
      !isSupportedBuilding(common.homeBuildingId)
    )
      throw new DomainError(
        400,
        "Choose an active staff owner and J18 as the storage building. The room may remain unspecified.",
      );
    const room = common.homeRoomId
      ? await this.first(
          "SELECT key,version,building_key,selectable,is_placeholder FROM rooms WHERE scope=? AND id=?",
          this.scope,
          common.homeRoomId,
        )
      : null;
    if (
      common.homeRoomId &&
      (!room || room.building_key !== building.key || room.selectable !== 1)
    )
      throw new DomainError(
        400,
        "Choose an available J18 room, or leave the room unspecified.",
      );
    const model = await this.modelContext(common);
    const context: IntakeContext = {
      owner: {
        key: String(owner.key),
        accountId: String(owner.account_id),
        version: Number(owner.version),
      },
      building: {
        key: String(building.key),
        version: Number(building.version),
      },
      room: room
        ? {
            key: String(room.key),
            version: Number(room.version),
            isPlaceholder: room.is_placeholder === 1,
          }
        : null,
      modelReference: model.evidence,
    };
    return { context, modelGuard: model.guard };
  }
  private directoryGuard(context: IntakeContext): Guard {
    return {
      sql: "EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.key=? AND p.version=? AND p.account_id=? AND p.role='staff' AND a.active=1) AND EXISTS(SELECT 1 FROM buildings WHERE scope=? AND key=? AND id='J18' AND version=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM rooms WHERE scope=? AND key=? AND version=? AND building_key=? AND selectable=1))",
      values: [
        this.scope,
        context.owner.key,
        context.owner.version,
        context.owner.accountId,
        this.scope,
        context.building.key,
        context.building.version,
        context.room?.key ?? null,
        this.scope,
        context.room?.key ?? null,
        context.room?.version ?? null,
        context.building.key,
      ],
    };
  }
  private async frozenModelGuard(
    payload: IntakePayload,
    context: IntakeContext,
  ): Promise<Guard> {
    const evidence = context.modelReference;
    if (!evidence) return { sql: "1", values: [] };
    if (evidence.model.origin === "reference") {
      if (!payload.common.modelSelection)
        throw new DomainError(
          409,
          "Review the model before continuing this intake session.",
          "model_conflict",
        );
      await resolveReferenceModel(payload.common.modelSelection);
      return { sql: "1", values: [] };
    }
    if (evidence.model.origin === "saved")
      return {
        sql: "EXISTS(SELECT 1 FROM battery_models WHERE scope=? AND id=? AND version=?)",
        values: [this.scope, evidence.model.id, evidence.model.version],
      };
    const bindings = evidence.sourceBindings;
    if (!bindings?.length)
      throw new DomainError(
        409,
        "The intake model's original source records are unavailable. Exit intake and review the model again.",
        "model_conflict",
      );
    // Earlier successful scans in this session are new assets, not replacements
    // for the source records reviewed when the batch was configured.
    return {
      sql: "NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM batteries b WHERE b.scope=? AND b.lifecycle_status='active' AND b.key=json_extract(j.value,'$.key') AND b.id=json_extract(j.value,'$.id') AND b.version=json_extract(j.value,'$.version') AND b.model=json_extract(j.value,'$.model') AND b.chemistry=json_extract(j.value,'$.chemistry') AND b.capacity_mah IS json_extract(j.value,'$.capacityMah') AND b.voltage IS json_extract(j.value,'$.voltage')))",
      values: [JSON.stringify(bindings), this.scope],
    };
  }
  private async allowed(guard: Guard) {
    return (
      (await this.first(`SELECT (${guard.sql}) AS allowed`, ...guard.values))
        ?.allowed === 1
    );
  }
  async register(input: unknown): Promise<IntakeReceipt> {
    await this.requireActor();
    if (this.dataset !== "demo")
      throw new DomainError(
        501,
        "Simulated first-time intake is available only in Demonstration inventory. Real RFID intake requires validated hardware.",
      );
    const payload = intakePayloadSchema.parse(input),
      fingerprint = canonicalModelJson({
        actorAccountId: this.actor.id,
        payload,
      });
    try {
      return await this.registerReviewed(payload, fingerprint);
    } catch (error) {
      if (
        error instanceof DomainError &&
        [400, 404, 409].includes(error.status) &&
        !["idempotency_conflict", "intake_rejected_final"].includes(
          error.code ?? "",
        )
      )
        return this.reject(payload, fingerprint, error);
      throw error;
    }
  }
  private async registerReviewed(
    payload: IntakePayload,
    fingerprint: string,
  ): Promise<IntakeReceipt> {
    const previous = await this.replay(payload.requestId, fingerprint);
    if (previous) return previous;
    if (
      await this.first(
        "SELECT id FROM batteries WHERE scope=? AND tag_id=?",
        this.scope,
        payload.tagId,
      )
    )
      throw new DomainError(
        409,
        "This tag already belongs to a registered battery. Use Scan return for an existing battery; intake only registers new batteries.",
        "intake_tag_registered",
      );
    const configuration = canonicalModelJson({
      actorAccountId: this.actor.id,
      common: payload.common,
      firstUseMode: payload.firstUseMode,
    });
    let session = await this.savedSession(payload.sessionId, configuration);
    let prepared = session
      ? {
          context: session.context,
          modelGuard: await this.frozenModelGuard(payload, session.context),
        }
      : await this.prepareContext(payload.common);
    for (let attempt = 0; attempt < 16; attempt++) {
      const counter = await this.first(
        "SELECT last_number FROM intake_counters WHERE scope=?",
        this.scope,
      );
      const highest = await this.first(
        "SELECT id FROM batteries WHERE scope=? AND id GLOB ? ORDER BY id DESC LIMIT 1",
        this.scope,
        automaticIdPattern,
      );
      const priorNumber = counter ? Number(counter.last_number) : 0,
        nextNumber =
          Math.max(
            priorNumber,
            highest ? Number(String(highest.id).slice(4)) : 0,
          ) + 1;
      if (nextNumber > 99999999)
        throw new DomainError(
          409,
          "The automatic battery number range is exhausted. No new battery was registered.",
          "intake_number_exhausted",
        );
      const batteryId = `BAT-${String(nextNumber).padStart(8, "0")}`,
        registeredAt = this.clock().toISOString();
      const firstUsedOn =
        payload.firstUseMode === "at_registration"
          ? currentSydneyDate(new Date(registeredAt))
          : payload.firstUseMode === "date"
            ? payload.common.firstUsedOn
            : null;
      validateBatteryDates(
        { manufacturedOn: payload.common.manufacturedOn, firstUsedOn },
        new Date(registeredAt),
      );
      const common = payload.common,
        context = prepared.context,
        authorization = this.actorGuard(),
        directories = this.directoryGuard(context);
      const counterGuard = counter
        ? "EXISTS(SELECT 1 FROM intake_counters WHERE scope=? AND last_number=?)"
        : "NOT EXISTS(SELECT 1 FROM intake_counters WHERE scope=?)";
      const counterValues = counter ? [this.scope, priorNumber] : [this.scope];
      const sessionGuard = session
        ? "EXISTS(SELECT 1 FROM intake_sessions WHERE scope=? AND id=? AND actor_id=? AND configuration_json=?)"
        : "NOT EXISTS(SELECT 1 FROM intake_sessions WHERE scope=? AND id=?)";
      const sessionValues = session
        ? [this.scope, payload.sessionId, this.actor.id, configuration]
        : [this.scope, payload.sessionId];
      const result: IntakeReceipt = {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        dataset: this.dataset,
        actorAccountId: this.actor.id,
        batteryId,
        tagId: payload.tagId,
        registeredAt,
        ...(payload.scannedAt ? { scannedAt: payload.scannedAt } : {}),
        source: "simulated_intake",
        replayed: false,
        name: common.name,
        model: common.model,
        chemistry: common.chemistry,
        capacityMah: common.capacityMah,
        voltage: common.voltage,
        ownerId: common.ownerId,
        homeBuildingId: common.homeBuildingId,
        homeRoomId: common.homeRoomId,
        manufacturedOn: common.manufacturedOn,
        firstUsedOn,
      };
      const after = {
        id: batteryId,
        ...common,
        tagId: payload.tagId,
        firstUsedOn,
        registeredAt,
        version: 1,
      };
      const guardSql = `(${authorization.sql}) AND (${directories.sql}) AND (${prepared.modelGuard.sql}) AND (${counterGuard}) AND (${sessionGuard}) AND NOT EXISTS(SELECT 1 FROM batteries WHERE scope=? AND (id=? OR tag_id=?))`;
      const guardValues = [
        ...authorization.values,
        ...directories.values,
        ...prepared.modelGuard.values,
        ...counterValues,
        ...sessionValues,
        this.scope,
        batteryId,
        payload.tagId,
      ];
      const writes = [
        this.statement(
          `INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'simulated_intake',?,?,?,CASE WHEN (${guardSql}) THEN 1 ELSE 0 END`,
          this.key(payload.requestId),
          this.scope,
          fingerprint,
          JSON.stringify(result),
          registeredAt,
          ...guardValues,
        ),
        counter
          ? this.statement(
              "UPDATE intake_counters SET last_number=? WHERE scope=? AND last_number=?",
              nextNumber,
              this.scope,
              priorNumber,
            )
          : this.statement(
              "INSERT INTO intake_counters(scope,last_number) VALUES(?,?)",
              this.scope,
              nextNumber,
            ),
        ...(!session
          ? [
              this.statement(
                "INSERT INTO intake_sessions(key,scope,id,actor_id,actor_name,configuration_json,context_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
                this.key(payload.sessionId),
                this.scope,
                payload.sessionId,
                this.actor.id,
                this.actor.displayName,
                configuration,
                JSON.stringify(context),
                registeredAt,
              ),
            ]
          : []),
        this.statement(
          "INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,manufactured_on,first_used_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          this.key(batteryId),
          this.scope,
          batteryId,
          common.name,
          common.chemistry,
          common.model,
          common.capacityMah,
          common.voltage,
          payload.tagId,
          context.owner.key,
          context.building.key,
          context.room?.key ?? null,
          common.manufacturedOn,
          firstUsedOn,
          registeredAt,
        ),
        this.statement(
          "INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?, ?,?,?,?,?)",
          crypto.randomUUID(),
          this.scope,
          "battery_registered",
          batteryId,
          this.actor.id,
          this.actor.displayName,
          registeredAt,
          JSON.stringify({
            before: null,
            after,
            source: "simulated_intake",
            ...(payload.scannedAt
              ? {
                  scannedAt: payload.scannedAt,
                  scanTimeSource: "client_demo_draft",
                }
              : {}),
            sessionId: payload.sessionId,
            requestId: payload.requestId,
            firstUseMode: payload.firstUseMode,
            ...(context.modelReference
              ? { modelReference: context.modelReference }
              : {}),
          }),
        ),
      ];
      try {
        await this.db.batch(writes);
        return result;
      } catch (error) {
        const receipt = await this.replay(payload.requestId, fingerprint);
        if (receipt) return receipt;
        await this.requireActor();
        if (
          await this.first(
            "SELECT id FROM batteries WHERE scope=? AND tag_id=?",
            this.scope,
            payload.tagId,
          )
        )
          throw new DomainError(
            409,
            "This tag already belongs to a registered battery. Use Scan return for an existing battery.",
            "intake_tag_registered",
          );
        const committedSession = await this.savedSession(
          payload.sessionId,
          configuration,
        );
        let adoptedSession = false;
        if (!session && committedSession) {
          session = committedSession;
          prepared = {
            context: session.context,
            modelGuard: await this.frozenModelGuard(payload, session.context),
          };
          adoptedSession = true;
        }
        if (!(await this.allowed(this.directoryGuard(prepared.context))))
          throw new DomainError(
            409,
            "The batch owner or storage records changed. No battery was registered. Exit intake and review the batch details.",
            "intake_context_conflict",
          );
        if (!(await this.allowed(prepared.modelGuard)))
          throw new DomainError(
            409,
            "The model or its original source records changed. No battery was registered. Exit intake and review the model again.",
            "model_conflict",
          );
        if (
          !/constraint|unique|check|foreign key|replacement/i.test(
            String(error),
          )
        )
          throw error;
        const changedCounter = await this.first(
          "SELECT last_number FROM intake_counters WHERE scope=?",
          this.scope,
        );
        const idUsed = await this.first(
          "SELECT id FROM batteries WHERE scope=? AND id=?",
          this.scope,
          batteryId,
        );
        if (
          adoptedSession ||
          Number(changedCounter?.last_number ?? 0) !== priorNumber ||
          idUsed
        )
          continue;
        throw new DomainError(
          409,
          "The intake records changed. No battery was registered. Exit intake and review the batch details.",
          "intake_context_conflict",
        );
      }
    }
    throw new DomainError(
      503,
      "Other staff are registering batteries at the same time. Retry this preserved scan request; its identifier and batch details have been retained.",
      "intake_busy",
    );
  }
}
