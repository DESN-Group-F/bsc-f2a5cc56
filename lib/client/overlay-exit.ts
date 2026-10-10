import { reducedMotion } from "./workspace-motion";

let cancelExit: (() => void) | undefined;

/** Presentation only, called after an informational close has been approved.
 * The real overlay and its locks are removed immediately by close(). */
export function dismissOverlay(surface: HTMLElement | null, close: () => void, kind: "sheet" | "dialog") {
  let dispose = () => {};
  try {
    cancelExit?.();
    if (surface && !reducedMotion() && !surface.querySelector('input[type="password"], input[type="file"], [data-sensitive]')) {
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) throw new Error("The closing surface is not visible.");
    const snapshot = surface.cloneNode(true) as HTMLElement;
    snapshot.setAttribute("data-overlay-exit", "");
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.inert = true;
    // No React tree, original IDs, forms, focus entries or delegated handlers
    // survive in this decorative, short-lived representation.
    for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>("*")]) {
      for (const attribute of Array.from(node.attributes)) {
        if (/^on/i.test(attribute.name) || ["id", "name", "for", "form", "autofocus", "href", "role", "aria-labelledby", "aria-describedby", "aria-controls", "aria-modal", "action", "method", "formaction", "formmethod"].includes(attribute.name)) node.removeAttribute(attribute.name);
      }
      if (node.matches("input, select, textarea, button, a, [tabindex], [contenteditable]")) {
        node.setAttribute("tabindex", "-1");
        node.removeAttribute("contenteditable");
      }
    }
    snapshot.querySelectorAll("form").forEach(form => { const presentation = document.createElement("div"); presentation.className = form.className; presentation.style.cssText = form.style.cssText; while (form.firstChild) presentation.appendChild(form.firstChild); form.replaceWith(presentation); });
    Object.assign(snapshot.style, {
      position: "fixed", top: `${bounds.top}px`, left: `${bounds.left}px`, right: "auto", bottom: "auto",
      width: `${bounds.width}px`, height: `${bounds.height}px`, maxWidth: "none", maxHeight: "none",
      margin: "0", transform: "none", translate: "none", animation: "none", transition: "none",
      pointerEvents: "none", overflow: "hidden", zIndex: "50",
    });
    let timer = 0;
    const effects: { animation?: Animation; observer?: MutationObserver } = {};
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    dispose = () => {
      window.clearTimeout(timer);
      effects.animation?.cancel();
      effects.observer?.disconnect();
      snapshot.remove();
      document.removeEventListener("pointerdown", dispose, true);
      document.removeEventListener("keydown", dispose, true);
      document.removeEventListener("wheel", dispose, true);
      preference.removeEventListener("change", dispose);
      if (cancelExit === dispose) cancelExit = undefined;
    };
    cancelExit = dispose;
    document.body.appendChild(snapshot);
    document.addEventListener("pointerdown", dispose, { capture: true, passive: true });
    document.addEventListener("keydown", dispose, { capture: true, passive: true });
    document.addEventListener("wheel", dispose, { capture: true, passive: true });
    preference.addEventListener("change", dispose);
    effects.observer = new MutationObserver(records => {
      if (records.some(record => Array.from(record.addedNodes).some(node => node instanceof HTMLElement && !node.closest('[data-overlay-exit]') && (node.matches('[role="dialog"]') || node.querySelector('[role="dialog"]'))))) dispose();
    });
    effects.observer.observe(document.body, { childList: true, subtree: true });
    effects.animation = snapshot.animate([{ opacity: .8, translate: "0 0" }, { opacity: 0, translate: kind === "sheet" ? "14px 0" : "0 4px" }], { duration: 120, easing: "ease-out" });
    void effects.animation.finished.then(dispose, dispose);
    timer = window.setTimeout(dispose, 180);
    }
  } catch {
    try { dispose(); } catch { /* Presentation cleanup cannot suppress closure. */ }
  }
  // This is deliberately outside animation completion and exception handling.
  close();
}
