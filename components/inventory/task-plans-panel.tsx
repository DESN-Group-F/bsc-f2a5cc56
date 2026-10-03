"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskPlanRecord, TaskCycleRecord } from "@/lib/task-plans";
import {
  taskPlanMatchesQuery,
  taskTemplates,
  type TaskPlan,
} from "@/lib/task-schedule";
import {
  downloadTaskJson,
  formatDateOnly,
  formatTime,
} from "@/lib/client-utils";
import {
  recoverTaskCreate,
  taskCreateStorageKey,
} from "@/lib/task-create-session";
import type { TaskPanelProps } from "@/lib/client/inventory-contracts";
import { taskRequest, type TaskPlansResponse } from "@/lib/client/task-api";
import {
  readTaskRecordAction,
  saveTaskRecordAction,
  clearTaskRecordAction,
  verifyTaskRecordActionReceipt,
  taskRecordActionFinallyRejected,
} from "@/lib/client/task-record-action";
import { useTaskEndpoint } from "@/hooks/use-task-endpoint";
import { TaskPlanEditor } from "./tasks/task-plan-editor";
import { TaskPlanRemovalDialog } from "./tasks/task-plan-removal-dialog";
import { TaskCycleDialog } from "./tasks/task-cycle-dialog";
import {
  TaskDeliveryNotice,
  TaskGenerationWarnings,
} from "./tasks/task-notices";
import {
  assignmentNames,
  taskCategoryLabels,
  targetSummary,
  cycleState,
  reminderLimitation,
} from "./tasks/task-presentation";

