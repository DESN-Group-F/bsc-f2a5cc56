import assert from 'node:assert/strict';
import test from 'node:test';
import { BatteryServiceWeb } from '../web.js';

test('browser adapter cannot impersonate native secure session transport', async () => {
  const service = new BatteryServiceWeb();
  assert.deepEqual(await service.getConfiguration(), { origin: null });
  for (const action of [() => service.configure({ origin: 'https://inventory.example' }), () => service.request({ path: '/api/session', method: 'GET' }), () => service.clearSession(), () => service.loadBusinessData(), () => service.saveBusinessData({ data: '{}' })]) {
    await assert.rejects(action(), error => error.code === 'UNAVAILABLE');
  }
  assert.deepEqual(await service.getConfiguration(), { origin: null });
});
