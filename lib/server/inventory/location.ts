import { canonicalModelJson } from "../../battery-models";
import { DomainError, type Dataset } from "../../domain";
import { locationBeaconRequestSchema, locationCaptureSchema, SIMULATED_LOCATION_SOURCE, type LocationBeacon, type LocationBeaconReceipt, type LocationCaptureReceipt, type LocationDirectorySnapshot } from "../../location-observations";
import { rejectPurgedReplay } from "../purge-evidence";
import { InventorySession, type Actor } from "./actor";
import { InventoryDatabase, type Row } from "./database";
import { InventoryTransactions } from "./transactions";
import { ensureInventoryReferenceData } from "./provisioning";

type Receipt = LocationBeaconReceipt | LocationCaptureReceipt;
type Kind = "location_beacon" | "location_capture";
const beaconSelect = "SELECT d.*,r.id AS room_id,r.name AS room_name,r.number AS room_number,r.version AS room_version,r.is_placeholder,r.selectable,b.id AS building_id,b.name AS building_name,b.version AS building_version FROM location_beacons d JOIN rooms r ON r.key=d.room_key AND r.scope=d.scope JOIN buildings b ON b.key=r.building_key AND b.scope=r.scope";

/** Room mappings and per-scan evidence; neither changes a loan or registered home. */
export class LocationStore {
  private database: InventoryDatabase;
  private session: InventorySession;
  private transactions: InventoryTransactions;

  constructor(db: D1Database, scope: string, dataset: Dataset, actor: Actor, clock: () => Date = () => new Date()) {
    this.database = new InventoryDatabase(db, scope);
    this.session = new InventorySession(dataset, actor, clock);
    this.transactions = new InventoryTransactions(this.database, this.session);
  }

  private async authorize(admin = false) {
    const actor = this.session.actor;
    if (actor.authVersion === undefined) throw new DomainError(401, "Sign in with an active staff account.");
    const account = await this.database.first("SELECT display_name FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('staff','admin')", actor.id, actor.authVersion, actor.role);
    if (!account || admin && actor.role !== "admin") throw new DomainError(403, admin ? "Only administrators can manage room beacons or record demonstration observations." : "Your staff account access changed. Sign in again.");
    this.session.actor.name = String(account.display_name);
  }

  private accountGuard() {
    return { sql: "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)", values: [this.session.actor.id, this.session.actor.authVersion, this.session.actor.role] };
  }

  private async replay(requestId: string, kind: Kind, fingerprint: string): Promise<Receipt | null> {
    const row = await this.database.first("SELECT kind,fingerprint,result_json FROM operations WHERE id=? AND scope=?", this.database.key(requestId), this.database.scope);
    if (!row) return null;
    const result = rejectPurgedReplay(row.result_json, "location_rejected_final");
    if (row.kind !== kind || row.fingerprint !== fingerprint) throw new DomainError(409, "This request identifier was already used for different content.", "idempotency_conflict");
    if (result.rejected) throw new DomainError(Number(result.status), String(result.error), "location_rejected_final");
    return { ...result, replayed: true } as Receipt;
  }

