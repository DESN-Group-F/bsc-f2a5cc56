import { z } from "zod";
import { DomainError, datasetSchema, identifier, uniqueIds, type BatteryRecord } from "./domain";
import { filterBatteries, sortBatteries, inventoryFilterSchema, exportSections, type ExportSection } from "./inventory-query";
import { ageInDays, currentSydneyDate } from "./battery-age";
import { batteryStatusLabel } from "./battery-lifecycle";
import { groupActivity, filterActivity } from "./group-activity";
import type { AuditEvent } from "./domain";
import type { InventoryStore } from "./store";
type Row = Record<string, unknown>;
export type ExportDocument = { metadata: Record<string, unknown>; tables: Record<string, Row[]> };
const sectionIds = exportSections.map(section => section.id) as [ExportSection, ...ExportSection[]];
const requestSchema = z.object({ dataset: datasetSchema, mode: z.enum(["summary", "detail", "records", "activity"]), activityScope: z.enum(["all", "mine"]).default("all"), activityGroupId: z.string().uuid().nullable().default(null), activityDepth: z.enum(["group_summary", "battery_details"]).default("group_summary"), activityIds: z.array(z.string().min(1).max(100)).optional(), range: z.enum(["filtered", "page", "selected"]).default("filtered"), batteryIds: z.array(identifier).optional(), filter: inventoryFilterSchema.default({}), page: z.number().int().nonnegative().default(0), pageSize: z.enum(["10", "25", "50", "100"]).default("25"), batteryId: identifier.optional(), sections: z.array(z.enum(sectionIds)).default(sectionIds), kind: z.enum(["people", "buildings", "rooms", "batteries"]).optional(), search: z.string().max(200).default("") });
const pick = (row: Row, columns: string[]) => Object.fromEntries(columns.map(column => [column, row[column] ?? null]));
export async function createExport(store: InventoryStore, input: unknown): Promise<ExportDocument> {
    const exportedAt = new Date(), ageAsOfDate = currentSydneyDate(exportedAt);
    const request = requestSchema.parse(input), selectedIds = uniqueIds(request.batteryIds ?? []);
    if (request.range === "selected") {
        if (request.batteryId || !["summary", "detail"].includes(request.mode))
            throw new DomainError(400, "Selected batteries apply to summary or detailed batch downloads. Use a single-battery request separately.");
        if (!selectedIds.length) throw new DomainError(400, "Select at least one battery before downloading selected records.");
    } else if (request.batteryIds !== undefined) {
        throw new DomainError(400, "Choose the selected-batteries range when supplying battery IDs.");
    }
    const source = await store.exportData(), raw = source.raw;
    const currentPeople = new Map(source.snapshot.people.map(person => [person.id, person]));
    const directoryPerson = (stored: Row) => {
        const current = currentPeople.get(stored.id);
        return current?.accountId ? { ...stored, name: current.name } : stored;
    };
    const all = source.snapshot.batteries as unknown as BatteryRecord[];
    const selected = new Set(selectedIds);
    const personalBase = filterBatteries(all, { personalScope: request.filter.personalScope, lifecycle: "all" }, ageAsOfDate, store.viewerAccountId);
    let matching = request.batteryId ? personalBase.filter(battery => battery.id === request.batteryId) : request.range === "selected" ? personalBase.filter(battery => selected.has(battery.id)) : filterBatteries(all, request.filter, ageAsOfDate, store.viewerAccountId, source.snapshot.teachingGroups ?? []);
    matching = sortBatteries(matching, request.filter, ageAsOfDate);
    if (request.range === "selected" && matching.length !== selectedIds.length)
        throw new DomainError(409, "One or more selected batteries are no longer available in this inventory or personal view. Refresh and review your selection. No partial download was prepared.");
    if (request.batteryId && !matching.length) throw new DomainError(404, "Battery not found in this inventory or personal view. Refresh and review its current responsibility or loan.");
    const matchingCount = matching.length;
    const teachingGroup = source.snapshot.teachingGroups?.find(group => group.id === request.filter.groupId && group.ownerAccountId === store.viewerAccountId && group.state === "active");
    const pageRange = !request.batteryId && request.range === "page";
    if (pageRange) matching = matching.slice(request.page * Number(request.pageSize), (request.page + 1) * Number(request.pageSize));
    const metadata = { exported_at_utc: exportedAt.toISOString(), age_as_of_date: ageAsOfDate, age_date_timezone: "Australia/Sydney", dataset: request.dataset, operator: source.snapshot.actor, mode: request.mode, range: request.batteryId ? "single" : request.range, filters: request.range === "selected" ? null : request.filter, selected_battery_ids: request.range === "selected" ? selectedIds : null, selection_filter_context: request.range === "selected" ? request.filter : null, page: pageRange ? request.page + 1 : null, page_size: pageRange ? Number(request.pageSize) : null, matching_batteries: matchingCount, exported_batteries: matching.length, selected_sections: request.mode === "detail" ? request.sections : null, timestamps: "UTC ISO 8601; battery lifecycle dates are YYYY-MM-DD", location_meaning: "Registered storage is the home; observations are dated evidence with their recorded source.", unknown_values: "Null or blank means not recorded; no history is inferred.", consistency: "All inventory and history tables read in one D1 batch." };
    Object.assign(metadata, { sort: { by: request.filter.sortBy, direction: request.filter.sortDirection, missing_values: "last", tie_breaker: "Battery ID ascending" }, teaching_group: teachingGroup ? { id: teachingGroup.id, name: teachingGroup.name, version: teachingGroup.version } : null });
    if (request.mode === "activity") {
        const rows = raw.audit_events.filter(row => request.activityScope === "all" || row.actor_id === store.viewerAccountId).reverse().sort((a,b) => String(b.at).localeCompare(String(a.at)));
        const events = rows.map(row => ({ id: String(row.id), action: String(row.action), batteryId: row.battery_id == null ? null : String(row.battery_id), actorName: String(row.actor_name), at: String(row.at), details: JSON.parse(String(row.details_json)) })) as AuditEvent[];
        const entries = groupActivity(events), selected = request.activityIds ? new Set(request.activityIds) : null;
        if (selected && !selected.size) throw new DomainError(400, "Select at least one activity operation.");
        const matching = selected ? entries.filter(entry => selected.has(entry.id)) : filterActivity(entries, request.search, request.activityGroupId);
        if (selected && matching.length !== selected.size) throw new DomainError(409, "Selected activity is unavailable in this inventory or personal activity scope. No partial export was prepared.");
        const rowById = new Map(rows.map(row => [String(row.id), row]));
        const summaries: Row[] = matching.map(entry => entry.teachingGroup ? { id: entry.id, scope: store.scope, action: entry.action, teaching_group_name: entry.teachingGroup.name, teaching_group_id: entry.teachingGroup.id, teaching_group_version: entry.teachingGroup.version, group_operation_id: entry.teachingGroup.operationId, affected_battery_count: entry.members!.length, actor_id: rowById.get(entry.members![0].id)!.actor_id, actor_name: entry.actorName, at: entry.at } : rowById.get(entry.id)!);
        const tables: Record<string, Row[]> = { Activity: summaries };
        if (request.activityDepth === "battery_details") {
            if (!request.sections.length) throw new DomainError(400, "Select at least one battery information section.");
            const memberEvents = matching.flatMap(entry => entry.members ?? []), ids = new Set(memberEvents.map(event => event.batteryId));
            tables.ActivityMembers = memberEvents.map(event => ({ group_activity_id: matching.find(entry => entry.members?.some(member => member.id === event.id))!.id, ...rowById.get(event.id)! }));
            Object.assign(tables, detailedBatteryTables(raw, all.filter(battery => ids.has(battery.id)), request.sections, ageAsOfDate, directoryPerson));
        }
        return { metadata: { ...metadata, activity_scope: request.activityScope, activity_group_id: selected ? null : request.activityGroupId, search: selected ? null : request.search, selection_filter_context: selected ? { search: request.search, groupId: request.activityGroupId } : null, selected_activity_ids: selected ? [...selected] : null, activity_depth: request.activityDepth, selected_sections: request.activityDepth === "battery_details" ? request.sections : null, exported_records: matching.length, group_history: "Group names and affected members are recorded at operation time; current battery sections are separately labelled." }, tables };
    }
    if (request.mode === "records") {
        if (!request.kind) throw new DomainError(400, "Select the directory to export.");
        const query = request.search.toLowerCase(), visible = source.snapshot[request.kind].filter(row => (request.kind !== "people" || !!row.accountId) && Object.values(row).join(" ").toLowerCase().includes(query));
        const records = visible.map(row => {
            const stored = raw[request.kind!].find(item => item.id === row.id)!;
            return request.kind === "people" ? directoryPerson(stored) : stored;
        });
        return { metadata: { ...metadata, search: request.search, exported_records: records.length }, tables: { [request.kind]: records } };
    }
    if (!matching.length) throw new DomainError(400, "No batteries match this export. Review the filters or page.");
    if (request.mode === "summary") {
        return { metadata, tables: { Inventory: matching.map(b => ({ battery_id: b.id, name: b.name, model: b.model, chemistry: b.chemistry, registered_at_utc: b.registeredAt, manufactured_on: b.manufacturedOn, first_used_on: b.firstUsedOn, manufacturing_age_days: ageInDays(b.manufacturedOn, ageAsOfDate), time_in_service_days: ageInDays(b.firstUsedOn, ageAsOfDate), age_as_of_date: ageAsOfDate, status: batteryStatusLabel(b), lifecycle_status: b.lifecycleStatus ?? "active", lifecycle_at_utc: b.lifecycleAt, lifecycle_reason: b.lifecycleReason, lifecycle_destination: b.lifecycleDestination, responsible_owner: b.ownerName, responsible_owner_account_id: b.ownerAccountId, current_borrower: b.borrowerName, current_borrower_account_id: b.borrowerAccountId, current_borrower_kind: b.borrowerKind, checked_out_at_utc: b.checkedOutAt, last_checked_out_at_utc: b.lastCheckedOutAt, storage_building_code: b.homeBuildingId, storage_building_name: b.homeBuildingName, storage_room_number: b.homeRoomNumber, storage_room_name: b.homeRoomName, storage_room_is_placeholder: b.homeRoomIsPlaceholder, storage_room_selectable: b.homeRoomSelectable, last_observed_room: b.observedRoom, last_observed_building: b.observedBuilding, observed_at_utc: b.observedAt, observation_source: b.observationSource, observation_label_status: b.observationRoomSnapshot })) } };
    }
    if (!request.sections.length) throw new DomainError(400, "Select at least one information section.");
    return { metadata, tables: detailedBatteryTables(raw, matching, request.sections, ageAsOfDate, directoryPerson) };
}
function detailedBatteryTables(raw: Record<string, Row[]>, matching: BatteryRecord[], sections: ExportSection[], ageAsOfDate: string, directoryPerson: (row: Row) => Row): Record<string, Row[]> {
    const ids = new Set(matching.map(b => b.id)), batteries = raw.batteries.filter(row => ids.has(String(row.id))), keys = new Set(batteries.map(row => String(row.key))), idByKey = new Map(batteries.map(row => [String(row.key), String(row.id)]));
    const loans = raw.loans.filter(row => keys.has(String(row.battery_key))), observations = raw.observations.filter(row => keys.has(String(row.battery_key))), charges = raw.charges.filter(row => keys.has(String(row.battery_key)));
    const current = matching.map(b => {
        const stored = batteries.find(row => row.id === b.id)!;
        const row: Row = { battery_id: b.id };
        if (sections.includes("specifications")) Object.assign(row, pick(stored, ["key", "scope", "name", "chemistry", "model", "capacity_mah", "voltage", "tag_id", "manufactured_on", "first_used_on", "created_at", "version", "lifecycle_status", "lifecycle_at", "lifecycle_reason", "lifecycle_destination"]), { registered_at_utc: b.registeredAt, manufacturing_age_days: ageInDays(b.manufacturedOn, ageAsOfDate), time_in_service_days: ageInDays(b.firstUsedOn, ageAsOfDate), age_as_of_date: ageAsOfDate });
        if (sections.includes("responsibility")) Object.assign(row, { owner_key: stored.owner_key, owner_id: b.ownerId, owner_name: b.ownerName, owner_account_id: b.ownerAccountId, status: batteryStatusLabel(b), lifecycle_status: b.lifecycleStatus ?? "active", lifecycle_at_utc: b.lifecycleAt, lifecycle_reason: b.lifecycleReason, lifecycle_destination: b.lifecycleDestination, current_loan_id: b.loanId, current_borrower_id: b.borrowerId, current_borrower_name: b.borrowerName, current_borrower_account_id: b.borrowerAccountId, current_borrower_kind: b.borrowerKind, checked_out_at_utc: b.checkedOutAt, last_checked_out_at_utc: b.lastCheckedOutAt });
        if (sections.includes("storage")) Object.assign(row, { home_building_key: stored.home_building_key, home_room_key: stored.home_room_key, home_building_id: b.homeBuildingId, home_building_name: b.homeBuildingName, home_room_id: b.homeRoomId, home_room_number: b.homeRoomNumber, home_room_name: b.homeRoomName, home_room_is_placeholder: b.homeRoomIsPlaceholder, home_room_selectable: b.homeRoomSelectable });
        if (sections.includes("latest")) Object.assign(row, { last_observed_room_id: b.observedRoomId, last_observed_room: b.observedRoom, last_observed_building: b.observedBuilding, observation_label_status: b.observationRoomSnapshot, observed_at_utc: b.observedAt, observation_source: b.observationSource, last_charge_completed_utc: b.chargedAt, last_charge_duration_minutes: b.chargeDurationMinutes });
        return row;
    });
    const tables: Record<string, Row[]> = { Batteries: current };
    const linked = (rows: Row[]) => rows.map(row => ({ battery_id: idByKey.get(String(row.battery_key)), ...row }));
    if (sections.includes("loans")) tables.Loans = linked(loans);
    if (sections.includes("observations")) tables.Observations = linked(observations);
    if (sections.includes("charges")) tables.Charges = linked(charges);
    if (sections.includes("audit")) {
        const related = raw.audit_events.filter(row => ids.has(String(row.battery_id)));
        const importRequests = new Set(related.filter(row => row.action === "battery_registered").map(row => JSON.parse(String(row.details_json)).importRequestId).filter(value => typeof value === "string" && value.length > 0));
        tables.Operations = raw.audit_events.filter(row => {
            if (ids.has(String(row.battery_id))) return true;
            if (row.battery_id !== null || row.action !== "records_imported") return false;
            const details = JSON.parse(String(row.details_json));
            return details.kind === "batteries" && importRequests.has(details.requestId);
        });
    }
    if (sections.includes("directories")) {
        const personKeys = new Set([...batteries.map(row => row.owner_key), ...loans.map(row => row.borrower_key)]), roomKeys = new Set([...batteries.map(row => row.home_room_key), ...observations.map(row => row.room_key)]);
        const rooms = raw.rooms.filter(row => roomKeys.has(row.key)), buildingKeys = new Set([...batteries.map(row => row.home_building_key), ...rooms.map(row => row.building_key)]);
        tables.People = raw.people.filter(row => personKeys.has(row.key)).map(directoryPerson); tables.Rooms = rooms; tables.Buildings = raw.buildings.filter(row => buildingKeys.has(row.key));
    }
    return tables;
}
