let dismissFeedback = null;

/** Finite touch feedback only; it never owns or delays a business action. */
export function animateIosOrbFeedback(element, { departing = false, initialTransform = 'scale(.74)', onFinish = () => {} } = {}) {
  const body = element.querySelector('.ios-ink-body');
  if (!body?.animate) { onFinish(); return () => {}; }
  const artwork = body.querySelector('[data-ink-body]');
  const splash = element.querySelector('.ios-ink-splash');
  if (artwork && splash) splash.setAttribute('fill', getComputedStyle(artwork).fill);
  const motions = [body.animate(departing ? [
    { transform: initialTransform, opacity: 1 },
    { transform: 'scale(.58,.53)', opacity: .96, offset: .22 },
    { transform: 'scale(.26)', opacity: .35, offset: .64 },
    { transform: 'scale(.08)', opacity: 0 },
  ] : [
    { transform: 'scale(.74)' },
    { transform: 'scale(.66,.61)', offset: .15 },
    { transform: 'scale(1.075,1.025)', offset: .62 },
    { transform: 'scale(.98,1.01)', offset: .82 },
    { transform: 'scale(1)' },
  ], { duration: departing ? 180 : 520, easing: departing ? 'cubic-bezier(.25,.05,.35,1)' : 'cubic-bezier(.2,.75,.2,1)', ...(departing ? { fill: 'forwards' } : {}) })];
  for (const [index, drop] of [...element.querySelectorAll('.ios-ink-drop')].entries()) {
    const angle = (index / 8 - .1) * Math.PI * 2;
    const distance = 66 + index % 3 * 9, x = Math.cos(angle), y = Math.sin(angle);
    motions.push(drop.animate([
      { transform: `translate(${x * 29}px,${y * 29}px) scale(.2)`, opacity: 0 },
      { transform: `translate(${x * 50}px,${y * 50}px) scale(1.2)`, opacity: .95, offset: .18 },
      { transform: `translate(${x * distance}px,${y * distance}px) scale(.7)`, opacity: .8, offset: .58 },
      { transform: `translate(${x * (distance + 8)}px,${y * (distance + 8) + 7}px) scale(.1)`, opacity: 0 },
    ], { duration: departing ? 320 : 620, delay: index % 2 * (departing ? 8 : 15), easing: 'cubic-bezier(.14,.65,.3,1)' }));
  }
  const final = motions.at(-1);
  final.onfinish = onFinish;
  return () => { final.onfinish = null; motions.forEach(motion => motion.cancel()); };
}

export function cancelIosActivationFeedback() { dismissFeedback?.(); }

/** Preserve the clicked pose above the next screen without holding up navigation. */
export function showIosActivationFeedback(source) {
  cancelIosActivationFeedback();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!source?.isConnected || media.matches || document.visibilityState === 'hidden') return;
  const rect = source.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const sourceBody = source.querySelector('.ios-ink-body');
  if (!sourceBody) return;
  const initialTransform = getComputedStyle(sourceBody).transform;
  const artwork = source.querySelector('[data-ink-body]');
  const color = artwork && getComputedStyle(artwork).fill;
  const echo = source.cloneNode(true);
  echo.removeAttribute('data-activation-echo');
  const original = echo.querySelector('.ink-orb');
  if (original && color) {
    original.style.setProperty('--ink-orb-base-color', color);
    original.style.setProperty('--ink-orb-render-color', color);
  }
  echo.setAttribute('data-ios-activation-feedback', 'true');
  echo.setAttribute('aria-hidden', 'true');
  echo.inert = true;
  Object.assign(echo.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', zIndex: '2200' });
  document.body.append(echo);
  source.setAttribute('data-activation-echo', 'true');
  let cancelMotion = () => {}, disposed = false;
  const finish = () => {
    if (disposed) return;
    disposed = true; cancelMotion(); echo.remove(); source.removeAttribute('data-activation-echo');
    document.removeEventListener('visibilitychange', visibility);
    media.removeEventListener('change', preference);
    if (dismissFeedback === finish) dismissFeedback = null;
  };
  const visibility = () => { if (document.visibilityState === 'hidden') finish(); };
  const preference = () => { if (media.matches) finish(); };
  dismissFeedback = finish;
  document.addEventListener('visibilitychange', visibility);
  media.addEventListener('change', preference);
  cancelMotion = animateIosOrbFeedback(echo, { departing: true, initialTransform, onFinish: finish });
}
