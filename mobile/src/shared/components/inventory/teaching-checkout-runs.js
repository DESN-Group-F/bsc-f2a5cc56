"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { ArrowRightLeft, ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Checkbox } from "../ui/checkbox.js";
import { LoadingState } from "../ui/loading-state.js";
import { MotionDisclosure } from "../ui/workspace-motion.js";
import { formatTime, teachingSpecificationDifferenceLabel } from "../../lib/client-utils.js";
import { inventoryResponse } from "../../lib/client/inventory-request.js";
import styles from "./teaching-checkout.module.css";
export function TeachingCheckoutRuns({ data, ready, revision = 0, groupId, focusRunId, onReturn, onExchange, onContinue, onPermanent, onRunsChanged, onDownload }) {
    const [runs, setRuns] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const [query, setQuery] = useState(""), [outstandingOnly, setOutstandingOnly] = useState(true), [reload, setReload] = useState(0);
    const [downloading, setDownloading] = useState(null), [downloadMessage, setDownloadMessage] = useState("");
    const [expandedRunIds, setExpandedRunIds] = useState([]), [collapsedRunIds, setCollapsedRunIds] = useState([]);
    useEffect(() => {
        let current = true;
        async function load() {
            try {
                const result = await inventoryResponse(await fetch(`/api/teaching-checkouts?dataset=${data.dataset}`, { cache: "no-store" }));
                if (current) {
                    setRuns(result.runs);
                    onRunsChanged?.(result.runs);
                }
            }
            catch (failure) {
                if (current) {
                    setError(failure.message);
                    onRunsChanged?.(null);
                }
            }
            finally {
                if (current)
                    setLoading(false);
            }
        }
        queueMicrotask(() => { if (current) {
            setLoading(true);
            setError("");
            onRunsChanged?.(null);
            void load();
        } });
        return () => { current = false; };
    }, [data.dataset, data.user.id, revision, reload, onRunsChanged]);
    const matching = runs.filter(run => (!groupId || run.teachingGroup.id === groupId) && (!outstandingOnly || run.items.some(item => item.status === "outstanding")) && `${run.teachingGroup.name} ${run.id} ${run.requestedBatteryIds.join(" ")} ${run.items.map(item => item.batteryId).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
    async function download(run, format) {
        if (downloading)
            return;
        setDownloading(run.id);
        setDownloadMessage("");
        try {
            await onDownload(run, format);
            setDownloadMessage("The checkout report has been downloaded.");
        }
        catch (failure) {
            setDownloadMessage(failure.message);
        }
        finally {
            setDownloading(null);
        }
    }
    function expand(run, value) {
        setExpandedRunIds(previous => value ? [...new Set([...previous, run.id])] : previous.filter(id => id !== run.id));
        setCollapsedRunIds(previous => value ? previous.filter(id => id !== run.id) : [...new Set([...previous, run.id])]);
    }
    return _jsxs("section", { className: "teaching-checkout-runs detail-card", id: "teaching-checkout-runs", "aria-label": "Actual teaching group checkouts", "aria-busy": loading, children: [_jsxs("div", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("h2", { children: "Actual group checkouts" }), _jsx("p", { className: "field-hint", children: "Continue using or return the batteries recorded here. Default group edits apply to future use. Returning a temporary alternative ends its use without a separate restore step." })] }), _jsxs(Button, { variant: "outline", size: "sm", disabled: loading, onClick: () => setReload(value => value + 1), children: [_jsx(RefreshCw, { size: 16 }), "Refresh checkouts"] })] }), _jsxs("div", { className: "table-toolbar", children: [_jsx(Input, { value: query, onChange: event => setQuery(event.target.value), placeholder: "Search group, checkout or battery ID\u2026", "aria-label": "Search actual group checkouts" }), _jsxs("label", { className: "flex items-center gap-2 whitespace-nowrap text-sm", children: [_jsx(Checkbox, { checked: outstandingOnly, onCheckedChange: value => setOutstandingOnly(value === true) }), "Outstanding only"] }), _jsx(Button, { variant: "outline", onClick: () => { setQuery(""); setOutstandingOnly(false); }, disabled: !query && !outstandingOnly, children: "Clear filters" })] }), (query || outstandingOnly) && _jsxs("p", { className: "field-hint", children: ["Applied filters: ", outstandingOnly ? "Outstanding checkouts" : "", query ? `${outstandingOnly ? " · " : ""}Search: ${query}` : ""] }), loading && _jsx(LoadingState, { label: runs.length ? "Refreshing actual checkouts…" : "Loading your actual checkouts…", compact: !!runs.length }), error && _jsxs("p", { className: "form-error", role: "alert", children: [error, " Refresh checkouts before preparing another operation."] }), (!loading || !!runs.length) && _jsxs(_Fragment, { children: [_jsxs("p", { className: "field-hint", children: [matching.length, " matching checkouts \u00B7 Saved to your account in this inventory"] }), !matching.length && !error && _jsx("p", { children: "No matching checkouts. Clear filters to review completed records." }), matching.map(run => {
                        const currentMappings = run.currentMappings ?? run.mappings;
                        const outstanding = run.items.filter(item => item.status === "outstanding"), replacements = currentMappings.filter(mapping => mapping.original.batteryId !== mapping.actual.batteryId);
                        const expanded = focusRunId === run.id && !collapsedRunIds.includes(run.id) || expandedRunIds.includes(run.id) || !!groupId && !!outstanding.length && !collapsedRunIds.includes(run.id), evidenceId = `teaching-checkout-evidence-${data.dataset}-${run.id}`;
                        const group = data.teachingGroups?.find(item => item.id === run.teachingGroup.id);
                        const activeMappings = currentMappings.filter(mapping => outstanding.some(item => item.loanId === mapping.loanId && item.batteryId === mapping.actual.batteryId && !item.pendingReturn));
                        const covered = new Set(activeMappings.flatMap(mapping => [mapping.original.batteryId, mapping.actual.batteryId]));
                        const allMappings = [...run.mappings, ...(run.changes ?? []).flatMap(change => change.mappings)];
                        const pendingMembers = new Set(outstanding.filter(item => item.pendingReturn).flatMap(item => {
                            const originalId = item.originalBatteryId ?? allMappings.find(mapping => mapping.loanId === item.loanId && mapping.actual.batteryId === item.batteryId)?.original.batteryId;
                            const current = currentMappings.find(mapping => mapping.original.batteryId === originalId);
                            return [item.batteryId, ...(originalId ? [originalId] : []), ...(current ? [current.actual.batteryId] : [])];
                        }));
                        const blockedIds = group?.batteryIds.filter(id => !covered.has(id) && pendingMembers.has(id)) ?? [];
                        const missingIds = group?.batteryIds.filter(id => !covered.has(id) && !pendingMembers.has(id)) ?? [];
                        const locked = !ready || loading || !!error || !!downloading;
                        return _jsxs("article", { className: "teaching-checkout-run", id: `teaching-checkout-${run.id}`, children: [_jsxs("div", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("h3", { children: run.teachingGroup.name }), _jsxs("p", { children: [formatTime(run.createdAt), " \u00B7 ", outstanding.length, " outstanding / ", run.items.length, " recorded loans"] }), outstanding.some(item => item.pendingReturn) && _jsxs("p", { className: styles.pendingNotice, children: ["Previous batteries pending return: ", outstanding.filter(item => item.pendingReturn).map(item => item.batteryId).join(", ")] })] }), _jsxs("div", { className: "teaching-group-actions", children: [_jsxs(Button, { disabled: locked || !outstanding.length, onClick: () => onReturn(run), children: [_jsx(RotateCcw, { size: 16 }), "Return this checkout"] }), outstanding.length > 0 && _jsx(Button, { variant: "outline", disabled: locked, onClick: () => expand(run, true), children: "Continue existing checkout" }), _jsx(Button, { variant: "outline", disabled: !!downloading, onClick: () => void download(run, "xlsx"), children: "Download checkout" }), _jsx(Button, { variant: "ghost", size: "sm", disabled: !!downloading, onClick: () => void download(run, "json"), children: "JSON" })] })] }), _jsxs("button", { type: "button", className: "teaching-checkout-evidence-trigger", "aria-expanded": expanded, "aria-controls": evidenceId, onClick: () => expand(run, !expanded), children: [_jsxs("span", { children: [replacements.length, " ", replacements.length === 1 ? "alternative" : "alternatives", " \u00B7 View actual batteries and saved evidence"] }), _jsx(ChevronDown, { size: 16, "aria-hidden": "true" })] }), _jsxs(MotionDisclosure, { open: expanded, id: evidenceId, className: "teaching-checkout-evidence", children: [_jsxs("p", { className: "field-hint", children: ["Original group version ", run.teachingGroup.version, " \u00B7 Checkout ", run.id, " \u00B7 Recorded by ", run.actorName] }), !!blockedIds.length && _jsxs("p", { className: styles.pendingNotice, children: ["Default members awaiting a previous battery return: ", blockedIds.join(", "), ". Return the outstanding previous batteries before adding these members again."] }), group && missingIds.length > 0 && outstanding.length > 0 && _jsxs("div", { className: styles.continueNotice, children: [_jsxs("p", { children: [missingIds.length, " current default ", missingIds.length === 1 ? "member is" : "members are", " not covered by an outstanding loan in this checkout."] }), _jsx(Button, { variant: "outline", size: "sm", disabled: locked, onClick: () => onContinue(run, group, missingIds), children: "Add batteries to this checkout" })] }), run.items.map(item => {
                                            const mapping = [...run.mappings, ...(run.changes ?? []).flatMap(change => change.mappings)].find(entry => entry.loanId === item.loanId && entry.actual.batteryId === item.batteryId);
                                            const originalId = item.originalBatteryId ?? mapping?.original.batteryId ?? item.batteryId;
                                            const isCurrent = currentMappings.some(entry => entry.loanId === item.loanId && entry.actual.batteryId === item.batteryId);
                                            const original = data.batteries.find(battery => battery.id === originalId), actual = data.batteries.find(battery => battery.id === item.batteryId);
                                            const isAlternative = originalId !== item.batteryId, permanent = !!group?.batteryIds.includes(item.batteryId) && !group?.batteryIds.includes(originalId);
                                            const canPermanent = group && isCurrent && isAlternative && group.batteryIds.includes(originalId) && !group.batteryIds.includes(item.batteryId) && actual?.lifecycleStatus === "active";
                                            return _jsxs("div", { className: styles.actualRow, "data-pending": !!item.pendingReturn && item.status === "outstanding", children: [_jsxs("div", { children: [_jsx("strong", { children: isAlternative ? `${originalId} → ${item.batteryId}` : item.batteryId }), _jsxs("p", { children: [item.pendingReturn && item.status === "outstanding" ? "Previous battery pending return" : item.status === "outstanding" ? "In use by you" : item.status === "returned" ? "Returned" : item.status === "cancelled" ? "Loan corrected" : "Deleted record", isAlternative ? permanent ? " · Default membership updated" : item.status === "outstanding" ? " · Temporary alternative" : " · Temporary use ended" : " · Default member"] }), item.returnedAt && _jsxs("p", { className: "field-hint", children: ["Returned ", formatTime(item.returnedAt)] }), item.checkedOutAt && _jsxs("p", { className: "field-hint", children: ["Checked out ", formatTime(item.checkedOutAt), mapping?.loanOrigin === "existing" ? " · Existing loan continued" : ""] }), isCurrent && isAlternative && item.status === "outstanding" && original?.lifecycleStatus === "active" && !original.loanId && _jsxs("p", { className: styles.availabilityNote, children: [originalId, " is now available to borrow. Keep using ", item.batteryId, "; no automatic swap or extra checkout is required."] }), mapping?.method === "manual" && _jsxs("p", { className: "field-hint", children: [mapping.specificationMatch === null ? "Deleted specification evidence." : mapping.differences.length ? mapping.differences.map(teachingSpecificationDifferenceLabel).join(" · ") : "Recorded specifications match; manually selected.", " Teaching suitability is not verified by the system."] }), _jsxs("p", { className: "field-hint", children: ["Recorded loan: ", item.loanId ?? "Deleted evidence", " \u00B7 ", mapping?.source?.kind === "native_nfc" ? "Adopted native NFC reading" : mapping?.source?.kind === "tag" ? "Entered registered tag" : mapping?.source ? "Inventory selection" : "Deleted evidence"] })] }), _jsxs("div", { className: "teaching-group-actions", children: [isCurrent && item.status === "outstanding" && !item.pendingReturn && _jsxs(Button, { variant: "outline", size: "sm", disabled: locked, onClick: () => onExchange(run, item), children: [_jsx(ArrowRightLeft, { size: 15 }), "Exchange battery"] }), canPermanent && _jsx(Button, { variant: "ghost", size: "sm", disabled: locked, onClick: () => onPermanent(group, originalId, item.batteryId), children: "Make replacement permanent" })] })] }, item.loanId ?? `${item.batteryId}-${originalId}`);
                                        }), !!run.changes?.length && _jsxs("div", { className: styles.changeHistory, children: [_jsx("h4", { children: "Changes during this checkout" }), run.changes.map(change => _jsxs("p", { children: [_jsx("strong", { children: change.action === "exchange" ? "Battery exchange" : "Batteries added" }), " \u00B7 ", formatTime(change.at), " \u00B7 ", change.actorName, " \u00B7 ", change.mappings.map(mapping => `${mapping.original.batteryId} → ${mapping.actual.batteryId}`).join(", "), change.outgoing && "returned" in change.outgoing ? ` · ${change.outgoing.batteryId} ${change.outgoing.returned ? "returned during exchange" : "kept outstanding at exchange"}` : ""] }, change.id))] })] })] }, run.id);
                    })] }), downloadMessage && _jsx("p", { role: "status", className: "form-message", children: downloadMessage })] });
}
