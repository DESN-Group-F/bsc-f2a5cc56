"use client";

import { isActiveBattery, batteryStatusLabel } from "@/lib/battery-lifecycle";
import { useEffect, useState, type MouseEvent } from "react";
import { Battery, Package, Plus, Download, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type {
  RecordActions,
  ExportDraft,
} from "@/lib/client/inventory-contracts";

export function InventoryTable({
  data,
  ready,
  onMovement,
  onEdit,
  onDetail,
  onSetup,
  onExport,
  onGroupsChanged,
  onGroupDialogChange,
  onOpenGroups,
  group,
  onRemoval,
  onGroupMaintenance,
  personalScope = "all",
}: RecordActions & {
  onMovement: (kind: "checkout" | "return", ids: string[]) => void;
  onSetup: () => void;
  onExport: (draft: ExportDraft) => void;
  personalScope?: InventoryFilter["personalScope"];
  group?: TeachingGroup;
  onOpenGroups?: () => void;
  onRemoval?: (ids: string[]) => void;
  onGroupMaintenance?: (ids: string[]) => void;
  onGroupsChanged?: () => Promise<void>;
  onGroupDialogChange?: (open: boolean) => void;
}) {
  const [savedFilters, setFilters] = useState<InventoryFilter>(() => ({
      ...defaultInventoryFilter(),
      personalScope,
      ...(group ? { groupId: group.id, lifecycle: "all" as const } : {}),
    })),
    [filterOpen, setFilterOpen] = useState(false);
  const filters = {
    ...savedFilters,
    personalScope,
    ...(group ? { groupId: group.id } : {}),
  };
  const [selectedIds, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState<"10" | "25" | "50" | "100">("25");
  const [groupEditor, setGroupEditor] = useState<{ ids: string[] } | null>(
      null,
    ),
    [groupNotice, setGroupNotice] = useState("");
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
      ...(group ? { groupId: group.id } : {}),
    },
    currentSydneyDate(),
    data.user.id,
    data.teachingGroups ?? [],
  );
  const onLoan = baseBatteries.filter((b) => b.loanId).length;
  const knownIds = new Set(batteries.map((battery) => battery.id));
  const selected = [...new Set(selectedIds)].filter((id) => knownIds.has(id));
  const baseIds = new Set(
    filterBatteries(
      batteries,
      { personalScope, lifecycle: "all" },
      currentSydneyDate(),
      data.user.id,
    ).map((battery) => battery.id),
  );
  const outsidePersonalScope = group
    ? selected.filter((id) => !group.batteryIds.includes(id))
    : personalScope === "all"
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
    if (
      !ready ||
      event.defaultPrevented ||
      !(event.target instanceof Element) ||
      event.target.closest(
        'button, a, input, select, textarea, label, [role="checkbox"], [role="button"], [contenteditable="true"]',
      )
    )
      return;
    const textSelection = window.getSelection();
    if (
      textSelection &&
      !textSelection.isCollapsed &&
      event.currentTarget.contains(textSelection.anchorNode)
    )
      return;
    changeBatterySelection(id);
  }
  function updateFilters(patch: Partial<InventoryFilter>) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(0);
  }
  function clearFilters() {
    setFilters({
      ...defaultInventoryFilter(),
      personalScope,
      ...(group ? { groupId: group.id, lifecycle: "all" as const } : {}),
    });
    setPage(0);
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
        filter: validation.data,
        page: currentPage,
        pageSize,
        matching: matching.length,
        pageCount: visible.length,
      });
  }
  return (
    <>
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
      <div className="summary-grid">
        {[
          [
            personalScope === "responsible"
              ? "My responsible batteries"
              : personalScope === "borrowed"
                ? "My batteries in use"
                : "Registered batteries",
            baseBatteries.length,
            personalScope === "all"
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
          <div className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
            <p>{note}</p>
          </div>
        ))}
      </div>
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
              onClick={() => onMovement("return", group.batteryIds)}
              disabled={!ready}
            >
              Return group
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
                </TabsTrigger>
                <TabsTrigger value="in">
                  In store <span className="tab-count">{matchingInStore}</span>
                </TabsTrigger>
                <TabsTrigger value="out">
                  In use <span className="tab-count">{matchingOnLoan}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {!group && (
              <Button
                variant="ghost"
                className="inventory-teaching-groups-link"
                onClick={() =>
                  onOpenGroups ? onOpenGroups() : setGroupEditor({ ids: [] })
                }
                disabled={!ready}
              >
                Teaching groups
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => onEdit({ kind: "battery" })}
            disabled={!ready}
          >
            <Plus />
            Register battery
          </Button>
        </div>
        <div className="table-toolbar inventory-filter-toolbar">
          <Button
            variant="outline"
            onClick={() => setFilterOpen((open) => !open)}
            aria-expanded={filterOpen}
            aria-controls="inventory-filter-panel"
          >
            <Settings2 size={16} />
            Filter{chips.length ? ` (${chips.length})` : ""}
          </Button>
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
        {filterOpen && (
          <InventoryFilterPanel
            fixedGroup={!!group}
            data={data}
            filters={filters}
            asOfOn={asOfOn}
            onChange={updateFilters}
          />
        )}
        <AppliedFilters
          chips={chips}
          onRemove={updateFilters}
          onClear={clearFilters}
        />
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
        {!!selected.length && (
          <div className="teaching-group-actions">
            {group && (
              <>
                {onRemoval && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRemoval(selected)}
                    disabled={
                      !ready ||
                      selected.some((id) => {
                        const b = batteries.find((b) => b.id === id)!;
                        return !isActiveBattery(b) || !!b.loanId;
                      })
                    }
                  >
                    Retire or remove selected
                  </Button>
                )}
                {onGroupMaintenance && data.user.role === "admin" && (
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
        {!!selected.length && (
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
              disabled={!validation.success || selectionScopeChanged}
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
                selected.length > 100 ||
                selected.some(
                  (id) =>
                    batteries.find((b) => b.id === id)?.loanId ||
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
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
        )}
        {selectionScopeChanged && (
          <div className="selection-scope-warning" role="alert">
            <strong>Your selected batteries have changed scope.</strong>
            <p>
              These batteries no longer belong to{" "}
              {group
                ? "this teaching group"
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="checkbox-cell">
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
                />
              </TableHead>
              <TableHead>BATTERY</TableHead>
              <TableHead>STATUS</TableHead>
              <TableHead>RESPONSIBLE OWNER</TableHead>
              <TableHead>CURRENT HOLDER</TableHead>
              <TableHead>STORAGE LOCATION</TableHead>
              <TableHead>LAST OBSERVED</TableHead>
              {group && data.user.role === "admin" && (
                <TableHead>ACTIONS</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((b) => (
              <TableRow
                key={b.id}
                className="battery-selection-row"
                data-selected={selected.includes(b.id)}
                data-selectable={ready}
                aria-selected={selected.includes(b.id)}
                onClick={(event) => selectBatteryRow(b.id, event)}
              >
                <TableCell className="checkbox-cell">
                  <Checkbox
                    aria-label={`Select ${b.id}`}
                    checked={selected.includes(b.id)}
                    disabled={!ready}
                    onCheckedChange={(v) =>
                      changeBatterySelection(b.id, v === true)
                    }
                  />
                </TableCell>
                <TableCell>
                  <div className="battery-cell">
                    <span className="battery-icon">
                      <Battery size={19} />
                    </span>
                    <div>
                      <button
                        className="record-link"
                        onClick={() => onDetail(b.id)}
                        aria-label={`View ${b.id}`}
                      >
                        {b.id}
                      </button>
                      <span>{b.name}</span>
                      <small>
                        {b.chemistry || "Chemistry not recorded"}
                        {b.capacityMah != null
                          ? ` · ${b.capacityMah.toLocaleString()} mAh`
                          : ""}
                        {b.voltage != null ? ` · ${b.voltage} V` : ""}
                      </small>
                      <small>
                        Age since manufacture:{" "}
                        {formatBatteryAge(b.manufacturedOn)}
                      </small>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={`status-badge ${!isActiveBattery(b) ? "retired" : b.loanId ? "out" : "in"}`}
                  >
                    {batteryStatusLabel(b)}
                  </span>
                </TableCell>
                <TableCell>{b.ownerName}</TableCell>
                <TableCell>
                  {b.borrowerName || <span className="muted">—</span>}
                </TableCell>
                <TableCell>
                  <strong>
                    {b.homeBuildingId
                      ? buildingLabel({
                          id: b.homeBuildingId,
                          name: b.homeBuildingName!,
                        })
                      : "Building not assigned"}
                  </strong>
                  <span className="cell-secondary">{storageRoomLabel(b)}</span>
                </TableCell>
                <TableCell>
                  {b.observedAt ? (
                    <>
                      <strong>{b.observedRoom}</strong>
                      {b.observedBuilding && (
                        <span className="cell-secondary">
                          {b.observedBuilding}
                        </span>
                      )}
                      <span className="cell-secondary">
                        {formatTime(b.observedAt)}
                      </span>
                      <span className="cell-secondary">
                        {b.observationSource}
                      </span>
                    </>
                  ) : (
                    <span className="muted">Not yet observed</span>
                  )}
                </TableCell>
                {group && data.user.role === "admin" && (
                  <TableCell>
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
              </TableRow>
            ))}
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
                setPageSize(value as typeof pageSize);
                setPage(0);
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
              onClick={() => setPage(currentPage - 1)}
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
              onClick={() => setPage(currentPage + 1)}
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
            {baseBatteries.length === 1 ? "battery" : "batteries"} in this view
          </span>
        </div>
      </section>
    </>
  );
}
