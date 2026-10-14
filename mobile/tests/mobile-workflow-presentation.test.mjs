import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

// Check the scanner's stylesheet contract. Native entry, presented frames and
// touch latency still require device measurements; this is not a frame-rate test.
const stylesheet = postcss.parse(await readFile(new URL('../src/app/phone.css', import.meta.url), 'utf8'));
function rule(selector, parent = stylesheet, property) {
  const result = parent.nodes.find(node => node.type === 'rule' && node.selectors.includes(selector) && (!property || node.nodes.some(value => value.type === 'decl' && value.prop === property)));
  assert.ok(result, `Presentation rule exists: ${selector}`);
  return result;
}
function declaration(node, property) {
  const result = node.nodes.find(value => value.type === 'decl' && value.prop === property);
  assert.ok(result, `Presentation declaration exists: ${property}`);
  return result;
}
const shell = rule('.phone-shell');
const covered = rule('.phone-shell.phone-workflow-open');
const layer = rule('.phone-app.phone-workflow-layer');
const closed = rule('.phone-workflow-layer[data-state=closed]');

test('full-screen scanner crossfades without a source filter or travelling window', () => {
  for (const node of [shell, covered, layer, closed]) {
    assert.equal(node.nodes.some(value => value.type === 'decl' && /^(?:filter|backdrop-filter|-webkit-backdrop-filter)$/.test(value.prop)), false);
    assert.equal(node.nodes.some(value => value.type === 'decl' && value.prop === 'transform' && value.value !== 'none'), false);
  }
  for (const node of [shell, layer]) {
    assert.match(declaration(node, 'transition').value, /^opacity\s/);
    assert.equal(postcss.list.comma(declaration(node, 'transition').value).length, 1);
    assert.doesNotMatch(declaration(node, 'transition').value, /filter|transform/);
  }
  assert.equal(declaration(shell, 'opacity').value, '1');
  assert.equal(declaration(covered, 'opacity').value, '0');
  assert.equal(declaration(layer, 'opacity').value, '1');
  assert.equal(declaration(closed, 'opacity').value, '0');
  const start = stylesheet.nodes.find(node => node.type === 'atrule' && node.name === 'starting-style');
  assert.ok(start);
  assert.equal(declaration(rule('.phone-app.phone-workflow-layer[data-state=open]', start), 'opacity').value, '0');
});

