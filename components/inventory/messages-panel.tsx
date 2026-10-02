"use client";

import { useEffect, useState } from "react";
import { Check, Download, Mail, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { InboxMessage, TaskCycleRecord, TaskGenerationIssue } from "@/lib/task-plans";
import { currentSydneyDate } from "@/lib/battery-age";
import { formatDateOnly, formatTime } from "@/lib/client-utils";
import { TaskCycleDialog, TaskDeliveryNotice, TaskGenerationWarnings, downloadTaskJson, taskCategoryLabels, taskRequest, useTaskEndpoint, type TaskPanelProps } from "./task-plans-panel";

type MessagesResponse = { messages: InboxMessage[]; unreadCount: number; capabilities: { emailAvailable: boolean; schedulerAvailable: boolean; messageGeneration: string; note: string }; generationIssues: TaskGenerationIssue[] };

export function MessagesPanel({ data, onChanged, onDetail, onUnreadCount }: TaskPanelProps & { onUnreadCount?: (count: number) => void }) {
    const [taskStatus, setTaskStatus] = useState<"all" | "open" | "completed">("all");
    const [readState, setReadState] = useState<"all" | "unread" | "read">("all"), [query, setQuery] = useState(""), [page, setPage] = useState(0);
    const [cycle, setCycle] = useState<TaskCycleRecord | null>(null), [busyId, setBusyId] = useState<string | null>(null), [notice, setNotice] = useState(""), [downloadBusy, setDownloadBusy] = useState(false);
    const parameters = new URLSearchParams({ dataset: data.dataset, taskStatus, readState, search: query });
    const filtersApplied = taskStatus !== "all" || readState !== "all" || query !== "";
    function clearFilters() { setTaskStatus("all"); setReadState("all"); setQuery(""); setPage(0); }
    const resource = useTaskEndpoint<MessagesResponse>(`/api/messages?${parameters}`, data.user.id, data.events.map(event => event.id).join("|"), !!cycle || !!busyId || downloadBusy);
    const messages = resource.payload?.messages ?? [], maxPage = Math.max(0, Math.ceil(messages.length / 25) - 1), currentPage = Math.min(page, maxPage);
    const unreadCount = resource.payload?.unreadCount;
    useEffect(() => { if (unreadCount !== undefined) onUnreadCount?.(unreadCount); }, [unreadCount, onUnreadCount]);
    async function changed() {
        resource.refresh();
        try { await onChanged?.(); }
        catch { setNotice("The message or task change was saved. Refresh the inventory if shared status has not updated."); }
    }
    async function markRead(id: string) {
        setBusyId(id); setNotice("");
        try {
            await taskRequest("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: data.dataset, action: "read", payload: { id } }) });
            await changed();
        } catch (error) { setNotice((error as Error).message); }
        finally { setBusyId(null); }
    }
    async function download() {
        setDownloadBusy(true); setNotice("");
        try { await downloadTaskJson(`/api/messages?${parameters}&download=json`, `my-messages-${data.dataset}.json`); }
        catch (error) { setNotice((error as Error).message); }
        finally { setDownloadBusy(false); }
    }
    return <><TaskDeliveryNotice/><TaskGenerationWarnings issues={resource.payload?.generationIssues ?? []}/><section className="inventory-panel" aria-label="Personal messages" aria-busy={resource.loading}>
        <div className="panel-top"><Tabs value={taskStatus} onValueChange={value => { setTaskStatus(value as typeof taskStatus); setPage(0); }}><TabsList variant="line"><TabsTrigger value="all" disabled={downloadBusy}>All</TabsTrigger><TabsTrigger value="open" disabled={downloadBusy}>To do</TabsTrigger><TabsTrigger value="completed" disabled={downloadBusy}>Completed</TabsTrigger></TabsList></Tabs><div className="panel-actions"><Button variant="outline" onClick={resource.refresh} disabled={resource.loading || !!busyId}><RefreshCw size={16}/>Refresh messages</Button><Button variant="outline" onClick={download} disabled={resource.loading || !!resource.error || !messages.length || downloadBusy}><Download size={16}/>{downloadBusy ? "Preparing…" : "Download messages"}</Button></div></div>
        <div className="table-toolbar"><Input aria-label="Search messages" placeholder="Search message, task category or related record…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} maxLength={200} disabled={downloadBusy}/><Select value={readState} onValueChange={value => { setReadState(value as typeof readState); setPage(0); }} disabled={downloadBusy}><SelectTrigger aria-label="Filter messages by read state"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All read states</SelectItem><SelectItem value="unread">Unread{unreadCount !== undefined ? ` (${unreadCount})` : ""}</SelectItem><SelectItem value="read">Read</SelectItem></SelectContent></Select><Button variant="outline" size="sm" onClick={clearFilters} disabled={!filtersApplied || downloadBusy || !!busyId}><RotateCcw size={15}/>Clear filters</Button><span className="toolbar-meta">{resource.loading ? "Loading complete inbox…" : resource.error ? "Inbox unavailable" : `${messages.length} matching ${messages.length === 1 ? "message" : "messages"}`}</span></div>
        {notice && <p className="form-message px-5" role="status">{notice}</p>}
        {resource.error && <div className="load-error" role="alert"><span>{resource.error}</span><Button variant="outline" onClick={resource.refresh}>Retry messages</Button></div>}
        {resource.loading ? <div className="loading-panel" role="status"><p>Loading messages addressed to your staff account…</p><Skeleton className="h-24 w-full"/></div> : !resource.error && <>
            <Table><TableHeader><TableRow><TableHead>MESSAGE / TASK</TableHead><TableHead>CREATED / DUE</TableHead><TableHead>TASK STATE</TableHead><TableHead>READ STATE</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{messages.slice(currentPage * 25, (currentPage + 1) * 25).map(message => <TableRow key={message.id}><TableCell><strong className="message-subject">{!message.readAt && <span className="unread-dot" aria-hidden="true"/>}{message.title}</strong><span className="cell-secondary">{taskCategoryLabels[message.cycle.category]}</span><span className="cell-secondary whitespace-pre-wrap">{message.body}</span><span className="cell-secondary">Email not sent · delivery unavailable</span></TableCell><TableCell><strong>{formatTime(message.createdAt)}</strong><span className="cell-secondary">Task due: {formatDateOnly(message.dueOn)}</span></TableCell><TableCell><span className={`status-badge ${message.taskStatus === "completed" ? "in" : "out"}`}>{message.taskStatus === "completed" ? "Completed" : "To do"}</span>{message.taskStatus === "open" && message.dueOn < currentSydneyDate() && <span className="cell-secondary">Overdue</span>}</TableCell><TableCell><span className={`status-badge ${message.readAt ? "read" : "unread"}`}>{message.readAt ? "Read" : "Unread"}</span>{message.readAt && <span className="cell-secondary">Read {formatTime(message.readAt)}</span>}</TableCell><TableCell><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setCycle(message.cycle)}>Open task</Button>{!message.readAt && <Button variant="ghost" size="sm" onClick={() => markRead(message.id)} disabled={!!busyId} aria-label={`Mark ${message.title} as read`}><Check size={16}/>{busyId === message.id ? "Saving…" : "Mark read"}</Button>}</div></TableCell></TableRow>)}</TableBody></Table>
            {!messages.length && <div className="empty-state"><Mail/><h3>{filtersApplied ? "No matching messages" : "No messages yet"}</h3><p>{filtersApplied ? "Clear filters to see all your messages." : "Assigned periodic task reminders will appear here when their configured reminder time is reached and the system is in use."}</p></div>}
            <div className="pagination-bar"><span>{messages.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25, messages.length)} of {messages.length} {messages.length === 1 ? "message" : "messages"}</span><div><Button variant="outline" size="sm" onClick={() => setPage(currentPage - 1)} disabled={!currentPage}>Previous</Button><span>Page {currentPage + 1} of {maxPage + 1}</span><Button variant="outline" size="sm" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= maxPage}>Next</Button></div></div>
        </>}
        <div className="panel-footer">Reading a message does not complete its task. Messages retain their creation and read history; the linked task state remains current.</div>
    </section>{cycle && <TaskCycleDialog cycle={cycle} data={data} onDetail={onDetail} onClose={() => setCycle(null)} onSaved={async () => { setCycle(null); await changed(); }}/>}</>;
}
