import { MobileRegistrationDialog } from "../../../business/registration.jsx";
"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Checkbox } from "../ui/checkbox.js";
import { RecordPicker } from "./record-picker.js";
import { BatteryModelPicker } from "./battery-model-picker.js";
import { modelApplication, modelFieldValue } from "../../lib/battery-models.js";
import { numberOrNull, dateOnlyOrNull, staffIdentityLabel } from "../../lib/client-utils.js";
import { currentSydneyDate } from "../../lib/battery-age.js";
import { buildingPickerOptions, isSupportedBuilding, roomPickerOptions } from "../../lib/location-catalog.js";
import { getRolePermissions } from "../../lib/permissions.js";
function LegacyRecordEditor({ draft, data, onClose, write }) {
    const update = !!draft.record, kind = draft.kind;
    const permissions = getRolePermissions(data.user.role);
    const permitted = kind === "battery" ? update ? permissions.editBatteryRecords : permissions.registerBatteries : kind !== "person" && permissions.manageDirectories;
    const [editorContext] = useState(() => ({ dataset: data.dataset, userId: data.user.id }));
    const contextChanged = editorContext.dataset !== data.dataset || editorContext.userId !== data.user.id;
    const [generatedRoomId] = useState(() => crypto.randomUUID());
    const fields = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v == null ? "" : String(v)]));
    const initial = draft.record ?? (kind === "battery" ? { homeBuildingId: "J18", tagId: draft.initialTagId ?? "" } : kind === "room" ? { buildingId: "J18", isPlaceholder: true } : {});
    const [baseline, setBaseline] = useState(() => fields(initial));
    const [values, setValues] = useState(() => fields(initial)), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [expectedVersion, setExpectedVersion] = useState(draft.record?.version);
    const [conflict, setConflict] = useState(false), [review, setReview] = useState([]);
    const [reviewNotice, setReviewNotice] = useState("");
    const [reviewedData, setReviewedData] = useState(null);
    const [modelBusy, setModelBusy] = useState(false);
    const [modelSelection, setModelSelection] = useState(null);
    const [appliedModel, setAppliedModel] = useState(null);
    const locked = busy || modelBusy;
    const choices = reviewedData ?? data;
    const value = (k) => values[k] ?? "", set = (k, v) => {
        setValues(s => ({ ...s, [k]: v }));
        setModelSelection(selection => selection && appliedModel && selection.appliedFields.includes(k) && v !== modelFieldValue(appliedModel, k) ? { ...selection, appliedFields: selection.appliedFields.filter(field => field !== k) } : selection);
    };
    function applyModel(choice, fields) {
        if (locked || contextChanged || !permitted)
            return;
        setValues(previous => modelApplication(previous, choice, fields));
        setAppliedModel(choice);
        setModelSelection({ origin: choice.origin, id: choice.id, contentHash: choice.contentHash, confirmed: true, appliedFields: fields });
    }
    function field(key, label, required = false, type = "text") { return _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: `edit-${key}`, children: [label, required && _jsx("span", { className: "required", children: " *" })] }), _jsx(Input, { id: `edit-${key}`, type: type, step: type === "number" ? "any" : undefined, min: type === "number" ? 0 : key === "firstUsedOn" ? value("manufacturedOn") || undefined : undefined, max: type === "date" ? currentSydneyDate() : undefined, value: value(key), onChange: e => set(key, e.target.value), required: required, disabled: locked || contextChanged || (key === "id" && update) })] }, key); }
    async function submit(e) {
        e.preventDefault();
        if (locked || contextChanged || !permitted)
            return;
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
            setError(e.message);
            setConflict(e.code === "record_conflict");
        }
        finally {
            setBusy(false);
        }
    }
    async function loadLatest() {
        setBusy(true);
        try {
            const response = await fetch(`/api/inventory?dataset=${data.dataset}`, { cache: "no-store" });
            const latest = await response.json();
            if (!response.ok)
                throw new Error(latest.error || "The latest record could not be loaded. Your input is unchanged.");
            if (!update) {
                setReviewedData(latest);
                setConflict(false);
                setError("");
                setReviewNotice("Latest records loaded. Your input is preserved. Review your choices before saving.");
                return;
            }
            const records = kind === "battery" ? latest.batteries : kind === "person" ? latest.people : kind === "building" ? latest.buildings : latest.rooms;
            const record = records.find(r => r.id === value("id"));
            if (!record)
                throw new Error("This record is no longer available. Your input has been preserved.");
            const saved = fields(record), merged = { ...saved };
            const overlaps = [];
            const labels = { name: "Name", chemistry: "Chemistry", model: "Model", capacityMah: "Capacity", voltage: "Nominal voltage", manufacturedOn: "Manufactured on", firstUsedOn: "First used on", tagId: "RFID identifier", ownerId: "Responsible owner ID", homeBuildingId: "Storage building", homeRoomId: "Storage room", buildingId: "Building", number: "Room number", isPlaceholder: "Placeholder location" };
            for (const key of Object.keys(labels)) {
                const proposed = values[key] ?? "", original = baseline[key] ?? "", current = saved[key] ?? "";
                if (proposed !== original) {
                    merged[key] = proposed;
                    if (current !== original && current !== proposed)
                        overlaps.push({ key, field: labels[key], saved: current || "Not recorded" });
                }
            }
            setValues(merged);
            setBaseline(saved);
            setExpectedVersion(record.version);
            setReview(overlaps);
            setReviewedData(latest);
            setReviewNotice("Latest information loaded. Your edited fields are kept; other updates have been retained. Review the form before saving.");
            setConflict(false);
            setError("");
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setBusy(false);
        }
    }
    if (kind === "person")
        return _jsx(Dialog, { open: true, onOpenChange: o => !o && onClose(), children: _jsxs(DialogContent, { children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Staff profile" }), _jsx(DialogDescription, { children: "Staff profiles are linked to their login accounts. Administrators manage names and account access in Staff accounts." })] }), _jsx(DialogFooter, { children: _jsx(Button, { onClick: onClose, children: "Close" }) })] }) });
    if (!permitted && !locked)
        return _jsx(Dialog, { open: true, onOpenChange: o => !o && onClose(), children: _jsxs(DialogContent, { children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Administrator access required" }), _jsx(DialogDescription, { children: "Your account can view shared records. An administrator must make this change. Any input in this form is retained on this device until you close it." })] }), _jsx(DialogFooter, { children: _jsx(Button, { onClick: onClose, children: "Close" }) })] }) });
    return _jsx(Dialog, { open: true, onOpenChange: o => !o && !locked && onClose(), children: _jsxs(DialogContent, { className: "record-dialog", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { children: [update ? "Edit" : "Register", " ", kind] }), _jsx(DialogDescription, { children: kind === "battery" ? "Choose the responsible staff account and storage location. J18 placeholder rooms remain unverified; the room may be left unspecified." : kind === "building" ? "Use the campus building code and name. Only J18 is currently available for battery locations." : "Room locations are placeholders until their details have been verified. Cabinets and shelves remain outside the current scope." })] }), _jsxs("form", { onSubmit: submit, children: [kind === "battery" && !update && _jsx(BatteryModelPicker, { dataset: data.dataset, actorAccountId: data.user.id, canEditModels: getRolePermissions(data.user.role).editModels, values: values, selection: modelSelection, disabled: locked || contextChanged, onApply: applyModel, onManual: () => { setModelSelection(null); setAppliedModel(null); }, onBusyChange: setModelBusy }, `${data.dataset}/${data.user.id}`), _jsxs("div", { className: "form-grid", children: [(kind !== "room" || update) && field("id", kind === "building" ? "Building code" : `${kind.charAt(0).toUpperCase() + kind.slice(1)} ID`, true), field("name", "Name", true), kind === "battery" && _jsxs(_Fragment, { children: [field("chemistry", "Chemistry"), field("model", "Model"), field("capacityMah", "Capacity (mAh)", false, "number"), field("voltage", "Nominal voltage (V)", false, "number"), field("manufacturedOn", "Manufactured on", false, "date"), field("firstUsedOn", "First used on", false, "date"), _jsx("p", { className: "field-hint full-width", children: "Leave unknown dates blank. Age since manufacture and time in service are calculated from these dates using the current Sydney date." }), _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: "edit-owner", children: ["Responsible staff owner ", _jsx("span", { className: "required", children: "*" })] }), _jsx(RecordPicker, { id: "edit-owner", options: choices.people.filter(p => p.role === "staff" && p.accountId).map(p => { const account = choices.staffDirectory.find(a => a.id === p.accountId); return { id: p.id, label: `${staffIdentityLabel(p.name, account?.username, p.accountId || p.id)}${account && !account.active ? " — Inactive account" : ""}`, disabled: !account?.active }; }), value: value("ownerId"), onChange: v => set("ownerId", v), placeholder: "Select staff owner\u2026", disabled: locked })] }), _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: "edit-building", children: ["Storage building ", _jsx("span", { className: "required", children: "*" })] }), _jsx(RecordPicker, { id: "edit-building", options: buildingPickerOptions(choices.buildings), value: value("homeBuildingId"), onChange: v => { set("homeBuildingId", v); set("homeRoomId", ""); }, placeholder: update ? "Building not assigned" : "Select building…", disabled: locked }), _jsx("p", { className: "field-hint", children: "Only J18 is currently supported. Other campus buildings are unavailable." })] }), _jsxs("div", { className: "form-field full-width", children: [_jsx(Label, { htmlFor: "edit-room", children: "Storage room \u2014 optional" }), _jsx(RecordPicker, { id: "edit-room", options: isSupportedBuilding(value("homeBuildingId")) ? [{ id: "__unspecified", label: "Room not specified" }, ...roomPickerOptions(choices.rooms, value("homeBuildingId"))] : roomPickerOptions(choices.rooms, value("homeBuildingId")), value: isSupportedBuilding(value("homeBuildingId")) ? value("homeRoomId") || "__unspecified" : "__unavailable", onChange: v => set("homeRoomId", v === "__unspecified" ? "" : v), placeholder: isSupportedBuilding(value("homeBuildingId")) ? "Room not specified" : "Not available", disabled: locked || !isSupportedBuilding(value("homeBuildingId")) }), _jsx("p", { className: "field-hint", children: "Demo room and Demo workspace are virtual placeholders awaiting confirmed room information. Leave the room unspecified when unknown." })] }), _jsxs("div", { className: "form-field full-width", children: [field("tagId", "RFID tag identifier"), _jsx("p", { className: "field-hint", children: "Leave blank until a real tag identifier is known." })] })] }), kind === "room" && _jsxs(_Fragment, { children: [_jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: "edit-room-building", children: ["Building ", _jsx("span", { className: "required", children: "*" })] }), _jsx(RecordPicker, { id: "edit-room-building", options: buildingPickerOptions(choices.buildings), value: value("buildingId"), onChange: v => set("buildingId", v), placeholder: "Select building\u2026", disabled: locked })] }), field("number", "Room reference / number", true), _jsxs("div", { className: "form-field full-width", children: [_jsxs(Label, { htmlFor: "edit-placeholder", className: "flex items-center gap-2", children: [_jsx(Checkbox, { id: "edit-placeholder", checked: value("isPlaceholder") !== "false", onCheckedChange: checked => set("isPlaceholder", checked ? "true" : "false"), disabled: locked }), "Placeholder location \u2014 details not yet verified"] }), _jsx("p", { className: "field-hint", children: "Clear this only after the room name and location have been confirmed. Renaming a placeholder alone does not verify it." })] })] })] }), reviewNotice && _jsxs("div", { role: "status", className: "field-hint", children: [_jsx("p", { children: reviewNotice }), review.map(r => _jsxs("p", { children: [_jsx("strong", { children: r.field }), ": saved value ", r.saved, "; your edit ", value(r.key) || "Not recorded", "."] }, r.field))] }), contextChanged && _jsx("p", { role: "alert", className: "form-error", children: "The inventory or account changed. Close this form and reopen registration before saving." }), error && _jsx("p", { role: "alert", className: "form-error", children: error }), conflict && _jsx(Button, { type: "button", variant: "outline", onClick: loadLatest, disabled: locked, children: update ? "Review latest record" : "Reload choices" }), _jsxs(DialogFooter, { className: "form-footer", children: [_jsx(Button, { variant: "outline", type: "button", onClick: onClose, disabled: locked, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: locked || contextChanged || conflict || !permitted, children: busy ? "Saving…" : update ? "Save changes" : `Register ${kind}` })] })] })] }) });
}

export function RecordEditor(props) { if (props.draft.kind === "battery" && !props.draft.record) return _jsx(MobileRegistrationDialog, {data:props.data, initialTagId:props.draft.initialTagId, onClose:props.onClose}); return _jsx(LegacyRecordEditor, {...props}); }
