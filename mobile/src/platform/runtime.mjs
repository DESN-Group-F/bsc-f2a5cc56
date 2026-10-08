import { Capacitor } from '@capacitor/core';
import { createDurableStorage, browserStorageDriver } from './durable-storage.mjs';

export const native = Capacitor.isNativePlatform();
export const apiPaths = ['/api/session', '/api/inventory', '/api/accounts', '/api/battery-models', '/api/teaching-groups', '/api/task-plans', '/api/messages', '/api/export'];
let service, storage;
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
    origin = (await service.getConfiguration()).origin || 'unconfigured';
    storage = createDurableStorage({
      load: async () => (await service.loadBusinessData()).data,
      save: async (data) => service.saveBusinessData({ data }),
    });
  } else storage = createDurableStorage(browserStorageDriver(localStorage, 'battery-mobile-business-v1:' + origin));
  await storage.initialize();
  window.__batteryWorkflowStorage = storage;
  window.__batteryMobileSaveFile = saveFile;
  globalThis.fetch = mobileFetch;
  return { origin, storage };
}
export function businessStorage() { if (!storage) throw new Error('Business storage is not initialized.'); return storage; }
export async function clearNativeSession() { if (!native || !service) throw new Error('Native session reset is unavailable in the browser.'); await service.clearSession(); window.dispatchEvent(new Event('battery-mobile-session')); }
export async function configureOrigin(origin) {
  if (!native) throw new Error('Browser preview uses its own isolated local service.');
  if (storage.hasPending()) throw new Error('Resolve or retain pending business work before changing the service.');
  await service.configure({ origin });
  location.reload();
}
async function mobileFetch(input, init = {}) {
  const path = checkedApiPath(input);
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('This request method is unavailable.');
  if (init.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (method === 'POST') await storage.flush();
  if (!native) return originalFetch(path, { ...init, credentials: 'same-origin', redirect: 'error' });
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const result = await service.request({ path, method, headers, ...(init.body === undefined ? {} : { body: init.body }) });
  if (init.signal?.aborted) throw new DOMException('Response abandoned; the operation result may be uncertain', 'AbortError');
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
