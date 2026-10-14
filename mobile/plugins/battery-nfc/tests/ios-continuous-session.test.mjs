import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { iosReaderFixtures, iosReaderHarness } from './ios-reader-fixtures.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

test('production iOS reader lifecycle with controlled Core NFC doubles', { timeout: 60_000 }, async context => {
  if (process.platform !== 'darwin') return context.skip('Requires macOS Swift; no native reader lifecycle execution occurred.');
  const version = spawnSync('xcrun', ['swiftc', '--version'], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(version.status, 0, version.stderr || version.error?.message);
  const work = path.join(pluginRoot, 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(path.join(work, 'ios-reader-lifecycle-'));
  const production = await readFile(path.join(pluginRoot, 'ios/Sources/BatteryNfcPlugin/BatteryNfcPlugin.swift'), 'utf8');
  // Only platform imports, Objective-C exposure and the usage-description source
  // are replaced. The production state machine and real main-queue timers execute.
  const controlled = production
    .replace(/^import (Capacitor|CoreNFC|UIKit)\r?\n/gm, '')
    .replace(/@objc(?:\(BatteryNfcPlugin\))?\s*/g, '')
    .replace(/Bundle\.main\.object/g, 'FixtureBundle.main.object');
  const source = path.join(directory, 'ReaderHarness.swift');
  await writeFile(source, `${iosReaderFixtures}\n${controlled}\n${iosReaderHarness}`);
  const executable = path.join(directory, 'reader-harness');
  const compilation = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-parse-as-library', source, '-o', executable], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.error?.message);
  const execution = spawnSync(executable, [], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
  assert.match(execution.stdout, /Passed \d+ controlled iOS reader assertions/);
  context.diagnostic(execution.stdout.trim());
});
