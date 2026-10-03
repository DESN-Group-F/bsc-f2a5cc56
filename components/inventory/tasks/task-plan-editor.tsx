"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { InventorySnapshot } from "@/lib/domain";
import type { TaskPlanRecord, TaskCycleRecord } from "@/lib/task-plans";
import {
  taskPlanSchema,
  taskSchedulePreview,
  taskTargetsByCategory,
  type TaskPlan,
} from "@/lib/task-schedule";
import { currentSydneyDate } from "@/lib/battery-age";
import {
  formatDateOnly,
  roomLabel,
  staffIdentityLabel,
} from "@/lib/client-utils";
import { isSelectableRoom } from "@/lib/location-catalog";
import {
  captureTaskCreate,
  recoverTaskCreate,
  taskCreateFailureStatus,
  taskCreateStorageKey,
  verifyTaskCreateReceipt,
  type TaskCreateAttempt,
} from "@/lib/task-create-session";
import {
  taskRequest,
  type TaskPlansResponse,
  type RequestError,
} from "@/lib/client/task-api";
import {
  assignmentNames,
  taskCategoryLabels,
  targetLabels,
} from "./task-presentation";

export function TaskPlanEditor({
  original,
  data,
  cycles,
  onClose,
  onSaved,
}: {
  original: TaskPlanRecord | TaskPlan;
  data: InventorySnapshot;
  cycles: TaskCycleRecord[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = "id" in original ? original : null;
  const storageKey = taskCreateStorageKey(data.user.id, data.dataset);
  const [recovery] = useState(() => {
    if (existing) return { attempt: null, error: "" };
    try {
      const raw = sessionStorage.getItem(storageKey),
        attempt = recoverTaskCreate(raw, data.user.id, data.dataset);
      return {
        attempt,
        error:
          raw && !attempt
            ? "The saved task creation request cannot be recovered. No new request will replace it; preserve this tab and ask the administrator to investigate."
            : "",
      };
    } catch {
      return {
        attempt: null,
        error:
          "Browser storage is unavailable. No task creation can be sent until its exact request can be preserved.",
      };
    }
  });
  const [draft, setDraft] = useState<TaskPlan>(
      () => recovery.attempt?.input.payload ?? taskPlanSchema.parse(original),
    ),
    [expectedVersion, setExpectedVersion] = useState(existing?.version);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(
      recovery.error || recovery.attempt?.message || "",
    ),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<TaskPlanRecord | null>(null);
  const [creation, setCreation] = useState<TaskCreateAttempt | null>(
    recovery.attempt,
  );
  const captured = useRef(creation),
    running = useRef(false);
  const attempt = useRef({ signature: "", requestId: "" });
  const [batterySearch, setBatterySearch] = useState(""),
    [datesText, setDatesText] = useState(
      (recovery.attempt?.input.payload ?? original).scheduledDates.join("\n"),
    );
  const [reviewedCycles, setReviewedCycles] = useState(cycles),
    [latestCycles, setLatestCycles] = useState<TaskCycleRecord[] | null>(null);
  const openCycle = existing
    ? reviewedCycles.find(
        (cycle) => cycle.planId === existing.id && cycle.status === "open",
      )
    : undefined;
  const lastCycle = existing
    ? reviewedCycles
        .filter((cycle) => cycle.planId === existing.id)
        .sort((a, b) => b.dueOn.localeCompare(a.dueOn))[0]
    : undefined;
  const validation = taskPlanSchema.safeParse({
    ...draft,
    scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean),
  });
  const previewValidation = taskPlanSchema.safeParse({
    ...draft,
    state: "draft",
    scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean),
  });
  let preview: ReturnType<typeof taskSchedulePreview> | null = null,
    previewError = "";
  if (previewValidation.success) {
    try {
      preview = taskSchedulePreview(previewValidation.data, {
        lastDueOn: lastCycle?.dueOn,
        completedOn: lastCycle?.completedAt
          ? currentSydneyDate(new Date(lastCycle.completedAt))
          : null,
      });
    } catch (error) {
      previewError = (error as Error).message;
    }
  }
  const rooms = data.rooms.filter(isSelectableRoom),
    models = [
      ...new Set(
        data.batteries.map((battery) => battery.model).filter(Boolean),
      ),
    ].sort();
  const visibleBatteries = data.batteries.filter((battery) =>
    `${battery.id} ${battery.name} ${battery.model}`
      .toLowerCase()
      .includes(batterySearch.toLowerCase()),
  );
  const placeholderArea =
    draft.targetKind === "storage_area" &&
    data.rooms.find((room) => room.id === draft.targetRef)?.isPlaceholder;
  const activeBlockedByPlaceholder =
    data.dataset === "live" && draft.state === "active" && placeholderArea;
  const locked = busy || !!creation || !!recovery.error;
  useEffect(() => {
    if (!busy && creation?.status !== "uncertain") return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [busy, creation?.status]);
  function persistCreation(next: TaskCreateAttempt | null) {
    try {
      if (next) {
        const raw = sessionStorage.getItem(storageKey);
        if (raw && !captured.current)
          throw new Error(
            "An unresolved task creation is already saved in this tab. Reopen Periodic tasks to recover it before creating another plan.",
          );
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } else sessionStorage.removeItem(storageKey);
      captured.current = next;
      setCreation(next);
      return true;
    } catch (error) {
      setError(
        `${(error as Error).message} Browser storage must preserve the original task request before another creation can be sent.`,
      );
      return false;
    }
  }
  function close() {
    if (running.current || captured.current || recovery.error) return;
    onClose();
  }
  function reviewRejectedCreation() {
    if (
      running.current ||
      captured.current?.status !== "rejected" ||
      !persistCreation(null)
    )
      return;
    setError(
      "The submitted task creation was rejected. Review its targets and assignments before submitting a new request.",
    );
  }
  async function sendCreation(
    originalAttempt: TaskCreateAttempt,
    alreadyUncertain: boolean,
  ) {
    if (running.current || recovery.error) return;
    running.current = true;
    setBusy(true);
    setError("");
    const sending: TaskCreateAttempt = {
      ...originalAttempt,
      status: "uncertain",
      message: "Waiting for the server to confirm this exact task creation.",
    };
    let saved = false;
    try {
      if (!persistCreation(sending)) return;
      const body = await taskRequest<{ ok: boolean; result: unknown }>(
        "/api/task-plans",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sending.input),
        },
      );
      if (body.ok !== true)
        throw new Error("The task creation response could not be verified.");
      verifyTaskCreateReceipt(body.result, sending);
      if (!persistCreation(null)) return;
      saved = true;
      await onSaved();
    } catch (error) {
      if (saved) {
        setError(
          "The task plan was saved. Refresh the task list if its shared status has not updated.",
        );
        return;
      }
      const status = taskCreateFailureStatus(error, alreadyUncertain);
      const failed: TaskCreateAttempt = {
        ...sending,
        status,
        message:
          status === "uncertain"
            ? `Result uncertain. ${(error as Error).message} Retry the original request before editing or closing.`
            : (error as Error).message,
      };
      if (!persistCreation(failed)) {
        captured.current = failed;
        setCreation(failed);
      }
      setError(failed.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function update(patch: Partial<TaskPlan>, reconfirm = true) {
    if (running.current || captured.current || recovery.error) return;
    setDraft((previous) => ({
      ...previous,
      ...patch,
      ...(reconfirm ? { applicabilityConfirmed: false } : {}),
    }));
  }
  function toggleId(
    key: "batteryIds" | "assigneeIds",
    id: string,
    checked: boolean,
  ) {
    update({
      [key]: checked
        ? [...new Set([...draft[key], id])]
        : draft[key].filter((value) => value !== id),
    });
  }
  function assignOwners() {
    const targets = ["batteries", "group"].includes(draft.targetKind)
      ? data.batteries.filter((battery) =>
          draft.batteryIds.includes(battery.id),
        )
      : draft.targetKind === "model"
        ? data.batteries.filter((battery) => battery.model === draft.targetRef)
        : draft.targetKind === "storage_area"
          ? data.batteries.filter(
              (battery) => battery.homeRoomId === draft.targetRef,
            )
          : draft.targetKind === "inventory"
            ? data.batteries
            : [];
    update({
      assigneeIds: [
        ...new Set(
          targets.flatMap((battery) =>
            battery.ownerAccountId &&
            data.staffDirectory.some(
              (staff) => staff.id === battery.ownerAccountId && staff.active,
            )
              ? [battery.ownerAccountId]
              : [],
          ),
        ),
      ],
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (running.current || captured.current || recovery.error) return;
    setError("");
    if (!validation.success) {
      setError(validation.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    if (previewError) {
      setError(previewError);
      return;
    }
    if (
      draft.state === "active" &&
      preview &&
      ["ambiguous", "nonexistent"].includes(preview.reminderStatus)
    ) {
      setError(
        "Choose a reminder time that is valid and unambiguous in Sydney before activation.",
      );
      return;
    }
    if (activeBlockedByPlaceholder) {
      setError(
        "Confirm the actual storage area before activating a working-inventory plan. This room is a placeholder.",
      );
      return;
    }
    if (!existing) {
      try {
        await sendCreation(
          captureTaskCreate(
            validation.data,
            data.user.id,
            data.dataset,
            crypto.randomUUID(),
          ),
          false,
        );
      } catch (error) {
        setError((error as Error).message);
      }
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      const input = {
        dataset: data.dataset,
        action: existing ? "update" : "create",
        payload: {
          ...validation.data,
          ...(existing ? { id: existing.id, expectedVersion } : {}),
        },
      };
      const signature = JSON.stringify(input);
      if (attempt.current.signature !== signature)
        attempt.current = { signature, requestId: crypto.randomUUID() };
      await taskRequest("/api/task-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          requestId: attempt.current.requestId,
        }),
      });
      await onSaved();
    } catch (error) {
      setError((error as Error).message);
      if ((error as RequestError).status === 409) setConflict(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function loadLatest() {
    if (!existing) return;
    setBusy(true);
    try {
      const body = await taskRequest<TaskPlansResponse>(
        `/api/task-plans?dataset=${data.dataset}`,
      );
      const plan = body.plans.find((plan) => plan.id === existing.id);
      if (!plan)
        throw new Error(
          "This plan is no longer available. Your draft is preserved.",
        );
      setLatest(plan);
      setLatestCycles(body.cycles);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function acceptLatest() {
    if (!latest) return;
    setDraft(taskPlanSchema.parse(latest));
    setDatesText(latest.scheduledDates.join("\n"));
    setExpectedVersion(latest.version);
    if (latestCycles) setReviewedCycles(latestCycles);
    setLatestCycles(null);
    setLatest(null);
    setConflict(false);
    setError("");
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="record-dialog"
        showCloseButton={!busy && !creation && !recovery.error}
        onEscapeKeyDown={(event) => {
          if (running.current || captured.current || recovery.error)
            event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (running.current || captured.current || recovery.error)
            event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit periodic task" : "Prepare periodic task"}
          </DialogTitle>
          <DialogDescription>
            {taskCategoryLabels[draft.category]}. Supplied timing is provisional
            until its basis and applicability are confirmed.
          </DialogDescription>
        </DialogHeader>
        <form className="form-stack" onSubmit={save}>
          <div className="form-field">
            <Label htmlFor="task-title">Task title</Label>
            <Input
              id="task-title"
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              maxLength={160}
              required
              disabled={locked}
            />
          </div>
          <div className="form-field">
            <Label htmlFor="task-description">What must be done</Label>
            <Textarea
              id="task-description"
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
              maxLength={4000}
              disabled={locked}
            />
          </div>
          <div className="form-field">
            <Label htmlFor="task-basis">
              Applicable instruction or management basis
            </Label>
            <Textarea
              id="task-basis"
              value={draft.basis}
              onChange={(event) => update({ basis: event.target.value })}
              maxLength={2000}
              disabled={locked}
            />
          </div>
          <div className="form-field">
            <Label>Applies to</Label>
            <Select
              value={draft.targetKind}
              onValueChange={(value) =>
                update({
                  targetKind: value as TaskPlan["targetKind"],
                  targetRef: null,
                  batteryIds: [],
                })
              }
              disabled={locked}
            >
              <SelectTrigger aria-label="Periodic task target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {taskTargetsByCategory[draft.category].map((id) => (
                  <SelectItem key={id} value={id}>
                    {targetLabels[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.targetKind === "storage_area" && (
            <div className="form-field">
              <Label>Storage area</Label>
              <Select
                value={draft.targetRef ?? "__unset"}
                onValueChange={(value) =>
                  update({ targetRef: value === "__unset" ? null : value })
                }
                disabled={locked}
              >
                <SelectTrigger aria-label="Periodic task storage area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">Area not selected</SelectItem>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {roomLabel(room)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {placeholderArea && (
                <p className="field-hint">
                  {data.dataset === "demo"
                    ? "This is a demonstration placeholder, suitable only for a labelled prototype task."
                    : "This area is a placeholder. Working-inventory activation requires a confirmed actual storage area."}
                </p>
              )}
            </div>
          )}
          {draft.targetKind === "model" && (
            <div className="form-field">
              <Label>Registered battery model</Label>
              <Select
                value={draft.targetRef ?? "__unset"}
                onValueChange={(value) =>
                  update({ targetRef: value === "__unset" ? null : value })
                }
                disabled={locked}
              >
                <SelectTrigger aria-label="Periodic task model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">Model not selected</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!models.length && (
                <p className="field-hint">
                  No models are recorded yet. Keep this plan as a draft.
                </p>
              )}
            </div>
          )}
          {draft.targetKind === "group" && (
            <div className="form-field">
              <Label htmlFor="task-group">Defined group name</Label>
              <Input
                id="task-group"
                value={draft.targetRef ?? ""}
                onChange={(event) =>
                  update({ targetRef: event.target.value || null })
                }
                maxLength={120}
                disabled={locked}
              />
              <p className="field-hint">
                Select the registered batteries belonging to this group below; a
                name alone does not define membership or applicability.
              </p>
            </div>
          )}
          {["batteries", "group"].includes(draft.targetKind) && (
            <fieldset className="detail-card">
              <legend className="text-sm font-semibold">
                Registered batteries · {draft.batteryIds.length} selected
              </legend>
              <Input
                aria-label="Find task batteries"
                placeholder="Search registered battery ID, name or model…"
                value={batterySearch}
                onChange={(event) => setBatterySearch(event.target.value)}
                disabled={locked}
              />
              <div className="my-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBatterySearch("")}
                  disabled={!batterySearch || locked}
                >
                  Clear filters
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update({
                      batteryIds: [
                        ...new Set([
                          ...draft.batteryIds,
                          ...visibleBatteries.map((battery) => battery.id),
                        ]),
                      ],
                    })
                  }
                  disabled={
                    locked ||
                    !visibleBatteries.length ||
                    new Set([
                      ...draft.batteryIds,
                      ...visibleBatteries.map((battery) => battery.id),
                    ]).size > 100
                  }
                >
                  Select filtered batteries
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ batteryIds: [] })}
                  disabled={locked}
                >
                  Clear battery selection
                </Button>
              </div>
              <div className="max-h-44 overflow-y-auto">
                {visibleBatteries.map((battery) => (
                  <label className="export-option" key={battery.id}>
                    <Checkbox
                      checked={draft.batteryIds.includes(battery.id)}
                      onCheckedChange={(value) =>
                        toggleId("batteryIds", battery.id, value === true)
                      }
                      disabled={
                        locked ||
                        (!draft.batteryIds.includes(battery.id) &&
                          draft.batteryIds.length >= 100)
                      }
                    />
                    <span>
                      <strong>
                        {battery.id} · {battery.name}
                      </strong>
                      <small>{battery.model || "Model not recorded"}</small>
                    </span>
                  </label>
                ))}
                {!visibleBatteries.length && (
                  <p className="field-hint">
                    No matching registered batteries.
                  </p>
                )}
              </div>
              <p className="field-hint">
                Explicit battery and group selections support up to 100
                batteries. A model-based plan can cover the applicable
                registered model without individually selecting its batteries.
              </p>
            </fieldset>
          )}
          <div className="form-field">
            <Label htmlFor="task-scope">Scope and applicability</Label>
            <Textarea
              id="task-scope"
              value={draft.scopeNote}
              onChange={(event) => update({ scopeNote: event.target.value })}
              maxLength={2000}
              disabled={locked}
              placeholder="Describe the actual area, inventory or assets covered, and why this requirement applies."
            />
          </div>
          <fieldset className="detail-card">
            <legend className="text-sm font-semibold">Assigned staff</legend>
            <p className="field-hint">
              Existing staff accounts; one actual completion closes the shared
              cycle for all assignees.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={assignOwners}
              disabled={locked}
            >
              Use responsible owners
            </Button>
            <div className="max-h-44 overflow-y-auto">
              {data.staffDirectory
                .filter(
                  (staff) =>
                    staff.active || draft.assigneeIds.includes(staff.id),
                )
                .map((staff) => (
                  <label className="export-option" key={staff.id}>
                    <Checkbox
                      checked={draft.assigneeIds.includes(staff.id)}
                      onCheckedChange={(value) =>
                        toggleId("assigneeIds", staff.id, value === true)
                      }
                      disabled={
                        locked ||
                        (!staff.active && !draft.assigneeIds.includes(staff.id))
                      }
                    />
                    <span>
                      <strong>
                        {staffIdentityLabel(
                          staff.displayName,
                          staff.username,
                          staff.id,
                        )}
                      </strong>
                      <small>
                        {staff.active
                          ? staff.id === data.user.id
                            ? "Your account"
                            : "Active staff account"
                          : "Disabled account; remove or reassign before activation"}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
            {draft.assigneeIds.some(
              (id) => !data.staffDirectory.some((staff) => staff.id === id),
            ) && (
              <p className="form-error">
                An assigned account is unavailable. Use responsible owners or
                choose reviewed staff assignments to replace it.
              </p>
            )}
          </fieldset>
          <fieldset className="detail-card">
            <legend className="text-sm font-semibold">Task due rule</legend>
            <div className="form-field">
              <Label>Recurrence</Label>
              <Select
                value={draft.recurrenceBasis}
                onValueChange={(value) =>
                  update({
                    recurrenceBasis: value as TaskPlan["recurrenceBasis"],
                  })
                }
                disabled={locked}
              >
                <SelectTrigger aria-label="Task recurrence basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calendar">
                    Fixed calendar interval
                  </SelectItem>
                  <SelectItem value="completion">
                    Interval after actual completion
                  </SelectItem>
                  <SelectItem value="dates">Explicit due dates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.recurrenceBasis === "dates" ? (
              <div className="form-field mt-3">
                <Label htmlFor="task-dates">Confirmed due dates</Label>
                <Textarea
                  id="task-dates"
                  value={datesText}
                  onChange={(event) => {
                    setDatesText(event.target.value);
                    update({});
                  }}
                  placeholder="YYYY-MM-DD, one per line"
                  disabled={locked}
                />
                <p className="field-hint">
                  Enter actual teaching-period review dates. No university dates
                  are inferred.
                </p>
              </div>
            ) : (
              <div className="form-grid">
                <div className="form-field full-width">
                  <Label htmlFor="task-first-date">
                    First due date / calendar anchor
                  </Label>
                  <Input
                    id="task-first-date"
                    type="date"
                    value={draft.firstDueOn ?? ""}
                    onChange={(event) =>
                      update({ firstDueOn: event.target.value || null })
                    }
                    disabled={locked}
                  />
                </div>
                <div className="form-field">
                  <Label htmlFor="task-interval">Repeat every</Label>
                  <Input
                    id="task-interval"
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={draft.interval}
                    onChange={(event) =>
                      update({ interval: Number(event.target.value) })
                    }
                    disabled={locked}
                  />
                </div>
                <div className="form-field">
                  <Label>Calendar unit</Label>
                  <Select
                    value={draft.unit}
                    onValueChange={(value) =>
                      update({ unit: value as TaskPlan["unit"] })
                    }
                    disabled={locked}
                  >
                    <SelectTrigger aria-label="Task recurrence unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["days", "weeks", "months", "years"].map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <p className="field-hint">
              Months and years use calendar dates. Six months is not converted
              to 180 days.
            </p>
          </fieldset>
          <fieldset className="detail-card">
            <legend className="text-sm font-semibold">
              Reminder rule · Australia/Sydney
            </legend>
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="task-reminder-advance">
                  Calendar days before due
                </Label>
                <Input
                  id="task-reminder-advance"
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  value={draft.reminderDaysBefore}
                  onChange={(event) =>
                    update({ reminderDaysBefore: Number(event.target.value) })
                  }
                  disabled={locked}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="task-reminder-time">Reminder time</Label>
                <Input
                  id="task-reminder-time"
                  type="time"
                  value={draft.reminderTime ?? ""}
                  onChange={(event) =>
                    update({ reminderTime: event.target.value || null })
                  }
                  disabled={locked}
                />
              </div>
            </div>
            <p className="field-hint">
              Choose the local time explicitly. Changing reminder settings does
              not change the task due date.
            </p>
            <label className="export-option">
              <Checkbox checked disabled />
              <span>
                <strong>Messages</strong>
                <small>Required persistent inbox channel</small>
              </span>
            </label>
            <label className="export-option">
              <Checkbox
                checked={draft.channels.includes("email")}
                onCheckedChange={(value) =>
                  update(
                    {
                      channels:
                        value === true ? ["messages", "email"] : ["messages"],
                    },
                    false,
                  )
                }
                disabled={locked}
              />
              <span>
                <strong>Prefer email too</strong>
                <small>
                  Email delivery is unavailable; this saves a preference and
                  does not send an email.
                </small>
              </span>
            </label>
          </fieldset>
          <div className="detail-card">
            <h3>Schedule preview · Sydney</h3>
            {openCycle && (
              <p>
                <strong>Recorded open cycle:</strong> due{" "}
                {formatDateOnly(openCycle.dueOn)}; reminder{" "}
                {formatDateOnly(openCycle.reminderOn)}{" "}
                {openCycle.reminderTime || "time unavailable"}. Its recorded
                deadline remains unchanged.
              </p>
            )}
            <div className="key-value">
              <span>Next due</span>
              <strong>
                {preview?.nextDueOn
                  ? formatDateOnly(preview.nextDueOn)
                  : preview?.calculationRule === "awaiting_actual_completion"
                    ? "After the current task is completed"
                    : "Not configured"}
              </strong>
            </div>
            <div className="key-value">
              <span>Next reminder</span>
              <strong>
                {preview?.nextReminderOn
                  ? `${formatDateOnly(preview.nextReminderOn)}${preview.reminderTime ? ` at ${preview.reminderTime}` : " · choose a time"}`
                  : "Not configured"}
              </strong>
            </div>
            {preview &&
              ["ambiguous", "nonexistent"].includes(preview.reminderStatus) && (
                <p className="form-error">
                  This reminder time is{" "}
                  {preview.reminderStatus === "ambiguous"
                    ? "ambiguous"
                    : "unavailable"}{" "}
                  during a Sydney daylight-saving transition. Choose another
                  time before activation.
                </p>
              )}
            {previewError && <p className="form-error">{previewError}</p>}
            <p>
              Messages are generated while the system is in use; unattended
              scheduling is unavailable.
            </p>
          </div>
          {openCycle && (
            <p className="field-hint">
              The preview estimates a future cycle. The current cycle must be
              completed first; its actual completion date can change the next
              due date.
            </p>
          )}
          <div className="form-field">
            <Label>Plan status</Label>
            <Select
              value={draft.state}
              onValueChange={(value) =>
                update({ state: value as TaskPlan["state"] }, false)
              }
              disabled={locked}
            >
              <SelectTrigger aria-label="Periodic plan status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft · no reminders</SelectItem>
                <SelectItem value="active">
                  Active · generate Messages while in use
                </SelectItem>
                <SelectItem value="paused">
                  Paused · stop future reminder generation
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="export-option">
            <Checkbox
              checked={draft.applicabilityConfirmed}
              onCheckedChange={(value) =>
                update({ applicabilityConfirmed: value === true }, false)
              }
              disabled={locked}
            />
            <span>
              <strong>Confirm the plan before activation</strong>
              <small>
                I have confirmed its basis, applicability, targets, dates,
                reminder time and staff assignments.{" "}
                {data.dataset === "demo"
                  ? "This is a labelled demonstration configuration."
                  : "Placeholder locations do not establish actual storage areas."}
              </small>
            </span>
          </label>
          {existing && (
            <p className="field-hint">
              Edits retain the current cycle&apos;s recorded content, due date
              and history. Assignment and plan state affect future reminder
              routing.
            </p>
          )}
          {!validation.success && draft.state === "active" && (
            <p className="field-hint">
              Activation needs:{" "}
              {validation.error.issues.map((issue) => issue.message).join(" ")}
            </p>
          )}
          {error && (
            <div>
              <p className="form-error" role="alert">
                {error}
              </p>
              {conflict && existing && (
                <>
                  <p className="field-hint">
                    Your draft is preserved. Load and review the latest saved
                    task before replacing this draft.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadLatest}
                    disabled={locked}
                  >
                    Load latest saved task
                  </Button>
                </>
              )}
            </div>
          )}
          {latest && (
            <div className="detail-card">
              <h3>Latest saved version {latest.version}</h3>
              <p>
                {latest.title} · {latest.state} ·{" "}
                {assignmentNames(latest.assigneeIds, data)}
              </p>
              <p>
                First due: {formatDateOnly(latest.firstDueOn)} · Reminder time:{" "}
                {latest.reminderTime || "Not selected"}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={acceptLatest}
                disabled={locked}
              >
                Replace draft with latest saved task
              </Button>
            </div>
          )}
          {creation && (
            <div className="detail-card" role="status">
              <h3>
                {creation.status === "uncertain"
                  ? "Unconfirmed task creation"
                  : "Rejected task creation"}
              </h3>
              <p>
                {creation.status === "uncertain"
                  ? "The submitted plan and request identifier are preserved in this tab. Retry that exact request before editing, closing or preparing another task. Reopening Periodic tasks after a reload restores this request."
                  : "The rejected request is preserved. Return to the draft to review its targets and assignments before creating a new request."}
              </p>
              <p>Request: {creation.input.requestId}</p>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={locked}
            >
              Cancel
            </Button>
            {creation?.status === "uncertain" ? (
              <Button
                type="button"
                onClick={() => void sendCreation(creation, true)}
                disabled={busy || data.user.role !== "admin"}
              >
                {busy ? "Checking…" : "Retry original task creation"}
              </Button>
            ) : creation?.status === "rejected" ? (
              <Button
                type="button"
                variant="outline"
                onClick={reviewRejectedCreation}
                disabled={busy}
              >
                Return to task draft
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={locked || conflict || data.user.role !== "admin"}
              >
                {busy
                  ? "Saving…"
                  : existing
                    ? "Save task plan"
                    : "Create task plan"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
