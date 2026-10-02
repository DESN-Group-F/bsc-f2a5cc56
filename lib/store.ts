import { batterySchema, personSchema, buildingSchema, roomSchema, movementSchema, chargeSchema, observationSchema, correctionSchema, DomainError, recordKey, uniqueIds, validatePastTime, type Dataset } from "./domain";
import { demoBatteries, demoPeople, demoRooms } from "./fixtures";
export type Actor = {
    id: string;
    name: string;
};
type Row = Record<string, unknown>;
/** All SQL is scoped and prepared. D1 batch is the atomic write boundary. */
export class InventoryStore {
    constructor(private db: D1Database, readonly scope: string, readonly dataset: Dataset, private actor: Actor, private clock: () => Date = () => new Date()) { }
    private key(id: string) { return recordKey(this.scope, id); }
    private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
    private async rows(sql: string, ...values: unknown[]): Promise<Row[]> { return (await this.statement(sql, ...values).all<Row>()).results; }
    private async first(sql: string, ...values: unknown[]) { return this.statement(sql, ...values).first<Row>(); }
    private async ensureTargetBuilding() {
        // Reference configuration only: this does not claim any battery's location.
        await this.statement("INSERT INTO buildings(key,scope,id,name) SELECT ?,?,'J18','Willis Annexe' WHERE NOT EXISTS (SELECT 1 FROM buildings WHERE scope=? AND id='J18')", this.key("J18"), this.scope, this.scope).run();
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
    private metadataWrite(table: "people" | "buildings" | "rooms" | "batteries", kind: string, id: string, data: unknown, before: Row | null, version: number, at: string, writes: D1PreparedStatement[]) {
        const guard = before ? `(SELECT COUNT(*) FROM ${table} WHERE scope=? AND id=? AND version=?)=1` : `(SELECT COUNT(*) FROM ${table} WHERE scope=? AND id=?)=0`;
        const values = before ? [this.scope, id, version - 1] : [this.scope, id];
        return this.atomic(crypto.randomUUID(), kind, JSON.stringify(data), { id, version }, at, guard, values, writes,
            "This record or its related information changed. Your edits were not saved. Load the latest record and review your input before saving.", "record_conflict");
    }
    async initializeDemo() {
        if (this.dataset !== "demo")
            throw new DomainError(400, "Demonstration records can only be initialized in the demo inventory.");
        await this.ensureTargetBuilding();
        if (await this.first("SELECT scope FROM workspaces WHERE scope=?", this.scope))
            return { initialized: false };
        const now = this.clock(), at = now.toISOString(), yesterday = new Date(now.getTime() - 86400000).toISOString();
        const writes = [this.statement("INSERT INTO workspaces(scope,created_at) VALUES(?,?)", this.scope, at)];
        for (const p of demoPeople)
            writes.push(this.statement("INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)", this.key(p.id), this.scope, p.id, p.name, p.reference, p.role));
        for (const r of demoRooms)
            writes.push(this.statement("INSERT INTO rooms(key,scope,id,name,building,building_key,number) VALUES(?,?,?,?,?,?,?)", this.key(r.id), this.scope, r.id, r.name, "", this.key(r.buildingId), r.number));
        for (const b of demoBatteries)
            writes.push(this.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(b.id), this.scope, b.id, b.name, b.chemistry, b.model, b.capacityMah, b.voltage, b.tagId, this.key(b.ownerId), this.key(b.homeBuildingId), b.homeRoomId ? this.key(b.homeRoomId) : null, at));
        for (const [batteryId, borrowerId] of [["BAT-003", "demo-student-1"], ["BAT-004", "demo-student-2"]]) {
            const borrower = demoPeople.find(p => p.id === borrowerId)!;
            writes.push(this.statement("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)", crypto.randomUUID(), this.scope, this.key(batteryId), this.key(borrowerId), borrower.name, yesterday, "demo-setup", "Demonstration setup"));
        }
        for (const [batteryId, durationMinutes] of [["BAT-001", 60], ["BAT-003", 90], ["BAT-006", 120]] as const)
            writes.push(this.statement("INSERT INTO charges(id,scope,battery_key,completed_at,duration_minutes,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)", crypto.randomUUID(), this.scope, this.key(batteryId), yesterday, durationMinutes, at, "demo-setup", "Demonstration setup"));
        writes.push(this.event("demo_initialized", null, { note: "Fictional batteries, people and rooms. No real RFID readings." }, at));
        try {
            await this.db.batch(writes);
        }
        catch (e) {
            if (!(await this.first("SELECT scope FROM workspaces WHERE scope=?", this.scope)))
                throw e;
        }
        return { initialized: true };
    }
    async snapshot() {
        await this.ensureTargetBuilding();
        const [batteries, people, buildings, rooms, events] = await Promise.all([
            this.rows(`SELECT b.id,b.version,b.name,b.chemistry,b.model,b.capacity_mah AS capacityMah,b.voltage,b.tag_id AS tagId,
        own.id AS ownerId,own.name AS ownerName,home.id AS homeRoomId,home.name AS homeRoomName,home.number AS homeRoomNumber,
        homeBuilding.id AS homeBuildingId,homeBuilding.name AS homeBuildingName,
        l.id AS loanId,p.id AS borrowerId,l.borrower_name AS borrowerName,l.checked_out_at AS checkedOutAt,
        CASE WHEN o.id IS NULL THEN NULL ELSE COALESCE(o.room_name,'Room ID: ' || observedRoom.id) END AS observedRoom,
        o.room_building AS observedBuilding,CASE WHEN o.id IS NULL THEN NULL WHEN o.room_name IS NULL THEN 'unavailable' ELSE 'recorded' END AS observationRoomSnapshot,
        o.observed_at AS observedAt,o.source AS observationSource,
        c.completed_at AS chargedAt,c.duration_minutes AS chargeDurationMinutes
        FROM batteries b JOIN people own ON own.key=b.owner_key LEFT JOIN rooms home ON home.key=b.home_room_key
        LEFT JOIN buildings homeBuilding ON homeBuilding.key=COALESCE(b.home_building_key,home.building_key)
        LEFT JOIN loans l ON l.battery_key=b.key AND l.scope=b.scope AND l.returned_at IS NULL AND l.cancelled_at IS NULL
        LEFT JOIN people p ON p.key=l.borrower_key
        LEFT JOIN observations o ON o.id=(SELECT id FROM observations WHERE battery_key=b.key AND scope=b.scope ORDER BY observed_at DESC,received_at DESC,rowid DESC LIMIT 1)
        LEFT JOIN rooms observedRoom ON observedRoom.key=o.room_key
        LEFT JOIN charges c ON c.id=(SELECT id FROM charges WHERE battery_key=b.key AND scope=b.scope ORDER BY completed_at DESC,recorded_at DESC,rowid DESC LIMIT 1)
        WHERE b.scope=? ORDER BY b.id`, this.scope),
            this.rows("SELECT id,version,name,reference,role FROM people WHERE scope=? ORDER BY name", this.scope),
            this.rows("SELECT id,version,name FROM buildings WHERE scope=? ORDER BY id", this.scope),
            this.rows("SELECT r.id,r.version,r.name,r.number,b.id AS buildingId,COALESCE(b.id || ' - ' || b.name,r.building) AS building FROM rooms r LEFT JOIN buildings b ON b.key=r.building_key WHERE r.scope=? ORDER BY b.id,r.number,r.name", this.scope),
            this.rows("SELECT id,action,battery_id AS batteryId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 200", this.scope),
        ]);
        return { dataset: this.dataset, batteries, people, buildings, rooms, events: events.map(({ details_json, ...e }) => ({ ...e, details: JSON.parse(String(details_json)) })), actor: this.actor.name, hardwareConnected: false };
    }
    async detail(id: string) {
        await this.battery(id);
        const key = this.key(id);
        const [loans, charges, observations, events] = await Promise.all([
            this.rows("SELECT id,borrower_name AS borrowerName,checked_out_at AS checkedOutAt,returned_at AS returnedAt,cancelled_at AS cancelledAt,checkout_actor_name AS checkoutActorName,return_actor_name AS returnActorName,correction_reason AS correctionReason FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 200", this.scope, key),
            this.rows("SELECT id,completed_at AS completedAt,duration_minutes AS durationMinutes,percentage,actor_name AS actorName,recorded_at AS recordedAt FROM charges WHERE scope=? AND battery_key=? ORDER BY completed_at DESC,recorded_at DESC,rowid DESC LIMIT 200", this.scope, key),
            this.rows("SELECT o.id,COALESCE(o.room_name,'Room ID: ' || r.id) AS roomName,o.room_building AS roomBuilding,CASE WHEN o.room_name IS NULL THEN 'unavailable' ELSE 'recorded' END AS roomSnapshot,o.observed_at AS observedAt,o.received_at AS receivedAt,o.source FROM observations o JOIN rooms r ON r.key=o.room_key WHERE o.scope=? AND o.battery_key=? ORDER BY o.observed_at DESC,o.received_at DESC,o.rowid DESC LIMIT 200", this.scope, key),
            this.rows("SELECT id,action,battery_id AS batteryId,actor_name AS actorName,at,details_json FROM audit_events WHERE scope=? AND battery_id=? ORDER BY at DESC,rowid DESC LIMIT 200", this.scope, id),
        ]);
        return { loans, charges, observations, events: events.map(({ details_json, ...e }) => ({ ...e, details: JSON.parse(String(details_json)) })) };
    }
    async movement(input: unknown) {
        const v = movementSchema.parse(input), ids = uniqueIds(v.batteryIds), fingerprint = JSON.stringify({ kind: v.kind, ids, borrowerId: v.borrowerId ?? null });
        const old = await this.replay(v.requestId, v.kind, fingerprint);
        if (old)
            return old;
        const at = this.clock().toISOString(), keys = ids.map(id => this.key(id)), holes = keys.map(() => "?").join(",");
        const bs = await this.rows(`SELECT key,id FROM batteries WHERE scope=? AND key IN (${holes})`, this.scope, ...keys);
        if (bs.length !== ids.length)
            throw new DomainError(404, "One or more batteries are not registered in this inventory.");
        const writes: D1PreparedStatement[] = [];
        if (v.kind === "checkout") {
            if (!v.borrowerId)
                throw new DomainError(400, "Select a borrower before confirming a checkout.");
            const p = await this.first("SELECT * FROM people WHERE scope=? AND id=?", this.scope, v.borrowerId);
            if (!p)
                throw new DomainError(400, "Select a registered borrower.");
            for (const id of ids) {
                const loanId = crypto.randomUUID();
                writes.push(this.statement("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)", loanId, this.scope, this.key(id), p.key, p.name, at, this.actor.id, this.actor.name), this.event("checkout", id, { loanId, borrower: p.name, borrowerId: p.id }, at));
            }
            return this.atomic(v.requestId, v.kind, fingerprint, { kind: v.kind, batteryIds: ids, count: ids.length, borrower: p.name, at }, at, `(SELECT COUNT(*) FROM loans WHERE scope=? AND battery_key IN (${holes}) AND returned_at IS NULL AND cancelled_at IS NULL)=0`, [this.scope, ...keys], writes);
        }
        const open = await this.rows(`SELECT id,battery_key,borrower_name FROM loans WHERE scope=? AND battery_key IN (${holes}) AND returned_at IS NULL AND cancelled_at IS NULL`, this.scope, ...keys);
        if (open.length !== ids.length)
            throw new DomainError(409, "Every battery in a return must have an active loan. Review the list again.");
        for (const l of open) {
            const b = bs.find(b => b.key === l.battery_key)!;
            writes.push(this.statement("UPDATE loans SET returned_at=?,return_actor_id=?,return_actor_name=? WHERE id=? AND scope=?", at, this.actor.id, this.actor.name, l.id, this.scope), this.event("return", String(b.id), { loanId: l.id, borrower: l.borrower_name }, at));
        }
        const loanHoles = open.map(() => "?").join(",");
        return this.atomic(v.requestId, v.kind, fingerprint, { kind: v.kind, batteryIds: ids, count: ids.length, at }, at, `(SELECT COUNT(*) FROM loans WHERE scope=? AND id IN (${loanHoles}) AND returned_at IS NULL AND cancelled_at IS NULL)=?`, [this.scope, ...open.map(l => l.id), ids.length], writes);
    }
    async savePerson(input: unknown, update = false) {
        const p = personSchema.parse(input), at = this.clock().toISOString(), before = await this.first("SELECT * FROM people WHERE scope=? AND id=?", this.scope, p.id);
        if (update && !before)
            throw new DomainError(404, "Person not found.");
        if (!update && before)
            throw new DomainError(409, "That person ID is already registered.");
        const version = this.editVersion(before, p.expectedVersion);
        if (update && p.role !== "staff" && await this.first("SELECT id FROM batteries WHERE scope=? AND owner_key=? LIMIT 1", this.scope, this.key(p.id)))
            throw new DomainError(409, "This person owns registered batteries. Reassign their batteries to another staff owner before changing the role.");
        const kind = update ? "person_updated" : "person_registered";
        const write = update ? this.statement("UPDATE people SET name=?,reference=?,role=?,version=version+1 WHERE key=? AND scope=? AND version=?", p.name, p.reference, p.role, this.key(p.id), this.scope, p.expectedVersion) : this.statement("INSERT INTO people(key,scope,id,name,reference,role) VALUES(?,?,?,?,?,?)", this.key(p.id), this.scope, p.id, p.name, p.reference, p.role);
        return this.metadataWrite("people", kind, p.id, p, before, version, at, [write, this.event(kind, null, { before, after: { ...p, version } }, at)]);
    }
    async saveBuilding(input: unknown, update = false) {
        const b = buildingSchema.parse(input), at = this.clock().toISOString(), before = await this.first("SELECT * FROM buildings WHERE scope=? AND id=?", this.scope, b.id);
        if (update && !before) throw new DomainError(404, "Building not found.");
        if (!update && before) throw new DomainError(409, "That building code is already registered.");
        const version = this.editVersion(before, b.expectedVersion), kind = update ? "building_updated" : "building_registered";
        const write = update ? this.statement("UPDATE buildings SET name=?,version=version+1 WHERE key=? AND scope=? AND version=?", b.name, this.key(b.id), this.scope, b.expectedVersion) : this.statement("INSERT INTO buildings(key,scope,id,name) VALUES(?,?,?,?)", this.key(b.id), this.scope, b.id, b.name);
        return this.metadataWrite("buildings", kind, b.id, b, before, version, at, [write, this.event(kind, null, { before, after: { ...b, version } }, at)]);
    }
    async saveRoom(input: unknown, update = false) {
        const r = roomSchema.parse(input), at = this.clock().toISOString(), before = await this.first("SELECT * FROM rooms WHERE scope=? AND id=?", this.scope, r.id);
        if (update && !before)
            throw new DomainError(404, "Room not found.");
        if (!update && before)
            throw new DomainError(409, "That room ID is already registered.");
        const building = await this.first("SELECT key FROM buildings WHERE scope=? AND id=?", this.scope, r.buildingId);
        if (!building) throw new DomainError(400, "Select a registered building before adding a room.");
        const version = this.editVersion(before, r.expectedVersion), kind = update ? "room_updated" : "room_registered";
        const write = update ? this.statement("UPDATE rooms SET name=?,building_key=?,number=?,version=version+1 WHERE key=? AND scope=? AND version=?", r.name, building.key, r.number, this.key(r.id), this.scope, r.expectedVersion) : this.statement("INSERT INTO rooms(key,scope,id,name,building_key,number) VALUES(?,?,?,?,?,?)", this.key(r.id), this.scope, r.id, r.name, building.key, r.number);
        return this.metadataWrite("rooms", kind, r.id, r, before, version, at, [write, this.event(kind, null, { before, after: { ...r, version } }, at)]);
    }
    async saveBattery(input: unknown, update = false) {
        const b = batterySchema.parse(input), at = this.clock().toISOString();
        const [owner, building, room, before] = await Promise.all([
            this.first("SELECT key FROM people WHERE scope=? AND id=? AND role='staff'", this.scope, b.ownerId),
            b.homeBuildingId ? this.first("SELECT key FROM buildings WHERE scope=? AND id=?", this.scope, b.homeBuildingId) : null,
            b.homeRoomId ? this.first("SELECT key,building_key FROM rooms WHERE scope=? AND id=?", this.scope, b.homeRoomId) : null,
            this.first("SELECT * FROM batteries WHERE scope=? AND id=?", this.scope, b.id),
        ]);
        const retainedLegacyRoom = update && !b.homeBuildingId && room?.building_key === null && before?.home_building_key === null && before?.home_room_key === room?.key;
        if (!owner || (!building && !retainedLegacyRoom))
            throw new DomainError(400, "Select a registered staff owner and storage building. The room can stay unspecified.");
        if (b.homeRoomId && (!room || (building && room.building_key !== building.key)))
            throw new DomainError(400, "Select a room in the chosen storage building, or leave it unspecified.");
        if (update && !before)
            throw new DomainError(404, "Battery not found.");
        if (!update && before)
            throw new DomainError(409, "That battery ID is already registered.");
        const version = this.editVersion(before, b.expectedVersion), kind = update ? "battery_updated" : "battery_registered";
        const values = [b.name, b.chemistry, b.model, b.capacityMah, b.voltage, b.tagId, owner.key, building?.key ?? null, room?.key ?? null];
        const write = update ? this.statement("UPDATE batteries SET name=?,chemistry=?,model=?,capacity_mah=?,voltage=?,tag_id=?,owner_key=?,home_building_key=?,home_room_key=?,version=version+1 WHERE key=? AND scope=? AND version=?", ...values, this.key(b.id), this.scope, b.expectedVersion) : this.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(b.id), this.scope, b.id, ...values, at);
        try {
            return await this.metadataWrite("batteries", kind, b.id, b, before, version, at, [write, this.event(kind, b.id, { before, after: { ...b, version } }, at)]);
        }
        catch (e) {
            if (/UNIQUE/i.test(String(e)))
                throw new DomainError(409, "That battery ID or RFID identifier is already assigned.");
            throw e;
        }
    }
    async charge(input: unknown) {
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
        if (this.dataset !== "demo")
            throw new DomainError(501, "Real RFID room observations are not enabled. Hardware and room mapping must be validated first.");
        const v = observationSchema.parse(input), fingerprint = JSON.stringify(v), old = await this.replay(v.requestId, "observation", fingerprint);
        if (old)
            return old;
        const b = await this.battery(v.batteryId), r = await this.first("SELECT r.*,building.version AS building_version,COALESCE(building.id || ' - ' || building.name,r.building) AS building_label,CASE WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END AS room_label FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.scope=? AND r.id=?", this.scope, v.roomId);
        if (!r)
            throw new DomainError(400, "Select a registered room.");
        const at = this.clock().toISOString(), observedAt = validatePastTime(v.observedAt, this.clock()), id = crypto.randomUUID();
        return this.atomic(v.requestId, "observation", fingerprint, { id, batteryId: v.batteryId }, at, "(SELECT COUNT(*) FROM rooms r LEFT JOIN buildings building ON building.key=r.building_key WHERE r.key=? AND r.scope=? AND r.version=? AND building.version IS ?)=1", [r.key, this.scope, r.version, r.building_version], [
            this.statement("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)", id, this.scope, b.key, r.key, observedAt, at, "Demo observation", r.room_label, r.building_label),
            this.event("demo_observation", v.batteryId, { observationId: id, room: r.room_label, building: r.building_label, roomId: r.id, observedAt, source: "Demo observation" }, at),
        ]);
    }
    async correctLoan(input: unknown) {
        const v = correctionSchema.parse(input), fingerprint = JSON.stringify(v), old = await this.replay(v.requestId, "correction", fingerprint);
        if (old)
            return old;
        const l = await this.first("SELECT l.*,b.id AS battery_id FROM loans l JOIN batteries b ON b.key=l.battery_key WHERE l.scope=? AND l.id=?", this.scope, v.loanId);
        if (!l || l.cancelled_at)
            throw new DomainError(409, "This loan is unavailable for correction.");
        const latest = await this.first("SELECT id FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 1", this.scope, l.battery_key);
        if (latest?.id !== l.id)
            throw new DomainError(409, "Only the most recent loan can be corrected. Later movements must remain intact.");
        const at = this.clock().toISOString(), reopen = !!l.returned_at;
        const write = reopen ? this.statement("UPDATE loans SET returned_at=NULL,return_actor_id=NULL,return_actor_name=NULL,correction_reason=? WHERE id=? AND scope=?", v.reason, l.id, this.scope) : this.statement("UPDATE loans SET cancelled_at=?,correction_reason=? WHERE id=? AND scope=?", at, v.reason, l.id, this.scope);
        const condition = reopen ? "returned_at IS NOT NULL AND cancelled_at IS NULL" : "returned_at IS NULL AND cancelled_at IS NULL";
        return this.atomic(v.requestId, "correction", fingerprint, { id: l.id, action: reopen ? "return_reopened" : "checkout_voided" }, at, `(SELECT COUNT(*) FROM loans WHERE id=? AND scope=? AND ${condition})=1 AND (SELECT id FROM loans WHERE scope=? AND battery_key=? ORDER BY checked_out_at DESC,rowid DESC LIMIT 1)=?`, [l.id, this.scope, this.scope, l.battery_key, l.id], [write, this.event(reopen ? "return_reopened" : "checkout_voided", String(l.battery_id), { loanId: l.id, reason: v.reason, before: l }, at)]);
    }
    async importRecords(kind: string, records: unknown[]) {
        if (!Array.isArray(records) || !records.length || records.length > 200)
            throw new DomainError(400, "Import between 1 and 200 records at a time.");
        const at = this.clock().toISOString(), writes: D1PreparedStatement[] = [];
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
                if (!await this.first("SELECT key FROM buildings WHERE scope=? AND id=?", this.scope, r.buildingId))
                    throw new DomainError(400, `${r.id}: register its building first.`);
                writes.push(this.statement("INSERT INTO rooms(key,scope,id,name,building_key,number) VALUES(?,?,?,?,?,?)", this.key(r.id), this.scope, r.id, r.name, this.key(r.buildingId), r.number));
            }
        else if (kind === "batteries") {
            const people = await this.rows("SELECT id,role FROM people WHERE scope=?", this.scope), buildings = await this.rows("SELECT key,id FROM buildings WHERE scope=?", this.scope), rooms = await this.rows("SELECT id,building_key FROM rooms WHERE scope=?", this.scope);
            for (const raw of records) {
                const b = batterySchema.parse(raw);
                const building = buildings.find(x => x.id === b.homeBuildingId);
                if (!people.some(p => p.id === b.ownerId && p.role === "staff") || !building || (b.homeRoomId && !rooms.some(r => r.id === b.homeRoomId && r.building_key === building.key)))
                    throw new DomainError(400, `${b.id}: register its staff owner and building first, and select a room in that building or leave it unspecified.`);
                writes.push(this.statement("INSERT INTO batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", this.key(b.id), this.scope, b.id, b.name, b.chemistry, b.model, b.capacityMah, b.voltage, b.tagId, this.key(b.ownerId), this.key(b.homeBuildingId!), b.homeRoomId ? this.key(b.homeRoomId) : null, at));
            }
        }
        else
            throw new DomainError(400, "Choose people, buildings, rooms or batteries for import.");
        writes.push(this.event("records_imported", null, { kind, count: records.length }, at));
        try {
            await this.db.batch(writes);
        }
        catch (e) {
            if (/constraint|UNIQUE/i.test(String(e)))
                throw new DomainError(409, "An ID, room number or RFID identifier conflicts with existing records, or a related record changed. No rows were imported.");
            throw e;
        }
        return { kind, count: records.length };
    }
}