export function TaskPlansPanel({ data, onChanged, onDetail }: TaskPanelProps) {
  const [actionRecovery, setActionRecovery] = useState(() =>
    readTaskRecordAction("plans", data.user.id, data.dataset),
  );
  const [recoveringAction, setRecoveringAction] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const actionBlocked =
    !!actionRecovery.input || !!actionRecovery.error || recoveringAction;
  const [visibility, setVisibility] = useState<"current" | "removed">(
    "current",
  );
  const [removalPlan, setRemovalPlan] = useState<TaskPlanRecord | null>(null);
  const [createRecovery] = useState(() => {
    try {
      const raw = sessionStorage.getItem(
        taskCreateStorageKey(data.user.id, data.dataset),
      );
      const attempt = recoverTaskCreate(raw, data.user.id, data.dataset);
      return {
        attempt,
        error:
          raw && !attempt
            ? "A saved task creation request could not be recovered. New task creation is blocked. Preserve this tab and ask the administrator to investigate the saved request."
            : "",
      };
    } catch {
      return {
        attempt: null,
        error:
          "Browser storage is unavailable. New task creation is blocked until the submitted request can be preserved in this tab.",
      };
    }
  });
  const [draft, setDraft] = useState<TaskPlanRecord | TaskPlan | null>(
      createRecovery.attempt?.input.payload ?? null,
    ),
    [selectedCycle, setSelectedCycle] = useState<TaskCycleRecord | null>(null);
  const [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [downloadBusy, setDownloadBusy] = useState(false);
  const resource = useTaskEndpoint<TaskPlansResponse>(
    `/api/task-plans?dataset=${data.dataset}&visibility=${visibility}`,
    data.user.id,
    data.events.map((event) => event.id).join("|"),
    !!draft || !!selectedCycle || !!removalPlan || actionBlocked,
  );
  const admin = data.user.role === "admin",
    plans = resource.payload?.plans ?? [],
    cycles = resource.payload?.cycles ?? [];
  const matching = plans.filter((plan) => taskPlanMatchesQuery(plan, query));
  const matchingPlanIds = new Set(matching.map((plan) => plan.id)),
    matchingCycles = cycles.filter((cycle) =>
      matchingPlanIds.has(cycle.planId),
    );
  async function changed() {
    if (!mounted.current) return;
    resource.refresh();
    try {
      await onChanged?.();
    } catch {
      setNotice(
        "The task change was saved. Refresh the inventory if its shared status has not updated.",
      );
    }
  }
  async function retrySavedPlanAction() {
    const input = actionRecovery.input;
    if (
      !input ||
      recoveringAction ||
      actionRecovery.error ||
      input.dataset !== data.dataset
    )
      return;
    setRecoveringAction(true);
    setNotice("");
    try {
      saveTaskRecordAction("plans", data.user.id, input);
      const response = await taskRequest<{ result: unknown }>(
        "/api/task-plans",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      verifyTaskRecordActionReceipt(response.result, input, data.user.id);
      clearTaskRecordAction("plans", data.user.id, input);
      setActionRecovery({ input: null, error: "" });
      setNotice(
        input.action === "remove"
          ? "The original plan removal was confirmed."
          : "The original plan restoration was confirmed.",
      );
      await changed();
    } catch (error) {
      setNotice((error as Error).message);
      if (taskRecordActionFinallyRejected(error)) {
        try {
          clearTaskRecordAction("plans", data.user.id, input);
          setActionRecovery({ input: null, error: "" });
          if (mounted.current) resource.refresh();
        } catch (storageFailure) {
          setActionRecovery({
            input,
            error: (storageFailure as Error).message,
          });
        }
      }
    } finally {
      setRecoveringAction(false);
    }
  }
  function create(template: (typeof taskTemplates)[number]) {
    if (createRecovery.error) return;
    setDraft({
      ...template.plan,
      batteryIds: [...template.plan.batteryIds],
      assigneeIds:
        template.plan.category === "storage_maintenance" ? [] : [data.user.id],
      channels: [...template.plan.channels],
      scheduledDates: [...template.plan.scheduledDates],
    });
  }
  async function download() {
    setDownloadBusy(true);
    setNotice("");
    try {
      await downloadTaskJson(
        `/api/task-plans?${new URLSearchParams({ dataset: data.dataset, visibility, search: query, download: "json" })}`,
        `periodic-task-records-${data.dataset}.json`,
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
      {actionRecovery.error && (
        <div className="load-error" role="alert">
          <span>{actionRecovery.error}</span>
          <Button
            variant="outline"
            disabled={recoveringAction}
            onClick={() =>
              setActionRecovery(
                readTaskRecordAction("plans", data.user.id, data.dataset),
              )
            }
          >
            Retry saved request recovery
          </Button>
        </div>
      )}
      {actionRecovery.input && (
        <div className="load-error" role="alert">
          <span>
            A saved plan{" "}
            {actionRecovery.input.action === "remove"
              ? "removal"
              : "restoration"}{" "}
            has not been confirmed. Resolve the original request for this
            account and inventory before changing another plan.
          </span>
          <Button
            variant="outline"
            onClick={retrySavedPlanAction}
            disabled={recoveringAction || !!actionRecovery.error}
          >
            {recoveringAction
              ? "Confirming…"
              : `Retry original plan ${actionRecovery.input.action === "remove" ? "removal" : "restoration"}`}
          </Button>
        </div>
      )}
      {createRecovery.error && (
        <p className="form-error" role="alert">
          {createRecovery.error}
        </p>
      )}
      <details className="inventory-panel task-template-library">
        <summary className="section-heading">
          <div>
            <h2>Prepared periodic tasks</h2>
            <p className="field-hint">
              Three supplied templates. Confirm actual applicability and dates
              before activating a plan.
            </p>
          </div>
        </summary>
        <div className="grid gap-3 p-5 md:grid-cols-3">
          {taskTemplates.map((template) => (
            <div className="detail-card mb-0!" key={template.id}>
              <h3>{template.label}</h3>
              <p>{template.description}</p>
              {admin && (
                <Button
                  variant="outline"
                  onClick={() => create(template)}
                  disabled={
                    resource.loading ||
                    !!createRecovery.error ||
                    !!draft ||
                    actionBlocked
                  }
                >
                  <Plus size={16} />
                  Use template
                </Button>
              )}
            </div>
          ))}
        </div>
      </details>
      <section className="inventory-panel">
        <div className="panel-top">
          <div>
            <h2>Shared periodic plans</h2>
            <Tabs
              value={visibility}
              onValueChange={(value) =>
                setVisibility(value as typeof visibility)
              }
            >
              <TabsList aria-label="Plan location">
                <TabsTrigger value="current" disabled={downloadBusy}>
                  Current
                </TabsTrigger>
                <TabsTrigger value="removed" disabled={downloadBusy}>
                  Removed
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="panel-actions">
            <Button
              variant="outline"
              onClick={resource.refresh}
              disabled={resource.loading}
            >
              <RefreshCw size={16} />
              Refresh tasks
            </Button>
            <Button
              variant="outline"
              onClick={download}
              disabled={
                resource.loading ||
                !!resource.error ||
                !matching.length ||
                downloadBusy
              }
            >
              <Download size={16} />
              {downloadBusy ? "Preparing…" : "Download filtered task records"}
            </Button>
          </div>
        </div>
        <div className="table-toolbar">
          <Input
            aria-label="Search periodic tasks"
            placeholder="Search task, category, target or status…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
            disabled={downloadBusy}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setQuery("")}
            disabled={!query || resource.loading || downloadBusy}
          >
            Clear filters
          </Button>
          <span>
            {resource.loading
              ? "Loading complete records…"
              : resource.error
                ? "Task records unavailable"
                : `${matching.length} matching ${matching.length === 1 ? "plan" : "plans"}`}
          </span>
        </div>
        {notice && (
          <p className="form-message px-5" role="status">
            {notice}
          </p>
        )}
        {resource.error && (
          <div className="load-error" role="alert">
            <span>{resource.error}</span>
            <Button variant="outline" onClick={resource.refresh}>
              Retry tasks
            </Button>
          </div>
        )}
        {resource.loading ? (
          <div className="loading-panel" role="status">
            <p>Loading shared plans and recorded cycles…</p>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          !resource.error && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TASK / TARGET</TableHead>
                    <TableHead>STATUS</TableHead>
                    <TableHead>CURRENT DUE / REMINDER</TableHead>
                    <TableHead>ASSIGNMENT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matching.map((plan) => {
                    const open = cycles.find(
                      (cycle) =>
                        cycle.planId === plan.id && cycle.status === "open",
                    );
                    const reminderOn = open
                        ? open.reminderOn
                        : plan.preview.nextReminderOn,
                      reminderTime = open
                        ? open.reminderTime
                        : plan.preview.reminderTime;
                    return (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <strong>{plan.title}</strong>
                          <span className="cell-secondary">
                            {taskCategoryLabels[plan.category]} ·{" "}
                            {targetSummary(plan, data)}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {open && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedCycle(open)}
                              >
                                {open.planRemoved
                                  ? "View task"
                                  : open.canComplete
                                    ? "Complete task"
                                    : "View task"}
                              </Button>
                            )}
                            {admin && !plan.removedAt && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDraft(plan)}
                                disabled={actionBlocked}
                                aria-label={`Edit ${plan.title}`}
                              >
                                <Pencil size={16} />
                                Edit
                              </Button>
                            )}
                            {admin && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRemovalPlan(plan)}
                                disabled={actionBlocked}
                                aria-label={`${plan.removedAt ? "Restore" : "Remove"} plan: ${plan.title}`}
                              >
                                {plan.removedAt ? (
                                  <Undo2 size={16} />
                                ) : (
                                  <Trash2 size={16} />
                                )}
                                {plan.removedAt ? "Restore" : "Remove"}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`status-badge ${!plan.removedAt && plan.state === "active" ? "in" : "out"}`}
                          >
                            {plan.removedAt
                              ? "Removed"
                              : plan.state === "active"
                                ? "Active"
                                : plan.state === "paused"
                                  ? "Paused"
                                  : "Draft"}
                          </span>
                          {plan.removedAt && (
                            <span className="cell-secondary">
                              Removed {formatTime(plan.removedAt)} · previous
                              status: {plan.state}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {plan.removedAt && (
                            <strong className="cell-secondary">
                              Generation stopped
                            </strong>
                          )}
                          <strong>
                            {open
                              ? formatDateOnly(open.dueOn)
                              : plan.preview.nextDueOn
                                ? formatDateOnly(plan.preview.nextDueOn)
                                : "Not configured"}
                          </strong>
                          <span className="cell-secondary">
                            Reminder: {formatDateOnly(reminderOn)}
                            {reminderTime
                              ? ` at ${reminderTime} Sydney`
                              : " · time not selected"}
                          </span>
                          {reminderLimitation(
                            open?.reminderStatus ?? plan.preview.reminderStatus,
                          ) && (
                            <span className="cell-secondary">
                              {reminderLimitation(
                                open?.reminderStatus ??
                                  plan.preview.reminderStatus,
                              )}
                            </span>
                          )}
                          {open && (
                            <span className="cell-secondary">
                              Recorded open cycle
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {assignmentNames(plan.assigneeIds, data)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!matching.length && (
                <div className="empty-state">
                  <CalendarDays />
                  <h3>
                    {plans.length
                      ? "No matching plans"
                      : visibility === "removed"
                        ? "No removed plans"
                        : "No periodic plans saved"}
                  </h3>
                  <p>
                    {plans.length
                      ? "Try another search."
                      : visibility === "removed"
                        ? "Removed plans remain available here for an administrator to restore."
                        : "Open Prepared periodic tasks to use a supplied template."}
                  </p>
                </div>
              )}
            </>
          )
        )}
        <div className="panel-footer">
          Plans and cycles are shared business records. Removing a plan stops
          task generation and blocks its pending tasks until an administrator
          restores it. Recorded deadlines and completion history are retained.
        </div>
      </section>
      {!resource.loading && !resource.error && matchingCycles.length > 0 && (
        <section className="inventory-panel mt-5">
          <div className="section-heading">
            <h2>Recorded task cycles</h2>
            <span className="toolbar-meta">
              {matchingCycles.length}{" "}
              {matchingCycles.length === 1 ? "cycle" : "cycles"} · Sydney time
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TASK</TableHead>
                <TableHead>DUE DATE</TableHead>
                <TableHead>STATE</TableHead>
                <TableHead>RECORDED COMPLETION</TableHead>
                <TableHead>DETAILS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matchingCycles.map((cycle) => (
                <TableRow key={cycle.id}>
                  <TableCell>
                    <strong>{cycle.title}</strong>
                    <span className="cell-secondary">
                      {taskCategoryLabels[cycle.category]}
                    </span>
                  </TableCell>
                  <TableCell>{formatDateOnly(cycle.dueOn)}</TableCell>
                  <TableCell>
                    {cycle.status === "completed"
                      ? "Completed"
                      : cycle.planRemoved
                        ? "Plan removed"
                        : cycleState(cycle)}
                  </TableCell>
                  <TableCell>
                    {cycle.completedAt ? (
                      <>
                        {formatTime(cycle.completedAt)}
                        <span className="cell-secondary">
                          {cycle.completedByName}
                        </span>
                      </>
                    ) : (
                      "Not completed"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCycle(cycle)}
                    >
                      {cycle.status === "completed"
                        ? "View completion"
                        : !cycle.planRemoved && cycle.canComplete
                          ? "Complete task"
                          : "View task"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
      {removalPlan && (
        <TaskPlanRemovalDialog
          original={removalPlan}
          data={data}
          onClose={() => setRemovalPlan(null)}
          onSaved={async () => {
            setRemovalPlan(null);
            await changed();
          }}
        />
      )}
      {draft && (
        <TaskPlanEditor
          key={"id" in draft ? draft.id : `new-${draft.category}`}
          original={draft}
          data={data}
          cycles={cycles}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await changed();
          }}
        />
      )}
      {selectedCycle && (
        <TaskCycleDialog
          cycle={selectedCycle}
          data={data}
          onDetail={onDetail}
          onClose={() => setSelectedCycle(null)}
          onSaved={async () => {
            setSelectedCycle(null);
            await changed();
          }}
        />
      )}
    </>
  );
}
