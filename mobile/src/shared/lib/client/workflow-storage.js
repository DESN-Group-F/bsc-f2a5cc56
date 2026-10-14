/** Release a captured request only after its complete local update is durable. */
export async function acknowledgeWorkflowStorage({ updates = {}, remove = [], expected = {}, storage = window.__batteryWorkflowStorage }) {
    await storage.flush?.();
    const apply = (entries) => {
        for (const [key, value] of Object.entries(expected))
            if ((entries[key] ?? null) !== value)
                throw new Error("The original recovery record changed. Its acknowledgement has been blocked.");
        for (const [key, value] of Object.entries(updates))
            entries[key] = value;
        for (const key of remove)
            delete entries[key];
    };
    if (storage.transact)
        await storage.transact(apply);
    else {
        const keys = new Set([...Object.keys(updates), ...remove, ...Object.keys(expected)]);
        const entries = Object.fromEntries([...keys].flatMap(key => { const value = storage.getItem(key); return value === null ? [] : [[key, value]]; }));
        apply(entries);
        for (const [key, value] of Object.entries(updates))
            storage.setItem(key, value);
        for (const key of remove)
            storage.removeItem(key);
        await storage.flush?.();
    }
    for (const [key, value] of Object.entries(updates))
        if (storage.getItem(key) !== value)
            throw new Error("The recovery update was not acknowledged. Retain and retry the original request.");
    for (const key of remove)
        if (storage.getItem(key) !== null)
            throw new Error("The original request was not durably acknowledged. Retry that same request.");
}
