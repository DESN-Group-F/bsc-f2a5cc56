import { z } from "zod";
import type { StaffUser } from "./accounts";
import { DomainError, recordKey, type Dataset } from "./domain";
import { currentSydneyDate } from "./battery-age";
import { taskPlanSchema, taskSchedulePreview, taskReminderAt, taskCycleCandidate, taskPlanMatchesQuery, type TaskPlan } from "./task-schedule";

type Row = Record<string, unknown>;
type TaskActor = Pick<StaffUser, "id" | "displayName" | "role" | "authVersion">;
export const taskCapabilities = {
    schedulerAvailable: false, emailAvailable: false, messageGeneration: "on_request",
    note: "Generated while system is in use; unattended delivery unavailable.",
} as const;
export type TaskPlanRecord = TaskPlan & { id: string; version: number; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; preview: ReturnType<typeof taskSchedulePreview> };
export type TaskGenerationIssue = { planId: string; message: string };
export type TaskCycleRecord = TaskPlan & {
    id: string; planId: string; planVersion: number; dueOn: string; reminderOn: string | null; reminderStatus: string; reminderAtUtc: string | null;
    status: "open" | "completed"; version: number; createdAt: string; completedAt: string | null; completedBy: string | null; completedByName: string | null; completionNotes: string | null;
    currentAssigneeIds: string[]; canComplete: boolean; targetSnapshot: Record<string, unknown>;
};
export type InboxMessage = { id: string; cycleId: string; planId: string; recipientId: string; title: string; body: string; createdAt: string; readAt: string | null; dueOn: string; reminderOn: string | null; reminderTime: string | null; reminderAtUtc: string | null; taskStatus: "open" | "completed"; cycleVersion: number; cycle: TaskCycleRecord };

const editSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() });
const completionSchema = z.object({ cycleId: z.string().uuid(), expectedVersion: z.number().int().positive(), notes: z.string().trim().max(2000).optional().transform(value => value || null) }).strict();
const readSchema = z.object({ id: z.string().uuid() }).strict();

