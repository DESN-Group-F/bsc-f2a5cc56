"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { useLayoutEffect, useRef, useState } from "react";
import { observeWorkspaceMotion, spring } from "../../lib/client/workspace-motion.js";
import { observeStationFocus } from "../../lib/client/station-focus.js";
/** Retain drafts and request state while removing closed content from interaction. */
export function MotionDisclosure({ open, children, className, id }) {
    const outer = useRef(null), inner = useRef(null);
    const cancel = useRef(undefined);
    const initialized = useRef(false);
    const [initiallyHidden] = useState(!open);
    const motion = useRef({ value: 0, velocity: 0 });
    useLayoutEffect(() => {
        const element = outer.current, content = inner.current;
        if (!element || !content)
            return;
        cancel.current?.();
        if (!open && element.contains(document.activeElement)) {
            const trigger = id ? document.querySelector(`[aria-controls="${CSS.escape(id)}"]`) : null;
            (trigger ?? element.closest('[tabindex="-1"], .workspace'))?.focus({ preventScroll: true });
        }
        element.inert = !open;
        element.setAttribute("aria-hidden", String(!open));
        const animate = () => {
            const height = element.hidden ? 0 : element.getBoundingClientRect().height;
            element.hidden = false;
            const target = open ? content.scrollHeight : 0;
            cancel.current?.();
            cancel.current = spring(height, target, value => { element.style.height = `${Math.max(0, value)}px`; }, () => {
                element.hidden = !open;
                element.style.height = open ? "auto" : "0px";
            }, 28, motion.current);
        };
        if (!initialized.current) {
            initialized.current = true;
            element.hidden = !open;
            element.style.height = open ? "auto" : "0px";
        }
        else
            animate();
        const observer = new ResizeObserver(() => { if (open && element.style.height !== "auto")
            animate(); });
        observer.observe(content);
        return () => { observer.disconnect(); cancel.current?.(); };
    }, [open, id]);
    return _jsx("div", { ref: outer, id: id, hidden: initiallyHidden, inert: initiallyHidden, "aria-hidden": !open, className: className, "data-motion-disclosure": "", "data-open": open, style: { overflow: "clip" }, children: _jsx("div", { ref: inner, children: children }) });
}
/** Keep the last notice visible only for its inert exit animation. */
export function MotionPresence({ children }) {
    const [previous, setPrevious] = useState(children);
    const [retained, setRetained] = useState(children);
    if (previous !== children) {
        setPrevious(children);
        if (children)
            setRetained(children);
    }
    return _jsx(MotionDisclosure, { open: !!children, children: children || retained });
}
/** Animate new evidence, results and rows, including portals, without copying controls. */
export function WorkspaceMotion() {
    useLayoutEffect(observeWorkspaceMotion, []);
    useLayoutEffect(observeStationFocus, []);
    return null;
}
