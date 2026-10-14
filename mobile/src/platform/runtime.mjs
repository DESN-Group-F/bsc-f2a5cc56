import { Capacitor, registerPlugin } from '@capacitor/core';
import { createDurableStorage, browserStorageDriver } from './durable-storage.mjs';
import { createNativeRecoveryLocks } from './recovery-locks.mjs';
import { createNativeBusinessDataDriver, createServiceScopeController } from './native-business-data.mjs';

export const native = Capacitor.isNativePlatform();
export const apiPaths = ['/api/session', '/api/inventory', '/api/accounts', '/api/battery-models', '/api/teaching-groups', '/api/teaching-checkouts', '/api/task-plans', '/api/messages', '/api/export', '/api/locations', '/api/location-observations'];
let service, storage, serviceScope;
const originalFetch = globalThis.fetch.bind(globalThis);
const contextBase = () => native ? 'https://mobile.invalid' : location.origin;
export function checkedApiPath(input) {
  const value = typeof input === 'string' ? input : input?.url;
  const url = new URL(value, contextBase());
  if (url.origin !== contextBase() || !apiPaths.includes(url.pathname) || url.hash || url.username || url.password) throw new Error('Only the configured inventory API can be requested.');
  return url.pathname + url.search;
}
export async function initializeRuntime() {
  let origin = location.origin;
  if (native) {
    service = (await import('@battery-inventory/service')).BatteryService;
    const configuration = await service.getConfiguration();
    origin = configuration.origin || 'unconfigured';
    storage = createDurableStorage(createNativeBusinessDataDriver({ service, platform: Capacitor.getPlatform(), configuration }));
    serviceScope = createServiceScopeController({ service, storage, origin: configuration.origin });
  } else storage = createDurableStorage(browserStorageDriver(localStorage, 'battery-mobile-business-v1:' + origin));
  await storage.initialize();
  window.__batteryWorkflowStorage = storage;
  window.__batteryLocationLocks = native ? createNativeRecoveryLocks() : navigator.locks;
  window.__batteryMobileSaveFile = saveFile;
  if (native && Capacitor.getPlatform() === 'android') {
    const ui = registerPlugin('BatteryUi');
    window.__batteryMobileHaptic = durationMs => ui.haptic({ durationMs });
  }
  const { createTeachingNfcBridge } = await import('../business/teaching-nfc-bridge.mjs');
  const adapter = native ? (await import('@battery-inventory/nfc')).BatteryNfc : null;
  window.__batteryTeachingNfc = createTeachingNfcBridge({ adapter, storage, platform: Capacitor.getPlatform() });
  globalThis.fetch = mobileFetch;
  return { origin, storage };
}
export function businessStorage() { if (!storage) throw new Error('Business storage is not initialized.'); return storage; }
export async function clearNativeSession() { if (!native || !service) throw new Error('Native session reset is unavailable in the browser.'); await service.clearSession(); window.dispatchEvent(new Event('battery-mobile-session')); }
export async function configureOrigin(origin) {
  if (!native) throw new Error('Browser preview uses its own isolated local service.');
  await serviceScope.configure(origin);
  location.reload();
}
export async function mobileFetch(input, init = {}) {
  const path = checkedApiPath(input);
  const request = input instanceof Request ? input : null;
  const method = (init.method || request?.method || 'GET').toUpperCase();
  const signal = init.signal || request?.signal;
  const headers = new Headers(init.headers === undefined ? request?.headers : init.headers);
  const body = Object.hasOwn(init, 'body') ? init.body : request && method === 'POST' ? await request.clone().text() : undefined;
  if (!['GET', 'POST'].includes(method)) throw new Error('This request method is unavailable.');
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (method === 'POST') await storage.flush();
  if (signal?.aborted) throw new DOMException('Request cancelled before sending', 'AbortError');
  if (!native) {
    const response = await originalFetch(path, { ...init, method, headers, body, signal, credentials: 'same-origin', redirect: 'error' });
    if (response.status === 401) window.dispatchEvent(new Event('battery-mobile-session'));
    return response;
  }
  const result = await service.request({ path, method, headers: Object.fromEntries(headers.entries()), ...(body === undefined ? {} : { body }) });
  if (result.status === 401) window.dispatchEvent(new Event('battery-mobile-session'));
  if (signal?.aborted) throw new DOMException('Response abandoned; the operation result may be uncertain', 'AbortError');
  const bytes = result.encoding === 'base64' ? Uint8Array.from(atob(result.body), (value) => value.charCodeAt(0)) : result.body;
  return new Response(bytes, { status: result.status, headers: result.headers });
}
export async function saveFile({ blob, filename }) {
  if (native) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let data = ''; for (let offset = 0; offset < bytes.length; offset += 8192) data += String.fromCharCode(...bytes.slice(offset, offset + 8192));
    const name = filename.replace(/[^A-Za-z0-9._-]/g, '_');
    const saved = await Filesystem.writeFile({ path: name, data: btoa(data), directory: Directory.Cache });
    await Share.share({ files: [saved.uri], title: 'Inventory report', dialogTitle: 'Save inventory report' });
    return;
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
