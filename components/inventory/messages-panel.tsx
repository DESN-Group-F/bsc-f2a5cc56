"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  Mail,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  InboxMessage,
  TaskCycleRecord,
  TaskGenerationIssue,
} from "@/lib/task-plans";
import { currentSydneyDate } from "@/lib/battery-age";
import {
  downloadTaskJson,
  formatDateOnly,
  formatTime,
} from "@/lib/client-utils";
import type { TaskPanelProps } from "@/lib/client/inventory-contracts";
import { taskRequest } from "@/lib/client/task-api";
import {
  captureTaskRecordAction,
  readTaskRecordAction,
  saveTaskRecordAction,
  clearTaskRecordAction,
  taskRecordActionFinallyRejected,
  verifyTaskRecordActionReceipt,
  type TaskRecordAction,
} from "@/lib/client/task-record-action";
import { useTaskEndpoint } from "@/hooks/use-task-endpoint";
import { TaskCycleDialog } from "./tasks/task-cycle-dialog";
import {
  TaskDeliveryNotice,
  TaskGenerationWarnings,
} from "./tasks/task-notices";
import { taskCategoryLabels } from "./tasks/task-presentation";

type MessagesResponse = {
  messages: InboxMessage[];
  unreadCount: number;
  capabilities: {
    emailAvailable: boolean;
    schedulerAvailable: boolean;
    messageGeneration: string;
    note: string;
  };
  generationIssues: TaskGenerationIssue[];
};

