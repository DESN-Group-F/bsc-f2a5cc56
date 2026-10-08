"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Archive, Clock3, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Skeleton } from "../ui/skeleton.js";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { buildBatteryMovementSummary } from "../../lib/battery-movement-summary.js";
import { formatTime } from "../../lib/client-utils.js";
export function BatteryMovementSummary({ detail, error, onRetry }) {
    if (error)
        return _jsxs("section", { className: "battery-movement-summary movement-unavailable", "aria-label": "Check-in and check-out", children: [_jsx("h3", { children: "Check-in / check-out" }), _jsxs("div", { role: "alert", children: [_jsx("p", { children: "Movement details could not be loaded." }), _jsx("p", { children: error })] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: onRetry, children: [_jsx(RefreshCw, { size: 16 }), "Retry details"] })] });
    if (!detail)
        return _jsxs("section", { className: "battery-movement-summary movement-loading", "aria-label": "Loading check-in and check-out details", "aria-busy": "true", children: [_jsx("h3", { children: "Check-in / check-out" }), _jsxs("div", { className: "movement-current", children: [_jsx(Skeleton, { className: "h-5 w-28" }), _jsx(Skeleton, { className: "h-10 w-48 max-w-full" }), _jsx(Skeleton, { className: "h-5 w-40 max-w-full" })] }), _jsx("span", { className: "sr-only", children: "Loading movement details." })] });
    return _jsx(LoadedMovementSummary, { detail: detail });
}
function LoadedMovementSummary({ detail }) {
    const [now, setNow] = useState(() => new Date());
    const terminal = !isActiveBattery(detail.battery);
    useEffect(() => {
        if (terminal)
            return;
        const timer = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(timer);
    }, [terminal]);
    const summary = buildBatteryMovementSummary(detail, now);
    const durationIsMessage = ["No return recorded", "Tracking ended", "Not available"].includes(summary.duration);
    const StatusIcon = terminal ? Archive : summary.status === "in_use" ? ArrowUpRight : ArrowDownLeft;
    return _jsxs("section", { className: `battery-movement-summary${terminal ? " movement-terminal" : ""}`, "aria-label": "Check-in and check-out", children: [_jsx("h3", { children: "Check-in / check-out" }), _jsxs("div", { className: "movement-current", children: [_jsxs("div", { className: "movement-status", children: [_jsx(StatusIcon, { size: 19, "aria-hidden": "true" }), _jsx("strong", { children: summary.statusLabel })] }), _jsx("p", { className: "movement-label", children: summary.durationLabel }), _jsx("p", { className: `movement-duration${durationIsMessage ? " movement-duration-message" : ""}`, children: summary.duration }), _jsxs("dl", { className: "movement-person", children: [_jsx("dt", { children: summary.personLabel }), _jsx("dd", { children: summary.personName })] }), _jsxs("p", { className: "movement-when", children: [summary.timestampLabel, summary.startedAt ? _jsxs(_Fragment, { children: [" ", _jsx("time", { dateTime: summary.startedAt, children: formatTime(summary.startedAt) })] }) : " · Time unavailable"] })] }), _jsx("h4", { className: "movement-timeline-title", children: "Recent movements" }), summary.timeline.length ? _jsx("ol", { className: "movement-timeline", "aria-label": "Recent recorded movements", children: summary.timeline.map(event => _jsxs("li", { className: `movement-event movement-event-${event.kind}`, children: [_jsxs("div", { className: "movement-event-heading", children: [_jsx("strong", { children: event.kind === "return" ? "Check-in · Returned" : event.kind === "checkout" ? "Check-out · Borrowed" : "Battery registered" }), event.at ? _jsx("time", { dateTime: event.at, children: formatTime(event.at) }) : _jsx("span", { children: "Time unavailable" })] }), event.kind === "checkout" && _jsxs("p", { children: ["Borrowed by ", _jsx("strong", { children: event.borrowerName || "Not recorded" })] }), _jsxs("p", { children: [event.kind === "return" ? "Return recorded by" : event.kind === "checkout" ? "Checkout recorded by" : "Registered by", " ", _jsx("strong", { children: event.actorName || "Not recorded" })] }), event.currentLoan ? _jsxs("p", { className: "movement-loan-duration", children: [_jsx(Clock3, { size: 13, "aria-hidden": "true" }), "Current loan"] }) : event.loanDuration && _jsxs("p", { className: "movement-loan-duration", children: [_jsx(Clock3, { size: 13, "aria-hidden": "true" }), "Loan duration: ", event.loanDuration] })] }, event.id)) }) : _jsx("p", { className: "movement-empty", children: "No movement records are available." }), _jsx("p", { className: "movement-evidence-note", children: "Recorded check-ins and check-outs, not live location. Times use Australia/Sydney. Corrections remain in Loans and Audit history." })] });
}
