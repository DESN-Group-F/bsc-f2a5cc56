"use client";

import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { columnById, type BatteryColumn, type ColumnContext } from "@/lib/console/battery-columns";
import { describeValue, editBlockReason, parseFieldInput, recordValues, type BatteryChanges, type EditableField } from "@/lib/console/battery-edits";
import styles from "./console.module.css";

export type Draft = { baseVersion: number; changes: BatteryChanges; errors: Partial<Record<EditableField, string>>; raw: Partial<Record<EditableField, string>> };
export type CellTarget = { batteryId: string; field: EditableField };

type Props = {
  rows: BatteryRecord[];
  columnIds: string[];
  context: ColumnContext;
  sort: { column: string; direction: "asc" | "desc" };
  onSort: (column: string) => void;
  selected: ReadonlySet<string>;
  onToggle: (id: string, range: boolean) => void;
  onToggleAll: () => void;
  focusedId: string | null;
  onFocus: (id: string) => void;
  inspectedId: string | null;
  onInspect: (id: string) => void;
  editMode: boolean;
  drafts: Readonly<Record<string, Draft>>;
  lockedIds: ReadonlySet<string>;
  onCellCommit: (target: CellTarget, raw: string) => void;
};

const selectableFields = new Set<EditableField>(["ownerId", "homeRoomId"]);

