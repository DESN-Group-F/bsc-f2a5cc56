import { sqliteTable, text, integer, real, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
// Version advancement, stable identities, staff ownership and same-inventory
// references are also enforced by triggers in the versioned SQL migrations.
export const workspaces = sqliteTable("workspaces", { scope: text("scope").primaryKey(), createdAt: text("created_at").notNull() });
export const sharedInventories = sqliteTable("shared_inventories", {
    dataset: text("dataset").primaryKey(), scope: text("scope").notNull().unique(),
}, () => [check("shared_dataset", sql`dataset IN ('demo','live')`)]);
export const staffAccounts = sqliteTable("staff_accounts", {
    id: text("id").primaryKey(), username: text("username").notNull().unique(), displayName: text("display_name").notNull(), email: text("email").notNull().default(""),
    role: text("role").notNull(), active: integer("active").notNull().default(1), version: integer("version").notNull().default(1), authVersion: integer("auth_version").notNull().default(1),
    passwordHash: text("password_hash").notNull(), passwordSalt: text("password_salt").notNull(), hashIterations: integer("hash_iterations").notNull(),
    defaultDataset: text("default_dataset").notNull().default("demo"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, () => [check("account_role", sql`role IN ('admin','staff')`), check("account_active", sql`active IN (0,1)`), check("account_dataset", sql`default_dataset IN ('demo','live')`)]);
export const staffSessions = sqliteTable("staff_sessions", {
    tokenHash: text("token_hash").primaryKey(), accountId: text("account_id").notNull().references(() => staffAccounts.id), authVersion: integer("auth_version").notNull(),
    createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(),
}, t => [index("idx_sessions_account").on(t.accountId)]);
export const staffAccountEvents = sqliteTable("staff_account_events", {
    id: text("id").primaryKey(), action: text("action").notNull(), actorId: text("actor_id").notNull(), actorName: text("actor_name").notNull(), targetId: text("target_id").notNull(),
    at: text("at").notNull(), detailsJson: text("details_json").notNull(), guard: integer("guard").notNull().default(1),
}, () => [check("account_event_guard", sql`guard = 1`)]);
export const signInAttempts = sqliteTable("sign_in_attempts", {
    key: text("key").primaryKey(), failures: integer("failures").notNull(), windowStartedAt: text("window_started_at").notNull(),
});
export const people = sqliteTable("people", {
    accountId: text("account_id").references(() => staffAccounts.id),
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), reference: text("reference").notNull().default(""), role: text("role").notNull(), version: integer("version").notNull().default(1),
}, t => [uniqueIndex("idx_people_scope_id").on(t.scope, t.id), uniqueIndex("idx_people_scope_account").on(t.scope, t.accountId), check("people_role", sql `${t.role} IN ('staff','borrower')`)]);
export const buildings = sqliteTable("buildings", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), version: integer("version").notNull().default(1),
}, t => [uniqueIndex("idx_buildings_scope_id").on(t.scope, t.id)]);
export const rooms = sqliteTable("rooms", {
    isPlaceholder: integer("is_placeholder").notNull().default(0), selectable: integer("selectable").notNull().default(0),
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), building: text("building").notNull().default(""), version: integer("version").notNull().default(1),
    buildingKey: text("building_key").references(() => buildings.key), number: text("number"),
}, t => [uniqueIndex("idx_rooms_scope_id").on(t.scope, t.id), uniqueIndex("idx_rooms_building_number").on(t.scope, t.buildingKey, t.number), check("room_placeholder_flag", sql`${t.isPlaceholder} IN (0,1)`), check("room_selectable_flag", sql`${t.selectable} IN (0,1)`)]);
export const batteries = sqliteTable("batteries", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), chemistry: text("chemistry").notNull().default(""), model: text("model").notNull().default(""),
    manufacturedOn: text("manufactured_on"), firstUsedOn: text("first_used_on"),
    lifecycleStatus: text("lifecycle_status").notNull().default("active"), lifecycleAt: text("lifecycle_at"), lifecycleReason: text("lifecycle_reason"), lifecycleDestination: text("lifecycle_destination"),
    capacityMah: real("capacity_mah"), voltage: real("voltage"), tagId: text("tag_id"), ownerKey: text("owner_key").notNull().references(() => people.key), homeBuildingKey: text("home_building_key").references(() => buildings.key), homeRoomKey: text("home_room_key").references(() => rooms.key), createdAt: text("created_at").notNull(), version: integer("version").notNull().default(1),
}, t => [uniqueIndex("idx_batteries_scope_id").on(t.scope, t.id), uniqueIndex("idx_batteries_scope_tag").on(t.scope, t.tagId), check("battery_storage_required", sql `${t.homeBuildingKey} IS NOT NULL OR ${t.homeRoomKey} IS NOT NULL`), check("positive_capacity", sql `${t.capacityMah} IS NULL OR ${t.capacityMah}>0`), check("positive_voltage", sql `${t.voltage} IS NULL OR ${t.voltage}>0`), check("battery_lifecycle_status", sql`${t.lifecycleStatus} IN ('active','scrapped','permanently_removed')`)]);
export const batteryModels = sqliteTable("battery_models", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), identityKey: text("identity_key").notNull(),
    brand: text("brand").notNull().default(""), model: text("model").notNull(), variant: text("variant").notNull().default(""), name: text("name").notNull(), chemistry: text("chemistry").notNull().default(""),
    capacityMah: real("capacity_mah"), voltage: real("voltage"), notes: text("notes").notNull().default(""), version: integer("version").notNull().default(1), createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id), actorName: text("actor_name").notNull(),
    updatedAt: text("updated_at").notNull(), updatedBy: text("updated_by").notNull().references(() => staffAccounts.id), updatedActorName: text("updated_actor_name").notNull(),
}, t => [uniqueIndex("idx_battery_models_scope_id").on(t.scope, t.id), uniqueIndex("idx_battery_models_identity").on(t.scope, t.identityKey),
    check("battery_model_lengths", sql`length(${t.brand})<=80 AND length(${t.model}) BETWEEN 1 AND 120 AND length(${t.variant})<=120 AND length(${t.name}) BETWEEN 2 AND 120 AND length(${t.chemistry})<=40 AND length(${t.notes})<=1000`),
    check("battery_model_capacity", sql`${t.capacityMah} IS NULL OR (${t.capacityMah}>0 AND ${t.capacityMah}<=1000000)`), check("battery_model_voltage", sql`${t.voltage} IS NULL OR (${t.voltage}>0 AND ${t.voltage}<=1000)`), check("battery_model_version", sql`${t.version}>0`)]);
