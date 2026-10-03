"use client";

import { useEffect, useState } from "react";
import { taskRequest } from "@/lib/client/task-api";

export function useTaskEndpoint<T>(
  url: string,
  userId: string,
  source: unknown,
  paused = false,
) {
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<{
    url: string;
    userId: string;
    source: unknown;
    revision: number;
    payload: T | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    const context = { url, userId, source, revision };
    taskRequest<T>(url, { signal: abort.signal })
      .then((payload) => {
        if (active && !abort.signal.aborted)
          setSaved({ ...context, payload, error: "" });
      })
      .catch((error) => {
        if (active && !abort.signal.aborted)
          setSaved({
            ...context,
            payload: null,
            error: (error as Error).message,
          });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [url, userId, source, revision]);
  const current =
    saved?.url === url &&
    saved.userId === userId &&
    saved.source === source &&
    saved.revision === revision;
  const loading = !current;
  useEffect(() => {
    if (paused || loading) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        setRevision((value) => value + 1);
    };
    const interval = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [paused, loading]);
  return {
    payload: current ? saved.payload : null,
    error: current ? saved.error : "",
    loading,
    refresh: () => setRevision((value) => value + 1),
  };
}
