import { sqliteTable, text, integer, real, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
// Version advancement, stable identities, staff ownership and same-inventory
// references are also enforced by triggers in the versioned SQL migrations.
export const workspaces = sqliteTable("workspaces", { scope: text("scope").primaryKey(), createdAt: text("created_at").notNull() });
export const people = sqliteTable("people", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), reference: text("reference").notNull().default(""), role: text("role").notNull(), version: integer("version").notNull().default(1),
}, t => [uniqueIndex("idx_people_scope_id").on(t.scope, t.id), check("people_role", sql `${t.role} IN ('staff','borrower')`)]);
export const buildings = sqliteTable("buildings", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), version: integer("version").notNull().default(1),
}, t => [uniqueIndex("idx_buildings_scope_id").on(t.scope, t.id)]);
export const rooms = sqliteTable("rooms", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), building: text("building").notNull().default(""), version: integer("version").notNull().default(1),
    buildingKey: text("building_key").references(() => buildings.key), number: text("number"),
}, t => [uniqueIndex("idx_rooms_scope_id").on(t.scope, t.id), uniqueIndex("idx_rooms_building_number").on(t.scope, t.buildingKey, t.number)]);
export const batteries = sqliteTable("batteries", {
    key: text("key").primaryKey(), scope: text("scope").notNull(), id: text("id").notNull(), name: text("name").notNull(), chemistry: text("chemistry").notNull().default(""), model: text("model").notNull().default(""),
    capacityMah: real("capacity_mah"), voltage: real("voltage"), tagId: text("tag_id"), ownerKey: text("owner_key").notNull().references(() => people.key), homeBuildingKey: text("home_building_key").references(() => buildings.key), homeRoomKey: text("home_room_key").references(() => rooms.key), createdAt: text("created_at").notNull(), version: integer("version").notNull().default(1),
}, t => [uniqueIndex("idx_batteries_scope_id").on(t.scope, t.id), uniqueIndex("idx_batteries_scope_tag").on(t.scope, t.tagId), check("battery_storage_required", sql `${t.homeBuildingKey} IS NOT NULL OR ${t.homeRoomKey} IS NOT NULL`), check("positive_capacity", sql `${t.capacityMah} IS NULL OR ${t.capacityMah}>0`), check("positive_voltage", sql `${t.voltage} IS NULL OR ${t.voltage}>0`)]);
export const loans = sqliteTable("loans", {
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
