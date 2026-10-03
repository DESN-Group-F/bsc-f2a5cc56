"use client";
import { isActiveBattery, batteryStatusLabel } from "@/lib/battery-lifecycle";
import { useEffect, useState, type MouseEvent } from "react";
import { Battery, Package, Plus, Download, Upload, Pencil, Settings2, ClipboardList, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { InventorySnapshot, AuditEvent } from "@/lib/domain";
import type { EditorDraft } from "./record-editor";
import { actionNames, formatTime, formatBatteryAge, buildingLabel, roomLabel, storageRoomLabel, durationLabel, reloadSessionPage, downloadExportAttachment } from "@/lib/client-utils";
import { filterBatteries, defaultInventoryFilter, inventoryFilterSchema, type InventoryFilter } from "@/lib/inventory-query";
import { currentSydneyDate } from "@/lib/battery-age";
import type { ExportDraft } from "./export-dialog";
import { AppliedFilters, appliedFilterChips, InventoryFilterPanel } from "./inventory-filter-panel";
import { isSupportedBuilding, isSelectableRoom } from "@/lib/location-catalog";
import { TeachingGroupsPanel } from "./teaching-groups-panel";
import { groupActivity, filterActivity } from "@/lib/group-activity";
import { ActivityExportDialog } from "./activity-export-dialog";
import type { TeachingGroup } from "@/lib/teaching-groups";
type ActivityScope = "all" | "mine";
async function downloadList(dataset: string, mode: string, search: string, kind?: string, activityScope?: ActivityScope) {
    const input = { dataset, mode, search, kind, ...(mode === "activity" ? { activityScope: activityScope ?? "all" } : {}) };
    await downloadExportAttachment(input, "csv", `battery-${kind ?? mode}-${dataset}.csv`);
}
export type ImportKind = "people" | "buildings" | "rooms" | "batteries";
type RecordActions = {
    data: InventorySnapshot;
    ready: boolean;
    onEdit: (draft: EditorDraft) => void;
    onDetail: (id: string) => void;
};
export function InventoryTable({ data, ready, onMovement, onEdit, onDetail, onSetup, onExport, onGroupsChanged, onGroupDialogChange, onOpenGroups, group, onRemoval, onGroupMaintenance, personalScope = "all" }: RecordActions & {
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
    const [savedFilters, setFilters] = useState<InventoryFilter>(() => ({ ...defaultInventoryFilter(), personalScope, ...(group ? { groupId: group.id, lifecycle: "all" as const } : {}) })), [filterOpen, setFilterOpen] = useState(false);
    const filters = { ...savedFilters, personalScope, ...(group ? { groupId: group.id } : {}) };
    const [selectedIds, setSelected] = useState<string[]>([]);
    const [page, setPage] = useState(0), [pageSize, setPageSize] = useState<"10" | "25" | "50" | "100">("25");
    const [groupEditor, setGroupEditor] = useState<{ ids: string[] } | null>(null), [groupNotice, setGroupNotice] = useState("");
    useEffect(() => { onGroupDialogChange?.(!!groupEditor); return () => { onGroupDialogChange?.(false); }; }, [groupEditor, onGroupDialogChange]);
    const batteries = data.batteries;
    const baseBatteries = filterBatteries(batteries, { ...defaultInventoryFilter(), personalScope, ...(group ? { groupId: group.id } : {}) }, currentSydneyDate(), data.user.id, data.teachingGroups ?? []);
    const onLoan = baseBatteries.filter(b => b.loanId).length;
    const knownIds = new Set(batteries.map(battery => battery.id));
    const selected = [...new Set(selectedIds)].filter(id => knownIds.has(id));
    const baseIds = new Set(filterBatteries(batteries, { personalScope, lifecycle: "all" }, currentSydneyDate(), data.user.id).map(battery => battery.id));
    const outsidePersonalScope = group ? selected.filter(id => !group.batteryIds.includes(id)) : personalScope === "all" ? [] : selected.filter(id => !baseIds.has(id));
    const selectionScopeChanged = outsidePersonalScope.length > 0;
    const validation = inventoryFilterSchema.safeParse(filters), asOfOn = currentSydneyDate();
    const groupMissing = !!filters.groupId && !data.teachingGroups?.some(group => group.id === filters.groupId && group.ownerAccountId === data.user.id && group.state === "active");
    const matching = validation.success && !groupMissing ? filterBatteries(batteries, validation.data, asOfOn, data.user.id, data.teachingGroups ?? []) : [];
    const allStatuses = validation.success && !groupMissing ? filterBatteries(batteries, { ...validation.data, status: "all" }, asOfOn, data.user.id, data.teachingGroups ?? []) : [];
    const matchingOnLoan = allStatuses.filter(b => isActiveBattery(b) && b.loanId).length; const matchingInStore = allStatuses.filter(b => isActiveBattery(b) && !b.loanId).length;
    const chips = appliedFilterChips(filters, data).filter(chip => !group || chip.key !== "group");
    const pageCount = Math.max(1, Math.ceil(matching.length / Number(pageSize))), currentPage = Math.min(page, pageCount - 1);
    const visible = matching.slice(currentPage * Number(pageSize), (currentPage + 1) * Number(pageSize));
    function selectAll(checked: boolean) { setSelected(checked ? [...new Set([...selected, ...visible.map(b => b.id)])] : selected.filter(id => !visible.some(b => b.id === id))); }
    function changeBatterySelection(id: string, checked?: boolean) {
        if (!ready) return;
        setSelected(previous => {
            const select = checked ?? !previous.includes(id);
            return select ? previous.includes(id) ? previous : [...previous, id] : previous.filter(value => value !== id);
        });
    }
    function selectBatteryRow(id: string, event: MouseEvent<HTMLTableRowElement>) {
        if (!ready || event.defaultPrevented || !(event.target instanceof Element)
            || event.target.closest('button, a, input, select, textarea, label, [role="checkbox"], [role="button"], [contenteditable="true"]')) return;
        const textSelection = window.getSelection();
        if (textSelection && !textSelection.isCollapsed && event.currentTarget.contains(textSelection.anchorNode)) return;
        changeBatterySelection(id);
    }
    function updateFilters(patch: Partial<InventoryFilter>) { setFilters(previous => ({ ...previous, ...patch })); setPage(0); }
    function clearFilters() { setFilters({ ...defaultInventoryFilter(), personalScope, ...(group ? { groupId: group.id, lifecycle: "all" as const } : {}) }); setPage(0); }
    function selectGroup(group: TeachingGroup) {
        const allowed = group.batteryIds.filter(id => knownIds.has(id) && baseIds.has(id));
        const excluded = group.batteryIds.length - allowed.length;
        setSelected(allowed); updateFilters({ groupId: group.id, status: "all", lifecycle: "all" });
        setGroupNotice(`${group.name}: ${allowed.length} ${allowed.length === 1 ? "battery" : "batteries"} selected.${excluded ? ` ${excluded} ${excluded === 1 ? "member is" : "members are"} outside this personal view and ${excluded === 1 ? "was" : "were"} not selected.` : ""} Review current use and retired states before an operation.`);
    }
    function exportInventory() { if (validation.success && !selectionScopeChanged) onExport({ selectedIds: [...selected], filter: validation.data, page: currentPage, pageSize, matching: matching.length, pageCount: visible.length }); }
    return <>{personalScope !== "all" && <div className="personal-inventory-scope"><strong>{personalScope === "responsible" ? "My batteries" : "My batteries in use"}</strong><span>{personalScope === "responsible" ? "Batteries assigned to your account as responsible owner, including those in use by other staff." : "Batteries currently checked out to your account."} Filters and downloads apply within this view.</span></div>}<div className="summary-grid">{[[personalScope === "responsible" ? "My responsible batteries" : personalScope === "borrowed" ? "My batteries in use" : "Registered batteries", baseBatteries.length, personalScope === "all" ? "Across registered storage locations" : "In this personal view"], ["In store", baseBatteries.length - onLoan, "No active loan recorded"], ["In use", onLoan, "Linked to a current staff holder"]].map(([label, count, note]) => <div className="summary-card" key={label}><span>{label}</span><strong>{count}</strong><p>{note}</p></div>)}</div>
    <section className="inventory-panel" aria-label="Battery inventory records">{group && <div className="group-bulk-actions"><strong>Group operations</strong><Button variant="outline" onClick={() => onMovement("checkout", group.batteryIds)} disabled={!ready}>Check out group</Button><Button variant="outline" onClick={() => onMovement("return", group.batteryIds)} disabled={!ready}>Return group</Button><Button variant="outline" onClick={() => { setSelected([...group.batteryIds]); setGroupNotice("All group members selected, including retired members. Review their current state before an operation."); }} disabled={!ready}>Select all group members</Button><Button variant="outline" onClick={() => setSelected(matching.map(b => b.id))} disabled={!ready || !matching.length}>Select filtered group members</Button></div>}
    <div className="panel-top">
        <div className="inventory-category-navigation">
            <Tabs value={filters.status} onValueChange={value => updateFilters({ status: value as InventoryFilter["status"] })}><TabsList variant="line"><TabsTrigger value="all">All batteries <span className="tab-count">{allStatuses.length}</span></TabsTrigger><TabsTrigger value="in">In store <span className="tab-count">{matchingInStore}</span></TabsTrigger><TabsTrigger value="out">In use <span className="tab-count">{matchingOnLoan}</span></TabsTrigger></TabsList></Tabs>
            {!group && <Button variant="ghost" className="inventory-teaching-groups-link" onClick={() => onOpenGroups ? onOpenGroups() : setGroupEditor({ ids: [] })} disabled={!ready}>Teaching groups</Button>}
        </div>
        <Button variant="outline" onClick={() => onEdit({ kind: "battery" })} disabled={!ready}><Plus />Register battery</Button>
    </div>
    <div className="table-toolbar inventory-filter-toolbar"><Button variant="outline" onClick={() => setFilterOpen(open => !open)} aria-expanded={filterOpen} aria-controls="inventory-filter-panel"><Settings2 size={16}/>Filter{chips.length ? ` (${chips.length})` : ""}</Button><span className="toolbar-meta">{matching.length} matching {matching.length === 1 ? "battery" : "batteries"}</span><Button variant="ghost" onClick={exportInventory} disabled={!validation.success || selectionScopeChanged || !matching.length && !selected.length} aria-label="Download inventory"><Download size={16}/><span>Download</span></Button></div>
    {filterOpen && <InventoryFilterPanel fixedGroup={!!group} data={data} filters={filters} asOfOn={asOfOn} onChange={updateFilters}/>}
    <AppliedFilters chips={chips} onRemove={updateFilters} onClear={clearFilters}/>
    {groupMissing && <p className="form-error" role="alert">This teaching group is no longer available. Clear the group filter or choose a current group. Your selected batteries are retained for review.</p>}
    {groupNotice && <p role="status" className="field-hint">{groupNotice}</p>}
    {!!selected.length && <div className="teaching-group-actions">{group && <>{onRemoval && <Button variant="outline" size="sm" onClick={() => onRemoval(selected)} disabled={!ready || selected.some(id => { const b = batteries.find(b => b.id === id)!; return !isActiveBattery(b) || !!b.loanId; })}>Retire or remove selected</Button>}{onGroupMaintenance && data.user.role === "admin" && <Button variant="outline" size="sm" onClick={() => onGroupMaintenance(selected)} disabled={!ready || selected.some(id => !isActiveBattery(batteries.find(b => b.id === id)!))}>Update selected members</Button>}</>}<Button variant="outline" size="sm" onClick={() => setGroupEditor({ ids: [...selected] })} disabled={!ready || selected.length > 100 || selectionScopeChanged}>Save as teaching group</Button>{selected.length > 100 && <span className="field-hint">Teaching groups support up to 100 batteries. Reduce the selection to save a group.</span>}</div>}
    {groupEditor && <TeachingGroupsPanel data={data} initialIds={groupEditor.ids} addToExisting={!!groupEditor.ids.length} onClose={() => setGroupEditor(null)} onChanged={onGroupsChanged} onFilter={group => { updateFilters({ groupId: group.id }); setGroupNotice(""); }} onSelect={selectGroup}/>}
    {!validation.success && <p className="form-error filter-error" role="alert">{validation.error.issues.map(issue => issue.message).join(" ")}</p>}
    {!!selected.length && <div className="selection-toolbar"><strong>{selected.length} selected{selected.some(id => !matching.some(b => b.id === id)) ? ` · ${selected.filter(id => !matching.some(b => b.id === id)).length} outside current filters` : ""}</strong><Button variant="outline" size="sm" onClick={exportInventory} disabled={!validation.success || selectionScopeChanged}><Download size={16}/>Download selected</Button><Button variant="outline" size="sm" onClick={() => onMovement("checkout", selected)} disabled={!ready || selectionScopeChanged || selected.length > 100 || selected.some(id => batteries.find(b => b.id === id)?.loanId || !isActiveBattery(batteries.find(b => b.id === id)!))}>Check out selected</Button><Button variant="outline" size="sm" onClick={() => onMovement("return", selected)} disabled={!ready || selectionScopeChanged || selected.length > 100 || selected.some(id => !batteries.find(b => b.id === id)?.loanId || !isActiveBattery(batteries.find(b => b.id === id)!))}>Return selected</Button><Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear selection</Button></div>}
    {selectionScopeChanged && <div className="selection-scope-warning" role="alert"><strong>Your selected batteries have changed scope.</strong><p>These batteries no longer belong to {group ? "this teaching group" : personalScope === "responsible" ? "My batteries" : "My batteries in use"}: {outsidePersonalScope.map((id, index) => <span key={id}>{index > 0 ? ", " : ""}<button className="record-link" onClick={() => onDetail(id)}>{id}</button></span>)}. Review their current details, then remove them from your selection before downloading or starting an operation.</p><Button variant="outline" size="sm" onClick={() => setSelected(selected.filter(id => !outsidePersonalScope.includes(id)))}>Remove batteries outside this view</Button></div>}
    {selected.length > 100 && <p className="field-hint">Checkouts and returns support up to 100 batteries per batch. Reduce your selection before starting a movement. You can still download all selected batteries together.</p>}
    <Table><TableHeader><TableRow><TableHead className="checkbox-cell"><Checkbox aria-label="Select all batteries on this page" checked={visible.length > 0 && visible.every(b => selected.includes(b.id)) ? true : visible.some(b => selected.includes(b.id)) ? "indeterminate" : false} disabled={!visible.length || !ready} onCheckedChange={v => selectAll(v === true)}/></TableHead><TableHead>BATTERY</TableHead><TableHead>STATUS</TableHead><TableHead>RESPONSIBLE OWNER</TableHead><TableHead>CURRENT HOLDER</TableHead><TableHead>STORAGE LOCATION</TableHead><TableHead>LAST OBSERVED</TableHead>{group && data.user.role === "admin" && <TableHead>ACTIONS</TableHead>}</TableRow></TableHeader><TableBody>{visible.map(b => <TableRow key={b.id} className="battery-selection-row" data-selected={selected.includes(b.id)} data-selectable={ready} aria-selected={selected.includes(b.id)} onClick={event => selectBatteryRow(b.id, event)}><TableCell className="checkbox-cell"><Checkbox aria-label={`Select ${b.id}`} checked={selected.includes(b.id)} disabled={!ready} onCheckedChange={v => changeBatterySelection(b.id, v === true)}/></TableCell><TableCell><div className="battery-cell"><span className="battery-icon"><Battery size={19}/></span><div><button className="record-link" onClick={() => onDetail(b.id)} aria-label={`View ${b.id}`}>{b.id}</button><span>{b.name}</span><small>{b.chemistry || "Chemistry not recorded"}{b.capacityMah != null ? ` · ${b.capacityMah.toLocaleString()} mAh` : ""}{b.voltage != null ? ` · ${b.voltage} V` : ""}</small><small>Age since manufacture: {formatBatteryAge(b.manufacturedOn)}</small></div></div></TableCell><TableCell><span className={`status-badge ${!isActiveBattery(b) ? "retired" : b.loanId ? "out" : "in"}`}>{batteryStatusLabel(b)}</span></TableCell><TableCell>{b.ownerName}</TableCell><TableCell>{b.borrowerName || <span className="muted">—</span>}</TableCell><TableCell><strong>{b.homeBuildingId ? buildingLabel({ id: b.homeBuildingId, name: b.homeBuildingName! }) : "Building not assigned"}</strong><span className="cell-secondary">{storageRoomLabel(b)}</span></TableCell><TableCell>{b.observedAt ? <><strong>{b.observedRoom}</strong>{b.observedBuilding && <span className="cell-secondary">{b.observedBuilding}</span>}<span className="cell-secondary">{formatTime(b.observedAt)}</span><span className="cell-secondary">{b.observationSource}</span></> : <span className="muted">Not yet observed</span>}</TableCell>{group && data.user.role === "admin" && <TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "battery", record: b })} disabled={!ready || !isActiveBattery(b)}>Edit battery</Button></TableCell>}</TableRow>)}</TableBody></Table>
    {!matching.length && <div className="empty-state"><Package /><h3>{!validation.success ? "Review the filter range" : !baseBatteries.length && personalScope === "responsible" ? "No batteries assigned to you" : !baseBatteries.length && personalScope === "borrowed" ? "No current loans" : batteries.length ? "No matching batteries" : "No batteries registered"}</h3><p>{!validation.success ? "Correct the filter conditions to view or download matching records." : !baseBatteries.length && personalScope === "responsible" ? "Your account has no batteries assigned as responsible owner. Shared records remain available in Battery inventory." : !baseBatteries.length && personalScope === "borrowed" ? "You have no batteries currently checked out. Shared records remain available in Battery inventory." : batteries.length ? "Adjust or clear your filters." : "Register a battery in J18 and choose its responsible staff account. Its room can stay unspecified."}</p>{!batteries.length && personalScope === "all" && <Button variant="outline" onClick={onSetup}>Set up records</Button>}</div>}
    <div className="pagination-bar"><span>{matching.length ? currentPage * Number(pageSize) + 1 : 0}–{Math.min((currentPage + 1) * Number(pageSize), matching.length)} of {matching.length} matching {matching.length === 1 ? "battery" : "batteries"}</span><div><Select value={pageSize} onValueChange={value => { setPageSize(value as typeof pageSize); setPage(0); }}><SelectTrigger aria-label="Batteries per page"><SelectValue /></SelectTrigger><SelectContent>{["10", "25", "50", "100"].map(size => <SelectItem key={size} value={size}>{size} per page</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" onClick={() => setPage(currentPage - 1)} disabled={!currentPage}>Previous</Button><span>Page {currentPage + 1} of {pageCount}</span><Button variant="outline" size="sm" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount - 1}>Next</Button></div></div>
    <div className="panel-footer"><span>Storage building and room are the registered home. Last observed location is separate, dated evidence.</span><span>{baseBatteries.length} {baseBatteries.length === 1 ? "battery" : "batteries"} in this view</span></div></section>
  </>;
}
export function RecordManagement({ data, ready, onEdit, onDetail, onImport }: RecordActions & {
    onImport: (kind: ImportKind) => void;
}) {
    const [kind, setKind] = useState<ImportKind>("people");
    const [query, setQuery] = useState(""), [downloadError, setDownloadError] = useState("");
    const [copyingOwnerId, setCopyingOwnerId] = useState(""), [copiedOwnerId, setCopiedOwnerId] = useState(""), [copyError, setCopyError] = useState("");
    const admin = data.user.role === "admin";
    const records = (kind === "people" ? data.people.filter(person => person.role === "staff" && person.accountId) : kind === "buildings" ? data.buildings : kind === "rooms" ? data.rooms : data.batteries).filter(record => Object.values(record).join(" ").toLowerCase().includes(query.toLowerCase()));
    const people = data.people.filter(person => records.some(record => record.id === person.id));
    const buildings = data.buildings.filter(building => records.some(record => record.id === building.id));
    const rooms = data.rooms.filter(room => records.some(record => record.id === room.id));
    const batteries = data.batteries.filter(battery => records.some(record => record.id === battery.id));
    const editorKind = kind === "people" ? "person" : kind === "buildings" ? "building" : kind === "rooms" ? "room" : "battery";
    async function copyOwnerId(id: string) {
        setCopyError(""); setCopiedOwnerId("");
        const person = data.people.find(record => record.id === id), account = data.staffDirectory.find(record => record.id === person?.accountId);
        if (!account?.active) { setCopyError("This owner ID is unavailable for new batteries because its account is inactive or unavailable."); return; }
        setCopyingOwnerId(id);
        try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(id);
            setCopiedOwnerId(id);
        } catch { setCopyError("Could not copy this owner ID. Select the ID below and copy it manually."); }
        finally { setCopyingOwnerId(""); }
    }
    return <section className="inventory-panel"><div className="panel-top"><Tabs value={kind} onValueChange={v => setKind(v as ImportKind)}><TabsList variant="line"><TabsTrigger value="people">Staff directory</TabsTrigger><TabsTrigger value="buildings">Buildings</TabsTrigger><TabsTrigger value="rooms">Rooms</TabsTrigger><TabsTrigger value="batteries">Batteries</TabsTrigger></TabsList></Tabs><div className="panel-actions">{kind !== "people" && (admin || kind === "batteries") && <><Button variant="outline" onClick={() => onImport(kind)} disabled={!ready}><Upload />Import CSV</Button><Button onClick={() => onEdit({ kind: editorKind })} disabled={!ready}><Plus />Register {editorKind}</Button></>}</div></div><div className="table-toolbar"><Input aria-label="Search managed records" placeholder="Search these records…" value={query} onChange={event => setQuery(event.target.value)}/><Button variant="ghost" onClick={() => setQuery("")} disabled={!query}>Clear filters</Button><Button variant="outline" disabled={!records.length} onClick={() => downloadList(data.dataset, "records", query, kind).catch(error => setDownloadError(error.message))}><Download size={16}/>Download filtered list</Button><span>{records.length} records</span></div>{downloadError && <p className="form-error" role="alert">{downloadError}</p>}
    {kind === "people" && <>{copyError && <p className="form-error" role="alert">{copyError}</p>}{copiedOwnerId && <p className="field-hint" role="status">Owner ID copied: {copiedOwnerId}</p>}</>}
    {kind === "people" ? <Table><TableHeader><TableRow><TableHead>STAFF MEMBER</TableHead><TableHead>REFERENCE</TableHead><TableHead>OWNER ID (CSV)</TableHead><TableHead>ACCOUNT</TableHead></TableRow></TableHeader><TableBody>{people.map(person => {
        const account = data.staffDirectory.find(record => record.id === person.accountId);
        return <TableRow key={person.id}><TableCell><strong>{person.name}</strong></TableCell><TableCell>{person.reference || "Not recorded"}</TableCell><TableCell><code className={"select-all break-all text-xs" + (account?.active ? "" : " muted")}>{person.id}</code><div><Button variant="ghost" size="sm" onClick={() => copyOwnerId(person.id)} disabled={!account?.active || !!copyingOwnerId} aria-label={"Copy owner ID for " + (account?.username ?? person.name)}><Copy size={14}/>{copyingOwnerId === person.id ? "Copying…" : "Copy owner ID"}</Button></div>{!account?.active && <span className="cell-secondary">Unavailable for new batteries</span>}</TableCell><TableCell><strong>{account?.username || "Account unavailable"}</strong><span className="cell-secondary">{account ? account.active ? "Active" : "Inactive" : "Account unavailable"}</span>{person.accountId === data.user.id && <span className="cell-secondary">Your account</span>}</TableCell></TableRow>;
    })}</TableBody></Table> : kind === "buildings" ? <Table><TableHeader><TableRow><TableHead>BUILDING CODE</TableHead><TableHead>NAME</TableHead><TableHead>ROOM INFORMATION</TableHead>{admin && <TableHead>ACTIONS</TableHead>}</TableRow></TableHeader><TableBody>{buildings.map(building => <TableRow key={building.id} className={!isSupportedBuilding(building.id) ? "unsupported-location-row" : undefined}><TableCell><strong>{building.id}</strong></TableCell><TableCell>{building.name}<span className="cell-secondary">{isSupportedBuilding(building.id) ? "Currently supported" : "Not available for selection"}</span></TableCell><TableCell>{isSupportedBuilding(building.id) ? "Placeholder rooms awaiting confirmation" : "Not available"}</TableCell>{admin && <TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "building", record: building })} disabled={!ready || !isSupportedBuilding(building.id)} aria-label={`Edit ${building.id}`}><Pencil />Edit</Button></TableCell>}</TableRow>)}</TableBody></Table> : kind === "rooms" ? <Table><TableHeader><TableRow><TableHead>ROOM</TableHead><TableHead>BUILDING</TableHead><TableHead>STATUS</TableHead>{admin && <TableHead>ACTIONS</TableHead>}</TableRow></TableHeader><TableBody>{rooms.map(room => <TableRow key={room.id} className={!isSelectableRoom(room) ? "unsupported-location-row" : undefined}><TableCell><strong>{isSupportedBuilding(room.buildingId) ? roomLabel(room) : "Not available"}</strong></TableCell><TableCell>{room.buildingId ? room.building : "Building not assigned"}</TableCell><TableCell>{!isSelectableRoom(room) ? "Not available for selection" : room.isPlaceholder ? "Placeholder · awaiting confirmation" : "Confirmed room"}</TableCell>{admin && <TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "room", record: room })} disabled={!ready || !isSelectableRoom(room)} aria-label={`Edit ${room.name}`}><Pencil />Edit</Button></TableCell>}</TableRow>)}</TableBody></Table> : <Table><TableHeader><TableRow><TableHead>BATTERY</TableHead><TableHead>RFID IDENTIFIER</TableHead><TableHead>OWNER / STORAGE LOCATION</TableHead>{admin && <TableHead>ACTIONS</TableHead>}</TableRow></TableHeader><TableBody>{batteries.map(b => <TableRow key={b.id}><TableCell><button className="record-link" onClick={() => onDetail(b.id)}>{b.id}</button><span className="cell-secondary">{b.name}</span><span className="cell-secondary">Age since manufacture: {formatBatteryAge(b.manufacturedOn)}</span></TableCell><TableCell>{b.tagId || "Not assigned"}</TableCell><TableCell>{b.ownerName}<span className="cell-secondary">{b.homeBuildingId || "Building not assigned"} / {storageRoomLabel(b)}</span></TableCell>{admin && <TableCell><Button variant="ghost" size="sm" onClick={() => onEdit({ kind: "battery", record: b })} disabled={!ready || !isActiveBattery(b)} aria-label={`Edit ${b.id}`}><Pencil />Edit</Button></TableCell>}</TableRow>)}</TableBody></Table>}
    {!records.length && <div className="empty-state"><Settings2 /><h3>No matching {kind === "people" ? "staff members" : kind}</h3><p>{kind === "people" ? "Staff directory entries come from staff accounts. An administrator manages these through Staff accounts." : admin || kind === "batteries" ? "Use the registration form or review a CSV import." : "Ask an administrator to register these records."}</p></div>}
    <div className="panel-footer"><span>{kind === "buildings" || kind === "rooms" ? "J18 is currently supported. Placeholder rooms await confirmation; a battery's room can remain unspecified." : kind === "people" ? "Use an active Owner ID (CSV) as owner_id when importing batteries. In the downloaded staff directory, this is the id column. Administrators manage staff identities through Staff accounts." : "Responsible owners and current holders are distinct staff accounts."}</span></div>
  </section>;
}
export function ActivityHistory({ data, onDetail, scope = "all", revision = 0, groupId = null, onGroupFilterChange, onDialogChange }: { data: InventorySnapshot; onDetail: (id: string) => void; scope?: ActivityScope; revision?: number; groupId?: string | null; onGroupFilterChange?: (id: string | null) => void; onDialogChange?: (open: boolean) => void }) {
    type HistoryResult = { context: string; sourceEvents: AuditEvent[]; revision: number; retry: number; events: AuditEvent[]; error: string };
    const context = `${data.dataset}-${scope}-${data.user.id}`;
    const [history, setHistory] = useState<HistoryResult | null>(null), [query, setQuery] = useState(""), [page, setPage] = useState(0), [retry, setRetry] = useState(0);
    const [downloadOpen, setDownloadOpen] = useState(false), [selected, setSelected] = useState<string[]>([]);
    useEffect(() => { onDialogChange?.(downloadOpen); return () => onDialogChange?.(false); }, [downloadOpen, onDialogChange]);
    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        const result = { context, sourceEvents: data.events, revision, retry };
        fetch(`/api/inventory?${new URLSearchParams({ dataset: data.dataset, activity: "all", activityScope: scope })}`, { signal: abort.signal, cache: "no-store" }).then(async response => {
            if (response.status === 401) reloadSessionPage("/signin");
            const body = await response.json() as { error?: string; events: AuditEvent[] };
            if (!response.ok) throw new Error(body.error || "The complete activity history could not be loaded.");
            if (!Array.isArray(body.events)) throw new Error("The activity response was incomplete. Retry the history request.");
            if (active && !abort.signal.aborted) setHistory({ ...result, events: body.events, error: "" });
        }).catch(error => {
            if (active && !abort.signal.aborted) setHistory({ ...result, events: [], error: (error as Error).message || "The activity history could not be loaded." });
        });
        return () => { active = false; abort.abort(); };
    }, [context, data.dataset, data.events, revision, retry, scope]);
    const current = history?.context === context && history.sourceEvents === data.events && history.revision === revision && history.retry === retry;
    const loading = !current, error = current ? history.error : "", events = current && !error ? history.events : [];
    const entries = groupActivity(events), matching = filterActivity(entries, query, groupId), maxPage = Math.max(0, Math.ceil(matching.length / 25) - 1), currentPage = Math.min(page, maxPage);
    const visible = matching.slice(currentPage * 25, (currentPage + 1) * 25);
    const groupChoices = [...new Map(entries.flatMap(entry => entry.teachingGroup ? [[entry.teachingGroup.id, entry.teachingGroup.name] as const] : [])).entries()];
    const chosen = selected.filter(id => entries.some(entry => entry.id === id));
    const countLabel = `${matching.length} matching ${matching.length === 1 ? "operation" : "operations"}`;
    function toggle(id: string, checked: boolean) { setSelected(previous => checked ? [...new Set([...previous, id])] : previous.filter(value => value !== id)); }
    return <section className="inventory-panel" aria-label={scope === "mine" ? "My activity records" : "Shared activity records"} aria-busy={loading}>
        <div className="section-heading"><div><h2>{scope === "mine" ? "My recorded activity" : "Recorded activity"}</h2><p className="field-hint">{scope === "mine" ? "Inventory operations recorded by your signed-in staff account." : "Recorded inventory operations across all staff accounts."}</p></div><span className="toolbar-meta">{loading ? "Loading complete history…" : error ? "History unavailable" : `${countLabel} · Sydney time`}</span></div>
        <div className="table-toolbar"><Input aria-label="Search activity" placeholder="Search group, battery, operator or action…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/>{onGroupFilterChange && <Select value={groupId ?? "__all"} onValueChange={id => { onGroupFilterChange(id === "__all" ? null : id); setPage(0); }}><SelectTrigger aria-label="Activity teaching group"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="__all">All recorded operations</SelectItem>{groupChoices.map(([id,name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}{groupId && !groupChoices.some(([id]) => id === groupId) && <SelectItem value={groupId} disabled>Group has no recorded activity</SelectItem>}</SelectContent></Select>}<Button variant="ghost" onClick={() => { setQuery(""); onGroupFilterChange?.(null); setPage(0); }} disabled={!query && !groupId}>Clear filters</Button><Button variant="outline" disabled={loading || !!error || !matching.length && !chosen.length} onClick={() => setDownloadOpen(true)}><Download size={16}/>Download filtered history</Button></div>
        {(query || groupId) && <p className="field-hint">Applied filters: {query && `Search: ${query}`}{query && groupId && " · "}{groupId && `Teaching group: ${groupChoices.find(([id]) => id === groupId)?.[1] ?? "Recorded group"}`}</p>}
        {!!chosen.length && <div className="selection-toolbar"><strong>{chosen.length} operations selected</strong><Button variant="outline" onClick={() => setDownloadOpen(true)}>Download selected activity</Button><Button variant="ghost" onClick={() => setSelected([])}>Clear selection</Button></div>}
        {loading ? <div className="loading-panel" role="status"><p>Loading the complete {scope === "mine" ? "history of your inventory operations" : "inventory activity history"}…</p><Skeleton className="h-10 w-full"/><Skeleton className="h-24 w-full"/></div> : error ? <div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry history</Button></div> : <>
            <Table><TableHeader><TableRow><TableHead><Checkbox aria-label="Select activity on this page" checked={visible.length > 0 && visible.every(event => chosen.includes(event.id)) ? true : visible.some(event => chosen.includes(event.id)) ? "indeterminate" : false} disabled={!visible.length} onCheckedChange={value => setSelected(previous => value === true ? [...new Set([...previous, ...visible.map(event => event.id)])] : previous.filter(id => !visible.some(event => event.id === id)))}/></TableHead><TableHead>ACTION / DETAILS</TableHead><TableHead>BATTERY / TEACHING GROUP</TableHead><TableHead>OPERATOR</TableHead><TableHead>RECORDED AT</TableHead></TableRow></TableHeader><TableBody>{visible.map(event => <TableRow key={event.id}><TableCell><Checkbox aria-label={`Select activity ${event.id}`} checked={chosen.includes(event.id)} onCheckedChange={value => toggle(event.id, value === true)}/></TableCell><TableCell><strong>{actionNames[event.action] ?? event.action}</strong>{event.teachingGroup ? <details className="group-activity-details"><summary>View {event.members!.length} recorded battery actions</summary><p className="field-hint">{event.teachingGroup.name} · Group version {event.teachingGroup.version} at operation time</p>{event.members!.map(member => <article className="history-entry" key={member.id}><button className="record-link" onClick={() => onDetail(member.batteryId!)}>{member.batteryId}</button><EventDescription event={member}/><p className="field-hint">{member.actorName} · {formatTime(member.at)}</p><details><summary>Recorded evidence</summary><pre className="group-evidence">{JSON.stringify(member.details, null, 2)}</pre></details></article>)}</details> : <EventDescription event={event}/>}</TableCell><TableCell>{event.teachingGroup ? <><strong>{event.teachingGroup.name}</strong><span className="cell-secondary">{event.members!.length} batteries in this operation</span></> : event.batteryId ? <button className="record-link" onClick={() => onDetail(event.batteryId!)}>{event.batteryId}</button> : "—"}</TableCell><TableCell>{event.actorName}</TableCell><TableCell>{formatTime(event.at)}</TableCell></TableRow>)}</TableBody></Table>
            {!matching.length && <div className="empty-state"><ClipboardList /><h3>{events.length ? "No matching activity" : scope === "mine" ? "You have no recorded activity yet" : "No recorded activity"}</h3><p>{events.length ? "Try another search." : "Confirmed inventory operations will appear here."}</p></div>}
            <div className="pagination-bar"><span>{countLabel}</span><div><Button variant="outline" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><span>Page {currentPage + 1} of {maxPage + 1}</span><Button variant="outline" size="sm" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>
        </>}
        {downloadOpen && <ActivityExportDialog dataset={data.dataset} scope={scope} search={query} groupId={groupId} selectedIds={chosen} count={matching.length} onClose={() => setDownloadOpen(false)}/>}
        <div className="panel-footer">Search and download include the complete stored {scope === "mine" ? "history of your recorded inventory operations" : "inventory activity history"}. Corrections retain the original action.</div>
    </section>;
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
