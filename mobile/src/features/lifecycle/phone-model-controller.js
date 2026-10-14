import { useEffect, useRef, useState } from 'react';
import { acknowledgeWorkflowStorage } from '../../shared/lib/client/workflow-storage.js';
import { modelCreateStorageKey, recoverModelCreate, verifyModelCreateReceipt } from '../../shared/components/inventory/battery-model-picker.js';
import { numberOrNull } from '../../shared/lib/client-utils.js';
import { modelFieldNames, modelFieldValue, newBatteryModelSchema, updateBatteryModelSchema } from '../../shared/lib/battery-models.js';
export { modelCreateStorageKey };
const choiceKey = choice => choice.origin + ':' + choice.id;
const errorMessage = error => error?.issues?.[0]?.message || error?.message || 'The model operation could not be completed.';
/** Existing model request/recovery behavior, separated from phone presentation. */
export function usePhoneModelController({ dataset, actorAccountId, canEditModels, values, selection, disabled, onApply, onManual, onBusyChange }) {
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
            return { attempt, error: raw !== null && !attempt ? "A saved model request could not be recovered. Preserve this tab and ask the administrator to review its saved request before creating another model." : "" };
        }
        catch {
            return { attempt: null, error: "Model request recovery is unavailable. Restore device storage before creating another model." };
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
                    const key = modelCreateStorageKey(actorAccountId, dataset), raw = window.__batteryWorkflowStorage.getItem(key);
                    if (raw !== null && raw !== JSON.stringify(attempt))
                        throw new Error("A different original model request is retained.");
                    window.__batteryWorkflowStorage.setItem(key, JSON.stringify(attempt));
                }
                catch {
                    throw new Error("This tab could not preserve the model request. No model was submitted. Enable browser storage or continue with manual battery details.");
                }
                setPending(attempt);
            }
            if (window.__batteryWorkflowStorage.getItem(modelCreateStorageKey(actorAccountId, dataset)) !== JSON.stringify(attempt))
                throw new Error("The original model request changed. No replacement was submitted.");
            const response = await fetch("/api/battery-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: attempt.dataset, payload: attempt.payload, ...(attempt.update ? { update: true } : {}) }) });
            const body = await response.json();
            if (!response.ok) {
                if ([400, 404, 409, 422].includes(response.status)) {
                    const key = modelCreateStorageKey(actorAccountId, dataset);
                    await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: JSON.stringify(attempt) } });
                    if (live.current)
                        setPending(null);
                }
                if (live.current && attempt.update && body.code === "model_conflict")
                    setEditConflict(true);
                throw new Error([401, 403].includes(response.status) ? `${body.error || "Account access needs review."} Sign in with the original account, then retry the preserved model request.` : body.error || "The reusable model could not be saved.");
            }
            const model = verifyModelCreateReceipt(body, attempt);
            const key = modelCreateStorageKey(actorAccountId, dataset);
            await acknowledgeWorkflowStorage({ remove: [key], expected: { [key]: JSON.stringify(attempt) } });
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
    return { contextMatches, revision, setRevision, loaded, current, loading, choices, choice, selectedKey, selectModel, appliedFields, conflicts, reviewField, blocked, recovery, adding, editing, editConflict, modelReview, draft, setDraft, pending, saving, error, notice, setNotice, editAccessLost, openNewModel, openEditModel, reviewLatestModel, saveModel,
      manual: () => { if (blocked || pending) return; selectModel(''); onManual(); setNotice('Manual details selected. Existing values are retained.'); },
      apply: () => { if (!blocked && !loading && !pending && appliedFields.length) { onApply(choice, appliedFields); setNotice('Selected model fields applied. Review the battery details before registration.'); } },
      cancelModel: () => { if (blocked || pending) return; setAdding(false); setEditing(null); setEditConflict(false); setModelReview(null); },
      useReviewedVersion: () => { if (!blocked && editing && modelReview?.version) { setEditing({id:editing.id, expectedVersion:modelReview.version}); setEditConflict(false); setModelReview(null); setError(''); setNotice('Reviewed version selected; your model draft is retained.'); } },
    };
}
