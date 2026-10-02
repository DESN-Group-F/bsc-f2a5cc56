"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RecordPicker } from "./record-picker";
import type { InventorySnapshot, BatteryRecord, Person, Room, Building } from "@/lib/domain";
import type { WriteAction } from "./movement-dialog";
import { numberOrNull, buildingLabel, roomLabel } from "@/lib/client-utils";
export type EditorDraft = {
    kind: "battery" | "person" | "building" | "room";
    record?: BatteryRecord | Person | Room | Building;
};
export function RecordEditor({ draft, data, onClose, write }: {
    draft: EditorDraft;
    data: InventorySnapshot;
    onClose: () => void;
    write: WriteAction;
}) {
    const update = !!draft.record, kind = draft.kind;
    const [generatedRoomId] = useState(() => crypto.randomUUID());
    const fields = (record: object) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v == null ? "" : String(v)]));
    const initial = draft.record ?? (kind === "battery" ? { homeBuildingId: "J18" } : kind === "room" ? { buildingId: "J18" } : {});
    const [baseline, setBaseline] = useState<Record<string, string>>(() => fields(initial));
    const [values, setValues] = useState<Record<string, string>>(() => fields(initial)), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [expectedVersion, setExpectedVersion] = useState(draft.record?.version);
    const [conflict, setConflict] = useState(false), [review, setReview] = useState<Array<{ key: string; field: string; saved: string }>>([]);
    const [reviewNotice, setReviewNotice] = useState("");
    const [reviewedData, setReviewedData] = useState<InventorySnapshot | null>(null);
    const choices = reviewedData ?? data;
    const value = (k: string) => values[k] ?? "", set = (k: string, v: string) => setValues(s => ({ ...s, [k]: v }));
    function field(key: string, label: string, required = false, type = "text") { return <div className="form-field" key={key}><Label htmlFor={`edit-${key}`}>{label}{required && <span className="required"> *</span>}</Label><Input id={`edit-${key}`} type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? 0 : undefined} value={value(key)} onChange={e => set(key, e.target.value)} required={required} disabled={busy || (key === "id" && update)}/></div>; }
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            const roomReference = `${value("buildingId").trim()}-${value("number").trim()}`;
            const roomId = update ? value("id") : /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(roomReference) ? roomReference : generatedRoomId;
            const payload = kind === "battery" ? { id: value("id"), name: value("name"), chemistry: value("chemistry"), model: value("model"), capacityMah: numberOrNull(value("capacityMah"), "Capacity"), voltage: numberOrNull(value("voltage"), "Voltage"), tagId: value("tagId").trim() || null, ownerId: value("ownerId"), homeBuildingId: value("homeBuildingId") || null, homeRoomId: value("homeRoomId") || null } : kind === "person" ? { id: value("id"), name: value("name"), reference: value("reference"), role: value("role") || "borrower" } : kind === "building" ? { id: value("id"), name: value("name") } : { id: roomId, name: value("name"), buildingId: value("buildingId"), number: value("number") };
            await write(kind, { ...payload, ...(update ? { expectedVersion } : {}) }, { update });
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
            const labels: Record<string, string> = { name: "Name", chemistry: "Chemistry", model: "Model", capacityMah: "Rated capacity", voltage: "Nominal voltage", tagId: "RFID identifier", ownerId: "Responsible owner ID", homeBuildingId: "Storage building", homeRoomId: "Storage room", reference: "Reference", role: "Record role", buildingId: "Building", number: "Room number" };
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
    return <Dialog open onOpenChange={o => !o && !busy && onClose()}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>{update ? "Edit" : "Register"} {kind}</DialogTitle><DialogDescription>{kind === "battery" ? "Choose the responsible owner and storage building. Keep the room unspecified until confirmed." : kind === "person" ? "People are inventory records. They do not need student login accounts." : kind === "building" ? "Use the campus building code and name. Adding a building does not assign any batteries to it." : "Register a confirmed room within a building. Cabinets and shelves remain outside the current scope."}</DialogDescription></DialogHeader><form onSubmit={submit}><div className="form-grid">{(kind !== "room" || update) && field("id", kind === "building" ? "Building code" : `${kind.charAt(0).toUpperCase() + kind.slice(1)} ID`, true)}{field("name", "Name", true)}
    {kind === "battery" && <>{field("chemistry", "Chemistry")}{field("model", "Model")}{field("capacityMah", "Rated capacity (mAh)", false, "number")}{field("voltage", "Nominal voltage (V)", false, "number")}<div className="form-field"><Label htmlFor="edit-owner">Responsible staff owner <span className="required">*</span></Label><RecordPicker id="edit-owner" options={choices.people.filter(p => p.role === "staff").map(p => ({ id: p.id, label: p.name }))} value={value("ownerId")} onChange={v => set("ownerId", v)} placeholder="Select staff owner…" disabled={busy}/></div>
    <div className="form-field"><Label htmlFor="edit-building">Storage building <span className="required">*</span></Label><RecordPicker id="edit-building" options={choices.buildings.map(b => ({ id: b.id, label: buildingLabel(b) }))} value={value("homeBuildingId")} onChange={v => { set("homeBuildingId", v); set("homeRoomId", ""); }} placeholder={update ? "Building not assigned" : "Select building…"} disabled={busy}/>{update && !value("homeBuildingId") && <p className="field-hint">Legacy building is unconfirmed. Assign it only when verified.</p>}</div>
    <div className="form-field full-width"><Label htmlFor="edit-room">Storage room — optional</Label><RecordPicker id="edit-room" options={[{ id: "__unspecified", label: "Room not specified" }, ...choices.rooms.filter(r => r.buildingId === (value("homeBuildingId") || null)).map(r => ({ id: r.id, label: roomLabel(r) }))]} value={value("homeRoomId") || "__unspecified"} onChange={v => set("homeRoomId", v === "__unspecified" ? "" : v)} placeholder="Room not specified" disabled={busy}/><p className="field-hint">Only rooms in the selected building are listed. Leave blank when the storage room is not yet known.</p></div><div className="form-field full-width">{field("tagId", "RFID tag identifier")}<p className="field-hint">Leave blank until a real tag identifier is known.</p></div></>}
    {kind === "person" && <>{field("reference", "Reference / institutional ID")}<div className="form-field"><Label htmlFor="edit-role">Record role</Label><Select value={value("role") || "borrower"} onValueChange={v => set("role", v)} disabled={busy}><SelectTrigger id="edit-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="borrower">Borrower</SelectItem><SelectItem value="staff">Staff / responsible owner</SelectItem></SelectContent></Select></div></>}
    {kind === "room" && <><div className="form-field"><Label htmlFor="edit-room-building">Building <span className="required">*</span></Label><RecordPicker id="edit-room-building" options={choices.buildings.map(b => ({ id: b.id, label: buildingLabel(b) }))} value={value("buildingId")} onChange={v => set("buildingId", v)} placeholder="Select building…" disabled={busy}/></div>{field("number", "Room number", true)}</>}</div>{reviewNotice && <div role="status" className="field-hint"><p>{reviewNotice}</p>{review.map(r => <p key={r.field}><strong>{r.field}</strong>: saved value {r.saved}; your edit {value(r.key) || "Not recorded"}.</p>)}</div>}{error && <p role="alert" className="form-error">{error}</p>}{conflict && <Button type="button" variant="outline" onClick={loadLatest} disabled={busy}>{update ? "Review latest record" : "Reload choices"}</Button>}<DialogFooter className="form-footer"><Button variant="outline" type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || conflict}>{busy ? "Saving…" : update ? "Save changes" : `Register ${kind}`}</Button></DialogFooter></form></DialogContent></Dialog>;
}
