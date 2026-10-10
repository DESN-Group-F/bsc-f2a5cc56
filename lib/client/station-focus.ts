/** Keep keyboard focus below persistent station controls without changing drafts. */
export function observeStationFocus() {
  if (typeof document === "undefined") return () => undefined;
  const workspace = document.querySelector<HTMLElement>(".application-workbench");
  const topbar = workspace?.querySelector<HTMLElement>(".topbar");
  if (!workspace || !topbar) return () => undefined;
  const previousTop = workspace.style.getPropertyValue("--station-sticky-top");
  const measureTopbar = () => workspace.style.setProperty("--station-sticky-top", `${Math.ceil(topbar.getBoundingClientRect().height) + 8}px`);
  measureTopbar();
  const observer = new ResizeObserver(measureTopbar);
  observer.observe(topbar);
  let frame = 0;
  const reveal = (target: HTMLElement, remaining: number) => {
    if (document.activeElement !== target || !target.isConnected || target.closest('[hidden], [inert], [role="dialog"], [role="alertdialog"]')) return;
    const station = target.closest(".intake-station, .scan-station, .removal-station");
    const bar = station?.querySelector<HTMLElement>(".station-exit-bar");
    if (!bar || bar.contains(target) || !target.getClientRects().length) return;
    const bounds = target.getBoundingClientRect();
    const blockingBottom = [topbar, bar].reduce((bottom, surface) => {
      const rect = surface.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.left < bounds.right && rect.right > bounds.left ? Math.max(bottom, rect.bottom) : bottom;
    }, 0);
    const delta = bounds.top - blockingBottom - 12;
    if (delta < 0) {
      window.scrollBy({ top: delta, behavior: "instant" });
      if (remaining) frame = requestAnimationFrame(() => reveal(target, remaining - 1));
    }
  };
  const onFocus = (event: FocusEvent) => {
    cancelAnimationFrame(frame);
    if (event.target instanceof HTMLElement) {
      const target = event.target;
      frame = requestAnimationFrame(() => reveal(target, 1));
    }
  };
  document.addEventListener("focusin", onFocus);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("focusin", onFocus);
    if (previousTop) workspace.style.setProperty("--station-sticky-top", previousTop);
    else workspace.style.removeProperty("--station-sticky-top");
  };
}
