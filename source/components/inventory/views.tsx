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
import { actionNames, csvCell, formatTime } from "@/lib/client-utils";
export type ImportKind = "people" | "rooms" | "batteries";
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
    const [filter, setFilter] = useState("all"), [room, setRoom] = useState("all"), [search, setSearch] = useState("");
    const [selection, setSelection] = useState<{
        revision: number;
        ids: string[];
    }>({ revision, ids: [] });
    const selected = selection.revision === revision ? selection.ids : [];
    function setSelected(value: string[] | ((old: string[]) => string[])) { setSelection(old => ({ revision, ids: typeof value === "function" ? value(old.revision === revision ? old.ids : []) : value })); }
    const batteries = data.batteries, onLoan = batteries.filter(b => b.loanId).length;
    const matching = batteries.filter(b => (filter === "all" || (filter === "out" ? !!b.loanId : !b.loanId)) && (room === "all" || b.homeRoomId === room) && `${b.id} ${b.name} ${b.chemistry} ${b.tagId ?? ""} ${b.ownerName} ${b.borrowerName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
    function selectAll(checked: boolean) { setSelected(checked ? [...new Set([...selected, ...matching.map(b => b.id)])] : selected.filter(id => !matching.some(b => b.id === id))); }
    function exportInventory() {
        const fields = ["battery_id", "name", "status", "responsible_owner", "current_borrower", "registered_storage_room", "last_observed_room", "last_observed_building", "observation_room_snapshot", "observed_at_utc", "observation_source", "last_charge_completed_utc", "recorded_charge_percentage"];
        const rows = matching.map(b => [b.id, b.name, b.loanId ? "On loan" : "In store", b.ownerName, b.borrowerName, b.homeRoomName, b.observedRoom, b.observedBuilding, b.observationRoomSnapshot, b.observedAt, b.observationSource, b.chargedAt, b.chargePercentage]);
        const blob = new Blob(["\uFEFF", [fields, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url;
        link.download = `battery-inventory-${data.dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <><div className="summary-grid">{[["Registered batteries", batteries.length, "Across all registered storage rooms"], ["In store", batteries.length - onLoan, "No active loan recorded"], ["On loan", onLoan, "Linked to a current borrower"]].map(([label, count, note]) => <div className="summary-card" key={label}><span>{label}</span><strong>{count}</strong><p>{note}</p></div>)}</div>
    <section className="inventory-panel" aria-label="Battery inventory records"><div className="panel-top"><Tabs value={filter} onValueChange={setFilter}><TabsList variant="line"><TabsTrigger value="all">All batteries <span className="tab-count">{batteries.length}</span></TabsTrigger><TabsTrigger value="in">In store <span className="tab-count">{batteries.length - onLoan}</span></TabsTrigger><TabsTrigger value="out">On loan <span className="tab-count">{onLoan}</span></TabsTrigger></TabsList></Tabs><Button variant="outline" onClick={() => onEdit({ kind: "battery" })} disabled={!ready}><Plus />Register battery</Button></div>
    <div className="table-toolbar"><div className="search-field"><Search size={18}/><Input aria-label="Search batteries" placeholder="Search ID, name, tag, owner or borrower…" value={search} onChange={e => setSearch(e.target.value)}/></div><Select value={room} onValueChange={setRoom}><SelectTrigger aria-label="Filter by registered storage room" className="room-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All storage rooms</SelectItem>{data.rooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select><Button variant="ghost" onClick={exportInventory} disabled={!matching.length} aria-label="Export filtered inventory"><Download size={16}/><span>Export</span></Button><span className="toolbar-meta">{matching.length} batteries</span></div>
    {!!selected.length && <div className="selection-toolbar"><strong>{selected.length} selected</strong><Button variant="outline" size="sm" onClick={() => onMovement("checkout", selected)} disabled={!ready || selected.some(id => batteries.find(b => b.id === id)?.loanId)}>Check out selected</Button><Button variant="outline" size="sm" onClick={() => onMovement("return", selected)} disabled={!ready || selected.some(id => !batteries.find(b => b.id === id)?.loanId)}>Return selected</Button><Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear selection</Button></div>}
    <Table><TableHeader><TableRow><TableHead className="checkbox-cell"><Checkbox aria-label="Select all visible batteries" checked={matching.length > 0 && matching.every(b => selected.includes(b.id)) ? true : matching.some(b => selected.includes(b.id)) ? "indeterminate" : false} disabled={!matching.length || !ready} onCheckedChange={v => selectAll(v === true)}/></TableHead><TableHead>BATTERY</TableHead><TableHead>STATUS</TableHead><TableHead>RESPONSIBLE OWNER</TableHead><TableHead>CURRENT BORROWER</TableHead><TableHead>STORAGE ROOM</TableHead><TableHead>LAST OBSERVED</TableHead></TableRow></TableHeader><TableBody>{matching.map(b => <TableRow key={b.id} data-selected={selected.includes(b.id)}><TableCell className="checkbox-cell"><Checkbox aria-label={`Select ${b.id}`} checked={selected.includes(b.id)} disabled={!ready} onCheckedChange={v => setSelected(s => v ? [...s, b.id] : s.filter(id => id !== b.id))}/></TableCell><TableCell><div className="battery-cell"><span className="battery-icon"><Battery size={19}/></span><div><button className="record-link" onClick={() => onDetail(b.id)} aria-label={`View ${b.id}`}>{b.id}</button><span>{b.name}</span><small>{b.chemistry || "Chemistry not recorded"}{b.capacityMah != null ? ` · ${b.capacityMah.toLocaleString()} mAh` : ""}</small></div></div></TableCell><TableCell><span className={`status-badge ${b.loanId ? "out" : "in"}`}>{b.loanId ? "On loan" : "In store"}</span></TableCell><TableCell>{b.ownerName}</TableCell><TableCell>{b.borrowerName || <span className="muted">—</span>}</TableCell><TableCell>{b.homeRoomName}</TableCell><TableCell>{b.observedAt ? <><strong>{b.observedRoom}</strong><span className="cell-secondary">{formatTime(b.observedAt)}</span><span className="cell-secondary">{b.observationSource}</span></> : <span className="muted">Not yet observed</span>}</TableCell></TableRow>)}</TableBody></Table>
    {!matching.length && <div className="empty-state"><Package /><h3>{batteries.length ? "No matching batteries" : "No batteries registered"}</h3><p>{batteries.length ? "Adjust the search, status or storage-room filter." : "Register a staff owner and storage room, then add a battery."}</p>{!batteries.length && <Button variant="outline" onClick={onSetup}>Set up records</Button>}</div>}
    <div className="panel-footer"><span>Storage room is the registered home. Last observed room records detection evidence separately.</span><span>{batteries.length} registered batteries</span></div></section>
  </>;
}
export function RecordManagement({ data, ready, onEdit, onDetail, onImport }: RecordActions & {
    onImport: (kind: ImportKind) => void;
}) {
    const [kind, setKind] = useState<ImportKind>("people");
    const records = kind === "people" ? data.people : kind === "rooms" ? data.rooms : data.batteries;
    return <section className="inventory-panel"><div className="panel-top"><Tabs value={kind} onValueChange={v => setKind(v as ImportKind)}><TabsList variant="line"><TabsTrigger value="people">People</TabsTrigger><TabsTrigger value="rooms">Rooms</TabsTrigger><TabsTrigger value="batteries">Batteries</TabsTrigger></TabsList></Tabs><div className="panel-actions"><Button variant="outline" onClick={() => onImport(kind)} disabled={!ready}><Upload />Import CSV</Button><Button onClick={() => onEdit({ kind: kind === "people" ? "person" : kind === "rooms" ? "room" : "battery" })} disabled={!ready}><Plus />Register {kind === "people" ? "person" : kind === "rooms" ? "room" : "battery"}</Button></div></div>
    {kind === "people" ? <Table><TableHeader><TableRow><TableHead>PERSON</TableHead><TableHead>REFERENCE</TableHead><TableHead>RECORD ROLE</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.people.map(p => <TableRow key={p.id}><TableCell><strong>{p.name}</strong><span className="cell-secondary">{p.id}</span></TableCell><TableCell>{p.reference || "Not recorded"}</TableCell><TableCell>{p.role === "staff" ? "Staff / responsible owner" : "Borrower"}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "person", record: p })} disabled={!ready} aria-label={`Edit ${p.name}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table> : kind === "rooms" ? <Table><TableHeader><TableRow><TableHead>ROOM</TableHead><TableHead>BUILDING</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.rooms.map(r => <TableRow key={r.id}><TableCell><strong>{r.name}</strong><span className="cell-secondary">{r.id}</span></TableCell><TableCell>{r.building || "Not recorded"}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "room", record: r })} disabled={!ready} aria-label={`Edit ${r.name}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table> : <Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>RFID IDENTIFIER</TableHead><TableHead>OWNER / STORAGE ROOM</TableHead><TableHead>ACTIONS</TableHead></TableRow></TableHeader><TableBody>{data.batteries.map(b => <TableRow key={b.id}><TableCell><button className="record-link" onClick={() => onDetail(b.id)}>{b.id}</button><span className="cell-secondary">{b.name}</span></TableCell><TableCell>{b.tagId || "Not assigned"}</TableCell><TableCell>{b.ownerName}<span className="cell-secondary">{b.homeRoomName}</span></TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "battery", record: b })} disabled={!ready} aria-label={`Edit ${b.id}`}><Pencil />Edit</Button></TableCell></TableRow>)}</TableBody></Table>}
    {!records.length && <div className="empty-state"><Settings2 /><h3>No {kind} registered</h3><p>Use the registration form or review a CSV import.</p></div>}
    <div className="panel-footer"><span>People are inventory records. Staff own batteries; registered people can borrow them.</span></div>
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
    const text = typeof d.reason === "string" ? `Reason: ${d.reason}` : typeof d.borrower === "string" ? `Borrower: ${d.borrower}` : event.action === "records_imported" ? `${d.count} ${d.kind} imported` : typeof d.room === "string" ? `${d.room} · ${d.source}` : event.action === "charge_recorded" ? `Completed ${formatTime(String(d.completedAt))} · ${d.percentage == null ? "percentage not recorded" : `${d.percentage}%`}` : after?.name ? `${after.name} · ${after.id}` : typeof d.note === "string" ? d.note : "";
    return text ? <span className="cell-secondary">{text}</span> : null;
}
