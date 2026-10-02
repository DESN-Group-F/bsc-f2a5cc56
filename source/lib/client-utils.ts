import { calendarAge, currentSydneyDate, isDateOnly } from "./battery-age";
import { isSupportedBuilding } from "./location-catalog";

export type ExportDownloadFormat = "xlsx" | "csv" | "json";
export type DownloadAttachment = { blob: Blob; filename: string };
const downloadContentTypes: Record<ExportDownloadFormat, string> = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", json: "application/json" };
export async function readDownloadAttachment(response: Response, format: ExportDownloadFormat, fallbackFilename: string, validateJson?: (document: unknown) => boolean): Promise<DownloadAttachment> {
    if (!response.ok) {
        let message = `The download could not be prepared (${response.status}). Try again.`;
        try {
            const body = await response.json() as { error?: unknown };
            if (typeof body?.error === "string" && body.error.trim()) message = body.error;
        } catch { /* Non-JSON service errors still remain visible to the user. */ }
        throw new Error(message);
    }
    const disposition = response.headers.get("content-disposition") ?? "", type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!/^attachment(?:;|$)/i.test(disposition.trim()) || type !== downloadContentTypes[format])
        throw new Error("The server did not return the requested file. No file was downloaded. Try again.");
    let blob: Blob;
    try { blob = await response.blob(); }
    catch { throw new Error("The file transfer was interrupted. No file was downloaded. Try again."); }
    if (!blob.size) throw new Error("The server returned an empty file. No file was downloaded. Try again.");
    if (format === "json") {
        try {
            const document = JSON.parse(await blob.text()) as { metadata?: unknown; tables?: unknown };
            if (validateJson ? !validateJson(document) : !document || typeof document.metadata !== "object" || !document.metadata || typeof document.tables !== "object" || !document.tables) throw new Error("Invalid export document");
        } catch { throw new Error("The server returned an incomplete export. No file was downloaded. Try again."); }
    }
    const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    let filename = /(?:^|;)\s*filename="([^"]+)"/i.exec(disposition)?.[1] ?? /(?:^|;)\s*filename=([^;]+)/i.exec(disposition)?.[1]?.trim() ?? fallbackFilename;
    if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* Keep the basic filename when its encoded alternative is invalid. */ } }
    filename = filename.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim() || fallbackFilename;
    return { blob, filename };
}
export async function requestExportAttachment(input: unknown, format: ExportDownloadFormat, fallbackFilename: string): Promise<DownloadAttachment> {
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).length > 15000) throw new Error("This download request is too large. Select fewer batteries, or choose all filtered batteries or the current page.");
    let response: Response;
    try { response = await fetch(`/api/export?format=${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); }
    catch { throw new Error("The download request was interrupted. No file was downloaded. Try again."); }
    return readDownloadAttachment(response, format, fallbackFilename);
}
export async function downloadExportAttachment(input: unknown, format: ExportDownloadFormat, fallbackFilename: string) {
    saveDownloadAttachment(await requestExportAttachment(input, format, fallbackFilename));
}
function saveDownloadAttachment(attachment: DownloadAttachment) {
    const url = URL.createObjectURL(attachment.blob), link = document.createElement("a");
    try {
        link.href = url; link.download = attachment.filename;
        document.body.appendChild(link); link.click();
    } catch (error) { URL.revokeObjectURL(url); throw error; }
    finally { link.remove(); }
    // Keep the object URL available while the browser starts saving the file.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadTaskJson(url: string, fallbackFilename: string) {
    const request = new URL(url, "http://inventory.local"), messages = request.pathname === "/api/messages";
    let response: Response;
    try { response = await fetch(url, { cache: "no-store" }); }
    catch { throw new Error("The download request was interrupted. No file was downloaded. Try again."); }
    const attachment = await readDownloadAttachment(response, "json", fallbackFilename, value => {
        const document = value as { metadata?: { dataset?: unknown; scope?: unknown; exportedMessages?: unknown; exportedPlans?: unknown; exportedCycles?: unknown }; messages?: unknown[]; plans?: unknown[]; cycles?: unknown[] } | null;
        if (!document?.metadata || document.metadata.dataset !== (request.searchParams.get("dataset") ?? "demo")) return false;
        return messages ? document.metadata.scope === "personal_messages" && Array.isArray(document.messages) && document.metadata.exportedMessages === document.messages.length
            : document.metadata.scope === "shared_task_records" && Array.isArray(document.plans) && Array.isArray(document.cycles) && document.metadata.exportedPlans === document.plans.length && document.metadata.exportedCycles === document.cycles.length;
    });
    saveDownloadAttachment(attachment);
}

export function formatDateOnly(value: string | null | undefined) {
    if (!value) return "Not recorded";
    if (!isDateOnly(value)) return "Invalid recorded date";
    return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`));
}
export function formatBatteryAge(value: string | null | undefined, asOfOn = currentSydneyDate()) {
    if (!value) return "Not recorded";
    const age = calendarAge(value, asOfOn);
    if (!age) return "Age unavailable";
    const parts = ([ [age.years, "year"], [age.months, "month"], [age.days, "day"] ] as const).filter(([count]) => count > 0).map(([count, unit]) => `${count} ${unit}${count === 1 ? "" : "s"}`);
    return parts.length ? parts.join(", ") : "0 days";
}
export function dateOnlyOrNull(value: string, label: string) {
    if (!value.trim()) return null;
    if (!isDateOnly(value.trim())) throw new Error(`${label} must be a valid date in YYYY-MM-DD format or blank.`);
    return value.trim();
}

