/** Presentation selection never changes transport, reader availability or business authority. */
export function usesIosPresentation({ platform, native, search = '' }) {
  if (native) return platform === 'ios';
  return new URLSearchParams(search).get('presentation') === 'ios';
}

export const IOS_MAIN_AREAS = Object.freeze(['scan', 'inventory', 'workspace', 'me']);
export const IOS_SCAN_ACTIONS = Object.freeze([
  { kind:'return', label:'Check in', detail:'Receive batteries', color:'yellow' },
  { kind:'checkout', label:'Check out', detail:'Prepare a loan', color:'blue' },
  { kind:'intake', label:'Intake', detail:'Register new stock', color:'purple' },
  { kind:'removal', label:'Removal', detail:'Retire or remove', color:'slate' },
]);

export function iosDockPosition(clientX, left, width) {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return null;
  return Math.max(0, Math.min(IOS_MAIN_AREAS.length - 1, (clientX - left) / width * IOS_MAIN_AREAS.length - .5));
}

export function iosSearchDestination(route, text, requestId) {
  const value = String(text ?? '').trim().slice(0, 200);
  // A details page retains the same fixed boundary as its source inventory.
  const scope = route.detail?.scope || route.scope || (route.detail?.group ? { kind:'group', ...route.detail.group, label:'Teaching group' } : null);
  return { type:'search', label:'Inventory search', scope, request:{ id:requestId, text:value } };
}

/** Route motion describes an already admitted destination; it never navigates. */
export function iosRouteTransition(previous, next) {
  if (previous?.namespace === next.namespace && previous.current.key === next.current.key) return null;
  let x = 0, y = 7, duration = 220;
  if (previous?.namespace === next.namespace) {
    if (!next.routes.some(route => route.key === previous.current.key)) { x = -16; y = 0; duration = 240; }
    else if (!previous.routes.some(route => route.key === next.current.key)) { x = 24; y = 0; duration = 280; }
    else { x = (['scan','inventory','workspace','me'].indexOf(next.area) > ['scan','inventory','workspace','me'].indexOf(previous.area) ? 1 : -1) * 9; y = 0; }
  }
  return {
    frames: [{ opacity:.72, transform:`translate3d(${x}px,${y}px,0)` }, { opacity:1, transform:'none' }],
    options: { duration, easing:'cubic-bezier(.2,.75,.2,1)' },
  };
}
