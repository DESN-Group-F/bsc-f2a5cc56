import { DomainError, type Dataset } from "./domain";
import type { Actor } from "./store";
import { teachingGroupRequestSchema, teachingGroupSchema, type TeachingGroup, type TeachingGroupReceipt } from "./teaching-groups";

type Row = Record<string, unknown>;
export class TeachingGroupStore {
    constructor(private db: D1Database, readonly scope: string, readonly dataset: Dataset, private actor: Actor, private clock: () => Date = () => new Date()) {}
    private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
    private key(id: string) { return `${this.scope}/${this.actor.id}/${id}`; }
    private async authorize() {
        if (this.actor.authVersion === undefined || !await this.statement("SELECT id FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')", this.actor.id, this.actor.authVersion, this.actor.role).first())
            throw new DomainError(403, "Your account access changed. Sign in again before managing your teaching groups.");
    }
    private group(row: Row): TeachingGroup {
        return teachingGroupSchema.parse({ id: row.id, name: row.name, notes: row.notes, batteryIds: JSON.parse(String(row.member_ids_json)), version: row.version, state: row.state, ownerAccountId: row.owner_account_id, createdAt: row.created_at, updatedAt: row.updated_at });
    }
    async list() {
        await this.authorize();
        const rows = (await this.statement("SELECT * FROM teaching_groups WHERE scope=? AND owner_account_id=? AND state='active' ORDER BY name COLLATE NOCASE,id", this.scope, this.actor.id).all<Row>()).results;
        return rows.map(row => this.group(row));
    }
    private async replay(requestId: string, fingerprint: string): Promise<TeachingGroupReceipt | null> {
        const row = await this.statement("SELECT * FROM teaching_group_operations WHERE key=? AND scope=? AND owner_account_id=?", this.key(requestId), this.scope, this.actor.id).first<Row>();
        if (!row) return null;
        if (row.fingerprint !== fingerprint) throw new DomainError(409, "This group request identifier already belongs to different changes.", "idempotency_conflict");
        const result = JSON.parse(String(row.result_json));
        if (row.outcome === "rejected") throw new DomainError(result.status, result.error, "teaching_group_rejected_final");
        return { ...result, replayed: true };
    }
    async save(input: unknown): Promise<TeachingGroupReceipt> {
        await this.authorize();
        const payload = teachingGroupRequestSchema.parse(input), fingerprint = JSON.stringify({ accountId: this.actor.id, dataset: this.dataset, payload });
        const replayed = await this.replay(payload.requestId, fingerprint);
        if (replayed) return replayed;
        const at = this.clock().toISOString(), auth = [this.actor.id, this.actor.authVersion, this.actor.role];
        const accountGuard = "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)";
        try {
            const before = await this.statement("SELECT * FROM teaching_groups WHERE scope=? AND owner_account_id=? AND id=?", this.scope, this.actor.id, payload.id).first<Row>();
            if (payload.action === "create" ? !!before : !before || before.state !== "active") throw new DomainError(payload.action === "create" ? 409 : 404, "This teaching group is unavailable or already saved. Refresh your groups and review the draft.");
            if (payload.action !== "create" && before!.version !== payload.expectedVersion) throw new DomainError(409, "This teaching group changed. Your draft is preserved; reopen the latest group before editing it.");
            const group: TeachingGroup = payload.action === "remove" ? { ...this.group(before!), version: payload.expectedVersion + 1, state: "archived", updatedAt: at } : { id: payload.id, name: payload.name, notes: payload.notes, batteryIds: payload.batteryIds, version: payload.action === "create" ? 1 : payload.expectedVersion + 1, ownerAccountId: this.actor.id, state: "active", createdAt: before ? String(before.created_at) : at, updatedAt: at };
            if (payload.action !== "remove") {
                const count = await this.statement("SELECT COUNT(*) AS count FROM batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?))", this.scope, JSON.stringify(group.batteryIds)).first<number>("count");
                if (count !== group.batteryIds.length) throw new DomainError(409, "One or more batteries are unavailable in this inventory. Review the complete group; no partial group was saved.");
                const duplicate = await this.statement("SELECT id FROM teaching_groups WHERE scope=? AND owner_account_id=? AND state='active' AND name=? COLLATE NOCASE AND id<>?", this.scope, this.actor.id, group.name, group.id).first();
                if (duplicate) throw new DomainError(409, "You already have a teaching group with this name. Choose a different name or edit that group.");
            }
            const result: TeachingGroupReceipt = { requestId: payload.requestId, actorAccountId: this.actor.id, dataset: this.dataset, action: payload.action, group, replayed: false };
            const stateGuard = payload.action === "create" ? "NOT EXISTS(SELECT 1 FROM teaching_groups WHERE key=?)" : "EXISTS(SELECT 1 FROM teaching_groups WHERE key=? AND state='active' AND version=?)";
            const guardValues = payload.action === "create" ? [this.key(group.id)] : [this.key(group.id), payload.expectedVersion];
            const change = payload.action === "create" ? this.statement("INSERT INTO teaching_groups(key,scope,id,owner_account_id,name,notes,member_ids_json,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", this.key(group.id), this.scope, group.id, this.actor.id, group.name, group.notes, JSON.stringify(group.batteryIds), 1, "active", at, at)
                : this.statement("UPDATE teaching_groups SET name=?,notes=?,member_ids_json=?,version=?,state=?,updated_at=? WHERE key=? AND owner_account_id=? AND version=?", group.name, group.notes, JSON.stringify(group.batteryIds), group.version, group.state, at, this.key(group.id), this.actor.id, payload.expectedVersion);
            await this.db.batch([
                this.statement(`INSERT INTO teaching_group_operations(key,scope,owner_account_id,request_id,fingerprint,outcome,result_json,created_at,guard) SELECT ?,?,?,?,?,'saved',?,?,CASE WHEN (${stateGuard}) AND (${accountGuard}) THEN 1 ELSE 0 END`, this.key(payload.requestId), this.scope, this.actor.id, payload.requestId, fingerprint, JSON.stringify(result), at, ...guardValues, ...auth),
                change,
                this.statement("INSERT INTO teaching_group_events(id,scope,owner_account_id,group_key,action,at,before_json,after_json,request_id) VALUES(?,?,?,?,?,?,?,?,?)", crypto.randomUUID(), this.scope, this.actor.id, this.key(group.id), payload.action, at, before ? JSON.stringify(this.group(before)) : null, JSON.stringify(group), payload.requestId),
            ]);
            return result;
        } catch (error) {
            const saved = await this.replay(payload.requestId, fingerprint);
            if (saved) return saved;
            await this.authorize();
            const rejected = error instanceof DomainError ? error : /constraint|unique|check|foreign key/i.test(String(error)) ? new DomainError(409, "The group or related records changed. No group changes were saved. Refresh and review your draft.") : null;
            if (!rejected || rejected.code === "idempotency_conflict") throw error;
            try {
                await this.db.batch([this.statement(`INSERT INTO teaching_group_operations(key,scope,owner_account_id,request_id,fingerprint,outcome,result_json,created_at,guard) SELECT ?,?,?,?,?,'rejected',?,?,CASE WHEN (${accountGuard}) THEN 1 ELSE 0 END`, this.key(payload.requestId), this.scope, this.actor.id, payload.requestId, fingerprint, JSON.stringify({ status: rejected.status, error: rejected.message }), at, ...auth)]);
            } catch (reservationError) {
                const saved = await this.replay(payload.requestId, fingerprint);
                if (saved) return saved;
                throw reservationError;
            }
            throw new DomainError(rejected.status, rejected.message, "teaching_group_rejected_final");
        }
    }
}