export function formatTime(value: string | null | undefined) {
    if (!value)
        return "Not recorded";
    return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
export function buildingLabel(building: { id: string; name: string }) { return `${building.id} - ${building.name}`; }
export function staffIdentityLabel(name: string, username: string | null | undefined, identityId: string) { return `${name} (${username?.trim() || identityId})`; }
export function roomLabel(room: { number: string | null; name: string; isPlaceholder?: boolean }) { return `${room.number && !room.isPlaceholder ? `${room.number} - ` : ""}${room.name}${room.isPlaceholder ? " — Placeholder" : ""}`; }
export function storageRoomLabel(battery: { homeRoomName: string | null; homeRoomNumber: string | null; homeBuildingId?: string | null; homeRoomIsPlaceholder?: boolean | null }) {
    if (battery.homeBuildingId && !isSupportedBuilding(battery.homeBuildingId)) return "Not available";
    return battery.homeRoomName ? roomLabel({ name: battery.homeRoomName, number: battery.homeRoomNumber, isPlaceholder: battery.homeRoomIsPlaceholder === true }) : "Room not specified";
}
export function durationLabel(minutes: number | null | undefined) { return minutes == null ? "Duration not recorded" : `${minutes} min`; }
export function sydneyInput(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
    const p = (type: string) => parts.find(p => p.type === type)?.value;
    return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
export function fromSydneyInput(value: string) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
        throw new Error("Enter a complete date and time.");
    const n = Date.parse(`${value}:00Z`);
    const matches = [10, 11].map(offset => new Date(n - offset * 3600000)).filter(d => sydneyInput(d) === value);
    if (matches.length !== 1)
        throw new Error("This Sydney time is invalid or ambiguous during a daylight-saving transition. Choose an unambiguous time.");
    return matches[0].toISOString();
}
export const actionNames: Record<string, string> = { task_plan_created: "Periodic task created", task_plan_updated: "Periodic task updated", task_cycle_completed: "Periodic task completed", task_cycle_created: "Periodic task opened", task_message_read: "Message read", checkout: "Checked out", return: "Returned", charge_recorded: "Charge recorded", demo_observation: "Demo room observation", battery_registered: "Battery registered", battery_updated: "Battery updated", person_registered: "Person registered", person_updated: "Person updated", building_registered: "Building registered", building_updated: "Building updated", room_registered: "Room registered", room_updated: "Room updated", checkout_voided: "Checkout corrected", return_reopened: "Return corrected", records_imported: "Records imported", demo_initialized: "Demonstration inventory initialized" };
export function csvCell(value: unknown) {
    let s = value == null ? "" : String(value);
    if (/^[=+@\-\t\r]/.test(s))
        s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
}
export function numberOrNull(value: string, label: string) {
    if (!value.trim())
        return null;
    const number = Number(value);
    if (!Number.isFinite(number))
        throw new Error(`${label} must be a valid number or blank.`);
    return number;
}
export function parseCsv(text: string): Record<string, string>[] {
    text = text.replace(/^\uFEFF/, "");
    const rows: string[][] = [];
    let row: string[] = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (quoted) {
                quoted = false;
            }
            else if (!cell) {
                quoted = true;
            }
            else
                throw new Error("Unexpected quote in CSV data.");
        }
        else if (ch === "," && !quoted) {
            row.push(cell);
            cell = "";
        }
        else if ((ch === "\n" || ch === "\r") && !quoted) {
            if (ch === "\r" && text[i + 1] === "\n")
                i++;
            row.push(cell);
            if (row.some(c => c.trim()))
                rows.push(row);
            row = [];
            cell = "";
        }
        else
            cell += ch;
    }
    if (quoted)
        throw new Error("A quoted CSV field is not closed.");
    row.push(cell);
    if (row.some(c => c.trim()))
        rows.push(row);
    const header = rows.shift()?.map(c => c.trim());
    if (!header?.length || new Set(header).size !== header.length)
        throw new Error("Use unique column names in the first row.");
    if (rows.length > 200)
        throw new Error("Import at most 200 rows at a time.");
    return rows.map((r, i) => { if (r.length !== header.length)
        throw new Error(`Row ${i + 2} has ${r.length} columns; expected ${header.length}.`); return Object.fromEntries(header.map((h, j) => [h, r[j].trim()])); });
}
/** Reload the server-rendered identity after session creation or revocation. */
export function reloadSessionPage(destination: string) {
    window.location.assign(destination);
}
export function importPayload(kind: string, rows: Record<string, string>[]) {
    const required = kind === "people" ? ["id", "name", "role"] : kind === "buildings" ? ["id", "name"] : kind === "rooms" ? ["id", "name", "building_id", "number"] : ["id", "name", "owner_id", "storage_building_id", "storage_room_id"];
    if (!rows.length)
        throw new Error("This file has no records.");
    for (const field of required)
        if (!(field in rows[0]))
            throw new Error(`Missing column: ${field}. Download the template.`);
    return rows.map(r => kind === "people" ? { id: r.id, name: r.name, reference: r.reference ?? "", role: r.role } : kind === "buildings" ? { id: r.id, name: r.name } : kind === "rooms" ? { id: r.id, name: r.name, buildingId: r.building_id, number: r.number, isPlaceholder: true } : { id: r.id, name: r.name, chemistry: r.chemistry ?? "", model: r.model ?? "", capacityMah: numberOrNull(r.capacity_mah ?? "", "Capacity"), voltage: numberOrNull(r.nominal_voltage ?? "", "Voltage"), manufacturedOn: dateOnlyOrNull(r.manufactured_on ?? "", "Manufactured on"), firstUsedOn: dateOnlyOrNull(r.first_used_on ?? "", "First used on"), tagId: r.rfid_tag_id || null, ownerId: r.owner_id, homeBuildingId: r.storage_building_id, homeRoomId: r.storage_room_id || null });
}
