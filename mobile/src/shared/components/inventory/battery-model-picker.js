"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { RecordPicker } from "./record-picker.js";
import { numberOrNull } from "../../lib/client-utils.js";
import { modelFieldNames, modelFieldValue, newBatteryModelSchema, updateBatteryModelSchema } from "../../lib/battery-models.js";
const fieldLabels = { name: "Battery name", model: "Model", chemistry: "Chemistry", capacityMah: "Capacity (mAh)", voltage: "Nominal voltage (V)" };
const originLabels = { saved: "Saved model", inventory: "From registered batteries", reference: "Research reference" };
const choiceKey = (choice) => `${choice.origin}:${choice.id}`;
export function modelCreateStorageKey(actorAccountId, dataset) {
    return `battery-inventory/model-create/${encodeURIComponent(actorAccountId)}/${dataset}`;
}
export function recoverModelCreate(raw, actorAccountId, dataset) {
    if (!raw)
        return null;
    try {
        const attempt = JSON.parse(raw);
        if (attempt.dataset !== dataset || attempt.actorAccountId !== actorAccountId)
            return null;
        if (attempt.update === true)
            return { dataset, actorAccountId, update: true, payload: updateBatteryModelSchema.parse(attempt.payload) };
        if (attempt.update !== undefined)
            return null;
        return { dataset, actorAccountId, payload: newBatteryModelSchema.parse(attempt.payload) };
    }
    catch {
        return null;
    }
}
export function verifyModelCreateReceipt(body, attempt) {
    const receipt = body;
    const result = receipt?.result;
    const requestId = attempt.update ? attempt.payload.requestId : attempt.payload.id;
    if (receipt?.ok !== true || !result || result.requestId !== requestId || result.actorAccountId !== attempt.actorAccountId || result.dataset !== attempt.dataset || typeof result.replayed !== "boolean" || result.model?.origin !== "saved" || result.model.id !== attempt.payload.id || !/^[a-f0-9]{64}$/.test(result.model.contentHash) || (attempt.update && result.model.version !== attempt.payload.expectedVersion + 1)) {
        throw new Error("The saved-model response could not be verified. Retry the preserved request; do not submit another model.");
    }
    for (const key of ["brand", "model", "variant", "name", "chemistry", "capacityMah", "voltage", "notes"]) {
        if (result.model[key] !== attempt.payload[key])
            throw new Error("The saved model differs from the submitted template. Retry the preserved request before continuing.");
    }
    return result.model;
}
function errorMessage(error) {
    const issues = error?.issues;
    return issues?.[0]?.message || error?.message || "The model operation could not be completed.";
}
function safeSourceUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    }
    catch {
        return null;
    }
}
export function BatteryModelPicker({ dataset, actorAccountId, canEditModels, values, selection, disabled, onApply, onManual, onBusyChange }) {
    const [context] = useState(() => ({ dataset, actorAccountId }));
    const contextMatches = context.dataset === dataset && context.actorAccountId === actorAccountId;
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState(null);
    const [savedModels, setSavedModels] = useState([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [selectedHash, setSelectedHash] = useState("");
    const [excludedFields, setExcludedFields] = useState([]);
    const [approvedValues, setApprovedValues] = useState({});
    const [recovery] = useState(() => {
        try {
            const raw = window.__batteryWorkflowStorage.getItem(modelCreateStorageKey(actorAccountId, dataset));
            const attempt = recoverModelCreate(raw, actorAccountId, dataset);
            return { attempt, error: raw && !attempt ? "A saved model request could not be recovered. Preserve this tab and ask the administrator to review its saved request before creating another model." : "" };
        }
        catch {
            return { attempt: null, error: "" };
        }
    });
    const [adding, setAdding] = useState(!!recovery.attempt);
    const [editing, setEditing] = useState(() => recovery.attempt?.update ? { id: recovery.attempt.payload.id, expectedVersion: recovery.attempt.payload.expectedVersion } : null);
    const [editConflict, setEditConflict] = useState(false), [modelReview, setModelReview] = useState(null);
    const [draft, setDraft] = useState(() => recovery.attempt ? Object.fromEntries(Object.entries(recovery.attempt.payload).map(([key, value]) => [key, value == null ? "" : String(value)])) : {});
    const [pending, setPending] = useState(recovery.attempt);
    const [saving, setSaving] = useState(false), [error, setError] = useState(recovery.error), [notice, setNotice] = useState("");
    const live = useRef(true), submitting = useRef(false);
    useEffect(() => {
        live.current = contextMatches;
        return () => { live.current = false; if (submitting.current)
            onBusyChange(false); };
    }, [contextMatches, dataset, actorAccountId, onBusyChange]);
    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        fetch(`/api/battery-models?dataset=${dataset}`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error || "Battery models could not be loaded. Manual registration remains available.");
            if (body.dataset !== dataset || !Array.isArray(body.models) || !Array.isArray(body.issues))
                throw new Error("Battery models could not be verified for this inventory. Manual registration remains available.");
            if (active)
                setLoaded({ ...body, actorAccountId, revision, error: "" });
        }).catch(error => {
            if (active && !abort.signal.aborted)
                setLoaded({ dataset, actorAccountId, revision, models: [], issues: [], error: errorMessage(error) });
        });
        return () => { active = false; abort.abort(); };
    }, [dataset, actorAccountId, revision]);
    const current = loaded?.dataset === dataset && loaded.actorAccountId === actorAccountId && loaded.revision === revision;
    const loading = !current;
    const models = new Map((current ? loaded.models : []).map(model => [choiceKey(model), model]));
    if (contextMatches)
        for (const model of savedModels) {
            const currentModel = models.get(choiceKey(model));
            if (!currentModel || (model.version ?? 0) > (currentModel.version ?? 0))
                models.set(choiceKey(model), model);
        }
    const choices = [...models.values()];
    const choice = contextMatches ? models.get(selectedKey) : undefined;
    const conflicts = (field) => !!values[field]?.trim() && values[field] !== (choice ? modelFieldValue(choice, field) : "");
    const appliedFields = choice ? modelFieldNames.filter(field => modelFieldValue(choice, field) !== "" && !excludedFields.includes(field) && (!conflicts(field) || (selectedHash === choice.contentHash && approvedValues[field] === values[field]))) : [];
    const blocked = disabled || saving || !contextMatches;
    const editAccessLost = !!editing && !canEditModels;
    function selectModel(key, hash) { setSelectedKey(key); setSelectedHash(hash ?? models.get(key)?.contentHash ?? ""); setExcludedFields([]); setApprovedValues({}); setNotice(""); }
    function reviewField(field, checked) {
        setExcludedFields(fields => checked ? fields.filter(item => item !== field) : [...new Set([...fields, field])]);
        setSelectedHash(choice?.contentHash ?? "");
        setApprovedValues(approved => ({ ...approved, [field]: checked ? values[field] ?? "" : undefined }));
    }
    function openNewModel() {
        if (blocked || recovery.error)
            return;
        if (!pending)
            setDraft({ brand: "", variant: "", notes: "", ...Object.fromEntries(modelFieldNames.map(field => [field, values[field] ?? ""])) });
        setEditing(null);
        setEditConflict(false);
        setModelReview(null);
        setError("");
        setNotice("");
        setAdding(true);
    }
    function openEditModel() {
        if (blocked || adding || !canEditModels || !choice || choice.origin !== "saved" || !choice.version)
            return;
        setDraft(Object.fromEntries(["brand", "model", "variant", "name", "chemistry", "capacityMah", "voltage", "notes"].map(key => [key, choice[key] == null ? "" : String(choice[key])])));
        setEditing({ id: choice.id, expectedVersion: choice.version });
        setEditConflict(false);
        setModelReview(null);
        setError("");
        setNotice("");
        setAdding(true);
    }
    async function reviewLatestModel() {
        if (blocked || !editing || pending || editAccessLost)
            return;
        submitting.current = true;
        setSaving(true);
        onBusyChange(true);
        setError("");
        try {
            const response = await fetch(`/api/battery-models?dataset=${dataset}`, { cache: "no-store" });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.error || "The latest model could not be loaded. Your draft is retained.");
            if (body.dataset !== dataset || !Array.isArray(body.models) || !Array.isArray(body.issues))
                throw new Error("The latest model could not be verified for this inventory.");
            const model = body.models.find(model => model.origin === "saved" && model.id === editing.id);
            if (!model?.version)
                throw new Error("This saved model is no longer available. Your draft is retained.");
            if (!live.current)
                return;
            setLoaded({ ...body, actorAccountId, revision, error: "" });
            setModelReview(model);
            setNotice("Latest model loaded. Your complete draft is retained. Compare the differences below before using the reviewed version.");
        }
        catch (error) {
            if (live.current)
                setError(errorMessage(error));
        }
        finally {
            submitting.current = false;
            if (live.current) {
                setSaving(false);
                onBusyChange(false);
            }
        }
    }
    async function saveModel() {
        if (blocked || submitting.current || recovery.error || editConflict || (editAccessLost && !pending))
            return;
        submitting.current = true;
        setSaving(true);
        onBusyChange(true);
        setError("");
        setNotice("");
        let attempt = pending;
        try {
            if (!attempt) {
                const fields = { id: editing?.id ?? crypto.randomUUID(), brand: draft.brand || "", model: draft.model || "", variant: draft.variant || "", name: draft.name || "", chemistry: draft.chemistry || "", capacityMah: numberOrNull(draft.capacityMah || "", "Capacity"), voltage: numberOrNull(draft.voltage || "", "Nominal voltage"), notes: draft.notes || "" };
                const payload = editing ? updateBatteryModelSchema.parse({ ...fields, expectedVersion: editing.expectedVersion, requestId: crypto.randomUUID() }) : newBatteryModelSchema.parse(fields);
                attempt = { dataset, actorAccountId, payload, ...(editing ? { update: true } : {}) };
                try {
                    window.__batteryWorkflowStorage.setItem(modelCreateStorageKey(actorAccountId, dataset), JSON.stringify(attempt));
                }
                catch {
                    throw new Error("This tab could not preserve the model request. No model was submitted. Enable browser storage or continue with manual battery details.");
                }
                setPending(attempt);
            }
            const response = await fetch("/api/battery-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: attempt.dataset, payload: attempt.payload, ...(attempt.update ? { update: true } : {}) }) });
            const body = await response.json();
            if (!response.ok) {
                if ([400, 404, 409, 422].includes(response.status)) {
                    window.__batteryWorkflowStorage.removeItem(modelCreateStorageKey(actorAccountId, dataset));
                    if (live.current)
                        setPending(null);
                }
                if (live.current && attempt.update && body.code === "model_conflict")
                    setEditConflict(true);
                throw new Error([401, 403].includes(response.status) ? `${body.error || "Account access needs review."} Sign in with the original account, then retry the preserved model request.` : body.error || "The reusable model could not be saved.");
            }
            const model = verifyModelCreateReceipt(body, attempt);
            window.__batteryWorkflowStorage.removeItem(modelCreateStorageKey(actorAccountId, dataset));
            if (!live.current)
                return;
            setSavedModels(models => [...models.filter(saved => choiceKey(saved) !== choiceKey(model)), model]);
            setPending(null);
            setAdding(false);
            setEditing(null);
            selectModel(choiceKey(model), model.contentHash);
            setRevision(value => value + 1);
            setNotice(attempt.update ? "Reusable model updated. Existing batteries and this battery form are unchanged. Review the refreshed model and choose Use this model if needed." : "Model saved for reuse in this inventory. Review it and choose Use this model to fill the battery form. The physical battery has not been registered.");
        }
        catch (error) {
            if (live.current)
                setError(errorMessage(error));
        }
        finally {
            submitting.current = false;
            if (live.current) {
                setSaving(false);
                onBusyChange(false);
            }
        }
    }
    function templateField(key, label, required = false, type = "text", maxLength) {
        return _jsxs("div", { className: "form-field", children: [_jsxs(Label, { htmlFor: `new-model-${key}`, children: [label, required && _jsx("span", { className: "required", children: " *" })] }), _jsx(Input, { id: `new-model-${key}`, form: "battery-model-template", type: type, value: draft[key] ?? "", onChange: event => setDraft(previous => ({ ...previous, [key]: event.target.value })), disabled: blocked || !!pending, maxLength: maxLength, min: type === "number" ? 0 : undefined, step: type === "number" ? "any" : undefined })] });
    }
    return _jsxs("section", { className: "battery-model-picker", "aria-label": "Battery model assistance", "aria-busy": saving, children: [_jsxs("div", { className: "battery-model-picker-heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "Battery model \u2014 optional" }), _jsx("p", { className: "field-hint", children: "Reuse saved specifications or register a battery manually. Owners, tags, dates and locations are entered separately." })] }), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: openNewModel, disabled: blocked || !!recovery.error || adding, children: "Add reusable model" })] }), !contextMatches && _jsx("p", { role: "alert", className: "form-error", children: "The inventory or account changed. Reopen registration before using a model." }), _jsx(Label, { htmlFor: "edit-model-template", children: "Find a model" }), _jsx(RecordPicker, { id: "edit-model-template", options: choices.map(model => ({ id: choiceKey(model), label: `${model.label} — ${originLabels[model.origin]}` })), value: selectedKey, onChange: selectModel, placeholder: loading ? "Loading battery models…" : "Search model, brand or variant…", disabled: blocked || loading }), _jsxs("div", { className: "battery-model-picker-actions", children: [_jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => setRevision(value => value + 1), disabled: blocked || loading, children: "Reload models" }), _jsx(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => { selectModel(""); onManual(); setNotice("Manual details selected. Existing form values are retained."); }, disabled: blocked || (!choice && !selection), children: "Use manual details" })] }), current && loaded.error && _jsx("p", { role: "alert", className: "form-error", children: loaded.error }), current && loaded.issues.length > 0 && _jsxs("details", { className: "battery-model-issues", children: [_jsxs("summary", { children: ["Some reference models need review (", loaded.issues.length, ")"] }), _jsx("ul", { children: loaded.issues.map((issue, index) => _jsxs("li", { children: [issue.model, ": ", issue.message] }, `${issue.model}-${index}`)) })] }), choice && _jsxs("div", { className: "battery-model-preview", children: [_jsx("strong", { children: choice.label }), _jsxs("p", { className: "field-hint", children: [originLabels[choice.origin], " \u00B7 ", choice.verificationStatus.replaceAll("_", " ")] }), _jsxs("dl", { children: [_jsx("dt", { children: "Brand" }), _jsx("dd", { children: choice.brand || "Not recorded" }), _jsx("dt", { children: "Model" }), _jsx("dd", { children: choice.model || "Not recorded" }), _jsx("dt", { children: "Variant" }), _jsx("dd", { children: choice.variant || "Not recorded" }), _jsx("dt", { children: "Capacity basis" }), _jsx("dd", { children: choice.capacityBasis || "Not recorded" })] }), choice.warnings.length > 0 && _jsxs("p", { className: "battery-model-warnings", children: [_jsx("strong", { children: "Review before use:" }), " ", choice.warnings[0], choice.warnings.length > 1 ? ` (${choice.warnings.length} recorded limitations)` : ""] }), (choice.notes || choice.warnings.length > 0) && _jsxs("details", { children: [_jsxs("summary", { children: ["Notes and limitations", choice.warnings.length > 0 ? ` (${choice.warnings.length})` : ""] }), choice.notes && _jsx("p", { className: "field-hint", children: choice.notes }), choice.warnings.length > 0 && _jsx("ul", { className: "battery-model-warnings", children: choice.warnings.map((warning, index) => _jsx("li", { children: warning }, index)) })] }), choice.sources.length > 0 && _jsxs("details", { children: [_jsxs("summary", { children: ["Reference sources (", choice.sources.length, ")"] }), _jsx("ul", { children: choice.sources.map(source => { const url = safeSourceUrl(source.url); return _jsx("li", { children: url ? _jsx("a", { href: url, target: "_blank", rel: "noopener noreferrer", children: source.title || "Source" }) : source.title || "Source link unavailable" }, source.id); }) })] }), _jsxs("fieldset", { className: "battery-model-fields", children: [_jsx("legend", { children: "Information to use" }), _jsx("p", { className: "field-hint", children: "Check the exact model and variant. Different values you entered stay unchanged unless selected below." }), modelFieldNames.map(field => { const suggested = modelFieldValue(choice, field); const conflict = !!suggested && conflicts(field); return _jsxs(Label, { htmlFor: `use-model-${field}`, className: "battery-model-field", children: [_jsx(Checkbox, { id: `use-model-${field}`, checked: appliedFields.includes(field), onCheckedChange: checked => reviewField(field, checked === true), disabled: blocked || !suggested }), _jsxs("span", { children: [_jsx("strong", { children: fieldLabels[field] }), ": ", suggested || "Not recorded", conflict && _jsxs("small", { children: ["Currently entered: ", values[field], ". Select to replace this value."] }), !suggested && _jsx("small", { children: "Your value is retained." })] })] }, field); })] }), canEditModels && choice.origin === "saved" && _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: openEditModel, disabled: blocked || loading || adding || !choice.version, children: "Edit saved model" }), " ", _jsx(Button, { type: "button", size: "sm", onClick: () => { if (!blocked && !loading && appliedFields.length) {
                            onApply(choice, appliedFields);
                            setNotice(`Applied ${appliedFields.length} model ${appliedFields.length === 1 ? "field" : "fields"}. Review the battery details before registering.`);
                        } }, disabled: blocked || loading || !appliedFields.length, children: "Use this model" })] }), selection && _jsxs("p", { className: "field-hint", children: ["Applied model: ", models.get(`${selection.origin}:${selection.id}`)?.label || selection.id, ". ", selection.appliedFields.length, " ", selection.appliedFields.length === 1 ? "field remains" : "fields remain", " linked to its suggestions; your individual battery edits are retained."] }), adding && _jsxs("fieldset", { className: "battery-model-create", children: [_jsx("legend", { children: editing ? "Edit reusable model" : "Add reusable model" }), _jsxs("p", { className: "field-hint", children: [editing ? "Changes affect future model suggestions; existing batteries remain unchanged." : "This saves a specification template for staff in this inventory.", " It does not register a physical battery. Leave unknown specifications blank."] }), _jsxs("div", { className: "form-grid", children: [templateField("brand", "Brand / manufacturer", false, "text", 80), templateField("model", "Model", true, "text", 120), templateField("variant", "Variant / configuration", false, "text", 120), templateField("name", "Suggested battery name", true, "text", 120), templateField("chemistry", "Chemistry", false, "text", 40), templateField("capacityMah", "Capacity (mAh)", false, "number"), templateField("voltage", "Nominal voltage (V)", false, "number"), _jsxs("div", { className: "form-field full-width", children: [_jsx(Label, { htmlFor: "new-model-notes", children: "Notes \u2014 optional" }), _jsx(Textarea, { form: "battery-model-template", id: "new-model-notes", value: draft.notes ?? "", maxLength: 1000, onChange: event => setDraft(previous => ({ ...previous, notes: event.target.value })), disabled: blocked || !!pending })] })] }), editConflict && _jsxs("div", { className: "battery-model-review", children: [_jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: reviewLatestModel, disabled: blocked, children: "Review latest model" }), modelReview && _jsxs(_Fragment, { children: [_jsxs("p", { className: "field-hint", children: ["Latest saved version: ", modelReview.version, ". Your draft has not been changed."] }), ["brand", "model", "variant", "name", "chemistry", "capacityMah", "voltage", "notes"].filter(key => (draft[key] ?? "") !== (modelReview[key] == null ? "" : String(modelReview[key]))).map(key => _jsxs("p", { className: "field-hint", children: [_jsx("strong", { children: fieldLabels[key] || key.charAt(0).toUpperCase() + key.slice(1) }), ": latest ", modelReview[key] == null || modelReview[key] === "" ? "Not recorded" : String(modelReview[key]), "; your draft ", draft[key] || "Not recorded", "."] }, key)), _jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => { if (!blocked && editing && modelReview.version) {
                                            setEditing({ id: editing.id, expectedVersion: modelReview.version });
                                            setEditConflict(false);
                                            setModelReview(null);
                                            setError("");
                                            setNotice("Reviewed version selected. Your draft is retained; Save model changes submits it against that version.");
                                        } }, disabled: blocked, children: "Use reviewed version" })] })] }), pending && _jsx("p", { role: "status", className: "field-hint", children: "The original request is preserved. If the result was interrupted, Retry saved model request uses the same details and ID; it cannot create a second model." }), _jsxs("div", { className: "battery-model-picker-actions", children: [_jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => { setAdding(false); setEditing(null); setEditConflict(false); setModelReview(null); }, disabled: blocked || !!pending, children: "Cancel model" }), _jsx(Button, { type: "button", size: "sm", onClick: saveModel, disabled: blocked || !!recovery.error || editConflict || (editAccessLost && !pending), children: saving ? "Saving model…" : pending ? "Retry saved model request" : editing ? "Save model changes" : "Save reusable model" })] })] }), editAccessLost && _jsx("p", { role: "alert", className: "form-error", children: "New edits to saved models require administrator access. Your draft and any unconfirmed request are retained; an exact retry is checked by the server and may require restoring the original administrator access." }), error && _jsx("p", { role: "alert", className: "form-error", children: error }), notice && _jsx("p", { role: "status", className: "field-hint", children: notice })] });
}
