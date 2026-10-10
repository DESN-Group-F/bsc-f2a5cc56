"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, ChevronDown, DoorOpen, Info, Layers2, Map as MapIcon, Maximize, Settings2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MotionDisclosure } from "@/components/ui/workspace-motion";
import type { BatteryRecord, InventorySnapshot } from "@/lib/domain";
import type { EditorDraft, ExportDraft } from "@/lib/client/inventory-contracts";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { formatTime } from "@/lib/client-utils";
import { REFERENCE_BUILDINGS, SUPPORTED_BUILDING_ID } from "@/lib/location-catalog";
import { getMappingRooms, mappingBucket, UNKNOWN_MAPPING_ROOM } from "@/lib/inventory-mapping";
import { InventoryTable } from "./inventory-table";
import { MappingRoomDrawing } from "./mapping-room-drawing";
import styles from "./mapping-workspace.module.css";

const OVERVIEW = "__overview";
type OpenRoom = { id: string; label: string };
type RoomSummary = OpenRoom & { placeholder: boolean; unknown: boolean; batteries: BatteryRecord[] };

export type MappingWorkspaceProps = {
  data: InventorySnapshot;
  ready: boolean;
  active?: boolean;
  overlayOpen?: boolean;
  onMovement: (kind: "checkout" | "return", ids: string[]) => void;
  onScan?: (kind: "checkout" | "return") => void;
  onEdit: (draft: EditorDraft) => void;
  onDetail: (id: string, mappingRoom?: string) => void;
  onSetup: () => void;
  onExport: (draft: ExportDraft) => void;
  onGroupsChanged?: () => Promise<void>;
  onGroupDialogChange?: (open: boolean) => void;
  onOpenGroups?: () => void;
  onRemoval?: (ids: string[]) => void;
  onLocationTools?: () => void;
};

