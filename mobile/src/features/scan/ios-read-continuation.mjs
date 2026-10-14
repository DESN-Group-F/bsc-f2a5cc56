const stopped = (code = 'CANCELLED', message = 'This scan session ended. Start again when ready.') => Object.assign(new Error(message), { code });

/** Transport-only state: session handles never become inventory evidence. */
export function createIosReadContinuation() {
  let sessionId = null, terminal = null, pending = false;
  return {
    async read(adapter, options) {
      if (terminal) throw terminal;
      if (pending) throw stopped('BUSY', 'The previous tag is still being read.');
      pending = true;
      try {
        const result = await adapter.read({ ...options, timeoutMs: 60000, keepSessionAlive: true, ...(sessionId ? { sessionId } : {}) });
        // A late native result is still evidence. Ownership above this layer
        // prevents adoption after cancellation; retain the raw read itself.
        if (typeof result?.readerSessionId !== 'string' || !result.readerSessionId || (sessionId && result.readerSessionId !== sessionId)) {
          throw stopped('INVALID_EVIDENCE', 'The NFC reader did not preserve this scan session. Start again after reviewing saved work.');
        }
        sessionId = result.readerSessionId;
        const { readerSessionId, ...evidence } = result;
        return evidence;
      } catch (error) {
        terminal = error;
        throw error;
      } finally { pending = false; }
    },
    async cancel(adapter) {
      terminal ||= stopped();
      await adapter.cancel();
    },
  };
}
