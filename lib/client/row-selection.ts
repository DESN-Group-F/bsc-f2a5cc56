import type { MouseEvent } from "react";

type SelectionEvent = Pick<MouseEvent<HTMLElement>, "target" | "currentTarget" | "defaultPrevented" | "button">;

export function hasRowTextSelection(event: Pick<SelectionEvent, "currentTarget">): boolean {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  return !!selection && !selection.isCollapsed &&
    (event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode));
}

/** Keep row selection separate from embedded controls and deliberate text selection. */
export function shouldToggleSelection(event: SelectionEvent): boolean {
  if (event.defaultPrevented || event.button > 0 || typeof Element === "undefined" || !(event.target instanceof Element)) return false;
  if (event.target.closest('button, a, input, select, textarea, label, summary, [role="checkbox"], [role="button"], [role="link"], [role="switch"], [role="radio"], [role="combobox"], [contenteditable]:not([contenteditable="false"]), [data-row-selection-ignore]')) return false;
  return !hasRowTextSelection(event);
}
