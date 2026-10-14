"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils.js";
/** Waiting indicators describe a pending response, never a saved transaction. */
export function LoadingState({ label, detail, compact = false }) {
    const [slow, setSlow] = useState(false);
    const [offline, setOffline] = useState(false);
    useEffect(() => {
        const connection = () => setOffline(!navigator.onLine);
        connection();
        window.addEventListener("online", connection);
        window.addEventListener("offline", connection);
        const timer = window.setTimeout(() => setSlow(true), 6000);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("online", connection);
            window.removeEventListener("offline", connection);
        };
    }, []);
    const hint = offline ? "You appear to be offline. Waiting for a connection." : slow ? "This is taking longer than usual. Waiting for the server response." : detail;
    return _jsxs("div", { className: cn("network-loading", compact && "network-loading-compact"), role: "status", "aria-live": "polite", "aria-atomic": "true", children: [_jsxs("div", { className: "network-loading-heading", children: [_jsxs("span", { className: "network-loading-mark", "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("div", { className: "network-loading-copy", children: [_jsx("strong", { children: label }), hint && _jsx("p", { children: hint })] })] }), !compact && _jsxs("div", { className: "network-loading-preview", "aria-hidden": "true", children: [_jsxs("div", { className: "network-loading-toolbar", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }), _jsx("div", { className: "network-loading-grid", children: [0, 1, 2, 3].map(row => _jsxs("div", { className: "network-loading-row", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }, row)) })] })] });
}
/** Delay incidental refresh feedback, then retain it briefly for a quiet exit. */
export function RefreshStatus({ active, label = "Refreshing inventory", detail = "Your current view stays available while records update." }) {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(active), active ? 220 : 180);
        return () => window.clearTimeout(timer);
    }, [active]);
    if (!visible)
        return null;
    return _jsx("div", { className: "network-refresh", "data-leaving": !active, "aria-hidden": !active, children: _jsx(LoadingState, { compact: true, label: label, detail: detail }) });
}
