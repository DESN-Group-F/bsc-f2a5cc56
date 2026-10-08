"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Check, Download, Mail, RefreshCw, RotateCcw, Trash2, Undo2, } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, } from "../ui/select.js";
import { Skeleton } from "../ui/skeleton.js";
import { currentSydneyDate } from "../../lib/battery-age.js";
import { formatDateOnly, formatTime, } from "../../lib/client-utils.js";
import { taskRequest } from "../../lib/client/task-api.js";
import { captureTaskRecordAction, readTaskRecordAction, saveTaskRecordAction, clearTaskRecordAction, taskRecordActionFinallyRejected, verifyTaskRecordActionReceipt, } from "../../lib/client/task-record-action.js";
import { useTaskEndpoint } from "../../hooks/use-task-endpoint.js";
import { TaskCycleDialog } from "./tasks/task-cycle-dialog.js";
import { TaskDeliveryNotice, TaskGenerationWarnings, } from "./tasks/task-notices.js";
import { taskCategoryLabels } from "./tasks/task-presentation.js";
import { TaskDownloadDialog } from "./tasks/task-download-dialog.js";
export function MessagesPanel({ data, onChanged, onDetail, onUnreadCount, }) {
    const [visibility, setVisibility] = useState("current");
    const [recovery] = useState(() => readTaskRecordAction("messages", data.user.id, data.dataset));
    const [pendingAction, setPendingAction] = useState(recovery.input);
    const [storageError, setStorageError] = useState(recovery.error);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [taskStatus, setTaskStatus] = useState("all");
    const [readState, setReadState] = useState("all"), [query, setQuery] = useState(""), [page, setPage] = useState(0);
    const [cycle, setCycle] = useState(null), [busyId, setBusyId] = useState(null), [notice, setNotice] = useState(""), [downloadBusy, setDownloadBusy] = useState(false);
    const [downloadRequest, setDownloadRequest] = useState(null);
    const parameters = new URLSearchParams({
        dataset: data.dataset,
        visibility,
        taskStatus,
        readState,
        search: query,
    });
    const filtersApplied = taskStatus !== "all" || readState !== "all" || query !== "";
    function clearFilters() {
        setTaskStatus("all");
        setReadState("all");
        setQuery("");
        setPage(0);
    }
    const resource = useTaskEndpoint(`/api/messages?${parameters}`, data.user.id, data.events.map((event) => event.id).join("|"), !!cycle || !!busyId || !!pendingAction || !!downloadRequest || downloadBusy);
    const messages = resource.payload?.messages ?? [], maxPage = Math.max(0, Math.ceil(messages.length / 25) - 1), currentPage = Math.min(page, maxPage);
    const unreadCount = resource.payload?.unreadCount;
    useEffect(() => {
        if (unreadCount !== undefined)
            onUnreadCount?.(unreadCount);
    }, [unreadCount, onUnreadCount]);
    async function changed() {
        if (!mounted.current)
            return;
        resource.refresh();
        try {
            await onChanged?.();
        }
        catch {
            setNotice("The message or task change was saved. Refresh the inventory if shared status has not updated.");
        }
    }
    async function markRead(id) {
        setBusyId(id);
        setNotice("");
        try {
            await taskRequest("/api/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dataset: data.dataset,
                    action: "read",
                    payload: { id },
                }),
            });
            await changed();
        }
        catch (error) {
            setNotice(error.message);
        }
        finally {
            setBusyId(null);
        }
    }
    async function changeVisibility(input) {
        if (storageError || input.dataset !== data.dataset || busyId)
            return;
        try {
            saveTaskRecordAction("messages", data.user.id, input);
        }
        catch (error) {
            setStorageError(`The request could not be preserved. No change was sent. ${error.message}`);
            return;
        }
        setPendingAction(input);
        setBusyId(input.payload.id);
        setNotice("");
        try {
            const body = await taskRequest("/api/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            verifyTaskRecordActionReceipt(body.result, input, data.user.id);
            clearTaskRecordAction("messages", data.user.id, input);
            setPendingAction(null);
            setNotice(input.action === "remove"
                ? "Message moved to Removed. The shared task is unchanged."
                : "Message restored to your inbox.");
            await changed();
        }
        catch (error) {
            setNotice(error.message);
            if (taskRecordActionFinallyRejected(error)) {
                try {
                    clearTaskRecordAction("messages", data.user.id, input);
                    setPendingAction(null);
                    if (mounted.current)
                        resource.refresh();
                }
                catch (storageFailure) {
                    setStorageError(storageFailure.message);
                }
            }
        }
        finally {
            setBusyId(null);
        }
    }
    function download() {
        setDownloadRequest({
            url: `/api/messages?${parameters}`,
            filename: `my-messages-report-${data.dataset}`,
            title: "Download Messages report",
            scope: "Includes your own matching messages across all pages and their related task records. Reading and completion are shown separately.",
        });
    }
    return (_jsxs(_Fragment, { children: [_jsx(TaskDeliveryNotice, {}), _jsx(TaskGenerationWarnings, { issues: resource.payload?.generationIssues ?? [] }), _jsxs("section", { className: "inventory-panel", "aria-label": "Personal messages", "aria-busy": resource.loading, children: [_jsxs("div", { className: "panel-top message-panel-top", children: [_jsx(Tabs, { className: "message-status-tabs", value: visibility, onValueChange: (value) => {
                                    setVisibility(value);
                                    setPage(0);
                                }, children: _jsxs(TabsList, { "aria-label": "Message location", children: [_jsx(TabsTrigger, { value: "current", disabled: !!busyId || !!pendingAction || downloadBusy, children: "Inbox" }), _jsx(TabsTrigger, { value: "removed", disabled: !!busyId || !!pendingAction || downloadBusy, children: "Removed" })] }) }), _jsx(Tabs, { value: taskStatus, onValueChange: (value) => {
                                    setTaskStatus(value);
                                    setPage(0);
                                }, children: _jsxs(TabsList, { variant: "line", children: [_jsx(TabsTrigger, { value: "all", disabled: downloadBusy || !!busyId || !!pendingAction, children: "All" }), _jsx(TabsTrigger, { value: "open", disabled: downloadBusy || !!busyId || !!pendingAction, children: "To do" }), _jsx(TabsTrigger, { value: "completed", disabled: downloadBusy || !!busyId || !!pendingAction, children: "Completed" })] }) }), _jsxs("div", { className: "panel-actions", children: [_jsxs(Button, { variant: "outline", onClick: resource.refresh, disabled: resource.loading || !!busyId || !!pendingAction, children: [_jsx(RefreshCw, { size: 16 }), "Refresh messages"] }), _jsxs(Button, { variant: "outline", onClick: download, disabled: resource.loading ||
                                            !!resource.error ||
                                            !messages.length ||
                                            !!pendingAction ||
                                            downloadBusy, children: [_jsx(Download, { size: 16 }), downloadBusy ? "Preparing…" : "Download messages"] })] })] }), _jsxs("div", { className: "table-toolbar", children: [_jsx(Input, { "aria-label": "Search messages", placeholder: "Search message, task category or related record\u2026", value: query, onChange: (event) => {
                                    setQuery(event.target.value);
                                    setPage(0);
                                }, maxLength: 200, disabled: downloadBusy || !!busyId || !!pendingAction }), _jsxs(Select, { value: readState, onValueChange: (value) => {
                                    setReadState(value);
                                    setPage(0);
                                }, disabled: downloadBusy || !!busyId || !!pendingAction, children: [_jsx(SelectTrigger, { "aria-label": "Filter messages by read state", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "all", children: "All read states" }), _jsxs(SelectItem, { value: "unread", children: ["Unread", unreadCount !== undefined ? ` (${unreadCount})` : ""] }), _jsx(SelectItem, { value: "read", children: "Read" })] })] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: clearFilters, disabled: !filtersApplied || downloadBusy || !!busyId || !!pendingAction, children: [_jsx(RotateCcw, { size: 15 }), "Clear filters"] }), _jsx("span", { className: "toolbar-meta", children: resource.loading
                                    ? "Loading complete inbox…"
                                    : resource.error
                                        ? "Inbox unavailable"
                                        : `${messages.length} matching ${messages.length === 1 ? "message" : "messages"}` })] }), notice && (_jsx("p", { className: "form-message px-5", role: "status", children: notice })), storageError && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: storageError }), _jsx(Button, { variant: "outline", onClick: () => {
                                    const saved = readTaskRecordAction("messages", data.user.id, data.dataset);
                                    setStorageError(saved.error);
                                    setPendingAction(saved.input);
                                }, children: "Retry saved request recovery" })] })), pendingAction && !busyId && (_jsxs("div", { className: "px-5 pb-3", role: "alert", children: [_jsxs("p", { children: ["A saved message", " ", pendingAction.action === "remove" ? "removal" : "restoration", " ", "has not been confirmed. Retry the original request for this account and inventory before making another change."] }), _jsxs(Button, { variant: "outline", onClick: () => changeVisibility(pendingAction), disabled: !!storageError, children: ["Retry original", " ", pendingAction.action === "remove" ? "removal" : "restoration"] })] })), resource.error && (_jsxs("div", { className: "load-error", role: "alert", children: [_jsx("span", { children: resource.error }), _jsx(Button, { variant: "outline", onClick: resource.refresh, children: "Retry messages" })] })), resource.loading ? (_jsxs("div", { className: "loading-panel", role: "status", children: [_jsx("p", { children: "Loading messages addressed to your staff account\u2026" }), _jsx(Skeleton, { className: "h-24 w-full" })] })) : (!resource.error && (_jsxs(_Fragment, { children: [_jsx("div", { className: "message-inbox-cards", children: messages
                                    .slice(currentPage * 25, (currentPage + 1) * 25)
                                    .map((message) => {
                                    const completed = message.taskStatus === "completed";
                                    const removedPlan = message.cycle.planRemoved;
                                    const actionable = !completed && !removedPlan && message.cycle.canComplete;
                                    return (_jsxs("article", { className: "message-inbox-card", children: [_jsxs("div", { className: "message-inbox-content", children: [_jsxs("h3", { className: "message-subject", children: [!message.readAt && (_jsx("span", { className: "unread-dot", "aria-hidden": "true" })), message.title] }), _jsxs("div", { className: "message-inbox-meta", children: [_jsx("span", { className: `status-badge ${completed ? "in" : "out"}`, children: completed
                                                                    ? "Completed"
                                                                    : removedPlan
                                                                        ? "Plan removed"
                                                                        : "To do" }), _jsx("span", { className: `status-badge ${message.readAt ? "read" : "unread"}`, children: message.readAt ? "Read" : "Unread" }), _jsx("span", { children: taskCategoryLabels[message.cycle.category] }), _jsxs("span", { children: ["Due ", formatDateOnly(message.dueOn), !completed &&
                                                                        !removedPlan &&
                                                                        message.dueOn < currentSydneyDate()
                                                                        ? " · Overdue"
                                                                        : ""] })] }), !completed && removedPlan && (_jsx("p", { className: "field-hint", children: "This plan has been removed. An administrator must restore it before this task can be completed." })), !completed &&
                                                        !removedPlan &&
                                                        !message.cycle.canComplete && (_jsx("p", { className: "field-hint", children: "Only currently assigned staff or an administrator can complete this task." })), _jsxs("details", { className: "message-inbox-details", children: [_jsx("summary", { children: "Message details" }), _jsx("p", { className: "whitespace-pre-wrap", children: message.body }), _jsxs("p", { className: "field-hint", children: ["Created ", formatTime(message.createdAt), message.readAt
                                                                        ? ` · Read ${formatTime(message.readAt)}`
                                                                        : "", message.removedAt
                                                                        ? ` · Removed ${formatTime(message.removedAt)}`
                                                                        : ""] }), _jsx("p", { className: "field-hint", children: "Email not sent \u00B7 delivery unavailable" })] })] }), _jsxs("div", { className: "message-inbox-actions", children: [_jsx(Button, { variant: actionable ? "default" : "outline", size: "sm", onClick: () => setCycle(message.cycle), disabled: !!busyId || !!pendingAction || !!storageError, children: completed
                                                            ? "View completion"
                                                            : actionable
                                                                ? "Complete task"
                                                                : "View task" }), !message.readAt && (_jsxs(Button, { variant: "ghost", size: "sm", onClick: () => markRead(message.id), disabled: !!busyId || !!pendingAction || !!storageError, "aria-label": `Mark ${message.title} as read`, children: [_jsx(Check, { size: 16 }), "Mark read"] })), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => changeVisibility(captureTaskRecordAction(data.dataset, message.removedAt ? "restore" : "remove", message)), disabled: !!busyId || !!pendingAction || !!storageError, "aria-label": `${message.removedAt ? "Restore" : "Remove"} message: ${message.title}`, children: [message.removedAt ? (_jsx(Undo2, { size: 16 })) : (_jsx(Trash2, { size: 16 })), busyId === message.id
                                                                ? "Saving…"
                                                                : message.removedAt
                                                                    ? "Restore"
                                                                    : "Remove"] })] })] }, message.id));
                                }) }), !messages.length && (_jsxs("div", { className: "empty-state", children: [_jsx(Mail, {}), _jsx("h3", { children: filtersApplied
                                            ? "No matching messages"
                                            : visibility === "removed"
                                                ? "No removed messages"
                                                : "No messages yet" }), _jsx("p", { children: filtersApplied
                                            ? "Clear filters to see all your messages."
                                            : visibility === "removed"
                                                ? "Messages you remove from your inbox remain available here to restore."
                                                : "Assigned periodic task reminders will appear here when their configured reminder time is reached and the system is in use." })] })), _jsxs("div", { className: "pagination-bar", children: [_jsxs("span", { children: [messages.length ? currentPage * 25 + 1 : 0, "\u2013", Math.min((currentPage + 1) * 25, messages.length), " of", " ", messages.length, " ", messages.length === 1 ? "message" : "messages"] }), _jsxs("div", { children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => setPage(currentPage - 1), disabled: !currentPage, children: "Previous" }), _jsxs("span", { children: ["Page ", currentPage + 1, " of ", maxPage + 1] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setPage(currentPage + 1), disabled: currentPage >= maxPage, children: "Next" })] })] })] }))), _jsx("div", { className: "panel-footer", children: "Removing a message only moves it out of your inbox; it does not cancel or complete the shared task. Restore it from Removed at any time. Reading and task completion are separate states." })] }), downloadRequest && _jsx(TaskDownloadDialog, { request: downloadRequest, onClose: () => setDownloadRequest(null), onBusyChange: setDownloadBusy }), cycle && (_jsx(TaskCycleDialog, { cycle: cycle, data: data, onDetail: onDetail, onClose: () => setCycle(null), onSaved: async () => {
                    setCycle(null);
                    await changed();
                } }))] }));
}
