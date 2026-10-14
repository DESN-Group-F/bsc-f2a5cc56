import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('local content transitions interrupt on new view, never on refresh, and respect inactive/reduced motion', async () => {
  const source = (await readFile(new URL('../src/app/phone-content-motion.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
  const hooks = []; let cursor = 0, reduced = false, active = true;
  const animations = [], node = { animate(frames, timing) { const animation = { frames, timing, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; } };
  const useRef = value => hooks[cursor++] ??= { current: value };
  const effect = (run, deps) => { const index = cursor++, old = hooks[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); hooks[index] = { deps, cleanup: run() }; } };
  const useMotion = new Function('useLayoutEffect', 'useRef', 'usePhoneContext', 'usePhoneReducedMotion', source + '\nreturn usePhoneContentMotion;')(effect, useRef, () => ({active}), () => reduced);
  const ref = {current: node};
  const render = key => { cursor = 0; useMotion(ref, key); };
  render('inbox'); assert.equal(animations.length, 0);
  render('removed'); assert.equal(animations.length, 1);
  for (let i = 0; i < 5; i++) render('removed');
  assert.equal(animations.length, 1, 'Record refresh does not change the navigation key');
  assert.equal(animations[0].cancelled, false);
  render('inbox'); assert.equal(animations[0].cancelled, true); assert.equal(animations.length, 2);
  reduced = true; render('removed'); assert.equal(animations[1].cancelled, true); assert.equal(animations.length, 2);
  reduced = false; active = false; render('inbox'); assert.equal(animations.length, 2);
  active = true; render('inbox'); assert.equal(animations.length, 2, 'Returning to the same view uses the shell transition');
  assert.ok(animations.every(animation => animation.timing.duration <= 180 && animation.frames.every(frame => Object.keys(frame).every(key => key === 'opacity'))));
});