export function MessagesPanel({
  data,
  onChanged,
  onDetail,
  onUnreadCount,
}: TaskPanelProps & { onUnreadCount?: (count: number) => void }) {
  const [visibility, setVisibility] = useState<"current" | "removed">(
    "current",
  );
  const [recovery] = useState(() =>
    readTaskRecordAction("messages", data.user.id, data.dataset),
  );
  const [pendingAction, setPendingAction] = useState<TaskRecordAction | null>(
    recovery.input,
  );
  const [storageError, setStorageError] = useState(recovery.error);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [taskStatus, setTaskStatus] = useState<"all" | "open" | "completed">(
    "all",
  );
  const [readState, setReadState] = useState<"all" | "unread" | "read">("all"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [cycle, setCycle] = useState<TaskCycleRecord | null>(null),
    [busyId, setBusyId] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [downloadBusy, setDownloadBusy] = useState(false);
  const parameters = new URLSearchParams({
    dataset: data.dataset,
    visibility,
    taskStatus,
    readState,
    search: query,
  });
  const filtersApplied =
    taskStatus !== "all" || readState !== "all" || query !== "";
  function clearFilters() {
    setTaskStatus("all");
    setReadState("all");
    setQuery("");
    setPage(0);
  }
  const resource = useTaskEndpoint<MessagesResponse>(
    `/api/messages?${parameters}`,
    data.user.id,
    data.events.map((event) => event.id).join("|"),
    !!cycle || !!busyId || !!pendingAction || downloadBusy,
  );
  const messages = resource.payload?.messages ?? [],
    maxPage = Math.max(0, Math.ceil(messages.length / 25) - 1),
    currentPage = Math.min(page, maxPage);
  const unreadCount = resource.payload?.unreadCount;
  useEffect(() => {
    if (unreadCount !== undefined) onUnreadCount?.(unreadCount);
  }, [unreadCount, onUnreadCount]);
  async function changed() {
    if (!mounted.current) return;
    resource.refresh();
    try {
      await onChanged?.();
    } catch {
      setNotice(
        "The message or task change was saved. Refresh the inventory if shared status has not updated.",
      );
    }
  }
  async function markRead(id: string) {
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
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusyId(null);
    }
  }
  async function changeVisibility(input: TaskRecordAction) {
    if (storageError || input.dataset !== data.dataset || busyId) return;
    try {
      saveTaskRecordAction("messages", data.user.id, input);
    } catch (error) {
      setStorageError(
        `The request could not be preserved. No change was sent. ${(error as Error).message}`,
      );
      return;
    }
    setPendingAction(input);
    setBusyId(input.payload.id);
    setNotice("");
    try {
      const body = await taskRequest<{ result: unknown }>("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      verifyTaskRecordActionReceipt(body.result, input, data.user.id);
      clearTaskRecordAction("messages", data.user.id, input);
      setPendingAction(null);
      setNotice(
        input.action === "remove"
          ? "Message moved to Removed. The shared task is unchanged."
          : "Message restored to your inbox.",
      );
      await changed();
    } catch (error) {
      setNotice((error as Error).message);
      if (taskRecordActionFinallyRejected(error)) {
        try {
          clearTaskRecordAction("messages", data.user.id, input);
          setPendingAction(null);
          if (mounted.current) resource.refresh();
        } catch (storageFailure) {
          setStorageError((storageFailure as Error).message);
        }
      }
    } finally {
      setBusyId(null);
    }
  }
  async function download() {
    setDownloadBusy(true);
    setNotice("");
    try {
      await downloadTaskJson(
        `/api/messages?${parameters}&download=json`,
        `my-messages-${data.dataset}.json`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setDownloadBusy(false);
    }
  }
  return (
    <>
      <TaskDeliveryNotice />
      <TaskGenerationWarnings
        issues={resource.payload?.generationIssues ?? []}
      />
      <section
        className="inventory-panel"
        aria-label="Personal messages"
        aria-busy={resource.loading}
      >
        <div className="panel-top message-panel-top">
          <Tabs
            className="message-status-tabs"
            value={visibility}
            onValueChange={(value) => {
              setVisibility(value as typeof visibility);
              setPage(0);
            }}
          >
            <TabsList aria-label="Message location">
              <TabsTrigger
                value="current"
                disabled={!!busyId || !!pendingAction || downloadBusy}
              >
                Inbox
              </TabsTrigger>
              <TabsTrigger
                value="removed"
                disabled={!!busyId || !!pendingAction || downloadBusy}
              >
                Removed
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs
            value={taskStatus}
            onValueChange={(value) => {
              setTaskStatus(value as typeof taskStatus);
              setPage(0);
            }}
          >
            <TabsList variant="line">
              <TabsTrigger
                value="all"
                disabled={downloadBusy || !!busyId || !!pendingAction}
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="open"
                disabled={downloadBusy || !!busyId || !!pendingAction}
              >
                To do
              </TabsTrigger>
              <TabsTrigger
                value="completed"
                disabled={downloadBusy || !!busyId || !!pendingAction}
              >
                Completed
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="panel-actions">
            <Button
              variant="outline"
              onClick={resource.refresh}
              disabled={resource.loading || !!busyId || !!pendingAction}
            >
              <RefreshCw size={16} />
              Refresh messages
            </Button>
            <Button
              variant="outline"
              onClick={download}
              disabled={
                resource.loading ||
                !!resource.error ||
                !messages.length ||
                !!pendingAction ||
                downloadBusy
              }
            >
              <Download size={16} />
              {downloadBusy ? "Preparing…" : "Download messages"}
            </Button>
          </div>
        </div>
        <div className="table-toolbar">
          <Input
            aria-label="Search messages"
            placeholder="Search message, task category or related record…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            maxLength={200}
            disabled={downloadBusy || !!busyId || !!pendingAction}
          />
          <Select
            value={readState}
            onValueChange={(value) => {
              setReadState(value as typeof readState);
              setPage(0);
            }}
            disabled={downloadBusy || !!busyId || !!pendingAction}
          >
            <SelectTrigger aria-label="Filter messages by read state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All read states</SelectItem>
              <SelectItem value="unread">
                Unread{unreadCount !== undefined ? ` (${unreadCount})` : ""}
              </SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            disabled={
              !filtersApplied || downloadBusy || !!busyId || !!pendingAction
            }
          >
            <RotateCcw size={15} />
            Clear filters
          </Button>
          <span className="toolbar-meta">
            {resource.loading
              ? "Loading complete inbox…"
              : resource.error
                ? "Inbox unavailable"
                : `${messages.length} matching ${messages.length === 1 ? "message" : "messages"}`}
          </span>
        </div>
        {notice && (
          <p className="form-message px-5" role="status">
            {notice}
          </p>
        )}
        {storageError && (
          <div className="load-error" role="alert">
            <span>{storageError}</span>
            <Button
              variant="outline"
              onClick={() => {
                const saved = readTaskRecordAction(
                  "messages",
                  data.user.id,
                  data.dataset,
                );
                setStorageError(saved.error);
                setPendingAction(saved.input);
              }}
            >
              Retry saved request recovery
            </Button>
          </div>
        )}
        {pendingAction && !busyId && (
          <div className="px-5 pb-3" role="alert">
            <p>
              A saved message{" "}
              {pendingAction.action === "remove" ? "removal" : "restoration"}{" "}
              has not been confirmed. Retry the original request for this
              account and inventory before making another change.
            </p>
            <Button
              variant="outline"
              onClick={() => changeVisibility(pendingAction)}
              disabled={!!storageError}
            >
              Retry original{" "}
              {pendingAction.action === "remove" ? "removal" : "restoration"}
            </Button>
          </div>
        )}
        {resource.error && (
          <div className="load-error" role="alert">
            <span>{resource.error}</span>
            <Button variant="outline" onClick={resource.refresh}>
              Retry messages
            </Button>
          </div>
        )}
        {resource.loading ? (
          <div className="loading-panel" role="status">
            <p>Loading messages addressed to your staff account…</p>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          !resource.error && (
            <>
              <div className="message-inbox-cards">
                {messages
                  .slice(currentPage * 25, (currentPage + 1) * 25)
                  .map((message) => {
                    const completed = message.taskStatus === "completed";
                    const removedPlan = message.cycle.planRemoved;
                    const actionable =
                      !completed && !removedPlan && message.cycle.canComplete;
                    return (
                      <article className="message-inbox-card" key={message.id}>
                        <div className="message-inbox-content">
                          <h3 className="message-subject">
                            {!message.readAt && (
                              <span className="unread-dot" aria-hidden="true" />
                            )}
                            {message.title}
                          </h3>
                          <div className="message-inbox-meta">
                            <span
                              className={`status-badge ${completed ? "in" : "out"}`}
                            >
                              {completed
                                ? "Completed"
                                : removedPlan
                                  ? "Plan removed"
                                  : "To do"}
                            </span>
                            <span
                              className={`status-badge ${message.readAt ? "read" : "unread"}`}
                            >
                              {message.readAt ? "Read" : "Unread"}
                            </span>
                            <span>
                              {taskCategoryLabels[message.cycle.category]}
                            </span>
                            <span>
                              Due {formatDateOnly(message.dueOn)}
                              {!completed &&
                              !removedPlan &&
                              message.dueOn < currentSydneyDate()
                                ? " · Overdue"
                                : ""}
                            </span>
                          </div>
                          {!completed && removedPlan && (
                            <p className="field-hint">
                              This plan has been removed. An administrator must
                              restore it before this task can be completed.
                            </p>
                          )}
                          {!completed &&
                            !removedPlan &&
                            !message.cycle.canComplete && (
                              <p className="field-hint">
                                Only currently assigned staff or an
                                administrator can complete this task.
                              </p>
                            )}
                          <details className="message-inbox-details">
                            <summary>Message details</summary>
                            <p className="whitespace-pre-wrap">
                              {message.body}
                            </p>
                            <p className="field-hint">
                              Created {formatTime(message.createdAt)}
                              {message.readAt
                                ? ` · Read ${formatTime(message.readAt)}`
                                : ""}
                              {message.removedAt
                                ? ` · Removed ${formatTime(message.removedAt)}`
                                : ""}
                            </p>
                            <p className="field-hint">
                              Email not sent · delivery unavailable
                            </p>
                          </details>
                        </div>
                        <div className="message-inbox-actions">
                          <Button
                            variant={actionable ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCycle(message.cycle)}
                            disabled={
                              !!busyId || !!pendingAction || !!storageError
                            }
                          >
                            {completed
                              ? "View completion"
                              : actionable
                                ? "Complete task"
                                : "View task"}
                          </Button>
                          {!message.readAt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markRead(message.id)}
                              disabled={
                                !!busyId || !!pendingAction || !!storageError
                              }
                              aria-label={`Mark ${message.title} as read`}
                            >
                              <Check size={16} />
                              Mark read
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              changeVisibility(
                                captureTaskRecordAction(
                                  data.dataset,
                                  message.removedAt ? "restore" : "remove",
                                  message,
                                ),
                              )
                            }
                            disabled={
                              !!busyId || !!pendingAction || !!storageError
                            }
                            aria-label={`${message.removedAt ? "Restore" : "Remove"} message: ${message.title}`}
                          >
                            {message.removedAt ? (
                              <Undo2 size={16} />
                            ) : (
                              <Trash2 size={16} />
                            )}
                            {busyId === message.id
                              ? "Saving…"
                              : message.removedAt
                                ? "Restore"
                                : "Remove"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
              </div>
              {!messages.length && (
                <div className="empty-state">
                  <Mail />
                  <h3>
                    {filtersApplied
                      ? "No matching messages"
                      : visibility === "removed"
                        ? "No removed messages"
                        : "No messages yet"}
                  </h3>
                  <p>
                    {filtersApplied
                      ? "Clear filters to see all your messages."
                      : visibility === "removed"
                        ? "Messages you remove from your inbox remain available here to restore."
                        : "Assigned periodic task reminders will appear here when their configured reminder time is reached and the system is in use."}
                  </p>
                </div>
              )}
              <div className="pagination-bar">
                <span>
                  {messages.length ? currentPage * 25 + 1 : 0}–
                  {Math.min((currentPage + 1) * 25, messages.length)} of{" "}
                  {messages.length}{" "}
                  {messages.length === 1 ? "message" : "messages"}
                </span>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={!currentPage}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {currentPage + 1} of {maxPage + 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage >= maxPage}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )
        )}
        <div className="panel-footer">
          Removing a message only moves it out of your inbox; it does not cancel
          or complete the shared task. Restore it from Removed at any time.
          Reading and task completion are separate states.
        </div>
      </section>
      {cycle && (
        <TaskCycleDialog
          cycle={cycle}
          data={data}
          onDetail={onDetail}
          onClose={() => setCycle(null)}
          onSaved={async () => {
            setCycle(null);
            await changed();
          }}
        />
      )}
    </>
  );
}
