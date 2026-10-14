"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { ReceiptAction } from "../ui/receipt-action.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { formatTime } from "../../lib/client-utils.js";
import { acknowledgeWorkflowStorage } from "../../lib/client/workflow-storage.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { captureRetiredAssetAttempt, recoverRetiredAssetAttempt, retiredAssetFailureStatus, retiredAssetStorageKey, verifyRetiredAssetReceipt } from "../../lib/retired-asset-actions.js";
import styles from "./retired-asset-action-dialog.module.css";
function message(error) { return error instanceof Error ? error.message : "The request could not be confirmed."; }
function notifyRecovery() { window.dispatchEvent(new Event("battery-retired-action-recovery")); }
export function RetiredAssetActionDialog({ data, review, write, onChanged, onClose, onVerified, onBusyChange, paused = false }) {
    const [context] = useState(() => ({ actorAccountId: data.user.id, dataset: data.dataset }));
    const [reviewed] = useState(() => structuredClone(review));
    const [reviewedItems] = useState(() => reviewed.attempt?.payload.items ?? reviewed.batteries.map(battery => ({ batteryId: battery.id, version: battery.version, tagId: battery.tagId })));
    const [attempt, setAttempt] = useState(reviewed.attempt ?? null);
    const captured = useRef(reviewed.attempt ?? null);
    const [busy, setBusy] = useState(false), busyRef = useRef(false);
    const [receipt, setReceipt] = useState(null);
    const verified = useRef(null);
    const [error, setError] = useState(""), [storageError, setStorageError] = useState("");
    const [rejected, setRejected] = useState(false), [refreshError, setRefreshError] = useState("");
    const [deleteText, setDeleteText] = useState("");
    const mounted = useRef(true), currentContext = useRef(context);
    const key = retiredAssetStorageKey(context.actorAccountId, context.dataset);
    const kind = reviewed.attempt?.payload.kind ?? reviewed.kind, purge = kind === "purge";
    const permissions = getRolePermissions(data.user.role);
    const permitted = purge ? permissions.purgeRetiredBatteries : permissions.recoverRetiredBatteries;
    const contextChanged = context.actorAccountId !== data.user.id || context.dataset !== data.dataset;
    const items = attempt?.payload.items ?? reviewedItems;
    const invalidReview = !items.length || items.length > 100 || new Set(items.map(item => item.batteryId)).size !== items.length || !reviewed.attempt && reviewed.batteries.some(battery => battery.lifecycleStatus !== "scrapped" || battery.loanId);
    const bindingChanged = !attempt && !receipt && reviewed.batteries.some(before => {
        const current = data.batteries.find(battery => battery.id === before.id);
        return !current || current.lifecycleStatus !== "scrapped" || !!current.loanId || current.version !== before.version || current.tagId !== before.tagId;
    });
    const locked = busy || !!attempt || !!storageError;
    const confirmation = receipt ? { identity: receipt.requestId, count: receipt.items.length, text: `${receipt.items.length} ${receipt.items.length === 1 ? "battery" : "batteries"} ${purge ? "deleted" : "recovered"}` } : null;
    const actionName = purge ? `Delete selected battery records (${items.length})` : `Recover selected batteries (${items.length})`;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { currentContext.current = { actorAccountId: data.user.id, dataset: data.dataset }; }, [data.user.id, data.dataset]);
    useEffect(() => { onBusyChange?.(locked); return () => onBusyChange?.(false); }, [locked, onBusyChange]);
    function persist(input) {
        const raw = window.__batteryWorkflowStorage.getItem(key);
        const previous = recoverRetiredAssetAttempt(raw, context.actorAccountId, context.dataset);
        if (raw !== null && (!previous || JSON.stringify(previous) !== JSON.stringify(input)))
            throw new Error("Another preserved retired battery request must be resolved first.");
        window.__batteryWorkflowStorage.setItem(key, JSON.stringify(input));
        notifyRecovery();
    }
    async function clear(input) {
        const raw = window.__batteryWorkflowStorage.getItem(key);
        const previous = recoverRetiredAssetAttempt(raw, context.actorAccountId, context.dataset);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(input))
            throw new Error("The saved recovery request changed. It has not been replaced or removed.");
        await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: raw } });
        notifyRecovery();
    }
    async function restoreStorage() {
        const input = captured.current;
        if (!input || busyRef.current || contextChanged)
            return;
        busyRef.current = true;
        setBusy(true);
        try {
            if (verified.current || rejected) {
                await clear(input);
                captured.current = null;
                setAttempt(null);
            }
            else
                persist(input);
            setStorageError("");
            if (verified.current) {
                setReceipt(verified.current);
                onVerified?.(verified.current);
                await onChanged();
            }
        }
        catch (failure) {
            setStorageError(message(failure));
        }
        finally {
            busyRef.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    async function refreshRecords() {
        if (contextChanged || busyRef.current)
            return;
        setRefreshError("");
        try {
            await onChanged();
        }
        catch (failure) {
            if (mounted.current)
                setRefreshError(`The recorded outcome is unchanged. Current records could not refresh: ${message(failure)}`);
        }
    }
    async function submit(retry = false) {
        if (busyRef.current || paused || contextChanged || !permitted || receipt || storageError || rejected)
            return;
        if (!retry && (attempt || invalidReview || bindingChanged || purge && deleteText !== "DELETE"))
            return;
        if (retry && !captured.current)
            return;
        let input = captured.current;
        try {
            input ??= captureRetiredAssetAttempt(context.actorAccountId, context.dataset, { requestId: crypto.randomUUID(), kind, items });
            captured.current = input;
            setAttempt(input);
            persist(input);
        }
        catch (failure) {
            if (captured.current)
                setStorageError(`No request was sent. Recovery must be preserved before confirmation: ${message(failure)}`);
            else
                setError(`The review could not be captured. No request was sent: ${message(failure)}`);
            return;
        }
        const original = input;
        busyRef.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await write("retired_asset", original.payload);
            const confirmed = verifyRetiredAssetReceipt(result, original);
            verified.current = confirmed;
            await clear(original);
            captured.current = null;
            const sameContext = currentContext.current.actorAccountId === context.actorAccountId && currentContext.current.dataset === context.dataset;
            if (mounted.current && sameContext) {
                setAttempt(null);
                setStorageError("");
                setReceipt(confirmed);
                try {
                    onVerified?.(confirmed);
                }
                catch (failure) {
                    setRefreshError(`The outcome is confirmed. The selection view could not update: ${message(failure)}`);
                }
            }
            if (mounted.current && sameContext) {
                try {
                    await onChanged();
                }
                catch (failure) {
                    if (mounted.current)
                        setRefreshError(`The outcome is confirmed. Current records could not refresh: ${message(failure)}`);
                }
            }
        }
        catch (failure) {
            if (mounted.current) {
                if (verified.current) {
                    setStorageError(`The service confirmed the outcome, but device recovery is not durably acknowledged: ${message(failure)}`);
                    return;
                }
                setError(message(failure));
                if (retiredAssetFailureStatus(failure) === "rejected") {
                    setRejected(true);
                    try {
                        await clear(original);
                        captured.current = null;
                        setAttempt(null);
                    }
                    catch (storageFailure) {
                        setStorageError(`This request was rejected, but browser recovery could not be cleared: ${message(storageFailure)}`);
                    }
                }
            }
        }
        finally {
            busyRef.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    return _jsx(Dialog, { open: true, onOpenChange: open => { if (!open && !locked)
            onClose(); }, children: _jsxs(DialogContent, { className: `record-dialog ${styles.dialog}`, showCloseButton: !locked, onEscapeKeyDown: event => { if (locked)
                event.preventDefault(); }, onInteractOutside: event => { if (locked)
                event.preventDefault(); }, children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: purge ? "Delete scrapped battery records" : "Recover scrapped batteries" }), _jsxs(DialogDescription, { children: [items.length, " individually identified ", items.length === 1 ? "battery" : "batteries", " \u00B7 ", context.dataset === "demo" ? "Demonstration inventory" : "Working inventory"] })] }), _jsx("div", { className: purge ? styles.destructiveNotice : styles.notice, children: purge ? _jsxs(_Fragment, { children: [_jsx("strong", { children: "This deletion is irreversible." }), _jsx("p", { children: "Delete the information and complete history of each selected battery, including loans, charging, inspections and observations. Associated battery snapshots are cleared; other records and independent human notes remain. A minimal record of its battery ID, deleting account and deletion time remains. The battery ID and registered tag cannot be reused." })] }) : _jsxs(_Fragment, { children: [_jsx("strong", { children: "Return these scrapped batteries to the active register, in store." }), _jsx("p", { children: "Keep their identity, specifications, responsible owner, registration and first-use dates, and complete history, including earlier inspection findings. No checkout is created. Recovery records an inventory change and does not establish physical condition or safety approval." })] }) }), _jsxs("div", { className: styles.reviewHeading, children: [_jsx("strong", { children: "Reviewed assets" }), _jsxs("span", { children: [items.length, " selected"] })] }), _jsx("div", { className: styles.reviewList, children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Battery" }), _jsx(TableHead, { children: "Reviewed version / tag" }), _jsx(TableHead, { children: "Reviewed status" })] }) }), _jsx(TableBody, { children: items.map(item => _jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx("strong", { className: styles.identifier, children: item.batteryId }), _jsx("span", { className: "cell-secondary", children: reviewed.batteries.find(battery => battery.id === item.batteryId)?.name || "Name unavailable" })] }), _jsxs(TableCell, { children: ["Version ", item.version, _jsx("span", { className: "cell-secondary", children: item.tagId || "No tag registered" })] }), _jsx(TableCell, { children: "Scrapped" })] }, item.batteryId)) })] }) }), contextChanged && _jsx("p", { className: "form-error", role: "alert", children: "The native account or inventory changed. The original request remains bound to its captured context." }), !permitted && _jsx("p", { className: "form-error", role: "alert", children: purge ? "Only administrators can delete scrapped battery records." : "This account cannot recover scrapped batteries." }), invalidReview && _jsx("p", { className: "form-error", role: "alert", children: "Review 1\u2013100 distinct scrapped batteries without active loans. Permanently removed assets cannot be recovered or deleted here." }), bindingChanged && _jsx("p", { className: "form-error", role: "alert", children: "The state, tag or version of a reviewed battery changed. Close this review and reopen the current records before confirming." }), _jsx(MotionDisclosure, { open: purge && !attempt && !receipt && !rejected, children: _jsxs("div", { className: "form-field", children: [_jsx(Label, { htmlFor: "retired-delete-confirmation", children: "Type DELETE to confirm irreversible deletion" }), _jsx(Input, { id: "retired-delete-confirmation", value: deleteText, autoComplete: "off", onChange: event => setDeleteText(event.target.value), disabled: locked || paused || contextChanged })] }) }), _jsx(MotionDisclosure, { open: !!attempt && !receipt, children: _jsxs("div", { className: styles.recoveryNotice, role: "alert", children: [_jsx("strong", { children: busy ? "Submitting preserved request" : "Exact request awaiting confirmation" }), _jsxs("p", { children: ["Request ", attempt?.payload.requestId, ". Its original action, IDs, versions and tags remain fixed. Retry resolves this request only."] })] }) }), _jsx(MotionDisclosure, { open: !!receipt, children: _jsxs("div", { className: styles.success, role: "status", children: [_jsx("strong", { children: confirmation?.text }), _jsx("p", { children: receipt?.items.map(item => item.batteryId).join(", ") }), _jsxs("p", { children: ["Confirmed ", receipt ? formatTime(receipt.at) : "", " \u00B7 Request ", receipt?.requestId] })] }) }), _jsx(MotionDisclosure, { open: !!error || rejected, children: _jsxs("div", { className: "form-error", role: "alert", children: [error, rejected && _jsx("p", { children: "This reviewed request was rejected. Close the review and refresh current records before creating another request." })] }) }), _jsx(MotionDisclosure, { open: !!storageError, children: _jsxs("div", { className: "form-error", role: "alert", children: [_jsx("p", { children: storageError }), _jsx(Button, { variant: "outline", onClick: restoreStorage, disabled: busy || contextChanged || !attempt, children: "Restore request recovery" })] }) }), _jsx(MotionDisclosure, { open: !!refreshError, children: _jsxs("div", { className: "form-error", role: "alert", children: [_jsx("p", { children: refreshError }), _jsx(Button, { variant: "outline", onClick: refreshRecords, disabled: busy || contextChanged, children: "Refresh current records" })] }) }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: () => { if (!locked)
                                onClose(); }, disabled: locked, children: receipt || rejected ? "Close review" : "Cancel" }), _jsx(ReceiptAction, { pending: busy, confirmation: confirmation, reviewKey: `${kind}/${items.map(item => `${item.batteryId}:${item.version}:${item.tagId ?? ""}`).join("/")}`, actionLabel: attempt ? "Retry exact retired battery action" : actionName, onClick: () => submit(!!attempt), disabled: busy || !!storageError || paused || contextChanged || !permitted || !!receipt || rejected || !attempt && (invalidReview || bindingChanged || purge && deleteText !== "DELETE"), children: attempt ? "Retry exact retired battery action" : actionName })] })] }) });
}
