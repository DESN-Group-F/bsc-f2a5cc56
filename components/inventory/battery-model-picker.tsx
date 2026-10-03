"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecordPicker } from "./record-picker";
import type { Dataset } from "@/lib/domain";
import { numberOrNull } from "@/lib/client-utils";
import { modelFieldNames, modelFieldValue, newBatteryModelSchema, updateBatteryModelSchema, type BatteryModelChoice, type ModelField, type ModelSelection, type NewBatteryModel, type UpdateBatteryModel } from "@/lib/battery-models";

type ModelResponse = { dataset: Dataset; models: BatteryModelChoice[]; issues: { model: string; message: string }[] };
type ModelAttempt = { dataset: Dataset; actorAccountId: string; payload: NewBatteryModel | UpdateBatteryModel; update?: true };
type ModelReceipt = { ok: true; result: { model: BatteryModelChoice; requestId: string; actorAccountId: string; dataset: Dataset; replayed: boolean } };
const fieldLabels: Record<ModelField, string> = { name: "Battery name", model: "Model", chemistry: "Chemistry", capacityMah: "Capacity (mAh)", voltage: "Nominal voltage (V)" };
const originLabels = { saved: "Saved model", inventory: "From registered batteries", reference: "Research reference" };
const choiceKey = (choice: BatteryModelChoice) => `${choice.origin}:${choice.id}`;

export function modelCreateStorageKey(actorAccountId: string, dataset: Dataset) {
    return `battery-inventory/model-create/${encodeURIComponent(actorAccountId)}/${dataset}`;
}
export function recoverModelCreate(raw: string | null, actorAccountId: string, dataset: Dataset): ModelAttempt | null {
    if (!raw) return null;
    try {
        const attempt = JSON.parse(raw) as ModelAttempt;
        if (attempt.dataset !== dataset || attempt.actorAccountId !== actorAccountId) return null;
        if (attempt.update === true) return { dataset, actorAccountId, update: true, payload: updateBatteryModelSchema.parse(attempt.payload) };
        if (attempt.update !== undefined) return null;
        return { dataset, actorAccountId, payload: newBatteryModelSchema.parse(attempt.payload) };
    } catch { return null; }
}
export function verifyModelCreateReceipt(body: unknown, attempt: ModelAttempt): BatteryModelChoice {
    const receipt = body as Partial<ModelReceipt> | null;
    const result = receipt?.result;
    const requestId = attempt.update ? (attempt.payload as UpdateBatteryModel).requestId : attempt.payload.id;
    if (receipt?.ok !== true || !result || result.requestId !== requestId || result.actorAccountId !== attempt.actorAccountId || result.dataset !== attempt.dataset || typeof result.replayed !== "boolean" || result.model?.origin !== "saved" || result.model.id !== attempt.payload.id || !/^[a-f0-9]{64}$/.test(result.model.contentHash) || (attempt.update && result.model.version !== (attempt.payload as UpdateBatteryModel).expectedVersion + 1)) {
        throw new Error("The saved-model response could not be verified. Retry the preserved request; do not submit another model.");
    }
    for (const key of ["brand", "model", "variant", "name", "chemistry", "capacityMah", "voltage", "notes"] as const) {
        if (result.model[key] !== attempt.payload[key]) throw new Error("The saved model differs from the submitted template. Retry the preserved request before continuing.");
    }
    return result.model;
}
function errorMessage(error: unknown) {
    const issues = (error as { issues?: { message: string }[] })?.issues;
    return issues?.[0]?.message || (error as Error)?.message || "The model operation could not be completed.";
}
function safeSourceUrl(value: string) {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; }
    catch { return null; }
}

