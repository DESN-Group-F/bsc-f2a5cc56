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
import { getRolePermissions } from "@/lib/permissions";
import {
  taskCategories,
  taskPlanSchema,
  taskSchedulePreview,
  taskTargetsByCategory,
  type TaskPlan,
} from "@/lib/task-schedule";
import { currentSydneyDate } from "@/lib/battery-age";
import { defaultInventoryFilter, type InventoryFilter } from "@/lib/inventory-query";
import { getFilteredBatteries } from "@/lib/battery-selection-query";
import { BatteryFilterControls } from "../battery-filter-controls";
import { hasRowTextSelection } from "@/lib/client/row-selection";
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
  targetSummary,
} from "./task-presentation";
import styles from "./task-plan-editor.module.css";

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
  const { manageTaskPlans } = getRolePermissions(data.user.role);
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
      () => recovery.attempt?.input.payload ??
        (!existing && original.category === "custom" && original.title === ""
          ? structuredClone(original)
          : taskPlanSchema.parse(original)),
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
  const [batteryFilters, setBatteryFilters] = useState<InventoryFilter>(() => ({ ...defaultInventoryFilter(), lifecycle: "all" })),
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
  const activationValidation = taskPlanSchema.safeParse({
    ...draft,
    state: "active",
    scheduledDates: datesText.split(/[\s,;]+/).filter(Boolean),
  });
  const activationIssues = activationValidation.success
    ? []
    : activationValidation.error.issues;
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
  const filteredBatteries = getFilteredBatteries(data, batteryFilters),
    visibleBatteries = filteredBatteries.batteries;
  const registeredBatteryIds = new Set(data.batteries.map(battery => battery.id)),
    deletedBatteryIds = new Set((data.purgedBatteries ?? []).map(battery => battery.id)),
    unavailableTargets = draft.batteryIds.filter(id => !registeredBatteryIds.has(id)),
    deletedTargetCount = unavailableTargets.filter(id => deletedBatteryIds.has(id)).length;
  const placeholderArea =
    draft.targetKind === "storage_area" &&
    data.rooms.find((room) => room.id === draft.targetRef)?.isPlaceholder;
  const activeBlockedByPlaceholder =
    data.dataset === "live" && draft.state === "active" && placeholderArea;
  const locked = busy || !!creation || !!recovery.error || !manageTaskPlans;
  const sectionFields = {
    instructions: ["category", "title", "description", "basis"],
    targets: ["targetKind", "targetRef", "batteryIds", "scopeNote"],
    assignees: ["assigneeIds"],
    schedule: ["recurrenceBasis", "firstDueOn", "interval", "unit", "scheduledDates", "reminderDaysBefore", "reminderTime", "channels"],
    review: ["applicabilityConfirmed"],
  };
  function missingCount(section: keyof typeof sectionFields) {
    return activationIssues.filter((issue) =>
      sectionFields[section].includes(String(issue.path[0])),
    ).length;
  }
  const targetDescription = draft.targetKind === "group"
    ? `${draft.targetRef || "Unnamed defined group"} · ${draft.batteryIds.length} selected batteries`
    : targetSummary(draft, data);
  const unavailableTargetSummary = [
    deletedTargetCount ? `${deletedTargetCount} deleted target${deletedTargetCount === 1 ? "" : "s"}` : "",
    unavailableTargets.length > deletedTargetCount ? `${unavailableTargets.length - deletedTargetCount} unavailable target${unavailableTargets.length - deletedTargetCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  const targetReferenceSummary = unavailableTargets.length
    ? `${targetDescription} · ${unavailableTargetSummary}`
    : targetDescription;
  const scheduleDescription = draft.recurrenceBasis === "dates"
    ? `${datesText.split(/[\s,;]+/).filter(Boolean).length} entered due dates`
    : `Every ${draft.interval} ${draft.unit} · ${draft.recurrenceBasis === "completion" ? "after completion" : "fixed calendar"}`;
  const assignedDescription = assignmentNames(draft.assigneeIds, data);
  const hasUnavailableAssignee = draft.assigneeIds.some((id) =>
    !data.staffDirectory.some((staff) => staff.id === id && staff.active),
  );
  const invalidReminder = preview && ["ambiguous", "nonexistent"].includes(preview.reminderStatus);
  const activationNeedsReview = activationIssues.length > 0 ||
    (!!placeholderArea && data.dataset === "live") ||
    hasUnavailableAssignee || !!invalidReminder || !!previewError;
  function reviewPlan() {
    const section = document.getElementById("task-review-section");
    if (!(section instanceof HTMLDetailsElement)) return;
    section.open = true;
    section.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    section.querySelector("summary")?.focus({ preventScroll: true });
  }
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
    if (!manageTaskPlans || running.current || recovery.error) return;
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
    if (!manageTaskPlans || running.current || captured.current || recovery.error) return;
    if (!conflict) setError("");
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
    if (!manageTaskPlans || running.current || captured.current || recovery.error) return;
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
        className={`record-dialog ${styles.dialog}`}
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
        <DialogHeader className={styles.header}>
          <DialogTitle>
            {existing ? "Edit recurring task" : "Create recurring task"}
          </DialogTitle>
          <DialogDescription>
            {taskCategoryLabels[draft.category]}. Open any section in any order.
            Save a draft with a title, then complete and review the activation requirements when ready.
          </DialogDescription>
        </DialogHeader>
        <form
          className={styles.form}
          onSubmit={save}
          onInvalidCapture={(event) => {
            if (!(event.target instanceof HTMLElement)) return;
            const section = event.target.closest("details");
            if (section) section.open = true;
          }}
        >
          <div className={styles.body}>
          <p className={styles.formGuide}>
            <span>Required to save</span> Title · <span>Required to activate</span> Instructions, applicability, targets, staff and schedule · <span>Optional</span> Additional context and email preference
          </p>
          <p className={styles.draftGuide}>
            A draft can leave activation details blank. Any values you enter must
            still be valid, and assigned staff accounts must be active before any save.
            New targets must be registered in this inventory. Existing plans can
            retain previously selected deleted Battery IDs for review.
          </p>
          <section className={styles.section} aria-labelledby="task-instructions-heading">
            <details className={styles.sectionDisclosure} open>
            <summary className={styles.sectionHeading}>
              <span aria-hidden="true">1</span>
              <div className={styles.sectionSummary}>
                <h3 id="task-instructions-heading">Task instructions</h3>
                <p>{draft.title || "Untitled task"} · {taskCategoryLabels[draft.category]}</p>
              </div>
              <small className={styles.sectionStatus} data-incomplete={missingCount("instructions") > 0}>
                {missingCount("instructions") ? `${missingCount("instructions")} to review` : "Configured"}
              </small>
            </summary>
            <div className={styles.sectionContent}>
          <div className="form-field">
            <Label>Task type</Label>
            <Select
              value={draft.category}
              onValueChange={(value) => update({ category: value as TaskPlan["category"] })}
              disabled={locked}
            >
              <SelectTrigger aria-label="Task type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {taskCategories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {taskCategoryLabels[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="field-hint">
              {draft.category === "custom"
                ? "Write your own task and use any supported target. No template wording or operating requirement is imposed."
                : "This task type provides suggested target choices. Choose Custom task to use any supported target; your current instructions and schedule are retained."}
            </p>
          </div>
          <div className="form-field">
            <Label htmlFor="task-title">Task title <span className={styles.fieldRequirement}>Required to save</span></Label>
            <Input
              id="task-title"
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              maxLength={160}
              minLength={2}
              required
              disabled={locked}
            />
          </div>
          <div className="form-field">
            <Label htmlFor="task-description">What must be done <span className={styles.fieldRequirement}>Required to activate</span></Label>
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
              <span className={styles.fieldRequirement}>Required to activate</span>
            </Label>
            <Textarea
              id="task-basis"
              value={draft.basis}
              onChange={(event) => update({ basis: event.target.value })}
              maxLength={2000}
              disabled={locked}
            />
          </div>
          <p className="field-hint">
            {draft.category === "custom"
              ? "Record the local procedure, teaching need or other reason for this task. Confirm the scope and timing before activation."
              : "Template instructions and timing are starting points. Edit them to match the applicable requirement before activating this plan."}
          </p>
            </div>
            </details>
          </section>
          <section className={styles.section} aria-labelledby="task-targets-heading">
            <details className={styles.sectionDisclosure}>
            <summary className={styles.sectionHeading}>
              <span aria-hidden="true">2</span>
              <div className={styles.sectionSummary}>
                <h3 id="task-targets-heading">Targets and scope</h3>
                <p>{targetReferenceSummary} · {data.dataset === "demo" ? "Demonstration inventory" : "Working inventory"}</p>
              </div>
              <small className={styles.sectionStatus} data-incomplete={missingCount("targets") > 0 || unavailableTargets.length > 0 || !!placeholderArea && data.dataset === "live"}>
                {unavailableTargets.length ? "Review unavailable targets" : missingCount("targets") ? `${missingCount("targets")} to review` : placeholderArea && data.dataset === "live" ? "Placeholder area" : "Configured"}
              </small>
            </summary>
            <div className={styles.sectionContent}>
          <div className="form-field">
            <Label>Applies to</Label>
            {!(taskTargetsByCategory[draft.category] as readonly string[]).includes(draft.targetKind) && (
              <p className="form-error">
                Your previous target is retained. Choose a target for this task type,
                or choose Custom task to keep all target options available.
              </p>
            )}
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
              <Label>Storage area <span className={styles.fieldRequirement}>Required to activate</span></Label>
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
              <Label>Registered battery model <span className={styles.fieldRequirement}>Required to activate</span></Label>
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
              <Label htmlFor="task-group">Defined group name <span className={styles.fieldRequirement}>Required to activate</span></Label>
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
                name alone does not define membership or applicability. This task
                uses an explicit name and battery selection; it is separate from
                private Teaching groups and does not follow their membership changes.
              </p>
            </div>
          )}
          {["batteries", "group"].includes(draft.targetKind) && (
            <fieldset className="detail-card">
              <legend className="text-sm font-semibold">
                Registered batteries · {draft.batteryIds.length} selected
              </legend>
              {unavailableTargets.length > 0 && (
                <div className={styles.unavailableTargets}>
                  <p className={styles.unavailableTargetGuide}>
                    {existing
                      ? "Previously selected targets remain in this plan. Deleted records retain only their Battery ID; you can keep an existing reference or remove it explicitly. Future task generation needs available targets."
                      : "Unavailable records cannot be added to a new plan. Remove these references and select registered batteries before saving."}
                  </p>
                  <div role="group" aria-label="Selected unavailable battery targets">
                    {unavailableTargets.map(id => (
                      <label
                        key={id}
                        className={`export-option ${styles.selectionRow}`}
                        data-selected="true"
                        onClick={event => { if (hasRowTextSelection(event)) event.preventDefault(); }}
                      >
                        <Checkbox
                          checked
                          disabled={locked}
                          onCheckedChange={value => { if (value !== true) toggleId("batteryIds", id, false); }}
                        />
                        <span>
                          <strong>{id} · {deletedBatteryIds.has(id) ? "Deleted record" : "Unavailable record"}</strong>
                          <small>Uncheck to remove this target reference.</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <BatteryFilterControls
                data={data}
                filters={batteryFilters}
                onChange={(patch) => { if (!locked && !running.current) setBatteryFilters(previous => ({ ...previous, ...patch })); }}
                onClear={() => { if (!locked && !running.current) setBatteryFilters({ ...defaultInventoryFilter(), lifecycle: "all" }); }}
                disabled={locked}
                defaultLifecycle="all"
                scopeNote="Filter the registered batteries available for this task. Clearing filters keeps your selected batteries and task draft."
              />
              {filteredBatteries.error && <p className="form-error" role="alert">{filteredBatteries.error}</p>}
              <p className="field-hint">{visibleBatteries.length} matching batteries · {draft.batteryIds.filter(id => registeredBatteryIds.has(id) && !visibleBatteries.some(battery => battery.id === id)).length} selected outside these filters</p>
              <div className="my-2 flex flex-wrap gap-2">
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
                  <label
                    className={`export-option ${styles.selectionRow}`}
                    onClick={event => { if (hasRowTextSelection(event)) event.preventDefault(); }}
                    data-selected={draft.batteryIds.includes(battery.id)}
                    key={battery.id}
                  >
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
            <Label htmlFor="task-scope">Scope and applicability <span className={styles.fieldRequirement}>{draft.targetKind === "inventory" ? "Required to activate" : "Optional context"}</span></Label>
            <Textarea
              id="task-scope"
              value={draft.scopeNote}
              onChange={(event) => update({ scopeNote: event.target.value })}
              maxLength={2000}
              disabled={locked}
              placeholder="Describe the actual area, inventory or assets covered, and why this requirement applies."
            />
          </div>
            </div>
            </details>
          </section>
          <section className={styles.section} aria-labelledby="task-assignees-heading">
            <details className={styles.sectionDisclosure}>
            <summary className={styles.sectionHeading}>
              <span aria-hidden="true">3</span>
              <div className={styles.sectionSummary}>
                <h3 id="task-assignees-heading">Assigned staff</h3>
                <p title={assignedDescription}>{draft.assigneeIds.length ? `${draft.assigneeIds.length} selected · ${assignedDescription}` : "No staff assigned"}</p>
              </div>
              <small className={styles.sectionStatus} data-incomplete={missingCount("assignees") > 0 || hasUnavailableAssignee}>
                {hasUnavailableAssignee ? "Review accounts" : draft.assigneeIds.length ? "Configured" : "Required to activate"}
              </small>
            </summary>
            <div className={styles.sectionContent}>
            <p className="field-hint">
              {draft.assigneeIds.length} selected. Select people below, or use
              the responsible owners of the selected targets. One completion
              closes the shared cycle for all assignees.
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
                  <label
                    className={`export-option ${styles.selectionRow}`}
                    onClick={event => { if (hasRowTextSelection(event)) event.preventDefault(); }}
                    data-selected={draft.assigneeIds.includes(staff.id)}
                    key={staff.id}
                  >
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
                          : "Disabled account; remove or reassign before saving"}
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
            </div>
            </details>
          </section>
          <section className={styles.section} aria-labelledby="task-schedule-heading">
            <details className={styles.sectionDisclosure}>
            <summary className={styles.sectionHeading}>
              <span aria-hidden="true">4</span>
              <div className={styles.sectionSummary}>
                <h3 id="task-schedule-heading">Schedule and reminders</h3>
                <p>{scheduleDescription} · {draft.reminderTime ? `remind at ${draft.reminderTime}` : "reminder time not chosen"} · Sydney</p>
              </div>
              <small className={styles.sectionStatus} data-incomplete={missingCount("schedule") > 0 || !!invalidReminder || !!previewError}>
                {invalidReminder ? "Review daylight saving" : missingCount("schedule") ? `${missingCount("schedule")} to review` : previewError ? "Review preview" : "Configured"}
              </small>
            </summary>
            <div className={styles.sectionContent}>
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
                  <SelectItem value="dates">Specific dates / one-off task</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.recurrenceBasis === "dates" ? (
              <div className="form-field mt-3">
                <Label htmlFor="task-dates">Confirmed due dates <span className={styles.fieldRequirement}>Required to activate</span></Label>
                <Textarea
                  id="task-dates"
                  value={datesText}
                  onChange={(event) => {
                    if (locked) return;
                    setDatesText(event.target.value);
                    update({});
                  }}
                  placeholder="YYYY-MM-DD, one per line"
                  disabled={locked}
                />
                <p className="field-hint">
                  Enter one date for a one-off task, or several confirmed dates.
                  No teaching-period dates are inferred.
                </p>
              </div>
            ) : (
              <div className="form-grid">
                <div className="form-field full-width">
                  <Label htmlFor="task-first-date">
                    First due date / calendar anchor
                    <span className={styles.fieldRequirement}>Required to activate</span>
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
                <Label htmlFor="task-reminder-time">Reminder time <span className={styles.fieldRequirement}>Required to activate</span></Label>
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
            </div>
            </details>
          </section>
          <section className={styles.section} aria-labelledby="task-review-heading">
            <details id="task-review-section" className={styles.sectionDisclosure}>
            <summary className={styles.sectionHeading}>
              <span aria-hidden="true">5</span>
              <div className={styles.sectionSummary}>
                <h3 id="task-review-heading">Review and save</h3>
                <p>{draft.state === "active" ? "Active" : draft.state === "paused" ? "Paused" : "Draft"} · {draft.applicabilityConfirmed ? "Applicability confirmed" : "Applicability not yet confirmed"}</p>
              </div>
              <small className={styles.sectionStatus} data-incomplete={activationNeedsReview}>
                {activationNeedsReview ? "Activation needs review" : "Ready for review"}
              </small>
            </summary>
            <div className={styles.sectionContent}>
          <dl className={styles.reviewSummary}>
            <div><dt>Task</dt><dd>{draft.title || "Title required before saving"}</dd></div>
            <div><dt>Targets</dt><dd>{targetReferenceSummary}</dd></div>
            <div><dt>Staff</dt><dd>{assignedDescription}</dd></div>
            <div><dt>Schedule</dt><dd>{scheduleDescription}</dd></div>
            <div><dt>Next due</dt><dd>{preview?.nextDueOn ? formatDateOnly(preview.nextDueOn) : preview?.calculationRule === "awaiting_actual_completion" ? "After the current task is completed" : "Not configured"}</dd></div>
            <div><dt>Reminder</dt><dd>{preview?.nextReminderOn ? formatDateOnly(preview.nextReminderOn) : "Date not configured"} · {draft.reminderTime || "Time not chosen"} · Sydney</dd></div>
          </dl>
          <fieldset className={styles.stateChoices}>
            <legend>Plan status after saving</legend>
            {([
              { value: "draft", title: "Draft", description: "Save progress without reminders." },
              { value: "active", title: "Active", description: "Generate Messages while the system is in use." },
              { value: "paused", title: "Paused", description: "Stop new cycles and future reminders." },
            ] as const).map((state) => (
              <label key={state.value} data-selected={draft.state === state.value}>
                <input
                  type="radio"
                  name="task-plan-state"
                  value={state.value}
                  checked={draft.state === state.value}
                  onChange={() => update({ state: state.value }, false)}
                  disabled={locked}
                />
                <span><strong>{state.title}</strong><small>{state.description}</small></span>
              </label>
            ))}
          </fieldset>
          <label
            className={`export-option ${styles.selectionRow}`}
            data-selected={draft.applicabilityConfirmed}
          >
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
          {activationNeedsReview && (
            <div className={styles.requirements}>
              <strong>Before activation</strong>
              <ul>
                {activationIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}
                {placeholderArea && data.dataset === "live" && <li>Confirm the actual storage area; a placeholder cannot activate a working-inventory plan.</li>}
                {hasUnavailableAssignee && <li>Review unavailable or disabled assigned staff accounts.</li>}
                {invalidReminder && <li>Choose a reminder time that is valid and unambiguous during Sydney daylight saving.</li>}
                {previewError && <li>{previewError}</li>}
              </ul>
              <p>Choose Draft to leave activation details incomplete. Entered values and selected records must still be valid before saving.</p>
            </div>
          )}
            </div>
            </details>
          </section>
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
          {!manageTaskPlans && (
            <p className="field-hint" role="status">
              Administrator access is required to change this plan. Any saved
              request remains preserved in this tab.
            </p>
          )}
          </div>
          <div className={styles.footer}>
          {error && (
            <div className={styles.error}>
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
          <p className={styles.saveHint}>
            {creation || recovery.error
              ? "Resolve the saved request before editing or leaving this form."
              : draft.state === "active"
                ? "Active plans generate Messages while the system is in use."
                : draft.state === "paused"
                  ? "Saving as paused stops new cycles and future reminders."
                  : "A draft saves your progress without generating reminders."}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={reviewPlan}
              disabled={busy}
            >
              Review plan
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={busy || !!creation || !!recovery.error}
            >
              Cancel
            </Button>
            {creation?.status === "uncertain" ? (
              <Button
                type="button"
                onClick={() => void sendCreation(creation, true)}
                disabled={busy || !manageTaskPlans}
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
                disabled={locked || conflict}
              >
                {busy
                  ? "Saving…"
                  : draft.state === "active"
                    ? existing ? "Save active plan" : "Create and activate"
                    : draft.state === "paused"
                      ? existing ? "Save paused plan" : "Create paused plan"
                      : existing ? "Save draft" : "Create draft"}
              </Button>
            )}
          </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
