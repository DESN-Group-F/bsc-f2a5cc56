import React, { useEffect, useRef, useState } from 'react';
import { usePhoneContext, usePhoneReducedMotion } from '../../app/phone-ui.jsx';
import './ink-orb.css';

const ORIGINAL_CONTOUR = 'M103 12C137 6 173 29 185 62C201 94 191 136 165 161C144 187 105 200 72 184C38 176 11 147 12 111C4 81 20 45 47 27C66 12 80 18 103 12Z';
const SEGMENTS = [
  [[103, 12], [137, 6], [173, 29], [185, 62]],
  [[185, 62], [201, 94], [191, 136], [165, 161]],
  [[165, 161], [144, 187], [105, 200], [72, 184]],
  [[72, 184], [38, 176], [11, 147], [12, 111]],
  [[12, 111], [4, 81], [20, 45], [47, 27]],
  [[47, 27], [66, 12], [80, 18], [103, 12]],
];
const EDGE_SAMPLES = SEGMENTS.flatMap((segment, index) => Array.from({ length: 8 }, (_, step) => {
  const t = step / 8, s = 1 - t, [a, b, c, d] = segment;
  const x = s ** 3 * a[0] + 3 * s ** 2 * t * b[0] + 3 * s * t ** 2 * c[0] + t ** 3 * d[0];
  const y = s ** 3 * a[1] + 3 * s ** 2 * t * b[1] + 3 * s * t ** 2 * c[1] + t ** 3 * d[1];
  const dx = 3 * s ** 2 * (b[0] - a[0]) + 6 * s * t * (c[0] - b[0]) + 3 * t ** 2 * (d[0] - c[0]);
  const dy = 3 * s ** 2 * (b[1] - a[1]) + 6 * s * t * (c[1] - b[1]) + 3 * t ** 2 * (d[1] - c[1]);
  const length = Math.hypot(dx, dy) || 1;
  const angle = (index + t) / 6 * Math.PI * 2;
  return { x, y, nx: dy / length, ny: -dx / length, sin2: Math.sin(angle * 2), cos2: Math.cos(angle * 2), sin3: Math.sin(angle * 3), cos3: Math.cos(angle * 3) };
}));
const IDLE_DIRECTIONS = [[15, -4], [-14, 2], [8, 8], [-8, -7], [18, 4]];
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

function edgeContour(time, strength, points) {
  const sin2 = Math.sin(time * .85), cos2 = Math.cos(time * .85), sin3 = Math.sin(time * .61), cos3 = Math.cos(time * .61);
  const count = EDGE_SAMPLES.length;
  for (let index = 0; index < count; index++) {
    const point = EDGE_SAMPLES[index];
    const movement = (2.35 * (point.sin2 * cos2 - point.cos2 * sin2) + 1.2 * (point.sin3 * cos3 + point.cos3 * sin3)) * 1.15 * strength;
    points[index * 2] = point.x + point.nx * movement;
    points[index * 2 + 1] = point.y + point.ny * movement;
  }
  let path = `M ${points[0].toFixed(2)} ${points[1].toFixed(2)}`;
  for (let index = 0; index < count; index++) {
    const before = (index + count - 1) % count * 2, start = index * 2, end = (index + 1) % count * 2, after = (index + 2) % count * 2;
    path += ' C ' + (points[start] + (points[end] - points[before]) / 6).toFixed(2) + ' ' + (points[start + 1] + (points[end + 1] - points[before + 1]) / 6).toFixed(2)
      + ' ' + (points[end] - (points[after] - points[start]) / 6).toFixed(2) + ' ' + (points[end + 1] - (points[after + 1] - points[start + 1]) / 6).toFixed(2)
      + ' ' + points[end].toFixed(2) + ' ' + points[end + 1].toFixed(2);
  }
  return path + ' Z';
}

function feedbackType(feedback) {
  const tokens = new Set(String(feedback || '').split(/\s+/));
  return tokens.has('failure') ? 'failure' : tokens.has('duplicate') ? 'duplicate' : tokens.has('success') ? 'success' : '';
}

function gazeContainer(element, scope, compact) {
  const supplied = typeof scope === 'string' ? element.closest(scope) : scope?.current || scope;
  return supplied || element.closest('[data-ink-gaze-scope]') || (!compact && element.closest('.mobile-scan-surface, .scan-focused-surface, .mobile-scan-home')) || element.parentElement;
}

