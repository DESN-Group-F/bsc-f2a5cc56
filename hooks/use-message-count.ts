"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dataset } from "@/lib/domain";
import { inventoryResponse } from "@/lib/client/inventory-request";

/** Global own unread count stays independent of the inbox's visible filters. */
export function useMessageCount(
  dataset: Dataset,
  accountId: string,
  inboxOpen: boolean,
  revision: number,
) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const context = `${dataset}-${accountId}`;
  const acceptCount = useCallback(
    (count: number) => {
      setCounts((previous) =>
        previous[context] === count
          ? previous
          : { ...previous, [context]: count },
      );
    },
    [context],
  );

  useEffect(() => {
    if (inboxOpen) return;
    const abort = new AbortController();
    let active = true;
    async function sync() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/messages?dataset=${dataset}&countOnly=true`,
          { signal: abort.signal, cache: "no-store" },
        );
        const body = await inventoryResponse<{ unreadCount: number }>(response);
        if (active && !abort.signal.aborted) acceptCount(body.unreadCount);
      } catch (error) {
        if (
          active &&
          !abort.signal.aborted &&
          (error as Error).name !== "AbortError"
        ) {
          setCounts((previous) =>
            previous[context] === null
              ? previous
              : { ...previous, [context]: null },
          );
        }
      }
    }
    void sync();
    const interval = setInterval(sync, 10000);
    window.addEventListener("focus", sync);
    return () => {
      active = false;
      abort.abort();
      clearInterval(interval);
      window.removeEventListener("focus", sync);
    };
  }, [dataset, context, acceptCount, inboxOpen, revision]);

  return {
    unreadCount: counts[context] ?? null,
    acceptUnreadCount: acceptCount,
  };
}
