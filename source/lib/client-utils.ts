export function formatTime(value: string | null | undefined) {
    if (!value)
        return "Not recorded";
    return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
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
export const actionNames: Record<string, string> = { checkout: "Checked out", return: "Returned", charge_recorded: "Charge recorded", demo_observation: "Demo room observation", battery_registered: "Battery registered", battery_updated: "Battery updated", person_registered: "Person registered", person_updated: "Person updated", room_registered: "Room registered", room_updated: "Room updated", checkout_voided: "Checkout corrected", return_reopened: "Return corrected", records_imported: "Records imported", demo_initialized: "Demonstration inventory initialized" };
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
export function importPayload(kind: string, rows: Record<string, string>[]) {
    const required = kind === "people" ? ["id", "name", "role"] : kind === "rooms" ? ["id", "name"] : ["id", "name", "owner_id", "storage_room_id"];
    if (!rows.length)
        throw new Error("This file has no records.");
    for (const field of required)
        if (!(field in rows[0]))
            throw new Error(`Missing column: ${field}. Download the template.`);
    return rows.map(r => kind === "people" ? { id: r.id, name: r.name, reference: r.reference ?? "", role: r.role } : kind === "rooms" ? { id: r.id, name: r.name, building: r.building ?? "" } : { id: r.id, name: r.name, chemistry: r.chemistry ?? "", model: r.model ?? "", capacityMah: numberOrNull(r.capacity_mah ?? "", "Capacity"), voltage: numberOrNull(r.nominal_voltage ?? "", "Voltage"), tagId: r.rfid_tag_id || null, ownerId: r.owner_id, homeRoomId: r.storage_room_id });
}
