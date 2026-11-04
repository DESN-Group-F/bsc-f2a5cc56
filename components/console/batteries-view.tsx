"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Columns3, Download, Filter, ListChecks, Pencil, Search, SlidersHorizontal, Undo2, X } from "lucide-react";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import { filterBatteries, type InventoryFilter } from "@/lib/inventory-query";
import { batteryColumns, columnById, contextFor, defaultColumnIds, sortForColumn } from "@/lib/console/battery-columns";
import { describeValue, draftIsStale, editableFields, fieldLabels, parseFieldInput, prepareBatteryEdit, editBlockReason, type EditableField } from "@/lib/console/battery-edits";
import { consoleViews, viewById, type ConsoleViewId } from "@/lib/console/views";
import { unresolvedBatteryIds } from "@/lib/console/edit-journal";
import type { ExportDraft } from "@/lib/client/inventory-contracts";
import type { NewArrivals } from "@/lib/new-arrivals";
import { BatteryGrid, applyCellInput, type CellTarget, type Draft } from "./battery-grid";
import { BatteryInspector } from "./battery-inspector";
import { EditReviewDialog, resultChip, type ReviewItem } from "./edit-review-dialog";
import { useMetadataEdits } from "./use-metadata-edits";
import styles from "./console.module.css";

export type BatteriesIntent = { nonce: number; view?: ConsoleViewId; inspect?: string; filter?: Partial<InventoryFilter> };

const columnsKey = (accountId: string) => `battery-console:columns:v2:${accountId}`;
function readColumns(accountId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(columnsKey(accountId)) ?? "null");
    if (Array.isArray(saved) && saved.every((id) => typeof id === "string" && columnById.has(id))) return ["id", ...saved.filter((id) => id !== "id")];
  } catch { /* use defaults */ }
  return defaultColumnIds();
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

const criterionLabels: Partial<Record<keyof InventoryFilter, string>> = {
  search: "Search", status: "Status", owner: "Owner", holder: "Held by", model: "Model", modelUnknown: "Model", chemistry: "Chemistry", chemistryUnknown: "Chemistry",
  room: "Storage room", inspection: "Inspection", lifecycle: "Lifecycle", personalScope: "Scope", newArrivalsOnly: "New arrivals", observedRoom: "Last observed",
};