export function InkOrb({ compact = false, color = 'blue', feedback = '', active = true, sequence = 0, event = '', successSequence = 0, gazeScope }) {
  const orb = useRef(null), body = useRef(null), face = useRef(null), leftEye = useRef(null), rightEye = useRef(null), activation = useRef(null);
  const runtime = useRef(null);
  const config = useRef({ compact, active, feedback: feedbackType(feedback), gazeScope, reduced: false });
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const phoneContext=usePhoneContext(), applicationReduced=usePhoneReducedMotion(), reducedMotion=reduced||applicationReduced, surfaceActive=active&&phoneContext?.active!==false;
  const tone = feedbackType(feedback);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const element = orb.current;
    if (!element) return undefined;
    let disposed = false, frameId = 0, lastTime = 0, clock = 0, activationAnimation = null, visible = false;
    const gaze = { x: 0, y: 0, goalX: 0, goalY: 0, started: 0, ends: 0, nextIdle: 2.1, mode: 'idle' };
    const contourPoints = new Float64Array(EDGE_SAMPLES.length * 2), paintedAttributes = new WeakMap();

    function eligible() {
      return !disposed && config.current.active && !config.current.reduced && document.visibilityState !== 'hidden' && element.isConnected && !element.closest('[hidden], [inert]');
    }
    function isRunning() { return visible && eligible(); }
    function paintAttribute(node, name, value) {
      if (!node) return;
      let previous = paintedAttributes.get(node);
      if (!previous) { previous = {}; paintedAttributes.set(node, previous); }
      if (previous[name] === value) return;
      node.setAttribute(name, value); previous[name] = value;
    }
    function paintFace(delta = 0) {
      const settings = config.current;
      let targetX = gaze.goalX, targetY = gaze.goalY;
      if (!settings.feedback && clock >= gaze.ends) { targetX = 0; targetY = 0; gaze.mode = 'idle'; }
      else if (gaze.mode === 'tap') {
        const observed = clock - gaze.started;
        if (observed > .67) { targetX -= .6; targetY += .4; }
        else if (observed > .33) { targetX += .8; targetY -= .5; }
      }
      const returning = targetX === 0 && targetY === 0;
      const blend = delta ? 1 - Math.exp(-delta / (returning ? .24 : .13)) : 1;
      gaze.x += (targetX - gaze.x) * blend; gaze.y += (targetY - gaze.y) * blend;
      const reach = settings.compact ? .3 : 1;
      paintAttribute(face.current, 'transform', `translate(${(gaze.x * reach).toFixed(2)} ${(gaze.y * reach).toFixed(2)})`);
      const blinkPhase = clock % 5.7;
      const blink = !settings.feedback && blinkPhase > 5.1 && blinkPhase < 5.23 ? .12 + Math.abs(blinkPhase - 5.165) / .065 * .88 : 1;
      const radius = (12 * blink).toFixed(2);
      paintAttribute(leftEye.current, 'ry', radius); paintAttribute(rightEye.current, 'ry', radius);
    }
    function target(x, y, duration, mode) {
      gaze.goalX = clamp(x, 24); gaze.goalY = clamp(y, 16.8); gaze.started = clock; gaze.ends = clock + duration; gaze.mode = mode;
      gaze.nextIdle = gaze.ends + 2 + Math.random() * 2.2;
    }
    function stop() {
      visible = false;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0; lastTime = 0;
      gaze.x = 0; gaze.y = 0; gaze.goalX = 0; gaze.goalY = 0; gaze.ends = 0; gaze.mode = 'idle';
      gaze.nextIdle = clock + 2.1;
      paintAttribute(face.current, 'transform', 'translate(0.00 0.00)');
      paintAttribute(leftEye.current, 'ry', '12.00'); paintAttribute(rightEye.current, 'ry', '12.00');
      activationAnimation?.cancel(); activationAnimation = null;
      if (element.dataset.motionPaused !== 'true') element.dataset.motionPaused = 'true';
      if (config.current.reduced) paintAttribute(body.current, 'd', ORIGINAL_CONTOUR);
    }
    function queueFrame() {
      if (!frameId && isRunning()) frameId = window.requestAnimationFrame(frame);
    }
    function frame(now) {
      frameId = 0;
      if (disposed) return;
      if (!isRunning()) { stop(); return; }
      const delta = lastTime ? Math.min((now - lastTime) / 1000, .05) : 1 / 60;
      lastTime = now; clock += delta;
      if (!config.current.feedback && gaze.mode === 'idle' && clock >= gaze.nextIdle) {
        const direction = IDLE_DIRECTIONS[Math.floor(Math.random() * IDLE_DIRECTIONS.length)];
        target(direction[0], direction[1], .75 + Math.random() * .65, 'idle');
      }
      paintAttribute(body.current, 'd', edgeContour(clock, config.current.compact ? .4 : 1, contourPoints));
      paintFace(delta); queueFrame();
    }
    function reconcile() {
      if (disposed) return;
      visible = eligible() && element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== 'hidden';
      if (!visible) { stop(); return; }
      if (element.dataset.motionPaused !== 'false') element.dataset.motionPaused = 'false';
      queueFrame();
    }
    function observe(pointer) {
      if (!isRunning() || config.current.feedback || !(pointer.target instanceof Element)) return;
      const scope = gazeContainer(element, config.current.gazeScope, config.current.compact);
      if (!scope?.contains(pointer.target)) return;
      if (pointer.target.closest('[inert], .scan-review-backdrop, .scan-confirm-backdrop')) return;
      const modalSelector = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
      const pointerModal = pointer.target.closest(modalSelector);
      if (pointerModal && pointerModal !== element.closest(modalSelector)) return;
      const bounds = element.getBoundingClientRect();
      const scale = 200 / Math.max(bounds.width, 1);
      target((pointer.clientX - bounds.left - bounds.width / 2) * scale * .18, (pointer.clientY - bounds.top - bounds.height * .47) * scale * .1, 1.15, 'tap');
      queueFrame();
    }
    function configure(settings, acquired) {
      const previous = config.current.feedback;
      config.current = settings;
      if (settings.feedback && (previous !== settings.feedback || acquired || gaze.mode !== 'feedback')) {
        const goal = settings.feedback === 'duplicate' ? [6, -16] : settings.feedback === 'failure' ? [-12, -9] : [18, -11];
        target(goal[0], goal[1], Number.POSITIVE_INFINITY, 'feedback');
      } else if (!settings.feedback && previous) target(0, 0, 0, 'idle');
      reconcile();
    }
    function activate(kind) {
      activationAnimation?.cancel(); activationAnimation = null;
      if (!isRunning() || !activation.current?.animate || !kind) return;
      const peak = kind === 'accepted' || kind === 'success' ? 'scale(1.035, .975)' : 'scale(1.022, .988)';
      activationAnimation = activation.current.animate([{ transform: 'scale(1)' }, { transform: peak }, { transform: 'scale(1)' }], { duration: 430, easing: 'ease-out' });
    }
    runtime.current = { configure, activate, reconcile };
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('pointerdown', observe, { passive: true });
    window.addEventListener('resize', reconcile, { passive: true });
    window.addEventListener('pageshow', reconcile);
    window.addEventListener('pagehide', stop);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(reconcile) : null;
    resizeObserver?.observe(element);
    const visibilityObserver = typeof MutationObserver === 'function' ? new MutationObserver(reconcile) : null;
    for (let ancestor = element; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) visibilityObserver?.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'class', 'style'] });
    // The retained focus layer changes source visibility through body :has().
    // Observe only direct body children; SVG frame writes stay outside this watch.
    if (document.body) visibilityObserver?.observe(document.body, { childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'class', 'style'] });
    reconcile();
    return () => {
      disposed = true; stop(); runtime.current = null;
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('pointerdown', observe);
      window.removeEventListener('resize', reconcile);
      window.removeEventListener('pageshow', reconcile);
      window.removeEventListener('pagehide', stop);
      resizeObserver?.disconnect(); visibilityObserver?.disconnect();
    };
  }, []);

  const lastAcquisition = useRef({ sequence, event });
  useEffect(() => {
    const changed = lastAcquisition.current.sequence !== sequence || lastAcquisition.current.event !== event;
    lastAcquisition.current = { sequence, event };
    runtime.current?.configure({ compact, active: surfaceActive, feedback: tone, gazeScope, reduced: reducedMotion }, changed);
    if (changed) runtime.current?.activate(event || tone);
  }, [compact, surfaceActive, tone, gazeScope, reducedMotion, sequence, event]);

  const feedbackClasses = String(feedback || '').split(/\s+/).filter(Boolean).map(value => `ink-${value}`);
  return <div ref={orb} className={['ink-orb', compact && 'ink-orb-compact', ...feedbackClasses].filter(Boolean).join(' ')} data-color={color} data-active={surfaceActive} data-reduced-motion={reducedMotion} aria-hidden="true">
    <div ref={activation} className="ink-orb__activation">
      <svg className="ink-orb__art" viewBox="0 0 200 200">
        <path ref={body} className="ink-orb__body" data-ink-body="true" d={ORIGINAL_CONTOUR}/>
        <g ref={face} className="ink-orb__gaze" data-ink-gaze="true">
          <ellipse ref={leftEye} className="ink-orb__eye ink-orb__eye--left" cx="78" cy="94" rx="8.5" ry="12"/>
          <ellipse ref={rightEye} className="ink-orb__eye" cx="121" cy="94" rx="8.5" ry="12"/>
          <path className="ink-orb__puzzled" d="M113 72l13-3"/>
          <path className="ink-orb__surprise" d="M61 78l-5-4M138 78l5-4"/>
        </g>
      </svg>
    </div>
    <React.Fragment key={successSequence}><span className="ink-orb__droplet ink-orb__droplet--a"/><span className="ink-orb__droplet ink-orb__droplet--b"/><span className="ink-orb__droplet ink-orb__droplet--c"/></React.Fragment>
  </div>;
}
