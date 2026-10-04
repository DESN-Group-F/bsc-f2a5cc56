import assert from 'node:assert/strict';
import test from 'node:test';
import { BatteryNfc } from '../index.js';
import { BatteryNfcWeb } from '../web.js';

test('registered plugin reports unavailable on the web without inventing a read', async () => {
  const availability = await BatteryNfc.getAvailability();
  assert.equal(availability.platform, 'web');
  assert.equal(availability.available, false);
  assert.equal(availability.enabled, false);
  assert.match(availability.reason, /native application/);
  await assert.rejects(BatteryNfc.read({ timeoutMs: 1000 }), error => {
    assert.equal(error.code, 'UNAVAILABLE');
    assert.match(error.message, /No hardware read was made/);
    return true;
  });
});

test('web cancel is idempotent and cannot enable subsequent hardware reads', async () => {
  const plugin = new BatteryNfcWeb();
  await plugin.cancel();
  await plugin.cancel();
  await assert.rejects(plugin.read(), { code: 'UNAVAILABLE' });
  assert.equal((await plugin.getAvailability()).enabled, false);
});
