"use client";

import * as React from "react";
import { CalendarDays, Clock } from "lucide-react";
import { enAU } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentSydneyDate } from "@/lib/battery-age";
import { temporalFormats, temporalInputMessage, toCalendarDate, replaceTemporalDate, replaceTemporalTime, type TemporalInputKind } from "@/lib/temporal-input";

export function TemporalInput({ type, value: suppliedValue, defaultValue, min, max, disabled, readOnly, required, className, ref: suppliedRef, ...props }: React.ComponentProps<"input"> & { type: TemporalInputKind }) {
    const [open, setOpen] = React.useState(false);
    const [uncontrolledValue, setUncontrolledValue] = React.useState(String(defaultValue ?? ""));
    const value = suppliedValue === undefined ? uncontrolledValue : String(suppliedValue ?? "");
    const input = React.useRef<HTMLInputElement | null>(null);
    const date = type === "time" ? undefined : toCalendarDate(value);
    const lower = typeof min === "string" ? min : undefined, upper = typeof max === "string" ? max : undefined;
    const minimum = type === "time" ? undefined : toCalendarDate(lower), maximum = type === "time" ? undefined : toCalendarDate(upper);
    const today = toCalendarDate(currentSydneyDate())!;
    const [month, setMonth] = React.useState(date || today);
    const locked = disabled || readOnly;
    const message = temporalInputMessage(type, value, required, lower, upper);
    const label = props["aria-label"] || props.id || (type === "time" ? "Time" : "Date");
    const startYear = Math.min(minimum?.getFullYear() ?? 1900, date?.getFullYear() ?? today.getFullYear());
    const endYear = Math.max(maximum?.getFullYear() ?? today.getFullYear() + 20, date?.getFullYear() ?? today.getFullYear());
    const start = toCalendarDate(`${String(startYear).padStart(4, "0")}-01-01`)!;
    const end = toCalendarDate(`${String(Math.min(9999, endYear)).padStart(4, "0")}-12-31`)!;
    const time = type === "time" ? value : value.split("T")[1] || "";
    const [hour = "", minute = ""] = time.split(":");

    React.useEffect(() => { input.current?.setCustomValidity(locked ? "" : message); }, [message, locked]);
    function emit(next: string) {
        if (locked || !input.current) return;
        // Use the public native setter and input event so React's existing
        // controlled onChange handlers receive the real input as their target.
        const element = input.current, view = element.ownerDocument.defaultView;
        const setter = view && Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
        if (!setter || !view) return;
        setter.call(element, next);
        element.dispatchEvent(new view.Event("input", { bubbles: true }));
    }
    function bindInput(element: HTMLInputElement | null) {
        input.current = element;
        if (typeof suppliedRef === "function") suppliedRef(element);
        else if (suppliedRef) suppliedRef.current = element;
    }
    return <div className="temporal-input" lang="en-AU" data-temporal-kind={type}>
        <input {...props} ref={bindInput} type="text" value={value} required={required} disabled={disabled} readOnly={readOnly} className={className} data-slot="input" placeholder={props.placeholder || temporalFormats[type]} autoComplete={props.autoComplete || "off"} spellCheck={false} aria-invalid={props["aria-invalid"] || !!value && !!message} onChange={event => { if (suppliedValue === undefined) setUncontrolledValue(event.target.value); props.onChange?.(event); }}/>
        <Popover open={open && !locked} onOpenChange={next => { if (!locked) { if (next) setMonth(date || today); setOpen(next); } }}>
            <PopoverTrigger asChild><Button type="button" variant="outline" size="icon" disabled={locked} aria-label={`Open ${type === "time" ? "time" : "date"} picker: ${label}`}>{type === "time" ? <Clock/> : <CalendarDays/>}</Button></PopoverTrigger>
            <PopoverContent align="start" className="temporal-picker" lang="en-AU" aria-label={`Choose ${label}`}>
                {type !== "time" && <Calendar mode="single" locale={enAU} dir="ltr" weekStartsOn={1} captionLayout="dropdown" month={month} onMonthChange={setMonth} startMonth={start} endMonth={end} selected={date} disabled={[...(minimum ? [{ before: minimum }] : []), ...(maximum ? [{ after: maximum }] : [])]} onSelect={selected => { if (!selected || locked) return; emit(replaceTemporalDate(type, value, selected)); if (type === "date") setOpen(false); }}/>}
                {type !== "date" && <fieldset className="temporal-time"><legend>Time · 24-hour format</legend><label>Hour<select aria-label={`${label} hour`} value={hour} onChange={event => emit(replaceTemporalTime(type, value, "hour", event.target.value))}><option value="">HH</option>{Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map(option => <option key={option} value={option}>{option}</option>)}</select></label><label>Minute<select aria-label={`${label} minute`} value={minute} onChange={event => emit(replaceTemporalTime(type, value, "minute", event.target.value))}><option value="">mm</option>{Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map(option => <option key={option} value={option}>{option}</option>)}</select></label></fieldset>}
                <p className="field-hint">{temporalFormats[type]}{type !== "date" ? " · Australia/Sydney" : ""}</p>
                <div className="temporal-picker-actions"><Button type="button" variant="ghost" size="sm" onClick={() => { emit(""); setOpen(false); }}>Clear</Button><Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button></div>
            </PopoverContent>
        </Popover>
    </div>;
}
