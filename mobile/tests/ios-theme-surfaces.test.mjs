import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* These are presentation-contract fixtures using the application's compiled CSS.
   Markup mirrors real surface classes, including separately mounted portals.
   They do not exercise React business transitions, native NFC or physical iOS. */
let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE to run computed iOS surface checks.' };
const mobile = fileURLToPath(new URL('../', import.meta.url));
const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const cssAsset = index.match(/href="([^"]+\.css)"/)?.[1];
assert.ok(cssAsset, 'Build the mobile application before running compiled theme checks.');
const css = await readFile(mobile + 'dist/' + cssAsset.replace(/^\//, ''), 'utf8');
const btn = (text, cls = 'scan-secondary-button', extra = '') => `<button type="button" class="${cls}" data-contrast ${extra}>${text}</button>`;
const label = (text, field = 'Fixture value') => `<label data-contrast>${text}<input value="${field}" data-contrast></label>`;
const shell = content => `<div class="phone-app"><div class="phone-shell ios-shell"><main class="phone-main"><div class="phone-route">${content}</div></main></div></div>`;
const workflow = content => `<div class="phone-app phone-workflow-layer ios-workflow" data-surface-root>${content}</div>`;
const choice = `<div class="phone-choice"><label data-contrast>Shared inventory</label><button class="phone-choice-trigger" data-contrast>Demonstration inventory</button><p class="phone-choice-description" data-contrast>Choose a recorded scope.</p></div>`;
const fixtures = {
  signin: `<div class="phone-app" data-surface-root><section class="phone-signin"><header class="phone-signin-heading"><p class="phone-eyebrow" data-contrast>Battery Inventory</p><h1 data-contrast>Sign in</h1><p data-contrast>Use your assigned staff account.</p></header><form class="phone-signin-form">${label('Username')}${label('Password', 'test-only')}${btn('Sign in', 'phone-primary')}</form><details class="phone-signin-tools" open><summary data-contrast>Device diagnostics</summary>${btn('NFC field test', 'phone-secondary')}</details></section></div>`,
  scan: workflow(`<section class="mobile-scan-station"><div class="mobile-scan-surface scan-focused-surface"><header class="scan-focused-header" data-surface>${btn('Back', 'scan-icon-button')}<div class="scan-focused-title"><h1 data-contrast>Check out</h1><span data-contrast>Demonstration inventory</span></div></header><div class="scan-focused-tabs" data-surface>${btn('NFC', '', 'aria-pressed="true"')}${btn('Select', '')}</div><div class="scan-stage-content"><div class="scan-stage-panel"><h2 data-contrast>Reader preparation</h2><p class="scan-reader-state" data-contrast>Native NFC unavailable in browser preview.</p><label class="scan-search"><input placeholder="Search batteries" data-contrast></label><div class="scan-protected-notice" data-surface data-contrast>Saved work needs review.${btn('Review saved work')}</div></div></div><footer class="scan-stage-footer" data-surface>${btn('Review selected batteries', 'scan-review-entry')}</footer></div></section>`),
  review: `<div class="phone-app scan-portal-root" data-surface-root><div class="scan-review-backdrop"><section class="scan-review-sheet" data-surface><div class="scan-sheet-handle"></div><header><div><h2 data-contrast>Review checkout</h2><small data-contrast>Selected records remain staged.</small></div>${btn('Close', 'scan-icon-button')}</header><div class="scan-review-scroll"><div class="scan-review-row"><div><strong data-contrast>Fixture battery</strong><small data-contrast>Existing registered home</small></div>${btn('Remove')}</div><div class="scan-saved-summary" data-contrast data-surface>Confirmed receipt example</div></div><footer data-surface><small data-contrast>Review before confirming.</small>${btn('Confirm checkout', 'scan-confirm-button')}</footer></section></div></div>`,
  intake: workflow(`<section class="mobile-intake" data-stage="preparation"><div class="mi-focused-surface"><header class="mi-focused-header" data-surface>${btn('Back', 'scan-icon-button')}<div class="mi-focused-title"><h1 data-contrast>New battery intake</h1><small data-contrast>Demonstration inventory</small></div></header><div class="mi-stage-content"><section class="mi-preparation" data-preparation-step="identity"><h2 data-contrast>Battery details</h2><div class="mi-common-fields"><fieldset>${label('Battery name *', 'Battery')}</fieldset><div class="mi-form-group-body">${label('Optional name')}</div>${choice}</div><p class="mi-id-explanation" data-contrast data-surface>Permanent identifiers are assigned after registration.</p><footer data-surface>${btn('Continue', 'mi-primary')}</footer></section></div></div></section>`),
  model: `<div class="phone-model-portal" data-surface-root><section class="phone-model-finder" data-surface><header><h3 data-contrast>Choose a battery model</h3>${btn('Close', 'phone-model-close')}</header><div class="phone-model-search"><label class="phone-model-search-label" data-contrast>Search models</label><div class="phone-model-search-box"><input value="Fixture" data-contrast>${btn('Clear', 'phone-model-clear')}</div></div><div class="phone-model-results"><button data-contrast aria-pressed="true"><span><strong>Fixture model</strong><small data-contrast>Recorded manufacturer information</small></span></button><button data-contrast><span><strong>Other model</strong><small data-contrast>Unknown specifications remain unknown.</small></span></button></div></section></div>`,
  lookup: workflow(`<section class="lookup-workflow"><header class="lookup-header" data-surface>${btn('Back', 'scan-icon-button')}<div><h1 data-contrast>Scan</h1><p data-contrast>View an existing record</p></div></header><div class="lookup-body"><nav class="lookup-modes" data-surface>${btn('NFC', '', 'aria-pressed="true"')}${btn('Select', '')}</nav><div class="lookup-message" data-surface><h2 data-contrast>Reader unavailable</h2><p data-contrast>Native NFC unavailable in browser preview.</p>${btn('Retry')}</div><article class="lookup-result"><p class="lookup-id" data-contrast>Fixture battery</p><dl><div><dt data-contrast>Registered home</dt><dd data-contrast>Recorded room</dd></div></dl></article></div><footer class="lookup-footer" data-surface>${btn('Close', 'scan-secondary-button')}</footer></section>`),
  removal: workflow(`<section class="mobile-removal mobile-scan-station"><div class="mobile-scan-surface"><header class="removal-top" data-surface>${btn('Back', 'scan-icon-button')}<div class="removal-identity"><h1 data-contrast>Removal<span data-contrast>Demonstration inventory</span></h1></div></header><div class="removal-input-pill" data-surface>${btn('NFC', '', 'aria-pressed="true"')}${btn('Select', '')}</div><div class="removal-stage-content"><div class="removal-review-fields">${label('Reason *', 'Fixture reason')}</div><div class="removal-error" data-contrast data-surface>Resolve the original request before continuing.</div></div><footer class="removal-stage-footer" data-surface>${btn('Review removal', 'scan-review-entry removal-review-entry')}</footer></div></section>`),
  diagnostics: `<div class="nfc-diagnostics" data-surface-root><div class="app-shell"><div class="field-test-exit" data-surface>${btn('Exit NFC field test', 'button secondary')}<span class="small" data-contrast>Local browser style fixture</span></div><main><div class="intro"><p class="eyebrow" data-contrast>Device diagnostics</p><h1 data-contrast>NFC field test</h1><p data-contrast>Availability does not establish a physical read.</p></div><section class="panel" data-surface><div class="availability"><strong data-contrast>Native NFC unavailable</strong><span data-contrast>Browser preview</span></div><fieldset class="field-grid">${label('Physical tag label')}${label('Surface')}</fieldset>${btn('Start NFC read', 'button primary full', 'disabled')}<div class="uid-block" data-surface><span data-contrast>No confirmed identifier</span></div><div class="notice outcome-failed" data-contrast data-surface>Controlled error presentation</div></section></main></div></div>`,
  portal: `<section data-slot="dialog-content" data-phone-task="export" data-surface-root data-surface style="position:fixed;inset:24px;max-height:calc(100% - 48px);overflow:auto;transform:none"><header data-slot="dialog-header"><h2 data-slot="dialog-title" data-contrast>Export records</h2><p data-slot="dialog-description" data-contrast>Keep the original inventory scope.</p></header><div class="form-field">${label('Report title')}</div><section data-phone-task="battery-record"><section data-inspection-outcome="concern_observed" data-surface><strong data-contrast>Concern observed</strong><p data-contrast>Inspection evidence remains recorded.</p></section></section><footer data-slot="dialog-footer">${btn('Cancel', '', 'data-slot="button" data-variant="outline"')}${btn('Download', '', 'data-slot="button" data-variant="default"')}</footer></section>`,
  feedback: shell(`<section class="mobile-work-page"><div class="mobile-work-load-error" data-contrast data-surface>Could not refresh. Saved content remains.${btn('Retry')}</div><div class="scan-outcome-card" data-pulse="success" data-contrast data-surface>Identifier acquired</div><div class="scan-outcome-card" data-pulse="failure" data-contrast data-surface>Read failed</div><div class="mobile-work-empty" data-contrast data-surface>No matching records.</div>${btn('Unavailable action', 'mobile-phone-primary', 'disabled')}</section>`),
};

async function session(t, { width = 390, height = 844, reduceTransparency = false } = {}) {
  const browser = await runtime.chromium.launch({ channel: process.env.MOBILE_BROWSER_TEST_CHANNEL || 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height } });
  if (reduceTransparency) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  }
  return page;
}
async function show(page, markup, { large = false, editing = false } = {}) {
  const layout = editing ? 'editing' : 'compact';
  await page.setContent(`<html data-ios-presentation="true" data-phone-layout="${layout}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${large ? '<style>html{font-size:32px} [data-contrast]{font-size:20px!important;line-height:1.45!important}</style>' : ''}</head><body class="phone-session" data-ios-presentation="true" data-phone-layout="${layout}"><div id="root">${markup}</div></body></html>`);
}
async function readContrast(page) {
  return page.locator('[data-contrast]').evaluateAll(nodes => {
    const rgb = text => { const m = text.match(/[\d.]+/g)?.map(Number); return m?.length >= 3 ? [m[0], m[1], m[2], m[3] ?? 1] : [0, 0, 0, 0]; };
    const blend = (front, back) => [...front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3])), 1];
    const light = c => { const n = c.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return n[0] * .2126 + n[1] * .7152 + n[2] * .0722; };
    return nodes.filter(n => n.getClientRects().length).map(node => {
      const chain = []; for (let e = node; e; e = e.parentElement) chain.unshift(e);
      let background = [16, 20, 27, 1];
      for (const element of chain) background = blend(rgb(getComputedStyle(element).backgroundColor), background);
      const color = rgb(getComputedStyle(node).color), foreground = blend(color, background), a = light(foreground), b = light(background);
      return { label: node.textContent.trim().slice(0, 52) || node.getAttribute('value') || node.tagName, selector: node.className, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
}
async function assertDarkSurfaces(page, name) {
  const surfaces = await page.locator('[data-surface]').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => ({ selector: n.className || n.getAttribute('data-slot'), color: getComputedStyle(n).backgroundColor })));
  for (const surface of surfaces) { const parts = surface.color.match(/[\d.]+/g)?.map(Number) || []; assert.ok(!(parts.length >= 3 && parts.slice(0, 3).every(value => value > 185) && (parts[3] ?? 1) > .4), `${name}: light surface ${JSON.stringify(surface)}`); }
}

