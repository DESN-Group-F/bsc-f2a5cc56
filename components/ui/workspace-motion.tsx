"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { observeWorkspaceMotion, spring } from "@/lib/client/workspace-motion";
import { observeStationFocus } from "@/lib/client/station-focus";

/** Retain drafts and request state while removing closed content from interaction. */
export function MotionDisclosure({ open, children, className, id }: { open: boolean; children: ReactNode; className?: string; id?: string }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const initialized = useRef(false);
  const [initiallyHidden] = useState(!open);
  const motion = useRef({ value: 0, velocity: 0 });
  useLayoutEffect(() => {
    const element = outer.current, content = inner.current;
    if (!element || !content) return;
    cancel.current?.();
    if (!open && element.contains(document.activeElement)) {
      const trigger = id ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(id)}"]`) : null;
      (trigger ?? element.closest<HTMLElement>('[tabindex="-1"], .workspace'))?.focus({ preventScroll: true });
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
    } else animate();
    const observer = new ResizeObserver(() => { if (open && element.style.height !== "auto") animate(); });
    observer.observe(content);
    return () => { observer.disconnect(); cancel.current?.(); };
  }, [open, id]);
  return <div ref={outer} id={id} hidden={initiallyHidden} inert={initiallyHidden} aria-hidden={!open} className={className} data-motion-disclosure="" data-open={open} style={{ overflow: "clip" }}><div ref={inner}>{children}</div></div>;
}

/** Keep the last notice visible only for its inert exit animation. */
export function MotionPresence({ children }: { children: ReactNode }) {
  const [previous, setPrevious] = useState(children);
  const [retained, setRetained] = useState(children);
  if (previous !== children) {
    setPrevious(children);
    if (children) setRetained(children);
  }
  return <MotionDisclosure open={!!children}>{children || retained}</MotionDisclosure>;
}

/** Animate new evidence, results and rows, including portals, without copying controls. */
export function WorkspaceMotion() {
  useLayoutEffect(observeWorkspaceMotion, []);
  useLayoutEffect(observeStationFocus, []);
  return null;
}