export const intakeCounters = sqliteTable("intake_counters", {
    scope: text("scope").primaryKey(), lastNumber: integer("last_number").notNull(),
}, t => [check("intake_counter_range", sql`${t.lastNumber} BETWEEN 1 AND 99999999`)]);
export const intakeSessions = sqliteTable("intake_sessions", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), actorId: text("actor_id").notNull().references(() => staffAccounts.id),
    actorName: text("actor_name").notNull(), configurationJson: text("configuration_json").notNull(), contextJson: text("context_json").notNull(), createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("idx_intake_sessions_scope_id").on(t.scope, t.id), check("intake_session_configuration_json", sql`json_valid(${t.configurationJson})`), check("intake_session_context_json", sql`json_valid(${t.contextJson})`)]);
export const loans = sqliteTable("loans", {
    borrowerAccountId: text("borrower_account_id").references(() => staffAccounts.id),
    id: text("id").primaryKey(), scope: text("scope").notNull(), batteryKey: text("battery_key").notNull().references(() => batteries.key), borrowerKey: text("borrower_key").notNull().references(() => people.key), borrowerName: text("borrower_name").notNull(),
    checkedOutAt: text("checked_out_at").notNull(), returnedAt: text("returned_at"), cancelledAt: text("cancelled_at"), checkoutActorId: text("checkout_actor_id").notNull(), checkoutActorName: text("checkout_actor_name").notNull(), returnActorId: text("return_actor_id"), returnActorName: text("return_actor_name"), correctionReason: text("correction_reason"),
}, t => [uniqueIndex("idx_loans_one_active").on(t.batteryKey).where(sql `${t.returnedAt} IS NULL AND ${t.cancelledAt} IS NULL`), index("idx_loans_scope_battery_time").on(t.scope, t.batteryKey, t.checkedOutAt)]);
export const observations = sqliteTable("observations", {
    id: text("id").primaryKey(), scope: text("scope").notNull(), batteryKey: text("battery_key").notNull().references(() => batteries.key), roomKey: text("room_key").notNull().references(() => rooms.key), observedAt: text("observed_at").notNull(), receivedAt: text("received_at").notNull(), source: text("source").notNull(), roomName: text("room_name"), roomBuilding: text("room_building"),
}, t => [index("idx_observations_battery_time").on(t.batteryKey, t.observedAt, t.receivedAt)]);
export const charges = sqliteTable("charges", {
    id: text("id").primaryKey(), scope: text("scope").notNull(), batteryKey: text("battery_key").notNull().references(() => batteries.key), completedAt: text("completed_at").notNull(), percentage: real("percentage"), recordedAt: text("recorded_at").notNull(), actorId: text("actor_id").notNull(), actorName: text("actor_name").notNull(),
    durationMinutes: real("duration_minutes"),
}, t => [index("idx_charges_battery_time").on(t.batteryKey, t.completedAt, t.recordedAt), check("charge_duration_range", sql `${t.durationMinutes} IS NULL OR (${t.durationMinutes}>0 AND ${t.durationMinutes}<=525600)`), check("charge_percentage_range", sql `${t.percentage} IS NULL OR (${t.percentage}>=0 AND ${t.percentage}<=100)`)]);
export const auditEvents = sqliteTable("audit_events", {
    id: text("id").primaryKey(), scope: text("scope").notNull(), action: text("action").notNull(), batteryId: text("battery_id"), actorId: text("actor_id").notNull(), actorName: text("actor_name").notNull(), at: text("at").notNull(), detailsJson: text("details_json").notNull(),
}, t => [index("idx_audit_scope_time").on(t.scope, t.at), index("idx_audit_scope_battery_time").on(t.scope, t.batteryId, t.at)]);
export const operations = sqliteTable("operations", {
    id: text("id").primaryKey(), scope: text("scope").notNull(), kind: text("kind").notNull(), fingerprint: text("fingerprint").notNull(), resultJson: text("result_json").notNull(), createdAt: text("created_at").notNull(), guard: integer("guard").notNull().default(1),
}, t => [check("operation_guard", sql `${t.guard}=1`)]);
export const taskPlans = sqliteTable("task_plans", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), title: text("title").notNull(), description: text("description").notNull(), category: text("category").notNull(),
    scopeNote: text("scope_note").notNull().default(""), basis: text("basis").notNull().default(""), targetKind: text("target_kind").notNull(), targetRef: text("target_ref"),
    recurrenceBasis: text("recurrence_basis").notNull(), firstDueOn: text("first_due_on"), intervalCount: integer("interval_count").notNull(), intervalUnit: text("interval_unit").notNull(), scheduledDatesJson: text("scheduled_dates_json").notNull(),
    reminderDaysBefore: integer("reminder_days_before").notNull(), reminderTime: text("reminder_time"), channelsJson: text("channels_json").notNull(), applicabilityConfirmed: integer("applicability_confirmed").notNull().default(0), state: text("state").notNull().default("draft"),
    version: integer("version").notNull().default(1), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), createdBy: text("created_by").notNull().references(() => staffAccounts.id), updatedBy: text("updated_by").notNull().references(() => staffAccounts.id),
}, t => [uniqueIndex("idx_task_plans_scope_id").on(t.scope, t.id), check("task_plan_category", sql`${t.category} IN ('storage_review','inventory_reconciliation','storage_maintenance')`), check("task_plan_target", sql`${t.targetKind} IN ('inventory','storage_area','model','group','batteries')`), check("task_plan_recurrence", sql`${t.recurrenceBasis} IN ('calendar','completion','dates')`), check("task_plan_unit", sql`${t.intervalUnit} IN ('days','weeks','months','years')`), check("task_plan_interval", sql`${t.intervalCount} BETWEEN 1 AND 120`), check("task_plan_advance", sql`${t.reminderDaysBefore} BETWEEN 0 AND 365`), check("task_plan_confirmed", sql`${t.applicabilityConfirmed} IN (0,1)`), check("task_plan_state", sql`${t.state} IN ('draft','active','paused')`), check("task_plan_dates_json", sql`json_valid(${t.scheduledDatesJson})`), check("task_plan_channels_json", sql`json_valid(${t.channelsJson})`)]);
export const taskPlanAssignees = sqliteTable("task_plan_assignees", {
    key: text("key").primaryKey(), planKey: text("plan_key").notNull().references(() => taskPlans.key), accountId: text("account_id").notNull().references(() => staffAccounts.id),
}, t => [uniqueIndex("idx_task_plan_assignee").on(t.planKey, t.accountId)]);
export const taskPlanBatteries = sqliteTable("task_plan_batteries", {
    key: text("key").primaryKey(), planKey: text("plan_key").notNull().references(() => taskPlans.key), batteryKey: text("battery_key").notNull().references(() => batteries.key),
}, t => [uniqueIndex("idx_task_plan_battery").on(t.planKey, t.batteryKey)]);
export const taskCycles = sqliteTable("task_cycles", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), planKey: text("plan_key").notNull().references(() => taskPlans.key), planVersion: integer("plan_version").notNull(), snapshotJson: text("snapshot_json").notNull(),
    dueOn: text("due_on").notNull(), reminderOn: text("reminder_on"), reminderTime: text("reminder_time"), reminderStatus: text("reminder_status").notNull(), reminderAtUtc: text("reminder_at_utc"), status: text("status").notNull().default("open"), version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(), completedAt: text("completed_at"), completedBy: text("completed_by").references(() => staffAccounts.id), completedByName: text("completed_by_name"), completionNotes: text("completion_notes"),
}, t => [uniqueIndex("idx_task_cycles_scope_id").on(t.scope, t.id), index("idx_task_cycles_due").on(t.planKey, t.dueOn), uniqueIndex("idx_task_cycles_one_open").on(t.planKey).where(sql`${t.status}='open'`), check("task_cycle_status", sql`${t.status} IN ('open','completed')`), check("task_cycle_snapshot", sql`json_valid(${t.snapshotJson})`)]);
export const teachingGroups = sqliteTable("teaching_groups", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), ownerAccountId: text("owner_account_id").notNull().references(() => staffAccounts.id),
    name: text("name").notNull(), notes: text("notes").notNull().default(""), memberIdsJson: text("member_ids_json").notNull(), version: integer("version").notNull().default(1), state: text("state").notNull().default("active"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("teaching_groups_identity").on(t.scope, t.ownerAccountId, t.id), uniqueIndex("teaching_groups_active_name").on(t.scope, t.ownerAccountId, sql`${t.name} COLLATE NOCASE`).where(sql`${t.state}='active'`), check("teaching_group_state", sql`${t.state} IN ('active','archived')`)]);
