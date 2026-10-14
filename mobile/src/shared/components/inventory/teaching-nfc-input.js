"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Radio, ScanLine } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { teachingNfcBridge, validateTeachingNfcTag } from "../../lib/teaching-nfc.js";
/** Acquisition only: the parent chooses an original slot and reviews the registered asset. */
export function TeachingNfcInput({ disabled = false, onChooseTag, onBusyChange }) {
    const [tag, setTag] = useState(""), [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState(null), [error, setError] = useState("");
    const [availability, setAvailability] = useState(null);
    const running = useRef(false), mounted = useRef(true), bridge = teachingNfcBridge();
    useEffect(() => {
        mounted.current = true;
        if (bridge)
            void bridge.getAvailability().then(value => { if (mounted.current)
                setAvailability(value); }).catch(reason => { if (mounted.current)
                setError(reason instanceof Error ? reason.message : "NFC availability could not be checked."); });
        return () => { mounted.current = false; if (running.current && bridge)
            void bridge.cancel().catch(() => { }); };
    }, [bridge]);
    useEffect(() => { onBusyChange?.(reading || busy); return () => onBusyChange?.(false); }, [reading, busy, onBusyChange]);
    async function read() {
        if (disabled || running.current || !bridge || !availability?.available || !availability.enabled)
            return;
        running.current = true;
        onBusyChange?.(true);
        setReading(true);
        setProposal(null);
        setError("");
        try {
            const result = await bridge.read();
            if (mounted.current)
                setProposal(result);
        }
        catch (reason) {
            if (mounted.current)
                setError(reason instanceof Error ? reason.message : "The NFC read failed. No alternative was selected.");
        }
        finally {
            running.current = false;
            if (mounted.current)
                setReading(false);
            onBusyChange?.(false);
        }
    }
    async function choose(native) {
        if (disabled || busy || reading)
            return;
        onBusyChange?.(true);
        setBusy(true);
        setError("");
        try {
            if (native) {
                if (!bridge || !proposal)
                    throw new Error("Read and explicitly adopt an NFC identifier first.");
                const evidence = validateTeachingNfcTag(await bridge.adopt(proposal), proposal.tagId);
                await onChooseTag(evidence.tagId, { kind: "native_nfc", evidence });
                setProposal(null);
            }
            else {
                if (!tag || tag.trim() !== tag || tag.length > 128)
                    throw new Error("Enter the exact registered tag, without surrounding spaces, using at most 128 characters.");
                await onChooseTag(tag, { kind: "tag" });
                setTag("");
            }
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : "The registered tag could not be selected.");
        }
        finally {
            setBusy(false);
            onBusyChange?.(false);
        }
    }
    const locked = disabled || busy || reading;
    return _jsxs("section", { className: "detail-card teaching-nfc-input", "aria-label": "Registered tag alternative input", "aria-busy": busy || reading, children: [_jsx(Label, { htmlFor: "teaching-alternative-tag", children: "Registered tag identifier" }), _jsxs("div", { className: "inline-input", children: [_jsx(Input, { id: "teaching-alternative-tag", value: tag, onChange: event => setTag(event.target.value), onKeyDown: event => { if (event.key === "Enter") {
                            event.preventDefault();
                            void choose(false);
                        } }, maxLength: 128, disabled: locked, placeholder: "Enter the exact registered tag" }), _jsxs(Button, { type: "button", onClick: () => choose(false), disabled: locked || !tag, children: [_jsx(ScanLine, { size: 16 }), "Find registered tag"] })] }), _jsx("p", { className: "field-hint", children: "Tag input only locates an existing battery. Choose the original group member to replace, review differences, then confirm the checkout. It is recorded as manual tag input." }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs(Button, { type: "button", variant: "outline", onClick: read, disabled: locked || !availability?.available || !availability.enabled, children: [_jsx(Radio, { size: 16 }), reading ? "Reading NFC…" : "Read NFC tag"] }), reading && bridge && _jsx(Button, { type: "button", variant: "outline", onClick: () => bridge.cancel().catch(reason => setError(reason instanceof Error ? reason.message : "NFC cancellation failed.")), children: "Cancel NFC read" })] }), !bridge ? _jsx("p", { className: "field-hint", children: "Native NFC is unavailable in this browser. Use the filtered inventory or exact registered tag input." }) : availability && (!availability.available || !availability.enabled) && _jsx("p", { className: "field-hint", children: availability.reason || "Native NFC is unavailable or disabled on this device." }), proposal && _jsxs("div", { className: "history-entry", children: [_jsx("strong", { children: proposal.tagId }), _jsxs("p", { className: "field-hint", children: ["Device read: ", proposal.platform, " \u00B7 ", proposal.result.technology, " \u00B7 ", proposal.result.observedAt, ". Raw UID and NDEF evidence are saved separately. This read has not selected or borrowed a battery."] }), _jsxs("details", { children: [_jsx("summary", { children: "Device read evidence" }), _jsx("pre", { className: "max-w-full whitespace-pre-wrap break-all text-xs", children: JSON.stringify(proposal, null, 2) })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { type: "button", disabled: locked, onClick: () => choose(true), children: "Use this NFC read" }), _jsx(Button, { type: "button", variant: "outline", disabled: locked, onClick: () => setProposal(null), children: "Discard identifier proposal" })] })] }), _jsx("p", { className: "field-hint", children: "One input source per review list. A source change must be explicit and must retain any already reviewed alternatives or require a separate list." }), error && _jsx("p", { role: "alert", className: "form-error", children: error })] });
}
