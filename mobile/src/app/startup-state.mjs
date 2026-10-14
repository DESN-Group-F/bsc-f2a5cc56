/** Resolve local preparation and authentication before exposing a destination. */
export function createStartupCoordinator({ prepare, checkSession }) {
  const listeners = new Set();
  let generation = 0, runtime = null, running = null, disposed = false;
  let snapshot = { phase: 'opening', origin: '', user: null, error: '', failedStage: null, localReady: false };
  const publish = update => {
    if (disposed) return;
    snapshot = { ...snapshot, ...update };
    listeners.forEach(listener => listener());
  };
  function start() {
    if (disposed) return Promise.resolve(null);
    if (running) return running;
    const token = ++generation;
    const current = () => !disposed && token === generation;
    publish({ phase: runtime ? 'checking-session' : 'opening', error: '', failedStage: null, user: null });
    let stage = runtime ? 'session' : 'local';
    const task = (async () => {
      try {
        if (!runtime) {
          const prepared = await prepare(phase => { if (current()) publish({ phase }); });
          if (!current()) return null;
          runtime = prepared;
          publish({ origin: runtime.origin, localReady: true });
        }
        if (!current()) return null;
        if (runtime.origin === 'unconfigured') {
          publish({ phase: 'configuration', user: null });
          return null;
        }
        stage = 'session';
        publish({ phase: 'checking-session' });
        const user = await checkSession(runtime);
        if (!current()) return null;
        publish({ phase: user ? 'authenticated' : 'signed-out', user: user || null });
        return user || null;
      } catch (failure) {
        if (current()) publish({ phase: 'failed', user: null, error: failure?.message || String(failure), failedStage: stage });
        return null;
      }
    })();
    running = task;
    task.finally(() => { if (running === task) running = null; });
    return task;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start,
    signedIn(user) { generation++; running = null; publish({ phase: 'authenticated', user, error: '', failedStage: null }); },
    signedOut() { generation++; running = null; publish({ phase: 'signed-out', user: null, error: '', failedStage: null }); },
    dispose() { generation++; disposed = true; listeners.clear(); },
  };
}

export function startupPresentation(state) {
  if (state.phase === 'failed' && state.saveError) return { title: 'Device save needs attention', detail: 'Captured work is retained. Retry the device save before continuing.', action: 'Retry device save', failed: true };
  if (state.phase === 'failed') return state.failedStage === 'session'
    ? { title: 'Sign-in could not be checked', detail: 'Check the connection and retry. Your saved work and sign-in credentials have been retained.', action: 'Retry connection', failed: true }
    : { title: 'Saved work needs attention', detail: 'The app could not finish opening local work. Existing data has been retained.', action: 'Retry opening', failed: true };
  if (state.phase === 'restoring') return { title: 'Restoring saved work', detail: 'Nothing is submitted automatically.' };
  if (state.phase === 'checking-session') return { title: 'Checking sign-in', detail: 'Opening your staff workspace.' };
  return { title: 'Opening Battery Inventory', detail: 'Preparing this device.' };
}
