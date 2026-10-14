/** A native app has one business WebView; serialize its original-request recovery. */
export function createNativeRecoveryLocks() {
  const held = new Set();
  return {
    async request(name, options, action) {
      if (!options?.ifAvailable) throw new Error('Native recovery uses an explicit nonblocking lock.');
      if (held.has(name)) return action(null);
      held.add(name);
      try { return await action({ name, mode: 'exclusive' }); }
      finally { held.delete(name); }
    },
  };
}
