"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RecordPicker } from "./record-picker";
import { BatteryModelPicker } from "./battery-model-picker";
import { modelApplication, modelFieldValue, type BatteryModelChoice, type ModelField, type ModelSelection } from "@/lib/battery-models";
import type { InventorySnapshot, BatteryRecord, Person, Room, Building } from "@/lib/domain";
import type { WriteAction } from "./movement-dialog";
import { numberOrNull, dateOnlyOrNull, staffIdentityLabel } from "@/lib/client-utils";
import { currentSydneyDate } from "@/lib/battery-age";
import { buildingPickerOptions, isSupportedBuilding, roomPickerOptions } from "@/lib/location-catalog";
export type EditorDraft = {
    kind: "battery" | "person" | "building" | "room";
    record?: BatteryRecord | Person | Room | Building;
    initialTagId?: string;
};
export function RecordEditor({ draft, data, onClose, write }: {
    draft: EditorDraft;
    data: InventorySnapshot;
    onClose: () => void;
    write: WriteAction;
}) {
    const update = !!draft.record, kind = draft.kind;
    const [editorContext] = useState(() => ({ dataset: data.dataset, userId: data.user.id }));
    const contextChanged = editorContext.dataset !== data.dataset || editorContext.userId !== data.user.id;
    const [generatedRoomId] = useState(() => crypto.randomUUID());
    const fields = (record: object) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v == null ? "" : String(v)]));
    const initial = draft.record ?? (kind === "battery" ? { homeBuildingId: "J18", tagId: draft.initialTagId ?? "" } : kind === "room" ? { buildingId: "J18", isPlaceholder: true } : {});
    const [baseline, setBaseline] = useState<Record<string, string>>(() => fields(initial));
    const [values, setValues] = useState<Record<string, string>>(() => fields(initial)), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [expectedVersion, setExpectedVersion] = useState(draft.record?.version);
    const [conflict, setConflict] = useState(false), [review, setReview] = useState<Array<{ key: string; field: string; saved: string }>>([]);
    const [reviewNotice, setReviewNotice] = useState("");
    const [reviewedData, setReviewedData] = useState<InventorySnapshot | null>(null);
    const [modelBusy, setModelBusy] = useState(false);
    const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);
    const [appliedModel, setAppliedModel] = useState<BatteryModelChoice | null>(null);
    const locked = busy || modelBusy;
    const choices = reviewedData ?? data;
    const value = (k: string) => values[k] ?? "", set = (k: string, v: string) => {
        setValues(s => ({ ...s, [k]: v }));
        setModelSelection(selection => selection && appliedModel && selection.appliedFields.includes(k as ModelField) && v !== modelFieldValue(appliedModel, k as ModelField) ? { ...selection, appliedFields: selection.appliedFields.filter(field => field !== k) } : selection);
    };
    function applyModel(choice: BatteryModelChoice, fields: ModelField[]) {
        if (locked || contextChanged) return;
        setValues(previous => modelApplication(previous, choice, fields));
        setAppliedModel(choice);
        setModelSelection({ origin: choice.origin, id: choice.id, contentHash: choice.contentHash, confirmed: true, appliedFields: fields });
    }
    function field(key: string, label: string, required = false, type = "text") { return <div className="form-field" key={key}><Label htmlFor={`edit-${key}`}>{label}{required && <span className="required"> *</span>}</Label><Input id={`edit-${key}`} type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? 0 : key === "firstUsedOn" ? value("manufacturedOn") || undefined : undefined} max={type === "date" ? currentSydneyDate() : undefined} value={value(key)} onChange={e => set(key, e.target.value)} required={required} disabled={locked || contextChanged || (key === "id" && update)}/></div>; }
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (locked || contextChanged) return;
        setError("");
        setBusy(true);
        try {
            const roomReference = `${value("buildingId").trim()}-${value("number").trim()}`;
            const roomId = update ? value("id") : /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(roomReference) ? roomReference : generatedRoomId;
            const payload = kind === "battery" ? { id: value("id"), name: value("name"), chemistry: value("chemistry"), model: value("model"), capacityMah: numberOrNull(value("capacityMah"), "Capacity"), voltage: numberOrNull(value("voltage"), "Voltage"), manufacturedOn: dateOnlyOrNull(value("manufacturedOn"), "Manufactured on"), firstUsedOn: dateOnlyOrNull(value("firstUsedOn"), "First used on"), tagId: value("tagId").trim() || null, ownerId: value("ownerId"), homeBuildingId: value("homeBuildingId") || null, homeRoomId: value("homeRoomId") || null } : kind === "building" ? { id: value("id"), name: value("name") } : { id: roomId, name: value("name"), buildingId: value("buildingId"), number: value("number"), isPlaceholder: value("isPlaceholder") !== "false" };
            await write(kind, { ...payload, ...(update ? { expectedVersion } : {}), ...(!update && kind === "battery" && modelSelection ? { modelSelection } : {}) }, { update });
            onClose();
        }
        catch (e) {
            setError((e as Error).message);
            setConflict((e as Error & { code?: string }).code === "record_conflict");
        }
        finally {
            setBusy(false);
        }
    }
    async function loadLatest() {
        setBusy(true);
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            const latest = await response.json() as InventorySnapshot & { error?: string };
            if (!response.ok) throw new Error(latest.error || "The latest record could not be loaded. Your input is unchanged.");
            if (!update) {
                setReviewedData(latest); setConflict(false); setError("");
                setReviewNotice("Latest records loaded. Your input is preserved. Review your choices before saving.");
                return;
            }
            const records = kind === "battery" ? latest.batteries : kind === "person" ? latest.people : kind === "building" ? latest.buildings : latest.rooms;
            const record = records.find(r => r.id === value("id"));
            if (!record) throw new Error("This record is no longer available. Your input has been preserved.");
            const saved = fields(record), merged = { ...saved };
            const overlaps: Array<{ key: string; field: string; saved: string }> = [];
            const labels: Record<string, string> = { name: "Name", chemistry: "Chemistry", model: "Model", capacityMah: "Capacity", voltage: "Nominal voltage", manufacturedOn: "Manufactured on", firstUsedOn: "First used on", tagId: "RFID identifier", ownerId: "Responsible owner ID", homeBuildingId: "Storage building", homeRoomId: "Storage room", buildingId: "Building", number: "Room number", isPlaceholder: "Placeholder location" };
            for (const key of Object.keys(labels)) {
                const proposed = values[key] ?? "", original = baseline[key] ?? "", current = saved[key] ?? "";
                if (proposed !== original) {
                    merged[key] = proposed;
                    if (current !== original && current !== proposed) overlaps.push({ key, field: labels[key], saved: current || "Not recorded" });
                }
            }
            setValues(merged); setBaseline(saved); setExpectedVersion(record.version); setReview(overlaps);
            setReviewedData(latest);
            setReviewNotice("Latest information loaded. Your edited fields are kept; other updates have been retained. Review the form before saving.");
            setConflict(false); setError("");
        } catch (e) {
            setError((e as Error).message);
        } finally { setBusy(false); }
    }
    if (kind === "person") return <Dialog open onOpenChange={o => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Staff profile</DialogTitle><DialogDescription>Staff profiles are linked to their login accounts. Administrators manage names and account access in Staff accounts.</DialogDescription></DialogHeader><DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>;
    return <Dialog open onOpenChange={o => !o && !locked && onClose()}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>{update ? "Edit" : "Register"} {kind}</DialogTitle><DialogDescription>{kind === "battery" ? "Choose the responsible staff account and storage location. J18 placeholder rooms remain unverified; the room may be left unspecified." : kind === "building" ? "Use the campus building code and name. Only J18 is currently available for battery locations." : "Room locations are placeholders until their details have been verified. Cabinets and shelves remain outside the current scope."}</DialogDescription></DialogHeader><form onSubmit={submit}>{kind === "battery" && !update && <BatteryModelPicker key={`${data.dataset}/${data.user.id}`} dataset={data.dataset} actorAccountId={data.user.id} canEditModels={data.user.role === "admin"} values={values} selection={modelSelection} disabled={locked || contextChanged} onApply={applyModel} onManual={() => { setModelSelection(null); setAppliedModel(null); }} onBusyChange={setModelBusy}/>}<div className="form-grid">{(kind !== "room" || update) && field("id", kind === "building" ? "Building code" : `${kind.charAt(0).toUpperCase() + kind.slice(1)} ID`, true)}{field("name", "Name", true)}
    {kind === "battery" && <>{field("chemistry", "Chemistry")}{field("model", "Model")}{field("capacityMah", "Capacity (mAh)", false, "number")}{field("voltage", "Nominal voltage (V)", false, "number")}{field("manufacturedOn", "Manufactured on", false, "date")}{field("firstUsedOn", "First used on", false, "date")}<p className="field-hint full-width">Leave unknown dates blank. Age since manufacture and time in service are calculated from these dates using the current Sydney date.</p><div className="form-field"><Label htmlFor="edit-owner">Responsible staff owner <span className="required">*</span></Label><RecordPicker id="edit-owner" options={choices.people.filter(p => p.role === "staff" && p.accountId).map(p => { const account = choices.staffDirectory.find(a => a.id === p.accountId); return { id: p.id, label: `${staffIdentityLabel(p.name, account?.username, p.accountId || p.id)}${account && !account.active ? " — Inactive account" : ""}`, disabled: !account?.active }; })} value={value("ownerId")} onChange={v => set("ownerId", v)} placeholder="Select staff owner…" disabled={locked}/></div>
    <div className="form-field"><Label htmlFor="edit-building">Storage building <span className="required">*</span></Label><RecordPicker id="edit-building" options={buildingPickerOptions(choices.buildings)} value={value("homeBuildingId")} onChange={v => { set("homeBuildingId", v); set("homeRoomId", ""); }} placeholder={update ? "Building not assigned" : "Select building…"} disabled={locked}/><p className="field-hint">Only J18 is currently supported. Other campus buildings are unavailable.</p></div>
    <div className="form-field full-width"><Label htmlFor="edit-room">Storage room — optional</Label><RecordPicker id="edit-room" options={isSupportedBuilding(value("homeBuildingId")) ? [{ id: "__unspecified", label: "Room not specified" }, ...roomPickerOptions(choices.rooms, value("homeBuildingId"))] : roomPickerOptions(choices.rooms, value("homeBuildingId"))} value={isSupportedBuilding(value("homeBuildingId")) ? value("homeRoomId") || "__unspecified" : "__unavailable"} onChange={v => set("homeRoomId", v === "__unspecified" ? "" : v)} placeholder={isSupportedBuilding(value("homeBuildingId")) ? "Room not specified" : "Not available"} disabled={locked || !isSupportedBuilding(value("homeBuildingId"))}/><p className="field-hint">Demo room and Demo workspace are virtual placeholders awaiting confirmed room information. Leave the room unspecified when unknown.</p></div><div className="form-field full-width">{field("tagId", "RFID tag identifier")}<p className="field-hint">Leave blank until a real tag identifier is known.</p></div></>}
    {kind === "room" && <><div className="form-field"><Label htmlFor="edit-room-building">Building <span className="required">*</span></Label><RecordPicker id="edit-room-building" options={buildingPickerOptions(choices.buildings)} value={value("buildingId")} onChange={v => set("buildingId", v)} placeholder="Select building…" disabled={locked}/></div>{field("number", "Room reference / number", true)}<div className="form-field full-width"><Label htmlFor="edit-placeholder" className="flex items-center gap-2"><Checkbox id="edit-placeholder" checked={value("isPlaceholder") !== "false"} onCheckedChange={checked => set("isPlaceholder", checked ? "true" : "false")} disabled={locked}/>Placeholder location — details not yet verified</Label><p className="field-hint">Clear this only after the room name and location have been confirmed. Renaming a placeholder alone does not verify it.</p></div></>}</div>{reviewNotice && <div role="status" className="field-hint"><p>{reviewNotice}</p>{review.map(r => <p key={r.field}><strong>{r.field}</strong>: saved value {r.saved}; your edit {value(r.key) || "Not recorded"}.</p>)}</div>}{contextChanged && <p role="alert" className="form-error">The inventory or account changed. Close this form and reopen registration before saving.</p>}{error && <p role="alert" className="form-error">{error}</p>}{conflict && <Button type="button" variant="outline" onClick={loadLatest} disabled={locked}>{update ? "Review latest record" : "Reload choices"}</Button>}<DialogFooter className="form-footer"><Button variant="outline" type="button" onClick={onClose} disabled={locked}>Cancel</Button><Button type="submit" disabled={locked || contextChanged || conflict}>{busy ? "Saving…" : update ? "Save changes" : `Register ${kind}`}</Button></DialogFooter></form></DialogContent></Dialog>;
}
