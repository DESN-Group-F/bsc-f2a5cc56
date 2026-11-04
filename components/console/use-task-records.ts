"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dataset } from "@/lib/domain";
import { taskRequest, type TaskPlansResponse } from "@/lib/client/task-api";

/**
 * Shared recurring-task records for the current inventory. Reading them is also when the server
 * evaluates due reminders, exactly as in the full application; nothing here completes a task.
 */
export function useTaskRecords(dataset: Dataset, accountId: string, revision: number, paused: boolean) {
  const [state, setState] = useState<{ context: string; data: TaskPlansResponse | null; error: string; loading: boolean }>({ context: "", data: null, error: "", loading: true });
  const context = `${dataset}:${accountId}`;
  const sequence = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    setState((previous) => ({ ...previous, context, loading: true, ...(previous.context === context ? {} : { data: null, error: "" }) }));
    try {
      const data = await taskRequest<TaskPlansResponse>(`/api/task-plans?dataset=${dataset}`, { signal });
      if (signal?.aborted || current !== sequence.current) return;
      setState({ context, data, error: "", loading: false });
    } catch (error) {
      if (signal?.aborted || current !== sequence.current || (error as Error).name === "AbortError") return;
      setState((previous) => ({ ...previous, context, error: (error as Error).message, loading: false }));
    }
  }, [context, dataset]);

  useEffect(() => {
    const abort = new AbortController();
    void reload(abort.signal);
    return () => abort.abort();
  }, [reload, revision]);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 30000);
    return () => clearInterval(interval);
  }, [paused, reload]);

  const current = state.context === context;
  return { data: current ? state.data : null, error: current ? state.error : "", loading: !current || state.loading, reload };
}
