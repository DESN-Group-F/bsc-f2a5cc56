"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CalendarDays } from "lucide-react";
export function TaskDeliveryNotice() {
    return (_jsxs("div", { className: "working-notice", children: [_jsx(CalendarDays, { size: 17 }), _jsxs("span", { children: [_jsx("strong", { children: "Messages are generated while the system is in use." }), " ", "Unattended scheduling and email delivery are not connected. Email preferences are saved; no email is sent."] })] }));
}
export function TaskGenerationWarnings({ issues, }) {
    if (!issues.length)
        return null;
    return (_jsxs("div", { className: "working-notice", role: "alert", children: [_jsx(CalendarDays, { size: 17 }), _jsxs("div", { children: [_jsx("strong", { children: "Some periodic tasks need administrator review." }), _jsx("ul", { className: "mt-1 list-disc pl-5", children: issues.map((issue) => (_jsx("li", { children: issue.message }, issue.planId))) }), _jsx("p", { children: "Review these configurations before relying on their reminders; existing task and message history is retained." })] })] }));
}