function staffOwners(snapshot: InventorySnapshot) {
  const active = new Map(snapshot.staffDirectory.map((account) => [account.id, account.active]));
  return snapshot.people.filter((person) => person.role === "staff" && person.accountId).map((person) => ({ id: person.id, name: person.name, active: active.get(person.accountId!) !== false }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
function storageRooms(snapshot: InventorySnapshot) {
  return snapshot.rooms.filter((room) => room.buildingId === "J18" && room.selectable).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

function CellEditor({ battery, field, draft, snapshot, onDone }: { battery: BatteryRecord; field: EditableField; draft?: Draft; snapshot: InventorySnapshot; onDone: (raw: string | null, move: "down" | "right" | "left" | null) => void }) {
  const current = draft && field in draft.raw ? draft.raw[field]! : draft && field in draft.changes ? String(draft.changes[field] ?? "") : String(recordValues(battery)[field] ?? "");
  const [value, setValue] = useState(current);
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const finished = useRef(false);
  useEffect(() => { ref.current?.focus(); if (ref.current instanceof HTMLInputElement) ref.current.select(); }, []);
  const close = (raw: string | null, move: "down" | "right" | "left" | null) => { if (finished.current) return; finished.current = true; onDone(raw, move); };
  const finish = (move: "down" | "right" | "left" | null) => close(value, move);
  const onKey = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === "Enter") { event.preventDefault(); finish(event.shiftKey ? null : "down"); }
    else if (event.key === "Tab") { event.preventDefault(); finish(event.shiftKey ? "left" : "right"); }
    else if (event.key === "Escape") { event.preventDefault(); close(null, null); }
    event.stopPropagation();
  };
  if (selectableFields.has(field)) {
    const options = field === "ownerId"
      ? staffOwners(snapshot).filter((owner) => owner.active || owner.id === battery.ownerId).map((owner) => ({ value: owner.id, label: `${owner.name}${owner.active ? "" : " (inactive)"}` }))
      : [{ value: "", label: "Room not specified" }, ...storageRooms(snapshot).map((room) => ({ value: room.id, label: describeValue("homeRoomId", room.id, snapshot) }))];
    return <select ref={ref} className={styles.cellEditor} value={value} aria-label={field === "ownerId" ? "Responsible owner" : "Storage room in J18"}
      onChange={(event) => setValue(event.target.value)} onKeyDown={onKey} onBlur={() => finish(null)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }
  const date = field === "manufacturedOn" || field === "firstUsedOn";
  return <input ref={ref} className={styles.cellEditor} value={value} inputMode={field === "capacityMah" || field === "voltage" ? "decimal" : undefined}
    placeholder={date ? "YYYY-MM-DD" : field === "name" ? "" : "Not recorded"} aria-label={`Edit ${field}`}
    onChange={(event) => setValue(event.target.value)} onKeyDown={onKey} onBlur={() => finish(null)} />;
}

function cellText(column: BatteryColumn, battery: BatteryRecord, context: ColumnContext, draft?: Draft) {
  const field = column.edit;
  if (field && draft) {
    if (field in draft.raw && draft.errors[field]) return draft.raw[field] || "—";
    if (field in draft.changes) {
      const value = draft.changes[field];
      if (field === "homeRoomId") return `J18 · ${value ? describeValue(field, value, context.snapshot) : "Room not specified"}`;
      if (field === "ownerId") return describeValue(field, value, context.snapshot);
      return value === null || value === "" ? "" : field === "capacityMah" ? Number(value).toLocaleString("en-AU") : String(value);
    }
  }
  return column.text(battery, context);
}

const Row = memo(function Row({ battery, columns, context, selected, focused, inspected, editMode, draft, locked, editing, onToggle, onFocus, onInspect, onStartEdit, onEditDone }: {
  battery: BatteryRecord; columns: BatteryColumn[]; context: ColumnContext; selected: boolean; focused: boolean; inspected: boolean; editMode: boolean; draft?: Draft; locked: boolean;
  editing: EditableField | null; onToggle: (id: string, range: boolean) => void; onFocus: (id: string) => void; onInspect: (id: string) => void;
  onStartEdit: (target: CellTarget) => void; onEditDone: (target: CellTarget, raw: string | null, move: "down" | "right" | "left" | null) => void;
}) {
  const blocked = editBlockReason(battery) ?? (locked ? "A saved edit for this battery is still unresolved. Resolve it before editing again." : null);
  return <tr aria-selected={selected} data-focused={focused || undefined} data-inspected={inspected || undefined} data-retired={battery.lifecycleStatus !== "active" || undefined}
    id={`console-row-${battery.id}`} onClick={(event) => { onFocus(battery.id); if (!editMode || !(event.target as HTMLElement).closest("[data-editable]")) onInspect(battery.id); }}>
    <td className={styles.checkCell} onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={selected} aria-label={`Select ${battery.id}`} onChange={(event) => onToggle(battery.id, (event.nativeEvent as MouseEvent).shiftKey)} />
    </td>
    {columns.map((column) => {
      const field = column.edit;
      const editable = editMode && !!field && !blocked;
      const edited = !!field && !!draft && field in draft.changes && !draft.errors[field];
      const invalid = !!field && !!draft?.errors[field];
      if (editing && field === editing) return <td key={column.id} style={{ padding: "0 4px" }} onClick={(event) => event.stopPropagation()}>
        <CellEditor battery={battery} field={field} draft={draft} snapshot={context.snapshot} onDone={(raw, move) => onEditDone({ batteryId: battery.id, field }, raw, move)} />
      </td>;
      const content = cellText(column, battery, context, draft);
      const className = [column.id === "id" ? `${styles.idCell} ${styles.stickyId}` : "", edited ? styles.cellEdited : "", invalid ? styles.cellInvalid : "", editable ? styles.cellEditable : ""].filter(Boolean).join(" ");
      return <td key={column.id} data-align={column.align} className={className || undefined} data-editable={editable || undefined}
        title={invalid ? draft!.errors[field!] : editMode && field && blocked ? blocked : content || undefined}
        onClick={editable ? (event) => { event.stopPropagation(); onFocus(battery.id); onStartEdit({ batteryId: battery.id, field: field! }); } : undefined}>
        {column.id === "status" ? <span className={styles.status} data-state={battery.lifecycleStatus !== "active" ? "retired" : battery.loanId ? "out" : "in"}>{content}</span> : content || <span className={styles.muted}>{column.id === "holder" ? "" : "—"}</span>}
      </td>;
    })}
  </tr>;
});

export function BatteryGrid(props: Props) {
  const { rows, columnIds, context, sort, onSort, selected, onToggle, onToggleAll, focusedId, onFocus, inspectedId, onInspect, editMode, drafts, lockedIds, onCellCommit } = props;
  const columns = columnIds.flatMap((id) => columnById.get(id) ?? []);
  const [editing, setEditing] = useState<CellTarget | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const editableColumns = columns.filter((column) => column.edit);
  const activeEditing = editMode ? editing : null;

  useEffect(() => {
    if (!focusedId) return;
    document.getElementById(`console-row-${focusedId}`)?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  function editDone(target: CellTarget, raw: string | null, move: "down" | "right" | "left" | null) {
    if (raw !== null) onCellCommit(target, raw);
    setEditing(null);
    if (!move) { viewport.current?.focus({ preventScroll: true }); return; }
    const rowIndex = rows.findIndex((row) => row.id === target.batteryId);
    const columnIndex = editableColumns.findIndex((column) => column.edit === target.field);
    let nextRow = rowIndex, nextColumn = columnIndex;
    if (move === "down") nextRow = rowIndex + 1;
    else if (move === "right") { nextColumn = columnIndex + 1; if (nextColumn >= editableColumns.length) { nextColumn = 0; nextRow = rowIndex + 1; } }
    else { nextColumn = columnIndex - 1; if (nextColumn < 0) { nextColumn = editableColumns.length - 1; nextRow = rowIndex - 1; } }
    const row = rows[nextRow];
    if (!row || editBlockReason(row) || lockedIds.has(row.id)) { viewport.current?.focus({ preventScroll: true }); return; }
    onFocus(row.id);
    setEditing({ batteryId: row.id, field: editableColumns[nextColumn].edit! });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (activeEditing || !rows.length) return;
    const index = Math.max(0, rows.findIndex((row) => row.id === focusedId));
    const go = (next: number) => { event.preventDefault(); onFocus(rows[Math.min(rows.length - 1, Math.max(0, next))].id); };
    switch (event.key) {
      case "ArrowDown": return go(focusedId ? index + 1 : 0);
      case "ArrowUp": return go(index - 1);
      case "PageDown": return go(index + 15);
      case "PageUp": return go(index - 15);
      case "Home": if (event.ctrlKey) return go(0); return;
      case "End": if (event.ctrlKey) return go(rows.length - 1); return;
      case " ": if (focusedId) { event.preventDefault(); onToggle(focusedId, event.shiftKey); } return;
      case "Enter": if (focusedId) { event.preventDefault(); onInspect(focusedId); } return;
      case "F2": {
        const row = rows.find((item) => item.id === focusedId);
        if (editMode && row && editableColumns.length && !editBlockReason(row) && !lockedIds.has(row.id)) { event.preventDefault(); setEditing({ batteryId: row.id, field: editableColumns[0].edit! }); }
        return;
      }
      case "a": if (event.ctrlKey || event.metaKey) { event.preventDefault(); onToggleAll(); } return;
    }
  }

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = !allSelected && rows.some((row) => selected.has(row.id));
  return <div ref={viewport} className={styles.gridViewport} tabIndex={0} role="region" aria-label="Batteries" onKeyDown={onKeyDown}>
    <table className={styles.grid} style={{ width: "100%", minWidth: 40 + columns.reduce((sum, column) => sum + column.width, 0) }} aria-rowcount={rows.length + 1}>
      <colgroup><col style={{ width: 40 }} />{columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
      <thead>
        <tr>
          <th className={styles.checkCell}><input type="checkbox" aria-label="Select all shown batteries" checked={allSelected} ref={(input) => { if (input) input.indeterminate = someSelected; }} onChange={onToggleAll} /></th>
          {columns.map((column) => {
            const active = sort.column === column.id;
            return <th key={column.id} className={column.id === "id" ? styles.stickyId : undefined} data-align={column.align} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
              <button type="button" className={styles.sortButton} onClick={() => onSort(column.id)} title={column.sharedSort ? `Sort by ${column.label}` : `Sort by ${column.label} (this view only; exports keep the standard order)`}>
                {column.label}{active && (sort.direction === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
              </button>
            </th>;
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((battery) => <Row key={battery.id} battery={battery} columns={columns} context={context} selected={selected.has(battery.id)} focused={focusedId === battery.id}
          inspected={inspectedId === battery.id} editMode={editMode} draft={drafts[battery.id]} locked={lockedIds.has(battery.id)}
          editing={activeEditing?.batteryId === battery.id ? activeEditing.field : null} onToggle={onToggle} onFocus={onFocus} onInspect={onInspect}
          onStartEdit={setEditing} onEditDone={editDone} />)}
      </tbody>
    </table>
    {!rows.length && <div className={styles.gridEmpty}><strong>No batteries match</strong><br />Change the view or clear the filters.</div>}
  </div>;
}

/** Applies one typed cell value to a draft, keeping the raw text when it is invalid. */
export function applyCellInput(battery: BatteryRecord, draft: Draft | undefined, field: EditableField, raw: string): Draft | undefined {
  const parsed = parseFieldInput(field, raw);
  const next: Draft = draft ? { ...draft, changes: { ...draft.changes }, errors: { ...draft.errors }, raw: { ...draft.raw } } : { baseVersion: battery.version, changes: {}, errors: {}, raw: {} };
  if (!parsed.ok) { next.errors[field] = parsed.error; next.raw[field] = raw; delete next.changes[field]; return next; }
  delete next.errors[field]; delete next.raw[field];
  if (parsed.value === recordValues(battery)[field]) delete next.changes[field];
  else (next.changes as Record<string, unknown>)[field] = parsed.value;
  return Object.keys(next.changes).length || Object.keys(next.errors).length ? next : undefined;
}
