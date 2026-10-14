export function inventoryScrollOwner(element, documentObject = document) {
  return element?.closest?.('[data-phone-scroll]') || documentObject.scrollingElement;
}

export function resultHeadingScrollTop(heading, owner) {
  if (!heading || !owner) return 0;
  return Math.max(0, owner.scrollTop + heading.getBoundingClientRect().top - owner.getBoundingClientRect().top);
}

/** Touch drags and the tap that arrests a scrolling list must not open a record. */
export function createInventoryTapGuard({ lastScrollAt = () => -Infinity, now = () => performance.now(), distance = 8 } = {}) {
  let pointer = null, blocked = false;
  return {
    down(event) {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      blocked = event.pointerType !== 'mouse' && now() - lastScrollAt() < 120;
    },
    move(event) {
      if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > distance) blocked = true;
    },
    cancel() { blocked = true; pointer = null; },
    click(event) {
      if (event.detail === 0) return true;
      const accepted = !blocked;
      pointer = null;
      blocked = false;
      if (!accepted) { event.preventDefault(); event.stopPropagation(); }
      return accepted;
    },
  };
}
