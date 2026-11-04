/** Bound the entire operation, including response bodies that ignore cancellation. */
export async function withOperationDeadline(operation, { signal, timeoutMs, message }) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer;
  let rejectInterrupted;
  const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
  const interrupt = (reason) => {
    rejectInterrupted(reason);
    controller.abort(reason);
  };
  const abort = () => interrupt(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => interrupt(new Error(message)), timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return operation(controller.signal);
      }),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
