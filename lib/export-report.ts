import type { ExportDocument } from "./exports";

type Row = Record<string, unknown>;
export type HumanReport = {
    title: string;
    description: string;
    facts: { label: string; value: string | number }[];
    sheets: { name: string; description: string; columns?: string[]; rows: Row[] }[];
    glossary: { term: string; meaning: string }[];
};
const missing = "Not recorded";
const own = (row: Row, field: string) => Object.prototype.hasOwnProperty.call(row, field);
const text = (value: unknown): string => value == null || value === "" ? missing : String(value);
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const flag = (value: unknown) => value == null ? missing : value === true || value === 1 ? "Yes" : "No";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : missing;
const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());

/** Excel stores timezone-free dates; these values contain the labelled Sydney wall clock. */
export function reportTimestamp(value: unknown): Date | string {
    if (value == null || value === "") return missing;
    const instant = new Date(String(value));
    if (!Number.isFinite(instant.getTime())) return `Invalid recorded timestamp: ${String(value)}`;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant).map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}
export function reportDate(value: unknown): Date | string {
    if (value == null || value === "") return missing;
    const raw = String(value), date = new Date(`${raw}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(date.getTime()) && date.toISOString().startsWith(raw) ? date : `Invalid recorded date: ${raw}`;
}
function dateText(value: Date | string) {
    return value instanceof Date ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value) : value;
}
function details(row: Row): Row {
    if (typeof row.details_json !== "string") return object(row.details);
    try { return object(JSON.parse(row.details_json)); } catch { return {}; }
}
const lifecycle = (value: unknown) => value === "permanently_removed" ? "Permanently removed" : value === "scrapped" ? "Scrapped" : value === "active" ? "Active" : text(value);
function observedAddress(row: Row, roomKey: string, buildingKey: string, statusKey?: string) {
    if (statusKey && row[statusKey] === "unavailable") return "Recorded address unavailable";
    const parts = [row[buildingKey], row[roomKey]].filter(value => value != null && value !== "");
    return parts.length ? parts.join(" · ") : "Recorded address unavailable";
}
function storedAddress(row: Row, prefix: "storage" | "home") {
    const parts = [row[`${prefix}_building_code`] ?? row[`${prefix}_building_id`], row[`${prefix}_building_name`], row[`${prefix}_room_number`], row[`${prefix}_room_name`]].filter(value => value != null && value !== "");
    const label = parts.length ? parts.join(" · ") : missing;
    return row[`${prefix}_room_is_placeholder`] === true || row[`${prefix}_room_is_placeholder`] === 1 ? `${label} · Placeholder (not verified storage)` : label;
}
type Column = [field: string, label: string, format?: (value: unknown) => unknown];
function columns(row: Row, definitions: Column[]): Row {
    return Object.fromEntries(definitions.filter(([field]) => own(row, field)).map(([field, label, format]) => [label, format ? format(row[field]) : text(row[field])]));
}
function batteryRow(row: Row): Row {
    const result: Row = { "Battery ID": text(row.battery_id ?? row.id) };
    Object.assign(result, columns(row, [
        ["name", "Battery name"], ["status", "Current status"], ["model", "Model"], ["chemistry", "Chemistry"],
        ["capacity_mah", "Capacity (mAh)", number], ["voltage", "Voltage (V)", number], ["tag_id", "RFID tag"],
        ["responsible_owner", "Responsible owner (current name)"], ["owner_name", "Responsible owner (current name)"],
        ["current_borrower", "Current borrower (name at checkout)"], ["current_borrower_name", "Current borrower (name at checkout)"],
        ["checked_out_at_utc", "Current checkout (Sydney)", reportTimestamp], ["last_checked_out_at_utc", "Latest checkout (Sydney)", reportTimestamp],
        ["total_checkouts", "Total checkouts", number], ["completed_checkouts", "Completed checkouts", number], ["active_checkouts", "Active checkouts", number],
        ["total_checked_out_seconds", "Total checked-out time (hours)", value => typeof value === "number" && Number.isFinite(value) ? Math.round(value / 36) / 100 : "Unavailable: incomplete or inconsistent timestamps"],
        ["usage_as_of_utc", "Borrowing measured to (Sydney)", reportTimestamp], ["invalid_duration_count", "Loans with incomplete or inconsistent times", number],
    ]));
    const storagePrefix = own(row, "storage_building_name") ? "storage" : own(row, "home_building_name") ? "home" : null;
    if (storagePrefix) result["Registered storage home"] = storedAddress(row, storagePrefix);
    if (own(row, "last_observed_room")) result["Last observed location (saved evidence)"] = row.observed_at_utc ? observedAddress(row, "last_observed_room", "last_observed_building", "observation_label_status") : "No observation recorded";
    Object.assign(result, columns(row, [
        ["observed_at_utc", "Last observed (Sydney)", reportTimestamp], ["observation_source", "Location evidence source"],
        ["last_charge_completed_utc", "Last charge completed (Sydney)", reportTimestamp], ["last_charge_duration_minutes", "Last charge duration (minutes)", number],
        ["registered_at_utc", "Registered (Sydney)", reportTimestamp], ["manufactured_on", "Manufactured on", reportDate], ["first_used_on", "First used on", reportDate],
        ["manufacturing_age_days", "Age since manufacture (days)", number], ["time_in_service_days", "Time in service (days)", number], ["age_as_of_date", "Age calculated on (Sydney date)", reportDate],
        ["service_age_as_of_date", "Service age measured to (Sydney date)", reportDate],
        ["lifecycle_status", "Asset lifecycle", lifecycle], ["lifecycle_at_utc", "Retired (Sydney)", reportTimestamp], ["lifecycle_reason", "Retirement reason"], ["lifecycle_destination", "Retirement destination"],
    ]));
    if (!own(row, "registered_at_utc") && own(row, "created_at")) result["Registered (Sydney)"] = reportTimestamp(row.created_at);
    if (!own(row, "lifecycle_at_utc") && own(row, "lifecycle_at")) result["Retired (Sydney)"] = reportTimestamp(row.lifecycle_at);
    if ((row.current_borrower == null && row.current_borrower_name == null) && row.status === "In store") result["Current borrower (name at checkout)"] = "No active checkout";
    return result;
}
function loanRow(row: Row, exportedAt: unknown): Row {
    const end = row.cancelled_at ?? row.returned_at ?? exportedAt;
    const elapsed = Date.parse(String(end)) - Date.parse(String(row.checked_out_at));
    return {
        "Battery ID": text(row.battery_id), "Borrower (name at checkout)": text(row.borrower_name),
        "Loan status": row.cancelled_at ? "Checkout voided" : row.returned_at ? "Returned" : "In use",
        "Checked out (Sydney)": reportTimestamp(row.checked_out_at), "Checkout recorded by": text(row.checkout_actor_name),
        "Checked in (Sydney)": row.cancelled_at ? "Not applicable: checkout voided" : row.returned_at ? reportTimestamp(row.returned_at) : "Not yet returned",
        "Check-in recorded by": text(row.return_actor_name),
        "Time out (hours)": row.cancelled_at ? "Not applicable: checkout voided" : Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed / 36000) / 100 : missing,
        "Duration measured to": row.cancelled_at ? "Checkout voided" : row.returned_at ? "Recorded check-in" : "Borrowing calculation time (still in use)",
        "Checkout voided (Sydney)": reportTimestamp(row.cancelled_at), "Correction reason": text(row.correction_reason),
    };
}
const inspectionKinds: Record<string, string> = { visual_check: "Visual check", functional_check: "Functional check", capacity_measurement: "Capacity measurement", other: "Other check" };
const inspectionOutcomes: Record<string, string> = { no_concern_observed: "No concern observed", concern_observed: "Concern observed", inconclusive: "Inconclusive" };
function inspectionRow(row: Row): Row {
    return {
        "Battery ID": text(row.batteryId ?? row.battery_id), "Record status": row.voidedAt ? "Voided: retained for history" : "Recorded",
        "Check performed (Sydney)": reportTimestamp(row.performedAt), "Inspector (name at recording)": text(row.inspectorName),
        "Check type": inspectionKinds[String(row.kind)] ?? text(row.kind), "Recorded outcome": inspectionOutcomes[String(row.outcome)] ?? text(row.outcome),
        "Method and conditions": text(row.method), "Findings and notes": text(row.notes), "Evidence reference": text(row.reference),
        "Measured capacity (mAh)": number(row.capacityMah), "Recorded (Sydney)": reportTimestamp(row.recordedAt),
        "Voided (Sydney)": reportTimestamp(row.voidedAt), "Voided by (name at correction)": text(row.voidedByName), "Void reason": text(row.voidReason),
    };
}
const actionNames: Record<string, string> = {
    checkout: "Checked out", return: "Checked in", battery_registered: "Battery registered", battery_updated: "Battery details updated",
    battery_scrapped: "Battery scrapped", battery_permanently_removed: "Battery permanently removed", charge_recorded: "Charging recorded",
    inspection_recorded: "Inspection recorded", inspection_voided: "Inspection record voided",
    demo_observation: "Demo location observation", checkout_voided: "Checkout voided", return_reopened: "Check-in reversed (loan reopened)",
    location_beacon_created: "Room beacon mapping created", location_beacon_updated: "Room beacon mapping updated",
    location_observation_recorded: "Simulated last observation recorded", location_scan_unresolved: "Room scan unresolved",
    records_imported: "Records imported", demo_initialized: "Demonstration inventory initialized", staff_directory_linked: "Staff account linked to directory",
    person_registered: "Person registered", person_updated: "Person updated", building_registered: "Building registered", building_updated: "Building updated",
    room_registered: "Room registered", room_updated: "Room updated", battery_model_registered: "Reusable battery model created", battery_model_updated: "Reusable battery model updated",
    task_plan_created: "Task plan created", task_plan_updated: "Task plan updated", task_plan_removed: "Task plan removed", task_plan_restored: "Task plan restored",
    task_cycle_created: "Task occurrence opened", task_cycle_completed: "Task completed", task_message_removed: "Message removed from inbox", task_message_restored: "Message restored to inbox", task_message_read: "Message marked read",
};
const changedLabels: Record<string, string> = { name: "battery name", model: "model", chemistry: "chemistry", capacityMah: "capacity", capacity_mah: "capacity", voltage: "voltage", tagId: "RFID tag", tag_id: "RFID tag", ownerId: "responsible owner", owner_key: "responsible owner", homeBuildingId: "storage building", home_building_key: "storage building", homeRoomId: "storage room", home_room_key: "storage room", manufacturedOn: "manufacture date", manufactured_on: "manufacture date", firstUsedOn: "first-use date", first_used_on: "first-use date" };
function operationSummary(action: string, detail: Row, row: Row): string {
    const run = object(detail.teachingCheckout ?? row.teaching_checkout_run);
    if (Array.isArray(run.mappings)) {
        const mappings = run.mappings as Row[];
        const affected = object(detail.teachingGroup).batteryIds;
        const relevant = row.battery_id ? mappings.filter(mapping => object(mapping.actual).batteryId === row.battery_id) : action === "return" && Array.isArray(affected) ? mappings.filter(mapping => affected.includes(object(mapping.actual).batteryId)) : mappings;
        return `${action === "return" ? "Recorded actual loans returned" : "Temporary teaching checkout"}: ${relevant.map(mapping => `${text(object(mapping.original).batteryId)} → ${text(object(mapping.actual).batteryId)} (${mapping.method === "manual" ? "Manual alternative" : mapping.method === "automatic" ? "Same known model and specifications" : "Original member"}; loan ${text(mapping.loanId)})`).join("; ")}. Fixed group membership is unchanged.`;
    }
    if (row.teaching_group_name) return `${text(row.affected_battery_count)} batteries affected in the recorded group operation. Historic member evidence is included only when requested.`;
    const placement = object(detail.returnPlacement), after = object(detail.after), before = object(detail.before);
    switch (action) {
        case "location_observation_recorded": return `Last observation recorded from ${text(detail.source)}. Observed room: ${text(object(detail.room).name)}. This does not confirm the battery's present location or change its loan.`;
        case "location_scan_unresolved": return `Room scan outcome: ${text(detail.outcome)}. No new location observation was saved; earlier evidence remains unchanged.`;
        case "location_beacon_created": case "location_beacon_updated": return `Room beacon mapping: ${text(after.label)}. Room: ${text(after.roomName)}. Configuration alone does not observe or move a battery.`;
        case "checkout": return `Borrower: ${text(detail.borrower)}. A recorded checkout marks the battery In use; it is not live power sensing.`;
        case "return": return `Returned from ${text(detail.borrower)}. ${Object.keys(placement).length ? `Placement: ${observedAddress(placement, "roomName", "building")}; source: ${text(placement.source)}; observed ${dateText(reportTimestamp(placement.observedAt))} (Sydney).` : "No return location confirmation recorded."}`;
        case "battery_registered": return `${text(after.name)} registered${detail.registrationSource === "csv" ? " from a CSV import" : ""}. Registration does not establish an unknown manufacture date.`;
        case "battery_updated": {
            const changed = [...new Set(Object.keys(changedLabels).filter(key => own(after, key) && JSON.stringify(after[key]) !== JSON.stringify(before[key])).map(key => changedLabels[key]))];
            return changed.length ? `Changed: ${changed.join(", ")}. Before and after values are retained in the evidence appendix.` : "Saved battery details changed. See the evidence appendix for before and after values.";
        }
        case "charge_recorded": return `Completed ${dateText(reportTimestamp(detail.completedAt))} (Sydney); duration: ${text(detail.durationMinutes)} minutes; source: ${text(detail.source)}.`;
        case "inspection_recorded": return "A staff-entered inspection was recorded. Method, findings and original evidence are retained; this does not automatically certify battery safety or health.";
        case "inspection_voided": return `An inspection was voided as a correction. Reason: ${text(detail.reason)}. The original record is retained.`;
        case "demo_observation": return `Recorded location: ${observedAddress(detail, "room", "building")}; observed ${dateText(reportTimestamp(detail.observedAt))} (Sydney); source: ${text(detail.source)}.`;
        case "checkout_voided": case "return_reopened": return `Reason: ${text(detail.reason)}. Original evidence is retained.`;
        case "battery_scrapped": case "battery_permanently_removed": return `Reason: ${text(detail.reason)}. Destination: ${text(detail.destination)}. The asset and its history are retained.`;
        case "records_imported": return `${text(detail.count)} ${text(detail.kind)} records imported.`;
        case "demo_initialized": return text(detail.note);
        case "task_plan_created": case "task_plan_updated": return `Task: ${text(after.title)}. ${text(detail.note)}`;
        case "task_cycle_created": return `Task due on ${text(detail.dueOn)} opened. This records outstanding work, not an inspection or completion.`;
        case "task_cycle_completed": return `Task due on ${text(detail.dueOn)} completed. Completion notes: ${text(detail.completionNotes)}. This is a staff-entered record, not automatic safety certification.`;
        case "task_message_removed": case "task_message_restored": case "task_message_read": return "Only the signed-in account's inbox state changed. This does not complete the task.";
        case "person_registered": case "person_updated": case "room_registered": case "room_updated": case "building_registered": case "building_updated": return `Recorded name: ${text(after.name)}. Full saved values are in the evidence appendix.`;
        default: return "Full recorded details are retained in the evidence appendix; no additional interpretation has been inferred.";
    }
}
function nativeIdentificationNote(detail: Row): string {
    if (detail.source !== "native_nfc" && object(detail.scan).source !== "native_nfc") return "";
    const evidence = object(detail.nfcEvidence ?? object(detail.reviewedBinding).nfcEvidence);
    return ` Identification source: native NFC (device-reported).${evidence.tagId ? ` Adopted tag: ${text(evidence.tagId)}.` : ""} Complete UID, raw NDEF and device timestamps remain in the original evidence; they do not attest security, chip model or location.`;
}
function activityRow(row: Row): Row {
    const detail = details(row), group = object(detail.teachingGroup), action = String(row.action ?? "");
    return {
        "Recorded at (Sydney)": reportTimestamp(row.at), "Operation": actionNames[action] ?? "Other recorded operation",
        "Battery ID": text(row.battery_id), "Teaching group (name at operation)": text(row.teaching_group_name ?? group.name),
        "Affected batteries": own(row, "affected_battery_count") ? number(row.affected_battery_count) : row.battery_id ? 1 : "Not applicable",
        "Recorded by (name at operation)": text(row.actor_name), "What happened": operationSummary(action, detail, row) + nativeIdentificationNote(detail),
    };
}
function filterSummary(metadata: Row): string {
    if (metadata.range === "selected" && metadata.mode !== "activity") return "Explicitly selected batteries; ordinary filters do not remove selected records. The personal-view boundary still applies.";
    if (Array.isArray(metadata.selected_activity_ids)) return "Explicitly selected activity operations; search, group and current battery filters do not remove selected records. The authenticated personal activity boundary still applies.";
    const activity = metadata.mode === "activity";
    const filter = activity ? object(metadata.activity_battery_filter) : metadata.mode === "records" && metadata.kind !== "batteries" ? {} : object(metadata.filters), names = object(activity ? metadata.activity_battery_filter_labels : metadata.filter_labels), parts: string[] = [];
    if (activity && Object.keys(filter).length) parts.push("Battery criteria apply to the current register");
    const labels: Record<string, string> = { status: "Status", lifecycle: "Lifecycle", building: "Storage building", room: "Storage room", owner: "Responsible owner", holder: "Current borrower", observedRoom: "Last observed room", chemistry: "Chemistry", model: "Model", search: "Search" };
    if (activity) labels.search = "Battery search";
    const values: Record<string, string> = { in: "In store", out: "In use", active: "Active assets", scrapped: "Scrapped", permanently_removed: "Permanently removed", __unspecified: "Room not recorded", __legacy: "Historical borrower without a native account", __not_observed: "No observation recorded", __unavailable: "Recorded address unavailable" };
    for (const [key, label] of Object.entries(labels)) {
        const value = filter[key];
        if (value == null || value === "" || value === "all") continue;
        const reference = ["building", "room", "owner", "holder", "observedRoom"].includes(key);
        parts.push(`${label}: ${names[key] ?? values[String(value)] ?? (reference ? "Saved selection (identifier in evidence appendix)" : text(value))}`);
    }
    if (filter.modelUnknown) parts.push("Model: not recorded");
    if (filter.mappingRoom) parts.push(`Last-observation room scope: ${text(object(metadata.fixed_mapping_scope).directoryLabel || filter.mappingRoom)} (not confirmed present location)`);
    if (filter.newArrivalsOnly) parts.push("New arrivals: first registered within the last 48 hours, active assets only");
    if (filter.chemistryUnknown) parts.push("Chemistry: not recorded");
    for (const [prefix, label, low, high, unit] of [["capacity", "Capacity", "capacityMinMah", "capacityMaxMah", "mAh"], ["voltage", "Voltage", "voltageMin", "voltageMax", "V"], ["age", "Age since manufacture", "ageMinDays", "ageMaxDays", "days"], ["checkout", "Latest checkout date", "checkoutFrom", "checkoutTo", "Sydney dates"], ["charge", "Latest charge date", "chargeFrom", "chargeTo", "Sydney dates"]]) {
        if (filter[`${prefix}Mode`] === "unknown") parts.push(`${label}: not recorded`);
        else if (filter[low] != null || filter[high] != null) parts.push(`${label}: ${filter[low] ?? "no minimum"} to ${filter[high] ?? "no maximum"} ${unit}`);
        else if (filter[`${prefix}Mode`] === "known") parts.push(`${label}: recorded values only`);
    }
    if (metadata.search) parts.push(`${activity && Object.keys(filter).length ? "Activity search" : "Search"}: ${text(metadata.search)}`);
    if (metadata.activity_group_id) parts.push("Recorded teaching-group operations only (historic names appear in the Activity sheet)");
    const group = object(activity ? metadata.activity_battery_teaching_group : metadata.teaching_group);
    if (group.name) parts.push(`${activity ? "Current battery membership in teaching group" : "Teaching group"}: ${text(group.name)}`);
    if (activity && filter.personalScope === "responsible") parts.push("Current batteries for which I am responsible");
    if (activity && filter.personalScope === "borrowed") parts.push("Current batteries checked out to me");
    return parts.length ? parts.join("; ") : "No additional filters";
}
/** Human views never mutate or replace the original export document and its complete evidence. */
export function createHumanReport(document: ExportDocument): HumanReport {
    const metadata = document.metadata, mode = String(metadata.mode ?? ""), sheets: HumanReport["sheets"] = [];
    for (const [name, rows] of Object.entries(document.tables)) {
        const key = name.toLowerCase();
        if (["inventory", "batteries"].includes(key)) sheets.push({ name: key === "inventory" ? "Inventory" : "Battery details", description: "Current battery records at report creation. Only requested information sections are included; In use means a recorded checkout.", rows: rows.map(batteryRow) });
        else if (key === "loans") sheets.push({ name: "Check-in and checkout", description: "Every selected loan, including returned and voided checkouts. Names are preserved as recorded at the time; active durations run to the borrowing calculation time stated in the Report guide.", rows: rows.map(row => loanRow(row, metadata.usage_as_of_utc ?? metadata.exported_at_utc)) });
        else if (key === "observations") sheets.push({ name: "Location history", description: "Dated location evidence, not a live location feed. Saved historical labels are used; unavailable labels are never replaced by today's directory names.", rows: rows.map(row => ({ "Battery ID": text(row.battery_id), "Observed (Sydney)": reportTimestamp(row.observed_at), "Saved location": observedAddress(row, "room_name", "room_building"), "Evidence source": text(row.source), "Received by system (Sydney)": reportTimestamp(row.received_at) })) });
        else if (key === "charges") sheets.push({ name: "Charging history", description: "Every selected charge record. Duration is in minutes; legacy percentages are preserved separately and never converted into a duration.", rows: rows.map(row => ({ "Battery ID": text(row.battery_id), "Completed (Sydney)": reportTimestamp(row.completed_at), "Duration (minutes)": number(row.duration_minutes), "Recorded by": text(row.actor_name), "Recorded (Sydney)": reportTimestamp(row.recorded_at), "Legacy recorded charge (%)": number(row.percentage) })) });
        else if (key === "inspections") sheets.push({ name: "Inspection history", description: "Every selected staff-entered check, including voided evidence. Outcomes describe recorded findings, not automatic safety certification, battery health or charge/discharge cycles.", rows: rows.map(inspectionRow), columns: ["Battery ID", "Record status", "Check performed (Sydney)", "Inspector (name at recording)", "Check type", "Recorded outcome", "Method and conditions", "Findings and notes", "Evidence reference", "Measured capacity (mAh)", "Recorded (Sydney)", "Voided (Sydney)", "Voided by (name at correction)", "Void reason"] });
        else if (["activity", "activitymembers", "operations"].includes(key)) sheets.push({ name: key === "activitymembers" ? "Group member operations" : key === "operations" ? "Battery operation history" : "Activity", description: "Recorded operations and the names saved with them. Explanations summarize evidence; the complete original records remain in the technical appendix.", rows: rows.map(activityRow) });
        else if (key === "people") sheets.push({ name: "People directory", description: "Referenced directory entries. Native account display names are current at export; historical loan and operation names remain unchanged in their own sheets. Owner IDs are used when importing batteries.", rows: rows.map(row => ({ "Name": text(row.name), "Owner ID for imports": text(row.id), "Directory role": row.role === "staff" ? "Staff" : row.role === "borrower" ? "Historical borrower" : text(row.role), "Reference": text(row.reference), "Native staff account linked": row.account_id ? "Yes" : "No" })) });
        else if (key === "rooms") sheets.push({ name: "Rooms directory", description: "Current directory labels and selection availability. A placeholder is an example location, not verified storage evidence. Room IDs are available for imports.", rows: rows.map(row => ({ "Room number": text(row.number), "Room name": text(row.name), "Room ID for imports": text(row.id), "Building code": text(row.building_code), "Building name": text(row.building_name ?? row.building), "Placeholder": flag(row.is_placeholder), "Available for selection": flag(row.selectable) })) });
        else if (key === "buildings") sheets.push({ name: "Buildings directory", description: "Current building codes and names. A listed building is not necessarily selectable for new registration.", rows: rows.map(row => ({ "Building code": text(row.id), "Building name": text(row.name) })) });
        else if (key === "accounts") sheets.push({ name: "Staff accounts", description: "Current staff account settings across both inventories. Passwords, authentication versions and session credentials are never part of this report.", rows: rows.map(row => ({ "Name": text(row.displayName), "Username": text(row.username), "Role": row.role === "admin" ? "Administrator" : row.role === "staff" ? "Staff" : text(row.role), "Account status": row.active === true || row.active === 1 ? "Active" : row.active === false || row.active === 0 ? "Disabled" : missing, "Email": text(row.email), "Default inventory": row.defaultDataset === "demo" ? "Demonstration inventory" : row.defaultDataset === "live" ? "Working inventory" : missing, "Created (Sydney)": reportTimestamp(row.createdAt), "Last updated (Sydney)": reportTimestamp(row.updatedAt) })), columns: ["Name", "Username", "Role", "Account status", "Email", "Default inventory", "Created (Sydney)", "Last updated (Sydney)"] });
        else if (key === "teaching_mappings") sheets.push({ name: "Actual checkout mapping", description: "Original fixed members and batteries actually borrowed. Manual alternatives may differ or have unknown specifications. Loan status refers to the saved exact loan, including returns made outside this screen.", rows: rows.map(row => {
            const original = object(row.original_snapshot), actual = object(row.actual_snapshot);
            return { "Original fixed member": text(row.original_battery_id), "Actual battery": text(row.actual_battery_id), "Selection method": row.selection_method === "manual" ? "Manual alternative" : row.selection_method === "automatic" ? "Same known model and specifications" : "Original member", "Input source": row.input_source === "native_nfc" ? "Native NFC" : row.input_source === "tag" ? "Entered registered tag" : row.input_source === "selection" ? "Inventory selection" : "Deleted evidence", "Original model": text(original.model), "Actual model": text(actual.model), "Original chemistry": text(original.chemistry), "Actual chemistry": text(actual.chemistry), "Original capacity (mAh)": number(original.capacityMah), "Actual capacity (mAh)": number(actual.capacityMah), "Original voltage (V)": number(original.voltage), "Actual voltage (V)": number(actual.voltage), "Recorded differences": Array.isArray(row.specification_differences) && row.specification_differences.length ? row.specification_differences.join("; ") : row.strict_specification_match === null ? "Deleted evidence" : "No recorded differences", "Actual registered room": text(actual.homeRoomName), "Placeholder room": flag(actual.homeRoomIsPlaceholder), "Exact loan ID": text(row.actual_loan_id), "Exact loan status": text(row.exact_loan_status), "Returned (Sydney)": reportTimestamp(row.returned_at_utc) };
        }) });
        else if (key === "teaching_evidence") continue;
        else sheets.push({ name: words(name), description: "Additional recorded data. Original field names and complete values are also retained in the evidence appendix.", rows: rows.map(row => {
            const projected: Row = {};
            for (const [field, value] of Object.entries(row)) {
                const label = words(field);
                projected[own(projected, label) ? `${label} (${field})` : label] = value ?? missing;
            }
            return projected;
        }) });
    }
    if (mode === "accounts") return {
        title: "Staff account report", description: "Administrator download of the current account directory and chosen search results. This report does not contain passwords or session credentials.", sheets,
        facts: [
            { label: "Report created (Sydney)", value: dateText(reportTimestamp(metadata.exported_at_utc)) }, { label: "Prepared by", value: text(metadata.operator) },
            { label: "Inventory", value: "Global staff accounts (both inventories)" }, { label: "Download scope", value: "All matching staff accounts" },
            { label: "Accounts included", value: document.tables.Accounts?.length ?? 0 }, { label: "Filters", value: metadata.search ? `Search: ${text(metadata.search)}` : "No search filter" },
            { label: "Dates and times", value: "Times are shown in Australia/Sydney, including daylight-saving changes. Original UTC timestamps remain in the evidence appendix." },
            { label: "Access", value: "Only administrators can download this directory. It lists current account settings, not a history of every account change." },
        ],
        glossary: [
            { term: "Active / Disabled", meaning: "Active accounts may sign in. Disabled accounts cannot sign in; their historical operations remain attributed to them." },
            { term: "Default inventory", meaning: "The account's preferred starting inventory. It does not limit access to records or change responsibility for batteries." },
            { term: "Internal account ID / Version", meaning: "Technical references for identity and change control. They are retained in the evidence appendix; usernames are the normal sign-in reference." },
            { term: "Not recorded", meaning: "No value was saved, for example an optional email address. No replacement value is inferred." },
        ],
    };
    if (mode === "teaching_checkout") return { title: "Teaching checkout report", description: text(metadata.note), sheets, facts: [{ label: "Report created (Sydney)", value: dateText(reportTimestamp(metadata.exported_at_utc)) }, { label: "Borrower at checkout", value: text(metadata.actorName) }, { label: "Inventory", value: text(metadata.dataset) }, { label: "Fixed teaching group at checkout", value: `${text(object(metadata.teachingGroup).name)} · Version ${text(object(metadata.teachingGroup).version)}` }, { label: "Checkout recorded (Sydney)", value: dateText(reportTimestamp(metadata.createdAtUtc)) }, { label: "Actual batteries", value: document.tables.teaching_mappings?.length ?? 0 }], glossary: [{ term: "Manual alternative", meaning: "Explicitly selected and reviewed by the teacher. It may have different or unknown specifications; the system does not certify teaching suitability." }, { term: "Exact loan status", meaning: "Derived from the saved loan ID. A later checkout of the same battery is a separate loan and is never substituted." }, { term: "Registered room", meaning: "Saved storage home at checkout, including whether it was a placeholder. It is not a physical location reading." }, { term: "Native NFC / Entered registered tag", meaning: "Native NFC preserves the adopted platform reader evidence. Entered registered tag is text input and is not a hardware read. Original evidence is retained in the technical appendix." }] };
    const title = mode === "summary" ? "Battery inventory report" : mode === "detail" ? "Battery detail and history report" : mode === "activity" ? "Activity report" : mode === "records" ? "Directory report" : "Data report";
    const filter = object(metadata.filters ?? metadata.selection_filter_context), scope = filter.personalScope;
    const facts: HumanReport["facts"] = [
        { label: "Report created (Sydney)", value: dateText(reportTimestamp(metadata.exported_at_utc)) },
        { label: "Prepared by", value: text(metadata.operator) },
        { label: "Inventory", value: metadata.dataset === "demo" ? "Demonstration inventory (fictional data)" : metadata.dataset === "live" ? "Working inventory" : text(metadata.dataset) },
        { label: "Included records", value: typeof metadata.exported_records === "number" ? metadata.exported_records : typeof metadata.exported_batteries === "number" ? metadata.exported_batteries : Object.values(document.tables)[0]?.length ?? 0 },
        { label: "Download scope", value: Array.isArray(metadata.selected_activity_ids) ? "Selected operations" : metadata.range === "selected" ? "Selected batteries" : metadata.range === "page" ? `Current page ${text(metadata.page)}` : metadata.range === "single" ? "One battery" : "All matching records across all pages" },
        { label: "Personal scope", value: metadata.activity_scope === "mine" ? "My recorded operations" : scope === "responsible" ? "Batteries for which I am responsible" : scope === "borrowed" ? "Batteries currently checked out to me" : "Shared inventory records" },
        { label: "Filters", value: filterSummary(metadata) },
        { label: "Dates and times", value: "Display times use Australia/Sydney, including daylight-saving changes. Original UTC timestamps remain in the evidence appendix. Date-only values have no time of day." },
        { label: "Unknown information", value: "Not recorded means no value was saved. It does not mean zero, a passed test or a confirmed location." },
        { label: "Using this workbook", value: "Read the named report sheets for daily work. Evidence sheets preserve original database fields for tracing and technical review; they are not extra tasks to complete." },
    ];
    if (metadata.usage_as_of_utc) facts.push({ label: "Borrowing calculated as of (Sydney)", value: dateText(reportTimestamp(metadata.usage_as_of_utc)) });
    if (metadata.fixed_mapping_scope) facts.push({ label: "Last-observation room scope", value: `${text(object(metadata.fixed_mapping_scope).directoryLabel)}. Applies to every download range, including selected and single batteries. This is recorded evidence, not a confirmed present location.` });
    if (mode === "activity") facts.push({ label: "Activity detail", value: metadata.activity_depth === "battery_details" ? "Recorded operations, original group member evidence and the selected current battery information sections" : "Recorded operation summaries; group member details and current battery sections were not requested" });
    if (mode === "activity" && metadata.activity_battery_filter_meaning) facts.push({ label: "Battery filter meaning", value: text(metadata.activity_battery_filter_meaning) });
    if (Array.isArray(metadata.selected_sections)) facts.push({ label: "Included information sections", value: metadata.selected_sections.map(value => ({ specifications: "Identity and specifications", responsibility: "Responsibility and borrowing summary", storage: "Registered storage", latest: "Latest observation and charge", loans: "Complete loan history", observations: "Complete location history", charges: "Complete charging history", inspections: "Complete inspection history", audit: "Complete operation history", directories: "Related people and locations" }[String(value)] ?? words(String(value)))).join("; ") });
    return {
        title, description: "A readable report of the selected records, followed by complete technical evidence for traceability.", facts, sheets,
        glossary: [
            { term: "In store / In use", meaning: "Based on the recorded loan: In use has an active checkout; In store does not. Neither status is a live physical or power measurement." },
            { term: "Responsible owner / Borrower", meaning: "The responsible owner maintains the asset record. The borrower holds the current checkout. They can be different people." },
            { term: "Registered storage / Observed location", meaning: "Registered storage is the intended home. An observed location is separately dated evidence with its own source; neither is inferred from the other." },
            { term: "Check-in and checkout duration", meaning: "Calculated from recorded timestamps, in hours rounded to two decimal places. An open loan is measured to the borrowing calculation time in the Report guide; a voided checkout has no valid duration." },
            { term: "Total checkouts / Total checked-out time", meaning: "Calculated from the complete recorded borrowing history. Voided checkouts are excluded; a reopened return remains the same checkout. Open loans run to the borrowing calculation time in the Report guide, captured after the inventory snapshot was read. Zero means no recorded borrowing, not proof that the battery was never used. These are not charge/discharge cycles or battery health measurements." },
            { term: "Unavailable borrowing duration", meaning: "One or more retained loans has incomplete, invalid or inconsistent timestamps. No partial total is presented as a complete duration; original timestamps remain in the loan evidence." },
            { term: "Time in service", meaning: "Calendar days since the recorded first-use date. For a retired asset, this stops at the recorded retirement date. Manufacture age remains separate; missing dates are not inferred." },
            { term: "Inspection history", meaning: "Staff-entered checks with the inspector, performed time, method, findings and optional evidence reference. Capacity measurements retain their method and conditions without estimating battery health or remaining life. Voided checks remain visible as correction evidence and do not count as a current inspection." },
            { term: "Evidence sheets", meaning: "Complete source records for checking how a report was produced. Internal IDs join related records; scope identifies the inventory, version supports change control, and JSON holds structured saved details." },
            { term: "Report guide", meaning: "Explains who created this download, which records were included, and how to read its sheets. It does not change the inventory or require any action." },
        ],
    };
}
