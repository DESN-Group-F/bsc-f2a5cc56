"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffUser } from "@/lib/accounts";
import type { Dataset, InventorySnapshot } from "@/lib/domain";
import { inventoryResponse } from "@/lib/client/inventory-request";

/** Own the authoritative snapshot and reject late responses from older contexts. */
export function useInventoryData(initialUser: StaffUser) {
  const [user, setUser] = useState(initialUser);
  const [dataset, setDataset] = useState<Dataset>(initialUser.defaultDataset);
  const [data, setData] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const current = useRef<InventorySnapshot | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(
    async (mode: Dataset, signal?: AbortSignal, initialize = false) => {
      const sequence = ++loadSequence.current;
      if (initialize && mode === "demo") {
        await inventoryResponse(
          await fetch("/api/inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataset: mode, action: "initialize_demo" }),
            signal,
          }),
        );
      }
      const snapshot = await inventoryResponse<InventorySnapshot>(
        await fetch(`/api/inventory?dataset=${mode}`, {
          signal,
          cache: "no-store",
        }),
      );
      if (signal?.aborted || sequence !== loadSequence.current) return;
      if (JSON.stringify(snapshot) !== JSON.stringify(current.current)) {
        current.current = snapshot;
        setData(snapshot);
        setRevision((value) => value + 1);
      }
      setUser(snapshot.user);
      setError("");
    },
    [],
  );

  useEffect(() => {
    const abort = new AbortController();
    load(dataset, abort.signal, true)
      .catch((error) => {
        if (!abort.signal.aborted && error.name !== "AbortError")
          setError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [dataset, load]);

  function changeDataset(mode: Dataset) {
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
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function acceptReviewedInventory(snapshot?: InventorySnapshot) {
    if (
      !snapshot ||
      snapshot.dataset !== dataset ||
      snapshot.user.id !== user.id
    )
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

export function useInventoryPolling({
  paused,
  dataset,
  load,
  onError,
}: {
  paused: boolean;
  dataset: Dataset;
  load: (dataset: Dataset, signal?: AbortSignal) => Promise<void>;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    async function sync() {
      if (paused || document.visibilityState !== "visible") return;
      try {
        await load(dataset, abort.signal);
      } catch (error) {
        if (active && !abort.signal.aborted) onError((error as Error).message);
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
