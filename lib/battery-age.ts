const dayMilliseconds = 86_400_000;

/** Calendar dates have no time of day; UTC is used only for calendar arithmetic. */
export function isDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function currentSydneyDate(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** Service time ends at recorded retirement; manufacture age continues independently. */
export function serviceAgeAsOfOn(
    battery: { lifecycleStatus?: string; lifecycleAt?: string | null },
    asOfOn: string,
): string | null {
    if (!isDateOnly(asOfOn)) return null;
    if (!battery.lifecycleStatus || battery.lifecycleStatus === "active") return asOfOn;
    if (!["scrapped", "permanently_removed"].includes(battery.lifecycleStatus)) return null;
    const value = battery.lifecycleAt;
    if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !isDateOnly(value.slice(0, 10))) return null;
    const recordedAt = new Date(value);
    if (!Number.isFinite(recordedAt.getTime())) return null;
    const retiredOn = currentSydneyDate(recordedAt);
    return isDateOnly(retiredOn) && retiredOn <= asOfOn ? retiredOn : null;
}

export function ageInDays(startOn: string | null, asOfOn: string): number | null {
    if (!startOn || !isDateOnly(startOn) || !isDateOnly(asOfOn) || startOn > asOfOn) return null;
    return Math.round((Date.parse(`${asOfOn}T00:00:00Z`) - Date.parse(`${startOn}T00:00:00Z`)) / dayMilliseconds);
}

export function calendarAge(startOn: string | null, asOfOn: string): { years: number; months: number; days: number } | null {
    if (ageInDays(startOn, asOfOn) === null) return null;
    const [startYear, startMonth, startDay] = startOn!.split("-").map(Number);
    const [endYear, endMonth] = asOfOn.split("-").map(Number);
    let months = (endYear - startYear) * 12 + endMonth - startMonth;
    const anniversary = (totalMonths: number) => {
        const date = new Date(`${startOn}T00:00:00Z`);
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() + totalMonths);
        const end = new Date(date);
        end.setUTCMonth(end.getUTCMonth() + 1);
        end.setUTCDate(0);
        date.setUTCDate(Math.min(startDay, end.getUTCDate()));
        return date.toISOString().slice(0, 10);
    };
    if (anniversary(months) > asOfOn) months--;
    return { years: Math.floor(months / 12), months: months % 12, days: ageInDays(anniversary(months), asOfOn)! };
}