test('scanner retains the opaque app palette and viewport surface without a window frame', () => {
  const surface = declaration(rule('.phone-app'), '--phone-surface').value;
  assert.match(surface, /^#[0-9a-f]{6}$/i, 'The surface palette remains opaque.');
  assert.equal(declaration(layer, 'background').value, 'var(--phone-surface)');
  assert.equal(declaration(layer, 'position').value, 'fixed');
  assert.equal(declaration(layer, 'inset').value, '0');
  assert.match(declaration(layer, 'height').value, /--phone-viewport-height,100dvh/);
  const content = rule('.phone-workflow-layer>*');
  for (const property of ['border', 'border-radius', 'box-shadow']) {
    assert.match(declaration(content, property).value, /^(?:0|none)$/);
  }
});

test('phone Scan Review and confirmation disable only their live backdrop filters', () => {
  for (const selector of ['.phone-session .scan-review-backdrop', '.phone-session .scan-confirm-backdrop']) {
    const override = rule(selector);
    for (const property of ['backdrop-filter', '-webkit-backdrop-filter']) {
      assert.equal(declaration(override, property).value, 'none');
    }
    assert.deepEqual(override.nodes.filter(node => node.type === 'decl').map(node => node.prop).sort(), ['-webkit-backdrop-filter', 'backdrop-filter']);
    assert.equal(override.nodes.filter(node => node.type === 'decl').at(-1).prop, 'backdrop-filter', 'The standard declaration comes last so CSS optimization preserves Android support.');
    assert.ok(override.selectors.every(value => /^\.phone-session \.scan-(?:review|confirm)-backdrop$/.test(value)), 'The override stays within phone Scan overlays.');
  }
});

// Pass the CSS asset linked by a freshly built dist/index.html. Never silently
// use an existing dist artifact as evidence for the current source.
test('the built phone Scan overlay cascade preserves an effective standard backdrop-filter override', {
  skip: process.env.MOBILE_PRESENTATION_CSS ? false : 'Set MOBILE_PRESENTATION_CSS to the freshly built CSS asset.',
}, async () => {
  const built = postcss.parse(await readFile(process.env.MOBILE_PRESENTATION_CSS, 'utf8'));
  for (const name of ['scan-review-backdrop', 'scan-confirm-backdrop']) {
    const matching = [`.${name}`, `.phone-session .${name}`];
    let effective, order = 0;
    built.walkRules(node => {
      const selectors = node.selectors.filter(selector => matching.includes(selector));
      if (!selectors.length) return;
      const specificity = Math.max(...selectors.map(selector => selector.match(/\./g).length));
      for (const value of node.nodes.filter(value => value.type === 'decl' && value.prop === 'backdrop-filter')) {
        const next = { value: value.value, important: value.important ? 1 : 0, specificity, order: order++ };
        if (!effective || next.important > effective.important || (next.important === effective.important && (next.specificity > effective.specificity || (next.specificity === effective.specificity && next.order > effective.order)))) effective = next;
      }
    });
    assert.equal(effective?.value, 'none', `${name}: Android's standard property must defeat the shared blur after CSS optimization.`);
    assert.equal(effective?.specificity, 2, `${name}: the effective standard override remains scoped to the phone session.`);
  }
});

test('the actual focused scanner remains unfiltered when Review or confirmation makes it inert', () => {
  for (const selector of ['.phone-session .scan-focused-surface', '.phone-session .scan-focused-surface[inert]']) {
    const override = rule(selector);
    assert.equal(declaration(override, 'filter').value, 'none');
    assert.equal(declaration(override, 'transition').value, 'none');
    assert.deepEqual(override.nodes.filter(node => node.type === 'decl').map(node => node.prop).sort(), ['filter', 'transition']);
    assert.ok(override.selectors.every(value => /^\.phone-session \.scan-focused-surface(?:\[inert\])?$/.test(value)), 'The shared Review sheet, controls and other workflows retain their animation rules.');
  }
});

test('the retained open or exiting layer pauses covered CSS animation and hides the second character', () => {
  const retainedBoundary = 'body.phone-session:has(.phone-workflow-layer)';
  const pause = stylesheet.nodes.find(node => node.type === 'rule' && node.nodes.some(value => value.type === 'decl' && value.prop === 'animation-play-state' && value.value === 'paused'));
  assert.ok(pause);
  assert.equal(declaration(pause, 'animation-play-state').important, true);
  assert.ok(pause.selectors.every(selector => selector.startsWith(retainedBoundary) && !selector.includes('data-state')));
  for (const pseudo of ['', '::before', '::after']) {
    assert.ok(pause.selectors.some(selector => selector.includes('.phone-shell') && selector.includes('.phone-shell *') && selector.endsWith(pseudo || ')')));
  }
  const originOrb = rule(`${retainedBoundary} .phone-shell .ink-orb`);
  assert.equal(declaration(originOrb, 'visibility').value, 'hidden');
  assert.equal(declaration(originOrb, 'visibility').important, true);
});

test('entry and retained exit keep their shared timing and both reduced-motion paths', () => {
  assert.match(declaration(shell, 'transition').value, /--phone-focus-exit,240ms/);
  assert.equal(declaration(covered, 'transition-duration').value, 'var(--phone-focus-enter,420ms)');
  assert.match(declaration(layer, 'transition').value, /--phone-focus-enter,420ms/);
  assert.equal(declaration(closed, 'transition-duration').value, 'var(--phone-focus-exit,240ms)');
  assert.equal(declaration(closed, 'pointer-events').value, 'none');
  const reduced = stylesheet.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(prefers-reduced-motion:reduce)');
  assert.ok(reduced);
  for (const selector of ['.phone-shell', '.phone-workflow-layer']) {
    const system = declaration(rule(selector, reduced, 'transition'), 'transition');
    assert.equal(system.value, 'none'); assert.equal(system.important, true);
  }
  const preference = rule('.phone-session[data-phone-reduced-motion=true] :is(.phone-shell,.phone-workflow-layer,.phone-pressable,.phone-nav-icon)', stylesheet, 'transition');
  assert.equal(declaration(preference, 'transition').value, 'none'); assert.equal(declaration(preference, 'transition').important, true);
  assert.equal(declaration(preference, 'scroll-behavior').value, 'auto'); assert.equal(declaration(preference, 'scroll-behavior').important, true);
  assert.ok(preference.selectors.includes('.phone-app[data-phone-reduced-motion=true] *'), 'Saved motion preference reaches launch and signed-out content before the shell exists.');
  for (const selector of ['.phone-route','.phone-signin','.phone-startup','.phone-startup-progress i']) {
    assert.equal(declaration(rule(selector,reduced,'animation'),'animation').value,'none');
  }
  const savedAnimations = rule('.phone-app[data-phone-reduced-motion=true] :is(.phone-route,.phone-signin,.phone-startup,.phone-startup-progress i,.phone-workflow-layer,.phone-icon-button.is-updating svg)',stylesheet,'animation');
  assert.equal(declaration(savedAnimations,'animation').value,'none'); assert.equal(declaration(savedAnimations,'animation').important,true);
  assert.equal(declaration(rule('.phone-session[data-phone-reduced-motion=true] .phone-pressable[data-pressed=true]'),'transform').value,'none');
});

test('saved reduced motion reaches owned shared portals while preserving their positioning transforms',() => {
  const selector='body.phone-session[data-phone-reduced-motion=true] :is([data-slot=dialog-content],[data-slot=dialog-overlay],[data-slot=sheet-content],[data-slot=sheet-overlay])';
  const owned=rule(selector);
  for(const property of ['animation','transition']) {assert.equal(declaration(owned,property).value,'none');assert.equal(declaration(owned,property).important,true);}
  assert.equal(declaration(owned,'scroll-behavior').value,'auto');
  assert.equal(owned.nodes.some(node=>node.type==='decl'&&node.prop==='transform'),false,'Dialog centering and Sheet placement remain intact.');
  assert.ok(owned.selectors.every(value=>value.startsWith('body.phone-session[data-phone-reduced-motion=true] ')),'No ordinary web or other application surface is disabled.');
  for(const suffix of [' *',' *::before',' *::after'])assert.ok(owned.selectors.includes('body.phone-session[data-phone-reduced-motion=true] :is([data-slot=dialog-content],[data-slot=sheet-content])'+suffix));
});