/** Task configurations, shared cycles and private read state use the same D1 boundary. */
export class TaskPlanStore {
    constructor(private db: D1Database, readonly scope: string, readonly dataset: Dataset, private actor: TaskActor, private clock: () => Date = () => new Date()) {}
    private key(id: string) { return recordKey(this.scope, id); }
    private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
    private async rows(sql: string, ...values: unknown[]): Promise<Row[]> { return (await this.statement(sql, ...values).all<Row>()).results; }
    private async first(sql: string, ...values: unknown[]) { return this.statement(sql, ...values).first<Row>(); }
    private requireAdmin() { if (this.actor.role !== "admin") throw new DomainError(403, "Only administrators can configure recurring tasks."); }
    private actorGuard() { return { sql: "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)", values: [this.actor.id, this.actor.authVersion, this.actor.role] }; }
    private event(action: string, details: unknown, at: string) {
        return this.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,NULL,?,?,?,?)", crypto.randomUUID(), this.scope, action, this.actor.id, this.actor.displayName, at, JSON.stringify(details));
    }
    private async replay(requestId: string, fingerprint: string) {
        const row = await this.first("SELECT kind,result_json,fingerprint FROM operations WHERE id=? AND scope=?", this.key(requestId), this.scope);
        if (!row) return null;
        if (row.fingerprint !== fingerprint) throw new DomainError(409, "This request identifier was already used for different task changes.", "idempotency_conflict");
        const authorization = this.actorGuard();
        if (!await this.first(`SELECT id FROM staff_accounts WHERE ${authorization.sql}`, ...authorization.values)) throw new DomainError(403, "Your account access changed. Sign in again.");
        const result = JSON.parse(String(row.result_json));
        if (row.kind === "task_plan_create_rejected" && result.rejected === true) throw new DomainError(Number(result.status), String(result.error), "task_create_rejected_final");
        return result;
    }
    private async rejectCreate(identity: { requestId: string; fingerprint: string }, rejection: DomainError) {
        const authorization = this.actorGuard();
        const result = { rejected: true, status: rejection.status, error: rejection.message };
        try {
            // A final rejection and a successful creation share one immutable request key.
            await this.db.batch([this.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'task_plan_create_rejected',?,?,?,CASE WHEN (${authorization.sql}) THEN 1 ELSE 0 END`, this.key(identity.requestId), this.scope, identity.fingerprint, JSON.stringify(result), this.clock().toISOString(), ...authorization.values)]);
        } catch (error) {
            const committed = await this.replay(identity.requestId, identity.fingerprint);
            if (committed) return { ...committed, requestId: identity.requestId, action: "create", actorAccountId: this.actor.id, dataset: this.dataset };
            if (!await this.first(`SELECT id FROM staff_accounts WHERE ${authorization.sql}`, ...authorization.values)) throw rejection;
            // A storage or authorization failure does not establish a final outcome.
            throw error;
        }
        throw new DomainError(rejection.status, rejection.message, "task_create_rejected_final");
    }
    private async atomic(kind: string, result: unknown, guard: string, values: unknown[], writes: D1PreparedStatement[], identity?: { requestId: string; fingerprint: string }) {
        const authorization = this.actorGuard(), at = this.clock().toISOString();
        const operation = this.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN (${guard}) AND (${authorization.sql}) THEN 1 ELSE 0 END`, this.key(identity?.requestId ?? crypto.randomUUID()), this.scope, kind, identity?.fingerprint ?? JSON.stringify({ actorId: this.actor.id, result }), JSON.stringify(result), at, ...values, ...authorization.values);
        try { await this.db.batch([operation, ...writes]); return result; }
        catch (error) {
            if (identity) { const previous = await this.replay(identity.requestId, identity.fingerprint); if (previous) return previous; }
            if (/constraint|unique|check|foreign key/i.test(String(error))) throw new DomainError(409, "The task, assignment or your account access changed. Nothing in this operation was saved. Reload and review the latest records.", "record_conflict");
            throw error;
        }
    }
    private async data() {
        const [plans, assignees, targets, cycles, directory] = (await this.db.batch<Row>([
            this.statement("SELECT * FROM task_plans WHERE scope=? ORDER BY created_at,id", this.scope),
            this.statement("SELECT a.* FROM task_plan_assignees a JOIN task_plans p ON p.key=a.plan_key WHERE p.scope=? ORDER BY a.account_id", this.scope),
            this.statement("SELECT t.*,b.id AS battery_id FROM task_plan_batteries t JOIN task_plans p ON p.key=t.plan_key JOIN batteries b ON b.key=t.battery_key WHERE p.scope=? ORDER BY b.id", this.scope),
            this.statement("SELECT * FROM task_cycles WHERE scope=? ORDER BY created_at DESC,rowid DESC", this.scope),
            this.statement("SELECT id,display_name AS displayName,username,active FROM staff_accounts ORDER BY display_name,username"),
        ])).map(result => result.results);
        return { plans, assignees, targets, cycles, staffDirectory: directory.map(account => ({ id: String(account.id), displayName: String(account.displayName), username: String(account.username), active: account.active === 1 })) };
    }
    private plan(row: Row, data: Awaited<ReturnType<TaskPlanStore["data"]>>): TaskPlan {
        return taskPlanSchema.parse({
            category: row.category, title: row.title, description: row.description, basis: row.basis, scopeNote: row.scope_note, targetKind: row.target_kind, targetRef: row.target_ref,
            recurrenceBasis: row.recurrence_basis, firstDueOn: row.first_due_on, interval: row.interval_count, unit: row.interval_unit, scheduledDates: JSON.parse(String(row.scheduled_dates_json)),
            reminderDaysBefore: row.reminder_days_before, reminderTime: row.reminder_time, channels: JSON.parse(String(row.channels_json)), applicabilityConfirmed: row.applicability_confirmed === 1, state: row.state,
            assigneeIds: data.assignees.filter(assignment => assignment.plan_key === row.key).map(assignment => String(assignment.account_id)), batteryIds: data.targets.filter(target => target.plan_key === row.key).map(target => String(target.battery_id)),
        });
    }
    private cycle(row: Row, data: Awaited<ReturnType<TaskPlanStore["data"]>>): TaskCycleRecord {
        const snapshot = JSON.parse(String(row.snapshot_json)) as { plan: TaskPlan; target: Record<string, unknown> };
        const planRow = data.plans.find(plan => plan.key === row.plan_key)!;
        const currentAssigneeIds = data.assignees.filter(assignment => assignment.plan_key === row.plan_key).map(assignment => String(assignment.account_id));
        const reminderDaysBefore = row.reminder_on ? Math.round((Date.parse(`${row.due_on}T00:00:00Z`) - Date.parse(`${row.reminder_on}T00:00:00Z`)) / 86_400_000) : snapshot.plan.reminderDaysBefore;
        return { ...snapshot.plan, reminderDaysBefore, id: String(row.id), planId: String(planRow.id), planVersion: Number(row.plan_version), dueOn: String(row.due_on), reminderOn: row.reminder_on as string | null, reminderTime: row.reminder_time as string | null,
            reminderStatus: String(row.reminder_status), reminderAtUtc: row.reminder_at_utc as string | null, status: row.status as "open" | "completed", version: Number(row.version), createdAt: String(row.created_at), completedAt: row.completed_at as string | null,
            completedBy: row.completed_by as string | null, completedByName: row.completed_by_name as string | null, completionNotes: row.completion_notes as string | null, currentAssigneeIds,
            canComplete: row.status === "open" && (this.actor.role === "admin" || currentAssigneeIds.includes(this.actor.id)), targetSnapshot: snapshot.target };
    }
    private latestCompletion(planKey: unknown, cycles: Row[]) { return cycles.find(cycle => cycle.plan_key === planKey && cycle.status === "completed") ?? null; }
    private async validateTarget(plan: TaskPlan) {
        const guardParts: string[] = [], values: unknown[] = [], target: Record<string, unknown> = { kind: plan.targetKind, reference: plan.targetRef, scopeNote: plan.scopeNote };
        if (plan.targetKind === "model" && plan.targetRef) {
            const models = await this.rows("SELECT key,id,name,model,version FROM batteries WHERE scope=? AND model=? ORDER BY id", this.scope, plan.targetRef);
            if (plan.state === "active" && !models.length) throw new DomainError(400, "An active model task must match a model registered in this inventory.");
            target.batteries = models.map(battery => ({ id: battery.id, name: battery.name, model: battery.model }));
            if (plan.state === "active") {
                guardParts.push("(SELECT COUNT(*) FROM batteries WHERE scope=? AND model=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM batteries b WHERE b.scope=? AND b.key=json_extract(j.value,'$.key') AND b.version=json_extract(j.value,'$.version'))) ");
                values.push(this.scope, plan.targetRef, models.length, JSON.stringify(models.map(battery => ({ key: battery.key, version: battery.version }))), this.scope);
            }
        }
        if (plan.batteryIds.length) {
            const found = await this.rows("SELECT id,key,name,model,version FROM batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id", this.scope, JSON.stringify(plan.batteryIds));
            if (found.length !== plan.batteryIds.length) throw new DomainError(400, "Select only batteries registered in this inventory.");
            if (plan.targetKind !== "model") target.batteries = found.map(battery => ({ id: battery.id, name: battery.name, model: battery.model }));
            guardParts.push("(SELECT COUNT(*) FROM batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?)))=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM batteries b WHERE b.scope=? AND b.key=json_extract(j.value,'$.key') AND b.version=json_extract(j.value,'$.version'))) "); values.push(this.scope, JSON.stringify(plan.batteryIds), plan.batteryIds.length, JSON.stringify(found.map(battery => ({ key: battery.key, version: battery.version }))), this.scope);
        }
        if (plan.targetKind === "storage_area" && plan.targetRef) {
            const room = await this.first("SELECT r.*,b.id AS building_id,b.name AS building_name FROM rooms r JOIN buildings b ON b.key=r.building_key WHERE r.scope=? AND r.id=?", this.scope, plan.targetRef);
            if (!room || room.building_id !== "J18" || room.selectable !== 1) throw new DomainError(400, "Select an available J18 storage room.");
            if (plan.state === "active" && this.dataset === "live" && room.is_placeholder === 1) throw new DomainError(400, "A working-inventory storage task requires a verified room. Placeholder rooms remain provisional.");
            target.room = { id: room.id, name: room.name, number: room.number, buildingId: room.building_id, buildingName: room.building_name, isPlaceholder: room.is_placeholder === 1 };
            guardParts.push("EXISTS(SELECT 1 FROM rooms WHERE key=? AND scope=? AND version=? AND selectable=1 AND (?=0 OR is_placeholder=0))"); values.push(room.key, this.scope, room.version, Number(plan.state === "active" && this.dataset === "live"));
        }
        return { guard: guardParts.length ? guardParts.join(" AND ") : "1", values, snapshot: target };
    }
    async savePlan(input: unknown, update = false, requestId?: string) {
        this.requireAdmin();
        const plan = taskPlanSchema.parse(input), edit = update ? editSchema.parse(input) : null;
        const identity = requestId ? { requestId: z.string().uuid().parse(requestId), fingerprint: JSON.stringify({ actorId: this.actor.id, action: update ? "update" : "create", plan, edit }) } : undefined;
        const receipt = (result: Row) => !update && identity ? { ...result, requestId: identity.requestId, action: "create", actorAccountId: this.actor.id, dataset: this.dataset } : result;
        if (identity) { const previous = await this.replay(identity.requestId, identity.fingerprint); if (previous) return receipt(previous); }
        try {
            const id = edit?.id ?? crypto.randomUUID(), key = this.key(id), at = this.clock().toISOString();
            const data = await this.data(), before = data.plans.find(row => row.id === id) ?? null;
            if (update && !before) throw new DomainError(404, "Task plan not found in this inventory.");
            if (before && Number(before.version) !== edit?.expectedVersion) throw new DomainError(409, "This task plan changed. Review the latest configuration before saving.", "record_conflict");
            const version = before ? Number(before.version) + 1 : 1, target = await this.validateTarget(plan);
            const activeIds = new Set(data.staffDirectory.filter(account => account.active).map(account => account.id));
            if (plan.assigneeIds.some(accountId => !activeIds.has(accountId))) throw new DomainError(400, "Assign only active staff accounts.");
            const params = [plan.title, plan.description, plan.category, plan.scopeNote, plan.basis, plan.targetKind, plan.targetRef, plan.recurrenceBasis, plan.firstDueOn, plan.interval, plan.unit, JSON.stringify(plan.scheduledDates), plan.reminderDaysBefore, plan.reminderTime, JSON.stringify(plan.channels), Number(plan.applicabilityConfirmed), plan.state];
            const writes: D1PreparedStatement[] = [before
                ? this.statement("UPDATE task_plans SET title=?,description=?,category=?,scope_note=?,basis=?,target_kind=?,target_ref=?,recurrence_basis=?,first_due_on=?,interval_count=?,interval_unit=?,scheduled_dates_json=?,reminder_days_before=?,reminder_time=?,channels_json=?,applicability_confirmed=?,state=?,updated_at=?,updated_by=?,version=version+1 WHERE key=? AND scope=? AND version=?", ...params, at, this.actor.id, key, this.scope, edit!.expectedVersion)
                : this.statement("INSERT INTO task_plans(key,scope,id,title,description,category,scope_note,basis,target_kind,target_ref,recurrence_basis,first_due_on,interval_count,interval_unit,scheduled_dates_json,reminder_days_before,reminder_time,channels_json,applicability_confirmed,state,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", key, this.scope, id, ...params, at, at, this.actor.id, this.actor.id)];
            if (before) writes.push(this.statement("DELETE FROM task_plan_assignees WHERE plan_key=?", key), this.statement("DELETE FROM task_plan_batteries WHERE plan_key=?", key));
            for (const accountId of plan.assigneeIds) writes.push(this.statement("INSERT INTO task_plan_assignees(key,plan_key,account_id) VALUES(?,?,?)", `${key}/${accountId}`, key, accountId));
            for (const batteryId of plan.batteryIds) writes.push(this.statement("INSERT INTO task_plan_batteries(key,plan_key,battery_key) VALUES(?,?,?)", `${key}/${batteryId}`, key, this.key(batteryId)));
            const open = data.cycles.find(cycle => cycle.plan_key === key && cycle.status === "open");
            if (open) {
                const reminder = taskReminderAt(String(open.due_on), plan.reminderDaysBefore, plan.reminderTime);
                writes.push(this.statement("UPDATE task_cycles SET reminder_on=?,reminder_time=?,reminder_status=?,reminder_at_utc=?,version=version+1 WHERE key=? AND scope=? AND status='open' AND version=?", reminder.nextReminderOn, reminder.reminderTime, reminder.reminderStatus, reminder.reminderAtUtc, open.key, this.scope, open.version));
            }
            writes.push(this.event(before ? "task_plan_updated" : "task_plan_created", { planId: id, before: before ? { ...this.plan(before, data), version: before.version } : null, after: { ...plan, version }, openCycleId: open?.id ?? null, openCycleDueOn: open?.due_on ?? null, note: "Open-cycle content and due date are retained; reminder settings and current routing follow this configuration." }, at));
            let guard = before ? "EXISTS(SELECT 1 FROM task_plans WHERE key=? AND scope=? AND version=?)" : "NOT EXISTS(SELECT 1 FROM task_plans WHERE key=?)";
            const values: unknown[] = before ? [key, this.scope, edit!.expectedVersion] : [key];
            guard += " AND (SELECT COUNT(*) FROM staff_accounts WHERE active=1 AND id IN (SELECT value FROM json_each(?)))=? AND (" + target.guard + ")"; values.push(JSON.stringify(plan.assigneeIds), plan.assigneeIds.length, ...target.values);
            if (open) { guard += " AND EXISTS(SELECT 1 FROM task_cycles WHERE key=? AND status='open' AND version=?)"; values.push(open.key, open.version); }
            else { guard += " AND NOT EXISTS(SELECT 1 FROM task_cycles WHERE plan_key=? AND status='open')"; values.push(key); }
            const result = receipt({ id, version });
            return receipt(await this.atomic("task_plan_change", result, guard, values, writes, identity));
        } catch (error) {
            if (!update && identity) {
                const committed = await this.replay(identity.requestId, identity.fingerprint);
                if (committed) return receipt(committed);
                if (error instanceof DomainError && error.status >= 400 && error.status < 500) return await this.rejectCreate(identity, error);
            }
            throw error;
        }
    }

    /** Only authenticated use creates work and inbox reminders; no unattended worker runs. */
    async sync() {
        let data = await this.data();
        const generationIssues: TaskGenerationIssue[] = [];
        for (const row of data.plans) {
            if (row.state !== "active") continue;
            const plan = this.plan(row, data);
            const unavailable = plan.assigneeIds.filter(id => !data.staffDirectory.some(account => account.id === id && account.active));
            if (unavailable.length) generationIssues.push({ planId: String(row.id), message: "An assigned staff account is disabled. Reassign this plan to active staff; existing messages and task history are retained." });
            if (data.cycles.some(cycle => cycle.plan_key === row.key && cycle.status === "open")) continue;
            const previous = this.latestCompletion(row.key, data.cycles);
            const candidate = taskCycleCandidate(plan, previous?.due_on as string | null, previous?.completed_at ? currentSydneyDate(new Date(String(previous.completed_at))) : null);
            if (!candidate.nextDueOn) continue;
            let target: Awaited<ReturnType<TaskPlanStore["validateTarget"]>>;
            try { target = await this.validateTarget(plan); }
            catch (error) {
                if (!(error instanceof DomainError && error.status === 400)) throw error;
                generationIssues.push({ planId: String(row.id), message: error.message }); continue;
            }
            const reminder = taskReminderAt(candidate.nextDueOn, plan.reminderDaysBefore, plan.reminderTime);
            const id = crypto.randomUUID(), at = this.clock().toISOString();
            const completionGuard = previous ? "EXISTS(SELECT 1 FROM task_cycles WHERE key=? AND version=? AND status='completed')" : "NOT EXISTS(SELECT 1 FROM task_cycles WHERE plan_key=? AND status='completed')";
            const completionValues = previous ? [previous.key, previous.version] : [row.key];
            try {
                await this.atomic("task_cycle_generation", { id, planId: row.id }, `EXISTS(SELECT 1 FROM task_plans WHERE key=? AND scope=? AND version=? AND state='active') AND NOT EXISTS(SELECT 1 FROM task_cycles WHERE plan_key=? AND status='open') AND (${completionGuard}) AND (${target.guard})`, [row.key, this.scope, row.version, row.key, ...completionValues, ...target.values], [
                    this.statement("INSERT INTO task_cycles(key,scope,id,plan_key,plan_version,snapshot_json,due_on,reminder_on,reminder_time,reminder_status,reminder_at_utc,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", this.key(id), this.scope, id, row.key, row.version, JSON.stringify({ plan, target: target.snapshot }), candidate.nextDueOn, reminder.nextReminderOn, reminder.reminderTime, reminder.reminderStatus, reminder.reminderAtUtc, at),
                    this.event("task_cycle_created", { cycleId: id, planId: row.id, dueOn: candidate.nextDueOn, skippedPeriods: candidate.skippedPeriods, calculationRule: candidate.calculationRule, note: "This creates outstanding work; it does not record an inspection or completion." }, at),
                ]);
            } catch (error) {
                if (!(error instanceof DomainError && error.status === 409)) throw error;
                generationIssues.push({ planId: String(row.id), message: "Generation encountered a concurrent change. Reload to review the current plan and outstanding work." });
                // A concurrent configuration or cycle change is reviewed on the next request.
            }
        }
        data = await this.data();
        const now = this.clock().toISOString();
        for (const row of data.cycles) {
            const planRow = data.plans.find(plan => plan.key === row.plan_key);
            if (row.status !== "open" || planRow?.state !== "active" || !row.reminder_at_utc || String(row.reminder_at_utc) > now) continue;
            const cycle = this.cycle(row, data);
            const recipients = cycle.currentAssigneeIds.filter(id => data.staffDirectory.some(account => account.id === id && account.active));
            for (const recipient of recipients) {
                if (await this.first("SELECT id FROM task_messages WHERE cycle_key=? AND recipient_id=? AND occurrence='initial-reminder'", row.key, recipient)) continue;
                const id = crypto.randomUUID(), body = `${cycle.description}\nDue: ${cycle.dueOn} (${cycle.basis || "Configured local task"}).\n${cycle.scopeNote}\nOpen the shared task and record actual completion when the work is done. Reading this message does not complete the task.`;
                try {
                    await this.atomic("task_message_generation", { id, cycleId: cycle.id, recipientId: recipient }, "EXISTS(SELECT 1 FROM task_cycles WHERE key=? AND scope=? AND status='open' AND version=?) AND EXISTS(SELECT 1 FROM task_plans WHERE key=? AND version=? AND state='active') AND EXISTS(SELECT 1 FROM task_plan_assignees a JOIN staff_accounts s ON s.id=a.account_id WHERE a.plan_key=? AND a.account_id=? AND s.active=1) AND NOT EXISTS(SELECT 1 FROM task_messages WHERE cycle_key=? AND recipient_id=? AND occurrence='initial-reminder')", [row.key, this.scope, row.version, planRow.key, planRow.version, row.plan_key, recipient, row.key, recipient], [this.statement("INSERT INTO task_messages(key,scope,id,cycle_key,recipient_id,occurrence,title,body,reminder_on,reminder_time,reminder_at_utc,created_at) VALUES(?,?,?,?,?,'initial-reminder',?,?,?,?,?,?)", this.key(id), this.scope, id, row.key, recipient, cycle.title, body, row.reminder_on, row.reminder_time, row.reminder_at_utc, now)]);
                } catch (error) {
                    if (!(error instanceof DomainError && error.status === 409)) throw error;
                }
            }
        }
        return generationIssues;
    }

    async list() {
        const generationIssues = await this.sync();
        const data = await this.data();
        const cycles = data.cycles.map(row => this.cycle(row, data));
        const plans: TaskPlanRecord[] = data.plans.map(row => {
            const plan = this.plan(row, data), previous = this.latestCompletion(row.key, data.cycles), open = cycles.find(cycle => cycle.planId === row.id && cycle.status === "open");
            const preview = taskSchedulePreview(plan, { lastDueOn: previous?.due_on as string | null, completedOn: previous?.completed_at ? currentSydneyDate(new Date(String(previous.completed_at))) : null });
            if (open) Object.assign(preview, { nextDueOn: open.dueOn, nextReminderOn: open.reminderOn, reminderTime: open.reminderTime, reminderStatus: open.reminderStatus, reminderAtUtc: open.reminderAtUtc });
            return { ...plan, id: String(row.id), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), createdBy: String(row.created_by), updatedBy: String(row.updated_by), preview };
        });
        return { plans, cycles, staffDirectory: data.staffDirectory, capabilities: taskCapabilities, generationIssues };
    }

    async completeCycle(input: unknown, requestId?: string) {
        const payload = completionSchema.parse(input);
        const identity = requestId ? { requestId: z.string().uuid().parse(requestId), fingerprint: JSON.stringify({ actorId: this.actor.id, action: "complete", payload }) } : undefined;
        if (identity) { const previous = await this.replay(identity.requestId, identity.fingerprint); if (previous) return previous; }
        const data = await this.data(), row = data.cycles.find(cycle => cycle.id === payload.cycleId);
        if (!row) throw new DomainError(404, "Task cycle not found in this inventory.");
        if (row.status !== "open" || row.version !== payload.expectedVersion) throw new DomainError(409, "This task changed or was already completed. Review its latest record.", "record_conflict");
        const cycle = this.cycle(row, data);
        if (!cycle.canComplete) throw new DomainError(403, "Only assigned staff or an administrator can complete this task.");
        const planRow = data.plans.find(plan => plan.key === row.plan_key)!, plan = this.plan(planRow, data), at = this.clock().toISOString();
        const candidate = taskCycleCandidate(plan, String(row.due_on), currentSydneyDate(new Date(at)));
        const result = { id: cycle.id, version: cycle.version + 1, status: "completed", nextDueOn: candidate.nextDueOn, skippedPeriods: candidate.skippedPeriods, calculationRule: candidate.calculationRule };
        return this.atomic("task_cycle_completion", result, "EXISTS(SELECT 1 FROM task_cycles WHERE key=? AND scope=? AND status='open' AND version=?) AND EXISTS(SELECT 1 FROM task_plans WHERE key=? AND version=?) AND (?='admin' OR EXISTS(SELECT 1 FROM task_plan_assignees WHERE plan_key=? AND account_id=?))", [row.key, this.scope, payload.expectedVersion, planRow.key, planRow.version, this.actor.role, row.plan_key, this.actor.id], [
            this.statement("UPDATE task_cycles SET status='completed',completed_at=?,completed_by=?,completed_by_name=?,completion_notes=?,version=version+1 WHERE key=? AND scope=? AND status='open' AND version=?", at, this.actor.id, this.actor.displayName, payload.notes, row.key, this.scope, payload.expectedVersion),
            this.event("task_cycle_completed", { cycleId: cycle.id, planId: cycle.planId, dueOn: cycle.dueOn, completedOn: currentSydneyDate(new Date(at)), completionNotes: payload.notes, ...candidate, note: "Skipped planning dates are not completed inspections." }, at),
        ], identity);
    }

    async messages(options: { allUnread?: boolean; readState?: "all" | "unread" | "read"; taskStatus?: "all" | "open" | "completed"; search?: string } = {}) {
        const legacyUnread = z.boolean().parse(options.allUnread ?? false);
        const readState = z.enum(["all", "unread", "read"]).parse(options.readState ?? (legacyUnread ? "unread" : "all"));
        const taskStatus = z.enum(["all", "open", "completed"]).parse(options.taskStatus ?? "all");
        const generationIssues = await this.sync();
        const data = await this.data(), rows = await this.rows("SELECT * FROM task_messages WHERE scope=? AND recipient_id=? ORDER BY created_at DESC,rowid DESC", this.scope, this.actor.id);
        const unreadCount = rows.filter(row => row.read_at === null).length;
        const query = (options.search ?? "").trim().toLowerCase();
        const messages: InboxMessage[] = rows.map(row => {
            const cycle = this.cycle(data.cycles.find(cycle => cycle.key === row.cycle_key)!, data);
            return { id: String(row.id), cycleId: cycle.id, planId: cycle.planId, recipientId: String(row.recipient_id), title: String(row.title), body: String(row.body), createdAt: String(row.created_at), readAt: row.read_at as string | null, dueOn: cycle.dueOn, reminderOn: row.reminder_on as string | null, reminderTime: row.reminder_time as string | null, reminderAtUtc: row.reminder_at_utc as string | null, taskStatus: cycle.status, cycleVersion: cycle.version, cycle };
        }).filter(message => (readState === "all" || (readState === "unread" ? message.readAt === null : message.readAt !== null)) && (taskStatus === "all" || message.taskStatus === taskStatus) && (!query || taskPlanMatchesQuery(message.cycle, query) || `${message.title} ${message.body} ${message.dueOn} ${JSON.stringify(message.cycle.targetSnapshot)}`.toLowerCase().includes(query)));
        return { messages, unreadCount, capabilities: taskCapabilities, generationIssues };
    }

    async messageCounts() {
        const generationIssues = await this.sync();
        const counts = await this.first("SELECT COUNT(*) AS total,SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM task_messages WHERE scope=? AND recipient_id=?", this.scope, this.actor.id);
        return { messageCount: Number(counts?.total ?? 0), unreadCount: Number(counts?.unread ?? 0), capabilities: taskCapabilities, generationIssues };
    }

    async markRead(input: unknown) {
        const { id } = readSchema.parse(input), row = await this.first("SELECT * FROM task_messages WHERE scope=? AND id=? AND recipient_id=?", this.scope, id, this.actor.id);
        if (!row) throw new DomainError(404, "Message not found in your inbox.");
        if (row.read_at) return { id, readAt: String(row.read_at) };
        const readAt = this.clock().toISOString();
        try {
            return await this.atomic("task_message_read", { id, readAt }, "EXISTS(SELECT 1 FROM task_messages WHERE key=? AND scope=? AND recipient_id=? AND read_at IS NULL)", [row.key, this.scope, this.actor.id], [
                this.statement("UPDATE task_messages SET read_at=? WHERE key=? AND scope=? AND recipient_id=? AND read_at IS NULL", readAt, row.key, this.scope, this.actor.id),
                this.event("task_message_read", { messageId: id, cycleKey: row.cycle_key }, readAt),
            ]);
        } catch (error) {
            if (error instanceof DomainError && error.status === 409) {
                const latest = await this.first("SELECT read_at FROM task_messages WHERE key=? AND scope=? AND recipient_id=?", row.key, this.scope, this.actor.id);
                if (latest?.read_at) return { id, readAt: String(latest.read_at) };
            }
            throw error;
        }
    }
}
