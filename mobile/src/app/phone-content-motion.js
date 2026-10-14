import { useLayoutEffect, useRef } from 'react';
import { usePhoneContext, usePhoneReducedMotion } from './phone-ui.jsx';

const running = new WeakMap();

/** Only an explicit view key starts this fade; record refreshes never replay it. */
export function usePhoneContentMotion(ref, key, { within, select, active = true } = {}) {
  const previous = useRef(key), context = usePhoneContext(), reduced = usePhoneReducedMotion();
  const enabled = active && context?.active !== false;
  useLayoutEffect(() => {
    const changed = previous.current !== key;
    previous.current = key;
    if (!changed || !enabled || reduced) return;
    const root = within ? ref.current?.closest(within) : ref.current;
    const target = select ? [...root?.querySelectorAll(select) || []].find(node => node.getClientRects().length && !node.closest('[hidden],[inert]')) : root;
    if (!target?.animate) return;
    running.get(target)?.cancel();
    const animation = target.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    running.set(target, animation);
    return () => { animation.cancel(); if (running.get(target) === animation) running.delete(target); };
  }, [ref, key, enabled, reduced, within, select]);
}
