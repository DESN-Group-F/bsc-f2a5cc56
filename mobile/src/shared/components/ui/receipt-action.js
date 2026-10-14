"use client";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useLayoutEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "./button.js";
import { reducedMotion, spring } from "../../lib/client/workspace-motion.js";
import styles from "./receipt-action.module.css";
/** A visual receipt acknowledgement never submits, retries or settles a request. */
export function ReceiptAction({ pending, confirmation, reviewKey, actionLabel, pendingAnnouncement, confirmationAnnouncement, children, onClick, className, ...props }) {
    const [phase, setPhase] = useState("idle");
    const [acknowledgement, setAcknowledgement] = useState(null);
    const armed = useRef(false), seen = useRef(confirmation?.identity), previousReview = useRef(reviewKey), wasPending = useRef(false);
    const element = useRef(null), footprint = useRef(null);
    const idleMeasure = useRef(null), resultMeasure = useRef(null);
    const cancels = useRef([]);
    const widthMotion = useRef({ value: 0, velocity: 0 }), radiusMotion = useRef({ value: 10, velocity: 0 });
    const geometryReady = useRef(false), targets = useRef(null);
    const confirmationIdentity = confirmation?.identity, confirmationCount = confirmation?.count ?? 0, confirmationText = confirmation?.text ?? "";
    useLayoutEffect(() => {
        const received = !!confirmationIdentity && confirmationIdentity !== seen.current;
        let timer;
        let removePreference = () => { };
        if (pending && armed.current)
            setPhase("pending");
        else if (received && confirmationIdentity && armed.current && confirmationCount > 0) {
            seen.current = confirmationIdentity;
            armed.current = false;
            setAcknowledgement({ identity: confirmationIdentity, count: confirmationCount, text: confirmationText });
            if (reducedMotion())
                setPhase("confirmed");
            else {
                setPhase("check");
                const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
                const complete = () => {
                    if (timer === undefined)
                        return;
                    clearTimeout(timer);
                    timer = undefined;
                    removePreference();
                    setPhase("confirmed");
                };
                const preferenceChanged = () => { if (preference.matches)
                    complete(); };
                removePreference = () => preference.removeEventListener("change", preferenceChanged);
                preference.addEventListener("change", preferenceChanged);
                timer = setTimeout(complete, 190);
            }
        }
        else if (wasPending.current || reviewKey !== previousReview.current) {
            setPhase("idle");
            setAcknowledgement(null);
            if (reviewKey !== previousReview.current)
                armed.current = false;
        }
        if (received && !pending && !armed.current)
            seen.current = confirmationIdentity;
        wasPending.current = pending;
        previousReview.current = reviewKey;
        return () => { if (timer !== undefined)
            clearTimeout(timer); removePreference(); };
    }, [pending, confirmationIdentity, confirmationCount, confirmationText, reviewKey]);
    useLayoutEffect(() => {
        const button = element.current, frame = footprint.current;
        if (!button || !frame)
            return;
        const animate = () => {
            const typography = getComputedStyle(button);
            for (const measure of [idleMeasure.current, resultMeasure.current]) {
                if (measure) {
                    measure.style.font = typography.font;
                    measure.style.letterSpacing = typography.letterSpacing;
                }
            }
            const idleWidth = Math.max(128, (idleMeasure.current?.scrollWidth ?? 128) + 40);
            const resultWidth = Math.max(128, (resultMeasure.current?.scrollWidth ?? 128) + 72);
            const controlHeight = Number.parseFloat(typography.height) || button.offsetHeight || 48;
            const available = frame.parentElement?.clientWidth || Math.max(idleWidth, resultWidth);
            const reserve = Math.min(available, Math.max(idleWidth, resultWidth, controlHeight));
            const circle = phase === "pending" || phase === "check";
            const targetWidth = circle ? controlHeight : Math.min(reserve, phase === "confirmed" ? resultWidth : idleWidth);
            const targetRadius = circle || phase === "confirmed" ? controlHeight / 2 : 10;
            if (targets.current?.width === targetWidth && targets.current.radius === targetRadius && targets.current.reserve === reserve)
                return;
            targets.current = { width: targetWidth, radius: targetRadius, reserve };
            cancels.current.forEach(cancel => cancel());
            if (frame.style.width !== `${reserve}px`)
                frame.style.width = `${reserve}px`;
            if (!geometryReady.current) {
                geometryReady.current = true;
                widthMotion.current.value = button.getBoundingClientRect().width;
                radiusMotion.current.value = Number.parseFloat(getComputedStyle(button).borderRadius) || 10;
            }
            cancels.current = [
                spring(widthMotion.current.value, targetWidth, value => { button.style.width = `${Math.max(controlHeight, value)}px`; }, undefined, 28, widthMotion.current),
                spring(radiusMotion.current.value, targetRadius, value => { button.style.borderRadius = `${Math.max(0, value)}px`; }, undefined, 28, radiusMotion.current),
            ];
        };
        animate();
        const observer = new ResizeObserver(animate);
        if (frame.parentElement)
            observer.observe(frame.parentElement);
        return () => { observer.disconnect(); cancels.current.forEach(cancel => cancel()); targets.current = null; };
    }, [phase, children, acknowledgement?.text]);
    return _jsxs("span", { ref: footprint, className: styles.footprint, "data-receipt-phase": phase, children: [_jsx("span", { ref: idleMeasure, className: styles.measure, "aria-hidden": "true", children: children }), _jsx("span", { ref: resultMeasure, className: styles.measure, "aria-hidden": "true", children: acknowledgement?.text || actionLabel }), _jsxs(Button, { ...props, ref: element, className: `${styles.action} ${className || ""}`, "aria-label": actionLabel, onClick: event => { armed.current = true; onClick?.(event); }, children: [_jsx("span", { className: styles.accessible, children: children }), _jsx("span", { className: styles.visual, "aria-hidden": "true", children: phase === "pending" ? _jsx(LoaderCircle, { className: styles.loader, size: 20 }) : phase === "check" ? _jsx(Check, { size: 21 }) : phase === "confirmed" ? _jsxs(_Fragment, { children: [_jsx(Check, { size: 18 }), _jsx("span", { children: acknowledgement?.text })] }) : children }, phase)] }), _jsx("span", { className: styles.accessible, role: "status", "aria-live": "polite", "aria-atomic": "true", children: pending ? pendingAnnouncement ?? "" : acknowledgement ? confirmationAnnouncement ?? `${acknowledgement.text}. Confirmed server receipt for ${acknowledgement.count} ${acknowledgement.count === 1 ? "battery" : "batteries"}.` : "" })] });
}