export const teachingGroupOperations = sqliteTable("teaching_group_operations", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), ownerAccountId: text("owner_account_id").notNull().references(() => staffAccounts.id), requestId: text("request_id").notNull(), fingerprint: text("fingerprint").notNull(), outcome: text("outcome").notNull(), resultJson: text("result_json").notNull(), createdAt: text("created_at").notNull(), guard: integer("guard").notNull(),
}, t => [check("teaching_group_operation_guard", sql`${t.guard}=1`)]);
export const teachingGroupEvents = sqliteTable("teaching_group_events", {
    id: text("id").primaryKey(), scope: text("scope").notNull(), ownerAccountId: text("owner_account_id").notNull().references(() => staffAccounts.id), groupKey: text("group_key").notNull().references(() => teachingGroups.key), action: text("action").notNull(), at: text("at").notNull(), beforeJson: text("before_json"), afterJson: text("after_json").notNull(), requestId: text("request_id").notNull(),
});
export const taskMessages = sqliteTable("task_messages", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), cycleKey: text("cycle_key").notNull().references(() => taskCycles.key), recipientId: text("recipient_id").notNull().references(() => staffAccounts.id), occurrence: text("occurrence").notNull(), title: text("title").notNull(), body: text("body").notNull(), reminderOn: text("reminder_on"), reminderTime: text("reminder_time"), reminderAtUtc: text("reminder_at_utc"), createdAt: text("created_at").notNull(), readAt: text("read_at"),
}, t => [uniqueIndex("idx_task_messages_scope_id").on(t.scope, t.id), uniqueIndex("idx_task_message_occurrence").on(t.cycleKey, t.recipientId, t.occurrence), index("idx_task_messages_recipient").on(t.scope, t.recipientId, t.createdAt)]);