test('compiled iOS CSS covers workflow roots, preparation labels, independent portals and diagnostics', options, async t => {
  const page = await session(t);
  for (const [name, markup] of Object.entries(fixtures)) {
    await show(page, markup);
    await assertDarkSurfaces(page, name);
    for (const item of await readContrast(page)) assert.ok(item.ratio >= 4.5, `${name}: low contrast ${JSON.stringify(item)}`);
    const roots = await page.locator('[data-surface-root]').evaluateAll(nodes => nodes.map(node => ({ surface: getComputedStyle(node).getPropertyValue('--phone-surface').trim(), scheme: getComputedStyle(node).colorScheme })));
    for (const root of roots) { assert.equal(root.surface, '#10141b', `${name}: iOS canvas surface`); assert.equal(root.scheme, 'dark', `${name}: native form color scheme`); }
    if (process.env.IOS_THEME_SCREENSHOT_DIR) { await mkdir(process.env.IOS_THEME_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.IOS_THEME_SCREENSHOT_DIR}/${name}-390.png`, animations:'disabled' }); }
  }
});
test('large text, compact landscape and keyboard fixtures retain their material and form contrast', options, async t => {
  const page = await session(t, { width: 844, height: 390 });
  for (const name of ['signin', 'scan', 'intake', 'model', 'lookup', 'removal', 'portal']) {
    await show(page, fixtures[name], { large: true, editing: true });
    await assertDarkSurfaces(page, name);
    for (const item of await readContrast(page)) assert.ok(item.ratio >= 4.5, `${name} landscape/large text: ${JSON.stringify(item)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: document overflow`);
    const bounds = await page.locator('input').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => { const r = n.getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right }; }));
    for (const box of bounds) assert.ok(box.width >= 44 && box.left >= -1 && box.right <= 845, `${name}: form field outside viewport ${JSON.stringify(box)}`);
  }
});
test('reduced transparency removes backdrop effects and provides opaque iOS surfaces', options, async t => {
  const page = await session(t, { reduceTransparency: true });
  for (const name of ['scan', 'review', 'model', 'portal']) {
    await show(page, fixtures[name]);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches), true);
    const effects = await page.locator('[data-surface-root],[data-surface]').evaluateAll(nodes => nodes.map(n => ({ backdrop: getComputedStyle(n).backdropFilter, panel: getComputedStyle(n).getPropertyValue('--ios-panel').trim(), background: getComputedStyle(n).backgroundColor })));
    for (const effect of effects) { assert.equal(effect.backdrop, 'none'); assert.equal(effect.panel, '#171e28'); }
    await assertDarkSurfaces(page, name);
  }
});

test('200 percent dock text remains inside its controls at the narrowest supported width', options, async t => {
  const page = await session(t, { width:320, height:740 });
  const icon = '<svg width="21" height="21" aria-hidden="true"></svg>';
  const controls = ['Scan','Inventory','Workspace','Me'].map(text => `<button><span class="ios-dock-icon">${icon}</span><span>${text}</span></button>`).join('');
  await show(page, `<div class="phone-app"><div class="phone-shell ios-shell"><main class="phone-main"></main><div class="ios-navigation"><nav class="ios-dock">${controls}</nav></div></div></div>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  const labels = await page.locator('.ios-dock>button').evaluateAll(nodes => nodes.map(button => {
    const label = button.lastElementChild, b = button.getBoundingClientRect(), l = label.getBoundingClientRect();
    return { text:label.textContent, buttonWidth:b.width, buttonHeight:b.height, labelWidth:l.width, labelHeight:l.height, scrollWidth:label.scrollWidth, left:l.left-b.left, right:b.right-l.right };
  }));
  for (const label of labels) { assert.ok(label.buttonHeight >= 44); assert.ok(label.left >= 0 && label.right >= 0 && label.scrollWidth <= label.labelWidth + 1, `Dock label overflows its control: ${JSON.stringify(label)}`); }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
});
