import { flushSync } from "react-dom";
export function reducedMotion() {
    return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
const contentTransitions = new WeakMap();
const entrySelector = '[role="alert"], [role="status"], [data-slot="tabs-content"], .empty-state, .history-entry, .filter-chip, .task-plan-card, .message-inbox-card, [data-slot="table-row"], .detail-card, .selection-toolbar';
const layoutSelector = '.history-entry, .filter-chip, .task-plan-card, .message-inbox-card, [data-slot="table-row"]';
// Offset geometry excludes the transforms of both a row and its animated ancestors.
// Coordinates relative to the list also exclude navigation rail movement and scrolling.
function offsetPosition(element) {
    let top = 0, left = 0;
    for (let current = element; current; current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null) {
        top += current.offsetTop;
        left += current.offsetLeft;
    }
    return { top, left };
}
function layoutPosition(element) {
    const parent = element.parentElement;
    if (!parent || !element.getClientRects().length || element.closest('[hidden], [inert]'))
        return;
    const item = offsetPosition(element), list = offsetPosition(parent);
    return { parent, top: item.top - list.top, left: item.left - list.left, parentWidth: parent.clientWidth };
}
/** Observe meaningful content changes; navigation tooltips cannot restart list motion. */
export function observeWorkspaceMotion() {
    if (typeof document === "undefined")
        return () => undefined;
    const active = new Set(), layoutAnimations = new Map();
    let positions = new Map();
    const capture = () => {
        positions = new Map();
        document.querySelectorAll(layoutSelector).forEach(element => {
            const position = layoutPosition(element);
            if (position)
                positions.set(element, position);
        });
    };
    const track = (animation, element) => {
        active.add(animation);
        if (element)
            layoutAnimations.set(element, animation);
        void animation.finished.catch(() => undefined).finally(() => {
            active.delete(animation);
            if (element && layoutAnimations.get(element) === animation)
                layoutAnimations.delete(element);
        });
    };
    const stop = () => {
        active.forEach(animation => animation.cancel());
        active.clear();
        layoutAnimations.clear();
    };
    const enter = (element) => {
        if (reducedMotion() || !element.isConnected || !element.getClientRects().length || element.hidden || element.closest('[hidden], [inert], [data-motion-disclosure]') || element.closest('[data-slot="dialog-content"], [data-slot="sheet-content"]') && !element.matches('[data-slot="tabs-content"], [role="alert"], [role="status"]'))
            return;
        track(element.animate([{ opacity: .15, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: element.matches('[data-slot="table-row"]') ? 140 : 220, easing: "cubic-bezier(.22,1,.36,1)" }));
    };
    const observer = new MutationObserver(records => {
        const previouslyMounted = new Set(positions.keys());
        const changedLists = new Set();
        for (const record of records) {
            if (record.type !== "childList" || !(record.target instanceof HTMLElement))
                continue;
            // Only insertion, removal or reordering of actual list items can move siblings.
            // A tooltip, icon, cell label or portal update is not a list layout transaction.
            if ([...record.addedNodes, ...record.removedNodes].some(node => node instanceof HTMLElement && node.matches(layoutSelector)))
                changedLists.add(record.target);
        }
        if (reducedMotion())
            stop();
        for (const list of changedLists) {
            for (const element of Array.from(list.children)) {
                if (!(element instanceof HTMLElement) || !element.matches(layoutSelector))
                    continue;
                const before = positions.get(element), next = layoutPosition(element);
                if (!next)
                    continue;
                if (!reducedMotion() && before?.parent === list && Math.abs(before.parentWidth - next.parentWidth) < .5) {
                    const x = before.left - next.left, y = before.top - next.top;
                    if (Math.abs(x) + Math.abs(y) > 1 && Math.abs(y) < window.innerHeight * 2) {
                        // Interruption replaces this item's previous motion; it never stacks translations.
                        layoutAnimations.get(element)?.cancel();
                        track(element.animate([{ translate: `${x}px ${y}px` }, { translate: "0px 0px" }], { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" }), element);
                    }
                }
                positions.set(element, next);
            }
        }
        for (const [element] of positions)
            if (!element.isConnected) {
                layoutAnimations.get(element)?.cancel();
                layoutAnimations.delete(element);
                positions.delete(element);
            }
        for (const record of records) {
            if (record.type === "attributes") {
                if (record.target instanceof HTMLElement && record.target.matches(entrySelector) && !record.target.hidden)
                    enter(record.target);
                continue;
            }
            for (const node of record.addedNodes)
                if (node instanceof HTMLElement) {
                    if (node.matches(entrySelector)) {
                        if (!previouslyMounted.has(node))
                            enter(node);
                    }
                    else
                        node.querySelectorAll(entrySelector).forEach(element => { if (!previouslyMounted.has(element))
                            enter(element); });
                    // Record mounted items in new containers without animating an unrelated list.
                    for (const element of [node, ...node.querySelectorAll(layoutSelector)]) {
                        if (!element.matches(layoutSelector))
                            continue;
                        const position = layoutPosition(element);
                        if (position)
                            positions.set(element, position);
                    }
                }
        }
    });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preferenceChanged = () => { if (preference.matches)
        stop(); capture(); };
    capture();
    document.addEventListener("pointerdown", capture, true);
    document.addEventListener("keydown", capture, true);
    window.addEventListener("resize", capture);
    preference.addEventListener("change", preferenceChanged);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    return () => {
        observer.disconnect();
        stop();
        document.removeEventListener("pointerdown", capture, true);
        document.removeEventListener("keydown", capture, true);
        window.removeEventListener("resize", capture);
        preference.removeEventListener("change", preferenceChanged);
    };
}
// Only local view/filter updates belong here; never wrap a write or confirmation.
export function transitionWorkspace(update, cadence = "frequent") {
    const page = typeof document === "undefined" ? undefined : document;
    if (!page || reducedMotion()) {
        update();
        return;
    }
    // State and visible identities change together. Old record snapshots must never cover new click targets.
    flushSync(update);
    const selector = cadence === "frequent" ? '.workspace [data-slot="table-container"]' : ".workspace";
    const content = Array.from(page.querySelectorAll(selector)).find(element => element.getClientRects().length);
    if (!content)
        return;
    const previous = contentTransitions.get(content);
    const opacity = previous ? Number.parseFloat(getComputedStyle(content).opacity) : .72;
    previous?.cancel();
    const entry = content.animate(cadence === "frequent" ? [{ opacity }, { opacity: 1 }] : [{ opacity, translate: "0 7px" }, { opacity: 1, translate: "0 0" }], { duration: cadence === "frequent" ? 140 : 260, easing: "cubic-bezier(.22,1,.36,1)" });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cleanup = () => {
        preference.removeEventListener("change", preferenceChanged);
        if (contentTransitions.get(content)?.animation === entry)
            contentTransitions.delete(content);
    };
    const cancel = () => { entry.cancel(); cleanup(); };
    const preferenceChanged = () => { if (preference.matches)
        cancel(); };
    contentTransitions.set(content, { animation: entry, cancel });
    preference.addEventListener("change", preferenceChanged);
    void entry.finished.catch(() => undefined).finally(cleanup);
}
export function spring(from, to, render, finish, frequency = 28, state) {
    if (reducedMotion() || Math.abs(from - to) < .2 && Math.abs(state?.velocity ?? 0) < .5) {
        if (state) {
            state.value = to;
            state.velocity = 0;
        }
        render(to);
        finish?.();
        return () => undefined;
    }
    let value = from, velocity = state?.velocity ?? 0, previous = performance.now(), frame = 0, active = true;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const detach = () => {
        cancelAnimationFrame(frame);
        preference.removeEventListener("change", preferenceChanged);
    };
    const cancel = () => { active = false; detach(); };
    const settle = () => {
        if (!active)
            return;
        detach();
        if (state) {
            state.value = to;
            state.velocity = 0;
        }
        render(to);
        if (!active)
            return;
        active = false;
        finish?.();
    };
    const preferenceChanged = () => { if (preference.matches)
        settle(); };
    const tick = (time) => {
        if (!active)
            return;
        let remaining = Math.min((time - previous) / 1000, .064);
        previous = time;
        while (remaining > 0) {
            const step = Math.min(remaining, 1 / 480);
            velocity += (frequency * frequency * (to - value) - 2 * .91 * frequency * velocity) * step;
            value += velocity * step;
            remaining -= step;
        }
        if (state) {
            state.value = value;
            state.velocity = velocity;
        }
        render(value);
        if (!active)
            return;
        if (Math.abs(value - to) < .2 && Math.abs(velocity) < .5)
            settle();
        else
            frame = requestAnimationFrame(tick);
    };
    preference.addEventListener("change", preferenceChanged);
    frame = requestAnimationFrame(tick);
    return cancel;
}
