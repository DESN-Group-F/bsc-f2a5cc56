import { batterySchema, personSchema, buildingSchema, roomSchema, movementSchema, chargeSchema, observationSchema, correctionSchema, DomainError, recordKey, uniqueIds, validatePastTime, validateBatteryDates, type Dataset } from "./domain";
import { demoBatteries } from "./fixtures";
import { PLACEHOLDER_ROOMS, REFERENCE_BUILDINGS, isSupportedBuilding } from "./location-catalog";
import type { StaffRole } from "./accounts";
export type Actor = {
    id: string;
    name: string;
    role: StaffRole;
    authVersion?: number;
};
type Row = Record<string, unknown>;
/** All SQL is scoped and prepared. D1 batch is the atomic write boundary. */
export class InventoryStore {
    constructor(private db: D1Database, readonly scope: string, readonly dataset: Dataset, private actor: Actor, private clock: () => Date = () => new Date()) { }
    get viewerAccountId() { return this.actor.id; }
    private key(id: string) { return recordKey(this.scope, id); }
    private requireAdmin() { if (this.actor.role !== "admin") throw new DomainError(403, "Only administrators can modify saved records or maintain directories."); }
    private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
    private async rows(sql: string, ...values: unknown[]): Promise<Row[]> { return (await this.statement(sql, ...values).all<Row>()).results; }
    private async first(sql: string, ...values: unknown[]) { return this.statement(sql, ...values).first<Row>(); }
    private async ensureReferenceData() {
        // Reference configuration and explicit account projections are not location evidence.
        // Existing labels are never replaced by these idempotent inserts.
        const ready = await this.first("SELECT ((SELECT COUNT(*) FROM buildings WHERE scope=? AND id IN (SELECT value FROM json_each(?)))=? AND (SELECT COUNT(*) FROM rooms WHERE scope=? AND id IN (SELECT value FROM json_each(?)))=? AND NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE NOT EXISTS(SELECT 1 FROM people p WHERE p.scope=? AND (p.account_id=a.id OR p.id='staff-' || a.id)))) AS ready", this.scope, JSON.stringify(REFERENCE_BUILDINGS.map(building => building.id)), REFERENCE_BUILDINGS.length, this.scope, JSON.stringify(PLACEHOLDER_ROOMS.map(room => room.id)), PLACEHOLDER_ROOMS.length, this.scope);
        if (ready?.ready === 1) return;
        const writes: D1PreparedStatement[] = [];
        for (const building of REFERENCE_BUILDINGS)
            writes.push(this.statement("INSERT INTO buildings(key,scope,id,name) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE scope=? AND id=?)", this.key(building.id), this.scope, building.id, building.name, this.scope, building.id));
        for (const room of PLACEHOLDER_ROOMS)
            writes.push(this.statement("INSERT INTO rooms(key,scope,id,name,building_key,number,is_placeholder,selectable) SELECT ?,?,?,?,?,?,1,1 WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE scope=? AND id=?)", this.key(room.id), this.scope, room.id, room.name, this.key(room.buildingId), room.number, this.scope, room.id));
        writes.push(this.statement("INSERT INTO people(key,scope,id,name,reference,role,account_id) SELECT ? || '/staff-' || a.id,?,'staff-' || a.id,a.display_name,'','staff',a.id FROM staff_accounts a WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.scope=? AND (p.account_id=a.id OR p.id='staff-' || a.id))", this.scope, this.scope, this.scope));
        await this.db.batch(writes);
    }
    private event(action: string, batteryId: string | null, details: unknown, at: string) {
        return this.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)", crypto.randomUUID(), this.scope, action, batteryId, this.actor.id, this.actor.name, at, JSON.stringify(details));
    }
    private async battery(id: string) {
        const b = await this.first("SELECT * FROM batteries WHERE scope=? AND id=?", this.scope, id);
        if (!b)
            throw new DomainError(404, "Battery not found in this inventory.");
        return b;
    }
    private async replay(requestId: string, kind: string, fingerprint: string) {
        const old = await this.first("SELECT * FROM operations WHERE id=? AND scope=?", this.key(requestId), this.scope);
        if (!old)
            return null;
        if (old.kind !== kind || old.fingerprint !== fingerprint)
            throw new DomainError(409, "This request identifier was already used for a different operation.");
        return { ...JSON.parse(String(old.result_json)), replayed: true };
    }
    private async atomic(requestId: string, kind: string, fingerprint: string, result: unknown, at: string, guardSql: string, guardValues: unknown[], writes: D1PreparedStatement[], conflictMessage = "The records changed or conflict with this operation. Refresh and review the batteries again. Nothing in this batch was saved.", conflictCode?: string) {
        if (this.actor.authVersion !== undefined) {
            guardSql = `(${guardSql}) AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)`;
            guardValues = [...guardValues, this.actor.id, this.actor.authVersion, this.actor.role];
        }
        const old = await this.replay(requestId, kind, fingerprint);
        if (old)
            return old;
        const guard = this.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?, CASE WHEN (${guardSql}) THEN 1 ELSE 0 END`, this.key(requestId), this.scope, kind, fingerprint, JSON.stringify(result), at, ...guardValues);
        try {
            await this.db.batch([guard, ...writes]);
            return result;
        }
        catch (error) {
            const replay = await this.replay(requestId, kind, fingerprint);
            if (replay)
                return replay;
            const message = String(error);
            if (/UNIQUE/i.test(message) && kind.startsWith("battery_"))
                throw new DomainError(409, "That battery ID or RFID identifier is already assigned.");
            if (/UNIQUE/i.test(message) && (kind === "person_registered" || kind === "room_registered" || kind === "building_registered"))
                throw new DomainError(409, "That record ID or room number is already registered.");
            if (/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(message))
                throw new DomainError(409, conflictMessage, conflictCode);
            throw error;
        }
    }
    private editVersion(before: Row | null, expectedVersion: number | undefined) {
        if (!before) return 1;
        if (expectedVersion === undefined || expectedVersion !== Number(before.version))
            throw new DomainError(409, "This record changed since you opened it. Your edits were not saved. Load the latest record and review your input before saving.", "record_conflict");
        return expectedVersion + 1;
    }
    private metadataWrite(table: "people" | "buildings" | "rooms" | "batteries", kind: string, id: string, data: unknown, before: Row | null, version: number, at: string, writes: D1PreparedStatement[], relatedGuard = "1", relatedValues: unknown[] = []) {
        const guard = before ? `(SELECT COUNT(*) FROM ${table} WHERE scope=? AND id=? AND version=?)=1` : `(SELECT COUNT(*) FROM ${table} WHERE scope=? AND id=?)=0`;
        const values = before ? [this.scope, id, version - 1] : [this.scope, id];
        return this.atomic(crypto.randomUUID(), kind, JSON.stringify(data), { id, version }, at, `(${guard}) AND (${relatedGuard})`, [...values, ...relatedValues], writes,
            "This record or its related information changed. Your edits were not saved. Load the latest record and review your input before saving.", "record_conflict");
    }
    async initializeDemo() {
        if (this.dataset !== "demo")
            throw new DomainError(400, "Demonstration records can only be initialized in the demo inventory.");
        await this.ensureReferenceData();
        if (await this.first("SELECT scope FROM workspaces WHERE scope=?", this.scope))
            return { initialized: false };
        const now = this.clock(), at = now.toISOString(), yesterday = new Date(now.getTime() - 86400000).toISOString();
        const writes = [this.statement("INSERT INTO workspaces(scope,created_at) VALUES(?,?)", this.scope, at)];
        const owner = await this.first("SELECT p.key FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.account_id=? AND p.role='staff' AND a.active=1", this.scope, this.actor.id);
        if (!owner) throw new DomainError(401, "Sign in with an active staff account before initializing the demonstration inventory.");
        for (const b of demoBatteries)
            writes.push(this.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(b.id), this.scope, b.id, b.name, b.chemistry, b.model, b.capacityMah, b.voltage, b.tagId, owner.key, this.key("J18"), b.homeRoomId ? this.key(b.homeRoomId) : null, at));
        for (const [batteryId, durationMinutes] of [["BAT-001", 60], ["BAT-003", 90], ["BAT-006", 120]] as const)
            writes.push(this.statement("INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)", crypto.randomUUID(), this.scope, this.key(batteryId), yesterday, durationMinutes, at, "demo-setup", "Demonstration setup"));
        writes.push(this.event("demo_initialized", null, { note: "Fictional batteries and placeholder rooms assigned to the initializing staff account. No real RFID readings.", ownerAccountId: this.actor.id }, at));
        try {
            await this.atomic(crypto.randomUUID(), "demo_initialized", "demo-fixtures-v1", { initialized: true }, at,
                "NOT EXISTS(SELECT 1 FROM workspaces WHERE scope=?) AND EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=? AND p.scope=? AND p.account_id=? AND a.active=1)", [this.scope, owner.key, this.scope, this.actor.id], writes);
        }
        catch (e) {
            if (!(await this.first("SELECT scope FROM workspaces WHERE scope=?", this.scope)))
                throw e;
        }
        return { initialized: true };
    }
    private snapshotStatements() {
        return [
            this.statement(`SELECT b.id,b.version,b.name,b.chemistry,b.model,b.capacity_mah AS capacityMah,b.voltage,b.tag_id AS tagId,
        b.manufactured_on AS manufacturedOn,b.first_used_on AS firstUsedOn,
        own.id AS ownerId,COALESCE(ownerAccount.display_name,own.name) AS ownerName,own.account_id AS ownerAccountId,
        home.id AS homeRoomId,home.name AS homeRoomName,home.number AS homeRoomNumber,home.is_placeholder AS homeRoomIsPlaceholder,home.selectable AS homeRoomSelectable,
        homeBuilding.id AS homeBuildingId,homeBuilding.name AS homeBuildingName,
        l.id AS loanId,p.id AS borrowerId,l.borrower_name AS borrowerName,l.borrower_account_id AS borrowerAccountId,
        CASE WHEN l.id IS NULL THEN NULL WHEN l.borrower_account_id IS NULL THEN 'legacy' ELSE 'staff' END AS borrowerKind,
        l.checked_out_at AS checkedOutAt,
        (SELECT checked_out_at FROM loans WHERE battery_key=b.key AND scope=b.scope AND cancelled_at IS NULL ORDER BY checked_out_at DESC,rowid DESC LIMIT 1) AS lastCheckedOutAt,
        CASE WHEN o.id IS NULL THEN NULL ELSE COALESCE(o.room_name,'Room ID: ' || observedRoom.id) END AS observedRoom,
        o.room_building AS observedBuilding,CASE WHEN o.id IS NULL THEN NULL WHEN o.room_name IS NULL THEN 'unavailable' ELSE 'recorded' END AS observationRoomSnapshot,
        o.observed_at AS observedAt,o.source AS observationSource,
        c.completed_at AS chargedAt,c.duration_minutes AS chargeDurationMinutes
        FROM batteries b JOIN people own ON own.key=b.owner_key LEFT JOIN rooms home ON home.key=b.home_room_key
        LEFT JOIN staff_accounts ownerAccount ON ownerAccount.id=own.account_id
        LEFT JOIN buildings homeBuilding ON homeBuilding.key=COALESCE(b.home_building_key,home.building_key)
        LEFT JOIN loans l ON l.battery_key=b.key AND l.scope=b.scope AND l.returned_at IS NULL AND l.cancelled_at IS NULL
        LEFT JOIN people p ON p.key=l.borrower_key
        LEFT JOIN observations o ON o.id=(SELECT id FROM observations WHERE battery_key=b.key AND scope=b.scope ORDER BY observed_at DESC,received_at DESC,rowid DESC LIMIT 1)
        LEFT JOIN rooms observedRoom ON observedRoom.key=o.room_key
        LEFT JOIN charges c ON c.id=(SELECT id FROM charges WHERE battery_key=b.key AND scope=b.scope ORDER BY completed_at DESC,recorded_at DESC,rowid DESC LIMIT 1)
        WHERE b.scope=? ORDER BY b.id`, this.scope),
            this.statement("SELECT p.id,p.version,COALESCE(a.display_name,p.name) AS name,p.reference,p.role,p.account_id AS accountId FROM people p LEFT JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? ORDER BY name", this.scope),
            this.statement("SELECT id,version,name FROM buildings WHERE scope=? ORDER BY id", this.scope),
            this.statement("SELECT r.id,r.version,r.name,r.number,r.is_placeholder AS isPlaceholder,r.selectable,b.id AS buildingId,COALESCE(b.id || ' - ' || b.name,r.building) AS building FROM rooms r LEFT JOIN buildings b ON b.key=r.building_key WHERE r.scope=? ORDER BY b.id,r.number,r.name", this.scope),
            this.statement("SELECT id,action,battery_id AS batteryId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 200", this.scope),
            this.statement("SELECT id,display_name AS displayName,username,active FROM staff_accounts ORDER BY display_name,username"),
        ];
    }
    private snapshotResult(result: Row[][]) {
        const [batteries, people, buildings, rooms, events, staffDirectory] = result;
        return {
            dataset: this.dataset,
            batteries: batteries.map<Row>(battery => ({ ...battery, homeRoomIsPlaceholder: battery.homeRoomIsPlaceholder === null ? null : battery.homeRoomIsPlaceholder === 1, homeRoomSelectable: battery.homeRoomSelectable === null ? null : battery.homeRoomSelectable === 1 })),
            people, buildings, rooms: rooms.map<Row>(room => ({ ...room, isPlaceholder: room.isPlaceholder === 1, selectable: room.selectable === 1 })),
            staffDirectory: staffDirectory.map<Row>(account => ({ ...account, active: account.active === 1 })),
            events: events.map(({ details_json, ...event }) => ({ ...event, details: JSON.parse(String(details_json)) })),
            actor: this.actor.name, hardwareConnected: false,
        };
    }
    async snapshot() {
        await this.ensureReferenceData();
        return this.snapshotResult((await this.db.batch<Row>(this.snapshotStatements())).map(result => result.results));
    }
    async exportData() {
        await this.ensureReferenceData();
        const result = (await this.db.batch<Row>([...this.snapshotStatements(), ...["batteries", "people", "buildings", "rooms", "loans", "charges", "observations", "audit_events"].map(table => this.statement(`SELECT * FROM ${table} WHERE scope=? ORDER BY rowid`, this.scope))])).map(item => item.results);
        return { snapshot: this.snapshotResult(result), raw: Object.fromEntries(["batteries", "people", "buildings", "rooms", "loans", "charges", "observations", "audit_events"].map((name, index) => [name, result[index + 6]])) };
    }
    async fullActivity() {
        return (await this.rows("SELECT id,action,battery_id AS batteryId,actor_id AS actorId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=? ORDER BY at DESC,rowid DESC", this.scope)).map(({ details_json, ...event }) => ({ ...event, details: JSON.parse(String(details_json)) }));
    }
    async detail(id: string) {
        await this.battery(id);
        const key = this.key(id);
        const [loans, charges, observations, events] = await Promise.all([
            this.rows("SELECT id,borrower_name AS borrowerName,borrower_account_id AS borrowerAccountId,CASE WHEN borrower_account_id IS NULL THEN 'legacy' ELSE 'staff' END AS borrowerKind,checked_out_at AS checkedOutAt,returned_at AS returnedAt,cancelled_at AS cancelledAt,checkout_actor_name AS checkoutActorName,return_actor_name AS returnActorName,correction_reason AS correctionReason FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 200", this.scope, key),
            this.rows("SELECT id,completed_at AS completedAt,duration_minutes AS durationMinutes,percentage,actor_name AS actorName,recorded_at AS recordedAt FROM charges WHERE scope=? AND battery_key=? ORDER BY completed_at DESC,recorded_at DESC,rowid DESC LIMIT 200", this.scope, key),
            this.rows("SELECT o.id,COALESCE(o.room_name,'Room ID: ' || r.id) AS roomName,o.room_building AS roomBuilding,CASE WHEN o.room_name IS NULL THEN 'unavailable' ELSE 'recorded' END AS roomSnapshot,o.observed_at AS observedAt,o.received_at AS receivedAt,o.source FROM observations o JOIN rooms r ON r.key=o.room_key WHERE o.scope=? AND o.battery_key=? ORDER BY o.observed_at DESC,o.received_at DESC,o.rowid DESC LIMIT 200", this.scope, key),
            this.rows("SELECT id,action,battery_id AS batteryId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=? AND battery_id=? ORDER BY at DESC,rowid DESC LIMIT 200", this.scope, id),
        ]);
        return { loans, charges, observations, events: events.map(({ details_json, ...e }) => ({ ...e, details: JSON.parse(String(details_json)) })) };
    }
    async movement(input: unknown) {
        const v = movementSchema.parse(input), ids = uniqueIds(v.batteryIds);
        const expected = v.kind === "return" ? [...v.expectedLoans].sort((a, b) => a.batteryId.localeCompare(b.batteryId)) : [];
        if (v.kind === "return" && (expected.length !== ids.length || new Set(expected.map(item => item.batteryId)).size !== ids.length || new Set(expected.map(item => item.loanId)).size !== ids.length || expected.some(item => !ids.includes(item.batteryId))))
            throw new DomainError(400, "The reviewed loan IDs must match every selected battery exactly once.");
        const fingerprint = JSON.stringify({ kind: v.kind, ids, actorId: this.actor.id, borrowerAccountId: v.kind === "checkout" ? this.actor.id : null, expectedLoans: expected });
        const old = await this.replay(v.requestId, v.kind, fingerprint);
        if (old)
            return old;
        const at = this.clock().toISOString(), keysJson = JSON.stringify(ids.map(id => this.key(id)));
        // JSON carries the batch as one bound parameter, including 100-battery batches.
        const bs = await this.rows("SELECT key,id FROM batteries WHERE scope=? AND key IN (SELECT value FROM json_each(?))", this.scope, keysJson);
        if (bs.length !== ids.length)
            throw new DomainError(404, "One or more batteries are not registered in this inventory.");
        const writes: D1PreparedStatement[] = [];
        if (v.kind === "checkout") {
            if (this.actor.authVersion === undefined)
                throw new DomainError(401, "Sign in with a staff account before checking out batteries.");
            const account = await this.first("SELECT id,display_name,version FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?", this.actor.id, this.actor.authVersion, this.actor.role);
            if (!account) throw new DomainError(409, "Your account access changed. Sign in again before checking out batteries.");
            this.actor = { ...this.actor, name: String(account.display_name) };
            const personId = `staff-${this.actor.id}`, personKey = this.key(personId);
            const linked = await this.first("SELECT key,id FROM people WHERE scope=? AND account_id=?", this.scope, this.actor.id);
            if (linked && (linked.key !== personKey || linked.id !== personId))
                throw new DomainError(409, "This account's directory association requires administrator review.");
            // Provision an explicit account-ID association in the movement transaction.
            // A same-name or colliding legacy person is never adopted or rewritten.
            writes.push(this.statement("INSERT INTO people(key,scope,id,name,reference,role,account_id) SELECT ?,?,?,?,'','staff',? WHERE NOT EXISTS(SELECT 1 FROM people WHERE scope=? AND account_id=?)", personKey, this.scope, personId, account.display_name, this.actor.id, this.scope, this.actor.id));
            writes.push(this.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) SELECT ?,?,'staff_directory_linked',NULL,?,?,?,? WHERE changes()=1", crypto.randomUUID(), this.scope, this.actor.id, this.actor.name, at, JSON.stringify({ personId, accountId: this.actor.id })));
            for (const id of ids) {
                const loanId = crypto.randomUUID();
                writes.push(this.statement("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?,?)", loanId, this.scope, this.key(id), personKey, account.display_name, this.actor.id, at, this.actor.id, account.display_name), this.event("checkout", id, { loanId, borrower: account.display_name, borrowerId: personId, borrowerAccountId: this.actor.id, borrowerKind: "staff" }, at));
            }
            return this.atomic(v.requestId, v.kind, fingerprint, { kind: v.kind, batteryIds: ids, count: ids.length, borrower: account.display_name, borrowerAccountId: this.actor.id, at }, at,
                "NOT EXISTS(SELECT 1 FROM loans WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?)) AND returned_at IS NULL AND cancelled_at IS NULL) AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND version=? AND display_name=?)",
                [this.scope, keysJson, this.actor.id, account.version, account.display_name], writes);
        }
        const expectedJson = JSON.stringify(expected.map(item => ({ key: this.key(item.batteryId), loanId: item.loanId })));
        const reviewedSql = "SELECT l.id,l.battery_key,l.borrower_name,l.borrower_account_id FROM loans l JOIN json_each(?) reviewed ON l.id=json_extract(reviewed.value,'$.loanId') AND l.battery_key=json_extract(reviewed.value,'$.key') WHERE l.scope=? AND l.returned_at IS NULL AND l.cancelled_at IS NULL";
        const open = await this.rows(reviewedSql, expectedJson, this.scope);
        if (open.length !== ids.length)
            throw new DomainError(409, "A reviewed loan changed. Nothing was returned. Refresh and review the current loans before confirming.");
        for (const l of open) {
            const b = bs.find(b => b.key === l.battery_key)!;
            writes.push(this.statement("UPDATE loans SET returned_at=?,return_actor_id=?,return_actor_name=? WHERE id=? AND scope=?", at, this.actor.id, this.actor.name, l.id, this.scope), this.event("return", String(b.id), { loanId: l.id, borrower: l.borrower_name, borrowerAccountId: l.borrower_account_id, receivedByAccountId: this.actor.id }, at));
        }
        return this.atomic(v.requestId, v.kind, fingerprint, { kind: v.kind, batteryIds: ids, count: ids.length, at }, at, `(SELECT COUNT(*) FROM (${reviewedSql}))=?`, [expectedJson, this.scope, ids.length], writes);
    }
    async savePerson(input: unknown, update = false) {
        this.requireAdmin();
        const p = personSchema.parse(input), at = this.clock().toISOString(), before = await this.first("SELECT * FROM people WHERE scope=? AND id=?", this.scope, p.id);
        if (update && !before)
            throw new DomainError(404, "Person not found.");
        if (!update && before)
            throw new DomainError(409, "That person ID is already registered.");
        const version = this.editVersion(before, p.expectedVersion);
        if (before?.account_id && p.role !== "staff") throw new DomainError(409, "A staff-account directory entry must retain its staff role.");
        if (update && p.role !== "staff" && await this.first("SELECT id FROM batteries WHERE scope=? AND owner_key=? LIMIT 1", this.scope, this.key(p.id)))
            throw new DomainError(409, "This person owns registered batteries. Reassign their batteries to another staff owner before changing the role.");
        const kind = update ? "person_updated" : "person_registered";
        const write = update ? this.statement("UPDATE people SET name=?,reference=?,role=?,version=version+1 WHERE key=? AND scope=? AND version=?", p.name, p.reference, p.role, this.key(p.id), this.scope, p.expectedVersion) : this.statement("INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)", this.key(p.id), this.scope, p.id, p.name, p.reference, p.role);
        return this.metadataWrite("people", kind, p.id, p, before, version, at, [write, this.event(kind, null, { before, after: { ...p, version } }, at)]);
    }
    async saveBuilding(input: unknown, update = false) {
        this.requireAdmin();
        const b = buildingSchema.parse(input), at = this.clock().toISOString(), before = await this.first("SELECT * FROM buildings WHERE scope=? AND id=?", this.scope, b.id);
        if (update && !before) throw new DomainError(404, "Building not found.");
        if (!update && before) throw new DomainError(409, "That building code is already registered.");
        const version = this.editVersion(before, b.expectedVersion), kind = update ? "building_updated" : "building_registered";
        const write = update ? this.statement("UPDATE buildings SET name=?,version=version+1 WHERE key=? AND scope=? AND version=?", b.name, this.key(b.id), this.scope, b.expectedVersion) : this.statement("INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)", this.key(b.id), this.scope, b.id, b.name);
        return this.metadataWrite("buildings", kind, b.id, b, before, version, at, [write, this.event(kind, null, { before, after: { ...b, version } }, at)]);
    }
    async saveRoom(input: unknown, update = false) {
        this.requireAdmin();
        await this.ensureReferenceData();
        const r = roomSchema.parse(input), at = this.clock().toISOString(), before = await this.first("SELECT * FROM rooms WHERE scope=? AND id=?", this.scope, r.id);
        if (!isSupportedBuilding(r.buildingId)) throw new DomainError(400, "Only J18 rooms are available for the current project.");
        if (update && !before)
            throw new DomainError(404, "Room not found.");
        if (!update && before)
            throw new DomainError(409, "That room ID is already registered.");
        const building = await this.first("SELECT key FROM buildings WHERE scope=? AND id=?", this.scope, r.buildingId);
        if (!building) throw new DomainError(400, "Select a registered building before adding a room.");
        const version = this.editVersion(before, r.expectedVersion), kind = update ? "room_updated" : "room_registered";
        const isPlaceholder = r.isPlaceholder ?? (before ? before.is_placeholder === 1 : true);
        const saved = { ...r, isPlaceholder, selectable: true };
        const write = update ? this.statement("UPDATE rooms SET name=?,building_key=?,number=?,is_placeholder=?,selectable=1,version=version+1 WHERE key=? AND scope=? AND version=?", r.name, building.key, r.number, Number(isPlaceholder), this.key(r.id), this.scope, r.expectedVersion) : this.statement("INSERT INTO rooms(key,scope,id,name,building_key,number,is_placeholder,selectable) VALUES(?,?,?,?,?,?,?,1)", this.key(r.id), this.scope, r.id, r.name, building.key, r.number, Number(isPlaceholder));
        return this.metadataWrite("rooms", kind, r.id, saved, before, version, at, [write, this.event(kind, null, { before, after: { ...saved, version } }, at)]);
    }
    async saveBattery(input: unknown, update = false) {
        if (update) this.requireAdmin();
        await this.ensureReferenceData();
        const b = batterySchema.parse(input), at = this.clock().toISOString();
        validateBatteryDates(b, new Date(at));
        const [owner, building, room, before] = await Promise.all([
            this.first("SELECT p.key,p.account_id,a.active AS accountActive FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.id=? AND p.role='staff'", this.scope, b.ownerId),
            b.homeBuildingId ? this.first("SELECT key FROM buildings WHERE scope=? AND id=?", this.scope, b.homeBuildingId) : null,
            b.homeRoomId ? this.first("SELECT key,building_key,selectable FROM rooms WHERE scope=? AND id=?", this.scope, b.homeRoomId) : null,
            this.first("SELECT * FROM batteries WHERE scope=? AND id=?", this.scope, b.id),
        ]);
        const retainedOwner = update && !!owner && before?.owner_key === owner.key;
        if (!owner || owner.accountActive !== 1 && !retainedOwner || !building || !isSupportedBuilding(b.homeBuildingId))
            throw new DomainError(400, "Select an active staff account as the responsible owner and J18 as the storage building. The room can stay unspecified.");
        if (b.homeRoomId && (!room || room.building_key !== building.key || room.selectable !== 1))
            throw new DomainError(400, "Select an available J18 room, or leave it unspecified.");
        if (update && !before)
            throw new DomainError(404, "Battery not found.");
        if (!update && before)
            throw new DomainError(409, "That battery ID is already registered.");
        const version = this.editVersion(before, b.expectedVersion), kind = update ? "battery_updated" : "battery_registered";
        const values = [b.name, b.chemistry, b.model, b.capacityMah, b.voltage, b.tagId, owner.key, building?.key ?? null, room?.key ?? null, b.manufacturedOn, b.firstUsedOn];
        const write = update ? this.statement("UPDATE batteries SET name=?,chemistry=?,model=?,capacity_mah=?,voltage=?,tag_id=?,owner_key=?,home_building_key=?,home_room_key=?,manufactured_on=?,first_used_on=?,version=version+1 WHERE key=? AND scope=? AND version=?", ...values, this.key(b.id), this.scope, b.expectedVersion) : this.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,manufactured_on,first_used_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(b.id), this.scope, b.id, ...values, at);
        try {
            return await this.metadataWrite("batteries", kind, b.id, b, before, version, at, [write, this.event(kind, b.id, { before, after: { ...b, version } }, at)],
                "EXISTS(SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=? AND p.scope=? AND p.role='staff' AND p.account_id=? AND (a.active=1 OR ?=1)) AND (? IS NULL OR EXISTS(SELECT 1 FROM rooms WHERE key=? AND scope=? AND building_key=? AND selectable=1))", [owner.key, this.scope, owner.account_id, Number(retainedOwner), room?.key ?? null, room?.key ?? null, this.scope, building.key]);
        }
        catch (e) {
            if (/UNIQUE/i.test(String(e)))
                throw new DomainError(409, "That battery ID or RFID identifier is already assigned.");
            throw e;
        }
    }
    async charge(input: unknown) {
        this.requireAdmin();
        const v = chargeSchema.parse(input), fingerprint = JSON.stringify(v), old = await this.replay(v.requestId, "charge", fingerprint);
        if (old)
            return old;
        const b = await this.battery(v.batteryId), at = this.clock().toISOString(), completedAt = validatePastTime(v.completedAt, this.clock()), id = crypto.randomUUID();
        return this.atomic(v.requestId, "charge", fingerprint, { id, batteryId: v.batteryId }, at, "1", [], [
            this.statement("INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)", id, this.scope, b.key, completedAt, v.durationMinutes, at, this.actor.id, this.actor.name),
            this.event("charge_recorded", v.batteryId, { completedAt, durationMinutes: v.durationMinutes, source: "Manual record" }, at),
        ]);
    }
    async observation(input: unknown) {
        this.requireAdmin();
        if (this.dataset !== "demo")
            throw new DomainError(501, "Real RFID room observations are not enabled. Hardware and room mapping must be validated first.");
        const v = observationSchema.parse(input), fingerprint = JSON.stringify(v), old = await this.replay(v.requestId, "observation", fingerprint);
        if (old)
            return old;
        const b = await this.battery(v.batteryId), r = await this.first("SELECT r.*,building.id AS building_id,building.version AS building_version,COALESCE(building.id || ' - ' || building.name,r.building) AS building_label,CASE WHEN r.is_placeholder=1 THEN r.name || ' — Placeholder' WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END AS room_label FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.scope=? AND r.id=?", this.scope, v.roomId);
        if (!r || !isSupportedBuilding(String(r.building_id)) || r.selectable !== 1)
            throw new DomainError(400, "Select an available J18 room.");
        const at = this.clock().toISOString(), observedAt = validatePastTime(v.observedAt, this.clock()), id = crypto.randomUUID();
        return this.atomic(v.requestId, "observation", fingerprint, { id, batteryId: v.batteryId }, at, "(SELECT COUNT(*) FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.key=? AND r.scope=? AND r.version=? AND r.selectable=1 AND building.id='J18' AND building.version IS ?)=1", [r.key, this.scope, r.version, r.building_version], [
            this.statement("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)", id, this.scope, b.key, r.key, observedAt, at, "Demo observation", r.room_label, r.building_label),
            this.event("demo_observation", v.batteryId, { observationId: id, room: r.room_label, building: r.building_label, roomId: r.id, observedAt, source: "Demo observation" }, at),
        ]);
    }
    async correctLoan(input: unknown) {
        this.requireAdmin();
        const v = correctionSchema.parse(input), fingerprint = JSON.stringify({ ...v, actorId: this.actor.id }), old = await this.replay(v.requestId, "correction", fingerprint);
        if (old)
            return old;
        const l = await this.first("SELECT l.*,b.id AS battery_id FROM loans l JOIN batteries b ON b.key=l.battery_key WHERE l.scope=? AND l.id=?", this.scope, v.loanId);
        if (!l || l.cancelled_at)
            throw new DomainError(409, "This loan is unavailable for correction.");
        const latest = await this.first("SELECT id FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 1", this.scope, l.battery_key);
        if (latest?.id !== l.id)
            throw new DomainError(409, "Only the most recent loan can be corrected. Later movements must remain intact.");
        const reopen = v.action === "return_reopened";
        if (l.returned_at !== v.expectedReturnedAt || reopen !== (v.expectedReturnedAt !== null))
            throw new DomainError(409, "The reviewed loan state changed. This correction was not saved. Review the loan and choose the intended correction again.");
        const at = this.clock().toISOString();
        const write = reopen ? this.statement("UPDATE loans SET returned_at=NULL,return_actor_id=NULL,return_actor_name=NULL,correction_reason=? WHERE id=? AND scope=?", v.reason, l.id, this.scope) : this.statement("UPDATE loans SET cancelled_at=?,correction_reason=? WHERE id=? AND scope=?", at, v.reason, l.id, this.scope);
        return this.atomic(v.requestId, "correction", fingerprint, { id: l.id, action: v.action }, at, "(SELECT COUNT(*) FROM loans WHERE id=? AND scope=? AND returned_at IS ? AND cancelled_at IS NULL)=1 AND (SELECT id FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 1)=?", [l.id, this.scope, v.expectedReturnedAt, this.scope, l.battery_key, l.id], [write, this.event(v.action, String(l.battery_id), { loanId: l.id, reason: v.reason, intendedAction: v.action, expectedReturnedAt: v.expectedReturnedAt, before: l }, at)]);
    }
    async importRecords(kind: string, records: unknown[]) {
        if (kind !== "batteries") this.requireAdmin();
        if (!Array.isArray(records) || !records.length || records.length > 200)
            throw new DomainError(400, "Import between 1 and 200 records at a time.");
        const at = this.clock().toISOString(), writes: D1PreparedStatement[] = [];
        let guard = "1", guardValues: unknown[] = [];
        if (kind === "batteries" || kind === "rooms") await this.ensureReferenceData();
        if (kind === "people")
            for (const raw of records) {
                const p = personSchema.parse(raw);
                writes.push(this.statement("INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)", this.key(p.id), this.scope, p.id, p.name, p.reference, p.role));
            }
        else if (kind === "buildings")
            for (const raw of records) {
                const b = buildingSchema.parse(raw);
                writes.push(this.statement("INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)", this.key(b.id), this.scope, b.id, b.name));
            }
        else if (kind === "rooms")
            for (const raw of records) {
                const r = roomSchema.parse(raw);
                if (!isSupportedBuilding(r.buildingId)) throw new DomainError(400, `${r.id}: only J18 rooms are available for the current project.`);
                if (!await this.first("SELECT key FROM buildings WHERE scope=? AND id=?", this.scope, r.buildingId))
                    throw new DomainError(400, `${r.id}: register its building first.`);
                writes.push(this.statement("INSERT INTO rooms(key,scope,id,name,building_key,number,is_placeholder,selectable) VALUES(?,?,?,?,?,?,?,1)", this.key(r.id), this.scope, r.id, r.name, this.key(r.buildingId), r.number, Number(r.isPlaceholder ?? true)));
            }
        else if (kind === "batteries") {
            const people = await this.rows("SELECT p.id,p.key FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.role='staff' AND a.active=1", this.scope), buildings = await this.rows("SELECT key,id FROM buildings WHERE scope=?", this.scope), rooms = await this.rows("SELECT id,key,building_key,selectable FROM rooms WHERE scope=?", this.scope);
            const ownerKeys = new Set<string>(), roomKeys = new Set<string>();
            for (const raw of records) {
                const b = batterySchema.parse(raw);
                validateBatteryDates(b, new Date(at));
                const building = buildings.find(x => x.id === b.homeBuildingId);
                const owner = people.find(p => p.id === b.ownerId), room = b.homeRoomId ? rooms.find(r => r.id === b.homeRoomId && r.building_key === building?.key && r.selectable === 1) : null;
                if (!owner || !building || !isSupportedBuilding(b.homeBuildingId) || b.homeRoomId && !room)
                    throw new DomainError(400, `${b.id}: select an active staff account as its responsible owner, J18, and an available room or leave it unspecified.`);
                ownerKeys.add(String(owner.key));
                if (room) roomKeys.add(String(room.key));
                writes.push(this.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,manufactured_on,first_used_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(b.id), this.scope, b.id, b.name, b.chemistry, b.model, b.capacityMah, b.voltage, b.tagId, this.key(b.ownerId), this.key(b.homeBuildingId!), b.homeRoomId ? this.key(b.homeRoomId) : null, b.manufacturedOn, b.firstUsedOn, at));
            }
            guard = "(SELECT COUNT(*) FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.scope=? AND p.role='staff' AND a.active=1 AND p.key IN (SELECT value FROM json_each(?)))=? AND (SELECT COUNT(*) FROM rooms WHERE scope=? AND selectable=1 AND building_key=? AND key IN (SELECT value FROM json_each(?)))=?";
            guardValues = [this.scope, JSON.stringify([...ownerKeys]), ownerKeys.size, this.scope, this.key("J18"), JSON.stringify([...roomKeys]), roomKeys.size];
        }
        else
            throw new DomainError(400, "Choose people, buildings, rooms or batteries for import.");
        writes.push(this.event("records_imported", null, { kind, count: records.length }, at));
        try {
            return await this.atomic(crypto.randomUUID(), "records_imported", JSON.stringify({ kind, records }), { kind, count: records.length }, at, guard, guardValues, writes,
                "Your account access or a related record changed. No rows were imported.");
        }
        catch (e) {
            if (/constraint|UNIQUE/i.test(String(e)))
                throw new DomainError(409, "An ID, room number or RFID identifier conflicts with existing records, or a related record changed. No rows were imported.");
            throw e;
        }
    }
}
