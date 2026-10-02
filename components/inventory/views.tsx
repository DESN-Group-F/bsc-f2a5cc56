"use client";
import { useState } from "react";
import { Battery, Package, Search, Plus, Download, Upload, Pencil, Settings2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { InventorySnapshot, AuditEvent } from "@/lib/domain";
import type { EditorDraft } from "./record-editor";
import { actionNames, csvCell, formatTime, buildingLabel, roomLabel, storageRoomLabel, durationLabel } from "@/lib/client-utils";
export type ImportKind = "people" | "buildings" | "rooms" | "batteries";
type RecordActions = {
    data: InventorySnapshot;
    ready: boolean;
    onEdit: (draft: EditorDraft) => void;
    onDetail: (id: string) => void;
};
export function InventoryTable({ data, ready, onMovement, onEdit, onDetail, onSetup, revision }: RecordActions & {
    onMovement: (kind: "checkout" | "return", ids: string[]) => void;
    onSetup: () => void;
    revision: number;
}) {
    const [filter, setFilter] = useState("all"), [building, setBuilding] = useState("all"), [room, setRoom] = useState("all"), [search, setSearch] = useState("");
    const [selection, setSelection] = useState<{
        revision: number;
        ids: string[];
    }>({ revision, ids: [] });
    const selected = selection.revision === revision ? selection.ids : [];
    function setSelected(value: string[] | ((old: string[]) => string[])) { setSelection(old => ({ revision, ids: typeof value === "function" ? value(old.revision === revision ? old.ids : []) : value })); }
    const batteries = data.batteries, onLoan = batteries.filter(b => b.loanId).length;
    const matching = batteries.filter(b => (filter === "all" || (filter === "out" ? !!b.loanId : !b.loanId)) && (building === "all" || b.homeBuildingId === building) && (room === "all" || (room === "__unspecified" ? !b.homeRoomId : b.homeRoomId === room)) && `${b.id} ${b.name} ${b.chemistry} ${b.tagId ?? ""} ${b.ownerName} ${b.borrowerName ?? ""} ${b.homeBuildingId ?? ""} ${b.homeRoomNumber ?? ""}`.toLowerCase().includes(search.toLowerCase()));
    function selectAll(checked: boolean) { setSelected(checked ? [...new Set([...selected, ...matching.map(b => b.id)])] : selected.filter(id => !matching.some(b => b.id === id))); }
    function exportInventory() {
        const fields = ["battery_id", "name", "status", "responsible_owner", "current_borrower", "storage_building_code", "storage_building_name", "storage_room_id", "storage_room_number", "storage_room_name", "last_observed_room", "last_observed_building", "observation_room_snapshot", "observed_at_utc", "observation_source", "last_charge_completed_utc", "last_charge_duration_minutes"];
        const rows = matching.map(b => [b.id, b.name, b.loanId ? "On loan" : "In store", b.ownerName, b.borrowerName, b.homeBuildingId, b.homeBuildingName, b.homeRoomId, b.homeRoomNumber, b.homeRoomName, b.observedRoom, b.observedBuilding, b.observationRoomSnapshot, b.observedAt, b.observationSource, b.chargedAt, b.chargeDurationMinutes]);
        const blob = new Blob(["\uFEFF", [fields, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url;
        link.download = `battery-inventory-${data.dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <><div className="summary-grid">{[["Registered batteries", batteries.length, "Across registered storage locations"], ["In store", batteries.length - onLoan, "No active loan recorded"], ["On loan", onLoan, "Linked to a current borrower"]].map(([label, count, note]) => <div className="summary-card" key={label}><span>{label}</span><strong>{count}</strong><p>{note}</p></div>)}</div>
    <section className="inventory-panel" aria-label="Battery inventory records"><div className="panel-top"><Tabs value={filter} onValueChange={setFilter}><TabsList variant="line"><TabsTrigger value="all">All batteries <span className="tab-count">{batteries.length}</span></TabsTrigger><TabsTrigger value="in">In store <span className="tab-count">{batteries.length - onLoan}</span></TabsTrigger><TabsTrigger value="out">On loan <span className="tab-count">{onLoan}</span></TabsTrigger></TabsList></Tabs><Button variant="outline" onClick={() => onEdit({ kind: "battery" })} disabled={!ready}><Plus />Register battery</Button></div>
    <div className="table-toolbar"><div className="search-field"><Search size={18}/><Input aria-label="Search batteries" placeholder="Search batteries, people or location…" value={search} onChange={e => setSearch(e.target.value)}/></div><Select value={building} onValueChange={v => { setBuilding(v); setRoom("all"); }}><SelectTrigger aria-label="Filter by storage building" className="room-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All buildings</SelectItem>{data.buildings.map(b => <SelectItem key={b.id} value={b.id}>{buildingLabel(b)}</SelectItem>)}</SelectContent></Select><Select value={room} onValueChange={setRoom}><SelectTrigger aria-label="Filter by registered storage room" className="room-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All storage rooms</SelectItem><SelectItem value="__unspecified">Room not specified</SelectItem>{data.rooms.filter(r => building === "all" || r.buildingId === building).map(r => <SelectItem key={r.id} value={r.id}>{building === "all" && r.buildingId ? `${r.buildingId} / ` : ""}{roomLabel(r)}</SelectItem>)}</SelectContent></Select><Button variant="ghost" onClick={exportInventory} disabled={!matching.length} aria-label="Export filtered inventory"><Download size={16}/><span>Export</span></Button><span className="toolbar-meta">{matching.length} batteries</span></div>
    {!!selected.length && <div className="selection-toolbar"><strong>{selected.length} selected</strong><Button variant="outline" size="sm" onClick={() => onMovement("checkout", selected)} disabled={!ready || selected.some(id => batteries.find(b => b.id === id)?.loanId)}>Check out selected</Button><Button variant="outline" size="sm" onClick={() => onMovement("return", selected)} disabled={!ready || selected.some(id => !batteries.find(b => b.id === id)?.loanId)}>Return selected</Button><Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear selection</Button></div>}
    <Table><TableHeader><TableRow><TableHead className="checkbox-cell"><Checkbox aria-label="Select all visible batteries" checked={matching.length > 0 && matching.every(b => selected.includes(b.id)) ? true : matching.some(b => selected.includes(b.id)) ? "indeterminate" : false} disabled={!matching.length || !ready} onCheckedChange={v => selectAll(v === true)}/></TableHead><TableHead>BATTERY</TableHead><TableHead>STATUS</TableHead><TableHead>RESPONSIBLE OWNER</TableHead><TableHead>CURRENT BORROWER</TableHead><TableHead>STORAGE LOCATION</TableHead><TableHead>LAST OBSERVED</TableHead></TableRow></TableHeader><TableBody>{matching.map(b => <TableRow key={b.id} data-selected={selected.includes(b.id)}><TableCell className="checkbox-cell"><Checkbox aria-label={`Select ${b.id}`} checked={selected.includes(b.id)} disabled={!ready} onCheckedChange={v => setSelected(s => v ? [...s, b.id] : s.filter(id => id !== b.id))}/></TableCell><TableCell><div className="battery-cell"><span className="battery-icon"><Battery size={19}/></span><div><button className="record-link" onClick={() => onDetail(b.id)} aria-label={`View ${b.id}`}>{b.id}</button><span>{b.name}</span><small>{b.chemistry || "Chemistry not recorded"}{b.capacityMah != null ? ` · ${b.capacityMah.toLocaleString()} mAh` : ""}</small></div></div></TableCell><TableCell><span className={`status-badge ${b.loanId ? "out" : "in"}`}>{b.loanId ? "On loan" : "In store"}</span></TableCell><TableCell>{b.ownerName}</TableCell><TableCell>{b.borrowerName || <span className="muted">—</span>}</TableCell><TableCell><strong>{b.homeBuildingId ? buildingLabel({ id: b.homeBuildingId, name: b.homeBuildingName! }) : "Building not assigned"}</strong><span className="cell-secondary">{storageRoomLabel(b)}</span></TableCell><TableCell>{b.observedAt ? <><strong>{b.observedRoom}</strong>{b.observedBuilding && <span className="cell-secondary">{b.observedBuilding}</span>}<span className="cell-secondary">{formatTime(b.observedAt)}</span><span className="cell-secondary">{b.observationSource}</span></> : <span className="muted">Not yet observed</span>}</TableCell></TableRow>)}</TableBody></Table>
    {!matching.length && <div className="empty-state"><Package /><h3>{batteries.length ? "No matching batteries" : "No batteries registered"}</h3><p>{batteries.length ? "Adjust the search, status or location filters." : "Register a staff owner, then add a battery in J18. Its room can stay unspecified."}</p>{!batteries.length && <Button variant="outline" onClick={onSetup}>Set up records</Button>}</div>}
    <div className="panel-footer"><span>Storage building and room are the registered home. Last observed location is separate, dated evidence.</span><span>{batteries.length} registered batteries</span></div></section>
  </>;
}
export function RecordManagement({ data, ready, onEdit, onDetail, onImport }: RecordActions & {
    onImport: (kind: ImportKind) => void;
}) {
    const [kind, setKind] = useState<ImportKind>("people");
    const records = kind === "people" ? data.people : kind === "buildings" ? data.buildings : kind === "rooms" ? data.rooms : data.batteries;
    const editorKind = kind === "people" ? "person" : kind === "buildings" ? "building" : kind === "rooms" ? "room" : "battery";
    return <section className="inventory-panel"><div className="panel-top"><Tabs value={kind} onValueChange={v => setKind(v as ImportKind)}><TabsList variant="line"><TabsTrigger value="people">People</TabsTrigger><TabsTrigger value="buildings">Buildings</TabsTrigger><TabsTrigger value="rooms">Rooms</TabsTrigger><TabsTrigger value="batteries">Batteries</TabsTrigger></TabsList></Tabs><div className="panel-actions"><Button variant="outline" onClick={() => onImport(kind)} disabled={!ready}><Upload />Import CSV</Button><Button onClick={() => onEdit({ kind: editorKind })} disabled={!ready}><Plus />Register {editorKind}</Button></div></div>
    {kind === "people" ? <Table><TableHeader><TableRow><TableHead>PERSON</TableHead><TableHead>REFERENCE</TableHead><TableHead>RECORD ROLE</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.people.map(p => <TableRow key={p.id}><TableCell><strong>{p.name}</strong><span className="cell-secondary">{p.id}</span></TableCell><TableCell>{p.reference || "Not recorded"}</TableCell><TableCell>{p.role === "staff" ? "Staff / responsible owner" : "Borrower"}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "person", record: p })} disabled={!ready} aria-label={`Edit ${p.name}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table> : kind === "buildings" ? <Table><TableHeader><TableRow><TableHead>BUILDING CODE</TableHead><TableHead>NAME</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.buildings.map(b => <TableRow key={b.id}><TableCell><strong>{b.id}</strong></TableCell><TableCell>{b.name}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "building", record: b })} disabled={!ready} aria-label={`Edit ${b.id}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table> : kind === "rooms" ? <Table><TableHeader><TableRow><TableHead>ROOM</TableHead><TableHead>BUILDING</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.rooms.map(r => <TableRow key={r.id}><TableCell><strong>{roomLabel(r)}</strong><span className="cell-secondary">{r.id}</span></TableCell><TableCell>{r.buildingId ? r.building : "Building not assigned"}{!r.buildingId && r.building && <span className="cell-secondary">Legacy label: {r.building}</span>}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "room", record: r })} disabled={!ready} aria-label={`Edit ${r.name}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table> : <Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>RFID IDENTIFIER</TableHead><TableHead>OWNER / STORAGE LOCATION</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.batteries.map(b => <TableRow key={b.id}><TableCell><button className="record-link" onClick={() => onDetail(b.id)}>{b.id}</button><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{b.tagId || "Not assigned"}</TableCell><TableCell>{b.ownerName}<span className="cell-secondary">{b.homeBuildingId || "Building not assigned"} / {storageRoomLabel(b)}</span></TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "battery", record: b })} disabled={!ready} aria-label={`Edit ${b.id}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table>}
    {!records.length && <div className="empty-state"><Settings2 /><h3>No {kind} registered</h3><p>Use the registration form or review a CSV import.</p></div>}
    <div className="panel-footer"><span>{kind === "buildings" || kind === "rooms" ? "J18 is the initial target. Register only confirmed rooms; a battery's room can remain unspecified." : "People are inventory records. Staff own batteries; registered people can borrow them."}</span></div>
  </section>;
}
export function ActivityHistory({ data, onDetail }: {
    data: InventorySnapshot;
    onDetail: (id: string) => void;
}) {
    return <section className="inventory-panel"><div className="section-heading"><h2>Recorded activity</h2><span className="toolbar-meta">Latest {data.events.length} events · Sydney time</span></div><Table><TableHeader><TableRow><TableHead>ACTION / DETAILS</TableHead><TableHead>BATTERY</TableHead><TableHead>OPERATOR</TableHead><TableHead>RECORDED AT</TableHead></TableRow></TableHeader><TableBody>{data.events.map(event => <TableRow key={event.id}><TableCell><strong>{actionNames[event.action] ?? event.action}</strong><EventDescription event={event}/></TableCell><TableCell>{event.batteryId ? <button className="record-link" onClick={() => onDetail(event.batteryId!)}>{event.batteryId}</button> : "—"}</TableCell><TableCell>{event.actorName}</TableCell><TableCell>{formatTime(event.at)}</TableCell></TableRow>)}</TableBody></Table>{!data.events.length && <div className="empty-state"><ClipboardList /><h3>No activity recorded</h3><p>Registration, loans, charge records and corrections will appear here.</p></div>}<div className="panel-footer">Showing up to 200 recent events. Corrections preserve the original action in this history.</div></section>;
}
function EventDescription({ event }: {
    event: AuditEvent;
}) {
    const d = event.details, after = d.after as {
        id?: string;
        name?: string;
    } | undefined;
    const text = typeof d.reason === "string" ? `Reason: ${d.reason}` : typeof d.borrower === "string" ? `Borrower: ${d.borrower}` : event.action === "records_imported" ? `${d.count} ${d.kind} imported` : typeof d.room === "string" ? `${d.room} · ${d.source}` : event.action === "charge_recorded" ? `Completed ${formatTime(String(d.completedAt))} · ${durationLabel(typeof d.durationMinutes === "number" ? d.durationMinutes : null)}` : after?.name ? `${after.name} · ${after.id}` : typeof d.note === "string" ? d.note : "";
    return text ? <span className="cell-secondary">{text}</span> : null;
}
