/** Presentation decisions use the visible rectangle; rotation never owns task state. */
export function phoneViewportLayout({ width, height, baselineHeight = height, editable = false, keyboardHeld = false, scale = 1 }) {
  const normalScale = Math.abs(scale - 1) < 0.05;
  // Focus can leave an input before the IME releases its screen space.
  const keyboardOpen = normalScale && (editable && (baselineHeight - height > 100 || height <= 260) || keyboardHeld && (baselineHeight - height > 2 || height <= 260));
  const layout = keyboardOpen ? 'editing' : width >= 600 && height <= 540 ? 'wide' : 'portrait';
  return { width: Math.round(width), height: Math.round(height), keyboardOpen, layout };
}

export function phoneFocusScrollAdjustment({ fieldTop, fieldBottom, ownerTop, ownerBottom, viewportBottom, padding = 12 }) {
  const top = Math.max(0,ownerTop) + padding, bottom = Math.min(viewportBottom,ownerBottom) - padding;
  if (bottom <= top) return 0;
  if (fieldTop < top) return fieldTop - top;
  if (fieldBottom > bottom) return fieldBottom - bottom;
  return 0;
}