export function BatteryModelPicker({ dataset, actorAccountId, canEditModels, values, selection, disabled, onApply, onManual, onBusyChange }: {
    dataset: Dataset;
    actorAccountId: string;
    canEditModels: boolean;
    values: Record<string, string>;
    selection: ModelSelection | null;
    disabled: boolean;
    onApply: (choice: BatteryModelChoice, fields: ModelField[]) => void;
    onManual: () => void;
    onBusyChange: (busy: boolean) => void;
}) {
    const [context] = useState(() => ({ dataset, actorAccountId }));
    const contextMatches = context.dataset === dataset && context.actorAccountId === actorAccountId;
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<(ModelResponse & { actorAccountId: string; revision: number; error: string }) | null>(null);
    const [savedModels, setSavedModels] = useState<BatteryModelChoice[]>([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [selectedHash, setSelectedHash] = useState("");
    const [excludedFields, setExcludedFields] = useState<ModelField[]>([]);
    const [approvedValues, setApprovedValues] = useState<Partial<Record<ModelField, string>>>({});
    const [recovery] = useState(() => {
        try {
            const raw = sessionStorage.getItem(modelCreateStorageKey(actorAccountId, dataset));
            const attempt = recoverModelCreate(raw, actorAccountId, dataset);
            return { attempt, error: raw && !attempt ? "A saved model request could not be recovered. Preserve this tab and ask the administrator to review its saved request before creating another model." : "" };
        } catch { return { attempt: null, error: "" }; }
    });
    const [adding, setAdding] = useState(!!recovery.attempt);
    const [editing, setEditing] = useState<{ id: string; expectedVersion: number } | null>(() => recovery.attempt?.update ? { id: recovery.attempt.payload.id, expectedVersion: (recovery.attempt.payload as UpdateBatteryModel).expectedVersion } : null);
    const [editConflict, setEditConflict] = useState(false), [modelReview, setModelReview] = useState<BatteryModelChoice | null>(null);
    const [draft, setDraft] = useState<Record<string, string>>(() => recovery.attempt ? Object.fromEntries(Object.entries(recovery.attempt.payload).map(([key, value]) => [key, value == null ? "" : String(value)])) : {});
    const [pending, setPending] = useState<ModelAttempt | null>(recovery.attempt);
    const [saving, setSaving] = useState(false), [error, setError] = useState(recovery.error), [notice, setNotice] = useState("");
    const live = useRef(true), submitting = useRef(false);
    useEffect(() => {
        live.current = contextMatches;
        return () => { live.current = false; if (submitting.current) onBusyChange(false); };
    }, [contextMatches, dataset, actorAccountId, onBusyChange]);
    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        fetch(`/api/battery-models?dataset=${dataset}`, { cache: "no-store", signal: abort.signal }).then(async response => {
            const body = await response.json() as ModelResponse & { error?: string };
            if (!response.ok) throw new Error(body.error || "Battery models could not be loaded. Manual registration remains available.");
            if (body.dataset !== dataset || !Array.isArray(body.models) || !Array.isArray(body.issues)) throw new Error("Battery models could not be verified for this inventory. Manual registration remains available.");
            if (active) setLoaded({ ...body, actorAccountId, revision, error: "" });
        }).catch(error => {
            if (active && !abort.signal.aborted) setLoaded({ dataset, actorAccountId, revision, models: [], issues: [], error: errorMessage(error) });
        });
        return () => { active = false; abort.abort(); };
    }, [dataset, actorAccountId, revision]);
    const current = loaded?.dataset === dataset && loaded.actorAccountId === actorAccountId && loaded.revision === revision;
    const loading = !current;
    const models = new Map((current ? loaded.models : []).map(model => [choiceKey(model), model]));
    if (contextMatches) for (const model of savedModels) {
        const currentModel = models.get(choiceKey(model));
        if (!currentModel || (model.version ?? 0) > (currentModel.version ?? 0)) models.set(choiceKey(model), model);
    }
    const choices = [...models.values()];
    const choice = contextMatches ? models.get(selectedKey) : undefined;
    const conflicts = (field: ModelField) => !!values[field]?.trim() && values[field] !== (choice ? modelFieldValue(choice, field) : "");
    const appliedFields = choice ? modelFieldNames.filter(field => modelFieldValue(choice, field) !== "" && !excludedFields.includes(field) && (!conflicts(field) || (selectedHash === choice.contentHash && approvedValues[field] === values[field]))) : [];
    const blocked = disabled || saving || !contextMatches;
    function selectModel(key: string, hash?: string) { setSelectedKey(key); setSelectedHash(hash ?? models.get(key)?.contentHash ?? ""); setExcludedFields([]); setApprovedValues({}); setNotice(""); }
    function reviewField(field: ModelField, checked: boolean) {
        setExcludedFields(fields => checked ? fields.filter(item => item !== field) : [...new Set([...fields, field])]);
        setSelectedHash(choice?.contentHash ?? "");
        setApprovedValues(approved => ({ ...approved, [field]: checked ? values[field] ?? "" : undefined }));
    }
    function openNewModel() {
        if (blocked || recovery.error) return;
        if (!pending) setDraft({ brand: "", variant: "", notes: "", ...Object.fromEntries(modelFieldNames.map(field => [field, values[field] ?? ""])) });
        setEditing(null); setEditConflict(false); setModelReview(null);
        setError(""); setNotice(""); setAdding(true);
    }
    function openEditModel() {
        if (blocked || adding || !canEditModels || !choice || choice.origin !== "saved" || !choice.version) return;
        setDraft(Object.fromEntries(["brand", "model", "variant", "name", "chemistry", "capacityMah", "voltage", "notes"].map(key => [key, choice[key as keyof BatteryModelChoice] == null ? "" : String(choice[key as keyof BatteryModelChoice])])));
        setEditing({ id: choice.id, expectedVersion: choice.version }); setEditConflict(false); setModelReview(null); setError(""); setNotice(""); setAdding(true);
    }
    async function reviewLatestModel() {
        if (blocked || !editing || pending) return;
        submitting.current = true; setSaving(true); onBusyChange(true); setError("");
        try {
            const response = await fetch(`/api/battery-models?dataset=${dataset}`, { cache: "no-store" });
            const body = await response.json() as ModelResponse & { error?: string };
            if (!response.ok) throw new Error(body.error || "The latest model could not be loaded. Your draft is retained.");
            if (body.dataset !== dataset || !Array.isArray(body.models) || !Array.isArray(body.issues)) throw new Error("The latest model could not be verified for this inventory.");
            const model = body.models.find(model => model.origin === "saved" && model.id === editing.id);
            if (!model?.version) throw new Error("This saved model is no longer available. Your draft is retained.");
            if (!live.current) return;
            setLoaded({ ...body, actorAccountId, revision, error: "" }); setModelReview(model);
            setNotice("Latest model loaded. Your complete draft is retained. Compare the differences below before using the reviewed version.");
        } catch (error) { if (live.current) setError(errorMessage(error)); }
        finally { submitting.current = false; if (live.current) { setSaving(false); onBusyChange(false); } }
    }
    async function saveModel() {
        if (blocked || submitting.current || recovery.error || editConflict) return;
        submitting.current = true; setSaving(true); onBusyChange(true); setError(""); setNotice("");
        let attempt = pending;
        try {
            if (!attempt) {
                const fields = { id: editing?.id ?? crypto.randomUUID(), brand: draft.brand || "", model: draft.model || "", variant: draft.variant || "", name: draft.name || "", chemistry: draft.chemistry || "", capacityMah: numberOrNull(draft.capacityMah || "", "Capacity"), voltage: numberOrNull(draft.voltage || "", "Nominal voltage"), notes: draft.notes || "" };
                const payload = editing ? updateBatteryModelSchema.parse({ ...fields, expectedVersion: editing.expectedVersion, requestId: crypto.randomUUID() }) : newBatteryModelSchema.parse(fields);
                attempt = { dataset, actorAccountId, payload, ...(editing ? { update: true } : {}) };
                try { sessionStorage.setItem(modelCreateStorageKey(actorAccountId, dataset), JSON.stringify(attempt)); }
                catch { throw new Error("This tab could not preserve the model request. No model was submitted. Enable browser storage or continue with manual battery details."); }
                setPending(attempt);
            }
            const response = await fetch("/api/battery-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: attempt.dataset, payload: attempt.payload, ...(attempt.update ? { update: true } : {}) }) });
            const body = await response.json() as ModelReceipt & { error?: string; code?: string };
            if (!response.ok) {
                if ([400, 404, 409, 422].includes(response.status)) {
                    sessionStorage.removeItem(modelCreateStorageKey(actorAccountId, dataset));
                    if (live.current) setPending(null);
                }
                if (live.current && attempt.update && body.code === "model_conflict") setEditConflict(true);
                throw new Error([401, 403].includes(response.status) ? `${body.error || "Account access needs review."} Sign in with the original account, then retry the preserved model request.` : body.error || "The reusable model could not be saved.");
            }
            const model = verifyModelCreateReceipt(body, attempt);
            sessionStorage.removeItem(modelCreateStorageKey(actorAccountId, dataset));
            if (!live.current) return;
            setSavedModels(models => [...models.filter(saved => choiceKey(saved) !== choiceKey(model)), model]);
            setPending(null); setAdding(false); setEditing(null); selectModel(choiceKey(model), model.contentHash); setRevision(value => value + 1);
            setNotice(attempt.update ? "Reusable model updated. Existing batteries and this battery form are unchanged. Review the refreshed model and choose Use this model if needed." : "Model saved for reuse in this inventory. Review it and choose Use this model to fill the battery form. The physical battery has not been registered.");
        } catch (error) {
            if (live.current) setError(errorMessage(error));
        } finally {
            submitting.current = false;
            if (live.current) { setSaving(false); onBusyChange(false); }
        }
    }
    function templateField(key: string, label: string, required = false, type = "text", maxLength?: number) {
        return <div className="form-field"><Label htmlFor={`new-model-${key}`}>{label}{required && <span className="required"> *</span>}</Label><Input id={`new-model-${key}`} form="battery-model-template" type={type} value={draft[key] ?? ""} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} disabled={blocked || !!pending} maxLength={maxLength} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined}/></div>;
    }
    return <section className="battery-model-picker" aria-label="Battery model assistance" aria-busy={saving}>
        <div className="battery-model-picker-heading"><div><h3>Battery model — optional</h3><p className="field-hint">Reuse saved specifications or register a battery manually. Owners, tags, dates and locations are entered separately.</p></div><Button type="button" variant="outline" size="sm" onClick={openNewModel} disabled={blocked || !!recovery.error || adding}>Add reusable model</Button></div>
        {!contextMatches && <p role="alert" className="form-error">The inventory or account changed. Reopen registration before using a model.</p>}
        <Label htmlFor="edit-model-template">Find a model</Label><RecordPicker id="edit-model-template" options={choices.map(model => ({ id: choiceKey(model), label: `${model.label} — ${originLabels[model.origin]}` }))} value={selectedKey} onChange={selectModel} placeholder={loading ? "Loading battery models…" : "Search model, brand or variant…"} disabled={blocked || loading}/>
        <div className="battery-model-picker-actions"><Button type="button" variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)} disabled={blocked || loading}>Reload models</Button><Button type="button" variant="ghost" size="sm" onClick={() => { selectModel(""); onManual(); setNotice("Manual details selected. Existing form values are retained."); }} disabled={blocked || (!choice && !selection)}>Use manual details</Button></div>
        {current && loaded.error && <p role="alert" className="form-error">{loaded.error}</p>}
        {current && loaded.issues.length > 0 && <details className="battery-model-issues"><summary>Some reference models need review ({loaded.issues.length})</summary><ul>{loaded.issues.map((issue, index) => <li key={`${issue.model}-${index}`}>{issue.model}: {issue.message}</li>)}</ul></details>}
        {choice && <div className="battery-model-preview"><strong>{choice.label}</strong><p className="field-hint">{originLabels[choice.origin]} · {choice.verificationStatus.replaceAll("_", " ")}</p><dl><dt>Brand</dt><dd>{choice.brand || "Not recorded"}</dd><dt>Model</dt><dd>{choice.model || "Not recorded"}</dd><dt>Variant</dt><dd>{choice.variant || "Not recorded"}</dd><dt>Capacity basis</dt><dd>{choice.capacityBasis || "Not recorded"}</dd></dl>{choice.warnings.length > 0 && <p className="battery-model-warnings"><strong>Review before use:</strong> {choice.warnings[0]}{choice.warnings.length > 1 ? ` (${choice.warnings.length} recorded limitations)` : ""}</p>}{(choice.notes || choice.warnings.length > 0) && <details><summary>Notes and limitations{choice.warnings.length > 0 ? ` (${choice.warnings.length})` : ""}</summary>{choice.notes && <p className="field-hint">{choice.notes}</p>}{choice.warnings.length > 0 && <ul className="battery-model-warnings">{choice.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</details>}{choice.sources.length > 0 && <details><summary>Reference sources ({choice.sources.length})</summary><ul>{choice.sources.map(source => { const url = safeSourceUrl(source.url); return <li key={source.id}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title || "Source"}</a> : source.title || "Source link unavailable"}</li>; })}</ul></details>}
            <fieldset className="battery-model-fields"><legend>Information to use</legend><p className="field-hint">Check the exact model and variant. Different values you entered stay unchanged unless selected below.</p>{modelFieldNames.map(field => { const suggested = modelFieldValue(choice, field); const conflict = !!suggested && conflicts(field); return <Label htmlFor={`use-model-${field}`} key={field} className="battery-model-field"><Checkbox id={`use-model-${field}`} checked={appliedFields.includes(field)} onCheckedChange={checked => reviewField(field, checked === true)} disabled={blocked || !suggested}/><span><strong>{fieldLabels[field]}</strong>: {suggested || "Not recorded"}{conflict && <small>Currently entered: {values[field]}. Select to replace this value.</small>}{!suggested && <small>Your value is retained.</small>}</span></Label>; })}</fieldset>
            {canEditModels && choice.origin === "saved" && <Button type="button" variant="outline" size="sm" onClick={openEditModel} disabled={blocked || loading || adding || !choice.version}>Edit saved model</Button>} <Button type="button" size="sm" onClick={() => { if (!blocked && !loading && appliedFields.length) { onApply(choice, appliedFields); setNotice(`Applied ${appliedFields.length} model ${appliedFields.length === 1 ? "field" : "fields"}. Review the battery details before registering.`); } }} disabled={blocked || loading || !appliedFields.length}>Use this model</Button>
        </div>}
        {selection && <p className="field-hint">Applied model: {models.get(`${selection.origin}:${selection.id}`)?.label || selection.id}. {selection.appliedFields.length} {selection.appliedFields.length === 1 ? "field remains" : "fields remain"} linked to its suggestions; your individual battery edits are retained.</p>}
        {adding && <fieldset className="battery-model-create"><legend>{editing ? "Edit reusable model" : "Add reusable model"}</legend><p className="field-hint">{editing ? "Changes affect future model suggestions; existing batteries remain unchanged." : "This saves a specification template for staff in this inventory."} It does not register a physical battery. Leave unknown specifications blank.</p><div className="form-grid">{templateField("brand", "Brand / manufacturer", false, "text", 80)}{templateField("model", "Model", true, "text", 120)}{templateField("variant", "Variant / configuration", false, "text", 120)}{templateField("name", "Suggested battery name", true, "text", 120)}{templateField("chemistry", "Chemistry", false, "text", 40)}{templateField("capacityMah", "Capacity (mAh)", false, "number")}{templateField("voltage", "Nominal voltage (V)", false, "number")}<div className="form-field full-width"><Label htmlFor="new-model-notes">Notes — optional</Label><Textarea form="battery-model-template" id="new-model-notes" value={draft.notes ?? ""} maxLength={1000} onChange={event => setDraft(previous => ({ ...previous, notes: event.target.value }))} disabled={blocked || !!pending}/></div></div>{editConflict && <div className="battery-model-review"><Button type="button" variant="outline" size="sm" onClick={reviewLatestModel} disabled={blocked}>Review latest model</Button>{modelReview && <><p className="field-hint">Latest saved version: {modelReview.version}. Your draft has not been changed.</p>{["brand", "model", "variant", "name", "chemistry", "capacityMah", "voltage", "notes"].filter(key => (draft[key] ?? "") !== (modelReview[key as keyof BatteryModelChoice] == null ? "" : String(modelReview[key as keyof BatteryModelChoice]))).map(key => <p key={key} className="field-hint"><strong>{fieldLabels[key as ModelField] || key.charAt(0).toUpperCase() + key.slice(1)}</strong>: latest {modelReview[key as keyof BatteryModelChoice] == null || modelReview[key as keyof BatteryModelChoice] === "" ? "Not recorded" : String(modelReview[key as keyof BatteryModelChoice])}; your draft {draft[key] || "Not recorded"}.</p>)}<Button type="button" variant="outline" size="sm" onClick={() => { if (!blocked && editing && modelReview.version) { setEditing({ id: editing.id, expectedVersion: modelReview.version }); setEditConflict(false); setModelReview(null); setError(""); setNotice("Reviewed version selected. Your draft is retained; Save model changes submits it against that version."); } }} disabled={blocked}>Use reviewed version</Button></>}</div>}{pending && <p role="status" className="field-hint">The original request is preserved. If the result was interrupted, Retry saved model request uses the same details and ID; it cannot create a second model.</p>}<div className="battery-model-picker-actions"><Button type="button" variant="outline" size="sm" onClick={() => { setAdding(false); setEditing(null); setEditConflict(false); setModelReview(null); }} disabled={blocked || !!pending}>Cancel model</Button><Button type="button" size="sm" onClick={saveModel} disabled={blocked || !!recovery.error || editConflict}>{saving ? "Saving model…" : pending ? "Retry saved model request" : editing ? "Save model changes" : "Save reusable model"}</Button></div></fieldset>}
        {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="field-hint">{notice}</p>}
    </section>;
}
