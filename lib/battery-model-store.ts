import type { StaffUser } from "./accounts";
import { DomainError, recordKey, type Dataset } from "./domain";
import { canonicalModelJson, modelChoiceContentHash, modelSelectionSchema, newBatteryModelSchema, updateBatteryModelSchema, type BatteryModelChoice, type ModelSelection, type NewBatteryModel } from "./battery-models";

type Row = Record<string, unknown>;
type ModelActor = Pick<StaffUser, "id" | "displayName" | "role" | "authVersion">;
type InventoryBinding = { key: string; id: string; version: number; model: string; chemistry: string; capacityMah: number | null; voltage: number | null };
export type BatteryModelIssue = { model: string; message: string };
export type ModelResolution = { snapshot: { model: BatteryModelChoice; appliedFields: ModelSelection["appliedFields"]; sourceBindings?: InventoryBinding[] }; guardSql: string; guardValues: unknown[] };
export type ModelCreateResult = { model: BatteryModelChoice; requestId: string; actorAccountId: string; dataset: Dataset; replayed: boolean };

function identityKey(input: Pick<NewBatteryModel, "brand" | "model" | "variant">) {
    return canonicalModelJson([input.brand, input.model, input.variant].map(value => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()));
}
function label(parts: string[]) { return parts.filter(Boolean).join(" · "); }

