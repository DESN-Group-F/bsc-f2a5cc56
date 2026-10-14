"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { inventoryResponse } from "../lib/client/inventory-request.js";
import { inventoryRevisionKey } from "../lib/new-arrivals.js";
/** Own the authoritative snapshot and reject late responses from older contexts. */
export function useInventoryData(initialUser) {
    const [user, setUser] = useState(initialUser);
    const [dataset, setDataset] = useState(initialUser.defaultDataset);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const current = useRef(null);
    const loadSequence = useRef(0);
    const refreshSequence = useRef(0);
    const load = useCallback(async (mode, signal, initialize = false) => {
        const sequence = ++loadSequence.current;
        const abort = new AbortController();
        const cancel = () => abort.abort();
        let timedOut = false;
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted)
            abort.abort();
        const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 30000);
        try {
            if (initialize && mode === "demo") {
                await inventoryResponse(await fetch("/api/inventory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dataset: mode, action: "initialize_demo" }),
                    signal: abort.signal,
                }));
            }
            const snapshot = await inventoryResponse(await fetch(`/api/inventory?dataset=${mode}`, {
                signal: abort.signal,
                cache: "no-store",
            }));
            if (snapshot.dataset !== mode || snapshot.user?.id !== initialUser.id) throw new Error("The inventory response belongs to a different account or dataset. It has not been adopted.");
            if (signal?.aborted || sequence !== loadSequence.current)
                return;
            if (JSON.stringify(snapshot) !== JSON.stringify(current.current)) {
                const changed = inventoryRevisionKey(snapshot) !== inventoryRevisionKey(current.current);
                current.current = snapshot;
                setData(snapshot);
                if (changed)
                    setRevision((value) => value + 1);
            }
            setUser(snapshot.user);
            setError("");
        }
        catch (failure) {
            if (signal?.aborted || sequence !== loadSequence.current)
                return;
            if (timedOut)
                throw new Error("The inventory is taking too long to respond. Check your connection, then retry refresh.");
            throw failure;
        }
        finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", cancel);
        }
    }, []);
    useEffect(() => {
        const abort = new AbortController();
        Promise.resolve().then(() => load(dataset, abort.signal, true))
            .catch((error) => {
            if (!abort.signal.aborted && error.name !== "AbortError")
                setError(error.message);
        })
            .finally(() => {
            if (!abort.signal.aborted)
                setLoading(false);
        });
        return () => abort.abort();
    }, [dataset, load]);
    function changeDataset(mode) {
        refreshSequence.current++;
        loadSequence.current++;
        current.current = null;
        setData(null);
        setLoading(true);
        setError("");
        setDataset(mode);
    }
    async function refresh() {
        const sequence = ++refreshSequence.current;
        setLoading(true);
        try {
            await load(dataset, undefined, !data);
        }
        catch (error) {
            if (sequence === refreshSequence.current)
                setError(error.message);
        }
        finally {
            if (sequence === refreshSequence.current)
                setLoading(false);
        }
    }
    function acceptReviewedInventory(snapshot) {
        if (!snapshot ||
            snapshot.dataset !== dataset ||
            snapshot.user.id !== user.id)
            return;
        loadSequence.current++;
        current.current = snapshot;
        setData(snapshot);
        setUser(snapshot.user);
        setRevision((value) => value + 1);
    }
    return {
        user,
        dataset,
        data,
        loading,
        error,
        revision,
        current,
        setError,
        setRevision,
        load,
        refresh,
        changeDataset,
        acceptReviewedInventory,
    };
}
export function useInventoryPolling({ paused, dataset, load, onError, }) {
    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        let syncing = false;
        async function sync() {
            if (paused || syncing || document.visibilityState !== "visible")
                return;
            syncing = true;
            try {
                await load(dataset, abort.signal);
            }
            catch (error) {
                if (active && !abort.signal.aborted)
                    onError(error.message);
            }
            finally {
                syncing = false;
            }
        }
        const interval = setInterval(sync, 10000);
        window.addEventListener("focus", sync);
        return () => {
            active = false;
            abort.abort();
            clearInterval(interval);
            window.removeEventListener("focus", sync);
        };
    }, [dataset, load, paused, onError]);
}
