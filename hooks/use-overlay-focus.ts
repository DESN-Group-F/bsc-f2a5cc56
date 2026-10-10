"use client";

import { useRef } from "react";

/** Restore a programmatic overlay's opener without overriding a caller's focus policy. */
export function useOverlayFocus(onOpen?: (event: Event) => void, onClose?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus(event: Event) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpen?.(event);
    },
    onCloseAutoFocus(event: Event) {
      onClose?.(event);
      if (event.defaultPrevented) return;
      if (document.activeElement?.id === "workspace-content") {
        event.preventDefault();
        return;
      }
      // Another overlay may have opened from this one (for example an export).
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[role="dialog"][data-state="open"]')) {
        event.preventDefault();
        return;
      }
      const target = opener.current;
      const available = target?.isConnected && target !== document.body && !target.closest('[hidden], [inert], [aria-hidden="true"]') && !target.matches(':disabled');
      if (available) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      } else {
        // A responsive surface may already have restored a replacement control.
        // A late unmount callback must not replace that valid focus with fallback.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement && focused.isConnected && focused.getClientRects().length > 0 && getComputedStyle(focused).visibility !== "hidden" && !focused.closest('[hidden], [inert]') && !focused.matches(':disabled, [data-radix-focus-guard]')) {
          event.preventDefault();
          return;
        }
        const workspace = document.getElementById("workspace-content");
        if (workspace && !document.querySelector('[role="dialog"][data-state="open"]')) {
          event.preventDefault();
          workspace.focus({ preventScroll: true });
        }
      }
    },
  };
}
