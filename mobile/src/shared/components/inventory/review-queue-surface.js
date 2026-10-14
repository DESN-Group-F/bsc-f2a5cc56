"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ListChecks, PanelRightClose } from "lucide-react";
import { Button } from "../ui/button.js";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet.js";
import styles from "./inventory-table.module.css";
function revealQueueControl(pane, target) {
    const body = pane?.querySelector("[data-queue-body]");
    if (!body?.contains(target))
        return;
    const bounds = body.getBoundingClientRect(), control = target.getBoundingClientRect();
    if (control.top < bounds.top + 12)
        body.scrollTop += control.top - bounds.top - 12;
    else if (control.bottom > bounds.bottom - 12)
        body.scrollTop += control.bottom - bounds.bottom + 12;
}
/** Layout and focus only; selection, dialogs and requests remain in InventoryTable. */
export function ReviewQueueSurface({ id, open, onOpenChange, active, overlayOpen, count, outsideCount, scopeChanged, workbenchRef, children }) {
    const [mode, setMode] = useState("drawer");
    const [lastActive, setLastActive] = useState(active);
    const [measured, setMeasured] = useState(false);
    if (lastActive !== active) {
        setLastActive(active);
        setMeasured(false);
    }
    const slotRef = useRef(null);
    const paneRef = useRef(null);
    const launcherRef = useRef(null);
    const focusKey = useRef(null);
    const lastPaneFocus = useRef(null);
    const deferredMode = useRef(false);
    const deferredFocus = useRef(null);
    const focusFrame = useRef(0);
    const bodyScroll = useRef(0);
    const current = useRef({ active, open, mode });
    useLayoutEffect(() => { current.current = { active, open, mode }; }, [active, open, mode]);
    const previousOpen = useRef(false);
    const warning = scopeChanged || count > 100;
    const description = [scopeChanged && "Selection scope changed. Review required.", count > 100 && "Movement limit: 100 batteries. Reduce selection.", outsideCount > 0 && `${outsideCount} outside current filters.`].filter(Boolean).join(" ");
    const rememberFocus = (event) => {
        const target = event.target;
        if (target.matches("button, summary, h2"))
            lastPaneFocus.current = { label: target.getAttribute("aria-label"), text: target.textContent };
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
            if (current.current.active && current.current.open && document.activeElement === target)
                revealQueueControl(paneRef.current, target);
        });
    };
    useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
    const restoreScroll = useCallback((focusTarget) => {
        const body = paneRef.current?.querySelector("[data-queue-body]");
        if (body) {
            body.scrollTop = bodyScroll.current;
            if (focusTarget)
                revealQueueControl(paneRef.current, focusTarget);
        }
    }, []);
    const focusPane = useCallback(() => {
        const pane = paneRef.current;
        if (!pane || !active || !open)
            return;
        const key = focusKey.current;
        const target = key && Array.from(pane.querySelectorAll("button, summary, h2")).find(element => !element.matches(":disabled") && !element.closest("[hidden], [inert]") && element.getClientRects().length > 0 &&
            (key.label ? element.getAttribute("aria-label") === key.label : element.textContent === key.text));
        const focusTarget = target || pane.querySelector("h2");
        focusTarget?.focus({ preventScroll: true });
        restoreScroll(focusTarget);
        focusKey.current = null;
    }, [active, open, restoreScroll]);
    useEffect(() => {
        const workbench = workbenchRef.current;
        if (!workbench || !active)
            return;
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const bounds = workbench.getBoundingClientRect();
                if (!bounds.width)
                    return;
                const topbar = document.querySelector(".application-workbench .topbar")?.getBoundingClientRect();
                const top = Math.max(8, (topbar?.bottom ?? 0) + 8);
                const available = Math.max(120, window.innerHeight - Math.max(top, bounds.top) - 16);
                slotRef.current?.style.setProperty("--queue-available-height", `${available}px`);
                slotRef.current?.style.setProperty("--queue-sticky-top", `${top}px`);
                setMeasured(true);
                const next = bounds.width >= 1100 ? "docked" : "drawer";
                if (next === current.current.mode) {
                    deferredMode.current = false;
                    deferredFocus.current = null;
                    return;
                }
                if (overlayOpen) {
                    if (!deferredMode.current)
                        deferredFocus.current = lastPaneFocus.current;
                    deferredMode.current = true;
                    return;
                }
                const focused = document.activeElement;
                if (focused instanceof HTMLElement && paneRef.current?.contains(focused)) {
                    bodyScroll.current = paneRef.current.querySelector("[data-queue-body]")?.scrollTop ?? 0;
                    focusKey.current = { label: focused.getAttribute("aria-label"), text: focused.textContent };
                }
                if (deferredMode.current && deferredFocus.current)
                    focusKey.current = deferredFocus.current;
                deferredMode.current = false;
                deferredFocus.current = null;
                setMode(next);
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(workbench);
        const topbar = document.querySelector(".application-workbench .topbar");
        if (topbar)
            observer.observe(topbar);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, { passive: true });
        measure();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure);
        };
    }, [active, overlayOpen, workbenchRef]);
    useLayoutEffect(() => {
        let frame = 0;
        if (active && mode === "docked") {
            if (open && (!previousOpen.current || focusKey.current))
                focusPane();
            else if (open)
                restoreScroll();
            else if (!open && previousOpen.current)
                launcherRef.current?.focus({ preventScroll: true });
        }
        else if (active && measured && open && !previousOpen.current) {
            frame = requestAnimationFrame(() => {
                if (current.current.active && current.current.open && !paneRef.current?.contains(document.activeElement) && !Array.from(document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')).some(dialog => dialog !== paneRef.current))
                    focusPane();
            });
        }
        else if (active && !open && previousOpen.current) {
            frame = requestAnimationFrame(() => {
                if (current.current.active && !current.current.open && !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'))
                    launcherRef.current?.focus({ preventScroll: true });
            });
        }
        previousOpen.current = open;
        return () => cancelAnimationFrame(frame);
    }, [active, measured, mode, open, focusPane, restoreScroll]);
    const heading = _jsxs("div", { className: styles.queueHeading, "data-queue-heading": "", children: [_jsxs("div", { children: [mode === "drawer" ? _jsx(SheetTitle, { asChild: true, children: _jsxs("h2", { tabIndex: -1, children: ["Review queue ", _jsx("span", { children: count })] }) }) : _jsxs("h2", { tabIndex: -1, children: ["Review queue ", _jsx("span", { children: count })] }), outsideCount > 0 && _jsxs("p", { className: styles.queueScopeCount, children: [outsideCount, " outside current filters"] }), scopeChanged && _jsxs("p", { className: styles.queueAttention, role: "status", children: [_jsx(AlertTriangle, { size: 13, "aria-hidden": "true" }), "Selection scope changed. Review required."] }), count > 100 && _jsx("p", { className: styles.queueAttention, role: "status", children: "Movement limit: 100 batteries. Reduce selection." })] }), _jsx(Button, { className: styles.queueToggle, variant: "outline", size: "icon", onClick: () => onOpenChange(false), "aria-label": "Collapse review queue", "aria-expanded": open, "aria-controls": id, children: _jsx(PanelRightClose, { size: 18, "aria-hidden": "true" }) })] });
    const content = _jsxs(_Fragment, { children: [heading, _jsx("div", { className: styles.queueBody, "data-queue-body": "", onScroll: event => { bodyScroll.current = event.currentTarget.scrollTop; }, children: children })] });
    return _jsxs("div", { ref: slotRef, className: styles.queueSlot, "data-queue-mode": mode, "data-queue-open": open, children: [_jsxs(Button, { ref: launcherRef, className: styles.queueRail, variant: "outline", "data-review-rail": "", "aria-label": `Expand review queue, ${count} selected${warning ? ", attention required" : ""}`, "aria-expanded": open, "aria-controls": id, "aria-describedby": description ? `${id}-status` : undefined, onClick: () => onOpenChange(true), inert: mode === "docked" && open ? true : undefined, "aria-hidden": mode === "docked" && open ? true : undefined, children: [_jsx(ListChecks, { size: 20, "aria-hidden": "true" }), _jsx("span", { className: styles.queueRailCount, children: count }), _jsx("span", { className: styles.queueRailLabel, children: "Review queue" }), warning && _jsx(AlertTriangle, { size: 16, className: styles.queueRailWarning, "aria-hidden": "true" })] }), description && _jsx("span", { id: `${id}-status`, className: "sr-only", role: "status", children: description }), mode === "docked" ? _jsx("aside", { ref: paneRef, id: id, className: styles.queue, "aria-label": "Review queue", "data-review-queue": "", "data-queue-open": open, inert: !open ? true : undefined, "aria-hidden": !open ? true : undefined, onFocusCapture: rememberFocus, children: content }) :
                _jsx(Sheet, { open: active && measured && open, onOpenChange: onOpenChange, children: _jsx(SheetContent, { ref: node => { paneRef.current = node; }, id: id, className: `${styles.queue} ${styles.queueDrawer}`, "data-review-queue": "", "data-queue-open": open, inert: !active || !measured || !open ? true : undefined, "aria-hidden": !active || !measured || !open ? true : undefined, onFocusCapture: rememberFocus, showCloseButton: false, overlayClassName: styles.queueOverlay, "aria-describedby": undefined, onOpenAutoFocus: event => { event.preventDefault(); focusPane(); }, onCloseAutoFocus: event => {
                            event.preventDefault();
                            const state = current.current;
                            if (!state.active)
                                return;
                            if (state.open && state.mode === "docked") {
                                if (!paneRef.current?.contains(document.activeElement) && !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'))
                                    focusPane();
                                return;
                            }
                            if (!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'))
                                launcherRef.current?.focus({ preventScroll: true });
                        }, children: content }) })] });
}
