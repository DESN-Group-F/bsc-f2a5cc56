import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Render the actual record and Pressable with their inherited phone styles.
// Enlarged CSS text is a layout stress test, not Android textZoom qualification.
let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip: !runtime && 'Set MOBILE_BROWSER_TEST_MODULE for real React DOM and CSS checks.' };
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';
import{BatteryPage}from'./src/app/battery-page.jsx';
import{PhoneUIProvider}from'./src/app/phone-ui.jsx';
const f=window.fixture={calls:[]};
const battery={id:'BAT-00000001',name:'A retained battery with a long descriptive model name '+('ModelIdentifier'.repeat(7)),loanId:'LOAN-A',borrowerName:'Fixture holder',ownerName:'Fixture owner',lifecycleStatus:'active'};
const props={battery,data:{dataset:'demo'},revision:1,onOperation:(kind,ids)=>f.calls.push({kind,ids}),onFullRecord:()=>f.calls.push('full-record'),onExport:()=>f.calls.push('export')};
window.fetch=()=>new Promise(resolve=>f.resolve=()=>resolve(new Response(JSON.stringify({battery,events:[]}))));
const root=createRoot(document.getElementById('root'));
f.render=patch=>{Object.assign(props,patch);root.render(<PhoneUIProvider namespace='fixture:demo'><div className='phone-app'><BatteryPage {...props}/></div></PhoneUIProvider>);};f.render();
`;

test('record actions retain hierarchy and readable bounds on narrow, wide and enlarged-text layouts', options, async t => {
  const compiled = await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: 'battery-detail-layout.jsx', loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', format: 'esm', platform: 'browser', plugins: [{ name: 'inline-css', setup(api) { api.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }] });
  const styles = await Promise.all(['shared/vendor/shadcn-tailwind-4.13.0.css', 'shared/styles/theme.css', 'shared/styles/base.css', 'shared/styles/components.css', 'app.css', 'app/phone.css', 'app/battery-page.css'].map(file => readFile(new URL('../src/' + file, import.meta.url), 'utf8')));
  const browser = await runtime.chromium.launch({ headless: true, ...(process.env.MOBILE_BROWSER_TEST_CHANNEL ? { channel: process.env.MOBILE_BROWSER_TEST_CHANNEL } : {}) });
  t.after(() => browser.close());
  for (const viewport of [{ width: 320, height: 640 }, { width: 412, height: 828 }, { width: 828, height: 388 }]) for (const large of [false, true]) {
    await t.test(`${viewport.width}×${viewport.height}${large ? ' with 200% action text' : ''}`, async () => {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('https://battery-layout.fixture.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + styles.join('\n').replace(/@import[^;]+;/g, '') + 'html{font-size:16px}body{margin:0}</style><div id="root"></div>' }));
        await page.goto('https://battery-layout.fixture.test/');
        await page.addScriptTag({ content: compiled.outputFiles.find(file => file.path.endsWith('.js') || file.path === '<stdout>').text, type: 'module' });
        const primary = page.getByRole('button', { name: 'Prepare return', exact: true });
        await primary.waitFor(); assert.equal(await primary.isDisabled(), true);
        await page.evaluate(() => fixture.resolve()); await primary.waitFor({ state: 'visible' });
        await page.waitForFunction(() => !document.querySelector('.phone-detail-actions>.phone-primary').disabled);
        if (large) await page.addStyleTag({ content: '.phone-detail-actions>button{font-size:32px!important;line-height:1.4!important}.phone-detail-identity h1{font-size:48px!important}' });
        const geometry = await page.evaluate(() => {
          const rect = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }; };
          return { viewport: innerWidth, group: rect(document.querySelector('.phone-detail-actions')), buttons: [...document.querySelectorAll('.phone-detail-actions>button')].map(node => ({ ...rect(node), font: parseFloat(getComputedStyle(node).fontSize), label: node.textContent })), title: rect(document.querySelector('.phone-detail-identity h1')), tabs: rect(document.querySelector('.phone-tabs')), pageWidth: document.documentElement.scrollWidth };
        });
        assert.equal(geometry.buttons.length, 3);
        assert.ok(Math.abs(geometry.buttons[0].width - geometry.group.width) < 1, 'The stock operation has its own full-width row');
        for (const button of geometry.buttons) {
          assert.ok(button.height >= 48 && button.font >= (large ? 32 : 16), JSON.stringify(button));
          assert.ok(button.x >= 0 && button.right <= geometry.viewport + 1, 'Action remains within the viewport');
          assert.ok(button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1, 'Action text is not clipped');
        }
        if (viewport.width < 580) {
          geometry.buttons.forEach(button => assert.ok(Math.abs(button.width - geometry.group.width) < 1));
          assert.ok(geometry.buttons[1].y >= geometry.buttons[0].bottom + 7);
          assert.ok(geometry.buttons[2].y >= geometry.buttons[1].bottom + 7);
        } else {
          assert.ok(Math.abs(geometry.buttons[1].width - geometry.buttons[2].width) < 1);
          assert.ok(Math.abs(geometry.buttons[1].height - geometry.buttons[2].height) < 1);
          assert.ok(Math.abs(geometry.buttons[1].y - geometry.buttons[2].y) < 1);
        }
        assert.ok(geometry.title.scrollWidth <= geometry.title.clientWidth + 1 && geometry.pageWidth <= geometry.viewport + 1, 'Long battery identity does not overflow');
        assert.ok(geometry.tabs.y >= geometry.group.bottom, 'Actions do not overlap record sections');
        await primary.press('Enter');
        await page.getByRole('button', { name: 'Loans, inspections & actions', exact: true }).press('Enter');
        await page.getByRole('button', { name: 'Download record', exact: true }).press('Enter');
        assert.deepEqual(await page.evaluate(() => fixture.calls), [{ kind: 'return', ids: ['BAT-00000001'] }, 'full-record', 'export']);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  }
});