/** Reusable specifications are separate from physical asset identity and custody. */
export class BatteryModelStore {
    constructor(private db: D1Database, readonly scope: string, readonly dataset: Dataset, private actor: ModelActor, private clock: () => Date = () => new Date()) {}
    private key(id: string) { return recordKey(this.scope, id); }
    private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
    private async first(sql: string, ...values: unknown[]) { return this.statement(sql, ...values).first<Row>(); }
    private actorGuard() { return { sql: "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff'))", values: [this.actor.id, this.actor.authVersion, this.actor.role] }; }
    private async requireActor() {
        const guard = this.actorGuard();
        if (!await this.first(`SELECT 1 AS allowed WHERE ${guard.sql}`, ...guard.values)) throw new DomainError(403, "Your staff account access changed. Sign in again.");
    }
    private requireAdmin() { if (this.actor.role !== "admin") throw new DomainError(403, "Only administrators can edit saved battery models."); }
    private async savedChoice(row: Row): Promise<BatteryModelChoice> {
        const choice: Omit<BatteryModelChoice, "contentHash"> = {
            id: String(row.id), origin: "saved", label: label([String(row.brand), String(row.model), String(row.variant)]), brand: String(row.brand), model: String(row.model), variant: String(row.variant),
            name: String(row.name), chemistry: String(row.chemistry), capacityMah: row.capacity_mah === null ? null : Number(row.capacity_mah), voltage: row.voltage === null ? null : Number(row.voltage),
            capacityBasis: row.capacity_mah === null ? null : "Staff-recorded capacity in mAh", verificationStatus: "staff_entered", notes: String(row.notes),
            warnings: ["Staff-entered specifications. Confirm the model and variant against this physical battery before registration."], sources: [], createdAt: String(row.created_at), actorName: String(row.actor_name), version: Number(row.version),
        };
        return { ...choice, contentHash: await modelChoiceContentHash(choice) };
    }
    private async inventoryCandidates() {
        const rows = (await this.statement("SELECT key,id,version,model,chemistry,capacity_mah,voltage FROM batteries WHERE scope=? AND lifecycle_status='active' AND model<>'' ORDER BY id", this.scope).all<Row>()).results;
        const groups = new Map<string, InventoryBinding[]>(), issues: BatteryModelIssue[] = [], candidates: { model: BatteryModelChoice; bindings: InventoryBinding[] }[] = [];
        for (const row of rows) {
            const model = String(row.model);
            if (!model.trim()) continue;
            // Model codes remain exact: no brand, alias or variant is inferred from an asset label.
            if (model !== model.trim() || model.length > 120) { issues.push({ model, message: "This registered model label must be corrected before it can be reused." }); continue; }
            const bindings = groups.get(model) ?? [];
            bindings.push({ key: String(row.key), id: String(row.id), version: Number(row.version), model, chemistry: String(row.chemistry), capacityMah: row.capacity_mah === null ? null : Number(row.capacity_mah), voltage: row.voltage === null ? null : Number(row.voltage) });
            groups.set(model, bindings);
        }
        for (const [model, bindings] of groups) {
            const first = bindings[0];
            if (bindings.some(binding => binding.chemistry !== first.chemistry || binding.capacityMah !== first.capacityMah || binding.voltage !== first.voltage)) {
                issues.push({ model, message: "Registered batteries with this model have different specifications. Add a named model variant or review the records before automatic filling." });
                continue;
            }
            const choice: Omit<BatteryModelChoice, "contentHash"> = {
                id: model, origin: "inventory", label: model, brand: "", variant: "", name: model.length >= 2 ? model : `${model} battery`, model,
                chemistry: first.chemistry, capacityMah: first.capacityMah, voltage: first.voltage, capacityBasis: first.capacityMah === null ? null : "Capacity recorded on registered batteries", verificationStatus: "registered_asset_values",
                notes: `Matching specifications from ${bindings.length} registered ${bindings.length === 1 ? "battery" : "batteries"}. No manufacturer verification is implied.`, warnings: ["Reused from registered battery records. Confirm the physical model and specifications before registration."], sources: [],
            };
            const hashInput = { ...choice, inventoryBindings: bindings };
            candidates.push({ model: { ...choice, contentHash: await modelChoiceContentHash(hashInput) }, bindings });
        }
        return { candidates, issues };
    }
    async list() {
        await this.requireActor();
        const results = await this.db.batch<Row>([this.statement("SELECT * FROM battery_models WHERE scope=? ORDER BY brand,model,variant,id", this.scope)]);
        const saved = await Promise.all(results[0].results.map(row => this.savedChoice(row))), inventory = await this.inventoryCandidates();
        return { dataset: this.dataset, models: [...saved, ...inventory.candidates.map(candidate => candidate.model)], issues: inventory.issues };
    }
    private async replay(id: string, fingerprint: string, kind = "battery_model_registered"): Promise<ModelCreateResult | null> {
        const operation = await this.first("SELECT kind,fingerprint,result_json FROM operations WHERE id=? AND scope=?", this.key(id), this.scope);
        if (!operation) return null;
        await this.requireActor();
        if (operation.kind !== kind || operation.fingerprint !== fingerprint) throw new DomainError(409, "This model draft identifier was already used for different changes or by another staff account.", "idempotency_conflict");
        return { ...JSON.parse(String(operation.result_json)) as ModelCreateResult, replayed: true };
    }
    async create(input: unknown): Promise<ModelCreateResult> {
        await this.requireActor();
        const model = newBatteryModelSchema.parse(input), fingerprint = canonicalModelJson({ actorAccountId: this.actor.id, model });
        const previous = await this.replay(model.id, fingerprint);
        if (previous) return previous;
        const at = this.clock().toISOString(), identity = identityKey(model), authorization = this.actorGuard();
        const row: Row = { ...model, capacity_mah: model.capacityMah, created_at: at, actor_name: this.actor.displayName, version: 1 };
        const choice = await this.savedChoice(row), result: ModelCreateResult = { model: choice, requestId: model.id, actorAccountId: this.actor.id, dataset: this.dataset, replayed: false };
        const guard = "NOT EXISTS(SELECT 1 FROM battery_models WHERE scope=? AND (id=? OR identity_key=?))";
        try {
            await this.db.batch([
                this.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'battery_model_registered',?,?,?,CASE WHEN (${guard}) AND (${authorization.sql}) THEN 1 ELSE 0 END`, this.key(model.id), this.scope, fingerprint, JSON.stringify(result), at, this.scope, model.id, identity, ...authorization.values),
                this.statement("INSERT INTO battery_models(key,scope,id,identity_key,brand,model,variant,name,chemistry,capacity_mah,voltage,notes,created_at,created_by,actor_name,updated_at,updated_by,updated_actor_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(model.id), this.scope, model.id, identity, model.brand, model.model, model.variant, model.name, model.chemistry, model.capacityMah, model.voltage, model.notes, at, this.actor.id, this.actor.displayName, at, this.actor.id, this.actor.displayName),
                this.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,NULL,?,?,?,?)", crypto.randomUUID(), this.scope, "battery_model_registered", this.actor.id, this.actor.displayName, at, JSON.stringify({ model: choice, requestId: model.id, dataOrigin: "staff_entered" })),
            ]);
            return result;
        } catch (error) {
            const receipt = await this.replay(model.id, fingerprint);
            if (receipt) return receipt;
            await this.requireActor();
            if (await this.first("SELECT id FROM battery_models WHERE scope=? AND identity_key=?", this.scope, identity)) throw new DomainError(409, "This brand, model and variant are already saved. Select the existing model, or enter a different variant.", "model_duplicate");
            if (await this.first("SELECT id FROM battery_models WHERE scope=? AND id=?", this.scope, model.id)) throw new DomainError(409, "This model draft identifier is already saved with different details.", "idempotency_conflict");
            if (/constraint|unique|check|foreign key|replacement/i.test(String(error))) throw new DomainError(409, "The model or your account access changed. No new model was saved. Reload and review the records.", "model_conflict");
            throw error;
        }
    }
    async update(input: unknown): Promise<ModelCreateResult> {
        this.requireAdmin();
        await this.requireActor();
        const model = updateBatteryModelSchema.parse(input), kind = "battery_model_updated", fingerprint = canonicalModelJson({ actorAccountId: this.actor.id, model, action: "update" });
        const previous = await this.replay(model.requestId, fingerprint, kind);
        if (previous) return previous;
        const before = await this.first("SELECT * FROM battery_models WHERE scope=? AND id=?", this.scope, model.id);
        if (!before) throw new DomainError(404, "Saved battery model not found in this inventory.");
        if (Number(before.version) !== model.expectedVersion) throw new DomainError(409, "This saved model changed. Load and review the latest model before saving your edits.", "model_conflict");
        const at = this.clock().toISOString(), version = model.expectedVersion + 1, identity = identityKey(model), authorization = this.actorGuard();
        const after = { ...before, ...model, capacity_mah: model.capacityMah, version }, choice = await this.savedChoice(after), beforeChoice = await this.savedChoice(before);
        const result: ModelCreateResult = { model: choice, requestId: model.requestId, actorAccountId: this.actor.id, dataset: this.dataset, replayed: false };
        const guard = "EXISTS(SELECT 1 FROM battery_models WHERE scope=? AND id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM battery_models WHERE scope=? AND identity_key=? AND id<>?)";
        try {
            await this.db.batch([
                this.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN (${guard}) AND (${authorization.sql}) THEN 1 ELSE 0 END`, this.key(model.requestId), this.scope, kind, fingerprint, JSON.stringify(result), at, this.scope, model.id, model.expectedVersion, this.scope, identity, model.id, ...authorization.values),
                this.statement("UPDATE battery_models SET identity_key=?,brand=?,model=?,variant=?,name=?,chemistry=?,capacity_mah=?,voltage=?,notes=?,version=?,updated_at=?,updated_by=?,updated_actor_name=? WHERE scope=? AND id=? AND version=?", identity, model.brand, model.model, model.variant, model.name, model.chemistry, model.capacityMah, model.voltage, model.notes, version, at, this.actor.id, this.actor.displayName, this.scope, model.id, model.expectedVersion),
                this.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,NULL,?,?,?,?)", crypto.randomUUID(), this.scope, kind, this.actor.id, this.actor.displayName, at, JSON.stringify({ before: beforeChoice, after: choice, requestId: model.requestId, dataOrigin: "staff_entered" })),
            ]);
            return result;
        } catch (error) {
            const receipt = await this.replay(model.requestId, fingerprint, kind);
            if (receipt) return receipt;
            await this.requireActor();
            if (await this.first("SELECT id FROM battery_models WHERE scope=? AND identity_key=? AND id<>?", this.scope, identity, model.id)) throw new DomainError(409, "This brand, model and variant are already saved on another model. Choose a different variant.", "model_duplicate");
            if (/constraint|unique|check|foreign key|immutable|version/i.test(String(error))) throw new DomainError(409, "This model changed while saving. No edits were saved. Reload and review the latest model.", "model_conflict");
            throw error;
        }
    }
    async resolve(input: ModelSelection): Promise<ModelResolution> {
        await this.requireActor();
        const selection = modelSelectionSchema.parse(input);
        if (selection.origin === "saved") {
            const row = await this.first("SELECT * FROM battery_models WHERE scope=? AND id=?", this.scope, selection.id);
            if (!row) throw new DomainError(409, "This saved model is no longer available in this inventory. Select the model again.", "model_conflict");
            const model = await this.savedChoice(row);
            if (model.contentHash !== selection.contentHash) throw new DomainError(409, "The selected model details changed. Reload and review them before registration.", "model_conflict");
            return { snapshot: { model, appliedFields: selection.appliedFields }, guardSql: "EXISTS(SELECT 1 FROM battery_models WHERE scope=? AND id=? AND key=? AND version=?)", guardValues: [this.scope, selection.id, row.key, row.version] };
        }
        if (selection.origin !== "inventory") throw new DomainError(400, "Reference models must be resolved against the published catalog.");
        const { candidates } = await this.inventoryCandidates(), candidate = candidates.find(item => item.model.id === selection.id);
        if (!candidate || candidate.model.contentHash !== selection.contentHash) throw new DomainError(409, "Registered model records changed or disagree. Reload and review the model before registration.", "model_conflict");
        const bindingsJson = JSON.stringify(candidate.bindings);
        return {
            snapshot: { model: candidate.model, appliedFields: selection.appliedFields, sourceBindings: candidate.bindings },
            guardSql: "(SELECT COUNT(*) FROM batteries WHERE scope=? AND lifecycle_status='active' AND model=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM batteries b WHERE b.scope=? AND b.lifecycle_status='active' AND b.key=json_extract(j.value,'$.key') AND b.id=json_extract(j.value,'$.id') AND b.version=json_extract(j.value,'$.version') AND b.model=json_extract(j.value,'$.model') AND b.chemistry=json_extract(j.value,'$.chemistry') AND b.capacity_mah IS json_extract(j.value,'$.capacityMah') AND b.voltage IS json_extract(j.value,'$.voltage')))",
            guardValues: [this.scope, selection.id, candidate.bindings.length, bindingsJson, this.scope],
        };
    }
}
