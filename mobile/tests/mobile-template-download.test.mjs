import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { downloadImportTemplate, TEMPLATE_PATHS } from '../src/platform/template-download.mjs';

test('all bundled mobile CSV templates retain the exact shared web template content', async () => {
  for (const path of TEMPLATE_PATHS) {
    const name = path.split('/').at(-1);
    const local = await readFile(new URL(`../public/templates/${name}`, import.meta.url), 'utf8');
    const shared = await readFile(new URL(`../../public/templates/${name}`, import.meta.url), 'utf8');
    assert.equal(local, shared);
    await downloadImportTemplate(path, local, async file => { assert.equal(file.filename, name); assert.equal(await file.blob.text(), shared); assert.equal(file.blob.type, 'text/csv;charset=utf-8'); });
  }
});

test('template completion awaits actual native save/share and propagates its rejection', async () => {
  let resolveSave, done = false;
  const pending = downloadImportTemplate('/templates/batteries.csv', 'Battery ID,Name\n', () => new Promise(resolve => { resolveSave = resolve; })).then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  resolveSave(); await pending; assert.equal(done, true);
  await assert.rejects(downloadImportTemplate('/templates/rooms.csv', 'Room ID,Name\n', async () => { throw new Error('Controlled share cancellation'); }), /Controlled share cancellation/);
  await assert.rejects(downloadImportTemplate('/templates/other.csv', 'sample', () => assert.fail('Unknown template must not save')), /unavailable/);
});
