/** Keep an explicitly expanded floating queue from covering outside keyboard focus. */
export function revealQueueFocus(target: EventTarget | null, workbench: HTMLElement) {
  if (!(target instanceof HTMLElement) || !workbench.contains(target)) return;
  if (target.closest('[data-review-queue], [role="dialog"], [role="alertdialog"]')) {
    workbench.querySelector<HTMLElement>('[data-review-queue]')?.style.removeProperty('--queue-focus-max-height');
    return;
  }
  requestAnimationFrame(() => {
    if (!workbench.isConnected || document.activeElement !== target || target.closest('[hidden], [inert]')) return;
    const queue = workbench.querySelector<HTMLElement>('[data-review-queue]');
    if (!queue || !queue.getClientRects().length || !target.getClientRects().length) return;
    queue.style.removeProperty('--queue-focus-max-height');
    const bounds = target.getBoundingClientRect(), panel = queue.getBoundingClientRect();
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    const topEdge = (topbar?.bottom ?? 0) + 12;
    const overlapsHorizontally = bounds.right > panel.left && bounds.left < panel.right;
    if (overlapsHorizontally) {
      const headingHeight = queue.querySelector('[data-queue-heading]')?.getBoundingClientRect().height ?? 70;
      const availableHeight = panel.bottom - topEdge - bounds.height - 12;
      queue.style.setProperty('--queue-focus-max-height', `${Math.max(headingHeight, availableHeight)}px`);
    }
    const visiblePanel = queue.getBoundingClientRect();
    const obscured = overlapsHorizontally && bounds.bottom > visiblePanel.top - 12 && bounds.top < visiblePanel.bottom;
    if (!obscured && bounds.top >= topEdge && bounds.bottom <= window.innerHeight - 12) return;
    window.scrollBy({ top: bounds.top - topEdge, behavior: "instant" });
  });
}