function recordedTime(battery: BatteryRecord) {
  const time = battery.observedAt ? Date.parse(battery.observedAt) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

export function MappingWorkspace({
  data, ready, active = true, overlayOpen = false, onMovement, onScan, onEdit,
  onDetail, onSetup, onExport, onGroupsChanged, onGroupDialogChange,
  onOpenGroups, onRemoval, onLocationTools,
}: MappingWorkspaceProps) {
  const prefix = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [activeTab, setActiveTab] = useState(OVERVIEW);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const roomButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusTab = useRef<string | null>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const rooms = getMappingRooms(data.rooms);
  const activeBatteries = data.batteries.filter(isActiveBattery);
  const buckets = new Map<string, BatteryRecord[]>(rooms.map(room => [room.id, []]));
  buckets.set(UNKNOWN_MAPPING_ROOM, []);
  for (const battery of activeBatteries) (buckets.get(mappingBucket(battery, data.rooms)) ?? buckets.get(UNKNOWN_MAPPING_ROOM)!).push(battery);
  const summaries: RoomSummary[] = [
    ...rooms.map(room => ({ id: room.id, label: room.name, placeholder: room.isPlaceholder, unknown: false, batteries: buckets.get(room.id) ?? [] })),
    { id: UNKNOWN_MAPPING_ROOM, label: "Unknown", placeholder: false, unknown: true, batteries: buckets.get(UNKNOWN_MAPPING_ROOM) ?? [] },
  ];
  const selected = summaries.find(room => room.id === selectedId);
  const selectedPreview = selected ? [...selected.batteries].sort((left, right) => recordedTime(right) - recordedTime(left) || left.id.localeCompare(right.id, "en", { numeric: true })).slice(0, 3) : [];
  const selectedInUse = selected?.batteries.filter(battery => battery.loanId).length ?? 0;
  const filterId = `${prefix}-building-filter`;
  const tabId = (id: string) => `${prefix}-tab-${encodeURIComponent(id)}`;
  const panelId = (id: string) => `${prefix}-panel-${encodeURIComponent(id)}`;

  useLayoutEffect(() => {
    if (focusTab.current) {
      tabs.current.get(focusTab.current)?.focus({ preventScroll: true });
      focusTab.current = null;
    }
  }, [activeTab, openRooms]);

  function activateTab(id: string) {
    if (overlayOpen) return;
    focusTab.current = id;
    setActiveTab(id);
    // Re-selecting the active tab does not produce another render.
    if (activeTab === id) {
      tabs.current.get(id)?.focus({ preventScroll: true });
      focusTab.current = null;
    }
  }

  function openDetails() {
    if (!selected || overlayOpen) return;
    if (!openRooms.some(room => room.id === selected.id)) {
      setOpenRooms(previous => [...previous, { id: selected.id, label: selected.label }]);
    }
    activateTab(selected.id);
  }

  function closeRoom(id: string) {
    if (overlayOpen) return;
    const index = openRooms.findIndex(room => room.id === id);
    if (index < 0) return;
    const remaining = openRooms.filter(room => room.id !== id);
    const next = activeTab === id ? remaining[index - 1]?.id ?? remaining[index]?.id ?? OVERVIEW : activeTab;
    focusTab.current = next;
    setOpenRooms(remaining);
    setActiveTab(next);
  }

  function resetSelection() {
    if (overlayOpen) return;
    const previous = selectedId;
    setSelectedId(null);
    if (previous) roomButtons.current.get(previous)?.focus({ preventScroll: true });
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (overlayOpen) return;
    if (event.key === "Delete" && id !== OVERVIEW) { event.preventDefault(); closeRoom(id); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const ids = [OVERVIEW, ...openRooms.map(room => room.id)];
    const index = ids.indexOf(id);
    activateTab(event.key === "Home" ? ids[0] : event.key === "End" ? ids[ids.length - 1] : ids[(index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]);
  }

  return (
    <section className={styles.workspace} aria-label="Mapping workspace">
      <div className={styles.subbar} role="tablist" aria-label="Mapping workbench views">
        <button type="button" role="tab" className={styles.tab} id={tabId(OVERVIEW)} aria-controls={panelId(OVERVIEW)} aria-selected={activeTab === OVERVIEW} tabIndex={activeTab === OVERVIEW ? 0 : -1} disabled={overlayOpen} ref={element => { if (element) tabs.current.set(OVERVIEW, element); else tabs.current.delete(OVERVIEW); }} onClick={() => activateTab(OVERVIEW)} onKeyDown={event => navigateTabs(event, OVERVIEW)}>
          <MapIcon aria-hidden="true" />Overview
        </button>
        {openRooms.map(room => {
          const label = summaries.find(item => item.id === room.id)?.label ?? room.label;
          return <div className={styles.roomTab} key={room.id} data-active={activeTab === room.id} role="presentation">
            <button type="button" role="tab" className={styles.tab} id={tabId(room.id)} aria-controls={panelId(room.id)} aria-selected={activeTab === room.id} tabIndex={activeTab === room.id ? 0 : -1} disabled={overlayOpen} ref={element => { if (element) tabs.current.set(room.id, element); else tabs.current.delete(room.id); }} onClick={() => activateTab(room.id)} onKeyDown={event => navigateTabs(event, room.id)}>
              <DoorOpen aria-hidden="true" /><span>{label}</span>
            </button>
            <button type="button" className={styles.closeTab} onClick={() => closeRoom(room.id)} disabled={overlayOpen} aria-label={`Close ${label} tab`}><X aria-hidden="true" /></button>
          </div>;
        })}
        <span className={styles.subnote}>Last observed locations</span>
      </div>

      <div role="tabpanel" id={panelId(OVERVIEW)} aria-labelledby={tabId(OVERVIEW)} hidden={activeTab !== OVERVIEW}>
        <div className={styles.toolbar}>
          <Button ref={filterButton} variant="outline" className={filterOpen ? styles.filterActive : undefined} disabled={overlayOpen} aria-expanded={filterOpen} aria-controls={filterId} onClick={() => setFilterOpen(value => !value)}><SlidersHorizontal size={15} aria-hidden="true" />Filter<ChevronDown size={14} aria-hidden="true" /></Button>
          <span className={styles.buildingChip}><Building2 aria-hidden="true" />J18 · Willis Annexe</span>
          <span className={styles.total}>{rooms.length} {rooms.length === 1 ? "room" : "rooms"} · {activeBatteries.length} active batteries</span>
          {onLocationTools && <Button variant="ghost" disabled={overlayOpen} onClick={onLocationTools}><Settings2 size={15} aria-hidden="true" />Location setup</Button>}
        </div>
        <MotionDisclosure open={filterOpen} id={filterId}>
          <div className={styles.filters}>
            <span className={styles.filterLabel}>Building</span>
            {REFERENCE_BUILDINGS.map(building => <button key={building.id} type="button" className={styles.building} aria-pressed={building.id === SUPPORTED_BUILDING_ID} disabled={building.id !== SUPPORTED_BUILDING_ID || overlayOpen} onClick={() => filterButton.current?.focus({ preventScroll: true })}>
              <Building2 aria-hidden="true" /><span>{building.id}<small>{building.name}{building.id !== SUPPORTED_BUILDING_ID && " · unavailable"}</small></span>{building.id === SUPPORTED_BUILDING_ID && <Check aria-hidden="true" />}
            </button>)}
            <Button variant="ghost" className={styles.clearFilters} disabled={overlayOpen} onClick={() => { setFilterOpen(false); filterButton.current?.focus({ preventScroll: true }); }}>Clear filters</Button>
          </div>
        </MotionDisclosure>
        <div className={styles.mapLayout} data-selected={!!selected}>
          <div className={styles.canvas} aria-label="Schematic last observed room locations">
            <div className={styles.canvasLabel}><Layers2 aria-hidden="true" /><span>J18 / LAST OBSERVED LOCATIONS</span></div>
            {selected && <Button variant="ghost" size="sm" className={styles.reset} onClick={resetSelection} disabled={overlayOpen}><Maximize size={14} aria-hidden="true" />Reset view</Button>}
            <div className={styles.ground} aria-hidden="true" />
            <div className={summaries.length > 4 ? styles.roomGrid : styles.roomLayer}>
              {summaries.map((room, index) => <button key={room.id} type="button" className={styles.room} data-position={index} data-unknown={room.unknown} aria-pressed={selectedId === room.id} aria-label={`${room.label}${room.placeholder ? ", placeholder" : ""}, ${room.batteries.length} ${room.unknown ? "without a mapped last observation" : "last observed here"}`} disabled={overlayOpen} ref={element => { if (element) roomButtons.current.set(room.id, element); else roomButtons.current.delete(room.id); }} onClick={() => setSelectedId(previous => previous === room.id ? null : room.id)}>
                <div className={styles.roomVisual}><MappingRoomDrawing unknown={room.unknown} /></div>
                <span className={styles.roomLabel}><strong>{room.label}</strong><small>{room.placeholder ? "Placeholder · " : ""}{room.batteries.length} {room.unknown ? "without a mapped observation" : "last observed here"}</small></span>
              </button>)}
            </div>
            <p className={styles.canvasFoot}>Schematic arrangement · Recorded observations do not confirm current battery locations.</p>
          </div>
          <aside className={styles.inspector} aria-label="Selected room summary" inert={!selected} aria-hidden={!selected}>
            <div className={styles.inspectorContent}>
              {selected && <>
                <div className={styles.inspectorHeading}><div><span className={styles.eyebrow}>{selected.unknown ? "No mapped last observation" : "J18 · Last observed location"}</span><h2>{selected.label}</h2>{selected.placeholder && <p className={styles.caption}>Placeholder room · not a verified physical location</p>}</div><Button variant="ghost" size="icon-sm" disabled={overlayOpen} onClick={resetSelection} aria-label="Close room summary"><X size={16} aria-hidden="true" /></Button></div>
                <div className={styles.count}><strong>{selected.batteries.length}</strong><span>{selected.unknown ? "without a mapped observation" : "last observed here"}</span></div>
                <div><dl className={styles.stats}><div><dt>In store</dt><dd>{selected.batteries.length - selectedInUse}</dd></div><div><dt>In use</dt><dd>{selectedInUse}</dd></div></dl><p className={styles.caption}>Loan status, not physical presence.</p></div>
                <div><span className={styles.eyebrow}>{selected.unknown ? "Records to review" : "Latest recorded evidence"}</span>
                  {selectedPreview.map(battery => <div className={styles.previewRow} key={battery.id}><button type="button" className={styles.previewLink} disabled={overlayOpen} onClick={() => onDetail(battery.id, selected.id)}>{battery.id}</button><span className={styles.status} data-in-use={!!battery.loanId}>{battery.loanId ? "In use" : "In store"}</span><span className={styles.evidence}>{battery.observedAt ? <>{battery.observedRoom || "Original room label unavailable"}<br />{Number.isFinite(recordedTime(battery)) ? formatTime(battery.observedAt) : "Observation time unavailable"} · {battery.observationSource || "Source not recorded"}</> : "No location observation recorded"}</span></div>)}
                  {!selected.batteries.length && <p className={styles.caption}>{selected.unknown ? "Every active battery has a usable mapped last observation." : "No active battery has its latest recorded observation assigned to this room."}</p>}
                </div>
                {selected.unknown && <p className={styles.caption}>Includes missing observations and rooms outside this map. Known observations outside this map remain in history. Registered home is never used to infer a location.</p>}
                <Button className={styles.viewDetails} disabled={overlayOpen} onClick={openDetails}>View details<ArrowRight size={16} aria-hidden="true" /></Button>
              </>}
            </div>
          </aside>
        </div>
      </div>

      {openRooms.map(room => {
        const summary = summaries.find(item => item.id === room.id);
        const label = summary?.label ?? room.label;
        const visible = active && activeTab === room.id;
        return <div key={room.id} className={styles.detail} role="tabpanel" id={panelId(room.id)} aria-labelledby={tabId(room.id)} hidden={activeTab !== room.id}>
          <div className={styles.detailHeader}><div><h2>{label}</h2><p>{room.id === UNKNOWN_MAPPING_ROOM ? "Batteries without a usable mapped last observation." : "J18 · Latest recorded observations"}{summary?.placeholder && " · Placeholder room"}</p></div><Button variant="ghost" disabled={overlayOpen} onClick={() => activateTab(OVERVIEW)}><ArrowLeft size={16} aria-hidden="true" />Back to mapping</Button></div>
          {!summary && <p className="form-error" role="alert">This room is no longer available in the J18 map. Its original evidence remains in battery history.</p>}
          <InventoryTable data={data} ready={ready && !!summary} mappingRoom={room.id} active={visible} overlayOpen={overlayOpen} onMovement={onMovement} onScan={onScan} onEdit={onEdit} onDetail={id => onDetail(id, room.id)} onSetup={onSetup} onExport={onExport} onGroupsChanged={onGroupsChanged} onGroupDialogChange={onGroupDialogChange} onOpenGroups={onOpenGroups} onRemoval={onRemoval} />
        </div>;
      })}
      <div className={styles.footer}><Info aria-hidden="true" /><p>Latest saved observations only; no live location feed. Room shapes are schematic. {data.dataset === "demo" ? "Demonstration evidence retains its recorded source." : "Unknown locations remain unknown."}</p></div>
    </section>
  );
}
