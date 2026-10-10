"use client";

import { isActiveBattery, batteryStatusLabel } from "@/lib/battery-lifecycle";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { shouldToggleSelection } from "@/lib/client/row-selection";
import { Battery, Package, Plus, Download, Settings2, ChevronDown, AlertTriangle, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import { transitionWorkspace } from "@/lib/client/workspace-motion";
import { ReviewQueueSurface } from "./review-queue-surface";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  formatTime,
  formatBatteryAge,
  formatDateOnly,
  buildingLabel,
  storageRoomLabel,
} from "@/lib/client-utils";
import {
  filterBatteries,
  defaultInventoryFilter,
  inventoryFilterSchema,
  type InventoryFilter,
} from "@/lib/inventory-query";
import { currentSydneyDate } from "@/lib/battery-age";
import {
  AppliedFilters,
  appliedFilterChips,
  InventoryFilterPanel,
} from "./inventory-filter-panel";
import { TeachingGroupsPanel } from "./teaching-groups-panel";
import type { TeachingGroup } from "@/lib/teaching-groups";
import { getRolePermissions } from "@/lib/permissions";
import type {
  RecordActions,
  ExportDraft,
} from "@/lib/client/inventory-contracts";
import styles from "./inventory-table.module.css";
import { recentNewArrivals, type NewArrivals } from "@/lib/new-arrivals";
import { mappingScopeLabel } from "@/lib/inventory-mapping";

