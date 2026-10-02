import { z } from "zod";
import { DomainError, datasetSchema, identifier, type BatteryRecord } from "./domain";
import { filterBatteries, inventoryFilterSchema, exportSections, type ExportSection } from "./inventory-query";
import type { InventoryStore } from "./store";
type Row = Record<string, unknown>;
export type ExportDocument = { metadata: Record<string, unknown>; tables: Record<string, Row[]> };
const sectionIds = exportSections.map(section => section.id) as [ExportSection, ...ExportSection[]];
const requestSchema = z.object({ dataset: datasetSchema, mode: z.enum(["summary", "detail", "records", "activity"]), range: z.enum(["filtered", "page"]).default("filtered"), filter: inventoryFilterSchema.default({}), page: z.number().int().nonnegative().default(0), pageSize: z.enum(["10", "25", "50", "100"]).default("25"), batteryId: identifier.optional(), sections: z.array(z.enum(sectionIds)).default(sectionIds), kind: z.enum(["people", "buildings", "rooms", "batteries"]).optional(), search: z.string().max(200).default("") });
const pick = (row: Row, columns: string[]) => Object.fromEntries(columns.map(column => [column, row[column] ?? null]));
export async function createExport(store: InventoryStore, input: unknown): Promise<ExportDocument> {
    const request = requestSchema.parse(input), source = await store.exportData(), raw = source.raw;
    const all = source.snapshot.batteries as unknown as BatteryRecord[];
    let matching = request.batteryId ? all.filter(battery => battery.id === request.batteryId) : filterBatteries(all, request.filter);
    if (request.batteryId && !matching.length) throw new DomainError(404, "Battery not found in this inventory.");
    const matchingCount = matching.length;
    if (request.range === "page") matching = matching.slice(request.page * Number(request.pageSize), (request.page + 1) * Number(request.pageSize));
    const metadata = { exported_at_utc: new Date().toISOString(), dataset: request.dataset, operator: source.snapshot.actor, mode: request.mode, range: request.batteryId ? "single" : request.range, filters: request.filter, page: request.range === "page" ? request.page + 1 : null, page_size: request.range === "page" ? Number(request.pageSize) : null, matching_batteries: matchingCount, exported_batteries: matching.length, selected_sections: request.mode === "detail" ? request.sections : null, timestamps: "UTC ISO 8601", location_meaning: "Registered storage is the home; observations are dated evidence with their recorded source.", unknown_values: "Null or blank means not recorded; no history is inferred.", consistency: "All inventory and history tables read in one D1 batch." };
    if (request.mode === "activity") {
        const query = request.search.toLowerCase();
        const events = raw.audit_events.filter(row => `${row.action} ${row.battery_id ?? ""} ${row.actor_name} ${row.details_json} ${row.at}`.toLowerCase().includes(query));
        return { metadata: { ...metadata, search: request.search, exported_records: events.length }, tables: { Activity: events } };
    }
    if (request.mode === "records") {
        if (!request.kind) throw new DomainError(400, "Select the directory to export.");
        const query = request.search.toLowerCase(), visible = source.snapshot[request.kind].filter(row => Object.values(row).join(" ").toLowerCase().includes(query));
        const records = visible.map(row => raw[request.kind!].find(item => item.id === row.id)!);
        return { metadata: { ...metadata, search: request.search, exported_records: records.length }, tables: { [request.kind]: records } };
    }
    if (!matching.length) throw new DomainError(400, "No batteries match this export. Review the filters or page.");
    if (request.mode === "summary") {
        return { metadata, tables: { Inventory: matching.map(b => ({ battery_id: b.id, name: b.name, status: b.loanId ? "On loan" : "In store", responsible_owner: b.ownerName, current_borrower: b.borrowerName, storage_building_code: b.homeBuildingId, storage_building_name: b.homeBuildingName, storage_room_number: b.homeRoomNumber, storage_room_name: b.homeRoomName, last_observed_room: b.observedRoom, last_observed_building: b.observedBuilding, observed_at_utc: b.observedAt, observation_source: b.observationSource, observation_label_status: b.observationRoomSnapshot })) } };
    }
    if (!request.sections.length) throw new DomainError(400, "Select at least one information section.");
    const ids = new Set(matching.map(b => b.id)), batteries = raw.batteries.filter(row => ids.has(String(row.id))), keys = new Set(batteries.map(row => String(row.key))), idByKey = new Map(batteries.map(row => [String(row.key), String(row.id)]));
    const loans = raw.loans.filter(row => keys.has(String(row.battery_key))), observations = raw.observations.filter(row => keys.has(String(row.battery_key))), charges = raw.charges.filter(row => keys.has(String(row.battery_key)));
    const current = matching.map(b => {
        const stored = batteries.find(row => row.id === b.id)!;
        const row: Row = { battery_id: b.id };
        if (request.sections.includes("specifications")) Object.assign(row, pick(stored, ["key", "scope", "name", "chemistry", "model", "capacity_mah", "voltage", "tag_id", "created_at", "version"]));
        if (request.sections.includes("responsibility")) Object.assign(row, { owner_key: stored.owner_key, owner_id: b.ownerId, owner_name: b.ownerName, status: b.loanId ? "On loan" : "In store", current_loan_id: b.loanId, current_borrower_id: b.borrowerId, current_borrower_name: b.borrowerName, checked_out_at_utc: b.checkedOutAt });
        if (request.sections.includes("storage")) Object.assign(row, { home_building_key: stored.home_building_key, home_room_key: stored.home_room_key, home_building_id: b.homeBuildingId, home_building_name: b.homeBuildingName, home_room_id: b.homeRoomId, home_room_number: b.homeRoomNumber, home_room_name: b.homeRoomName });
        if (request.sections.includes("latest")) Object.assign(row, { last_observed_room: b.observedRoom, last_observed_building: b.observedBuilding, observation_label_status: b.observationRoomSnapshot, observed_at_utc: b.observedAt, observation_source: b.observationSource, last_charge_completed_utc: b.chargedAt, last_charge_duration_minutes: b.chargeDurationMinutes });
        return row;
    });
    const tables: Record<string, Row[]> = { Batteries: current };
    const linked = (rows: Row[]) => rows.map(row => ({ battery_id: idByKey.get(String(row.battery_key)), ...row }));
    if (request.sections.includes("loans")) tables.Loans = linked(loans);
    if (request.sections.includes("observations")) tables.Observations = linked(observations);
    if (request.sections.includes("charges")) tables.Charges = linked(charges);
    if (request.sections.includes("audit")) tables.Operations = raw.audit_events.filter(row => ids.has(String(row.battery_id)) || (row.battery_id === null && ["records_imported", "demo_initialized"].includes(String(row.action))));
    if (request.sections.includes("directories")) {
        const personKeys = new Set([...batteries.map(row => row.owner_key), ...loans.map(row => row.borrower_key)]), roomKeys = new Set([...batteries.map(row => row.home_room_key), ...observations.map(row => row.room_key)]);
        const rooms = raw.rooms.filter(row => roomKeys.has(row.key)), buildingKeys = new Set([...batteries.map(row => row.home_building_key), ...rooms.map(row => row.building_key)]);
        tables.People = raw.people.filter(row => personKeys.has(row.key)); tables.Rooms = rooms; tables.Buildings = raw.buildings.filter(row => buildingKeys.has(row.key));
    }
    return { metadata, tables };
}
