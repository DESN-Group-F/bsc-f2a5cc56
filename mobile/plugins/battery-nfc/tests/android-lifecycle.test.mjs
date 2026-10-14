import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { androidSdkFixtures } from './android-sdk-fixtures.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const javaDirectory = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin')
  : process.platform === 'win32' ? 'C:/Program Files/Common Files/Oracle/Java/javapath' : '';
const executable = name => javaDirectory ? path.join(javaDirectory, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;

const sources = androidSdkFixtures;

test('actual Android Java lifecycle under controlled SDK doubles', { timeout: 30_000 }, async context => {
  if (javaDirectory && !existsSync(executable('javac'))) return context.skip('JDK unavailable; no native lifecycle check executed.');
  const version = spawnSync(executable('javac'), ['-version'], { encoding: 'utf8', windowsHide: true });
  if (version.error) return context.skip('JDK unavailable; no native lifecycle check executed.');
  const work = path.join(pluginRoot, 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(path.join(work, 'android-lifecycle-'));
  const files = [];
  for (const [relative, source] of Object.entries(sources)) {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    files.push(file);
  }
  const target = path.join(pluginRoot, 'android/src/main/java/com/batteryinventory/nfc/BatteryNfcPlugin.java');
  const compilation = spawnSync(executable('javac'), ['-d', directory, ...files, target], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.error?.message);
  const execution = spawnSync(executable('java'), ['-cp', directory, 'com.batteryinventory.nfc.LifecycleHarness'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
  assert.match(execution.stdout, /Passed \d+ controlled lifecycle assertions/);
  context.diagnostic(execution.stdout.trim());
});