export function InventoryTable({
  data,
  ready,
  onMovement,
  onScan,
  onEdit,
  onDetail,
  onSetup,
  onExport,
  onGroupsChanged,
  onGroupDialogChange,
  onOpenGroups,
  group,
  mappingRoom = null,
  onRemoval,
  onGroupMaintenance,
  onGroupCheckouts,
  personalScope = "all",
  newArrivals = data.newArrivals,
  onViewNewArrivals,
  arrivalsPending = false,
  arrivalsError = "",
  active = true,
  overlayOpen = false,
}: RecordActions & {
  onMovement: (kind: "checkout" | "return", ids: string[]) => void;
  onScan?: (kind: "checkout" | "return") => void;
  onSetup: () => void;
  onExport: (draft: ExportDraft) => void;
  personalScope?: InventoryFilter["personalScope"];
  group?: TeachingGroup;
  mappingRoom?: string | null;
  onOpenGroups?: () => void;
  onRemoval?: (ids: string[]) => void;
  onGroupMaintenance?: (ids: string[]) => void;
  onGroupCheckouts?: () => void;
  onGroupsChanged?: () => Promise<void>;
  onGroupDialogChange?: (open: boolean) => void;
  newArrivals?: NewArrivals;
  onViewNewArrivals?: (throughSequence: number) => Promise<void>;
  arrivalsPending?: boolean;
  arrivalsError?: string;
  active?: boolean;
  overlayOpen?: boolean;
}) {
  const permissions = getRolePermissions(data.user.role);
  const instancePrefix = `inventory-${data.dataset}-${personalScope}-${mappingRoom ? `mapping-${encodeURIComponent(mappingRoom)}` : group ? `group-${encodeURIComponent(group.id)}` : "shared"}`;
  const filterDisclosureId = `${instancePrefix}-filter-disclosure`;
  const [savedFilters, setFilters] = useState<InventoryFilter>(() => ({
      ...defaultInventoryFilter(),
      personalScope,
      mappingRoom,
      ...(group ? { groupId: group.id, lifecycle: "all" as const } : {}),
    })),
    [filterOpen, setFilterOpen] = useState(false);
  const filters = {
    ...savedFilters,
    personalScope,
    mappingRoom,
    ...(group ? { groupId: group.id } : {}),
  };
  const [selectedIds, setSelected] = useState<string[]>([]);
  const [expandedIds, setExpanded] = useState<string[]>([]);
  const [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState<"10" | "25" | "50" | "100">("25");
  const [groupEditor, setGroupEditor] = useState<{ ids: string[] } | null>(
      null,
    ),
    [groupNotice, setGroupNotice] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [totalsOpen, setTotalsOpen] = useState(false);
  const workbenchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onGroupDialogChange?.(!!groupEditor);
    return () => {
      onGroupDialogChange?.(false);
    };
  }, [groupEditor, onGroupDialogChange]);
  const batteries = data.batteries;
  const baseBatteries = filterBatteries(
    batteries,
    {
      ...defaultInventoryFilter(),
      personalScope,
      mappingRoom,
      ...(group ? { groupId: group.id } : {}),
    },
    currentSydneyDate(),
    data.user.id,
    data.teachingGroups ?? [],
    newArrivals,
    data.rooms,
  );
  const onLoan = baseBatteries.filter((b) => b.loanId).length;
  const arrivalItems = recentNewArrivals(newArrivals);
  const activeScopeIds = new Set(baseBatteries.map(battery => battery.id));
  const recentIds = new Set(arrivalItems.map(item => item.batteryId));
  const scopeArrivals = arrivalItems.filter(item => activeScopeIds.has(item.batteryId));
  const unreadArrivals = scopeArrivals.filter(item => item.isUnread);
  const unreadInStore = unreadArrivals.filter(item => !batteries.find(battery => battery.id === item.batteryId)?.loanId).length;
  const unreadInUse = unreadArrivals.length - unreadInStore;
  const knownIds = new Set(batteries.map((battery) => battery.id));
  const selected = [...new Set(selectedIds)].filter((id) => knownIds.has(id));
  const baseIds = new Set(
    filterBatteries(
      batteries,
      { personalScope, lifecycle: "all", mappingRoom },
      currentSydneyDate(),
      data.user.id,
      data.teachingGroups ?? [],
      newArrivals,
      data.rooms,
    ).map((battery) => battery.id),
  );
  const outsidePersonalScope = group
    ? selected.filter((id) => !group.batteryIds.includes(id))
    : personalScope === "all" && !mappingRoom
      ? []
      : selected.filter((id) => !baseIds.has(id));
  const selectionScopeChanged = outsidePersonalScope.length > 0;
  const validation = inventoryFilterSchema.safeParse(filters),
    asOfOn = currentSydneyDate();
  const groupMissing =
    !!filters.groupId &&
    !data.teachingGroups?.some(
      (group) =>
        group.id === filters.groupId &&
        group.ownerAccountId === data.user.id &&
        group.state === "active",
    );
  const matching =
    validation.success && !groupMissing
      ? filterBatteries(
          batteries,
          validation.data,
          asOfOn,
          data.user.id,
          data.teachingGroups ?? [],
          newArrivals,
          data.rooms,
        )
      : [];
  const allStatuses =
    validation.success && !groupMissing
      ? filterBatteries(
          batteries,
          { ...validation.data, status: "all" },
          asOfOn,
          data.user.id,
          data.teachingGroups ?? [],
          newArrivals,
          data.rooms,
        )
      : [];
  const matchingOnLoan = allStatuses.filter(
    (b) => isActiveBattery(b) && b.loanId,
  ).length;
  const matchingInStore = allStatuses.filter(
    (b) => isActiveBattery(b) && !b.loanId,
  ).length;
  const chips = appliedFilterChips(filters, data).filter(
    (chip) => !group || chip.key !== "group",
  );
  const pageCount = Math.max(1, Math.ceil(matching.length / Number(pageSize))),
    currentPage = Math.min(page, pageCount - 1);
  const visible = matching.slice(
    currentPage * Number(pageSize),
    (currentPage + 1) * Number(pageSize),
  );
  function selectAll(checked: boolean) {
    setSelected(
      checked
        ? [...new Set([...selected, ...visible.map((b) => b.id)])]
        : selected.filter((id) => !visible.some((b) => b.id === id)),
    );
  }
  function changeBatterySelection(id: string, checked?: boolean) {
    if (!ready) return;
    setSelected((previous) => {
      const select = checked ?? !previous.includes(id);
      return select
        ? previous.includes(id)
          ? previous
          : [...previous, id]
        : previous.filter((value) => value !== id);
    });
  }
  function selectBatteryRow(
    id: string,
    event: MouseEvent<HTMLTableRowElement>,
  ) {
    if (!ready || !shouldToggleSelection(event)) return;
    changeBatterySelection(id);
  }
  function updateFilters(patch: Partial<InventoryFilter>) {
    transitionWorkspace(() => {
      setFilters((previous) => ({ ...previous, ...patch }));
      setPage(0);
    });
  }
  function focusFilterToggle() {
    if (typeof document !== "undefined") document.getElementById(`${instancePrefix}-filter-toggle`)?.focus({ preventScroll: true });
  }
  function clearFilters() {
    transitionWorkspace(() => { setFilters({
      ...defaultInventoryFilter(),
      personalScope,
      mappingRoom,
      ...(group ? { groupId: group.id, lifecycle: "all" as const } : {}),
    });
    setPage(0); });
  }
  function selectGroup(group: TeachingGroup) {
    const allowed = group.batteryIds.filter(
      (id) => knownIds.has(id) && baseIds.has(id),
    );
    const excluded = group.batteryIds.length - allowed.length;
    setSelected(allowed);
    updateFilters({ groupId: group.id, status: "all", lifecycle: "all" });
    setGroupNotice(
      `${group.name}: ${allowed.length} ${allowed.length === 1 ? "battery" : "batteries"} selected.${excluded ? ` ${excluded} ${excluded === 1 ? "member is" : "members are"} outside this personal view and ${excluded === 1 ? "was" : "were"} not selected.` : ""} Review current use and retired states before an operation.`,
    );
  }
  function exportInventory() {
    if (validation.success && !selectionScopeChanged)
      onExport({
        selectedIds: [...selected],
        teachingGroup: group ? { id: group.id, version: group.version } : undefined,
        filter: validation.data,
        page: currentPage,
        pageSize,
        matching: matching.length,
        pageCount: visible.length,
      });
  }
  return (
    <>
      {mappingRoom && <p className="personal-inventory-scope"><strong>Last observation scope: {mappingScopeLabel(mappingRoom, data.rooms)}</strong><span>Ordinary filters and downloads stay within this tab. These records do not confirm the batteries&apos; present locations.</span></p>}
      {personalScope !== "all" && (
        <div className="personal-inventory-scope">
          <strong>
            {personalScope === "responsible"
              ? "My batteries"
              : "My batteries in use"}
          </strong>
          <span>
            {personalScope === "responsible"
              ? "Batteries assigned to your account as responsible owner, including those in use by other staff."
              : "Batteries currently checked out to your account."}{" "}
            Filters and downloads apply within this view.
          </span>
        </div>
      )}
      <div ref={workbenchRef} className={styles.workbench} data-queue-expanded={queueOpen}>
      <ReviewQueueSurface id={`${instancePrefix}-review-queue`} open={queueOpen} onOpenChange={setQueueOpen} active={active} overlayOpen={overlayOpen || !!groupEditor} count={selected.length} outsideCount={selected.filter(id => !matching.some(battery => battery.id === id)).length} scopeChanged={selectionScopeChanged} workbenchRef={workbenchRef}>
          {!selected.length && <div className={styles.queueEmpty}>
            <span className={styles.queueIllustration} aria-hidden="true"><Battery size={32} strokeWidth={1.5} /></span>
            <h3>Choose batteries to begin</h3>
            <p>Select batteries to prepare a checkout, return or download.</p>
          </div>}
          {!!selected.length && <>
            <p className={styles.queueHint}>Selection is kept when you change filters or pages. Nothing is saved until you confirm.</p>
            <ul className={styles.queueItems} aria-label="Selected batteries">
              {selected.map(id => { const battery = batteries.find(item => item.id === id)!; return <li key={id}>
                <button className={styles.queueRecord} onClick={() => onDetail(id)} aria-label={`Open selected ${id}`}><strong>{id}</strong><span>{batteryStatusLabel(battery)}</span></button>
                <Button size="icon-sm" variant="ghost" data-queue-remove aria-label={`Remove ${id} from selection`} onClick={(event) => {
                  const item = event.currentTarget.closest("li");
                  const next = item?.nextElementSibling?.querySelector<HTMLButtonElement>("[data-queue-remove]") ?? item?.previousElementSibling?.querySelector<HTMLButtonElement>("[data-queue-remove]") ?? event.currentTarget.closest("[data-review-queue]")?.querySelector<HTMLElement>("h2");
                  next?.focus({ preventScroll: true });
                  setSelected(previous => previous.filter(value => value !== id));
                }}><span aria-hidden="true">×</span></Button>
              </li>; })}
            </ul>
          </>}
        <MotionDisclosure open={!!selected.length}>
          <div className="selection-toolbar">
            <strong>
              {selected.length} selected
              {selected.some((id) => !matching.some((b) => b.id === id))
                ? ` · ${selected.filter((id) => !matching.some((b) => b.id === id)).length} outside current filters`
                : ""}
            </strong>
            <Button
              variant="outline"
              size="sm"
              onClick={exportInventory}
              disabled={!selected.length || !validation.success || selectionScopeChanged}
            >
              <Download size={16} />
              Download selected
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMovement("checkout", selected)}
              disabled={
                !ready ||
                selectionScopeChanged ||
                !selected.length ||
                selected.length > 100 ||
                selected.some(
                  (id) =>
                    (!group && batteries.find((b) => b.id === id)?.loanId) ||
                    !isActiveBattery(batteries.find((b) => b.id === id)!),
                )
              }
            >
              Check out selected
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMovement("return", selected)}
              disabled={
                !ready ||
                selectionScopeChanged ||
                !selected.length ||
                selected.length > 100 ||
                selected.some(
                  (id) =>
                    !batteries.find((b) => b.id === id)?.loanId ||
                    !isActiveBattery(batteries.find((b) => b.id === id)!),
                )
              }
            >
              Return selected
            </Button>
            <Button variant="ghost" size="sm" disabled={!selected.length} onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
        </MotionDisclosure>
        {selectionScopeChanged && (
          <div className="selection-scope-warning" role="alert">
            <strong>Your selected batteries have changed scope.</strong>
            <p>
              These batteries no longer belong to{" "}
              {group
                ? "this teaching group"
                : mappingRoom
                  ? "this last-observation room scope"
                : personalScope === "responsible"
                  ? "My batteries"
                  : "My batteries in use"}
              :{" "}
              {outsidePersonalScope.map((id, index) => (
                <span key={id}>
                  {index > 0 ? ", " : ""}
                  <button className="record-link" onClick={() => onDetail(id)}>
                    {id}
                  </button>
                </span>
              ))}
              . Review their current details, then remove them from your
              selection before downloading or starting an operation.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSelected(
                  selected.filter((id) => !outsidePersonalScope.includes(id)),
                )
              }
            >
              Remove batteries outside this view
            </Button>
          </div>
        )}
        {selected.length > 100 && (
          <p className="field-hint">
            Checkouts and returns support up to 100 batteries per batch. Reduce
            your selection before starting a movement. You can still download
            all selected batteries together.
          </p>
        )}
        <MotionDisclosure open={!!selected.length}>
          <div className="teaching-group-actions">
            {(group || mappingRoom) && (
              <>
                {onRemoval && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRemoval(selected)}
                    disabled={
                      !ready ||
                      selectionScopeChanged || !selected.length || selected.length > 100 ||
                      selected.some((id) => {
                        const b = batteries.find((b) => b.id === id)!;
                        return !isActiveBattery(b) || !!b.loanId;
                      })
                    }
                  >
                    Retire or remove selected
                  </Button>
                )}
                {onGroupMaintenance && permissions.editBatteryRecords && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onGroupMaintenance(selected)}
                    disabled={
                      !ready ||
                      selected.some(
                        (id) =>
                          !isActiveBattery(batteries.find((b) => b.id === id)!),
                      )
                    }
                  >
                    Update selected members
                  </Button>
                )}
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGroupEditor({ ids: [...selected] })}
              disabled={
                !ready || selected.length > 100 || selectionScopeChanged
                || !selected.length
              }
            >
              Save as teaching group
            </Button>
            {selected.length > 100 && (
              <span className="field-hint">
                Teaching groups support up to 100 batteries. Reduce the
                selection to save a group.
              </span>
            )}
          </div>
        </MotionDisclosure>

          {onScan && <div className={styles.queueStations}>
            <h3>Using tags or manual entry?</h3>
            <p>Open a station to build and review a batch.</p>
            <Button variant="outline" disabled={!ready} onClick={() => onScan("checkout")}>Scan checkout</Button>
            <Button variant="outline" disabled={!ready} onClick={() => onScan("return")}>Scan return</Button>
          </div>}
      <details className={styles.summaryDisclosure} open={totalsOpen} onToggle={event => setTotalsOpen(event.currentTarget.open)}>
        <summary><span>Active scope totals</span><span><strong>{baseBatteries.length}</strong> batteries · <strong>{baseBatteries.length - onLoan}</strong> in store · <strong>{onLoan}</strong> in use</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className={styles.summaryStrip} aria-label="Inventory totals">
        {[
          [
            "Active batteries",
            baseBatteries.length,
            group
              ? "In this teaching group"
              : mappingRoom
                ? "Last observed in this room scope"
              : personalScope === "all"
                ? "Across registered storage locations"
                : "In this personal view",
          ],
          [
            "In store",
            baseBatteries.length - onLoan,
            "No active loan recorded",
          ],
          ["In use", onLoan, "Linked to a current staff holder"],
        ].map(([label, count, note]) => (
          <div className={styles.summaryItem} key={label}>
            <strong>{count}</strong>
            <div><span>{label}</span><small>{note}</small></div>
          </div>
        ))}
      </div>
      </details>
      </ReviewQueueSurface>
      <section
        className="inventory-panel"
        aria-label="Battery inventory records"
      >
        {group && (
          <div className="group-bulk-actions">
            <strong>Group operations</strong>
            <Button
              variant="outline"
              onClick={() => onMovement("checkout", group.batteryIds)}
              disabled={!ready}
            >
              Check out group
            </Button>
            <Button
              variant="outline"
              onClick={() => onGroupCheckouts ? onGroupCheckouts() : onMovement("return", group.batteryIds)}
              disabled={!ready}
            >
              {onGroupCheckouts ? "Actual group checkouts" : "Return group"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelected([...group.batteryIds]);
                setGroupNotice(
                  "All group members selected, including retired members. Review their current state before an operation.",
                );
              }}
              disabled={!ready}
            >
              Select all group members
            </Button>
            <Button
              variant="outline"
              onClick={() => setSelected(matching.map((b) => b.id))}
              disabled={!ready || !matching.length}
            >
              Select filtered group members
            </Button>
          </div>
        )}
        <div className="panel-top">
          <div className="inventory-category-navigation">
            <Tabs
              value={filters.status}
              onValueChange={(value) =>
                updateFilters({ status: value as InventoryFilter["status"] })
              }
            >
              <TabsList variant="line">
                <TabsTrigger value="all">
                  All batteries{" "}
                  <span className="tab-count">{allStatuses.length}</span>
                  <span className={styles.arrivalDot} data-visible={!!unreadArrivals.length} aria-hidden="true" />
                  {!!unreadArrivals.length && <span className="sr-only">{unreadArrivals.length} unread new registrations</span>}
                </TabsTrigger>
                <TabsTrigger value="in">
                  In store <span className="tab-count">{matchingInStore}</span>
                  <span className={styles.arrivalDot} data-visible={!!unreadInStore} aria-hidden="true" />
                  {!!unreadInStore && <span className="sr-only">{unreadInStore} unread new registrations</span>}
                </TabsTrigger>
                <TabsTrigger value="out">
                  In use <span className="tab-count">{matchingOnLoan}</span>
                  <span className={styles.arrivalDot} data-visible={!!unreadInUse} aria-hidden="true" />
                  {!!unreadInUse && <span className="sr-only">{unreadInUse} unread new registrations</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {!group && !onOpenGroups && (
              <Button
                variant="ghost"
                className="inventory-teaching-groups-link"
                onClick={() => setGroupEditor({ ids: [] })}
                disabled={!ready}
              >
                Teaching groups
              </Button>
            )}
          </div>
          {!onScan && <Button
            variant="outline"
            onClick={() => onEdit({ kind: "battery" })}
            disabled={!ready}
          >
            <Plus />
            Register battery
          </Button>}
        </div>
        <MotionDisclosure open={filters.newArrivalsOnly || !!arrivalsError}>
          <div className={styles.arrivalsNote}>
            {arrivalsError ? <p className="form-error" role="alert">{arrivalsError}</p> : <p>Registered in the last 48 hours, newest first. Opening New arrivals marks the displayed registration notices as read for your account. Later notices remain unread; the 48-hour labels and selected batteries are retained.</p>}
            {arrivalsPending && <span role="status">Updating your reminder…</span>}
          </div>
        </MotionDisclosure>
        <div className="table-toolbar inventory-filter-toolbar">
          <Button
            id={`${instancePrefix}-filter-toggle`}
            variant="outline"
            onClick={() => setFilterOpen((open) => !open)}
            aria-expanded={filterOpen}
            aria-controls={filterDisclosureId}
          >
            <Settings2 size={16} />
            Filter{chips.length ? ` (${chips.length})` : ""}
          </Button>
            {!group && onViewNewArrivals && <Button
              variant="ghost"
              className={styles.arrivalsButton}
              aria-pressed={filters.newArrivalsOnly}
              aria-busy={arrivalsPending}
              disabled={!ready || arrivalsPending}
              onClick={() => {
                updateFilters({ ...defaultInventoryFilter(), personalScope, newArrivalsOnly: true, sortBy: "registered", sortDirection: "desc" });
                void onViewNewArrivals(newArrivals?.throughSequence ?? 0);
              }}
              title="View batteries first registered within the last 48 hours and acknowledge this inventory's new registrations for your account."
            >
              <span className={styles.arrivalsIcon} aria-hidden="true">
                <Clock3 size={15} />
                <span className={styles.arrivalsUnreadDot} data-visible={!!unreadArrivals.length} />
              </span>
              <span>New arrivals</span><span className={styles.arrivalsCount}>{scopeArrivals.length}</span>
              {!!unreadArrivals.length && <span className="sr-only">{unreadArrivals.length} unread new registrations</span>}
            </Button>}
          <AppliedFilters chips={chips} onRemove={(patch) => { focusFilterToggle(); updateFilters(patch); }} onClear={() => { focusFilterToggle(); clearFilters(); }} />
          <span className="toolbar-meta">
            {matching.length} matching{" "}
            {matching.length === 1 ? "battery" : "batteries"}
          </span>
          <Button
            variant="ghost"
            onClick={exportInventory}
            disabled={
              !validation.success ||
              selectionScopeChanged ||
              (!matching.length && !selected.length)
            }
            aria-label="Download inventory"
          >
            <Download size={16} />
            <span>Download</span>
          </Button>
        </div>
        <MotionDisclosure open={filterOpen} id={filterDisclosureId}>
          <InventoryFilterPanel
            id={`${instancePrefix}-filter-panel`}
            fixedGroup={!!group}
            data={data}
            filters={filters}
            asOfOn={asOfOn}
            onChange={updateFilters}
          />
        </MotionDisclosure>
        {groupMissing && (
          <p className="form-error" role="alert">
            This teaching group is no longer available. Clear the group filter
            or choose a current group. Your selected batteries are retained for
            review.
          </p>
        )}
        {groupNotice && (
          <p role="status" className="field-hint">
            {groupNotice}
          </p>
        )}
        {groupEditor && (
          <TeachingGroupsPanel
            data={data}
            initialIds={groupEditor.ids}
            addToExisting={!!groupEditor.ids.length}
            onClose={() => setGroupEditor(null)}
            onChanged={onGroupsChanged}
            onFilter={(group) => {
              updateFilters({ groupId: group.id });
              setGroupNotice("");
            }}
            onSelect={selectGroup}
          />
        )}
        {!validation.success && (
          <p className="form-error filter-error" role="alert">
            {validation.error.issues.map((issue) => issue.message).join(" ")}
          </p>
        )}
        <Table className={styles.table} role="table" aria-label="Battery records">
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead scope="col" role="columnheader" className="checkbox-cell">
                <Checkbox
                  aria-label="Select all batteries on this page"
                  checked={
                    visible.length > 0 &&
                    visible.every((b) => selected.includes(b.id))
                      ? true
                      : visible.some((b) => selected.includes(b.id))
                        ? "indeterminate"
                        : false
                  }
                  disabled={!visible.length || !ready}
                  onCheckedChange={(v) => selectAll(v === true)}
                /><span className={styles.selectPageLabel} aria-hidden="true">Select this page</span>
              </TableHead>
              <TableHead scope="col" role="columnheader" className={styles.expansionColumn}><span className="sr-only">Additional battery information</span></TableHead>
              <TableHead scope="col" role="columnheader" className={styles.assetColumn}>Battery</TableHead>
              <TableHead scope="col" role="columnheader" className={styles.statusColumn}>Status</TableHead>
              <TableHead scope="col" role="columnheader" className={styles.holderColumn}>Current holder</TableHead>
              <TableHead scope="col" role="columnheader" className={styles.storageColumn}>Registered home</TableHead>
              <TableHead scope="col" role="columnheader" className={styles.ownerColumn}>Responsible owner</TableHead>
              {group && permissions.editBatteryRecords && (
                <TableHead scope="col" role="columnheader">ACTIONS</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {visible.map((b) => [
              <TableRow role="row"
                key={b.id}
                className="battery-selection-row"
                data-selected={selected.includes(b.id)}
                data-expanded={expandedIds.includes(b.id)}
                data-selectable={ready}
                aria-selected={selected.includes(b.id)}
                onClick={(event) => selectBatteryRow(b.id, event)}
              >
                <TableCell role="cell" className="checkbox-cell">
                  <Checkbox
                    aria-label={`Select ${b.id}`}
                    checked={selected.includes(b.id)}
                    disabled={!ready}
                    onCheckedChange={(v) =>
                      changeBatterySelection(b.id, v === true)
                    }
                  />
                </TableCell>
                <TableCell role="cell" className={styles.expansionColumn}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={styles.expandButton}
                    aria-label={`${expandedIds.includes(b.id) ? "Hide" : "Show"} additional information for ${b.id}`}
                    aria-expanded={expandedIds.includes(b.id)}
                    aria-controls={`${instancePrefix}-battery-evidence-${encodeURIComponent(b.id)}`}
                    onClick={() => setExpanded(previous => previous.includes(b.id) ? previous.filter(id => id !== b.id) : [...previous, b.id])}
                  ><ChevronDown size={16} /></Button>
                </TableCell>
                <TableCell role="cell" className={styles.assetColumn}>
                  <div className={`battery-cell ${styles.identity}`}>
                    <span className={`battery-icon ${styles.assetIcon}`}>
                      <Battery size={19} />
                    </span>
                    <div>
                      <div className={styles.assetHeading}>
                        <button
                          className={`record-link ${styles.identifier}`}
                          onClick={() => onDetail(b.id)}
                          aria-label={`View ${b.id}`}
                        >
                          {b.id}
                        </button>
                        <span className={styles.newArrivalBadge} data-visible={isActiveBattery(b) && recentIds.has(b.id)} aria-hidden={!isActiveBattery(b) || !recentIds.has(b.id)} title={`First registered ${formatTime(b.registeredAt)}. This label lasts 48 hours from registration.`}><span aria-hidden="true">New</span><span className="sr-only">Newly registered</span></span>
                      </div>
                      <span className={styles.assetName}>{b.name}</span>
                      <small>
                        {b.chemistry || "Chemistry not recorded"}
                        {b.voltage != null ? ` · ${b.voltage} V` : " · Voltage not recorded"}
                      </small>
                      {!!b.inspectionPreview?.concernRecords && <button
                        type="button"
                        className={styles.concernLink}
                        aria-label={`View recorded concern evidence for ${b.id}`}
                        onClick={() => onDetail(b.id)}
                        title={`${b.inspectionPreview.concernRecords} retained inspection ${b.inspectionPreview.concernRecords === 1 ? "record reports" : "records report"} a concern. Historical findings do not establish a current unresolved condition or an availability decision.`}
                      ><AlertTriangle size={13} />{b.inspectionPreview.latest?.outcome === "concern_observed" ? "Latest inspection: concern" : "Concern in history"}<span className={styles.concernCount}>{b.inspectionPreview.concernRecords}</span></button>}
                    </div>
                  </div>
                </TableCell>
                <TableCell role="cell" className={styles.statusColumn}>
                  <span
                    className={`status-badge ${styles.statusBadge} ${!isActiveBattery(b) ? "retired" : b.loanId ? "out" : "in"}`}
                  >
                    {batteryStatusLabel(b)}
                  </span>
                </TableCell>
                <TableCell role="cell" className={styles.holderColumn}><span className={styles.mobileLabel} aria-hidden="true">Current holder</span>
                  {b.borrowerName ? <span className={styles.holderName}>{b.borrowerName}</span> : <span className="muted">—</span>}
                </TableCell>
                <TableCell role="cell" className={styles.storageColumn}><span className={styles.mobileLabel} aria-hidden="true">Registered home</span><div>
                  <strong>
                    {b.homeBuildingId
                      ? buildingLabel({
                          id: b.homeBuildingId,
                          name: b.homeBuildingName!,
                        })
                      : "Building not assigned"}
                  </strong>
                  <span className="cell-secondary">{storageRoomLabel(b)}</span></div>
                </TableCell>
                <TableCell role="cell" className={styles.ownerColumn}><span className={styles.mobileLabel} aria-hidden="true">Responsible owner</span><span>{b.ownerName}</span></TableCell>
                {group && permissions.editBatteryRecords && (
                  <TableCell role="cell">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit({ kind: "battery", record: b })}
                      disabled={!ready || !isActiveBattery(b)}
                    >
                      Edit battery
                    </Button>
                  </TableCell>
                )}
              </TableRow>,
              <TableRow role="row" key={`${b.id}-evidence`} className={styles.evidenceRow} data-expanded={expandedIds.includes(b.id)}>
                <TableCell role="cell" colSpan={group && permissions.editBatteryRecords ? 8 : 7}>
                  <MotionDisclosure open={expandedIds.includes(b.id)} id={`${instancePrefix}-battery-evidence-${encodeURIComponent(b.id)}`}>
                    <div className={styles.evidenceGrid}>
                      <section aria-label={`Specifications for ${b.id}`}>
                        <h3>Specifications</h3>
                        <dl>
                          <div><dt>Registered model</dt><dd>{b.model || "Not recorded"}</dd></div>
                          <div><dt>Chemistry</dt><dd>{b.chemistry || "Not recorded"}</dd></div>
                          <div><dt>Registered capacity</dt><dd>{b.capacityMah != null ? `${b.capacityMah.toLocaleString()} mAh` : "Not recorded"}</dd></div>
                          <div><dt>Nominal voltage</dt><dd>{b.voltage != null ? `${b.voltage} V` : "Not recorded"}</dd></div>
                          <div><dt>RFID tag</dt><dd>{b.tagId || "No tag registered"}</dd></div>
                        </dl>
                      </section>
                      <section aria-label={`Age and activity for ${b.id}`}>
                        <h3>Age & activity</h3>
                        <dl>
                          <div><dt>Manufactured on</dt><dd>{formatDateOnly(b.manufacturedOn)}</dd></div>
                          <div><dt>Age since manufacture</dt><dd>{formatBatteryAge(b.manufacturedOn)}</dd></div>
                          <div><dt>Registered at</dt><dd>{formatTime(b.registeredAt)}</dd></div>
                          <div><dt>First used on</dt><dd>{formatDateOnly(b.firstUsedOn)}</dd></div>
                          <div><dt>Latest checkout</dt><dd>{formatTime(b.lastCheckedOutAt)}</dd></div>
                          <div><dt>Latest charge</dt><dd>{formatTime(b.chargedAt)}{b.chargedAt && ` · ${b.chargeDurationMinutes != null ? `${b.chargeDurationMinutes} min` : "Duration not recorded"}`}</dd></div>
                        </dl>
                      </section>
                      <section aria-label={`Last observed location for ${b.id}`}>
                        <h3>Last observed location</h3>
                        {b.observedAt ? <>
                          <dl>
                            <div><dt>Room</dt><dd>{b.observedRoom || "Recorded address unavailable"}</dd></div>
                            <div><dt>Building</dt><dd>{b.observedBuilding || "Recorded address unavailable"}</dd></div>
                            <div><dt>Observed at</dt><dd>{formatTime(b.observedAt)}</dd></div>
                            <div><dt>Source</dt><dd>{b.observationSource || "Not recorded"}</dd></div>
                          </dl>
                          {b.observationRoomSnapshot === "unavailable" && <p>Historical address labels were not recorded.</p>}
                        </> : <p>Not yet observed</p>}
                        <p>Separate, dated evidence. The registered home is shown in the main row.</p>
                      </section>
                      {!!b.inspectionPreview?.concernRecords && <section className={styles.concernEvidence} aria-label={`Recorded inspection concern evidence for ${b.id}`}>
                        <div>
                          <strong>{b.inspectionPreview.latest?.outcome === "concern_observed" ? "Latest inspection: concern" : "Concern in history"}</strong>
                          <p>{b.inspectionPreview.concernRecords} retained inspection {b.inspectionPreview.concernRecords === 1 ? "record" : "records"}{b.inspectionPreview.latestConcern && ` · Latest ${formatTime(b.inspectionPreview.latestConcern.performedAt)}`}</p>
                        </div>
                        <p>Recorded findings do not establish a current unresolved condition.</p>
                        <button type="button" className="record-link" onClick={() => onDetail(b.id)}>View inspection evidence</button>
                      </section>}
                    </div>
                  </MotionDisclosure>
                </TableCell>
              </TableRow>
            ])}
          </TableBody>
        </Table>
        {!matching.length && (
          <div className="empty-state">
            <Package />
            <h3>
              {!validation.success
                ? "Review the filter range"
                : !baseBatteries.length && personalScope === "responsible"
                  ? "No batteries assigned to you"
                  : !baseBatteries.length && personalScope === "borrowed"
                    ? "No current loans"
                    : batteries.length
                      ? "No matching batteries"
                      : "No batteries registered"}
            </h3>
            <p>
              {!validation.success
                ? "Correct the filter conditions to view or download matching records."
                : !baseBatteries.length && personalScope === "responsible"
                  ? "Your account has no batteries assigned as responsible owner. Shared records remain available in Battery inventory."
                  : !baseBatteries.length && personalScope === "borrowed"
                    ? "You have no batteries currently checked out. Shared records remain available in Battery inventory."
                    : batteries.length
                      ? "Adjust or clear your filters."
                      : "Register a battery in J18 and choose its responsible staff account. Its room can stay unspecified."}
            </p>
            {!batteries.length && personalScope === "all" && (
              <Button variant="outline" onClick={onSetup}>
                Set up records
              </Button>
            )}
          </div>
        )}
        <div className="pagination-bar">
          <span>
            {matching.length ? currentPage * Number(pageSize) + 1 : 0}–
            {Math.min((currentPage + 1) * Number(pageSize), matching.length)} of{" "}
            {matching.length} matching{" "}
            {matching.length === 1 ? "battery" : "batteries"}
          </span>
          <div>
            <Select
              value={pageSize}
              onValueChange={(value) => {
                transitionWorkspace(() => { setPageSize(value as typeof pageSize); setPage(0); });
              }}
            >
              <SelectTrigger aria-label="Batteries per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["10", "25", "50", "100"].map((size) => (
                  <SelectItem key={size} value={size}>
                    {size} per page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionWorkspace(() => setPage(currentPage - 1))}
              disabled={!currentPage}
            >
              Previous
            </Button>
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionWorkspace(() => setPage(currentPage + 1))}
              disabled={currentPage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
        <div className="panel-footer">
          <span>
            Storage building and room are the registered home. Last observed
            location is separate, dated evidence.
          </span>
          <span>
            {baseBatteries.length}{" "}
            active {baseBatteries.length === 1 ? "battery" : "batteries"} in this scope
          </span>
        </div>
      </section>

      </div>
    </>
  );
}
