export const BUSINESS_DATA_CODEC = 'gzip-base64-v1';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_GZIP_BYTES = MAX_BYTES + 65536;

function failure(message, code = 'INVALID_BUSINESS_DATA') {
  return Object.assign(new Error(message), { code });
}
function checkedBytes(data) {
  if (typeof data !== 'string') throw failure('Provide the complete business envelope as a string.');
  // TextEncoder replaces isolated surrogates, which would change captured bytes.
  for (let index = 0; index < data.length; index++) {
    const value = data.charCodeAt(index);
    if (value >= 0xd800 && value <= 0xdbff) {
      const next = data.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw failure('Provide valid Unicode business data. Existing files were preserved.');
    } else if (value >= 0xdc00 && value <= 0xdfff) throw failure('Provide valid Unicode business data. Existing files were preserved.');
  }
  if (data.length > MAX_BYTES) throw failure('The complete business envelope exceeds 16 MiB.', 'BUSINESS_DATA_TOO_LARGE');
  const bytes = new TextEncoder().encode(data);
  if (bytes.length > MAX_BYTES) throw failure('The complete business envelope exceeds 16 MiB.', 'BUSINESS_DATA_TOO_LARGE');
  return bytes;
}
async function gzip(bytes, Encoder) {
  const reader = new Blob([bytes]).stream().pipeThrough(new Encoder('gzip')).getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.length > MAX_GZIP_BYTES - size) throw failure('The compressed business transfer exceeds its input bound.', 'BUSINESS_DATA_TOO_LARGE');
      chunks.push(value); size += value.length;
    }
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
export function createNativeBusinessDataDriver({ service, platform, configuration, Encoder = globalThis.CompressionStream }) {
  const compressed = platform === 'android' && Array.isArray(configuration?.businessDataCodecs) && configuration.businessDataCodecs.includes(BUSINESS_DATA_CODEC) && typeof Encoder === 'function';
  return {
    load: async () => (await service.loadBusinessData()).data,
    async save(data) {
      if (!compressed) return service.saveBusinessData({ data });
      const bytes = checkedBytes(data), encoded = await gzip(bytes, Encoder);
      // A completed but unhelpful compression may use the original wire format.
      if (4 * Math.ceil(encoded.length / 3) >= bytes.length) return service.saveBusinessData({ data });
      let binary = '';
      for (let offset = 0; offset < encoded.length; offset += 8192) binary += String.fromCharCode(...encoded.subarray(offset, offset + 8192));
      return service.saveBusinessData({ data: btoa(binary), codec: BUSINESS_DATA_CODEC });
    },
  };
}

export function createServiceScopeController({ service, storage, origin }) {
  let phase = 'idle';
  const retries = new Set();
  const blocked = () => failure(phase === 'sealed' ? 'Service configuration may have changed. Reload or restart the app before changing saved work.' : 'Service configuration is changing. Wait before changing saved work.', 'CONFIGURATION_IN_PROGRESS');
  // Install before exposing storage. Existing admitted operations keep draining;
  // new mutations cannot change entries while an origin switch is in progress.
  for (const name of ['setItem', 'removeItem', 'transact', 'retryPersistence']) {
    const operation = storage[name];
    storage[name] = function (...args) {
      if (phase !== 'idle') {
        if (name === 'transact' || name === 'retryPersistence') return Promise.reject(blocked());
        throw blocked();
      }
      const result = operation.apply(this, args);
      if (name === 'retryPersistence') {
        retries.add(result);
        result.then(() => retries.delete(result), () => retries.delete(result));
      }
      return result;
    };
  }
  return {
    async configure(nextOrigin) {
      if (phase !== 'idle') throw blocked();
      phase = 'draining'; let dispatched = false;
      try {
        // An already admitted explicit retry may repair the previous failure.
        // Always recheck flush after that retry settles; never start one here.
        try { await storage.flush(); } catch {}
        await Promise.all([...retries]);
        await storage.flush();
        if (storage.hasPending()) throw new Error('Resolve or retain pending business work before changing the service.');
        phase = 'switching'; dispatched = true;
        await service.configure({ origin: nextOrigin });
        phase = 'sealed'; // Old-scope storage stays sealed until runtime reload.
      } catch (error) {
        if (!dispatched) phase = 'idle';
        else {
          // A failed response can follow a committed configuration change.
          // Reopen the old storage only after confirming its original scope.
          phase = 'sealed';
          try {
            const confirmed = await service.getConfiguration();
            if (confirmed && Object.hasOwn(confirmed, 'origin') && (confirmed.origin === null || typeof confirmed.origin === 'string') && confirmed.origin === (origin ?? null)) phase = 'idle';
          } catch {}
          if (phase === 'sealed') {
            const recovery = Object.assign(new Error(`${error?.message || String(error)} Service configuration may have changed. Reload or restart the app before changing saved work.`), { cause: error }, error?.code === undefined ? {} : { code: error.code });
            throw recovery;
          }
        }
        throw error;
      }
    },
  };
}