export function BatteriesView({ snapshot, revision, now, intent, canEdit, newArrivals, onArrivalsOpened, onOpenRecord, onExport, onChanged, onDraftCountChange }: {
  snapshot: InventorySnapshot; revision: number; now: number; intent: BatteriesIntent | null; canEdit: boolean; newArrivals?: NewArrivals;
  onArrivalsOpened: () => void; onOpenRecord: (battery: BatteryRecord) => void; onExport: (draft: ExportDraft) => void; onChanged: () => void;
  onDraftCountChange: (count: number) => void;
}) {
  const accountId = snapshot.user.id;
  const [viewId, setViewId] = useState<ConsoleViewId>("active");
  const view = viewById.get(viewId)!;
  const [filter, setFilter] = useState<InventoryFilter>(() => view.filter());
  const [sort, setSort] = useState({ column: "id", direction: "asc" as "asc" | "desc" });
  const [columnIds, setColumnIds] = useState<string[]>(() => (typeof window === "undefined" ? defaultColumnIds() : readColumns(accountId)));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [menu, setMenu] = useState<"views" | "columns" | "filters" | "bulk" | null>(null);
  const [review, setReview] = useState<{ items: ReviewItem[]; submitted: boolean; error: string } | null>(null);
  const lastAnchor = useRef<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuRef = useOutside(menu !== null, closeMenu);
  const edits = useMetadataEdits(accountId, snapshot.dataset, onChanged);

  const context = useMemo(() => contextFor(snapshot, now ? new Date(now) : undefined), [snapshot, now]);
  const filtered = useMemo(() => {
    try { return { rows: filterBatteries(snapshot.batteries, filter, context.today, accountId, snapshot.teachingGroups, newArrivals, snapshot.rooms), error: "" }; }
    catch (error) { return { rows: [] as BatteryRecord[], error: (error as Error).message }; }
  }, [snapshot, filter, context.today, accountId, newArrivals]);
  const rows = useMemo(() => sortForColumn(filtered.rows, sort.column, sort.direction, context), [filtered.rows, sort, context]);
  const byId = useMemo(() => new Map(snapshot.batteries.map((battery) => [battery.id, battery])), [snapshot.batteries]);
  const locked = useMemo(() => unresolvedBatteryIds(edits.entries), [edits.entries]);
  const inspected = inspectedId ? byId.get(inspectedId) : undefined;

  const selectView = useCallback((id: ConsoleViewId) => {
    setViewId(id);
    setFilter(viewById.get(id)!.filter());
    if (id === "arrivals") { setSort({ column: "registered", direction: "desc" }); onArrivalsOpened(); }
    setMenu(null);
  }, [onArrivalsOpened]);

  // Navigation from other areas (overview tiles, global search) arrives as a one-time intent.
  const handled = useRef(0);
  useEffect(() => {
    if (!intent || handled.current === intent.nonce) return;
    handled.current = intent.nonce;
    queueMicrotask(() => {
      if (intent.view) selectView(intent.view);
      if (intent.filter) setFilter((current) => ({ ...current, ...intent.filter }));
      if (intent.inspect) { setInspectedId(intent.inspect); setFocusedId(intent.inspect); }
    });
  }, [intent, selectView]);

  useEffect(() => {
    if (!inspectedId || review || menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[role=dialog]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea")) return;
      setInspectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inspectedId, review, menu]);

  useEffect(() => { try { localStorage.setItem(columnsKey(accountId), JSON.stringify(columnIds)); } catch { /* per-viewer convenience only */ } }, [accountId, columnIds]);

  // Unsaved cell edits are never dropped silently: the page warns before unloading and the
  // console disables switching inventory while any exist.
  const draftCount = Object.keys(drafts).length;
  useEffect(() => { onDraftCountChange(draftCount); }, [draftCount, onDraftCountChange]);
  useEffect(() => {
    if (!draftCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftCount]);

  const toggle = useCallback((id: string, range: boolean) => {
    const anchor = lastAnchor.current;
    setSelected((current) => {
      const next = new Set(current);
      if (range && anchor) {
        const ids = rows.map((row) => row.id), from = ids.indexOf(anchor), to = ids.indexOf(id);
        if (from >= 0 && to >= 0) { for (const rowId of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(rowId); return next; }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastAnchor.current = id;
  }, [rows]);
  const toggleAll = useCallback(() => {
    setSelected((current) => rows.length && rows.every((row) => current.has(row.id)) ? new Set([...current].filter((id) => !rows.some((row) => row.id === id))) : new Set([...current, ...rows.map((row) => row.id)]));
  }, [rows]);

  const commitCell = useCallback((target: CellTarget, raw: string) => {
    const battery = byId.get(target.batteryId);
    if (!battery) return;
    setDrafts((current) => {
      const next = { ...current };
      const updated = applyCellInput(battery, current[target.batteryId], target.field, raw);
      if (updated) next[target.batteryId] = updated; else delete next[target.batteryId];
      return next;
    });
  }, [byId]);

  // Drafts whose reviewed save is confirmed are finished, even before the results dialog closes.
  const savedIds = useMemo(() => new Set(review?.submitted ? review.items.flatMap((item) => (item.ready && edits.results[item.payload.requestId]?.state === "saved" ? [item.batteryId] : [])) : []), [review, edits.results]);
  const openDrafts = useMemo(() => Object.fromEntries(Object.entries(drafts).filter(([id]) => !savedIds.has(id))), [drafts, savedIds]);
  const draftStats = useMemo(() => {
    let fields = 0, invalid = 0, stale = 0;
    for (const [id, draft] of Object.entries(openDrafts)) {
      fields += Object.keys(draft.changes).length;
      invalid += Object.keys(draft.errors).length;
      if (!locked.has(id) && draftIsStale(draft.baseVersion, byId.get(id))) stale++;
    }
    return { batteries: Object.keys(openDrafts).length, fields, invalid, stale, waiting: Object.keys(openDrafts).filter((id) => locked.has(id)).length };
  }, [openDrafts, byId, locked]);

  function openReview() {
    const items: ReviewItem[] = Object.entries(drafts).map(([batteryId, draft]) => {
      const battery = byId.get(batteryId);
      if (!battery) return { batteryId, battery, ready: false, errors: ["This battery is no longer in the inventory."] };
      if (Object.keys(draft.errors).length) return { batteryId, battery, ready: false, errors: Object.entries(draft.errors).map(([field, error]) => `${fieldLabels[field as EditableField]}: ${error}`) };
      if (draftIsStale(draft.baseVersion, battery)) return { batteryId, battery, ready: false, errors: ["The record changed since you started editing. Review it and choose Keep my changes, or discard them."] };
      if (locked.has(batteryId)) return { batteryId, battery, ready: false, errors: ["An earlier save for this battery is still unresolved."] };
      const prepared = prepareBatteryEdit({ battery, changes: draft.changes, snapshot, requestId: crypto.randomUUID() });
      return prepared.ok ? { batteryId, battery, ready: true, payload: prepared.payload, fields: prepared.fields, setsBuilding: prepared.setsBuilding } : { batteryId, battery, ready: false, errors: prepared.errors };
    });
    setReview({ items, submitted: false, error: "" });
  }
  async function submitReview() {
    if (!review) return;
    const payloads = review.items.flatMap((item) => (item.ready ? [item.payload] : []));
    setReview({ ...review, submitted: true, error: "" });
    const outcome = await edits.submit(payloads);
    if (outcome.error) setReview((current) => current && { ...current, submitted: false, error: outcome.error });
  }
  function closeReview() {
    if (review?.submitted) {
      const saved = review.items.filter((item) => item.ready && edits.results[item.payload.requestId]?.state === "saved").map((item) => item.batteryId);
      const settled = review.items.filter((item) => item.ready && ["saved", "not-saved", "removed"].includes(edits.results[item.payload.requestId]?.state ?? "")).map((item) => item.batteryId);
      setDrafts((current) => { const next = { ...current }; for (const id of saved) delete next[id]; return next; });
      edits.clearResults(review.items.flatMap((item) => (item.ready && settled.includes(item.batteryId) ? [item.payload.requestId] : [])));
    }
    setReview(null);
  }
  function rebase(id: string) {
    const battery = byId.get(id);
    if (battery) setDrafts((current) => current[id] ? { ...current, [id]: { ...current[id], baseVersion: battery.version } } : current);
  }
  function discardDraft(id: string) { setDrafts((current) => { const next = { ...current }; delete next[id]; return next; }); }

  const [bulk, setBulk] = useState<{ field: EditableField; value: string; error: string }>({ field: "ownerId", value: "", error: "" });
  function applyBulk() {
    const parsed = parseFieldInput(bulk.field, bulk.value);
    if (!parsed.ok) { setBulk({ ...bulk, error: parsed.error }); return; }
    setDrafts((current) => {
      const next = { ...current };
      for (const id of selected) {
        const battery = byId.get(id);
        if (!battery || editBlockReason(battery) || locked.has(id)) continue;
        const updated = applyCellInput(battery, next[id], bulk.field, bulk.value);
        if (updated) next[id] = updated; else delete next[id];
      }
      return next;
    });
    setBulk({ ...bulk, error: "" });
    setMenu(null);
  }

  function exportDraft(): ExportDraft {
    const column = columnById.get(sort.column);
    const exportFilter = column?.sharedSort ? { ...filter, sortBy: column.sharedSort, sortDirection: sort.direction } : filter;
    return { filter: exportFilter, selectedIds: [...selected], page: 0, pageSize: "100", matching: rows.length, pageCount: Math.min(100, rows.length) };
  }

  const applied = (Object.keys(filter) as (keyof InventoryFilter)[]).filter((key) => key !== "sortBy" && key !== "sortDirection" && JSON.stringify(filter[key]) !== JSON.stringify(view.filter()[key]));
  const owners = useMemo(() => snapshot.people.filter((person) => person.role === "staff").sort((a, b) => a.name.localeCompare(b.name, "en")), [snapshot.people]);
  const models = useMemo(() => [...new Set(snapshot.batteries.map((battery) => battery.model).filter(Boolean))].sort(), [snapshot.batteries]);
  const chemistries = useMemo(() => [...new Set(snapshot.batteries.map((battery) => battery.chemistry).filter(Boolean))].sort(), [snapshot.batteries]);
  const rooms = useMemo(() => snapshot.rooms.filter((room) => room.buildingId === "J18"), [snapshot.rooms]);
  const holders = useMemo(() => snapshot.staffDirectory.filter((account) => snapshot.batteries.some((battery) => battery.loanId && battery.borrowerAccountId === account.id)), [snapshot]);
  const unresolved = edits.entries;

  function criterionText(key: keyof InventoryFilter): string {
    const value = filter[key];
    if (key === "owner") return snapshot.people.find((person) => person.id === value)?.name ?? String(value);
    if (key === "room") return value === "__unspecified" ? "Not specified" : rooms.find((room) => room.id === value)?.name ?? String(value);
    if (key === "holder") return snapshot.staffDirectory.find((account) => account.id === value)?.displayName ?? String(value);
    if (key === "status") return value === "in" ? "In store" : value === "out" ? "In use" : "All";
    if (key === "inspection") return value === "concern" ? "Latest reports a concern" : value === "none" ? "None recorded" : "Any";
    if (key === "modelUnknown" || key === "chemistryUnknown") return "Not recorded";
    if (key === "personalScope") return value === "responsible" ? "My batteries" : value === "borrowed" ? "I hold" : "Everyone";
    if (key === "newArrivalsOnly") return value ? "Only" : "Off";
    return String(value);
  }

  return <div className={styles.workspace}>
    <div className={styles.workspaceMain}>
    <div className={styles.toolbar}>
      <h1 className={styles.toolbarTitle}>Batteries</h1>
      <div className={styles.menuWrap} ref={menu === "views" ? menuRef : undefined}>
        <button type="button" className={styles.btn} aria-haspopup="menu" aria-expanded={menu === "views"} onClick={() => setMenu(menu === "views" ? null : "views")}><ListChecks size={15} />{view.label}</button>
        {menu === "views" && <div className={styles.menu} data-align="start" role="menu">
          <div className={styles.menuLabel}>Views</div>
          {consoleViews.map((item) => <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === viewId} className={styles.menuItem} onClick={() => selectView(item.id)}>
            <span style={{ width: 16 }}>{item.id === viewId && <Check size={14} />}</span><span>{item.label}<small>{item.description}</small></span>
          </button>)}
        </div>}
      </div>
      <div className={styles.filterWrap}>
        <Search size={15} />
        <input className={styles.filterInput} value={filter.search} placeholder="Filter by ID, name, model, tag, owner…" aria-label="Filter batteries" onChange={(event) => setFilter({ ...filter, search: event.target.value })} />
      </div>
      <div className={styles.segmented} role="group" aria-label="Loan status">
        {([["all", "All"], ["in", "In store"], ["out", "In use"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter.status === value} onClick={() => setFilter({ ...filter, status: value })}>{label}</button>)}
      </div>
      <select className={styles.select} aria-label="Responsible owner" value={filter.owner} onChange={(event) => setFilter({ ...filter, owner: event.target.value })}>
        <option value="all">Any owner</option>{owners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
      <div className={styles.menuWrap} ref={menu === "filters" ? menuRef : undefined}>
        <button type="button" className={styles.btn} aria-expanded={menu === "filters"} onClick={() => setMenu(menu === "filters" ? null : "filters")}><SlidersHorizontal size={15} />More filters</button>
        {menu === "filters" && <div className={styles.menu} data-align="start" style={{ width: 300, padding: 12, display: "grid", gap: 10 }}>
          <div className={styles.field}><label htmlFor="console-filter-inspection">Inspection</label>
            <select id="console-filter-inspection" className={styles.fieldInput} value={filter.inspection} onChange={(event) => setFilter({ ...filter, inspection: event.target.value as InventoryFilter["inspection"] })}>
              <option value="all">Any inspection record</option><option value="concern">Latest inspection reports a concern</option><option value="none">No inspection recorded</option>
            </select></div>
          <div className={styles.field}><label htmlFor="console-filter-model">Model</label>
            <select id="console-filter-model" className={styles.fieldInput} value={filter.modelUnknown ? "__unknown" : filter.model ?? ""} onChange={(event) => setFilter({ ...filter, model: event.target.value && event.target.value !== "__unknown" ? event.target.value : null, modelUnknown: event.target.value === "__unknown" })}>
              <option value="">Any model</option><option value="__unknown">Not recorded</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="console-filter-chemistry">Chemistry</label>
            <select id="console-filter-chemistry" className={styles.fieldInput} value={filter.chemistryUnknown ? "__unknown" : filter.chemistry ?? ""} onChange={(event) => setFilter({ ...filter, chemistry: event.target.value && event.target.value !== "__unknown" ? event.target.value : null, chemistryUnknown: event.target.value === "__unknown" })}>
              <option value="">Any chemistry</option><option value="__unknown">Not recorded</option>{chemistries.map((value) => <option key={value} value={value}>{value}</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="console-filter-room">Registered storage room</label>
            <select id="console-filter-room" className={styles.fieldInput} value={filter.room} onChange={(event) => setFilter({ ...filter, room: event.target.value })}>
              <option value="all">Any room</option><option value="__unspecified">Room not specified</option>{rooms.map((room) => <option key={room.id} value={room.id}>{describeValue("homeRoomId", room.id, snapshot)}</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="console-filter-holder">Held by</label>
            <select id="console-filter-holder" className={styles.fieldInput} value={filter.holder} onChange={(event) => setFilter({ ...filter, holder: event.target.value })}>
              <option value="all">Anyone or no one</option>{holders.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="console-filter-lifecycle">Lifecycle</label>
            <select id="console-filter-lifecycle" className={styles.fieldInput} value={filter.lifecycle} onChange={(event) => setFilter({ ...filter, lifecycle: event.target.value as InventoryFilter["lifecycle"] })}>
              <option value="active">Active</option><option value="scrapped">Scrapped</option><option value="permanently_removed">Permanently removed</option><option value="all">All records</option>
            </select></div>
        </div>}
      </div>
      <span className={styles.toolbarGap} />
      <div className={styles.menuWrap} ref={menu === "columns" ? menuRef : undefined}>
        <button type="button" className={styles.btn} aria-expanded={menu === "columns"} onClick={() => setMenu(menu === "columns" ? null : "columns")}><Columns3 size={15} />Columns</button>
        {menu === "columns" && <div className={styles.menu}>
          <div className={styles.menuLabel}>Show columns</div>
          {batteryColumns.filter((column) => column.id !== "id").map((column) => <label key={column.id} className={styles.menuItem}>
            <input type="checkbox" checked={columnIds.includes(column.id)} onChange={(event) => setColumnIds((current) => event.target.checked ? batteryColumns.map((item) => item.id).filter((id) => id === column.id || current.includes(id)) : current.filter((id) => id !== column.id))} />{column.label}
          </label>)}
          <div className={styles.menuSep} />
          <button type="button" className={styles.menuItem} onClick={() => setColumnIds(defaultColumnIds())}><Undo2 size={14} />Reset columns</button>
        </div>}
      </div>
      <button type="button" className={styles.btn} onClick={() => onExport(exportDraft())}><Download size={15} />Export{selected.size ? ` ${selected.size}` : ""}</button>
      {canEdit && <button type="button" className={styles.btn} aria-pressed={editMode} onClick={() => setEditMode(!editMode)}><Pencil size={15} />{editMode ? "Editing" : "Edit"}</button>}
    </div>

    {(applied.length > 0 || filtered.error) && <div className={styles.applied}>
      <Filter size={13} /> Applied:
      {applied.map((key) => <button key={key} type="button" className={styles.appliedChip} onClick={() => setFilter({ ...filter, [key]: view.filter()[key], ...(key === "model" || key === "modelUnknown" ? { model: null, modelUnknown: false } : key === "chemistry" || key === "chemistryUnknown" ? { chemistry: null, chemistryUnknown: false } : {}) })} aria-label={`Remove ${criterionLabels[key] ?? key} filter`}>
        {criterionLabels[key] ?? key}: {criterionText(key)} <X size={12} />
      </button>)}
      {applied.length > 0 && <button type="button" className={styles.link} onClick={() => setFilter({ ...view.filter(), sortBy: filter.sortBy, sortDirection: filter.sortDirection })}>Clear filters</button>}
      {filtered.error && <span style={{ color: "var(--danger-foreground)" }}>{filtered.error}</span>}
    </div>}

    {editMode && <div className={styles.editModeBanner}>
      <Pencil size={14} />
      <span>Click a highlighted cell to edit it. <span className={styles.kbd}>Enter</span> saves the cell and moves down, <span className={styles.kbd}>Tab</span> moves right, <span className={styles.kbd}>Esc</span> cancels. Nothing is sent until you review.</span>
      <span className={styles.toolbarGap} />
      <div className={styles.menuWrap} ref={menu === "bulk" ? menuRef : undefined}>
        <button type="button" className={styles.btn} disabled={!selected.size} onClick={() => setMenu(menu === "bulk" ? null : "bulk")}>Set a field for {selected.size} selected</button>
        {menu === "bulk" && <div className={styles.menu} style={{ width: 320, padding: 12, display: "grid", gap: 10 }}>
          <div className={styles.field}><label htmlFor="console-bulk-field">Field</label>
            <select id="console-bulk-field" className={styles.fieldInput} value={bulk.field} onChange={(event) => setBulk({ field: event.target.value as EditableField, value: "", error: "" })}>
              {editableFields.filter((field) => field !== "name" && field !== "tagId").map((field) => <option key={field} value={field}>{fieldLabels[field]}</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor="console-bulk-value">New value</label>
            {bulk.field === "ownerId" ? <select id="console-bulk-value" className={styles.fieldInput} value={bulk.value} onChange={(event) => setBulk({ ...bulk, value: event.target.value, error: "" })}>
              <option value="">Choose an owner</option>{owners.filter((person) => person.accountId && snapshot.staffDirectory.find((account) => account.id === person.accountId)?.active !== false).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select> : bulk.field === "homeRoomId" ? <select id="console-bulk-value" className={styles.fieldInput} value={bulk.value} onChange={(event) => setBulk({ ...bulk, value: event.target.value, error: "" })}>
              <option value="">Room not specified</option>{rooms.filter((room) => room.selectable).map((room) => <option key={room.id} value={room.id}>{describeValue("homeRoomId", room.id, snapshot)}</option>)}
            </select> : <input id="console-bulk-value" className={styles.fieldInput} value={bulk.value} placeholder={bulk.field === "manufacturedOn" || bulk.field === "firstUsedOn" ? "YYYY-MM-DD, or empty for unknown" : "Empty means not recorded"} onChange={(event) => setBulk({ ...bulk, value: event.target.value, error: "" })} />}
            {bulk.error && <span className={styles.fieldError}>{bulk.error}</span>}
          </div>
          <p className={styles.muted} style={{ margin: 0, fontSize: 12 }}>Adds the value to each selected active battery as an unsaved change. Retired batteries and batteries with an unresolved save are skipped.</p>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={applyBulk}>Apply to selection</button>
        </div>}
      </div>
    </div>}

    {unresolved.length > 0 && !review && <div className={styles.notice} data-tone="warning" style={{ margin: "8px 16px 0" }}>
      <AlertTriangle size={16} />
      <div className={styles.noticeBody}>
        <p><strong>{unresolved.length} saved {unresolved.length === 1 ? "edit has" : "edits have"} no confirmed outcome yet.</strong> They are kept in this browser exactly as reviewed. Check them before editing those batteries again.</p>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {unresolved.map((entry) => <div key={entry.requestId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong className={styles.idCell}>{entry.batteryId}</strong>{resultChip(edits.results[entry.requestId] ?? (entry.state === "prepared" ? { state: "not-received" } : { state: "unknown", message: entry.lastError ?? "" }))}
            <button type="button" className={styles.btn} disabled={edits.running} onClick={() => void edits.check(entry.requestId)}>Check outcome</button>
            <button type="button" className={styles.btn} disabled={edits.running} onClick={() => void edits.retry(entry.requestId)}>Send original</button>
            {entry.state === "prepared" && <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} disabled={edits.running} onClick={() => edits.discard(entry.requestId)}>Discard</button>}
          </div>)}
        </div>
      </div>
    </div>}
    {edits.storageError && <div className={styles.notice} data-tone="danger" style={{ margin: "8px 16px 0" }}><AlertTriangle size={16} /><p>{edits.storageError}</p></div>}

    <BatteryGrid rows={rows} columnIds={columnIds} context={context} sort={sort} onSort={(column) => setSort((current) => ({ column, direction: current.column === column && current.direction === "asc" ? "desc" : "asc" }))}
      selected={selected} onToggle={toggle} onToggleAll={toggleAll} focusedId={focusedId} onFocus={setFocusedId} inspectedId={inspectedId} onInspect={setInspectedId}
      editMode={editMode && canEdit} drafts={openDrafts} lockedIds={locked} onCellCommit={commitCell} />

    {draftStats.batteries > 0 ? <div className={styles.editTray}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>{draftStats.fields} unsaved {draftStats.fields === 1 ? "change" : "changes"} on {draftStats.batteries} {draftStats.batteries === 1 ? "battery" : "batteries"}</strong>
        <p>{draftStats.invalid ? `${draftStats.invalid} ${draftStats.invalid === 1 ? "cell needs" : "cells need"} correcting. ` : ""}{draftStats.stale ? `${draftStats.stale} changed on the server since you started; review them. ` : ""}{draftStats.waiting ? `${draftStats.waiting} ${draftStats.waiting === 1 ? "waits" : "wait"} for the outcome of an earlier save. ` : ""}Changes stay in this tab until you save or discard them.</p>
      </div>
      {draftStats.stale > 0 && Object.entries(openDrafts).filter(([id, draft]) => !locked.has(id) && draftIsStale(draft.baseVersion, byId.get(id))).slice(0, 3).map(([id]) => <span key={id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <strong className={styles.idCell}>{id}</strong>
        <button type="button" className={styles.btn} onClick={() => rebase(id)} title="Keep your edited fields and apply them to the latest saved record">Keep my changes</button>
        <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => discardDraft(id)}>Discard</button>
      </span>)}
      <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={() => setDrafts({})}>Discard all</button>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openReview}>Review and save</button>
    </div> : <div className={styles.gridFoot}>
      <span><strong style={{ color: "var(--foreground)" }}>{rows.length}</strong> {rows.length === 1 ? "battery" : "batteries"}{selected.size ? ` · ${selected.size} selected` : ""}</span>
      {selected.size > 0 && <button type="button" className={styles.link} onClick={() => setSelected(new Set())}>Clear selection</button>}
      <span className={styles.toolbarGap} />
      <span><span className={styles.kbd}>↑</span> <span className={styles.kbd}>↓</span> move · <span className={styles.kbd}>Space</span> select · <span className={styles.kbd}>Enter</span> open{canEdit ? <> · <span className={styles.kbd}>F2</span> edit</> : null}</span>
    </div>}
    </div>

    {inspected && <BatteryInspector battery={inspected} snapshot={snapshot} revision={revision} now={now} canEdit={canEdit}
      onClose={() => setInspectedId(null)} onOpenRecord={() => onOpenRecord(inspected)}
      onExport={() => onExport({ batteryId: inspected.id, filter, page: 0, pageSize: "100", matching: 1, pageCount: 1 })}
      onEdit={() => { setEditMode(true); setFocusedId(inspected.id); }} />}

    {review && <EditReviewDialog items={review.items} snapshot={snapshot} results={edits.results} running={edits.running} submitted={review.submitted} submitError={review.error}
      onSubmit={() => void submitReview()} onClose={closeReview} onRetry={(id) => void edits.retry(id)} onCheck={(id) => void edits.check(id)} />}
  </div>;
}
