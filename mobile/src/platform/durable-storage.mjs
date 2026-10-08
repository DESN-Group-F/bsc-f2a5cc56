export function createDurableStorage({ load, save }) {
  let entries = {}, loaded = false, failure = null, tail = Promise.resolve(), raw = null, pending = 0, transactions = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener({ pending, error: failure?.message || null }));
  const parse = (value) => {
    if (value === null) return {};
    const document = JSON.parse(value);
    if (!document || typeof document !== 'object' || Array.isArray(document) || document.schemaVersion !== 1 || !document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)
      || Object.entries(document.entries).some(([key, value]) => typeof key !== 'string' || typeof value !== 'string')) throw new Error('Saved business recovery data is unreadable. It has not been replaced.');
    return document.entries;
  };
  const requireReady = () => { if (!loaded || failure) throw new Error(failure?.message || 'Business recovery storage is not ready.'); };
  const requireMutable = () => { requireReady(); if (transactions) throw new Error('An atomic recovery update is being saved. Wait before changing the draft.'); };
  const enqueue = () => {
    const captured = JSON.stringify({ schemaVersion: 1, entries });
    pending++; notify();
    tail = tail.then(() => { if (failure) throw failure; return save(captured); }).then(() => { raw = captured; }).catch((error) => { failure = error; }).finally(() => { pending--; notify(); });
  };
  return {
    async initialize() { try { raw = await load(); entries = parse(raw); loaded = true; } catch (error) { failure = error; notify(); throw error; } },
    getItem(key) { requireReady(); return Object.hasOwn(entries, key) ? entries[key] : null; },
    setItem(key, value) { requireMutable(); entries = { ...entries, [String(key)]: String(value) }; enqueue(); },
    removeItem(key) { requireMutable(); const next = { ...entries }; delete next[key]; entries = next; enqueue(); },
    key(index) { requireReady(); return Object.keys(entries)[index] ?? null; },
    get length() { requireReady(); return Object.keys(entries).length; },
    async flush() { await tail; requireReady(); },
    exportRaw() { return JSON.stringify({ savedRaw: raw, current: { schemaVersion: 1, entries }, persistenceError: failure?.message || null }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async retryPersistence() { if (!loaded) throw new Error('Unreadable saved recovery data cannot be overwritten. Export it for review.'); await tail; const captured = JSON.stringify({ schemaVersion: 1, entries }); pending++; notify(); try { await save(captured); raw = captured; failure = null; } catch (error) { failure = error; throw error; } finally { pending--; notify(); } },
    async transact(update) {
      requireReady(); pending++; transactions++; notify();
      const operation = tail.then(async () => {
        requireReady(); const candidate = { ...entries }; update(candidate);
        const captured = JSON.stringify({ schemaVersion: 1, entries: candidate });
        await save(captured); entries = candidate; raw = captured;
      }).catch((error) => { failure = error; throw error; }).finally(() => { pending--; transactions--; notify(); });
      tail = operation.catch(() => {});
      await operation;
    },
    entries() { requireReady(); return { ...entries }; },
    hasPending() { requireReady(); return Object.keys(entries).some((key) => !key.startsWith('preference:')); },
  };
}

export function browserStorageDriver(storage, namespace) {
  return {
    load: async () => storage.getItem(namespace),
    save: async (raw) => { storage.setItem(namespace, raw); if (storage.getItem(namespace) !== raw) throw new Error('Business recovery data was not saved. No new operation will be sent.'); },
  };
}
