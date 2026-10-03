import { isDateOnly } from "./battery-age";

export type TemporalInputKind = "date" | "datetime-local" | "time";
export const temporalFormats: Record<TemporalInputKind, string> = { date: "YYYY-MM-DD", "datetime-local": "YYYY-MM-DDTHH:mm", time: "HH:mm" };
export function isTimeOnly(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function temporalInputMessage(kind: TemporalInputKind, value: string, required = false, min?: string, max?: string) {
    if (!value) return required ? `Enter ${kind === "time" ? "a time" : "a date"} in ${temporalFormats[kind]} format.` : "";
    const valid = kind === "date" ? isDateOnly(value) : kind === "time" ? isTimeOnly(value) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && isDateOnly(value.slice(0, 10)) && isTimeOnly(value.slice(11));
    if (!valid) return `Enter a valid ${kind === "time" ? "time" : "date"} in ${temporalFormats[kind]} format.`;
    if (min && !temporalInputMessage(kind, min) && value < min) return `Choose a value on or after ${min}.`;
    if (max && !temporalInputMessage(kind, max) && value > max) return `Choose a value on or before ${max}.`;
    return "";
}
export function toCalendarDate(value: string | undefined) {
    if (!value || !isDateOnly(value.slice(0, 10))) return undefined;
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    const result = new Date(0);
    result.setFullYear(year, month - 1, day); result.setHours(12, 0, 0, 0);
    return result;
}
export function fromCalendarDate(value: Date) {
    return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export function replaceTemporalDate(kind: TemporalInputKind, value: string, date: Date) {
    const dateOnly = fromCalendarDate(date);
    return kind === "date" ? dateOnly : `${dateOnly}T${value.includes("T") ? value.split("T")[1] : ""}`;
}
export function replaceTemporalTime(kind: TemporalInputKind, value: string, part: "hour" | "minute", replacement: string) {
    const time = kind === "time" ? value : value.split("T")[1] || "";
    const [hour = "", minute = ""] = time.split(":");
    const next = `${part === "hour" ? replacement : hour}:${part === "minute" ? replacement : minute}`;
    return kind === "time" ? next : `${value.split("T")[0]}T${next}`;
}
