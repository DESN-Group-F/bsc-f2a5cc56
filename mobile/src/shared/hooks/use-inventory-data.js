"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { inventoryResponse } from "../lib/client/inventory-request.js";
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
    const load = useCallback(async (mode, signal, initialize = false) => {
        const sequence = ++loadSequence.current;
        if (initialize && mode === "demo") {
            await inventoryResponse(await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataset: mode, action: "initialize_demo" }),
                signal,
            }));
        }
        const snapshot = await inventoryResponse(await fetch(`/api/inventory?dataset=${mode}`, {
            signal,
            cache: "no-store",
        }));
        if (signal?.aborted || sequence !== loadSequence.current)
            return;
        if (JSON.stringify(snapshot) !== JSON.stringify(current.current)) {
            current.current = snapshot;
            setData(snapshot);
            setRevision((value) => value + 1);
        }
        setUser(snapshot.user);
        setError("");
    }, []);
    useEffect(() => {
        const abort = new AbortController();
        load(dataset, abort.signal, true)
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
        loadSequence.current++;
        current.current = null;
        setData(null);
        setLoading(true);
        setError("");
        setDataset(mode);
    }
    async function refresh() {
        setLoading(true);
        try {
            await load(dataset, undefined, !data);
        }
        catch (error) {
            setError(error.message);
        }
        finally {
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
        async function sync() {
            if (paused || document.visibilityState !== "visible")
                return;
            try {
                await load(dataset, abort.signal);
            }
            catch (error) {
                if (active && !abort.signal.aborted)
                    onError(error.message);
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