  private async execute<T extends Receipt>(payload: { requestId: string; batteryId?: string }, kind: Kind, work: (fingerprint: string) => Promise<T>): Promise<T> {
    const fingerprint = canonicalModelJson({ dataset: this.session.dataset, actorAccountId: this.session.actor.id, payload });
    const previous = await this.replay(payload.requestId, kind, fingerprint);
    if (previous) return previous as T;
    try { return await work(fingerprint); }
    catch (error) {
      const saved = await this.replay(payload.requestId, kind, fingerprint);
      if (saved) return saved as T;
      if (!(error instanceof DomainError) || ![400, 404, 409, 422].includes(error.status) || error.code === "idempotency_conflict") throw error;
      await this.authorize(kind === "location_beacon" || this.session.dataset === "demo");
      const auth = this.accountGuard();
      try {
        await this.database.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN (${auth.sql}) THEN 1 ELSE 0 END`, this.database.key(payload.requestId), this.database.scope, kind, fingerprint,
          JSON.stringify({ rejected: true, status: error.status, error: error.message, ...(payload.batteryId ? { batteryId: payload.batteryId } : {}) }), this.session.clock().toISOString(), ...auth.values).run();
      } catch (reservationError) {
        const committed = await this.replay(payload.requestId, kind, fingerprint);
        if (committed) return committed as T;
        throw reservationError;
      }
      throw new DomainError(error.status, error.message, "location_rejected_final");
    }
  }

  private async commit<T extends Receipt>(kind: Kind, result: T, fingerprint: string, at: string, guard: string, values: unknown[], writes: D1PreparedStatement[]): Promise<T> {
    const auth = this.accountGuard();
    try {
      await this.database.raw.batch([
        this.database.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN (${guard}) AND (${auth.sql}) THEN 1 ELSE 0 END`, this.database.key(result.requestId), this.database.scope, kind, fingerprint, JSON.stringify(result), at, ...values, ...auth.values),
        ...writes,
      ]);
      return result;
    } catch (error) {
      const saved = await this.replay(result.requestId, kind, fingerprint);
      if (saved) return saved as T;
      if (/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(String(error))) throw new DomainError(409, "The reviewed battery, room beacon, room or account changed. Nothing in this request was saved.", "location_conflict");
      throw error;
    }
  }

  private beacon(row: Row): LocationBeacon {
    return { id: String(row.id), label: String(row.label), identifier: String(row.identifier), roomId: String(row.room_id), roomVersion: Number(row.room_version), buildingVersion: Number(row.building_version), roomName: this.roomLabel(row), buildingId: String(row.building_id), buildingName: String(row.building_name), roomIsPlaceholder: row.is_placeholder === 1, roomSelectable: row.selectable === 1, version: Number(row.version), active: row.active === 1, hardwareValidated: false, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  private roomLabel(row: Row) {
    return row.is_placeholder === 1 ? `${row.room_name} — Placeholder` : row.room_number === null ? String(row.room_name) : `${row.room_number} - ${row.room_name}`;
  }

  async list(): Promise<LocationDirectorySnapshot> {
    await this.authorize();
    await ensureInventoryReferenceData(this.database);
    const rows = await this.database.rows(`${beaconSelect} WHERE d.scope=? ORDER BY d.id`, this.database.scope);
    return { dataset: this.session.dataset, beacons: rows.map(row => this.beacon(row)), capabilities: { hardwareIngestion: false, demoSimulation: this.session.dataset === "demo" && this.session.actor.role === "admin", manageBeacons: this.session.actor.role === "admin" } };
  }

  async saveBeacon(input: unknown): Promise<LocationBeaconReceipt> {
    await this.authorize(true);
    const payload = locationBeaconRequestSchema.parse(input);
    return this.execute(payload, "location_beacon", async fingerprint => {
      const before = await this.database.first(`${beaconSelect} WHERE d.scope=? AND d.id=?`, this.database.scope, payload.id);
      if (payload.action === "create" && before) throw new DomainError(409, "This room beacon ID is already registered.");
      if (payload.action === "update" && (!before || before.version !== payload.expectedVersion)) throw new DomainError(409, "This room beacon changed. Reload its mapping before saving.");
      const room = await this.database.first("SELECT r.key AS room_key,r.id AS room_id,r.name AS room_name,r.number AS room_number,r.version AS room_version,r.is_placeholder,r.selectable,b.id AS building_id,b.name AS building_name,b.version AS building_version FROM rooms r JOIN buildings b ON b.key=r.building_key AND b.scope=r.scope WHERE r.scope=? AND r.id=?", this.database.scope, payload.roomId);
      if (!room || room.building_id !== "J18" || room.selectable !== 1 || this.session.dataset === "live" && room.is_placeholder === 1) throw new DomainError(400, "Select an available J18 room. Working-inventory mappings require a verified room.");
      if (room.room_version !== payload.roomVersion || room.building_version !== payload.buildingVersion) throw new DomainError(409, "The selected room or building changed. Reload the directory before saving this mapping.");
      const at = this.session.clock().toISOString(), nextVersion = before ? Number(before.version) + 1 : 1;
      const beacon = this.beacon({ ...room, id: payload.id, label: payload.label, identifier: payload.identifier, active: Number(payload.active), version: nextVersion, created_at: before?.created_at ?? at, updated_at: at });
      const guard = `${before ? "EXISTS(SELECT 1 FROM location_beacons WHERE scope=? AND id=? AND version=?)" : "NOT EXISTS(SELECT 1 FROM location_beacons WHERE scope=? AND id=?)"} AND EXISTS(SELECT 1 FROM rooms r JOIN buildings b ON b.key=r.building_key WHERE r.key=? AND r.scope=? AND r.version=? AND r.selectable=1 AND b.version=? AND b.id='J18' AND (?=0 OR r.is_placeholder=0))`;
      const values = [this.database.scope, payload.id, ...(before ? [before.version] : []), room.room_key, this.database.scope, room.room_version, room.building_version, Number(this.session.dataset === "live")];
      const write = before
        ? this.database.statement("UPDATE location_beacons SET label=?,identifier=?,room_key=?,active=?,version=version+1,updated_at=?,updated_by=?,updated_auth_version=? WHERE scope=? AND id=? AND version=?", payload.label, payload.identifier, room.room_key, Number(payload.active), at, this.session.actor.id, this.session.actor.authVersion, this.database.scope, payload.id, before.version)
        : this.database.statement("INSERT INTO location_beacons(key,scope,id,label,identifier,room_key,active,version,created_at,updated_at,updated_by,updated_auth_version) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)", this.database.key(payload.id), this.database.scope, payload.id, payload.label, payload.identifier, room.room_key, Number(payload.active), at, at, this.session.actor.id, this.session.actor.authVersion);
      return this.commit("location_beacon", { requestId: payload.requestId, dataset: this.session.dataset, actorAccountId: this.session.actor.id, beacon, replayed: false }, fingerprint, at, guard, values, [write, this.transactions.event(before ? "location_beacon_updated" : "location_beacon_created", null, { requestId: payload.requestId, before: before ? this.beacon(before) : null, after: beacon, hardwareIngestion: false }, at)]);
    });
  }

  async record(input: unknown): Promise<LocationCaptureReceipt> {
    await this.authorize();
    const payload = locationCaptureSchema.parse(input);
    if (payload.source === "phone_ble_scan") throw new DomainError(501, "Phone Bluetooth location ingestion is unavailable until the hardware, native reader evidence and room mapping have been validated.", "location_hardware_unavailable");
    await this.authorize(true);
    if (this.session.dataset !== "demo") throw new DomainError(400, "Simulated room scans are available only in the demonstration inventory.");
    return this.execute(payload, "location_capture", async fingerprint => {
      const at = this.session.clock().toISOString(), observedAt = new Date(payload.capturedAt).toISOString();
      if (Date.parse(observedAt) > Date.parse(at)) throw new DomainError(400, "The scan time cannot be later than the server receipt time. Correct the device time before creating a new scan.");
      const battery = await this.database.first("SELECT key,id,tag_id,version,lifecycle_status FROM batteries WHERE scope=? AND id=?", this.database.scope, payload.batteryId);
      if (!battery) throw new DomainError(404, "This battery is not registered in the selected inventory.");
      if (battery.tag_id !== payload.tagId || battery.version !== payload.expectedBatteryVersion || battery.lifecycle_status !== "active") throw new DomainError(409, "The scanned battery, tag binding or version changed. Review the current battery before capturing new evidence.");
      const candidates = payload.candidates.length ? await this.database.rows(`${beaconSelect} WHERE d.scope=? AND d.id IN (SELECT value FROM json_each(?))`, this.database.scope, JSON.stringify(payload.candidates.map(candidate => candidate.beaconId))) : [];
      if (candidates.length !== payload.candidates.length || payload.candidates.some(candidate => !candidates.some(row => row.id === candidate.beaconId && row.version === candidate.version && row.active === 1 && row.selectable === 1 && row.building_id === "J18"))) throw new DomainError(409, "A reviewed room beacon or its room changed. Refresh the mapping and capture a new scan.");
      const roomKeys = new Set(candidates.map(row => row.room_key));
      const resolved = roomKeys.size === 1 ? candidates[0] : null;
      const outcome = resolved ? "recorded" : roomKeys.size > 1 ? "ambiguous" : "unresolved";
      const observationId = resolved ? crypto.randomUUID() : null;
      const room = resolved ? { id: String(resolved.room_id), name: this.roomLabel(resolved), buildingId: String(resolved.building_id), buildingName: String(resolved.building_name), isPlaceholder: resolved.is_placeholder === 1 } : null;
      const result: LocationCaptureReceipt = { requestId: payload.requestId, dataset: this.session.dataset, actorAccountId: this.session.actor.id, batteryId: payload.batteryId, outcome, observationId, room, source: SIMULATED_LOCATION_SOURCE, capturedAt: observedAt, receivedAt: at, replayed: false };
      const reviewedMappings = candidates.map(row => ({ key: row.key, version: row.version, roomKey: row.room_key, roomVersion: row.room_version, buildingVersion: row.building_version }));
      const guard = "EXISTS(SELECT 1 FROM batteries WHERE scope=? AND key=? AND version=? AND tag_id IS ? AND lifecycle_status='active') AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM location_beacons d JOIN rooms r ON r.key=d.room_key AND r.scope=d.scope JOIN buildings b ON b.key=r.building_key AND b.scope=r.scope WHERE d.scope=? AND d.key=json_extract(j.value,'$.key') AND d.version=json_extract(j.value,'$.version') AND d.active=1 AND d.room_key=json_extract(j.value,'$.roomKey') AND r.version=json_extract(j.value,'$.roomVersion') AND r.selectable=1 AND b.version=json_extract(j.value,'$.buildingVersion') AND b.id='J18'))";
      const writes: D1PreparedStatement[] = [];
      if (resolved && room) writes.push(this.database.statement("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)", observationId, this.database.scope, battery.key, resolved.room_key, observedAt, at, SIMULATED_LOCATION_SOURCE, room.name, `${room.buildingId} - ${room.buildingName}`));
      writes.push(this.transactions.event(resolved ? "location_observation_recorded" : "location_scan_unresolved", payload.batteryId, { ...result, capture: payload, mappings: candidates.map(row => this.beacon(row)), locationMeaning: "Dated simulated evidence only; no loan or registered storage was changed." }, at));
      return this.commit("location_capture", result, fingerprint, at, guard, [this.database.scope, battery.key, payload.expectedBatteryVersion, payload.tagId, JSON.stringify(reviewedMappings), this.database.scope], writes);
    });
  }
}
